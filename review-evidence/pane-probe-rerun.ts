/**
 * REVIEWER re-run probe (B1) — does toggling a chart SUB-PANE still blank the chart?
 *
 * This is the same distinct-colour / non-background-pixel probe used in the
 * FAIL review, extended to the full matrix: Volume, RSI, MACD on and off
 * individually, plus all three ON and all three OFF at once. It also repeats the
 * check on the Dashboard hero chart (B1 originally hit both charts).
 *
 * Objective signals per state:
 *   - distinct   : distinct RGB colours on the chart canvas (blank == 1)
 *   - nonBg      : pixels that are NOT the chart background colour
 *   - barCount   : the component's own data-bar-count attribute (data on hand)
 *
 * Runs against the REAL production build in dist/ via review-evidence/live-server.ts.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Page } from 'playwright-core';

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

interface Stats {
  distinct: number;
  nonBackground: number;
  w: number;
  h: number;
  missing?: boolean;
}

async function canvasStats(page: Page): Promise<Stats> {
  return page.evaluate(() => {
    const src = document.querySelector('[data-testid="chart-canvas"] canvas') as HTMLCanvasElement | null;
    if (!src) return { distinct: -1, nonBackground: -1, w: 0, h: 0, missing: true };
    const off = document.createElement('canvas');
    off.width = src.width;
    off.height = src.height;
    const ctx = off.getContext('2d')!;
    ctx.drawImage(src, 0, 0);
    const { data } = ctx.getImageData(0, 0, off.width, off.height);
    const seen = new Set<number>();
    let nonBg = 0;
    for (let i = 0; i < data.length; i += 4 * 7) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      seen.add((r << 16) | (g << 8) | b);
      // Chart background is #161b22; count anything meaningfully different.
      if (Math.abs(r - 0x16) > 12 || Math.abs(g - 0x1b) > 12 || Math.abs(b - 0x22) > 12) nonBg += 1;
    }
    return { distinct: seen.size, nonBackground: nonBg, w: src.width, h: src.height };
  });
}

async function main() {
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const dbPath = path.join(tmpdir(), `rr-panes-${Date.now()}.db`);
  const srv: ChildProcess = spawn(
    path.join(ROOT, 'node_modules', '.bin', 'tsx'),
    [path.join(ROOT, 'review-evidence', 'live-server.ts')],
    { cwd: ROOT, env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DB_PATH: dbPath }, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  srv.stderr!.on('data', (d) => process.stdout.write(`[srv:err] ${d}`));
  for (let i = 0; i < 60; i += 1) {
    try {
      if ((await fetch(`${base}/api/health`)).ok) break;
    } catch {}
    await sleep(300);
  }

  const chrome = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(existsSync)!;
  const browser = await chromium.launch({ executablePath: chrome, headless: true, args: ['--hide-scrollbars', '--mute-audio'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  // Clear the persisted pane/overlay prefs before ANY script runs, so we get a
  // single clean page load (no in-flight requests cancelled by a second goto).
  await context.addInitScript(() => {
    try {
      localStorage.clear();
    } catch {}
  });
  const page = await context.newPage();

  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const failedRequests: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  page.on('requestfailed', (r) => failedRequests.push(`${r.url()} ${r.failure()?.errorText ?? ''}`));

  // Clean slate: pane defaults apply deterministically (Volume ON, others OFF).
  await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="chart-screen"], [data-testid="dashboard-screen"]');

  const goChart = async () => {
    await page.locator('nav.nav button', { hasText: /^Chart$/ }).first().click();
    await page.waitForSelector('[data-testid="chart-screen"]');
    await page.waitForFunction(() => Number(document.querySelector('[data-testid="chart-wrap"]')?.getAttribute('data-bar-count') || 0) > 0, null, { timeout: 25000 });
    await page.waitForTimeout(1400);
  };

  /** Wait until the canvas has been stable-populated for 3 consecutive reads. */
  const settle = async (timeoutMs = 5000) => {
    const deadline = Date.now() + timeoutMs;
    let run = 0;
    while (Date.now() < deadline) {
      const s = await canvasStats(page);
      run = s.distinct > 12 && s.nonBackground > 200 ? run + 1 : 0;
      if (run >= 3) return true;
      await sleep(250);
    }
    return false;
  };

  /**
   * Sample 5x over 2s to rule out a transient mid-rebuild frame.
   * A state counts as BLANK only when EVERY frame is a flat canvas (<= 12
   * distinct colours) — the same criterion the FAIL report used. A single low
   * first frame that settles to a real chart is a transient, reported as such.
   */
  const sample = async (label: string) => {
    const frames: number[] = [];
    let nonBg = -1;
    for (let i = 0; i < 5; i += 1) {
      const s = await canvasStats(page);
      frames.push(s.distinct);
      nonBg = s.nonBackground;
      await sleep(400);
    }
    const barCount = await page.locator('[data-testid="chart-wrap"]').getAttribute('data-bar-count');
    const allBlank = frames.every((d) => d <= 12);
    const settled = frames.slice(2).every((d) => d > 12);
    const ok = settled && !allBlank && nonBg > 200;
    const transient = !allBlank && frames.some((d) => d <= 12);
    console.log(
      `  ${label.padEnd(34)} distinct=[${frames.join(', ')}] nonBg=${nonBg} barCount=${barCount}  ${
        ok ? (transient ? 'POPULATED (transient first frame)' : 'POPULATED') : allBlank ? '*** BLANK (persistent) ***' : '*** NOT SETTLED ***'
      }`,
    );
    return { frames, allBlank, nonBg, ok };
  };

  const paneBtn = (label: string) => page.locator('[data-testid="chart-toolbar"] button', { hasText: new RegExp(`^${label}$`) }).first();
  const pressed = async (label: string) => (await paneBtn(label).getAttribute('aria-pressed')) === 'true';
  const clickPane = async (label: string) => {
    await paneBtn(label).click();
    await page.waitForTimeout(700);
  };
  const setPane = async (label: string, want: boolean) => {
    if ((await pressed(label)) !== want) await clickPane(label);
  };

  const results: Array<{ state: string; ok: boolean }> = [];
  const record = (state: string, r: { ok: boolean }) => results.push({ state, ok: r.ok });

  console.log('=== CHART screen — full pane-toggle matrix ===');
  const settledAtBaseline = await settle();
  console.log(`  (settled before sampling: ${settledAtBaseline})`);
  record('baseline (Volume ON)', await sample('BASELINE (defaults)'));

  // Individually: toggle ON then back OFF.
  for (const label of ['Volume', 'RSI', 'MACD'] as const) {
    await setPane(label, false);
    record(`${label} OFF`, await sample(`${label} OFF`));
    await setPane(label, true);
    record(`${label} ON`, await sample(`${label} ON`));
    await setPane(label, false);
    record(`${label} back OFF`, await sample(`${label} back OFF`));
  }

  // All three ON at once.
  for (const label of ['Volume', 'RSI', 'MACD'] as const) await setPane(label, true);
  console.log(`  [pane states: Volume=${await pressed('Volume')} RSI=${await pressed('RSI')} MACD=${await pressed('MACD')}]`);
  record('ALL THREE ON', await sample('ALL THREE ON'));
  await page.screenshot({ path: path.join(ROOT, 'review-evidence', 'rr-panes-all-on.png') });

  // All three OFF at once.
  for (const label of ['Volume', 'RSI', 'MACD'] as const) await setPane(label, false);
  record('ALL THREE OFF', await sample('ALL THREE OFF'));

  // Rapid-fire: the exact "toggle Volume/RSI/MACD" sequence from the FAIL report.
  console.log('\n=== rapid sequence (the FAIL-report click order) ===');
  for (const label of ['RSI', 'MACD', 'Volume', 'RSI', 'MACD'] as const) {
    await clickPane(label);
    record(`rapid ${label}`, await sample(`rapid click ${label}`));
  }
  await page.screenshot({ path: path.join(ROOT, 'review-evidence', 'rr-panes-rapid.png') });

  // Recovery is now irrelevant if nothing breaks; still confirm a reload is clean.
  console.log('\n=== DASHBOARD hero chart — pane toggle must not blank it either ===');
  await page.locator('nav.nav button', { hasText: /^Dashboard$/ }).first().click();
  await page.waitForSelector('[data-testid="dashboard-screen"]');
  await page.waitForFunction(() => Number(document.querySelector('[data-testid="chart-wrap"]')?.getAttribute('data-bar-count') || 0) > 0, null, { timeout: 25000 });
  await page.waitForTimeout(1200);
  await settle();
  record('dashboard baseline', await sample('DASHBOARD baseline'));
  await page.locator('[data-testid="chart-toolbar"] button', { hasText: /^RSI$/ }).first().click();
  await page.waitForTimeout(900);
  record('dashboard RSI ON', await sample('DASHBOARD after RSI'));
  await page.locator('[data-testid="chart-toolbar"] button', { hasText: /^MACD$/ }).first().click();
  await page.waitForTimeout(900);
  record('dashboard MACD ON', await sample('DASHBOARD after MACD'));

  const blanks = results.filter((r) => !r.ok);
  console.log('\n────────────────────────────────────────────────────────────');
  console.log(`console errors=${consoleErrors.length} page exceptions=${pageErrors.length} failed requests=${failedRequests.length}`);
  for (const e of consoleErrors) console.log(`  console: ${e}`);
  for (const e of pageErrors) console.log(`  pageerror: ${e}`);
  for (const e of failedRequests) console.log(`  reqfailed: ${e}`);
  console.log(
    blanks.length === 0
      ? `PANE-TOGGLE VERDICT: RENDERED in all ${results.length}/${results.length} states (B1 RESOLVED)`
      : `PANE-TOGGLE VERDICT: BLANK in ${blanks.length} state(s): ${blanks.map((b) => b.state).join(', ')}`,
  );

  await browser.close();
  srv.kill('SIGTERM');
  process.exit(blanks.length === 0 ? 0 : 1);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
