/* eslint-disable no-console */
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import autocannon from 'autocannon';
import { queryClient } from '../src/db/index.js';

interface RepeatMetrics {
  repeat: number;
  rpsMean: number;
  latencyP50Ms: number;
  latencyP95Ms: number;
  latencyP99Ms: number;
  latencyMaxMs: number;
  throughputMbPerSec: number;
  totalRequests: number;
  status2xx: number;
  status4xx: number;
  status5xx: number;
  errors: number;
  timeouts: number;
}

interface SpreadSummary {
  mean: number;
  min: number;
  max: number;
  stddev: number;
  cvPercent: number;
}

function summarize(values: number[]): SpreadSummary {
  if (values.length === 0) {
    return { mean: 0, min: 0, max: 0, stddev: 0, cvPercent: 0 };
  }
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / values.length;
  const stddev = Math.sqrt(variance);
  const cvPercent = mean > 0 ? (stddev / mean) * 100 : 0;
  return {
    mean: Number(mean.toFixed(2)),
    min: Number(Math.min(...values).toFixed(2)),
    max: Number(Math.max(...values).toFixed(2)),
    stddev: Number(stddev.toFixed(2)),
    cvPercent: Number(cvPercent.toFixed(2)),
  };
}

async function waitForServer(baseUrl: string, timeoutMs = 15000): Promise<Record<string, unknown>> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${baseUrl}/version`);
      if (res.ok) {
        return (await res.json()) as Record<string, unknown>;
      }
    } catch {
      // retry until ready
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Server at ${baseUrl} did not become ready within ${timeoutMs}ms`);
}

function startInstrumentedServer(port: number, telemetryFile: string): ChildProcess {
  const child = spawn(
    process.execPath,
    ['--import', './scripts/perf-telemetry.mjs', 'dist/index.js'],
    {
      env: {
        ...process.env,
        PORT: String(port),
        PERF_TELEMETRY_FILE: telemetryFile,
      },
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    },
  );
  child.stderr?.on('data', () => {
    // keep stderr drained so child never blocks
  });
  return child;
}

async function stopServer(child: ChildProcess): Promise<void> {
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve();
    }, 5000);

    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });

    if (child.connected) {
      child.send('PERF_SHUTDOWN');
    } else {
      child.kill('SIGTERM');
    }
  });
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return Number((sorted[idx] ?? 0).toFixed(2));
}

async function runAutocannon(
  opts: autocannon.Options,
): Promise<{ result: autocannon.Result; exactLatencies: number[] }> {
  return new Promise((resolve, reject) => {
    const exactLatencies: number[] = [];
    const instance = autocannon(opts, (err, result) => {
      if (err) reject(err);
      else resolve({ result, exactLatencies });
    });
    instance.on('response', (_client, _statusCode, _resBytes, responseTime) => {
      exactLatencies.push(responseTime);
    });
    instance.on('error', reject);
  });
}

function extractRepeatMetrics(
  repeat: number,
  res: autocannon.Result,
  exactLatencies: number[],
): RepeatMetrics {
  const sorted = exactLatencies.slice().sort((a, b) => a - b);
  const hasExact = sorted.length > 0;
  const lat = res.latency;
  return {
    repeat,
    rpsMean: Number(res.requests.average.toFixed(2)),
    latencyP50Ms: hasExact ? percentile(sorted, 50) : Number(lat.p50.toFixed(2)),
    latencyP95Ms: hasExact ? percentile(sorted, 95) : Number(lat.p97_5.toFixed(2)),
    latencyP99Ms: hasExact ? percentile(sorted, 99) : Number(lat.p99.toFixed(2)),
    latencyMaxMs: hasExact
      ? Number((sorted[sorted.length - 1] ?? 0).toFixed(2))
      : Number(lat.max.toFixed(2)),
    throughputMbPerSec: Number((res.throughput.average / 1024 / 1024).toFixed(2)),
    totalRequests: res.requests.total,
    status2xx: res['2xx'],
    status4xx: res['4xx'],
    status5xx: res['5xx'],
    errors: res.errors,
    timeouts: res.timeouts,
  };
}

async function runScenario(
  name: string,
  repeats: number,
  warmupSeconds: number,
  buildOpts: (phase: string, repeat: number) => autocannon.Options,
) {
  console.log(`\n--- Scenario: ${name} (warmup=${warmupSeconds}s, repeats=${repeats}) ---`);
  await runAutocannon({ ...buildOpts('warmup', 0), duration: warmupSeconds });

  const runs: RepeatMetrics[] = [];
  for (let i = 1; i <= repeats; i++) {
    const { result, exactLatencies } = await runAutocannon(buildOpts('run', i));
    const m = extractRepeatMetrics(i, result, exactLatencies);
    runs.push(m);
    console.log(
      `  [run ${i}/${repeats}] RPS=${m.rpsMean} | p50=${m.latencyP50Ms}ms p95=${m.latencyP95Ms}ms p99=${m.latencyP99Ms}ms | ` +
        `2xx=${m.status2xx} 4xx=${m.status4xx} 5xx=${m.status5xx} err=${m.errors} | ${m.throughputMbPerSec} MB/s`,
    );
  }

  return {
    name,
    repeats,
    runs,
    summary: {
      rps: summarize(runs.map((r) => r.rpsMean)),
      p50Ms: summarize(runs.map((r) => r.latencyP50Ms)),
      p95Ms: summarize(runs.map((r) => r.latencyP95Ms)),
      p99Ms: summarize(runs.map((r) => r.latencyP99Ms)),
      throughputMbPerSec: summarize(runs.map((r) => r.throughputMbPerSec)),
      total2xx: runs.reduce((a, r) => a + r.status2xx, 0),
      total4xx: runs.reduce((a, r) => a + r.status4xx, 0),
      total5xx: runs.reduce((a, r) => a + r.status5xx, 0),
      totalErrors: runs.reduce((a, r) => a + r.errors, 0),
    },
  };
}

async function main() {
  const tag = process.env.PERF_TAG ?? 'latest';
  const repeats = Number(process.env.LOAD_REPEATS ?? 5);
  const port = Number(process.env.LOAD_PORT ?? 3101);
  const baseUrl = `http://127.0.0.1:${port}`;
  const outDir = path.resolve('reports/perf');
  fs.mkdirSync(outDir, { recursive: true });

  const telemetryFile = path.join(outDir, `load-telemetry-${tag}.json`);

  // Fetch sample IDs from PostgreSQL for realistic mixed and contention scenarios
  const freeSlotRows = await queryClient.unsafe<Array<{ id: number }>>(
    `SELECT id FROM schedules WHERE is_booked = false ORDER BY id LIMIT 4000`,
  );
  const confirmedApptRows = await queryClient.unsafe<Array<{ id: number }>>(
    `SELECT id FROM appointments WHERE status = 'confirmed' ORDER BY id LIMIT 2000`,
  );
  const freeSlotIds = freeSlotRows.map((r) => r.id);
  const confirmedApptIds = confirmedApptRows.map((r) => r.id);

  if (freeSlotIds.length < 50 || confirmedApptIds.length < 50) {
    throw new Error(
      'Not enough load data in PostgreSQL. Run `npm run db:seed:load` before `make load`.',
    );
  }

  console.log(`Starting compiled server on ${baseUrl} (tag=${tag}, repeats=${repeats})...`);
  const server = startInstrumentedServer(port, telemetryFile);

  let versionInfo: Record<string, unknown> = {};
  const scenarios = [];

  try {
    versionInfo = await waitForServer(baseUrl);
    console.log('Target /version:', JSON.stringify(versionInfo));

    // Scenario 1: Read Schedules
    scenarios.push(
      await runScenario('read-schedules', repeats, 2, () => ({
        url: `${baseUrl}/api/schedules`,
        connections: 10,
        duration: 6,
        timeout: 15,
      })),
    );

    // Scenario 2: Read Appointments
    scenarios.push(
      await runScenario('read-appointments', repeats, 2, () => ({
        url: `${baseUrl}/api/appointments`,
        connections: 10,
        duration: 6,
        timeout: 15,
      })),
    );

    // Scenario 3: Mixed Clinic Workload (70% read / 20% book / 10% cancel)
    let bookCursor = 0;
    let cancelCursor = 0;
    scenarios.push(
      await runScenario('mixed-clinic', repeats, 2, (phase, rep) => ({
        url: baseUrl,
        connections: 12,
        duration: 8,
        timeout: 15,
        requests: [
          { method: 'GET', path: '/api/schedules' },
          { method: 'GET', path: '/api/schedules' },
          { method: 'GET', path: '/api/schedules' },
          { method: 'GET', path: '/api/schedules' },
          { method: 'GET', path: '/api/doctors' },
          { method: 'GET', path: '/api/appointments' },
          { method: 'GET', path: '/api/appointments' },
          {
            method: 'POST',
            path: '/api/appointments',
            headers: { 'content-type': 'application/json' },
            setupRequest: (req) => {
              const idx = bookCursor++;
              const scheduleId = freeSlotIds[idx % freeSlotIds.length] ?? 1;
              return {
                ...req,
                headers: {
                  ...req.headers,
                  'idempotency-key': `mixed-${tag}-${phase}-${rep}-${idx}`,
                },
                body: JSON.stringify({ scheduleId, patientName: `Пацієнт Mixed #${idx}` }),
              };
            },
          },
          {
            method: 'POST',
            path: '/api/appointments',
            headers: { 'content-type': 'application/json' },
            setupRequest: (req) => {
              // Idempotent replay of existing confirmed appointment
              const replayNum = (bookCursor % 50) + 1;
              return {
                ...req,
                headers: {
                  ...req.headers,
                  'idempotency-key': `load-confirmed-${replayNum}`,
                },
                body: JSON.stringify({ scheduleId: 1, patientName: 'Пацієнт Replay' }),
              };
            },
          },
          {
            method: 'PATCH',
            path: '/api/appointments/1/cancel',
            setupRequest: (req) => {
              const apptId = confirmedApptIds[cancelCursor++ % confirmedApptIds.length] ?? 1;
              return {
                ...req,
                path: `/api/appointments/${apptId}/cancel`,
              };
            },
          },
        ],
      })),
    );

    // Scenario 4: Hot-slot Write Contention + Concurrent Idempotency Race
    const hotSlots = freeSlotIds.slice(-20);
    let contentionSeq = 0;
    scenarios.push(
      await runScenario('booking-contention', repeats, 2, (phase, rep) => ({
        url: baseUrl,
        connections: 20,
        duration: 6,
        timeout: 15,
        requests: [
          {
            method: 'POST',
            path: '/api/appointments',
            headers: { 'content-type': 'application/json' },
            setupRequest: (req) => {
              const seq = contentionSeq++;
              const slotId = hotSlots[seq % hotSlots.length] ?? 1;
              // Every 4 requests share the same key across concurrent workers (simulating double-click / retry storm)
              const sharedBucket = Math.floor(seq / 4);
              const key =
                seq % 3 === 0
                  ? `race-${tag}-${phase}-${rep}-${sharedBucket}`
                  : `unique-${tag}-${phase}-${rep}-${seq}`;
              return {
                ...req,
                headers: {
                  ...req.headers,
                  'idempotency-key': key,
                },
                body: JSON.stringify({ scheduleId: slotId, patientName: `Конкурент #${seq}` }),
              };
            },
          },
        ],
      })),
    );
  } finally {
    await stopServer(server);
    await queryClient.end();
  }

  const telemetry = fs.existsSync(telemetryFile)
    ? JSON.parse(fs.readFileSync(telemetryFile, 'utf8'))
    : null;

  const finalReport = {
    generatedAt: new Date().toISOString(),
    tag,
    nodeVersion: process.version,
    platform: process.platform,
    version: versionInfo,
    scenarios,
    telemetry,
  };

  const outFile = path.join(outDir, `load-${tag}.json`);
  fs.writeFileSync(outFile, JSON.stringify(finalReport, null, 2), 'utf8');

  console.log('\n=== Load Test Summary ===');
  for (const s of scenarios) {
    console.log(
      `  ${s.name}: RPS=${s.summary.rps.mean} (±${s.summary.rps.stddev}, CV=${s.summary.rps.cvPercent}%) | ` +
        `p50=${s.summary.p50Ms.mean}ms | p95=${s.summary.p95Ms.mean}ms (±${s.summary.p95Ms.stddev}) | ` +
        `p99=${s.summary.p99Ms.mean}ms | 2xx=${s.summary.total2xx} 4xx=${s.summary.total4xx} 5xx=${s.summary.total5xx}`,
    );
  }
  if (telemetry) {
    console.log(
      `  Server CPU vs Wait: CPU=${telemetry.cpu.cpuUtilizationPercent}% vs Wait/Idle=${telemetry.cpu.waitOrIdlePercent}% | ` +
        `ELU=${telemetry.eventLoop.utilizationPercent}% | EL Delay p95=${telemetry.eventLoop.delayP95Ms}ms p99=${telemetry.eventLoop.delayP99Ms}ms`,
    );
    console.log(
      `  Server RAM: RSS start=${telemetry.memory.startRssMb}MB peak=${telemetry.memory.peakRssMb}MB end=${telemetry.memory.endRssMb}MB | ` +
        `HeapUsed start=${telemetry.memory.startHeapUsedMb}MB peak=${telemetry.memory.peakHeapUsedMb}MB end=${telemetry.memory.endHeapUsedMb}MB`,
    );
  }
  console.log(`\nSaved load report to ${outFile}`);
}

main().catch((err) => {
  console.error('Load test failed:', err);
  process.exit(1);
});
