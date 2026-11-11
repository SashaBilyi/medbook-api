/* eslint-disable no-console */
import { sql } from 'drizzle-orm';
import { db, queryClient } from './index.js';

async function migrateSchema() {
  console.log('[1/3] Running structural schema migrations (Expand phase)...');

  await db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL lock_timeout = '5s';`);
    await tx.execute(sql`SET LOCAL statement_timeout = '30s';`);

    await tx.execute(sql`
      CREATE TABLE IF NOT EXISTS doctors (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        specialization TEXT NOT NULL
      );
    `);

    await tx.execute(sql`
      CREATE TABLE IF NOT EXISTS schedules (
        id SERIAL PRIMARY KEY,
        doctor_id INTEGER NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
        slot_time TIMESTAMPTZ NOT NULL,
        is_booked BOOLEAN NOT NULL DEFAULT false
      );
    `);

    await tx.execute(sql`
      CREATE TABLE IF NOT EXISTS appointments (
        id SERIAL PRIMARY KEY,
        schedule_id INTEGER NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
        patient_name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'confirmed',
        idempotency_key TEXT NOT NULL UNIQUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
  });

  console.log('Schema migrations completed successfully.');
  await queryClient.end();
}

migrateSchema().catch((err) => {
  console.error('Schema migration failed:', err);
  process.exit(1);
});
