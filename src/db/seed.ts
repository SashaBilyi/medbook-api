/* eslint-disable no-console */
import { sql } from 'drizzle-orm';
import { db, queryClient } from './index.js';
import { doctors, schedules } from './schema.js';

async function seed() {
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_SEED !== 'true') {
    console.log('Skipping destructive seed in production environment.');
    await queryClient.end();
    return;
  }

  console.log('Seeding database with initial reference data...');

  await db.execute(sql`TRUNCATE TABLE appointments, schedules, doctors RESTART IDENTITY CASCADE;`);

  const insertedDoctors = await db
    .insert(doctors)
    .values([
      { name: 'Др. Олександр Коваль', specialization: 'Кардіолог' },
      { name: 'Др. Ірина Мельник', specialization: 'Невролог' },
    ])
    .returning();

  const doc1 = insertedDoctors[0];
  const doc2 = insertedDoctors[1];

  if (!doc1 || !doc2) {
    throw new Error('Failed to seed doctors');
  }

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

  console.log('Database seeded successfully.');
  await queryClient.end();
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
