import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { withRetry } from '../db/resilience.js';
import { doctors, schedules } from '../db/schema.js';

export const schedulesService = {
  async getAllWithDoctors() {
    return withRetry(() =>
      db
        .select({
          id: schedules.id,
          slotTime: schedules.slotTime,
          isBooked: schedules.isBooked,
          doctorName: doctors.name,
          specialization: doctors.specialization,
        })
        .from(schedules)
        .innerJoin(doctors, eq(schedules.doctorId, doctors.id))
        .orderBy(schedules.id),
    );
  },
};
