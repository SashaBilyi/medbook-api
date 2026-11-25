/* eslint-disable no-console */
import fs from 'node:fs';
import path from 'node:path';
import { queryClient } from '../src/db/index.js';

interface ExplainResult {
  name: string;
  sql: string;
  executionTimeMs: number | null;
  planningTimeMs: number | null;
  planLines: string[];
}

function extractMetric(lines: string[], prefix: string): number | null {
  const line = lines.find((l) => l.startsWith(prefix));
  if (!line) return null;
  const match = line.match(/([\d.]+)\s*ms/);
  return match && match[1] ? Number(match[1]) : null;
}

async function runExplain(
  name: string,
  statement: string,
  useRollback = false,
): Promise<ExplainResult> {
  let rows: Array<{ 'QUERY PLAN': string }>;

  if (useRollback) {
    let capturedPlan: Array<{ 'QUERY PLAN': string }> = [];
    const ROLLBACK_SENTINEL = Symbol('ROLLBACK_EXPLAIN');
    try {
      await queryClient.begin(async (tx) => {
        capturedPlan = await tx.unsafe<Array<{ 'QUERY PLAN': string }>>(
          `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) ${statement}`,
        );
        throw ROLLBACK_SENTINEL;
      });
    } catch (err) {
      if (err !== ROLLBACK_SENTINEL) {
        throw err;
      }
    }
    rows = capturedPlan;
  } else {
    rows = await queryClient.unsafe<Array<{ 'QUERY PLAN': string }>>(
      `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) ${statement}`,
    );
  }

  const planLines = rows.map((r) => r['QUERY PLAN']);
  return {
    name,
    sql: statement.trim().replace(/\s+/g, ' '),
    planningTimeMs: extractMetric(planLines, 'Planning Time:'),
    executionTimeMs: extractMetric(planLines, 'Execution Time:'),
    planLines,
  };
}

export async function analyzeDatabase(tag = process.env.PERF_TAG ?? 'snapshot') {
  console.log('\n=== PostgreSQL Database Analysis ===');

  const counts = await queryClient.unsafe<Array<{ table_name: string; row_count: string }>>(`
    SELECT 'doctors' AS table_name, COUNT(*)::text AS row_count FROM doctors
    UNION ALL
    SELECT 'schedules' AS table_name, COUNT(*)::text AS row_count FROM schedules
    UNION ALL
    SELECT 'appointments' AS table_name, COUNT(*)::text AS row_count FROM appointments;
  `);

  const tableStats = await queryClient.unsafe<
    Array<{
      table_name: string;
      live_rows: string;
      seq_scan: string;
      idx_scan: string;
      total_size: string;
      index_size: string;
    }>
  >(`
    SELECT
      relname AS table_name,
      n_live_tup::text AS live_rows,
      seq_scan::text AS seq_scan,
      COALESCE(idx_scan, 0)::text AS idx_scan,
      pg_size_pretty(pg_total_relation_size(relid)) AS total_size,
      pg_size_pretty(pg_indexes_size(relid)) AS index_size
    FROM pg_stat_user_tables
    ORDER BY relname;
  `);

  const indexes = await queryClient.unsafe<
    Array<{
      tablename: string;
      indexname: string;
      idx_scan: string;
      index_size: string;
      indexdef: string;
    }>
  >(`
    SELECT
      i.tablename,
      i.indexname,
      COALESCE(s.idx_scan, 0)::text AS idx_scan,
      pg_size_pretty(pg_relation_size(quote_ident(i.schemaname) || '.' || quote_ident(i.indexname))) AS index_size,
      i.indexdef
    FROM pg_indexes i
    LEFT JOIN pg_stat_user_indexes s
      ON s.schemaname = i.schemaname AND s.indexrelname = i.indexname
    WHERE i.schemaname = 'public'
    ORDER BY i.tablename, i.indexname;
  `);

  const explains: ExplainResult[] = [
    await runExplain(
      'GET /api/schedules (unbounded full join)',
      `SELECT s.id, s.slot_time, s.is_booked, d.name, d.specialization
       FROM schedules s
       INNER JOIN doctors d ON s.doctor_id = d.id
       ORDER BY s.id`,
    ),
    await runExplain(
      'GET /api/schedules (paginated default LIMIT 50)',
      `SELECT s.id, s.slot_time, s.is_booked, d.name, d.specialization
       FROM schedules s
       INNER JOIN doctors d ON s.doctor_id = d.id
       ORDER BY s.id
       LIMIT 50 OFFSET 0`,
    ),
    await runExplain(
      'GET /api/schedules (filtered doctor_id=10 & availableOnly=true ORDER BY slot_time LIMIT 25)',
      `SELECT s.id, s.slot_time, s.is_booked, d.name, d.specialization
       FROM schedules s
       INNER JOIN doctors d ON s.doctor_id = d.id
       WHERE s.doctor_id = 10 AND s.is_booked = false
       ORDER BY s.slot_time
       LIMIT 25`,
    ),
    await runExplain(
      'GET /api/appointments (unbounded full scan)',
      `SELECT id, schedule_id, patient_name, status, idempotency_key, created_at
       FROM appointments
       ORDER BY id`,
    ),
    await runExplain(
      'GET /api/appointments (paginated ORDER BY id DESC LIMIT 50)',
      `SELECT id, schedule_id, patient_name, status, idempotency_key, created_at
       FROM appointments
       ORDER BY id DESC
       LIMIT 50 OFFSET 0`,
    ),
    await runExplain(
      'POST /api/appointments — idempotency lookup',
      `SELECT id, schedule_id, patient_name, status, idempotency_key, created_at
       FROM appointments
       WHERE idempotency_key = 'load-confirmed-500'`,
    ),
    await runExplain(
      'POST /api/appointments — slot lock (SELECT FOR UPDATE)',
      `SELECT id, doctor_id, slot_time, is_booked
       FROM schedules
       WHERE id = 10
       FOR UPDATE`,
      true,
    ),
    await runExplain(
      'GET /api/appointments filtered by status = confirmed ORDER BY created_at DESC LIMIT 50',
      `SELECT id, schedule_id, patient_name, status, idempotency_key, created_at
       FROM appointments
       WHERE status = 'confirmed'
       ORDER BY created_at DESC
       LIMIT 50`,
    ),
  ];

  const report = {
    generatedAt: new Date().toISOString(),
    tag,
    counts,
    tableStats,
    indexes,
    explains,
  };

  const outDir = path.resolve('reports/perf');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `db-analyze-${tag}.json`);
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2), 'utf8');

  console.log('\nRow counts:');
  for (const c of counts) {
    console.log(`  - ${c.table_name}: ${c.row_count} rows`);
  }

  console.log('\nTable statistics:');
  for (const t of tableStats) {
    console.log(
      `  - ${t.table_name}: live=${t.live_rows}, seq_scan=${t.seq_scan}, idx_scan=${t.idx_scan}, total=${t.total_size}, indexes=${t.index_size}`,
    );
  }

  console.log('\nIndexes:');
  for (const idx of indexes) {
    console.log(
      `  - [${idx.tablename}] ${idx.indexname} (size=${idx.index_size}, idx_scan=${idx.idx_scan})`,
    );
  }

  console.log('\nEXPLAIN (ANALYZE, BUFFERS) summary:');
  for (const exp of explains) {
    const firstNode = exp.planLines[0] ?? '';
    console.log(
      `  - ${exp.name}: exec=${exp.executionTimeMs ?? '?'} ms, plan=${exp.planningTimeMs ?? '?'} ms | ${firstNode}`,
    );
  }

  console.log(`\nSaved DB analysis report to ${outFile}`);
  return report;
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}`) {
  analyzeDatabase()
    .then(() => queryClient.end())
    .catch((err) => {
      console.error('DB analysis failed:', err);
      process.exit(1);
    });
}
