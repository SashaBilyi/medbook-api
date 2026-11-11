import { sql } from 'drizzle-orm';
import { db, queryClient } from './index.js';

async function migrateData() {
  console.log('[2/3] Running non-blocking data backfill migrations...');

  await db.execute(sql`
    UPDATE appointments
    SET status = 'confirmed'
    WHERE id IN (
      SELECT id FROM appointments
      WHERE status = '' OR status IS NULL
      LIMIT 500
    );
  `);

  console.log('Data migrations completed successfully.');
  await queryClient.end();
}

migrateData().catch((err) => {
  console.error('Data migration failed:', err);
  process.exit(1);
});
