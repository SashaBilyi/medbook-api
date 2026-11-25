import fs from 'node:fs';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';

const outputPath = process.env.PERF_TELEMETRY_FILE;

if (outputPath) {
  const startWall = performance.now();
  const startCpu = process.cpuUsage();
  let lastElu = performance.eventLoopUtilization();
  const elDelay = monitorEventLoopDelay({ resolution: 10 });
  elDelay.enable();

  const samples = [];

  const captureSample = () => {
    const mem = process.memoryUsage();
    const elu = performance.eventLoopUtilization(lastElu);
    lastElu = performance.eventLoopUtilization();
    samples.push({
      elapsedMs: Number((performance.now() - startWall).toFixed(1)),
      rssMb: Number((mem.rss / 1024 / 1024).toFixed(2)),
      heapUsedMb: Number((mem.heapUsed / 1024 / 1024).toFixed(2)),
      heapTotalMb: Number((mem.heapTotal / 1024 / 1024).toFixed(2)),
      externalMb: Number((mem.external / 1024 / 1024).toFixed(2)),
      eluUtilization: Number((elu.utilization * 100).toFixed(2)),
    });
  };

  captureSample();
  const timer = setInterval(captureSample, 500);
  timer.unref();

  let flushed = false;
  const flush = () => {
    if (flushed) return;
    flushed = true;
    clearInterval(timer);
    captureSample();
    elDelay.disable();

    const wallMs = performance.now() - startWall;
    const cpuDelta = process.cpuUsage(startCpu);
    const cpuTotalMs = (cpuDelta.user + cpuDelta.system) / 1000;
    const cpuPercent = wallMs > 0 ? (cpuTotalMs / wallMs) * 100 : 0;
    const totalElu = performance.eventLoopUtilization();

    const peakRssMb = Math.max(...samples.map((s) => s.rssMb));
    const peakHeapUsedMb = Math.max(...samples.map((s) => s.heapUsedMb));
    const startRssMb = samples[0]?.rssMb ?? 0;
    const endRssMb = samples[samples.length - 1]?.rssMb ?? 0;
    const startHeapUsedMb = samples[0]?.heapUsedMb ?? 0;
    const endHeapUsedMb = samples[samples.length - 1]?.heapUsedMb ?? 0;

    const payload = {
      wallMs: Number(wallMs.toFixed(1)),
      cpu: {
        userMs: Number((cpuDelta.user / 1000).toFixed(2)),
        systemMs: Number((cpuDelta.system / 1000).toFixed(2)),
        totalCpuMs: Number(cpuTotalMs.toFixed(2)),
        cpuUtilizationPercent: Number(cpuPercent.toFixed(2)),
        waitOrIdlePercent: Number(Math.max(0, 100 - cpuPercent).toFixed(2)),
      },
      eventLoop: {
        utilizationPercent: Number((totalElu.utilization * 100).toFixed(2)),
        activeMs: Number(totalElu.active.toFixed(2)),
        idleMs: Number(totalElu.idle.toFixed(2)),
        delayP50Ms: Number((elDelay.percentile(50) / 1e6).toFixed(2)),
        delayP95Ms: Number((elDelay.percentile(95) / 1e6).toFixed(2)),
        delayP99Ms: Number((elDelay.percentile(99) / 1e6).toFixed(2)),
        delayMaxMs: Number((elDelay.max / 1e6).toFixed(2)),
      },
      memory: {
        startRssMb,
        peakRssMb,
        endRssMb,
        startHeapUsedMb,
        peakHeapUsedMb,
        endHeapUsedMb,
        sampleCount: samples.length,
      },
      samples,
    };

    fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2), 'utf8');
  };

  process.on('beforeExit', flush);
  process.on('exit', flush);
  process.on('message', (msg) => {
    if (msg === 'PERF_SHUTDOWN') {
      flush();
      process.exit(0);
    }
  });
  process.on('SIGINT', () => {
    flush();
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    flush();
    process.exit(0);
  });
}
