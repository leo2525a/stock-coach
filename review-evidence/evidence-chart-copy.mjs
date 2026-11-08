#!/usr/bin/env node
/**
 * Real-browser evidence for the Phase 1 acceptance bar.
 *
 * SPEC §3 requires that a real ticker with a real candlestick chart loads and
 * that the app produces **zero console errors**. Unit tests and curl cannot
 * prove either of those, so this script:
 *
 *   1. bundles the Express server with esbuild and boots it against a
 *      throwaway SQLite database (so the user's real cache is untouched),
 *   2. waits for /api/health,
 *   3. drives the *production build* in headless Chrome over CDP,
 *   4. walks all five SPEC §5 screens and asserts each one actually rendered,
 *   5. captures every console message / page error / failed request,
 *   6. writes screenshots + a JSON report to evidence/.
 *
 * Exit code is 0 only when every check passes and the console is clean.
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const EVIDENCE_DIR = path.join(ROOT, "review-evidence", "rerun-evidence");
const WORK_DIR = path.join(EVIDENCE_DIR, '.work');
const DIST_DIR = path.join(ROOT, 'dist');

const SYMBOL = 'AAPL';
const VIEWPORT = { width: 1440, height: 950 };

/* ------------------------------------------------------------------ checks */

let passed = 0;
const failures = [];

function check(label, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ''}`);
  } else {
    failures.push(label);
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
    if (process.env.EVIDENCE_VERBOSE) console.error(new Error('stack').stack);
  }
}

function section(name) {
  console.log(`\n${name}`);
}

/* ------------------------------------------------------------- server boot */

async function bundleServer() {
  const outfile = path.join(WORK_DIR, 'server.mjs');
  const result = await spawnCapture(
    path.join(ROOT, 'node_modules', '.bin', 'esbuild'),
    [
      path.join(ROOT, 'server', 'index.ts'),
      '--bundle',
      '--platform=node',
      '--target=node22',
      '--format=esm',
      '--outfile=' + outfile,
      '--packages=external',
      // `import.meta.url` is read at module scope in server/index.ts and
      // server/app.ts to locate the project root and ../dist. A bundled copy
      // would resolve those against evidence/.work and look for evidence/dist,
      // so pin it to the on-disk entry file instead.
      `--define:import.meta.url=${JSON.stringify('file://' + path.join(ROOT, 'server', 'index.ts'))}`,
    ],
    ROOT,
  );
  if (result.code !== 0) throw new Error(`esbuild failed:\n${result.stderr || result.stdout}`);
  return outfile;
}

function spawnCapture(cmd, args, cwd) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

async function waitForHealth(baseUrl, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  let lastErr = 'no attempt';
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/api/health`);
      if (res.ok) return (await res.json()).data;
      lastErr = `HTTP ${res.status}`;
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
    }
    await sleep(250);
  }
  throw new Error(`server never became healthy: ${lastErr}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Ask the OS for a free port by binding one, then releasing it. */
async function freePort() {
  const { createServer } = await import('node:net');
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

/* --------------------------------------------------------------- the run */

async function main() {
  if (!existsSync(DIST_DIR)) {
    console.error('dist/ is missing — run `npm run build` first.');
    process.exit(1);
  }

  rmSync(WORK_DIR, { recursive: true, force: true });
  mkdirSync(WORK_DIR, { recursive: true });

  console.log('bundling server…');
  const serverBundle = await bundleServer();

  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const dbPath = path.join(WORK_DIR, 'evidence.db');

  const server = spawn(process.execPath, [serverBundle], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      DB_PATH: dbPath,
      NODE_ENV: 'production',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverLog = '';
  server.stdout.on('data', (d) => (serverLog += d));
  server.stderr.on('data', (d) => (serverLog += d));

  let browser;
  try {
    const health = await waitForHealth(baseUrl);
    console.log(`server up on ${baseUrl} (${health.service})`);

    /* ------------------------------ launch Chrome ------------------------- */
    const executablePath = process.env.CHROME_PATH || findChrome();
    if (!executablePath) throw new Error('no Chrome binary found; set CHROME_PATH');
    console.log(`chrome: ${executablePath}`);

    browser = await chromium.launch({
      executablePath,
      headless: true,
      args: ['--hide-scrollbars', '--mute-audio'],
    });

    const consoleErrors = [];
    const consoleWarnings = [];
    const pageErrors = [];
    const failedRequests = [];

    const context = await browser.newContext({ viewport: VIEWPORT });
    const page = await context.newPage();

    page.on('console', (msg) => {
      const text = `${msg.text()}`;
      const loc = msg.location();
      const where = loc?.url ? ` (${loc.url}:${loc.lineNumber})` : '';
      if (msg.type() === 'error') consoleErrors.push(`${text}${where}`);
      else if (msg.type() === 'warning') consoleWarnings.push(`${text}${where}`);
    });
    page.on('pageerror', (err) => pageErrors.push(err.message));
    page.on('requestfailed', (req) => {
      failedRequests.push(`${req.method()} ${req.url()} — ${req.failure()?.errorText ?? 'unknown'}`);
    });

    /* ------------------------------ load app ------------------------------ */
    section('app boot');
    const resp = await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    check('index.html is served', resp?.status() === 200, `HTTP ${resp?.status()}`);
    check('the app shell renders', (await page.locator('header.topbar').count()) > 0);
    check('the backend-down fallback is NOT shown', (await page.locator('[data-testid="backend-down"]').count()) === 0);

    // Dashboard is the default screen and must show live AAPL data.
    await page.waitForSelector('[data-testid="dashboard-screen"]', { timeout: 20_000 });
    await page.waitForFunction(
      () => document.querySelector('[data-testid="topbar-symbol"] .sym')?.textContent?.trim() === 'AAPL',
      null,
      { timeout: 20_000 },
    );
    await page.waitForFunction(
      () => {
        const el = document.querySelector('[data-testid="topbar-price"] .last');
        return !!el && /\d/.test(el.textContent || '');
      },
      null,
      { timeout: 20_000 },
    );

    const topSymbol = (await page.locator('[data-testid="topbar-symbol"] .sym').innerText()).trim();
    const topPrice = (await page.locator('[data-testid="topbar-price"] .last').innerText()).trim();
    check('the default ticker is a real one', topSymbol === SYMBOL, topSymbol);
    check('a real price is displayed', /\$?\d+\.\d{2}/.test(topPrice), topPrice);

    const sourceBadge = (await page.locator('[data-testid="source-badge"]').first().innerText().catch(() => '')).trim();
    check('data provenance is shown to the user', sourceBadge.length > 0, sourceBadge);

    await page.screenshot({ path: path.join(EVIDENCE_DIR, '01-dashboard.png'), fullPage: true });

    /* ------------------------------ chart screen -------------------------- */
    section('chart screen — real candles');
    await clickNav(page, 'Chart');
    await page.waitForSelector('[data-testid="chart-screen"]', { timeout: 20_000 });
    await page.waitForFunction(
      () => {
        const el = document.querySelector('[data-testid="chart-wrap"]');
        return !!el && Number(el.getAttribute('data-bar-count') || '0') > 0;
      },
      null,
      { timeout: 25_000 },
    );

    const barCount = Number(await page.locator('[data-testid="chart-wrap"]').getAttribute('data-bar-count'));
    check('the chart received a real number of bars', barCount >= 100, `${barCount} bars`);

    // lightweight-charts renders into a real <canvas>; assert it has pixels.
    const canvasInfo = await page.evaluate(() => {
      const c = document.querySelector('[data-testid="chart-canvas"] canvas');
      if (!c) return null;
      const r = c.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height), bw: c.width, bh: c.height };
    });
    check('a <canvas> exists inside the chart host', canvasInfo !== null);
    check(
      'the canvas has a real, non-zero size',
      !!canvasInfo && canvasInfo.w > 200 && canvasInfo.h > 150,
      canvasInfo ? `${canvasInfo.w}x${canvasInfo.h} css / ${canvasInfo.bw}x${canvasInfo.bh} px` : 'none',
    );

    // Prove the canvas is not blank: sample its pixels and require a spread of
    // distinct colours — an empty chart would be a single flat colour.
    //
    // lightweight-charts draws on a <canvas>, which is readable here because it
    // is same-origin and not tainted by cross-origin images.
    const pixelStats = await page.evaluate(() => {
      const src = document.querySelector('[data-testid="chart-canvas"] canvas');
      if (!src) return null;
      const off = document.createElement('canvas');
      off.width = src.width;
      off.height = src.height;
      const ctx = off.getContext('2d');
      ctx.drawImage(src, 0, 0);
      const { data } = ctx.getImageData(0, 0, off.width, off.height);
      const seen = new Set();
      let nonBackground = 0;
      for (let i = 0; i < data.length; i += 4 * 17) {
        const key = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
        seen.add(key);
        if (data[i + 3] > 0 && !(data[i] > 245 && data[i + 1] > 245 && data[i + 2] > 245)) nonBackground += 1;
      }
      return { distinct: seen.size, nonBackground };
    });
    check('the chart canvas is not blank', !!pixelStats && pixelStats.distinct > 12, pixelStats ? `${pixelStats.distinct} distinct colours` : 'unreadable');
    check(
      'the chart actually drew a price series',
      !!pixelStats && pixelStats.nonBackground > 200,
      pixelStats ? `${pixelStats.nonBackground} non-background samples` : 'unreadable',
    );

    const attr = (await page.locator('.chart-attr').first().innerText().catch(() => '')).trim();
    check('the chart labels its bar count and last price', /bars/i.test(attr) && /last/i.test(attr), attr);

    const legendInitial = (await page.locator('[data-testid="ohlc-legend"]').innerText()).trim();
    check(
      'the OHLC legend shows the latest candle at rest',
      /O\s*\d/.test(legendInitial) && /C\s*\d/.test(legendInitial),
      legendInitial.replace(/\n/g, ' ').slice(0, 72),
    );

    // Hovering the chart must update the legend with that candle's OHLC.
    const box = await page.locator('[data-testid="chart-canvas"]').boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.5);
      await page.waitForTimeout(350);
    }
    const legendHover = (await page.locator('[data-testid="ohlc-legend"]').innerText()).trim();
    check('hovering the chart reveals that candle’s OHLC', /O|H|L|C/i.test(legendHover) && legendHover !== legendInitial.trim(), legendHover.slice(0, 64));

    await page.screenshot({ path: path.join(EVIDENCE_DIR, '02-chart.png') });

    // Switch the timeframe — the window must reload with different bar counts.
    const before = Number(await page.locator('[data-testid="chart-wrap"]').getAttribute('data-bar-count'));
    await clickButton(page, /^1M$/);
    await page.waitForFunction(
      (prev) => {
        const el = document.querySelector('[data-testid="chart-wrap"]');
        return !!el && Number(el.getAttribute('data-bar-count') || '0') !== prev && Number(el.getAttribute('data-bar-count') || '0') > 0;
      },
      before,
      { timeout: 25_000 },
    );
    const after = Number(await page.locator('[data-testid="chart-wrap"]').getAttribute('data-bar-count'));
    check('switching the timeframe reloads the chart', after !== before && after > 0, `${before} → ${after} bars`);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, '03-chart-1m.png') });

    // And back to a long window.
    await clickButton(page, /^1Y$/);
    await page.waitForFunction(
      (prev) => {
        const el = document.querySelector('[data-testid="chart-wrap"]');
        return !!el && Number(el.getAttribute('data-bar-count') || '0') !== prev;
      },
      after,
      { timeout: 25_000 },
    );
    const back = Number(await page.locator('[data-testid="chart-wrap"]').getAttribute('data-bar-count'));
    check('a longer window brings back more history', back > after, `${after} → ${back} bars`);

    /* ------------------- sub-pane toggles (B1 regression) ------------------ */
    section('sub-pane toggles — the chart must stay populated (B1 regression)');

    // Sample the chart canvas and report how many distinct colours it has and
    // how much of it is non-background. A blank chart collapses to ~1 colour.
    const sampleCanvas = async () =>
      page.evaluate(() => {
        const src = document.querySelector('[data-testid="chart-canvas"] canvas');
        if (!src) return null;
        const off = document.createElement('canvas');
        off.width = src.width;
        off.height = src.height;
        const ctx = off.getContext('2d');
        ctx.drawImage(src, 0, 0);
        const { data } = ctx.getImageData(0, 0, off.width, off.height);
        const seen = new Set();
        let nonBackground = 0;
        for (let i = 0; i < data.length; i += 4 * 17) {
          seen.add((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
          if (data[i + 3] > 0) nonBackground += 1;
        }
        return { distinct: seen.size, nonBackground };
      });

    const paneButton = (label) =>
      page.locator('.chart-toolbar button', { hasText: new RegExp(`^${label}$`) }).first();

    const base = await sampleCanvas();
    check('the chart is populated before any pane toggle', !!base && base.distinct > 12, base ? `${base.distinct} colours` : 'unreadable');

    // Read the current pressed state, then walk each pane through both states.
    // Asserting on the observed flip — rather than assuming a starting value —
    // keeps this honest: pane choices persist in localStorage, and Volume starts
    // ON by default.
    const paneState = async (label) => (await paneButton(label).getAttribute('aria-pressed')) === 'true';

    for (const pane of ['Volume', 'RSI', 'MACD']) {
      const startPressed = await paneState(pane);

      await paneButton(pane).click();
      await page.waitForTimeout(700);
      const first = await paneState(pane);
      check(`${pane} toggle flips its state`, first !== startPressed, `${startPressed} → ${first}`);
      const s1 = await sampleCanvas();
      check(
        `${pane} ${first ? 'ON' : 'OFF'} — the chart is still populated`,
        !!s1 && s1.distinct > 12 && s1.nonBackground > 200,
        s1 ? `${s1.distinct} colours, ${s1.nonBackground} non-bg` : 'unreadable',
      );
      if (first) {
        await page.screenshot({ path: path.join(EVIDENCE_DIR, `08-pane-${pane.toLowerCase()}-on.png`) });
      }

      await paneButton(pane).click();
      await page.waitForTimeout(700);
      const second = await paneState(pane);
      check(`${pane} toggles back`, second === startPressed, `${first} → ${second}`);
      const s2 = await sampleCanvas();
      check(
        `${pane} ${second ? 'ON' : 'OFF'} — the chart is still populated`,
        !!s2 && s2.distinct > 12 && s2.nonBackground > 200,
        s2 ? `${s2.distinct} colours, ${s2.nonBackground} non-bg` : 'unreadable',
      );
    }

    // All three ON at once, then all three OFF — the multi-pane layout is the
    // worst case for the empty-rebuild bug.
    for (const pane of ['Volume', 'RSI', 'MACD']) {
      if (!(await paneState(pane))) {
        await paneButton(pane).click();
        await page.waitForTimeout(250);
      }
    }
    await page.waitForTimeout(900);
    const allThree = await Promise.all(['Volume', 'RSI', 'MACD'].map((p) => paneState(p)));
    check('all three panes can be on at once', allThree.every(Boolean), allThree.join(','));
    const allOn = await sampleCanvas();
    check(
      'all three panes ON — the chart is still populated',
      !!allOn && allOn.distinct > 12 && allOn.nonBackground > 200,
      allOn ? `${allOn.distinct} colours, ${allOn.nonBackground} non-bg` : 'unreadable',
    );
    const barsAllOn = Number(await page.locator('[data-testid="chart-wrap"]').getAttribute('data-bar-count'));
    check('the bar count survives the pane toggles', barsAllOn === back, `${barsAllOn} bars`);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, '09-panes-all-on.png') });

    for (const pane of ['Volume', 'RSI', 'MACD']) {
      if (await paneState(pane)) {
        await paneButton(pane).click();
        await page.waitForTimeout(250);
      }
    }
    await page.waitForTimeout(900);
    const allOff = await sampleCanvas();
    check(
      'all three panes OFF — the chart is still populated',
      !!allOff && allOff.distinct > 12 && allOff.nonBackground > 200,
      allOff ? `${allOff.distinct} colours, ${allOff.nonBackground} non-bg` : 'unreadable',
    );

    // And it must still be populated after a further data refresh.
    await page.locator('.chart-toolbar button', { hasText: /^\u27f3 Refresh$/ }).first().click();
    await page.waitForTimeout(2500);
    const afterRefresh = await sampleCanvas();
    check(
      'the chart is still populated after a refresh',
      !!afterRefresh && afterRefresh.distinct > 12 && afterRefresh.nonBackground > 200,
      afterRefresh ? `${afterRefresh.distinct} colours, ${afterRefresh.nonBackground} non-bg` : 'unreadable',
    );

    // Toggling the interval must keep the bars visible and never go blank.
    await page.locator('.chart-toolbar button', { hasText: /^1H$/ }).first().click();
    await page.waitForTimeout(2500);
    const intraday = await sampleCanvas();
    check(
      'switching to an intraday interval keeps the chart populated',
      !!intraday && intraday.distinct > 12 && intraday.nonBackground > 200,
      intraday ? `${intraday.distinct} colours, ${intraday.nonBackground} non-bg` : 'unreadable',
    );
    // Back to Auto so the interval follows the range again.
    await page.locator('.chart-toolbar button', { hasText: /^Auto$/ }).first().click();
    await page.waitForTimeout(2500);
    const daily = await sampleCanvas();
    check(
      'returning to the automatic daily interval keeps the chart populated',
      !!daily && daily.distinct > 12 && daily.nonBackground > 200,
      daily ? `${daily.distinct} colours, ${daily.nonBackground} non-bg` : 'unreadable',
    );
    // Restore the default view (Volume on) so later screenshots match.
    if (!(await paneState('Volume'))) {
      await paneButton('Volume').click();
      await page.waitForTimeout(400);
    }
    check('the pane state survives the interval changes', await paneState('Volume'));

    /* ------------------------------ signals ------------------------------- */
    section('signals screen');
    await clickNav(page, 'Signals');
    await page.waitForSelector('[data-testid="signals-screen"]', { timeout: 20_000 });
    await page.waitForFunction(
      () => document.querySelectorAll('[data-testid^="signal-"]').length >= 6,
      null,
      { timeout: 25_000 },
    );
    const signalCount = await page.locator('[data-testid^="signal-"]').count();
    check('every rule renders a card', signalCount >= 6, `${signalCount} cards`);

    const summaryText = (await page.locator('[data-testid="summary-banner"]').innerText()).trim();
    check('the summary banner shows a verdict', summaryText.length > 0, summaryText.split('\n')[0].slice(0, 60));

    const cardText = (await page.locator('[data-testid^="signal-"]').first().innerText()).trim();
    check('a signal card explains itself in plain language', cardText.length > 40, `${cardText.length} chars`);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, '04-signals.png'), fullPage: true });

    /* ------------------------------ watchlist ----------------------------- */
    section('watchlist screen');
    await clickNav(page, 'Watchlist');
    await page.waitForSelector('[data-testid="watchlist-screen"]', { timeout: 20_000 });
    await page.waitForSelector('[data-testid="watchlist-manage"] .wl-manage-row', { timeout: 20_000 });
    const wlRows = await page.locator('[data-testid="watchlist-manage"] .wl-manage-row').count();
    check('the watchlist lists rows', wlRows >= 1, `${wlRows} rows`);
    const firstRow = (await page.locator('[data-testid="watchlist-manage"] .wl-manage-row').first().innerText()).trim();
    check('a watchlist row shows a ticker', /[A-Z]{1,5}/.test(firstRow), firstRow.split('\n')[0]);
    check('a watchlist row shows a price', /\d+\.\d{2}/.test(firstRow), firstRow.replace(/\n/g, ' ').slice(0, 60));
    await page.screenshot({ path: path.join(EVIDENCE_DIR, '05-watchlist.png'), fullPage: true });

    /* ------------------------------ dashboard + help ---------------------- */
    section('remaining screens');
    await clickNav(page, 'Dashboard');
    await page.waitForSelector('[data-testid="dashboard-screen"]', { timeout: 15_000 });
    check('the dashboard screen is reachable', true);
    check('the movers strip renders', (await page.locator('[data-testid="mover-strip"]').count()) === 1);

    // N2: tapping a mover tile must NOT slide the headline ticker/price away
    // from the chart the user is looking at.
    const movers = page.locator('[data-testid="mover-strip"] .mover');
    const moverCount = await movers.count();
    check('the mover strip has tiles', moverCount >= 2, `${moverCount} tiles`);
    if (moverCount >= 2) {
      const other = movers.nth(1);
      const otherSymbol = (await other.getAttribute('data-symbol')) ?? '';
      const headlineBefore = (await page.locator('[data-testid="topbar-symbol"] .sym').innerText()).trim();
      await other.locator('.m-sym').click();
      await page.waitForTimeout(900);
      const headlineAfter = (await page.locator('[data-testid="topbar-symbol"] .sym').innerText()).trim();
      check(
        'clicking a mover tile does not change the headline symbol',
        headlineAfter === headlineBefore,
        `${headlineBefore} → ${headlineAfter} (tile was ${otherSymbol})`,
      );
      check('the dashboard is still on screen after tapping a mover', (await page.locator('[data-testid="dashboard-screen"]').count()) === 1);

      // The explicit control still works, and it lands on the chart.
      await other.locator('.m-open').click();
      await page.waitForTimeout(1200);
      const headlineOpened = (await page.locator('[data-testid="topbar-symbol"] .sym').innerText()).trim();
      check('the explicit “chart ↗” control opens that symbol', headlineOpened === otherSymbol, `${otherSymbol} → ${headlineOpened}`);
      check('opening a mover lands on the chart screen', (await page.locator('[data-testid="chart-screen"]').count()) === 1);
      // Return to the headline symbol for the rest of the run.
      await page.locator('[data-testid="mover-strip"] .mover .m-open').first().click().catch(() => {});
      await page.waitForTimeout(800);
    }

    await clickNav(page, 'Help');
    await page.waitForSelector('[data-testid="help-screen"]', { timeout: 15_000 });
    const glossaryRows = await page.locator('[data-testid="glossary"] .glossary-row').count();
    check('the help screen teaches the jargon', glossaryRows >= 5, `${glossaryRows} glossary entries`);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, '06-help.png'), fullPage: true });

    section('screen coverage');
    for (const [label, testid] of [
      ['Dashboard', 'dashboard-screen'],
      ['Chart', 'chart-screen'],
      ['Signals', 'signals-screen'],
      ['Watchlist', 'watchlist-screen'],
      ['Help', 'help-screen'],
    ]) {
      check(`SPEC §5 — ${label} screen is reachable`, await wasReachable(page, label, testid), testid);
    }

    /* ------------------------------ responsive ---------------------------- */
    section('responsive layout (SPEC: one PWA for web + iOS + macOS)');
    for (const [name, size] of [
      ['mobile', { width: 390, height: 844 }],
      ['tablet', { width: 834, height: 1112 }],
      ['desktop', { width: 1600, height: 1000 }],
    ]) {
      await page.setViewportSize(size);
      await clickNav(page, 'Chart');
      await page.waitForTimeout(700);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      check(`no horizontal overflow at ${name} (${size.width}px)`, overflow <= 2, `${overflow}px`);
      const w = await page.evaluate(() => {
        const c = document.querySelector('[data-testid="chart-canvas"] canvas');
        return c ? Math.round(c.getBoundingClientRect().width) : 0;
      });
      check(`the chart resizes with the ${name} viewport`, w > 100, `${w}px wide`);
      await page.screenshot({ path: path.join(EVIDENCE_DIR, `07-responsive-${name}.png`), fullPage: true });
    }
    await page.setViewportSize(VIEWPORT);

    /* ------------------------------ PWA -------------------------------- */
    section('PWA');
    const manifestHref = await page.getAttribute('link[rel="manifest"]', 'href').catch(() => null);
    check('the document advertises a web app manifest', !!manifestHref, manifestHref ?? 'missing');
    const manifest = await page.evaluate(async (href) => {
      const res = await fetch(href);
      return res.ok ? res.json() : null;
    }, manifestHref);
    check('the manifest parses and names the app', !!manifest?.name, manifest?.name ?? 'unparseable');
    check('the manifest is installable (standalone display)', manifest?.display === 'standalone', manifest?.display ?? '');
    check(
      'the manifest ships real icon sizes',
      Array.isArray(manifest?.icons) && manifest.icons.length >= 2,
      Array.isArray(manifest?.icons) ? manifest.icons.map((i) => i.sizes).join(',') : '',
    );
    const swReady = await page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) return 'unsupported';
      const reg = await navigator.serviceWorker.getRegistration();
      return reg ? 'registered' : 'none';
    });
    check('a service worker is registered', swReady === 'registered', swReady);

    /* ------------------------------ console ---------------------------- */
    section('console cleanliness (SPEC §3: zero console errors)');
    if (consoleErrors.length) for (const e of consoleErrors) console.error(`    ! ${e}`);
    for (const e of pageErrors) console.error(`    ! pageerror: ${e}`);
    for (const f of failedRequests) console.error(`    ! requestfailed: ${f}`);
    if (consoleWarnings.length && process.env.EVIDENCE_VERBOSE) {
      for (const w of consoleWarnings) console.log(`    ~ warning: ${w}`);
    }
    check('zero console errors', consoleErrors.length === 0, `${consoleErrors.length} errors`);
    check('zero uncaught page exceptions', pageErrors.length === 0, `${pageErrors.length} exceptions`);
    check('zero failed network requests', failedRequests.length === 0, `${failedRequests.length} failures`);
    check(
      'no React key/lifecycle warnings',
      !consoleWarnings.some((w) => /React|key=|validateDOMNesting/i.test(w)),
      `${consoleWarnings.length} warnings total`,
    );

    /* ------------------------------ report ----------------------------- */
    const report = {
      generatedAt: new Date().toISOString(),
      baseUrl,
      chrome: executablePath,
      symbol: SYMBOL,
      barCount,
      screens: ['dashboard', 'chart', 'signals', 'watchlist', 'help'],
      consoleErrors,
      consoleWarnings,
      pageErrors,
      failedRequests,
      passed,
      failed: failures,
      ok: failures.length === 0,
    };
    writeFileSync(path.join(EVIDENCE_DIR, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);

    await context.close();
  } catch (err) {
    failures.push(`harness error: ${err instanceof Error ? err.message : String(err)}`);
    console.error('\nharness error:', err);
    if (serverLog.trim()) console.error('--- server log ---\n' + serverLog.trim());
  } finally {
    if (browser) await browser.close().catch(() => {});
    server.kill('SIGTERM');
    await sleep(300);
    if (!server.killed) server.kill('SIGKILL');
    rmSync(WORK_DIR, { recursive: true, force: true });
  }

  console.log('\n' + '─'.repeat(60));
  if (failures.length === 0) {
    console.log(`✓ browser evidence PASSED — ${passed} checks. Artifacts in evidence/`);
    process.exit(0);
  } else {
    console.error(`✗ browser evidence FAILED — ${passed} passed, ${failures.length} failed`);
    for (const f of failures) console.error(`   • ${f}`);
    process.exit(1);
  }
}

/* ----------------------------------------------------------------- helpers */

/** Click a top-nav button by its visible label. */
async function clickNav(page, label) {
  await page.locator('nav.nav button', { hasText: new RegExp(`^${label}$`) }).first().click();
  await page.waitForTimeout(150);
}

/** Click any button whose text matches. */
async function clickButton(page, re) {
  await page.locator('button', { hasText: re }).first().click();
}

/** Re-visit a screen and confirm it renders, for the coverage table. */
async function wasReachable(page, label, testid) {
  try {
    await clickNav(page, label);
    await page.waitForSelector(`[data-testid="${testid}"]`, { timeout: 15_000 });
    return true;
  } catch {
    return false;
  }
}

/** Locate an installed Chrome without downloading a browser. */
function findChrome() {
  const candidates = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ];
  return candidates.find((p) => existsSync(p)) ?? null;
}

main().catch((err) => {
  console.error('fatal:', err);
  process.exit(1);
});
