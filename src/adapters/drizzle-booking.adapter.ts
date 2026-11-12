import {
  UniqueIdempotencyConflictError,
  type AppointmentReadPort,
  type AppointmentRecord,
  type AppointmentStatus,
  type BookingPreflightSnapshot,
  type BookingTransactionScope,
  type CreateAppointmentRecordData,
  type NormalizedAppointmentQuery,
  type NormalizedScheduleQuery,
  type ScheduleReadPort,
  type ScheduleRecord,
  type ScheduleWithDoctor,
  type TransactionRunnerPort,
} from '@medbook/booking-core';
import { and, desc, eq, sql, type SQL } from 'drizzle-orm';
import type { db as defaultDb } from '../db/index.js';
import { appointments, doctors, schedules } from '../db/schema.js';

export type DrizzleDatabase = typeof defaultDb;

function isPostgresUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const err = error as { code?: unknown; cause?: { code?: unknown } };
  return err.code === '23505' || err.cause?.code === '23505';
}

function toAppointmentStatus(raw: string): AppointmentStatus {
  return raw === 'cancelled' ? 'cancelled' : 'confirmed';
}

function mapAppointmentRow(row: typeof appointments.$inferSelect): AppointmentRecord {
  return {
    id: row.id,
    scheduleId: row.scheduleId,
    patientName: row.patientName,
    status: toAppointmentStatus(row.status),
    idempotencyKey: row.idempotencyKey,
    createdAt: row.createdAt,
  };
}

export function createDrizzleBookingAdapters(database: DrizzleDatabase): {
  schedules: ScheduleReadPort;
  appointments: AppointmentReadPort;
  transactions: TransactionRunnerPort;
} {
  const schedulePort: ScheduleReadPort = {
    async findSchedulesWithDoctors(
      query: NormalizedScheduleQuery,
    ): Promise<readonly ScheduleWithDoctor[]> {
      const conditions: SQL[] = [];

      if (query.doctorId !== undefined) {
        conditions.push(eq(schedules.doctorId, query.doctorId));
      }
      if (query.availableOnly) {
        conditions.push(eq(schedules.isBooked, false));
      }

      const baseQuery = database
        .select({
          id: schedules.id,
          slotTime: schedules.slotTime,
          isBooked: schedules.isBooked,
          doctorName: doctors.name,
          specialization: doctors.specialization,
        })
        .from(schedules)
        .innerJoin(doctors, eq(schedules.doctorId, doctors.id));

      const filteredQuery = conditions.length > 0 ? baseQuery.where(and(...conditions)) : baseQuery;

      const orderedQuery =
        query.doctorId !== undefined && query.availableOnly
          ? filteredQuery.orderBy(schedules.slotTime)
          : filteredQuery.orderBy(schedules.id);

      return orderedQuery.limit(query.limit).offset(query.offset);
    },
  };

  const appointmentPort: AppointmentReadPort = {
    async findAppointments(
      query: NormalizedAppointmentQuery,
    ): Promise<readonly AppointmentRecord[]> {
      const baseQuery = database.select().from(appointments);

      const rows =
        query.status !== undefined
          ? await baseQuery
              .where(eq(appointments.status, query.status))
              .orderBy(desc(appointments.createdAt))
              .limit(query.limit)
              .offset(query.offset)
          : await baseQuery.orderBy(appointments.id).limit(query.limit).offset(query.offset);

      return rows.map(mapAppointmentRow);
    },

    async findByIdempotencyKey(idempotencyKey: string): Promise<AppointmentRecord | null> {
      const [row] = await database
        .select()
        .from(appointments)
        .where(eq(appointments.idempotencyKey, idempotencyKey))
        .limit(1);

      return row ? mapAppointmentRow(row) : null;
    },

    async preflightBooking(
      scheduleId: number,
      idempotencyKey: string,
    ): Promise<BookingPreflightSnapshot> {
      const result = await database.execute(sql`
        SELECT
          (SELECT json_build_object(
            'id', a.id,
            'scheduleId', a.schedule_id,
            'patientName', a.patient_name,
            'status', a.status,
            'idempotencyKey', a.idempotency_key,
            'createdAt', a.created_at
          ) FROM appointments a WHERE a.idempotency_key = ${idempotencyKey} LIMIT 1) AS existing_appointment,
          (SELECT json_build_object(
            'id', s.id,
            'doctorId', s.doctor_id,
            'slotTime', s.slot_time,
            'isBooked', s.is_booked
          ) FROM schedules s WHERE s.id = ${scheduleId} LIMIT 1) AS slot
      `);

      const row = (result as unknown as Array<Record<string, unknown>>)[0];
      const rawAppt = row?.existing_appointment as
        | {
            id: number;
            scheduleId: number;
            patientName: string;
            status: string;
            idempotencyKey: string;
            createdAt: string;
          }
        | null
        | undefined;
      const rawSlot = row?.slot as
        | {
            id: number;
            doctorId: number;
            slotTime: string;
            isBooked: boolean;
          }
        | null
        | undefined;

      return {
        existingAppointment: rawAppt
          ? {
              id: rawAppt.id,
              scheduleId: rawAppt.scheduleId,
              patientName: rawAppt.patientName,
              status: toAppointmentStatus(rawAppt.status),
              idempotencyKey: rawAppt.idempotencyKey,
              createdAt: new Date(rawAppt.createdAt),
            }
          : null,
        slot: rawSlot
          ? {
              id: rawSlot.id,
              doctorId: rawSlot.doctorId,
              slotTime: new Date(rawSlot.slotTime),
              isBooked: rawSlot.isBooked,
            }
          : null,
      };
    },
  };

  const transactionPort: TransactionRunnerPort = {
    async runInTransaction<T>(work: (scope: BookingTransactionScope) => Promise<T>): Promise<T> {
      return database.transaction(async (tx) => {
        const scope: BookingTransactionScope = {
          async findAppointmentByIdempotencyKey(key: string): Promise<AppointmentRecord | null> {
            const [row] = await tx
              .select()
              .from(appointments)
              .where(eq(appointments.idempotencyKey, key))
              .limit(1);
            return row ? mapAppointmentRow(row) : null;
          },

          async lockScheduleForUpdate(scheduleId: number): Promise<ScheduleRecord | null> {
            const [slot] = await tx
              .select()
              .from(schedules)
              .where(eq(schedules.id, scheduleId))
              .for('update');
            return slot ?? null;
          },

          async markScheduleBooked(scheduleId: number, isBooked: boolean): Promise<void> {
            await tx.update(schedules).set({ isBooked }).where(eq(schedules.id, scheduleId));
          },

          async insertAppointment(data: CreateAppointmentRecordData): Promise<AppointmentRecord> {
            try {
              const [created] = await tx
                .insert(appointments)
                .values({
                  scheduleId: data.scheduleId,
                  patientName: data.patientName,
                  status: data.status,
                  idempotencyKey: data.idempotencyKey,
                })
                .returning();

              if (!created) {
                throw new Error('Failed to insert appointment row');
              }

              return mapAppointmentRow(created);
            } catch (error) {
              if (isPostgresUniqueViolation(error)) {
                throw new UniqueIdempotencyConflictError(data.idempotencyKey);
              }
              throw error;
            }
          },

          async lockAppointmentForUpdate(appointmentId: number): Promise<AppointmentRecord | null> {
            const [row] = await tx
              .select()
              .from(appointments)
              .where(eq(appointments.id, appointmentId))
              .for('update');
            return row ? mapAppointmentRow(row) : null;
          },

          async updateAppointmentStatus(
            appointmentId: number,
            status: AppointmentStatus,
          ): Promise<AppointmentRecord> {
            const [updated] = await tx
              .update(appointments)
              .set({ status })
              .where(eq(appointments.id, appointmentId))
              .returning();

            if (!updated) {
              throw new Error('Failed to update appointment status');
            }

            return mapAppointmentRow(updated);
          },
        };

        return work(scope);
      });
    },
  };

  return {
    schedules: schedulePort,
    appointments: appointmentPort,
    transactions: transactionPort,
  };
}
