#!/usr/bin/env node
/**
 * Real-browser evidence for the directional-colour change (owner request,
 * 2026-11-07: 「啲數據上升或下降都希望有啲顏色區分佢地，令人易睇d」).
 *
 * Why a browser and not just a unit test: the unit test asserts the *class*
 * landed on the right node. That is necessary but not sufficient — a class can
 * be present and still render no colour (an overridden rule, a mistyped token,
 * a parent with `color: inherit`). Only a real layout engine can answer the
 * question the owner actually asked: *does the number the user reads go green
 * when it is up, and red when it is down?*
 *
 * So this script:
 *
 *   1. bundles the Express server and boots it against a throwaway SQLite DB,
 *   2. drives the **production build** in headless Chrome over CDP,
 *   3. serves **deterministic** API payloads (via request interception) so a
 *      known +2.50%, −1.75%, +20.00%, −20.00%, +25.00% … are guaranteed to be
 *      on screen — real data would make the signs a coin-flip per run,
 *   4. reads `getComputedStyle().color` for the rendered figures and asserts the
 *      **computed RGB** is the `--up` / `--down` token, not merely a class name,
 *   5. asserts the *negative* cases the owner also implied: a figure with no
 *      value (a dash) and a plain level (a price, a target) are NOT coloured,
 *   6. repeats the assertions in both locales, and confirms the coloured spans
 *      add no motion (so `prefers-reduced-motion` is untouched by this change),
 *   7. writes screenshots + a JSON report to `evidence/colour/`.
 *
 * Exit code is 0 only when every check passes.
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const EVIDENCE_DIR = path.join(ROOT, 'evidence', 'colour');
const WORK_DIR = path.join(ROOT, 'evidence', '.work-colour');
const DIST_DIR = path.join(ROOT, 'dist');

const SYMBOL = 'AAPL';
const OTHER = 'MSFT';
const FLAT = 'XYZ';

/** The exact computed colours the tokens must resolve to (see src/styles.css). */
const COLOUR = {
  up: 'rgb(38, 166, 154)', // --up #26a69a
  down: 'rgb(239, 83, 80)', // --down #ef5350
  dim: 'rgb(154, 167, 180)', // --text-dim #9aa7b4
};

/* ------------------------------------------------------------------ checks */

let passed = 0;
const failures = [];

function check(label, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ''}`);
  } else {
    failures.push(`${label}${detail ? ` — ${detail}` : ''}`);
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function section(name) {
  console.log(`\n${name}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

async function waitForHealth(baseUrl, timeoutMs = 25_000) {
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

/* -------------------------------------------------------- deterministic API */

/**
 * The fixed payloads the run serves. Every sign the owner cares about is pinned
 * here, so a green/red assertion can never be a coincidence of the day's tape.
 */
function payloads() {
  const now = Math.floor(Date.now() / 1000);
  const day = 86400;

  const candles = Array.from({ length: 260 }, (_, i) => {
    const base = 150 + i * 0.08 + Math.sin(i / 7) * 3;
    return {
      time: now - (259 - i) * day,
      open: Number(base.toFixed(2)),
      high: Number((base + 1.2).toFixed(2)),
      low: Number((base - 1.1).toFixed(2)),
      close: Number((base + 0.4).toFixed(2)),
      volume: 1_000_000 + i,
    };
  });

  const meta = {
    symbol: SYMBOL,
    name: 'Apple Inc.',
    currency: 'USD',
    exchange: 'NASDAQ',
    exchangeTimezone: 'America/New_York',
    lastPrice: 189.42,
    previousClose: 184.8,
    change: 4.62,
    changePercent: 2.5, // +2.50% (changePercent is a raw percent, not a fraction)
    dayHigh: 190.1,
    dayLow: 185.2,
    fiftyTwoWeekHigh: 199.6,
    fiftyTwoWeekLow: 124.2,
    volume: 55_000_000,
    marketTime: now,
  };

  const quotes = [
    // A rise, a fall, and a row with no change at all (a null, not a 0).
    { symbol: SYMBOL, name: 'Apple Inc.', lastPrice: 189.42, change: 4.62, changePercent: 2.5, currency: 'USD', source: 'live', stale: false, lastUpdated: now },
    { symbol: OTHER, name: 'Microsoft Corp.', lastPrice: 412.1, change: -7.34, changePercent: -1.75, currency: 'USD', source: 'live', stale: false, lastUpdated: now },
    { symbol: FLAT, name: 'No Change Co.', lastPrice: 50, change: null, changePercent: null, currency: 'USD', source: 'unavailable', stale: false, lastUpdated: null },
  ];

  const statementTable = (rows) => ({
    columns: ['2025-12-31', '2026-03-31', '2026-09-30'],
    currency: 'USD',
    periodType: '3M',
    anyComputed: false,
    period: 'quarterly',
    rows,
  });
  const statements = {
    symbol: SYMBOL,
    period: 'quarterly',
    currency: 'USD',
    periodType: '3M',
    income: statementTable([
      // 100 → 120 over the last two columns: +20.00% (up).
      { labelKey: 'pf.income.totalRevenue', kind: 'money', values: [90, 100, 120], computed: false },
      // 100 → 80: −20.00% (down).
      { labelKey: 'pf.income.netIncome', kind: 'money', values: [95, 100, 80], computed: false },
      // A null latest cell: the change cannot be computed → a dash, no colour.
      { labelKey: 'pf.income.ebitda', kind: 'money', values: [80, 100, null], computed: false },
    ]),
    balance: statementTable([{ labelKey: 'pf.balance.totalAssets', kind: 'money', values: [100, 110, 130], computed: false }]),
    cashflow: statementTable([{ labelKey: 'pf.cash.freeCashFlow', kind: 'money', values: [40, 60, 55], computed: false }]),
    metrics: { asOf: '2026-09-30', currency: 'USD', marketCap: null, ev: null, netDebt: null, items: [] },
    inputs: {},
    price: null,
    source: 'cache',
    lastUpdated: now,
    note: null,
  };

  const side = (growth) => ({ avg: 1, low: 0.5, high: 1.5, yearAgo: 0.9, analysts: 20, growth, currency: 'USD' });
  const estimates = {
    symbol: SYMBOL,
    periods: [
      { id: '0q', endDate: '2027-03-31', eps: side(0.123), revenue: side(0.05) }, // +12.30%
      { id: '1q', endDate: '2027-06-30', eps: side(-0.07), revenue: side(-0.02) }, // −7.00%
    ],
    extraYears: 0,
    calendar: { nextEarningsLabel: null, isEstimate: false, epsAvg: null, epsLow: null, epsHigh: null, revenueAvg: null },
    history: [
      { quarterAt: null, quarterLabel: 'Q1', period: null, epsActual: 1.2, epsEstimate: 1, epsDifference: 0.2, surprisePercent: 0.2, currency: 'USD' },
      { quarterAt: null, quarterLabel: 'Q2', period: null, epsActual: 0.8, epsEstimate: 1, epsDifference: -0.2, surprisePercent: -0.2, currency: 'USD' },
    ],
    matrix: [
      { labelKey: 'pf.matrix.revenue', kind: 'money', actual: 100, forecast: 110, growth: 0.1, noEstimateUpstream: false, basis: 'quarter', asOf: '2026-09-30' },
      { labelKey: 'pf.matrix.eps', kind: 'perShare', actual: 100, forecast: 90, growth: -0.1, noEstimateUpstream: false, basis: 'quarter', asOf: '2026-09-30' },
    ],
    forward: { eps: null, revenue: null, quarters: [], basis: null },
    ev: null,
    price: 189.42,
    currency: 'USD',
    source: 'cache',
    lastUpdated: now,
    note: null,
  };

  const ratings = {
    symbol: SYMBOL,
    ratings: { buckets: [], recommendationMean: 2, recommendationKey: 'buy', numberOfAnalystOpinions: 20 },
    target: { low: 100, mean: 150, high: 200, median: 150, analysts: 20, upsidePct: 0.25 }, // +25.00%
    actions: [],
    oneYearReturn: -0.1, // −10.00%
    price: 189.42,
    currency: 'USD',
    source: 'cache',
    lastUpdated: now,
    note: null,
  };

  const fundamentals = {
    symbol: SYMBOL,
    profile: null,
    keyStats: null,
    health: {
      profitMargins: 0.2,
      operatingMargins: 0.25,
      returnOnEquity: 0.3,
      returnOnAssets: 0.1,
      revenueGrowth: -0.05, // −5.00% (the only directional figure in this panel)
      recommendationKey: null,
      recommendationMean: null,
      numberOfAnalystOpinions: null,
      targetMeanPrice: null,
      targetHighPrice: null,
      targetLowPrice: null,
    },
    quoteType: 'EQUITY',
    currency: 'USD',
    source: 'cache',
    lastUpdated: now,
    note: null,
  };

  return { now, candles, meta, quotes, statements, estimates, ratings, fundamentals };
}

/** Install the deterministic API over the real server. */
async function intercept(page, p) {
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const p0 = url.pathname;
    const json = (data) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data }) });

    if (p0 === '/api/health') return json({ status: 'ok', time: p.now, service: 'stock-coach-api' });
    if (p0 === '/api/watchlist/quotes') return json(p.quotes);
    if (p0 === '/api/watchlist') {
      return json([
        { symbol: SYMBOL, name: 'Apple Inc.', position: 0, addedAt: p.now },
        { symbol: OTHER, name: 'Microsoft Corp.', position: 1, addedAt: p.now },
        { symbol: FLAT, name: 'No Change Co.', position: 2, addedAt: p.now },
      ]);
    }
    if (p0 === `/api/market/${SYMBOL}` || p0.startsWith('/api/market/')) {
      return json({
        symbol: SYMBOL,
        interval: '1d',
        candles: p.candles,
        indicators: { sma20: [], sma50: [], sma200: [], ema12: [], ema26: [], bb: [], rsi14: [], macd: [] },
        meta: p.meta,
        source: 'live',
        lastUpdated: p.now,
        fetchedAt: p.now,
        note: null,
        count: p.candles.length,
      });
    }
    if (p0.startsWith('/api/signals/')) {
      return json({
        symbol: SYMBOL,
        interval: '1d',
        range: '1y',
        signals: [],
        summary: { bullish: 0, bearish: 0, neutral: 0, score: 50, verdict: 'Neutral', verdictVariant: 'mixed' },
        meta: p.meta,
        source: 'live',
        lastUpdated: p.now,
        note: null,
        candleCount: p.candles.length,
      });
    }
    if (p0.startsWith('/api/news/')) return json({ symbol: SYMBOL, items: [], source: 'cache', lastUpdated: p.now, note: null });
    if (p0.startsWith('/api/fundamentals/')) return json(p.fundamentals);
    if (p0.startsWith('/api/categories')) return json({});
    if (p0.startsWith('/api/quotes/')) {
      return json({ ...p.meta, changePercent: 2.5, marketCap: 2.9e12, trailingPE: 30, forwardPE: 27, dividendYield: 0.005, beta: 1.2, priceToBook: 45, trailingEps: 6.1, forwardEps: 7, preMarket: null, postMarket: null });
    }
    if (p0.startsWith('/api/statements/')) return json(p.statements);
    if (p0.startsWith('/api/estimates/')) return json(p.estimates);
    if (p0.startsWith('/api/ratings/')) return json(p.ratings);
    if (p0.startsWith('/api/fx')) return json({ perUsd: { USD: 1, HKD: 7.8 }, asOf: p.now, unavailable: false, source: 'cache', lastUpdated: p.now, note: null });
    if (p0.startsWith('/api/search')) return json([]);
    // Anything else: an honest 404 envelope, which the UI renders as empty state.
    return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'not stubbed', code: 'NOT_FOUND' }) });
  });
}

/* ---------------------------------------------------------------- helpers */

/** Ensure the sidebar is open (away by default on desktop; a drawer on a phone). */
async function openSidebar(page) {
  const needOpen = await page.evaluate(() => {
    if (document.body.classList.contains('chrome-hidden')) return true;
    if (window.matchMedia('(max-width: 1180px)').matches) {
      return !document.querySelector('.sidebar')?.classList.contains('open');
    }
    return false;
  });
  if (needOpen) {
    await page.locator('.drawer-toggle').first().click();
    await page.waitForTimeout(400);
  }
}

async function clickNav(page, screenId) {
  const item = page.locator(`nav.side-nav button[data-screen="${screenId}"]`).first();
  await openSidebar(page);
  await item.click({ force: true });
  await page.waitForTimeout(300);
}

async function setLang(page, lang) {
  await openSidebar(page);
  await page.locator(`[data-testid="lang-switch"] button[data-lang="${lang}"]`).click();
  await page.waitForTimeout(400);
}

async function openAllSections(page) {
  const toggles = page.locator('.pf-section-toggle');
  const n = await toggles.count();
  for (let i = 0; i < n; i += 1) {
    const caret = toggles.nth(i);
    const isOpen = await caret.evaluate((el) => el.closest('.pf-section')?.classList.contains('open'));
    if (!isOpen) {
      await caret.click({ force: true });
      await page.waitForTimeout(250);
    }
  }
  await page.waitForTimeout(300);
}

/**
 * Read every rendered directional figure and report what the user actually sees:
 * the text, the class, the computed colour, and whether it carries any motion.
 *
 * `scope` limits the probe to one subtree so a check can name the panel it saw.
 */
async function readFigures(page, scope) {
  return page.evaluate((sel) => {
    const root = sel ? document.querySelector(sel) : document;
    if (!root) return { up: [], down: [], flat: [], uncoloured: [], motion: null };
    const colourOf = (el) => getComputedStyle(el).color;
    const motionOf = (el) => {
      const s = getComputedStyle(el);
      const d = [...s.transitionDuration.split(','), ...s.animationDuration.split(',')]
        .map((x) => x.trim())
        .map((x) => (x.endsWith('ms') ? parseFloat(x) / 1000 : parseFloat(x) || 0));
      return Math.max(0, ...d);
    };
    const pick = (el) => ({
      text: (el.textContent || '').trim(),
      cls: (el.className || '').toString().trim(),
      colour: colourOf(el),
      motion: motionOf(el),
      testid: el.getAttribute('data-testid') || null,
    });
    const up = [...root.querySelectorAll('.chg-up')].map(pick);
    const down = [...root.querySelectorAll('.chg-down')].map(pick);
    const flat = [...root.querySelectorAll('.chg-flat')].map(pick);
    const uncoloured = [...root.querySelectorAll('.pf-nodata, .v, dd, .wl-price, .wl-chg, td')]
      .filter((el) => !/chg-(up|down|flat)/.test((el.className || '').toString()))
      .map(pick);
    return { up, down, flat, uncoloured };
  }, scope);
}

/** Any element anywhere carrying a direction class or a signed percentage. */
async function readAllFigures(page) {
  return readFigures(page, null);
}

/** The motion budget of every coloured span on screen (must stay 0 with reduce). */
async function colouredMotion(page) {
  return page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('.chg-up, .chg-down, .chg-flat')) {
      const s = getComputedStyle(el);
      const d = [...s.transitionDuration.split(','), ...s.animationDuration.split(',')]
        .map((x) => x.trim())
        .map((x) => (x.endsWith('ms') ? parseFloat(x) / 1000 : parseFloat(x) || 0));
      out.push(Math.max(0, ...d));
    }
    return out;
  });
}

function expectSignConsistent(figures, dir, label) {
  // Sign-as-text applies to the *directional* (percentage) figures. A quote
  // block shares one tone between the price and its change (the app's long-
  // standing Futu-style row design), so a bare price is filtered out here — a
  // percentage is the figure that must carry its sign, not the level beside it.
  const dirFigures = figures.filter((f) => f.text.includes('%'));
  const bad = dirFigures.filter((f) => {
    const t = f.text.replace(/[−–—]/g, '-');
    return dir === 'up' ? !t.startsWith('+') : !t.startsWith('-');
  });
  check(
    `${label}: every ${dir} percentage carries its sign in the text (colour is not the only cue)`,
    dirFigures.length > 0 && bad.length === 0,
    bad.length ? bad.map((f) => f.text).slice(0, 3).join(', ') : `${dirFigures.length} figure(s)`,
  );
}

function expectColour(figures, colour, label) {
  const wrong = figures.filter((f) => f.colour !== colour);
  check(
    `${label}: computed colour is the expected token`,
    figures.length > 0 && wrong.length === 0,
    wrong.length ? wrong.map((f) => `${f.text}=${f.colour}`).slice(0, 3).join(', ') : `${figures.length} ✓ ${colour}`,
  );
}

/* --------------------------------------------------------------- the run */

async function main() {
  if (!existsSync(DIST_DIR)) {
    console.error('dist/ is missing — run `npm run build` first.');
    process.exit(1);
  }

  rmSync(WORK_DIR, { recursive: true, force: true });
  mkdirSync(WORK_DIR, { recursive: true });
  mkdirSync(EVIDENCE_DIR, { recursive: true });

  console.log('bundling server…');
  const serverBundle = await bundleServer();

  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const dbPath = path.join(WORK_DIR, 'colour.db');

  const server = spawn(process.execPath, [serverBundle], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DB_PATH: dbPath, NODE_ENV: 'production' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverLog = '';
  server.stdout.on('data', (d) => (serverLog += d));
  server.stderr.on('data', (d) => (serverLog += d));

  const p = payloads();
  const report = {
    generatedAt: new Date().toISOString(),
    colour: COLOUR,
    checks: {},
    screenshots: [],
    consoleErrors: [],
    pageErrors: [],
  };

  let browser;
  try {
    const health = await waitForHealth(baseUrl);
    console.log(`server up on ${baseUrl} (${health.service})`);

    const executablePath = process.env.CHROME_PATH || findChrome();
    if (!executablePath) throw new Error('no Chrome binary found; set CHROME_PATH');
    console.log(`chrome: ${executablePath}`);

    browser = await chromium.launch({ executablePath, headless: true, args: ['--hide-scrollbars', '--mute-audio'] });
    // Phase 5: pin the color scheme to dark so the assertions below (which read
    // the dark `--up`/`--down` values) keep testing what they were written for.
    // Playwright defaults to light, and the app now follows the OS preference.
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, colorScheme: 'dark' });
    const page = await context.newPage();

    const consoleErrors = [];
    const pageErrors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await intercept(page, p);

    /* ------------------------------ dashboard ---------------------------- */
    section('dashboard — the watchlist figures are coloured by sign');
    await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForSelector('[data-testid="dashboard-screen"]', { timeout: 25_000 });
    // The panel starts away on desktop; its figures are not "visible" until it opens.
    await openSidebar(page);
    await page.waitForSelector('[data-testid="sidebar-list"] .wl-chg', { timeout: 20_000 });
    await page.waitForTimeout(600);

    const sidebar = await readFigures(page, '[data-testid="sidebar-list"]');
    const byText = (arr, needle) => arr.find((f) => f.text.includes(needle));
    const upRow = byText(sidebar.up, '+2.50%');
    const downRow = byText(sidebar.down, '-1.75%');
    check('sidebar: the +2.50% row is chg-up', !!upRow, upRow ? `${upRow.text} → ${upRow.colour}` : 'not found');
    check('sidebar: the -1.75% row is chg-down', !!downRow, downRow ? `${downRow.text} → ${downRow.colour}` : 'not found');
    expectColour(sidebar.up, COLOUR.up, 'sidebar up figures');
    expectColour(sidebar.down, COLOUR.down, 'sidebar down figures');
    expectSignConsistent(sidebar.up, 'up', 'sidebar');
    expectSignConsistent(sidebar.down, 'down', 'sidebar');

    // The row with NO change (a null) must not be green or red.
    const flatRow = sidebar.flat.find((f) => f.text.includes('—') || f.text.includes('暫無'));
    check(
      'sidebar: a row with no change is chg-flat, never green/red',
      !!flatRow && flatRow.colour === COLOUR.dim,
      flatRow ? `"${flatRow.text}" → ${flatRow.colour}` : 'no flat figure found',
    );

    // The mover strip is the other dashboard surface that shows change.
    const movers = await readFigures(page, '[data-testid="mover-strip"]');
    expectColour(movers.up, COLOUR.up, 'mover strip up');
    expectColour(movers.down, COLOUR.down, 'mover strip down');
    report.checks.dashboard = { sidebar, movers };
    await page.screenshot({ path: path.join(EVIDENCE_DIR, '01-dashboard-zh-HK.png'), fullPage: true });
    report.screenshots.push('01-dashboard-zh-HK.png');

    /* ------------------------------- analysts ---------------------------- */
    section('analysts — statements, estimates and ratings figures are coloured');
    await clickNav(page, 'analysts');
    await page.waitForSelector('[data-testid="analysts-screen"]', { timeout: 25_000 });
    await page.waitForSelector('[data-testid="pf-section-statements"]', { timeout: 25_000 });
    await openAllSections(page);
    await page.waitForTimeout(700);

    const stmt = await readFigures(page, '[data-testid="pf-section-statements"]');
    const stmtUp = byText(stmt.up, '+20.00%');
    const stmtDown = byText(stmt.down, '-20.00%');
    check('statements: the +20.00% Change cell is chg-up', !!stmtUp, stmtUp ? `${stmtUp.colour}` : 'not found');
    check('statements: the -20.00% Change cell is chg-down', !!stmtDown, stmtDown ? `${stmtDown.colour}` : 'not found');
    expectColour(stmt.up, COLOUR.up, 'statements up');
    expectColour(stmt.down, COLOUR.down, 'statements down');
    expectSignConsistent(stmt.up, 'up', 'statements');
    expectSignConsistent(stmt.down, 'down', 'statements');

    // The row whose change cannot be computed shows a dash, with no colour.
    const stmtDash = await page.evaluate(() => {
      const table = document.querySelector('[data-testid="pf-stmt-income"]');
      if (!table) return null;
      const dashes = [...table.querySelectorAll('td:last-child .pf-nodata')];
      return dashes.map((d) => ({ text: (d.textContent || '').trim(), colour: getComputedStyle(d).color, hasDir: /chg-(up|down|flat)/.test((d.parentElement?.className || '') + (d.className || '')) }));
    });
    check(
      'statements: a Change that cannot be computed is an uncoloured dash',
      !!stmtDash && stmtDash.length > 0 && stmtDash.every((d) => !d.hasDir && d.colour !== COLOUR.up && d.colour !== COLOUR.down),
      stmtDash ? stmtDash.map((d) => `${d.text}=${d.colour}`).join(', ') : 'no dash found',
    );
    report.checks.statements = { up: stmt.up, down: stmt.down, dashes: stmtDash };

    const est = await readFigures(page, '[data-testid="pf-section-estimates"]');
    check('estimates: the +12.30% growth cell is chg-up', !!byText(est.up, '+12.30%'), est.up.map((f) => f.text).join(' '));
    check('estimates: the -7.00% growth cell is chg-down', !!byText(est.down, '-7.00%'), est.down.map((f) => f.text).join(' '));
    expectColour(est.up, COLOUR.up, 'estimates up');
    expectColour(est.down, COLOUR.down, 'estimates down');
    expectSignConsistent(est.up, 'up', 'estimates');
    expectSignConsistent(est.down, 'down', 'estimates');
    report.checks.estimates = { up: est.up, down: est.down };

    const rat = await readFigures(page, '[data-testid="pf-section-ratings"]');
    check('ratings: the +25.00% upside is chg-up', !!byText(rat.up, '+25.00%'), rat.up.map((f) => f.text).join(' '));
    check('ratings: the -10.00% 1-year return is chg-down', !!byText(rat.down, '-10.00%'), rat.down.map((f) => f.text).join(' '));
    expectColour(rat.up, COLOUR.up, 'ratings up');
    expectColour(rat.down, COLOUR.down, 'ratings down');

    // The target-price levels are *not* directional and must stay uncoloured.
    const levels = await page.evaluate(() => {
      const facts = document.querySelector('[data-testid="pf-band-facts"]');
      if (!facts) return null;
      const dds = [...facts.querySelectorAll('dd')];
      const tooColourful = dds.filter((dd) => {
        const c = getComputedStyle(dd).color;
        return (c === 'rgb(38, 166, 154)' || c === 'rgb(239, 83, 80)') && !/chg-(up|down)/.test((dd.className || '').toString());
      });
      return { count: dds.length, offenders: tooColourful.map((dd) => (dd.textContent || '').trim()) };
    });
    check(
      'ratings: no plain level is coloured without a direction class',
      !!levels && levels.offenders.length === 0,
      levels ? `${levels.count} fact(s); offenders: ${levels.offenders.join(', ') || 'none'}` : 'no facts',
    );
    report.checks.ratings = { up: rat.up, down: rat.down, levels };
    await page.screenshot({ path: path.join(EVIDENCE_DIR, '02-analysts-zh-HK.png'), fullPage: true });
    report.screenshots.push('02-analysts-zh-HK.png');

    /* ------------------------------- locales ----------------------------- */
    section('both locales render the same colour mapping');
    await setLang(page, 'en');
    await page.waitForTimeout(700);
    const enAll = await readAllFigures(page);
    const enUp = enAll.up.length;
    const enDown = enAll.down.length;
    check('EN locale: up figures still compute to --up', enUp > 0 && enAll.up.every((f) => f.colour === COLOUR.up), `${enUp} up`);
    check('EN locale: down figures still compute to --down', enDown > 0 && enAll.down.every((f) => f.colour === COLOUR.down), `${enDown} down`);
    const enText = await page.locator('[data-testid="analysts-screen"]').innerText();
    await setLang(page, 'zh-HK');
    await page.waitForTimeout(700);
    const zhAll = await readAllFigures(page);
    const zhText = await page.locator('[data-testid="analysts-screen"]').innerText();
    check('zh-HK locale: up figures still compute to --up', zhAll.up.length > 0 && zhAll.up.every((f) => f.colour === COLOUR.up), `${zhAll.up.length} up`);
    check('the two locales render genuinely different strings', enText !== zhText && /[A-Za-z]{4,}/.test(enText) && /[\u3400-\u9fff]/.test(zhText));
    report.checks.locales = { en: { up: enUp, down: enDown }, zh: { up: zhAll.up.length, down: zhAll.down.length } };

    /* --------------------------- reduced motion -------------------------- */
    section('the colour change adds no motion (prefers-reduced-motion untouched)');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.waitForTimeout(300);
    const normalMotion = await colouredMotion(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForTimeout(400);
    const reducedMotion = await colouredMotion(page);
    check(
      'coloured figures carry no transition/animation even with motion allowed',
      normalMotion.every((d) => d === 0),
      `max ${Math.max(0, ...normalMotion)}s across ${normalMotion.length} span(s)`,
    );
    check(
      'coloured figures stay still under prefers-reduced-motion: reduce',
      reducedMotion.every((d) => d === 0),
      `max ${Math.max(0, ...reducedMotion)}s across ${reducedMotion.length} span(s)`,
    );
    report.checks.motion = { normal: normalMotion.length, reduced: reducedMotion.length };
    await page.emulateMedia({ reducedMotion: 'no-preference' });

    /* ------------------------------ console ------------------------------ */
    section('console hygiene');
    report.consoleErrors = consoleErrors;
    report.pageErrors = pageErrors;
    check('zero console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | ') || 'none');
    check('zero uncaught page errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | ') || 'none');

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
    console.log(`✓ colour evidence PASSED — ${passed} checks. Artifacts in evidence/colour/`);
    process.exit(0);
  }
  console.error(`✗ colour evidence FAILED — ${passed} passed, ${failures.length} failed`);
  for (const f of failures) console.error(`   • ${f}`);
  process.exit(1);
}

main().catch((err) => {
  console.error('fatal:', err);
  process.exit(1);
});
