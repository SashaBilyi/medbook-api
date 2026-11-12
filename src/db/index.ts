import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

const connectionString =
  process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5433/medbook';

export const queryClient = postgres(connectionString, {
  max: Number(process.env.DB_POOL_MAX ?? 20),
  connect_timeout: 5,
});

export const db = drizzle(queryClient, { schema });
