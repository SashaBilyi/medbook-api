/* eslint-disable no-console */
import { queryClient } from './index.js';

async function migrateIndexes() {
  console.log('[3/3] Creating indexes concurrently (non-blocking)...');

  await queryClient.unsafe(`SET statement_timeout = '3600s';`);

  await queryClient.unsafe(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_schedules_doctor_id
    ON schedules (doctor_id);
  `);

  await queryClient.unsafe(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_appointments_schedule_id
    ON appointments (schedule_id);
  `);

  console.log('Concurrent index creation completed successfully.');
  await queryClient.end();
}

migrateIndexes().catch((err) => {
  console.error('Index migration failed:', err);
  process.exit(1);
});
