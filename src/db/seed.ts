import { sql } from 'drizzle-orm';
import { db, queryClient } from './index.js';
import { doctors, schedules } from './schema.js';

async function seed() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS doctors (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      specialization TEXT NOT NULL
    );
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS schedules (
      id SERIAL PRIMARY KEY,
      doctor_id INTEGER NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
      slot_time TIMESTAMPTZ NOT NULL,
      is_booked BOOLEAN NOT NULL DEFAULT FALSE
    );
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS appointments (
      id SERIAL PRIMARY KEY,
      schedule_id INTEGER NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
      patient_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'confirmed',
      idempotency_key TEXT NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

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

  process.stdout.write('Database initialized and seeded successfully.\n');
  await queryClient.end();
}

seed().catch((err: unknown) => {
  const cause = err instanceof Error && 'cause' in err ? err.cause : '';
  process.stderr.write(`Seed failed: ${String(err)}\nCause: ${String(cause)}\n`);
  process.exit(1);
});
