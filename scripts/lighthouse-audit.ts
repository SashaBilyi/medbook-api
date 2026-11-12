/* eslint-disable no-console */
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import * as chromeLauncher from 'chrome-launcher';
import lighthouse from 'lighthouse';

async function waitForServer(baseUrl: string, timeoutMs = 15000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${baseUrl}/api/health`);
      if (res.ok) return;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Server at ${baseUrl} did not start`);
}

function stopServer(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve();
    }, 4000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill('SIGTERM');
  });
}

async function main() {
  const tag = process.env.PERF_TAG ?? 'latest';
  const port = Number(process.env.LH_PORT ?? 3103);
  const targetUrl = `http://127.0.0.1:${port}/ui`;
  const outDir = path.resolve('reports/perf');
  fs.mkdirSync(outDir, { recursive: true });

  console.log(`Starting server for Lighthouse audit at ${targetUrl} (tag=${tag})...`);
  const server = spawn(process.execPath, ['dist/index.js'], {
    env: { ...process.env, PORT: String(port) },
    stdio: 'ignore',
  });

  let chrome: chromeLauncher.LaunchedChrome | null = null;

  try {
    await waitForServer(`http://127.0.0.1:${port}`);

    chrome = await chromeLauncher.launch({
      chromeFlags: ['--headless=new', '--no-sandbox', '--disable-gpu'],
    });

    const runnerResult = await lighthouse(targetUrl, {
      port: chrome.port,
      output: ['json', 'html'],
      logLevel: 'error',
      onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo'],
      formFactor: 'desktop',
      screenEmulation: {
        mobile: false,
        width: 1350,
        height: 940,
        deviceScaleFactor: 1,
        disabled: false,
      },
      throttlingMethod: 'simulate',
    });

    if (!runnerResult || !runnerResult.lhr) {
      throw new Error('Lighthouse returned empty result');
    }

    const lhr = runnerResult.lhr;
    const reports = Array.isArray(runnerResult.report)
      ? runnerResult.report
      : [runnerResult.report];
    if (reports[0]) {
      fs.writeFileSync(path.join(outDir, `lighthouse-${tag}.json`), reports[0], 'utf8');
    }
    if (reports[1]) {
      fs.writeFileSync(path.join(outDir, `lighthouse-${tag}.html`), reports[1], 'utf8');
    }

    const audits = lhr.audits;
    const summary = {
      tag,
      url: targetUrl,
      generatedAt: new Date().toISOString(),
      scores: {
        performance: Math.round((lhr.categories.performance?.score ?? 0) * 100),
        accessibility: Math.round((lhr.categories.accessibility?.score ?? 0) * 100),
        bestPractices: Math.round((lhr.categories['best-practices']?.score ?? 0) * 100),
        seo: Math.round((lhr.categories.seo?.score ?? 0) * 100),
      },
      webVitals: {
        ttfbMs: Math.round(audits['server-response-time']?.numericValue ?? 0),
        fcpMs: Math.round(audits['first-contentful-paint']?.numericValue ?? 0),
        lcpMs: Math.round(audits['largest-contentful-paint']?.numericValue ?? 0),
        tbtMs: Math.round(audits['total-blocking-time']?.numericValue ?? 0),
        cls: Number((audits['cumulative-layout-shift']?.numericValue ?? 0).toFixed(4)),
        speedIndexMs: Math.round(audits['speed-index']?.numericValue ?? 0),
      },
      diagnostics: {
        domSize: audits['dom-size']?.displayValue ?? null,
        totalByteWeight: audits['total-byte-weight']?.displayValue ?? null,
        totalByteWeightBytes: Math.round(audits['total-byte-weight']?.numericValue ?? 0),
        renderBlocking: audits['render-blocking-resources']?.displayValue ?? null,
        mainThreadWork: audits['mainthread-work-breakdown']?.displayValue ?? null,
      },
      failedAudits: Object.values(audits)
        .filter((a) => a.score !== null && a.score < 0.9)
        .map((a) => ({
          id: a.id,
          title: a.title,
          score: a.score,
          displayValue: a.displayValue ?? null,
        }))
        .slice(0, 20),
    };

    const summaryPath = path.join(outDir, `lighthouse-summary-${tag}.json`);
    fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), 'utf8');

    console.log('\n=== Lighthouse Summary ===');
    console.log('  Scores:', summary.scores);
    console.log('  Web Vitals:', summary.webVitals);
    console.log('  Diagnostics:', summary.diagnostics);
    console.log('  Top issues (< 0.9):');
    for (const item of summary.failedAudits) {
      console.log(`    - [${item.score}] ${item.id}: ${item.title} (${item.displayValue ?? 'n/a'})`);
    }
    console.log(`\nSaved Lighthouse summary to ${summaryPath}`);
  } finally {
    if (chrome) {
      await chrome.kill();
    }
    await stopServer(server);
  }
}

main().catch((err) => {
  console.error('Lighthouse audit failed:', err);
  process.exit(1);
});
