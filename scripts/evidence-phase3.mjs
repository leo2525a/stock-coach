#!/usr/bin/env node
/**
 * Real-browser evidence for Phase 3 (§B, §D.2).
 *
 * §D.2 asks for DOM/browser evidence at 390 / 834 / 1600 px with zero console
 * errors and `prefers-reduced-motion` honoured. Those are exactly the claims a
 * unit test cannot make: jsdom has no layout engine (so "no horizontal
 * overflow" is untestable there), no real media-query engine, and no real
 * animation. So this script:
 *
 *   1. bundles the Express server with esbuild and boots it against a throwaway
 *      SQLite database (the user's real cache is untouched),
 *   2. drives the **production build** in headless Chrome over CDP,
 *   3. opens the Analysts screen and asserts each of the four sections renders
 *      real figures in **both** locales,
 *   4. measures document + container widths at 390 / 834 / 1600 px and fails on
 *      any horizontal overflow — either the document scrolling, or an element
 *      whose content is clipped with no way to scroll to it (see
 *      `measureOverflow` for the precise rule). Wide tables inside an
 *      `overflow-x:auto` wrapper scroll, so nothing is lost there.
 *   5. emulates `prefers-reduced-motion: reduce` and asserts every Phase 3
 *      transition/animation computes to `0s` — and, crucially, asserts the
 *      opposite case too, so the check cannot pass by the motion simply not
 *      existing,
 *   6. captures every console message / page error / failed request and fails
 *      on any console error,
 *   7. writes screenshots + a JSON report to `evidence/phase3/`.
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
const EVIDENCE_DIR = path.join(ROOT, 'evidence', 'phase3');
const WORK_DIR = path.join(ROOT, 'evidence', '.work-phase3');
const DIST_DIR = path.join(ROOT, 'dist');

const SYMBOL = 'AAPL';
/** The three widths §D.2 names. */
const WIDTHS = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'tablet', width: 834, height: 1112 },
  { name: 'desktop', width: 1600, height: 1000 },
];

/* ------------------------------------------------------------------ checks */

let passed = 0;
const failures = [];
/** Explicit skips: provider-dependent conditions that would otherwise hide a real bug. */
const skipped = [];

function check(label, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ''}`);
  } else {
    failures.push(`${label}${detail ? ` — ${detail}` : ''}`);
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
    if (process.env.EVIDENCE_VERBOSE) console.error(new Error('stack').stack);
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
      // `import.meta.url` is read at module scope to locate the project root and
      // ../dist; a bundled copy would resolve those against the work dir, so pin
      // it to the on-disk entry file instead.
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

/* ---------------------------------------------------------------- helpers */

/** Open a sidebar nav item, coping with the mobile drawer. */
async function clickNav(page, screenId) {
  const item = page.locator(`nav.side-nav button[data-screen="${screenId}"]`).first();
  if (!(await item.isVisible())) {
    await page.locator('.drawer-toggle').first().click();
    await page.waitForTimeout(500);
  }
  await item.click({ force: true });
  await page.waitForTimeout(250);
}

async function setLang(page, lang) {
  await page.locator(`[data-testid="lang-switch"] button[data-lang="${lang}"]`).click();
  await page.waitForTimeout(400);
}

/**
 * Measure horizontal overflow for the whole document and for every element.
 *
 * The question is only ever: *can the user reach the content?*
 *
 *   - The document itself scrolling horizontally is always a failure.
 *   - An element that is **itself** a scroller (`overflow-x: auto|scroll`) is an
 *     intended scroller — the wide data tables live in one, and everything in
 *     them is reachable by scrolling. Contained, not a failure.
 *   - An element that is **itself** an intentional clipper (`overflow-x:
 *     hidden|clip`) has made its own call — a single-line label with an
 *     ellipsis, a fixed-size chart canvas. Contained.
 *   - Only an `overflow-x: visible` element whose nearest clipping ancestor is
 *     `hidden`/`clip` (no way to scroll to the excess) is a real defect: the
 *     content is silently cut off. That is what this check exists to catch.
 */
/**
 * Read the rendered §C.4 earnings matrix straight from the visible table.
 *
 * The Change column is rendered as a percentage string, so it is parsed back to
 * a ratio; `null` is returned for an em-dash placeholder. The report keeps the
 * raw text too, so a reviewer can see exactly what the user saw.
 */
async function readMatrix(page) {
  const raw = await page.evaluate(() => {
    const table = document.querySelector('[data-testid="pf-est-matrix"]');
    if (!table) return null;
    const rows = [...table.querySelectorAll('tbody tr')];
    return rows.map((tr) =>
      [...tr.querySelectorAll('td')].map((td) => (td.textContent || '').trim()),
    );
  });
  if (raw === null) return { rows: [], raw: [] };

  const num = (s) => {
    if (s === null || s === undefined || s === '') return null;
    if (/—|暫無資料|N\/A/.test(s)) return null;
    // Take the first number and its optional compact suffix, ignoring any
    // currency token that follows (`"114.48B USD"` → 114.48e9).
    const cleaned = s.replace(/[−–]/g, '-').replace(/,/g, '');
    const m = cleaned.match(/(-?\d+(?:\.\d+)?)\s*([TBM])?/);
    if (!m) return null;
    const v = parseFloat(m[1]);
    if (!Number.isFinite(v)) return null;
    const mult = m[2] === 'T' ? 1e12 : m[2] === 'B' ? 1e9 : m[2] === 'M' ? 1e6 : 1;
    return v * mult;
  };
  const rows = raw.map((cells) => ({
    k: cells[0] ?? '',
    actual: num(cells[1]),
    forecast: num(cells[2]),
    growthText: cells[3] ?? '',
    growth: /%/.test(cells[3] ?? '') ? num(cells[3].replace('%', '')) / 100 : null,
  }));
  return { rows, raw };
}

async function measureOverflow(page) {  return page.evaluate(() => {
    const SCROLL = ['auto', 'scroll'];
    const CLIP = ['hidden', 'clip'];
    const docOverflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
    const offenders = [];
    const contained = [];
    for (const el of Array.from(document.querySelectorAll('body *'))) {
      const s = getComputedStyle(el);
      if (s.display === 'none' || s.visibility === 'hidden') continue;
      const over = el.scrollWidth - el.clientWidth;
      if (over <= 1) continue;

      const entry = {
        tag: el.tagName.toLowerCase(),
        cls: (el.className || '').toString().slice(0, 60),
        over,
      };

      // The element handles its own overflow: it scrolls or it clips.
      if (SCROLL.includes(s.overflowX) || CLIP.includes(s.overflowX)) {
        contained.push({ ...entry, by: 'self' });
        continue;
      }

      // Visible element: find who clips it.
      let anc = el.parentElement;
      let stop = null;
      while (anc && anc !== document.documentElement) {
        const acs = getComputedStyle(anc);
        if (SCROLL.includes(acs.overflowX) || CLIP.includes(acs.overflowX)) {
          stop = acs.overflowX;
          break;
        }
        anc = anc.parentElement;
      }
      if (stop !== null && SCROLL.includes(stop)) {
        contained.push({ ...entry, by: stop });
      } else {
        // Clipped by a non-scrolling ancestor, or escapes to the document.
        offenders.push({ ...entry, clippedBy: stop });
      }
    }
    return {
      docOverflow,
      innerWidth: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      offenders: offenders.slice(0, 8),
      contained: contained.slice(0, 8),
    };
  });
}

/**
 * Sample the computed transition/animation durations of the Phase 3 controls.
 *
 * Returns the *max* duration in seconds so a single non-zero rule is visible;
 * a reduced-motion user must see 0 everywhere.
 */
async function motionSample(page) {
  return page.evaluate(() => {
    const selectors = ['.pf-act-btn', '.pf-seg button', '.side-item', '.pf-section-toggle', '.pf-caret'];
    const out = {};
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (!el) {
        out[sel] = null;
        continue;
      }
      const s = getComputedStyle(el);
      const durations = [
        ...s.transitionDuration.split(','),
        ...s.animationDuration.split(','),
      ]
        .map((d) => d.trim())
        .map((d) => (d.endsWith('ms') ? parseFloat(d) / 1000 : parseFloat(d) || 0));
      out[sel] = Math.max(0, ...durations);
    }
    return out;
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
  mkdirSync(EVIDENCE_DIR, { recursive: true });

  console.log('bundling server…');
  const serverBundle = await bundleServer();

  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const dbPath = path.join(WORK_DIR, 'phase3.db');

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
    symbol: SYMBOL,
    widths: WIDTHS.map((w) => w.width),
    screenshots: [],
    overflow: [],
    motion: null,
    sections: {},
    locales: {},
    consoleErrors: [],
    consoleWarnings: [],
    pageErrors: [],
    failedRequests: [],
    skipped: [],
  };

  try {
    const health = await waitForHealth(baseUrl);
    console.log(`server up on ${baseUrl} (${health.service})`);

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

    // Phase 5: pin dark so the colour expectations stay the dark tokens (the app
    // now follows the OS preference; Playwright defaults to light).
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
    page.on('requestfailed', (req) => {
      failedRequests.push(`${req.method()} ${req.url()} — ${req.failure()?.errorText ?? 'unknown'}`);
    });

    /* ------------------------------ app boot ------------------------------ */
    section('app boot');
    const resp = await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    check('index.html is served', resp?.status() === 200, `HTTP ${resp?.status()}`);
    await page.waitForSelector('[data-testid="dashboard-screen"]', { timeout: 25_000 });
    // The headline row (ex-TopBar) now lives on the chart screen.
    await clickNav(page, 'chart');
    await page.waitForFunction(
      () => document.querySelector('[data-testid="topbar-symbol"] .sym')?.textContent?.trim() === 'AAPL',
      null,
      { timeout: 25_000 },
    );
    check('the app boots with live data', true, 'AAPL');

    /* ---------------------- analysts screen: en + zh ---------------------- */
    section('§C — the Analysts screen renders real figures in both locales');
    await clickNav(page, 'analysts');
    await page.waitForSelector('[data-testid="analysts-screen"]', { timeout: 20_000 });

    // Wait for the analyst bundle to settle (no loading state left).
    await page
      .waitForFunction(
        () => {
          const el = document.querySelector('[data-testid="pf-state"]') || document.querySelector('[data-testid="pf-load-state"]');
          if (!el) return true;
          const t = (el.textContent || '').trim();
          return !/載入|Loading/i.test(t);
        },
        null,
        { timeout: 30_000 },
      )
      .catch(() => {});
    await page.waitForTimeout(1200);

    /** Assert the four sections render and carry real (non-dash) figures. */
    const checkSections = async (label, screenshotName) => {
      const present = {
        overview: await page.locator('[data-testid="pf-overview"]').count(),
        recap: await page.locator('[data-testid="pf-recap"]').count(),
      };
      check(`${label}: the company header renders`, present.overview > 0);
      check(`${label}: the recap strip renders`, present.recap > 0);

      const headerText = (await page.locator('[data-testid="pf-overview"]').innerText()).trim();
      check(`${label}: the header carries a real price`, /\d/.test(headerText), headerText.replace(/\n/g, ' ').slice(0, 60));

      // The sector/industry tags are **provider-dependent**: Yahoo's
      // `quoteSummary` carries them for most but not all symbols, and the UI
      // deliberately omits the tag when the provider has nothing rather than
      // inventing a classification (§D.5). So this cannot be an unconditional
      // assertion — that would fail honestly-correct behaviour. It is verified
      // the honest way instead: the tag is present **iff** it carries a real
      // value, and a missing tag is reported as an explicit provider-dependent
      // skip rather than silently passed.
      const sectorTag = await page.locator('[data-testid="pf-sector"]').count();
      const sectorText = sectorTag ? (await page.locator('[data-testid="pf-sector"]').innerText()).trim() : '';
      if (sectorTag > 0) {
        check(
          `${label}: the sector tag carries a real, non-empty classification`,
          sectorText.length > 0,
          sectorText,
        );
      } else {
        // Skipped, not passed: name the reason and the condition that would make
        // it fail. An empty tag rendered from a present-but-blank provider field
        // would be a real bug; an absent tag is honest.
        skipped.push(
          `${label}: sector tag absent — provider carried no sector for ${SYMBOL} this run (honest omission, §D.5)`,
        );
      }
      report.sections[`${label}/sector`] = { present: sectorTag > 0, text: sectorText };

      // Open every collapsible section so the deep content is actually mounted.
      const toggles = page.locator('.pf-section-toggle');
      const n = await toggles.count();
      // §C.2-C.6 are three collapsible sections (Statements, Estimates,
      // Ratings); §C.1 is the always-visible header + actions. Assert all three
      // areas are present rather than pinning an exact count, which would fail
      // the moment a legitimate fourth area is added.
      check(
        `${label}: the three §C.2-C.6 sections are all collapsible`,
        n >= 3,
        `${n} collapsible section(s)`,
      );
      for (const id of ['statements', 'estimates', 'ratings']) {
        check(
          `${label}: the ${id} section exists`,
          (await page.locator(`[data-testid="pf-section-${id}"]`).count()) > 0,
        );
      }
      for (let i = 0; i < n; i += 1) {
        const caret = toggles.nth(i);
        const isOpen = await caret.evaluate((el) => el.closest('.pf-section')?.classList.contains('open'));
        if (!isOpen) {
          await caret.click();
          await page.waitForTimeout(500);
        }
      }
      await page.waitForTimeout(600);

      // Each §C area must be present with a real data hook. But "present" has an
      // honest second form: when the provider returns a thin/empty bundle (a
      // throttled run), the panel renders its explicit empty state instead of
      // invented figures. §D.5 requires that, so the check accepts **either** a
      // populated hook set **or** the matching honest placeholder, and records
      // which one it saw. A blank panel satisfies neither, and fails.
      const areaHooks = {
        '§C.1 header': {
          hooks: ['pf-overview', 'pf-facts'],
          honest: [], // the header renders whenever a quote exists; always required
        },
        '§C.1 actions': {
          hooks: ['pf-actions', 'pf-watch', 'pf-note-save', 'pf-alert-current'],
          honest: [],
        },
        '§C.2 statements': {
          hooks: ['pf-stmt-period', 'pf-metrics'],
          honest: ['pf-stmt-none', 'pf-stmt-error'],
        },
        '§C.3 actuals vs consensus': {
          hooks: ['pf-currency-switch'],
          honest: [],
        },
        '§C.4 NTM': {
          hooks: ['pf-ntm', 'pf-ntm-level'],
          honest: ['pf-est-none'],
        },
        '§C.5 targets & ratings': {
          hooks: ['pf-band', 'pf-band-facts', 'pf-dist', 'pf-rec-mean'],
          honest: ['pf-rat-none'],
        },
      };
      for (const [area, spec] of Object.entries(areaHooks)) {
        const missing = [];
        for (const id of spec.hooks) {
          if ((await page.locator(`[data-testid="${id}"]`).count()) === 0) missing.push(id);
        }
        const honestShown = [];
        for (const id of spec.honest) {
          if ((await page.locator(`[data-testid="${id}"]`).count()) > 0) honestShown.push(id);
        }
        const mode = missing.length === 0 ? 'populated' : honestShown.length ? 'honest-empty' : 'missing';
        report.sections[`${label}/${area}`] = { mode, missing, honestShown };
        check(
          `${label}: ${area} renders`,
          mode !== 'missing',
          mode === 'populated'
            ? `${spec.hooks.length} hooks`
            : mode === 'honest-empty'
              ? `honest placeholder ${honestShown.join(', ')} (provider bundle was thin this run)`
              : `missing ${missing.join(', ')} and no honest placeholder`,
        );
      }

      // Statements: real reported figures, and a per-cell finite-or-dash rule.
      // The table rows are required **only** when the statement panel is in its
      // populated mode; a thin provider bundle legitimately renders the honest
      // empty state instead, which the §C.2 area check above already accepted.
      const stmtPopulated = report.sections[`${label}/§C.2 statements`]?.mode === 'populated';
      const stmtRows = await page.locator('.pf-section .pf-table tbody tr, .pf-section table tbody tr').count();
      if (stmtPopulated) {
        check(`${label}: the statement tables render rows`, stmtRows > 0, `${stmtRows} rows`);
      } else {
        skipped.push(`${label}: statement tables empty — provider bundle thin this run (honest empty state shown)`);
      }
      const tableText = (await page.locator('[data-testid="analysts-screen"]').innerText()).trim();
      check(`${label}: the screen shows real digits somewhere (price or tables)`, /\d/.test(tableText));

      // Every metric exposes a formula on hover (§A.3) — only when metrics exist.
      const metricCells = await page.locator('[data-testid="pf-metrics"] [title]').count();
      if (stmtPopulated) {
        check(`${label}: derived metrics expose their formula on hover`, metricCells > 0, `${metricCells} titled cells`);
      }

      // Honesty: whatever the provider gave, the screen must never invent a
      // figure — a missing value is an explicit `—`/`暫無資料`, never blank, and
      // never a fabricated `0`.
      const hasPlaceholder = /暫無資料|—/.test(tableText);
      check(
        `${label}: any missing figure is an explicit placeholder, never blank`,
        stmtPopulated ? true : hasPlaceholder,
        stmtPopulated ? 'not needed: tables populated' : hasPlaceholder ? 'placeholder present' : 'NO placeholder in a thin run',
      );

      // A statement fetch *error* is not an acceptable terminal state in this
      // run — the honest thin-bundle path uses the empty state, not an error.
      const errorsBox = await page.locator('[data-testid="pf-stmt-error"]').count();
      check(`${label}: no statement error banner is shown`, errorsBox === 0);

      report.sections[label] = { rows: stmtRows, titledMetricCells: metricCells, stmtPopulated };
      if (screenshotName) {
        await page.screenshot({ path: path.join(EVIDENCE_DIR, screenshotName), fullPage: true });
        report.screenshots.push(screenshotName);
      }
    };

    await page.waitForTimeout(500);
    await checkSections('zh-HK', '01-analysts-zh-HK.png');

    await setLang(page, 'en');
    await page.waitForTimeout(900);
    await checkSections('en', '02-analysts-en.png');
    const enText = await page.locator('[data-testid="analysts-screen"]').innerText();
    check('the EN locale renders Latin copy, not Chinese', /[A-Za-z]{4,}/.test(enText));
    check('the EN section titles are localised', /Statements|Estimates|Ratings|Overview/i.test(enText));

    await setLang(page, 'zh-HK');
    await page.waitForTimeout(900);
    const zhText = await page.locator('[data-testid="analysts-screen"]').innerText();
    check('the zh-HK locale renders Chinese copy', /[\u3400-\u9fff]/.test(zhText));
    check('the two locales render genuinely different strings', enText !== zhText);
    report.locales = { en: /[A-Za-z]{4,}/.test(enText), zh: /[\u3400-\u9fff]/.test(zhText) };

    /* ------------ §C.4 matrix: the basis must be honest (§D.5) ----------- */
    // Independent verification (2026-11-06) found the matrix could compare an
    // ANNUAL actual against a QUARTERLY forecast — a fabricated −67.5%. The
    // browser run never touched the matrix, so it is asserted here now.
    section('§C.4 — the earnings matrix compares like-for-like');
    // Assert the payload the API actually served (unrounded, with its declared
    // basis), and separately that the screen rendered that matrix to the user.
    const estJson = await (await fetch(`${baseUrl}/api/estimates/AAPL`)).json().catch(() => null);
    const apiMatrix = estJson?.data?.matrix ?? [];
    // Reload the SPA so its store reflects the now-guaranteed quarterly-backed
    // matrix, then navigate back to the Analysts screen. Without this the page's
    // estimates may have been fetched before the quarter landed and the rendered
    // check would race (found on the first run of this check, 2026-11-06).
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="dashboard-screen"]', { timeout: 25_000 }).catch(() => {});
    await clickNav(page, 'analysts');
    await page.waitForSelector('[data-testid="analysts-screen"]', { timeout: 20_000 }).catch(() => {});
    await page.waitForSelector('[data-testid="pf-est-matrix"]', { timeout: 25_000 }).catch(() => {});
    await page.waitForTimeout(600);
    const domMatrix = await readMatrix(page);
    report.matrix = { api: apiMatrix, domRows: domMatrix.rows };
    if (apiMatrix.length === 0) {
      skipped.push('§C.4 matrix empty — provider carried no eps/revenue consensus this run (honest empty state)');
    } else {
      const badBasis = apiMatrix.filter((r) => r.basis !== 'quarter');
      check(
        '§C.4 every matrix row declares a single-quarter basis',
        badBasis.length === 0,
        badBasis.length ? badBasis.map((r) => `${r.labelKey} basis=${r.basis}`).join(', ') : 'all rows basis=quarter',
      );
      // The determinant of the original bug: growth that is not exactly the
      // quarter-vs-quarter change of the two numbers actually shown.
      const badGrowth = apiMatrix.filter((r) => {
        if (r.actual === null || r.forecast === null || r.actual === 0) return r.growth !== null;
        return Math.abs(r.growth - (r.forecast - r.actual) / Math.abs(r.actual)) > 1e-9;
      });
      check(
        '§C.4 the Change column is the quarter-vs-quarter change of the shown cells',
        badGrowth.length === 0,
        badGrowth.length ? badGrowth.map((r) => r.labelKey).join(', ') : 'every growth recomputes',
      );
      // The exact determinant of the original bug: the actual must never BE the
      // annual figure. (The ratio heuristic alone is too weak — the real bug's
      // ratio was 478.8/155.6 ≈ 3.1, and a seasonal quarter can legitimately be
      // 3× another. Equality with the annual figure is unambiguous.)
      const annualJson = await (await fetch(`${baseUrl}/api/statements/AAPL?period=annual`)).json().catch(() => null);
      const ai = annualJson?.data?.inputs ?? null;
      const annualByRow = {
        'pf.matrix.revenue': ai?.revenue ?? null,
        'pf.matrix.ebitda': ai?.ebitda ?? null,
        'pf.matrix.ebit': ai?.ebit ?? null,
        'pf.matrix.eps': ai?.dilutedEps ?? null,
      };
      const asAnnual = apiMatrix.filter(
        (r) => annualByRow[r.labelKey] !== null && r.actual !== null && r.actual === annualByRow[r.labelKey],
      );
      check(
        '§C.4 no actual is the annual figure standing in for a quarter',
        asAnnual.length === 0,
        asAnnual.length ? asAnnual.map((r) => r.labelKey).join(', ') : 'no actual equals the annual figure',
      );
      const asOfShown = await page.locator('[data-testid="pf-est-matrix-asof"]').count();
      check('§C.4 the matrix states which quarter the actual is from', asOfShown > 0, `${asOfShown} caption(s)`);

      // And the screen actually rendered that payload: same rows, and every
      // populated actual in the API is populated on screen (and a null is a dash).
      // Correctness of the numbers is asserted above against the API; this asserts
      // the screen is not showing something else.
      check(
        '§C.4 the rendered matrix has one row per metric',
        domMatrix.rows.length === apiMatrix.length,
        `dom=${domMatrix.rows.length} api=${apiMatrix.length}`,
      );
      const domMismatch = domMatrix.rows.filter((d, i) => {
        const a = apiMatrix[i];
        if (!a) return true;
        const domPopulated = d.actual !== null;
        const apiPopulated = a.actual !== null;
        if (domPopulated !== apiPopulated) return true;
        // When both are populated they must be the same figure (the DOM is the
        // compact rendering of the API number, within display rounding).
        return domPopulated && Math.abs(d.actual - a.actual) / Math.abs(a.actual) > 0.02;
      });
      check(
        '§C.4 every rendered row matches the API payload',
        domMismatch.length === 0,
        domMismatch.length
          ? domMismatch.map((d, i) => `${d.k} dom=${d.actual} api=${apiMatrix[i]?.actual}`).join(', ')
          : 'rendered rows agree with the API',
      );
    }

    /* ------------------- §B.2 motion + reduced motion --------------------- */
    section('§B.2 — motion exists, and reduced-motion removes all of it');
    // First: without a preference, the controls must actually be animated —
    // otherwise the reduced-motion check below would pass vacuously.
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.waitForTimeout(300);
    const normal = await motionSample(page);
    report.motion = { normal, reduced: null };
    const animated = Object.entries(normal).filter(([, v]) => v !== null && v > 0);
    check(
      'Phase 3 controls carry real (non-zero) motion when the user allows it',
      animated.length > 0,
      animated.map(([k, v]) => `${k}=${v}s`).join(', ') || 'none',
    );
    const budgetViolators = Object.entries(normal).filter(([, v]) => v !== null && v > 0.4);
    check(
      'no control exceeds the 400 ms subtle-motion budget',
      budgetViolators.length === 0,
      budgetViolators.map(([k, v]) => `${k}=${v}s`).join(', ') || 'within budget',
    );

    // Now emulate the preference: every duration must collapse to 0.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForTimeout(400);
    const reduced = await motionSample(page);
    report.motion.reduced = reduced;
    const stillMoving = Object.entries(reduced).filter(([, v]) => v !== null && v > 0);
    check(
      'prefers-reduced-motion: reduce removes every Phase 3 transition/animation',
      stillMoving.length === 0,
      stillMoving.map(([k, v]) => `${k}=${v}s`).join(', ') || 'all controls at 0s',
    );
    check(
      'the reduced-motion sample covered the same controls as the normal one',
      Object.keys(reduced).join() === Object.keys(normal).join(),
    );

    // §B.1: the shared focus ring must appear on **keyboard** focus. Note the
    // selector is `:focus-visible`, which deliberately does not match a
    // programmatic `.focus()` — real keyboard navigation is required, so drive
    // Tab from the document body rather than calling focus().
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.waitForTimeout(200);
    await page.evaluate(() => document.body.focus());
    let focusRing = null;
    for (let i = 0; i < 60 && !focusRing; i += 1) {
      await page.keyboard.press('Tab');
      await page.waitForTimeout(30);
      focusRing = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return null;
        if (!el.matches('.pf-act-btn, .pf-seg button, .pf-screen button, .side-item')) return null;
        const s = getComputedStyle(el);
        if (s.outlineStyle === 'none' || parseFloat(s.outlineWidth) < 1) return null;
        return {
          cls: (el.className || '').toString().slice(0, 40),
          outlineWidth: s.outlineWidth,
          outlineStyle: s.outlineStyle,
          outlineColor: s.outlineColor,
        };
      });
    }
    check(
      'a keyboard-focused control shows a real focus ring',
      !!focusRing,
      focusRing ? `${focusRing.cls} → ${focusRing.outlineWidth} ${focusRing.outlineStyle}` : 'no focused control carried an outline',
    );
    await page.screenshot({ path: path.join(EVIDENCE_DIR, '03-focus-ring.png') });

    /* ------------------- §D.2 responsive at 390/834/1600 ------------------ */
    section('§D.2 — no horizontal overflow at 390 / 834 / 1600 px');
    for (const vp of WIDTHS) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.waitForTimeout(700);
      // Re-open the sections if the narrow layout collapsed them.
      const toggles = page.locator('.pf-section-toggle');
      const n = await toggles.count();
      for (let i = 0; i < n; i += 1) {
        const caret = toggles.nth(i);
        const isOpen = await caret.evaluate((el) => el.closest('.pf-section')?.classList.contains('open'));
        if (!isOpen) {
          await caret.click({ force: true });
          await page.waitForTimeout(300);
        }
      }
      await page.waitForTimeout(500);

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
      // Contained overflow is intended: self-clipping labels/charts, and wide
      // tables inside a scrolling wrapper. Recorded for the audit trail.
      console.log(
        `  · ${vp.width}px: ${m.contained.length} contained element(s) (self-scrolling table wrappers, ellipsis labels, chart canvases)`,
      );

      const file = `04-responsive-${vp.name}-${vp.width}.png`;
      await page.screenshot({ path: path.join(EVIDENCE_DIR, file), fullPage: true });
      report.screenshots.push(file);

      // §C.5/§C.4: the ten-option span control must keep every option reachable
      // at any width. This is the direct regression test for the clipped
      // `Segmented` found at 390px — assert each option is laid out inside the
      // viewport, not merely present in the DOM.
      const segReach = await page.evaluate(() => {
        const out = [];
        for (const grp of Array.from(document.querySelectorAll('[data-testid="pf-ntm-span"], [data-testid="pf-band-span"]'))) {
          const box = grp.getBoundingClientRect();
          const btns = Array.from(grp.querySelectorAll('button'));
          const outside = btns.filter((b) => {
            const r = b.getBoundingClientRect();
            return r.left < -1 || r.right > window.innerWidth + 1;
          });
          out.push({
            id: grp.getAttribute('data-testid'),
            options: btns.length,
            groupRight: Math.round(box.right),
            viewport: window.innerWidth,
            outside: outside.length,
          });
        }
        return out;
      });
      for (const g of segReach) {
        check(
          `${vp.width}px: every option of ${g.id} (${g.options}) is inside the viewport`,
          g.outside === 0,
          `${g.outside} outside; group right edge ${g.groupRight} vs viewport ${g.viewport}`,
        );
      }
      report.overflow[report.overflow.length - 1].segmented = segReach;

      // The screen must still be the Analysts screen (no accidental nav reset).
      check(
        `the Analysts screen is still mounted at ${vp.width}px`,
        (await page.locator('[data-testid="analysts-screen"]').count()) > 0,
      );
    }

    /* --------------------------- §C.1 quick actions ----------------------- */
    section('§B.1 — quick actions are reachable and labelled');
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.waitForTimeout(400);
    const csvBtn = page.locator('[data-testid="pf-export-csv"]').first();
    check('an export-CSV control exists', (await csvBtn.count()) > 0);
    const jsonBtn = page.locator('[data-testid="pf-export-json"]').first();
    check('an export-JSON control exists', (await jsonBtn.count()) > 0);
    const csvLabel = (await csvBtn.innerText().catch(() => '')).trim();
    check('the export control has a visible label', csvLabel.length > 0, csvLabel);

    // Clicking export must surface the courtesy message, not throw.
    await csvBtn.click({ force: true });
    await page.waitForTimeout(600);
    check(
      'exporting shows a courtesy confirmation',
      (await page.locator('[data-testid="pf-export-flash"]').count()) > 0,
    );
    await page.screenshot({ path: path.join(EVIDENCE_DIR, '05-export-flash.png') });

    /* ------------------------------ console ------------------------------- */
    section('console hygiene');
    report.consoleErrors = consoleErrors;
    report.consoleWarnings = consoleWarnings;
    report.pageErrors = pageErrors;
    report.failedRequests = failedRequests;
    report.skipped = skipped;
    check('zero console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | ') || 'none');
    check('zero uncaught page errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | ') || 'none');
    // A failed *request* that the app handles (a 404 on an uncovered symbol) is
    // not a console error; only an unhandled one would be. Report for the record.
    console.log(`  · ${consoleWarnings.length} console warning(s), ${failedRequests.length} failed request(s) (informational)`);

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
  if (skipped.length) {
    console.log(`· ${skipped.length} provider-dependent check(s) skipped (not failures):`);
    for (const s of skipped) console.log(`   ◦ ${s}`);
  }
  if (failures.length === 0) {
    console.log(`✓ phase 3 browser evidence PASSED — ${passed} checks, ${skipped.length} skipped. Artifacts in evidence/phase3/`);
    process.exit(0);
  }
  console.error(`✗ phase 3 browser evidence FAILED — ${passed} passed, ${failures.length} failed`);
  for (const f of failures) console.error(`   • ${f}`);
  process.exit(1);
}

main().catch((err) => {
  console.error('fatal:', err);
  process.exit(1);
});
