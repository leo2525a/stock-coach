/**
 * REVIEWER edge probe — pane toggles must survive the paths the FAIL report
 * cared about:
 *   A) the STALE / provider-outage path (SPEC §7): toggling RSI/MACD on a
 *      stale-cache series must keep the chart populated.
 *   B) after a forced refresh (data replaced under the chart).
 *   C) rapid double-toggles of the same pane (rebuild in flight).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Page } from 'playwright-core';
import { openDb, saveCandles, saveMeta, recordFetch } from '../server/db';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const freePort = () =>
  new Promise<number>((res, rej) => {
    const s = createServer();
    s.on('error', rej);
    s.listen(0, '127.0.0.1', () => {
      const p = (s.address() as any).port;
      s.close(() => res(p));
    });
  });

let pass = 0;
const fails: string[] = [];
const check = (n: string, c: boolean, d = '') => {
  if (c) {
    pass += 1;
    console.log(`  ✓ ${n}${d ? ` — ${d}` : ''}`);
  } else {
    fails.push(`${n}${d ? ` — ${d}` : ''}`);
    console.log(`  ✗ ${n}${d ? ` — ${d}` : ''}`);
  }
};

function boot(entry: string, port: number, dbPath: string): ChildProcess {
  const p = spawn(path.join(ROOT, 'node_modules', '.bin', 'tsx'), [path.join(ROOT, 'review-evidence', entry)], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DB_PATH: dbPath },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  p.stderr!.on('data', (d) => process.stdout.write(`[srv:err] ${d}`));
  return p;
}
async function waitHealth(base: string, ms = 25_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      if ((await fetch(`${base}/api/health`)).ok) return true;
    } catch {}
    await sleep(300);
  }
  return false;
}
async function stats(page: Page) {
  return page.evaluate(() => {
    const src = document.querySelector('[data-testid="chart-canvas"] canvas') as HTMLCanvasElement | null;
    if (!src) return { distinct: -1, nonBg: -1 };
    const off = document.createElement('canvas');
    off.width = src.width;
    off.height = src.height;
    const ctx = off.getContext('2d')!;
    ctx.drawImage(src, 0, 0);
    const { data } = ctx.getImageData(0, 0, off.width, off.height);
    const seen = new Set<number>();
    let nonBg = 0;
    for (let i = 0; i < data.length; i += 4 * 7) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      seen.add((r << 16) | (g << 8) | b);
      if (Math.abs(r - 0x16) > 12 || Math.abs(g - 0x1b) > 12 || Math.abs(b - 0x22) > 12) nonBg += 1;
    }
    return { distinct: seen.size, nonBg };
  });
}
const populated = (s: { distinct: number; nonBg: number }) => s.distinct > 12 && s.nonBg > 200;

async function main() {
  const tmp = mkdtempSync(path.join(tmpdir(), 'rr-edge-'));
  const livePort = await freePort();
  const liveBase = `http://127.0.0.1:${livePort}`;
  const live = boot('live-server.ts', livePort, path.join(tmp, 'live.db'));
  check('live API came up', await waitHealth(liveBase));

  const chrome = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(existsSync)!;
  const browser = await chromium.launch({ executablePath: chrome, headless: true, args: ['--hide-scrollbars'] });

  try {
    /* -------- C) rapid double-toggle on the LIVE chart -------- */
    console.log('\nC) rapid double-toggle / rebuild-in-flight (live)');
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
    await ctx.addInitScript(() => {
      try { localStorage.clear(); } catch {}
    });
    const page = await ctx.newPage();
    const errs: string[] = [];
    page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
    page.on('pageerror', (e) => errs.push('pageerror: ' + e));
    await page.goto(`${liveBase}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="dashboard-screen"]', { timeout: 25_000 });
    await page.locator('nav.nav button', { hasText: /^Chart$/ }).first().click();
    await page.waitForSelector('[data-testid="chart-screen"]');
    await page.waitForFunction(() => Number(document.querySelector('[data-testid="chart-wrap"]')?.getAttribute('data-bar-count') || 0) > 0, null, { timeout: 25_000 });
    await page.waitForTimeout(1200);

    const pane = (l: string) => page.locator('[data-testid="chart-toolbar"] button', { hasText: new RegExp(`^${l}$`) }).first();
    // Two clicks back-to-back with no wait → ON then OFF quickly.
    await pane('RSI').click();
    await pane('RSI').click();
    await page.waitForTimeout(1200);
    check('rapid RSI on/off keeps the chart populated', populated(await stats(page)), JSON.stringify(await stats(page)));
    await pane('MACD').click();
    await pane('MACD').click();
    await page.waitForTimeout(1200);
    check('rapid MACD on/off keeps the chart populated', populated(await stats(page)), JSON.stringify(await stats(page)));

    // B) forced refresh after a pane is ON.
    await pane('RSI').click();
    await page.waitForTimeout(900);
    await page.locator('[data-testid="chart-toolbar"] button', { hasText: /^⟳ Refresh$/ }).first().click();
    await page.waitForTimeout(3000);
    check('forced refresh with RSI pane ON keeps the chart populated', populated(await stats(page)), JSON.stringify(await stats(page)));
    check('live edge walk produced zero console errors', errs.length === 0, `${errs.length} ${errs.slice(0, 2).join(' | ')}`);
    await ctx.close();

    /* -------- A) stale path + pane toggle -------- */
    console.log('\nA) STALE / provider-outage path + pane toggle');
    const offPort = await freePort();
    const offBase = `http://127.0.0.1:${offPort}`;
    const dbPath = path.join(tmp, 'offline.db');
    const first = boot('offline-server.ts', offPort, dbPath);
    check('offline API came up', await waitHealth(offBase));
    first.kill('SIGTERM');
    await sleep(700);
    const lm = (await fetch(`${liveBase}/api/market/AAPL?range=max&interval=1d`).then((r) => r.json())).data;
    {
      const db = openDb(dbPath);
      saveCandles(db, 'AAPL', '1d', lm.candles);
      saveMeta(db, lm.meta, Math.floor(Date.now() / 1000));
      recordFetch(db, 'AAPL', '1d', Math.floor(Date.now() / 1000) - 30 * 86400, 'live', lm.candles.length, '10y', lm.meta);
      db.close();
    }
    const off2 = boot('offline-server.ts', offPort, dbPath);
    check('offline API restarted (warm expired cache)', await waitHealth(offBase));

    const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 950 } });
    const p2 = await ctx2.newPage();
    const errs2: string[] = [];
    p2.on('console', (m) => { if (m.type() === 'error') errs2.push(m.text()); });
    p2.on('pageerror', (e) => errs2.push('pageerror: ' + e));
    await p2.goto(`${offBase}/`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await p2.waitForSelector('[data-testid="dashboard-screen"]', { timeout: 25_000 });
    await p2.waitForFunction(() => Number(document.querySelector('[data-testid="chart-wrap"]')?.getAttribute('data-bar-count') || 0) > 0, null, { timeout: 25_000 }).catch(() => {});
    await p2.waitForTimeout(2500);
    const badge = (await p2.locator('[data-testid="source-badge"]').first().innerText().catch(() => '')).trim();
    check('series is on the stale path', /stale|⚠/i.test(badge), badge || '(empty)');
    const before = await stats(p2);
    check('stale chart is populated before toggling', populated(before), JSON.stringify(before));

    const pane2 = (l: string) => p2.locator('[data-testid="chart-toolbar"] button', { hasText: new RegExp(`^${l}$`) }).first();
    await pane2('RSI').click();
    await p2.waitForTimeout(1100);
    const rsiSt = await stats(p2);
    check('stale + RSI pane ON keeps the chart populated', populated(rsiSt), JSON.stringify(rsiSt));
    await pane2('MACD').click();
    await p2.waitForTimeout(1100);
    const macdSt = await stats(p2);
    check('stale + MACD pane ON keeps the chart populated', populated(macdSt), JSON.stringify(macdSt));
    check('stale pane toggles produced zero console errors', errs2.length === 0, `${errs2.length} ${errs2.slice(0, 2).join(' | ')}`);
    await p2.screenshot({ path: path.join(ROOT, 'review-evidence', 'rr-edge-stale-panes.png') });
    await ctx2.close();
    off2.kill('SIGTERM');
  } catch (err) {
    fails.push(`harness error: ${(err as Error).message}`);
    console.error('harness error:', err);
  } finally {
    await browser.close().catch(() => {});
    live.kill('SIGTERM');
  }

  console.log('\n' + '─'.repeat(60));
  if (fails.length === 0) {
    console.log(`EDGE CHECKS PASSED — ${pass}`);
    process.exit(0);
  }
  console.log(`EDGE CHECKS FAILED — ${pass} passed, ${fails.length} failed`);
  for (const f of fails) console.log('   • ' + f);
  process.exit(1);
}
main().catch((e) => {
  console.error('fatal', e);
  process.exit(1);
});
