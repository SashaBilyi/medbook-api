/* eslint-disable no-console */
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import autocannon from 'autocannon';
import { queryClient } from '../src/db/index.js';
import { analyzeDatabase } from './db-analyze.js';

interface CpuProfileNode {
  id: number;
  callFrame: {
    functionName: string;
    url: string;
    lineNumber: number;
  };
  hitCount?: number;
}

interface CpuProfile {
  nodes: CpuProfileNode[];
  samples?: number[];
  timeDeltas?: number[];
}

function parseCpuProfile(filePath: string) {
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8')) as CpuProfile;
  const nodeMap = new Map<number, CpuProfileNode>();
  for (const n of raw.nodes) {
    nodeMap.set(n.id, n);
  }

  const timeByNode = new Map<number, number>();
  const samples = raw.samples ?? [];
  const deltas = raw.timeDeltas ?? [];
  let totalTimeUs = 0;

  for (let i = 0; i < samples.length; i++) {
    const id = samples[i];
    const dt = deltas[i] ?? 0;
    if (id === undefined) continue;
    totalTimeUs += dt;
    timeByNode.set(id, (timeByNode.get(id) ?? 0) + dt);
  }

  let idleUs = 0;
  let gcUs = 0;
  let programUs = 0;
  let activeJsUs = 0;

  const funcTotals = new Map<string, number>();

  for (const [id, us] of timeByNode.entries()) {
    const node = nodeMap.get(id);
    if (!node) continue;
    const fn = node.callFrame.functionName || '(anonymous)';
    const url = node.callFrame.url || '';

    if (fn === '(idle)') {
      idleUs += us;
    } else if (fn === '(garbage collector)') {
      gcUs += us;
    } else if (fn === '(program)') {
      programUs += us;
    } else {
      activeJsUs += us;
      const shortUrl = url
        ? url.replace(/^file:\/\/\/[A-Za-z]:\/node2026\/medbook-api\//, '').replace(/^node:/, 'node:')
        : 'native';
      const label = `${fn} [${shortUrl}:${node.callFrame.lineNumber}]`;
      funcTotals.set(label, (funcTotals.get(label) ?? 0) + us);
    }
  }

  const pct = (us: number) => (totalTimeUs > 0 ? Number(((us / totalTimeUs) * 100).toFixed(2)) : 0);

  const topFunctions = Array.from(funcTotals.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([name, us]) => ({
      name,
      selfTimeMs: Number((us / 1000).toFixed(2)),
      percentOfTotal: pct(us),
      percentOfActiveCpu: activeJsUs > 0 ? Number(((us / activeJsUs) * 100).toFixed(2)) : 0,
    }));

  return {
    profileFile: path.basename(filePath),
    totalTimeMs: Number((totalTimeUs / 1000).toFixed(2)),
    breakdownPercent: {
      idleWait: pct(idleUs),
      activeJsCpu: pct(activeJsUs),
      garbageCollector: pct(gcUs),
      runtimeProgram: pct(programUs),
    },
    topFunctions,
  };
}

async function waitForServer(baseUrl: string, timeoutMs = 15000): Promise<Record<string, unknown>> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${baseUrl}/version`);
      if (res.ok) return (await res.json()) as Record<string, unknown>;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Server at ${baseUrl} did not start in time`);
}

async function stopServer(child: ChildProcess): Promise<void> {
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve();
    }, 6000);

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

async function main() {
  const tag = process.env.PERF_TAG ?? 'latest';
  const port = Number(process.env.PROFILE_PORT ?? 3102);
  const baseUrl = `http://127.0.0.1:${port}`;
  const outDir = path.resolve('reports/perf');
  const profDir = path.join(outDir, `cpuprof-${tag}`);
  fs.rmSync(profDir, { recursive: true, force: true });
  fs.mkdirSync(profDir, { recursive: true });

  const telemetryFile = path.join(outDir, `profile-telemetry-${tag}.json`);

  console.log(`Starting V8 CPU-profiled server on ${baseUrl} (tag=${tag})...`);
  const server = spawn(
    process.execPath,
    [
      '--cpu-prof',
      `--cpu-prof-dir=${profDir}`,
      '--import',
      './scripts/perf-telemetry.mjs',
      'dist/index.js',
    ],
    {
      env: {
        ...process.env,
        PORT: String(port),
        PERF_TELEMETRY_FILE: telemetryFile,
      },
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    },
  );
  server.stderr?.on('data', () => {});

  let versionInfo: Record<string, unknown> = {};
  let loadResult: autocannon.Result | null = null;
  const exactLatencies: number[] = [];

  try {
    versionInfo = await waitForServer(baseUrl);
    console.log('Profiled /version:', JSON.stringify(versionInfo));

    let seq = 0;
    loadResult = await new Promise<autocannon.Result>((resolve, reject) => {
      const inst = autocannon(
        {
          url: baseUrl,
          connections: 12,
          duration: 12,
          timeout: 15,
          requests: [
            { method: 'GET', path: '/api/schedules' },
            { method: 'GET', path: '/api/schedules' },
            { method: 'GET', path: '/api/appointments' },
            { method: 'GET', path: '/api/doctors' },
            {
              method: 'POST',
              path: '/api/appointments',
              headers: { 'content-type': 'application/json' },
              setupRequest: (req) => {
                const n = seq++;
                return {
                  ...req,
                  headers: {
                    ...req.headers,
                    'idempotency-key': `prof-${tag}-${n}`,
                  },
                  body: JSON.stringify({
                    scheduleId: (n % 500) + 1,
                    patientName: `Profile Patient #${n}`,
                  }),
                };
              },
            },
          ],
        },
        (err, res) => {
          if (err) reject(err);
          else resolve(res);
        },
      );
      inst.on('response', (_c, _s, _b, rt) => {
        exactLatencies.push(rt);
      });
      inst.on('error', reject);
    });
  } finally {
    await stopServer(server);
  }

  exactLatencies.sort((a, b) => a - b);
  const pctLat = (p: number) => {
    if (exactLatencies.length === 0) return 0;
    const idx = Math.min(
      exactLatencies.length - 1,
      Math.max(0, Math.ceil((p / 100) * exactLatencies.length) - 1),
    );
    return Number((exactLatencies[idx] ?? 0).toFixed(2));
  };

  const profFiles = fs.readdirSync(profDir).filter((f) => f.endsWith('.cpuprofile'));
  const cpuProfileAnalysis =
    profFiles.length > 0 && profFiles[0] ? parseCpuProfile(path.join(profDir, profFiles[0])) : null;

  const telemetry = fs.existsSync(telemetryFile)
    ? JSON.parse(fs.readFileSync(telemetryFile, 'utf8'))
    : null;

  const dbReport = await analyzeDatabase(tag);
  await queryClient.end();

  const report = {
    generatedAt: new Date().toISOString(),
    tag,
    nodeVersion: process.version,
    version: versionInfo,
    workloadSummary: loadResult
      ? {
          rpsMean: Number(loadResult.requests.average.toFixed(2)),
          p50Ms: exactLatencies.length > 0 ? pctLat(50) : Number(loadResult.latency.p50.toFixed(2)),
          p95Ms:
            exactLatencies.length > 0 ? pctLat(95) : Number(loadResult.latency.p97_5.toFixed(2)),
          p99Ms: exactLatencies.length > 0 ? pctLat(99) : Number(loadResult.latency.p99.toFixed(2)),
          throughputMbPerSec: Number((loadResult.throughput.average / 1024 / 1024).toFixed(2)),
          status2xx: loadResult['2xx'],
          status4xx: loadResult['4xx'],
          status5xx: loadResult['5xx'],
        }
      : null,
    telemetry,
    cpuProfile: cpuProfileAnalysis,
    database: dbReport,
  };

  const outFile = path.join(outDir, `profile-${tag}.json`);
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2), 'utf8');

  console.log('\n=== V8 CPU Profile (CPU vs Wait) ===');
  if (cpuProfileAnalysis) {
    console.log('  Breakdown (% of total wall samples):', cpuProfileAnalysis.breakdownPercent);
    console.log('  Top hot JS/Node functions:');
    for (const fn of cpuProfileAnalysis.topFunctions.slice(0, 10)) {
      console.log(`    - ${fn.selfTimeMs} ms (${fn.percentOfTotal}% total) :: ${fn.name}`);
    }
  }
  if (telemetry) {
    console.log('  OS Process CPU vs Wait:', telemetry.cpu);
    console.log('  Event Loop:', telemetry.eventLoop);
    console.log('  RAM:', telemetry.memory);
  }
  console.log(`\nSaved combined profile + DB report to ${outFile}`);
}

main().catch((err) => {
  console.error('Profiling failed:', err);
  process.exit(1);
});
