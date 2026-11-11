import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { BusinessError, withRetry } from '../db/resilience.js';
import { appointments, schedules } from '../db/schema.js';

export interface CreateAppointmentInput {
  scheduleId: number;
  patientName: string;
  idempotencyKey: string;
}

export const appointmentsService = {
  async getAll() {
    return withRetry(() => db.select().from(appointments).orderBy(appointments.id));
  },

  async bookSlot({ scheduleId, patientName, idempotencyKey }: CreateAppointmentInput) {
    return withRetry(() =>
      db.transaction(async (tx) => {
        const [existing] = await tx
          .select()
          .from(appointments)
          .where(eq(appointments.idempotencyKey, idempotencyKey));

        if (existing) {
          return { isReplay: true, appointment: existing };
        }

        const [slot] = await tx
          .select()
          .from(schedules)
          .where(eq(schedules.id, scheduleId))
          .for('update');

        if (!slot) {
          throw new BusinessError(404, 'Schedule slot not found');
        }

        if (slot.isBooked) {
          throw new BusinessError(409, 'This schedule slot is already booked');
        }

        await tx.update(schedules).set({ isBooked: true }).where(eq(schedules.id, scheduleId));

        const [created] = await tx
          .insert(appointments)
          .values({
            scheduleId,
            patientName,
            status: 'confirmed',
            idempotencyKey,
          })
          .returning();

        return { isReplay: false, appointment: created };
      }),
    );
  },

  async cancelById(appointmentId: number) {
    return withRetry(() =>
      db.transaction(async (tx) => {
        const [appointment] = await tx
          .select()
          .from(appointments)
          .where(eq(appointments.id, appointmentId))
          .for('update');

        if (!appointment) {
          throw new BusinessError(404, 'Appointment not found');
        }

        if (appointment.status === 'cancelled') {
          return appointment;
        }

        const [updated] = await tx
          .update(appointments)
          .set({ status: 'cancelled' })
          .where(eq(appointments.id, appointmentId))
          .returning();

        await tx
          .update(schedules)
          .set({ isBooked: false })
          .where(eq(schedules.id, appointment.scheduleId));

        return updated;
      }),
    );
  },
};
