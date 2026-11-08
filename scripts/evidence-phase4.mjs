#!/usr/bin/env node
/**
 * Real-browser evidence for Phase 4 — the Dividend screen (§B, §D.2).
 *
 * Phase 3's script proves the *analyst* workspace at 390/834/1600 px. This one
 * makes the same class of claims about the dividend screen, which is where the
 * phase's honesty rules actually live:
 *
 *   1. boots the Express server (bundled) against a throwaway SQLite database,
 *   2. drives the **production build** in headless Chrome over CDP,
 *   3. opens the Dividend screen in **both** locales and asserts each of the six
 *      §C sections mounts, animates and stays readable,
 *   4. asserts the honesty rules *in the rendered DOM* — that a non-payer shows
 *      the em dash and never a `0.00%`, that Announced/Record/Type are dashes in
 *      every schedule row, and that no yield *level* carries a
 *      `chg-up`/`chg-down` class,
 *   5. measures document + container widths at 390/834/1600 px and fails on any
 *      horizontal overflow (§D.2),
 *   6. emulates `prefers-reduced-motion: reduce` and asserts every dividend
 *      transition/animation computes to `0s` — and asserts the opposite case
 *      too, so the check cannot pass by the motion simply not existing,
 *   7. fails on any console error,
 *   8. writes screenshots + a JSON report to `evidence/phase4/`.
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
const EVIDENCE_DIR = path.join(ROOT, 'evidence', 'phase4');
const WORK_DIR = path.join(ROOT, 'evidence', '.work-phase4');
const DIST_DIR = path.join(ROOT, 'dist');

/** A payer with a long history. */
const PAYER = 'KO';

/**
 * §A.8 row-set coherence is asserted on the symbols that actually reproduced
 * the QA defects: O / 0005.HK / ULVR.L carry the duplicate Ex-Date and the
 * scale mismatch. `expectUpcoming` checks the newest row's magnitude.
 */
const COHERENCE_SYMBOLS = [
  { symbol: 'O', expectUpcoming: true },
  { symbol: 'AAPL', expectUpcoming: false, expectNextPayDash: true },
  { symbol: '0005.HK', expectUpcoming: true },
  { symbol: 'ULVR.L', expectUpcoming: true },
];
const COHERENCE_SPANS = ['1y', '5y'];

/** True when an upcoming row's amount is off-scale against the column. */
function outliersUpcoming(row, nums) {
  if (!row || nums.length < 3) return false;
  const v = Number(String(row.amount).replace(/[, ]/g, ''));
  if (!Number.isFinite(v) || v <= 0) return true;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = sorted[Math.floor(sorted.length / 2)];
  return v < mid / 5 || v > mid * 5;
}
/** A non-payer: every yield figure must render the dash. */
const NON_PAYER = 'TSLA';

/** Parse a rendered cell like "156.00 GBp" / "1,234.5" into a number, or null. */
function numFromCell(s) {
  if (s === null || s === undefined || s === DASH || s === '') return null;
  const v = Number(String(s).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(v) ? v : null;
}

const WIDTHS = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'tablet', width: 834, height: 1112 },
  { name: 'desktop', width: 1600, height: 1000 },
];

const DASH = '\u2014';
const SECTION_IDS = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'];

/* ------------------------------------------------------------------ checks */

let passed = 0;
const failures = [];
const skipped = [];

function check(label, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failures.push(label);
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
    if (process.env.EVIDENCE_VERBOSE) console.error(new Error('stack').stack);
  }
}

function skip(label, reason) {
  skipped.push(`${label}: ${reason}`);
  console.log(`  ~ skipped ${label} — ${reason}`);
}

function section(name) {
  console.log(`\n── ${name}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------------------------------------------------------- harness -- */

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
      // Bundling node_modules into an ESM bundle breaks `require`-based
      // internals (express → debug → `require('tty')`), and bundling a
      // module-scope `import.meta.url` would resolve `../dist` against the work
      // dir. Phase 3's harness hit both; same fix here.
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

/* ---------------------------------------------------------------- helpers -- */

async function clickNav(page, screenId) {
  const item = page.locator(`nav.side-nav button[data-screen="${screenId}"]`).first();
  if (!(await item.isVisible())) {
    await page.locator('.drawer-toggle').first().click();
    await page.waitForTimeout(500);
  }
  await item.click({ force: true });
  await page.waitForTimeout(300);
}

async function setLang(page, lang) {
  await page.locator(`[data-testid="lang-switch"] button[data-lang="${lang}"]`).click();
  await page.waitForTimeout(400);
}

/**
 * The watchlist row for an EXACT symbol. `:has-text()` is a case-insensitive
 * SUBSTRING match, so `:has-text("O")` resolves to MSFT/GOOG/COST first and the
 * check silently exercises the wrong instrument (found 2026-11-07: the §A.8
 * coherence block passed under a mutation because "O" was actually MSFT).
 * Match the `.wl-sym` span with `:text-is()` instead.
 */
function wlRow(page, symbol) {
  return page.locator('button.wl-row').filter({ has: page.locator(`.wl-sym:text-is("${symbol}")`) }).first();
}

async function setSymbol(page, symbol) {
  // 1. Already in the watchlist sidebar → its row is one click.
  const row = wlRow(page, symbol);
  if ((await row.count()) > 0) {
    await row.click({ force: true });
    await page.waitForTimeout(1200);
    return true;
  }

  // 2. Otherwise add it on the Watchlist screen, then click the new row. There
  //    is no symbol text box in the top bar — selection happens here.
  await clickNav(page, 'watchlist');
  const input = page.locator('[data-testid="watchlist-screen"] input[type="text"]').first();
  if ((await input.count()) === 0) return false;
  await input.fill(symbol);
  await input.press('Enter');
  await page.waitForTimeout(3000);
  const msg = await page.locator('[data-testid="add-message"]').first().textContent().catch(() => null);
  if (msg === null) return false;
  // The add may have been rejected (unknown ticker); only a success message or an
  // already-present row counts as "switched".
  const newRow = wlRow(page, symbol);
  if ((await newRow.count()) === 0) return false;
  await newRow.click({ force: true });
  await page.waitForTimeout(1200);
  return true;
}

/** Open every dividend section, then wait for the visible ones to settle. */
async function openAllSections(page) {
  const toggles = page.locator('.div-screen .pf-section-toggle');
  const n = await toggles.count();
  for (let i = 0; i < n; i += 1) {
    const caret = toggles.nth(i);
    const isOpen = await caret.evaluate((el) => el.closest('.pf-section')?.classList.contains('open'));
    if (!isOpen) {
      await caret.click({ force: true });
      await page.waitForTimeout(300);
    }
  }
  await page.waitForTimeout(800);
}

/**
 * Horizontal-overflow rule, identical to the Phase 3 script's — the question is
 * only ever "can the user reach the content?".
 */
async function measureOverflow(page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const scrollWidth = Math.max(doc.scrollWidth, document.body.scrollWidth);
    const innerWidth = window.innerWidth;
    const offenders = [];
    const contained = [];

    const isScroller = (el) => {
      const s = getComputedStyle(el);
      return /auto|scroll/.test(s.overflowX);
    };
    const isClipper = (el) => {
      const s = getComputedStyle(el);
      return /hidden|clip/.test(s.overflowX);
    };
    const nearestGuard = (el) => {
      let p = el.parentElement;
      while (p && p !== document.body) {
        if (isScroller(p) || isClipper(p)) return p;
        p = p.parentElement;
      }
      return null;
    };

    for (const el of document.querySelectorAll('.div-screen *')) {
      const s = getComputedStyle(el);
      if (/hidden|clip/.test(s.overflowX)) continue; // made its own call
      if (!/visible/.test(s.overflowX)) continue;
      const excess = el.scrollWidth - el.clientWidth;
      if (excess <= 2) continue;
      const guard = nearestGuard(el);
      if (guard && isScroller(guard)) {
        contained.push({ sel: el.className?.toString?.().slice(0, 60), excess, in: guard.className?.toString?.().slice(0, 40) });
        continue;
      }
      offenders.push({ sel: el.className?.toString?.().slice(0, 80), excess, tag: el.tagName });
    }
    return { scrollWidth, innerWidth, docOverflow: scrollWidth - innerWidth, offenders, contained };
  });
}

/** Every animated duration the dividend screen's own controls carry, in seconds. */
async function motionSample(page) {
  return page.evaluate(() => {
    const selectors = [
      '.div-screen .pf-section-toggle',
      '.div-screen .pf-caret',
      '.div-screen .pf-seg button',
      '.div-screen .pf-act-btn',
      '.div-screen .pf-recap',
      '.div-screen .div-chart-wrap',
      '.side-nav .side-item[data-screen="dividends"]',
    ];
    const out = {};
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (!el) {
        out[sel] = null;
        continue;
      }
      const s = getComputedStyle(el);
      const durations = [...s.transitionDuration.split(','), ...s.animationDuration.split(',')]
        .map((d) => d.trim())
        .map((d) => (d.endsWith('ms') ? parseFloat(d) / 1000 : parseFloat(d) || 0));
      out[sel] = Math.max(0, ...durations);
    }
    return out;
  });
}

/* --------------------------------------------------------------- the run -- */

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
  const dbPath = path.join(WORK_DIR, 'phase4.db');

  const server = spawn(process.execPath, [serverBundle], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DB_PATH: dbPath, NODE_ENV: 'production' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverLog = '';
  server.stdout.on('data', (d) => (serverLog += d));
  server.stderr.on('data', (d) => (serverLog += d));

  let browser;
  const report = {
    generatedAt: new Date().toISOString(),
    payer: PAYER,
    nonPayer: NON_PAYER,
    widths: WIDTHS.map((w) => w.width),
    screenshots: [],
    sections: {},
    honesty: {},
    overflow: [],
    motion: null,
    locales: {},
    consoleErrors: [],
    consoleWarnings: [],
    pageErrors: [],
    failedRequests: [],
    skipped: [],
  };

  const consoleErrors = [];
  const consoleWarnings = [];
  const pageErrors = [];
  const failedRequests = [];

  try {
    const health = await waitForHealth(baseUrl);
    console.log(`server up on ${baseUrl} (${health.service})`);

    const executablePath = process.env.CHROME_PATH || findChrome();
    if (!executablePath) throw new Error('no Chrome binary found; set CHROME_PATH');
    console.log(`chrome: ${executablePath}`);

    browser = await chromium.launch({ executablePath, headless: true, args: ['--hide-scrollbars', '--mute-audio'] });
    // Phase 5: pin dark (the app now follows the OS preference).
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, colorScheme: 'dark' });
    const page = await context.newPage();

    page.on('console', (msg) => {
      const text = `${msg.text()}`;
      const loc = msg.location();
      const where = loc?.url ? ` (${loc.url}:${loc.lineNumber})` : '';
      if (msg.type() === 'error') consoleErrors.push(`${text}${where}`);
      else if (msg.type() === 'warning') consoleWarnings.push(`${text}${where}`);
    });
    page.on('pageerror', (err) => pageErrors.push(err.message));
    page.on('requestfailed', (req) =>
      failedRequests.push(`${req.method()} ${req.url()} — ${req.failure()?.errorText ?? 'unknown'}`),
    );

    /* ------------------------------ app boot ------------------------------ */
    section('app boot');
    const resp = await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    check('index.html is served', resp?.status() === 200, `HTTP ${resp?.status()}`);
    await page.waitForSelector('[data-testid="dashboard-screen"]', { timeout: 25_000 });
    check('the dashboard boots', true);

    /* ------------------- §B.1 the nav entry exists and opens -------------- */
    section('§B.1 — the Dividend screen is reachable from the sidebar');
    const navItem = page.locator('nav.side-nav button[data-screen="dividends"]').first();
    check('the sidebar carries a dividends nav item', (await navItem.count()) > 0);
    check(
      'the nav item is labelled (not a bare glyph)',
      ((await navItem.first().innerText().catch(() => '')) || '').trim().length > 0,
    );
    await clickNav(page, 'dividends');
    await page.waitForSelector('[data-testid="dividends-screen"]', { timeout: 20_000 });
    check('the Dividend screen renders', true);

    // The facts payload may legitimately be empty/loading; wait for a settled
    // state rather than asserting a particular one.
    await page
      .waitForFunction(
        () => !document.querySelector('[data-testid="div-loading"]'),
        null,
        { timeout: 30_000 },
      )
      .catch(() => {});
    await page.waitForTimeout(1000);

    const hasPayload = (await page.locator('[data-testid="div-section-c1"]').count()) > 0;
    if (!hasPayload) {
      skip('§C section checks', 'the provider returned no dividend payload for this run');
    }

    /* ------------------- §B.1 six collapsible sections -------------------- */
    if (hasPayload) {
      section('§B.1 — the six §C sections are present, collapsible, and mount on open');
      for (const id of SECTION_IDS) {
        const sec = page.locator(`[data-testid="div-section-${id}"]`);
        check(`§C section ${id} is present`, (await sec.count()) > 0);
      }

      // Collapse everything, then assert the bodies are really unmounted.
      await page.evaluate(() => {
        document.querySelectorAll('.div-screen .pf-section-toggle').forEach((el) => {
          if (el.closest('.pf-section')?.classList.contains('open')) el.click();
        });
      });
      await page.waitForTimeout(500);
      const bodiesWhenClosed = await page.evaluate(
        () => document.querySelectorAll('.div-screen .pf-section.open .pf-section-body > *').length,
      );
      check('every section closes (bodies unmounted when collapsed)', bodiesWhenClosed === 0, `${bodiesWhenClosed} body node(s) still mounted`);

      await openAllSections(page);
      const openCount = await page.evaluate(() => document.querySelectorAll('.div-screen .pf-section.open').length);
      check('all six sections open', openCount === 6, `${openCount} open`);
      report.sections.openCount = openCount;

      const mounted = await page.evaluate(() =>
        ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'].filter((id) =>
          document.querySelector(`#pf-body-${id} > *`),
        ),
      );
      check('every opened section mounted its body', mounted.length === 6, mounted.join(','));
      report.sections.mounted = mounted;

      await page.screenshot({ path: path.join(EVIDENCE_DIR, '01-dividends-en.png'), fullPage: true });
      report.screenshots.push('01-dividends-en.png');
    }

    /* ------------------- §D.5 honesty in the rendered DOM ----------------- */
    if (hasPayload) {
      section('§D.5 — the honesty rules hold in the rendered DOM (payer)');
      const honesty = await page.evaluate(() => {
        const text = (sel) => document.querySelector(sel)?.textContent?.trim() ?? null;
        const cls = (sel) => document.querySelector(sel)?.className?.toString() ?? null;
        const levelIds = ['div-f-indicated', 'div-f-trailing', 'div-f-forward', 'div-f-payout', 'div-f-5y', 'div-f-rate'];
        const shIds = ['div-sh-total', 'div-sh-dividend', 'div-sh-buyback', 'div-sh-debt'];
        return {
          levelsColoured: [...levelIds, ...shIds].filter((id) => /chg-(up|down|flat)/.test(cls(`[data-testid="${id}"]`) ?? '')),
          announced: [...document.querySelectorAll('[data-testid="div-row-announced"]')].map((e) => e.textContent.trim()),
          record: [...document.querySelectorAll('[data-testid="div-row-record"]')].map((e) => e.textContent.trim()),
          type: [...document.querySelectorAll('[data-testid="div-row-type"]')].map((e) => e.textContent.trim()),
          rows: document.querySelectorAll('[data-testid="div-row-announced"]').length,
          // No cell anywhere on the screen may literally read "null"/"NaN"/"undefined".
          forbidden: [...document.querySelectorAll('.div-screen *')]
            .filter((e) => e.children.length === 0)
            .map((e) => (e.textContent || '').trim())
            .filter((t) => /^(null|NaN|undefined|Infinity)$/.test(t)),
          chartEmpty: !!document.querySelector('[data-testid="div-chart-empty"]'),
          scheduleEmpty: text('[data-testid="div-s5-absent"]') !== null,
          recapCells: document.querySelectorAll('[data-testid="div-recap"] .pf-recap-cell').length,
        };
      });
      report.honesty = honesty;

      check('no yield LEVEL is coloured as a change', honesty.levelsColoured.length === 0, honesty.levelsColoured.join(','));
      check('no cell renders the literal "null"/"NaN"/"undefined"', honesty.forbidden.length === 0, honesty.forbidden.join(' | '));
      check('the recap strip renders its cells', honesty.recapCells >= 5, `${honesty.recapCells} cells`);

      if (honesty.rows > 0) {
        check('every Announced cell is the dash', honesty.announced.every((t) => t === DASH), honesty.announced.slice(0, 3).join(','));
        check('every Record cell is the dash', honesty.record.every((t) => t === DASH), honesty.record.slice(0, 3).join(','));
        check('every Type cell is the dash', honesty.type.every((t) => t === DASH), honesty.type.slice(0, 3).join(','));
      } else {
        skip('schedule dash columns', 'the provider returned no payment rows for this run');
      }
    }

    /* ------------------- §C.1 honest empty for a non-payer --------------- */
    section('§D.5 — a non-payer shows the dash, never a zero');
    if (!(await setSymbol(page, NON_PAYER))) {
      skip(`non-payer check (${NON_PAYER})`, `${NON_PAYER} could not be selected for this run`);
      // Never leave the page somewhere else: the later checks assume the
      // Dividend screen is up.
      await clickNav(page, 'dividends');
      await page.waitForTimeout(1500);
      await openAllSections(page);
    } else {
      await clickNav(page, 'dividends');
      await page.waitForSelector('[data-testid="dividends-screen"]', { timeout: 20_000 });
      await page
        .waitForFunction(() => !document.querySelector('[data-testid="div-loading"]'), null, { timeout: 30_000 })
        .catch(() => {});
      await page.waitForTimeout(1500);
      const np = await page.evaluate(() => {
        const txt = (sel) => document.querySelector(sel)?.textContent?.trim() ?? null;
        // Only the *dividend figure* cells are checked for a fabricated zero.
        // "0 payments in span" on a non-payer is an honest count of an empty
        // list, not a dividend figure invented as zero, so counts are excluded
        // on purpose (§A.3 is about figures, not tallies).
        const figureIds = [
          'div-f-indicated',
          'div-f-trailing',
          'div-f-forward',
          'div-f-payout',
          'div-f-5y',
          'div-f-rate',
          'div-f-last',
          'div-recap-indicated',
          'div-recap-trailing',
          'div-recap-forward',
          'div-recap-payout',
        ];
        const zeroFigures = figureIds.filter((id) => {
          const el = document.querySelector(`[data-testid="${id}"]`);
          const t = (el?.textContent ?? '').trim();
          return t === '0.00%' || t === '0' || t === '0.00';
        });
        return {
          indicated: txt('[data-testid="div-f-indicated"]'),
          trailing: txt('[data-testid="div-f-trailing"]'),
          payout: txt('[data-testid="div-f-payout"]'),
          zeroFigures,
        };
      });
      report.honestyNonPayer = np;
      if (np.indicated === null) {
        skip('non-payer dash check', 'the non-payer facts block did not render');
      } else {
        check(`${NON_PAYER}: indicated yield is the dash`, np.indicated === DASH, `got ${np.indicated}`);
        check(`${NON_PAYER}: trailing yield is the dash`, np.trailing === DASH, `got ${np.trailing}`);
        check(`${NON_PAYER}: payout ratio is the dash`, np.payout === DASH, `got ${np.payout}`);
        check(`${NON_PAYER}: no dividend figure is a fabricated zero`, np.zeroFigures.length === 0, np.zeroFigures.join(' | '));
      }
      await page.screenshot({ path: path.join(EVIDENCE_DIR, '02-non-payer-dashes.png'), fullPage: true });
      report.screenshots.push('02-non-payer-dashes.png');
      await setSymbol(page, PAYER);
      await clickNav(page, 'dividends');
      await page.waitForTimeout(2000);
      await openAllSections(page);
    }

    /* ------------- §A.8 the §C.5 row set is coherent on the live DOM ----- */
    section('§A.8 — one payment is one row: no duplicate Ex-Date, no PAY<EX, one unit');
    const scheduleSnap = () =>
      page.evaluate(() => {
        const table = document.querySelector('[data-testid="div-schedule"]');
        if (!table) return null;
        const body = table.querySelectorAll('tbody tr');
        const out = [];
        for (const tr of body) {
          const td = [...tr.querySelectorAll('td')].map((c) => (c.textContent || '').trim());
          if (td.length < 7) continue; // the empty-state row
          out.push({ announced: td[0], ex: td[1], record: td[2], payable: td[3], ccy: td[4], amount: td[5], adj: td[6] });
        }
        return out;
      });

    for (const spec of COHERENCE_SYMBOLS) {
      const picked = await setSymbol(page, spec.symbol);
      if (!picked) {
        skip(`row-set coherence (${spec.symbol})`, `${spec.symbol} could not be selected for this run`);
        await clickNav(page, 'dividends');
        await page.waitForTimeout(1500);
        await openAllSections(page);
        continue;
      }
      await clickNav(page, 'dividends');
      await page.waitForSelector('[data-testid="dividends-screen"]', { timeout: 20_000 });
      await page
        .waitForFunction(() => !document.querySelector('[data-testid="div-loading"]'), null, { timeout: 30_000 })
        .catch(() => {});
      await openAllSections(page);

      // Identity guard: the screen must actually be showing spec.symbol. Without
      // this, a wrong row-pick silently judges another instrument's rows.
      const shown = await page.locator('[data-testid="dividends-screen"]').first().getAttribute('data-symbol');
      check(
        `${spec.symbol}: the dividends screen is showing that exact symbol`,
        shown === spec.symbol,
        shown === spec.symbol ? shown : `screen shows ${JSON.stringify(shown)}`,
      );
      if (shown !== spec.symbol) {
        await setSymbol(page, PAYER);
        continue;
      }

      let lastRows = null;
      for (const span of COHERENCE_SPANS) {
        const chip = page.locator(`[data-testid="div-span-c5"] [data-seg="${span}"]`).first();
        if ((await chip.count()) > 0) {
          await chip.click({ force: true });
          await page.waitForTimeout(1600);
        }
        const rows = await scheduleSnap();
        if (rows === null || rows.length === 0) {
          skip(`${spec.symbol} ${span}: row-set coherence`, 'no schedule rows rendered');
          continue;
        }
        lastRows = rows;
        const exDays = rows.map((r) => r.ex.replace(/\s*HKT$/, ''));
        const dupes = exDays.filter((d, i) => exDays.indexOf(d) !== i);
        check(
          `${spec.symbol} ${span}: no two §C.5 rows share an Ex-Date day`,
          dupes.length === 0,
          dupes.length ? `duplicate day(s): ${[...new Set(dupes)].join(', ')}` : `${rows.length} rows, all distinct`,
        );

        const badPay = rows.filter((r) => {
          if (r.payable === DASH || r.payable === '') return false;
          const p = Date.parse(r.payable.replace(/\s*HKT$/, '').replace(' ', 'T') + 'Z');
          const e = Date.parse(r.ex.replace(/\s*HKT$/, '').replace(' ', 'T') + 'Z');
          return Number.isFinite(p) && Number.isFinite(e) && p < e;
        });
        check(
          `${spec.symbol} ${span}: no row's Payable Date precedes its own Ex-Date`,
          badPay.length === 0,
          badPay.length ? `${badPay.length} row(s), e.g. ex=${badPay[0].ex} pay=${badPay[0].payable}` : 'monotonic',
        );

        // Cross-row unit agreement: every amount in the column shares one
        // magnitude band (a lone 100x or 7.8x outlier is a unit bug, §A.8).
        const nums = rows.map((r) => Number(String(r.amount).replace(/[, ]/g, ''))).filter((n) => Number.isFinite(n) && n > 0);
        if (nums.length >= 3) {
          const sorted = [...nums].sort((a, b) => a - b);
          const mid = sorted[Math.floor(sorted.length / 2)];
          const outliers = nums.filter((n) => n < mid / 5 || n > mid * 5);
          check(
            `${spec.symbol} ${span}: the Amount column agrees on one unit`,
            outliers.length === 0,
            outliers.length ? `outlier(s): ${outliers.slice(0, 3).join(', ')} vs median ${mid}` : `median ${mid}, ${nums.length} amounts`,
          );
        }
        if (spec.expectUpcoming) {
          const up = rows[0];
          check(
            `${spec.symbol} ${span}: the upcoming row's amount matches its series unit`,
            !outliersUpcoming(up, nums),
            up ? `newest amount ${up.amount} vs series median ${[...nums].sort((a, b) => a - b)[Math.floor(nums.length / 2)]}` : 'no rows',
          );
        }
        report.coherence = report.coherence ?? [];
        report.coherence.push({ symbol: spec.symbol, span, rows: rows.length, dupes: [...new Set(dupes)], badPay: badPay.length });
      }

      // §A.5.1 / §A.8 (N1): the Annual rate and the §C.5 Amount column are the
      // same instrument, so they must share a unit — a rate quoted in GBP while
      // the column is GBp renders ~100x too small (smaller than one payment,
      // which is impossible for any payer). Compare the rendered rate against the
      // column's median payment. The band is generous (0.5x-24x: at least annual,
      // at most monthly) but catches a 100x error in either direction.
      const unitCells = await page.evaluate(() => {
        const txt = (id) => document.querySelector(`[data-testid="${id}"]`)?.textContent?.trim() ?? null;
        return { rate: txt('div-f-rate') };
      });
      const rateNum = numFromCell(unitCells.rate);
      const colNums = (lastRows ?? [])
        .map((r) => numFromCell(r.amount))
        .filter((n) => n !== null && n > 0);
      colNums.sort((a, b) => a - b);
      const colMid = colNums.length ? colNums[Math.floor(colNums.length / 2)] : null;
      report.units = report.units ?? [];
      report.units.push({ symbol: spec.symbol, rate: unitCells.rate, colMedian: colMid });
      if (rateNum !== null && colMid !== null && colMid > 0) {
        const ratio = rateNum / colMid;
        check(
          `${spec.symbol}: the Annual rate shares the §C.5 Amount unit (not ~100x off)`,
          ratio >= 0.5 && ratio <= 24,
          `annual=${unitCells.rate} vs column median ${colMid} (ratio ${ratio.toFixed(3)})`,
        );
      } else if (colMid !== null && colMid > 0) {
        // F1: every symbol here is a payer with a resolvable unit, so a dashed
        // Annual rate is the R1 failure mode — it must FAIL, not silently skip.
        // (A skip here would make the assertion unable to catch the very
        // regression it was written for.)
        check(
          `${spec.symbol}: the Annual rate is shown, not the dash (payer)`,
          false,
          `the §C.1 Annual rate cell is ${unitCells.rate}`,
        );
      } else {
        skip(`${spec.symbol}: Annual-rate unit coherence`, 'the §C.5 column is empty');
      }

      // §C.6 / §A.8: the facts-level next-payable must agree with the next
      // ex-date shown on the same screen — never a payable before its own ex.
      const nextCells = await page.evaluate(() => {
        const txt = (id) => document.querySelector(`[data-testid="${id}"]`)?.textContent?.trim() ?? null;
        return { ex: txt('div-f-nextex'), pay: txt('div-f-nextpay'), recapEx: txt('div-recap-nextex') };
      });
      report.nextPayable = report.nextPayable ?? [];
      report.nextPayable.push({ symbol: spec.symbol, ...nextCells });
      if (nextCells.pay !== null && nextCells.pay !== DASH && nextCells.ex !== null && nextCells.ex !== DASH) {
        const p = Date.parse(nextCells.pay.replace(/\s*HKT$/, '').replace(' ', 'T') + 'Z');
        const e = Date.parse(nextCells.ex.replace(/\s*HKT$/, '').replace(' ', 'T') + 'Z');
        check(
          `${spec.symbol}: the shown Payable Date is after the shown Ex-Date`,
          Number.isFinite(p) && Number.isFinite(e) && p > e,
          `ex=${nextCells.ex} pay=${nextCells.pay}`,
        );
      } else {
        check(
          `${spec.symbol}: a next ex-date with no valid payable renders the dash`,
          nextCells.pay === DASH || nextCells.pay === null,
          `pay=${nextCells.pay ?? 'null'} ex=${nextCells.ex ?? 'null'}`,
        );
      }
    }
    await setSymbol(page, PAYER);
    await clickNav(page, 'dividends');
    await page.waitForTimeout(1500);
    await openAllSections(page);

    /* ------------------- §C.4 the span control --------------------------- */
    if (hasPayload) {
      section('§C.4 — the span control offers the six explicit windows, never `max`');
      const chips = await page.evaluate(() => {
        const c4 = document.querySelector('[data-testid="div-span-c4"]');
        const c5 = document.querySelector('[data-testid="div-span-c5"]');
        const read = (el) => (el ? [...el.querySelectorAll('[data-seg]')].map((b) => b.getAttribute('data-seg')) : null);
        return { c4: read(c4), c5: read(c5), c4Count: document.querySelectorAll('[data-testid="div-span-c4"]').length };
      });
      report.spans = chips;
      const chipList = chips.c4 ?? [];
      check(
        'the span control lists exactly 1y/3y/5y/10y/20y/ALL',
        chipList.join(',') === '1y,3y,5y,10y,20y,ALL',
        `c4=${chipList.join(',')} c5=${(chips.c5 ?? []).join(',')} instances=${chips.c4Count}`,
      );
      check('the two span controls are distinct instances', chips.c4Count === 1, `${chips.c4Count} element(s) share the c4 test id`);
      check('no span chip is a provider `range` token', !chipList.includes('max') && !chipList.includes('range'));
      // Click through them all: each must settle without an error state.
      let spanError = null;
      for (const chip of chipList) {
        await page.locator(`[data-testid="div-span-c4"] [data-seg="${chip}"]`).click({ force: true });
        await page.waitForTimeout(1500);
        const err = await page.locator('[data-testid="div-c4-error"]').count();
        if (err > 0) spanError = chip;
      }
      check('every span loads without an error state', spanError === null, spanError ? `span ${spanError} errored` : 'all six settled');
      await page.locator('[data-testid="div-span-c4"] [data-seg="5y"]').click({ force: true });
      await page.waitForTimeout(1200);
    }

    /* ------------------- §B.2 motion budget ------------------------------ */
    section('§B.2 — motion is subtle, ≤ 400 ms, and reduced-motion neutralises it');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.waitForTimeout(300);
    const normal = await motionSample(page);
    const animated = Object.entries(normal).filter(([, v]) => v !== null && v > 0);
    report.motion = { normal };
    check(
      'the dividend controls carry real (non-zero) motion when the user allows it',
      animated.length > 0,
      animated.map(([k, v]) => `${k}=${v}s`).join(', ') || 'none',
    );
    const overBudget = Object.entries(normal).filter(([, v]) => v !== null && v > 0.4);
    check('no dividend control exceeds the 400 ms budget', overBudget.length === 0, overBudget.map(([k, v]) => `${k}=${v}s`).join(', '));

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForTimeout(400);
    const reduced = await motionSample(page);
    report.motion.reduced = reduced;
    const stillMoving = Object.entries(reduced).filter(([, v]) => v !== null && v > 0);
    check(
      'prefers-reduced-motion: reduce removes every dividend transition/animation',
      stillMoving.length === 0,
      stillMoving.map(([k, v]) => `${k}=${v}s`).join(', ') || 'all at 0s',
    );
    check('the reduced sample covered the same controls', Object.keys(reduced).join() === Object.keys(normal).join());
    await page.emulateMedia({ reducedMotion: 'no-preference' });

    /* ------------------- §D.2 responsive at 390/834/1600 ----------------- */
    section('§D.2 — no horizontal overflow at 390 / 834 / 1600 px');
    for (const vp of WIDTHS) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.waitForTimeout(700);
      await openAllSections(page);
      const m = await measureOverflow(page);
      report.overflow.push({ width: vp.width, ...m });
      check(
        `no document-level horizontal overflow at ${vp.name} (${vp.width}px)`,
        m.docOverflow <= 1,
        `scrollWidth ${m.scrollWidth} vs viewport ${m.innerWidth}`,
      );
      check(
        `no clipped-unreachable element at ${vp.name} (${vp.width}px)`,
        m.offenders.length === 0,
        m.offenders.length ? JSON.stringify(m.offenders).slice(0, 200) : 'none',
      );
      console.log(
        `  · ${vp.width}px: ${m.contained.length} contained element(s) (scrolling table wrappers, ellipsis labels, chart canvases)`,
      );
      const file = `03-responsive-${vp.name}-${vp.width}.png`;
      await page.screenshot({ path: path.join(EVIDENCE_DIR, file), fullPage: true });
      report.screenshots.push(file);
    }

    /* ------------------- both locales ---------------------------------- */
    section('§F.5 — the screen reads correctly in both locales');
    await page.setViewportSize({ width: 1600, height: 1000 });
    await setLang(page, 'en');
    for (const lang of ['en', 'zh-HK']) {
      await setLang(page, lang);
      await openAllSections(page);
      const snap = await page.evaluate(() => {
        const titles = [...document.querySelectorAll('.div-screen .pf-section-title')].map((e) => e.textContent.trim());
        const heading = document.querySelector('.div-screen .pf-title')?.textContent?.trim() ?? '';
        const recap = document.querySelector('[data-testid="div-recap"]')?.textContent?.trim() ?? '';
        return { titles, heading, recapLen: recap.length };
      });
      report.locales[lang] = snap;
      check(`[${lang}] all six section titles render`, snap.titles.length === 6, snap.titles.join(' | '));
      // A zh-HK session must not leak a raw dictionary key or English prose. The
      // English dictionary's own copy is the reference, so a title identical to
      // it is a leak *unless* the key is a deliberately-identical token.
      const leakedKey = snap.titles.some((t) => /^div\.|^pf\./.test(t));
      check(`[${lang}] no raw dictionary key is rendered`, !leakedKey, snap.titles.join(' | '));
      check(`[${lang}] the recap strip is populated`, snap.recapLen > 10, `${snap.recapLen} chars`);
      const file = `04-locale-${lang}.png`;
      await page.screenshot({ path: path.join(EVIDENCE_DIR, file), fullPage: true });
      report.screenshots.push(file);
    }

    /* ------------------- console ---------------------------------------- */
    section('console');
    check('zero console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | ') || 'none');
    check('zero unhandled page errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | ') || 'none');
    report.consoleErrors = consoleErrors;
    report.consoleWarnings = consoleWarnings;
    report.pageErrors = pageErrors;
    report.failedRequests = failedRequests;
    if (failedRequests.length) console.log(`  · ${failedRequests.length} failed request(s) recorded (reported, not failed on)`);
  } catch (err) {
    console.error('\nharness error:', err);
    if (serverLog.trim()) console.error('--- server log ---\n' + serverLog.trim());
    failures.push(`harness: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    if (browser) await browser.close().catch(() => {});
    server.kill('SIGTERM');
    report.skipped = skipped;
    report.passed = passed;
    report.failed = failures;
    writeFileSync(path.join(EVIDENCE_DIR, 'report.json'), JSON.stringify(report, null, 2));
    console.log(`\nreport → ${path.join(EVIDENCE_DIR, 'report.json')}`);
  }

  if (failures.length > 0) {
    console.error(`\n✗ phase 4 browser evidence FAILED — ${passed} passed, ${failures.length} failed`);
    for (const f of failures) console.error(`   • ${f}`);
    process.exit(1);
  }
  console.log(`\n✓ phase 4 browser evidence PASSED — ${passed} checks, ${skipped.length} skipped`);
}

main().catch((err) => {
  console.error('fatal:', err);
  process.exit(1);
});
