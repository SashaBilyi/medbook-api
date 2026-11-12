import { describe, expect, it, vi } from 'vitest';
import {
  AppointmentNotFoundError,
  BOOKING_CORE_VERSION,
  createBookingModule,
  InvalidBookingInputError,
  ScheduleNotFoundError,
  SlotAlreadyBookedError,
  UniqueIdempotencyConflictError,
  type AppointmentRecord,
  type BookingModuleDependencies,
  type BookingTransactionScope,
  type ScheduleRecord,
  type ScheduleWithDoctor,
} from '../src/index.js';

/**
 * Pure in-memory adapter implementing the DI ports of `@medbook/booking-core`.
 * Proves that the extracted library has ZERO knowledge of PostgreSQL, Drizzle, or Fastify.
 */
function createInMemoryAdapters(initial?: {
  schedules?: ScheduleRecord[];
  appointments?: AppointmentRecord[];
}) {
  const schedulesStore = new Map<number, ScheduleRecord>();
  const appointmentsStore = new Map<number, AppointmentRecord>();
  const doctorNames = new Map<number, { name: string; specialization: string }>([
    [1, { name: 'Др. Олександр Коваль', specialization: 'Кардіолог' }],
    [2, { name: 'Др. Ірина Мельник', specialization: 'Невролог' }],
  ]);

  let nextAppointmentId = 1;

  for (const s of initial?.schedules ?? [
    { id: 101, doctorId: 1, slotTime: new Date('2026-11-01T09:00:00.000Z'), isBooked: false },
    { id: 102, doctorId: 1, slotTime: new Date('2026-11-01T10:00:00.000Z'), isBooked: true },
    { id: 103, doctorId: 2, slotTime: new Date('2026-11-01T11:00:00.000Z'), isBooked: false },
  ]) {
    schedulesStore.set(s.id, { ...s });
  }

  for (const a of initial?.appointments ?? []) {
    appointmentsStore.set(a.id, { ...a });
    nextAppointmentId = Math.max(nextAppointmentId, a.id + 1);
  }

  const findByKey = (key: string): AppointmentRecord | null => {
    for (const appt of appointmentsStore.values()) {
      if (appt.idempotencyKey === key) return appt;
    }
    return null;
  };

  const scope: BookingTransactionScope = {
    async findAppointmentByIdempotencyKey(key) {
      return findByKey(key);
    },
    async lockScheduleForUpdate(scheduleId) {
      return schedulesStore.get(scheduleId) ?? null;
    },
    async markScheduleBooked(scheduleId, isBooked) {
      const current = schedulesStore.get(scheduleId);
      if (current) {
        schedulesStore.set(scheduleId, { ...current, isBooked });
      }
    },
    async insertAppointment(data) {
      if (findByKey(data.idempotencyKey)) {
        throw new UniqueIdempotencyConflictError(data.idempotencyKey);
      }
      const record: AppointmentRecord = {
        id: nextAppointmentId++,
        scheduleId: data.scheduleId,
        patientName: data.patientName,
        status: data.status,
        idempotencyKey: data.idempotencyKey,
        createdAt: new Date('2026-11-01T08:00:00.000Z'),
      };
      appointmentsStore.set(record.id, record);
      return record;
    },
    async lockAppointmentForUpdate(appointmentId) {
      return appointmentsStore.get(appointmentId) ?? null;
    },
    async updateAppointmentStatus(appointmentId, status) {
      const current = appointmentsStore.get(appointmentId);
      if (!current) throw new Error('Missing appointment');
      const updated: AppointmentRecord = { ...current, status };
      appointmentsStore.set(appointmentId, updated);
      return updated;
    },
  };

  const deps: BookingModuleDependencies = {
    schedules: {
      async findSchedulesWithDoctors(query): Promise<readonly ScheduleWithDoctor[]> {
        let rows = Array.from(schedulesStore.values());
        if (query.doctorId !== undefined) {
          rows = rows.filter((r) => r.doctorId === query.doctorId);
        }
        if (query.availableOnly) {
          rows = rows.filter((r) => !r.isBooked);
        }
        rows.sort((a, b) => a.id - b.id);
        return rows.slice(query.offset, query.offset + query.limit).map((r) => {
          const doc = doctorNames.get(r.doctorId) ?? { name: 'Unknown', specialization: 'General' };
          return {
            id: r.id,
            slotTime: r.slotTime,
            isBooked: r.isBooked,
            doctorName: doc.name,
            specialization: doc.specialization,
          };
        });
      },
    },
    appointments: {
      async findAppointments(query): Promise<readonly AppointmentRecord[]> {
        let rows = Array.from(appointmentsStore.values());
        if (query.status !== undefined) {
          rows = rows.filter((r) => r.status === query.status);
        }
        rows.sort((a, b) => a.id - b.id);
        return rows.slice(query.offset, query.offset + query.limit);
      },
      async findByIdempotencyKey(key) {
        return findByKey(key);
      },
      async preflightBooking(scheduleId, key) {
        return {
          existingAppointment: findByKey(key),
          slot: schedulesStore.get(scheduleId) ?? null,
        };
      },
    },
    transactions: {
      async runInTransaction(work) {
        return work(scope);
      },
    },
  };

  return { deps, schedulesStore, appointmentsStore };
}

describe('Unit: @medbook/booking-core (pure DI without database)', () => {
  it('exports semantic library version and enforces pagination bounds', async () => {
    expect(BOOKING_CORE_VERSION).toBe('1.0.0');

    const { deps } = createInMemoryAdapters();
    const findSpy = vi.spyOn(deps.schedules, 'findSchedulesWithDoctors');

    const booking = createBookingModule({
      ...deps,
      pagination: { defaultLimit: 25, maxLimit: 100 },
    });

    expect(booking.getPaginationBounds()).toEqual({ defaultLimit: 25, maxLimit: 100 });

    await booking.listSchedules();
    expect(findSpy).toHaveBeenCalledWith({
      doctorId: undefined,
      availableOnly: false,
      limit: 25,
      offset: 0,
    });

    await booking.listSchedules({ doctorId: 1, availableOnly: true, limit: 5000, offset: 10 });
    expect(findSpy).toHaveBeenLastCalledWith({
      doctorId: 1,
      availableOnly: true,
      limit: 100, // clamped to maxLimit
      offset: 10,
    });
  });

  it('rejects invalid query and booking inputs with InvalidBookingInputError (400)', async () => {
    const { deps } = createInMemoryAdapters();
    const booking = createBookingModule(deps);

    await expect(booking.listSchedules({ doctorId: 0 })).rejects.toBeInstanceOf(
      InvalidBookingInputError,
    );
    await expect(booking.listSchedules({ limit: -5 })).rejects.toBeInstanceOf(
      InvalidBookingInputError,
    );
    await expect(booking.listSchedules({ offset: -1 })).rejects.toBeInstanceOf(
      InvalidBookingInputError,
    );
    await expect(booking.listAppointments({ limit: 0 })).rejects.toBeInstanceOf(
      InvalidBookingInputError,
    );
    await expect(
      booking.bookSlot({ scheduleId: 0, patientName: 'Іван', idempotencyKey: 'k1' }),
    ).rejects.toBeInstanceOf(InvalidBookingInputError);
    await expect(
      booking.bookSlot({ scheduleId: 101, patientName: 'А', idempotencyKey: 'k1' }),
    ).rejects.toBeInstanceOf(InvalidBookingInputError);
    await expect(
      booking.bookSlot({ scheduleId: 101, patientName: 'Іван', idempotencyKey: '   ' }),
    ).rejects.toBeInstanceOf(InvalidBookingInputError);
    await expect(booking.cancelAppointment(0)).rejects.toBeInstanceOf(InvalidBookingInputError);
  });

  it('books slot atomically, serves fast-path idempotent replay without opening transaction, and handles 404/409', async () => {
    const { deps, schedulesStore } = createInMemoryAdapters();
    const txSpy = vi.spyOn(deps.transactions, 'runInTransaction');
    const booking = createBookingModule(deps);

    const created = await booking.bookSlot({
      scheduleId: 101,
      patientName: 'Іван Франко',
      idempotencyKey: 'unit-key-1',
    });
    expect(created.isReplay).toBe(false);
    expect(created.appointment.status).toBe('confirmed');
    expect(schedulesStore.get(101)?.isBooked).toBe(true);
    expect(txSpy).toHaveBeenCalledTimes(1);

    // Replay uses fast-path read without acquiring a write transaction
    const replay = await booking.bookSlot({
      scheduleId: 101,
      patientName: 'Іван Франко',
      idempotencyKey: 'unit-key-1',
    });
    expect(replay.isReplay).toBe(true);
    expect(replay.appointment.id).toBe(created.appointment.id);
    expect(txSpy).toHaveBeenCalledTimes(1);

    await expect(
      booking.bookSlot({ scheduleId: 999, patientName: 'Тарас', idempotencyKey: 'unit-404' }),
    ).rejects.toBeInstanceOf(ScheduleNotFoundError);

    await expect(
      booking.bookSlot({ scheduleId: 102, patientName: 'Тарас', idempotencyKey: 'unit-409' }),
    ).rejects.toBeInstanceOf(SlotAlreadyBookedError);
  });

  it('recovers gracefully from concurrent UniqueIdempotencyConflictError (23505) as idempotent replay', async () => {
    const { deps, appointmentsStore } = createInMemoryAdapters();
    const committedRecord: AppointmentRecord = {
      id: 77,
      scheduleId: 101,
      patientName: 'Гонка Пацієнт',
      status: 'confirmed',
      idempotencyKey: 'race-key-23505',
      createdAt: new Date('2026-11-01T08:00:00.000Z'),
    };

    const warnOrDebug = vi.fn();
    let preCheckCalls = 0;

    const booking = createBookingModule({
      ...deps,
      logger: { debug: warnOrDebug },
      appointments: {
        ...deps.appointments,
        preflightBooking: undefined,
        async findByIdempotencyKey(key) {
          preCheckCalls++;
          if (preCheckCalls === 1 && !appointmentsStore.has(77)) return null;
          return appointmentsStore.get(77) ?? (key === 'race-key-23505' ? committedRecord : null);
        },
      },
      transactions: {
        async runInTransaction() {
          appointmentsStore.set(77, committedRecord);
          throw new UniqueIdempotencyConflictError('race-key-23505');
        },
      },
    });

    const result = await booking.bookSlot({
      scheduleId: 101,
      patientName: 'Гонка Пацієнт',
      idempotencyKey: 'race-key-23505',
    });

    expect(result.isReplay).toBe(true);
    expect(result.appointment.id).toBe(77);
    expect(warnOrDebug).toHaveBeenCalledTimes(1);
  });

  it('cancels appointment, frees schedule slot, and protects rebooked slot on duplicate cancel', async () => {
    const { deps, schedulesStore } = createInMemoryAdapters();
    const booking = createBookingModule(deps);

    await expect(booking.cancelAppointment(999)).rejects.toBeInstanceOf(AppointmentNotFoundError);

    const first = await booking.bookSlot({
      scheduleId: 103,
      patientName: 'Леся Українка',
      idempotencyKey: 'cancel-1',
    });
    expect(schedulesStore.get(103)?.isBooked).toBe(true);

    const cancelled = await booking.cancelAppointment(first.appointment.id);
    expect(cancelled.status).toBe('cancelled');
    expect(schedulesStore.get(103)?.isBooked).toBe(false);

    // Another patient rebooks the freed slot
    await booking.bookSlot({
      scheduleId: 103,
      patientName: 'Богдан Хмельницький',
      idempotencyKey: 'rebook-2',
    });
    expect(schedulesStore.get(103)?.isBooked).toBe(true);

    // Duplicate cancel of old appointment must NOT unbook the new owner's slot
    const secondCancel = await booking.cancelAppointment(first.appointment.id);
    expect(secondCancel.status).toBe('cancelled');
    expect(schedulesStore.get(103)?.isBooked).toBe(true);
  });
});
