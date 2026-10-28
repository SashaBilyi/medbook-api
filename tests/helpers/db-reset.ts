import { sql } from 'drizzle-orm';
import { db } from '../../src/db/index.js';
import { doctors, schedules } from '../../src/db/schema.js';

export async function resetAndSeedDatabase() {
  await db.execute(
    sql`TRUNCATE TABLE appointments, schedules, doctors RESTART IDENTITY CASCADE;`,
  );

  const insertedDoctors = await db
    .insert(doctors)
    .values([
      { name: 'Др. Олександр Коваль', specialization: 'Кардіолог' },
      { name: 'Др. Ірина Мельник', specialization: 'Невролог' },
    ])
    .returning();

  const doc1 = insertedDoctors[0];
  const doc2 = insertedDoctors[1];

  if (doc1 && doc2) {
    await db.insert(schedules).values([
      {
        id: 101,
        doctorId: doc1.id,
        slotTime: new Date('2026-10-20T09:00:00.000Z'),
        isBooked: false,
      },
      {
        id: 102,
        doctorId: doc1.id,
        slotTime: new Date('2026-10-20T10:00:00.000Z'),
        isBooked: false,
      },
      {
        id: 103,
        doctorId: doc2.id,
        slotTime: new Date('2026-10-20T11:00:00.000Z'),
        isBooked: false,
      },
    ]);
  }
}