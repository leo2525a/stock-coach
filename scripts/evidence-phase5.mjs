#!/usr/bin/env node
/**
 * Real-browser evidence for Phase 5 — the UI/UX pass the owner asked for:
 *
 *   ① sidebar-only navigation  · ② comfortable responsive layout
 *   ③ light + day/night switch  · ④ app (installable PWA) form
 *
 * Each of those is a claim about what a *browser* paints, so each is measured
 * in a real browser against the **production build** — not asserted from the
 * source. In particular:
 *
 *   - the day/night switch is proven by the **computed** `--bg`/`data-theme`
 *     *and* by the colour a `lightweight-charts` **canvas** actually renders to
 *     (`getImageData`), because the canvas is drawn by JS and a CSS-only change
 *     would leave it dark on a light page. The same sample is asserted to be
 *     the *opposite* colour after flipping back, so the check cannot pass by
 *     the canvas simply not repainting or by sampling a constant.
 *   - "sidebar-only" is proven by the top bar rendering **no** `<nav>` *and* by
 *     every one of the app's screens still being reachable through the sidebar.
 *   - "comfortable on phones" is proven by zero horizontal overflow *and* a
 *     minimum content padding / touch-target size at 320/390/768 px.
 *   - "app form" is proven by fetching the manifest and the service worker the
 *     browser is actually offered.
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
const EVIDENCE_DIR = path.join(ROOT, 'evidence', 'phase5');
const WORK_DIR = path.join(ROOT, 'evidence', '.work-phase5');
const DIST_DIR = path.join(ROOT, 'dist');

const HEX = {
  darkBg: '#0d1117',
  lightBg: '#f6f8fa',
  darkChart: '#161b22',
  lightChart: '#ffffff',
};

const WIDTHS = [
  { name: 'small-phone', width: 320, height: 640 },
  { name: 'phone', width: 390, height: 844 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1600, height: 1000 },
];

/** Every screen the app ships; the sidebar must reach all of them. */
const SCREENS = ['dashboard', 'chart', 'signals', 'watchlist', 'analysts', 'dividends', 'help'];

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
  }
}

function section(name) {
  console.log(`\n── ${name}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------------------------------------------------------- harness -- */

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

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Per-channel closeness; tolerant of antialiasing/compression. */
function closeTo(rgb, hex, tol = 14) {
  const t = hexToRgb(hex);
  return rgb.every((v, i) => Math.abs(v - t[i]) <= tol);
}

/** `#rgb` / `#rrggbb` / `rgb(a, b, c)` / `rgba(a, b, c, d)` → [r,g,b], or null.
 *
 * BOTH forms must be handled: `getComputedStyle().getPropertyValue('--bg')`
 * returns a custom property *as authored* (a hex like `#f6f8fa`), while a resolved
 * colour (`getComputedStyle(el).backgroundColor`) is `rgb(...)`. An earlier
 * version only matched the latter and — combined with `?? []` at the call sites
 * — turned every hex comparison into a vacuous pass. Found 2026-11-07 by the
 * independent Phase-5 QA (mutation `light-bg-dark` passed 53/53 against a black
 * light-mode page). */
function parseRgb(s) {
  const v = (s || '').trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v);
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].replace(/(.)/g, '$1$1') : hex[1];
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  const m = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(v);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/**
 * Assert a computed colour equals an expected hex, failing closed: an
 * unparseable value (e.g. a bare `var(...)` fallback leaking through) is a
 * FAILURE, never a vacuous pass.
 */
function checkColor(label, value, expectedHex, tol = 14) {
  const rgb = parseRgb(value);
  if (!rgb) {
    check(label, false, `could not parse a colour from ${JSON.stringify(value)}`);
    return;
  }
  check(label, closeTo(rgb, expectedHex, tol), `${value} (≠ ${expectedHex})`);
}

/** The current paint: data-theme, colorScheme and the computed background. */
async function paintState(page) {
  return page.evaluate(() => {
    const root = document.documentElement;
    const cs = getComputedStyle(root);
    const bg = cs.getPropertyValue('--bg').trim();
    const chartBg = cs.getPropertyValue('--chart-bg').trim();
    const meta = document.querySelector('meta[name="theme-color"]');
    return {
      theme: root.getAttribute('data-theme'),
      colorScheme: root.style.colorScheme || cs.colorScheme,
      bg,
      chartBg,
      themeColor: meta?.getAttribute('content') ?? null,
      toggleCurrent: document.querySelector('[data-testid="theme-toggle"]')?.getAttribute('data-theme-current') ?? null,
    };
  });
}

/**
 * The colour a chart canvas actually renders to.
 *
 * A `lightweight-charts` canvas is painted by JS, so its pixels are the only
 * honest answer to "did the chart follow the theme?". We sample a grid and
 * return the **modal** colour: the background dominates any candles/gridlines,
 * so the mode is the chart background even with data on screen.
 */
async function dominantCanvasColor(page, testId) {
  return page.evaluate((id) => {
    const canvas = document.querySelector(`[data-testid="${id}"] canvas`);
    if (!canvas) return { error: 'no canvas' };
    const ctx = canvas.getContext('2d');
    if (!ctx) return { error: 'no 2d context' };
    const { width, height } = canvas;
    if (!width || !height) return { error: 'zero-size canvas' };
    let data;
    try {
      data = ctx.getImageData(0, 0, width, height).data;
    } catch (e) {
      return { error: `getImageData: ${e.message}` };
    }
    const counts = new Map();
    // Deterministic grid across the whole plot; opacity is ignored.
    for (let y = 0; y < height; y += 7) {
      for (let x = 0; x < width; x += 7) {
        const i = (y * width + x) * 4;
        const key = `${data[i]},${data[i + 1]},${data[i + 2]}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
    let best = null;
    let bestN = -1;
    for (const [k, n] of counts) if (n > bestN) [best, bestN] = [k, n];
    const [r, g, b] = best.split(',').map(Number);
    return { rgb: [r, g, b], samples: [...counts.values()].reduce((a, c) => a + c, 0) };
  }, testId);
}

async function measureOverflow(page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    return {
      scrollWidth: Math.max(doc.scrollWidth, document.body.scrollWidth),
      innerWidth: window.innerWidth,
      docOverflow: Math.max(doc.scrollWidth, document.body.scrollWidth) - window.innerWidth,
    };
  });
}

async function clickNav(page, screenId) {
  const item = page.locator(`nav.side-nav button[data-screen="${screenId}"]`).first();
  if (!(await item.isVisible())) {
    await page.locator('.drawer-toggle').first().click().catch(() => {});
    await page.waitForTimeout(400);
  }
  await item.click({ force: true });
  await page.waitForTimeout(350);
}

/** Reload with a given OS colour-scheme and stored theme mode. */
async function bootWith(page, baseUrl, { colorScheme, storedMode }) {
  await page.emulateMedia({ colorScheme });
  await page.evaluate((mode) => {
    localStorage.clear();
    if (mode) localStorage.setItem('stockcoach.theme', mode);
  }, storedMode ?? null).catch(() => {});
  await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForSelector('[data-testid="dashboard-screen"]', { timeout: 25_000 });
  await page.waitForTimeout(250);
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
  const dbPath = path.join(WORK_DIR, 'phase5.db');

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
    widths: WIDTHS.map((w) => w.width),
    theme: {},
    nav: {},
    responsive: [],
    pwa: {},
    screenshots: [],
    consoleErrors: [],
    pageErrors: [],
    failedRequests: [],
    skipped: [],
  };

  const consoleErrors = [];
  const pageErrors = [];
  const failedRequests = [];

  try {
    const health = await waitForHealth(baseUrl);
    console.log(`server up on ${baseUrl} (${health.service})`);

    const executablePath = process.env.CHROME_PATH || findChrome();
    if (!executablePath) throw new Error('no Chrome binary found; set CHROME_PATH');
    console.log(`chrome: ${executablePath}`);

    browser = await chromium.launch({ executablePath, headless: true, args: ['--hide-scrollbars', '--mute-audio'] });
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: 'dark' });
    const page = await context.newPage();

    page.on('console', (msg) => {
      const text = `${msg.text()}`;
      const loc = msg.location();
      const where = loc?.url ? ` (${loc.url}:${loc.lineNumber})` : '';
      if (msg.type() === 'error') consoleErrors.push(`${text}${where}`);
    });
    page.on('pageerror', (err) => pageErrors.push(err.message));
    page.on('requestfailed', (req) =>
      failedRequests.push(`${req.method()} ${req.url()} — ${req.failure()?.errorText ?? 'unknown'}`),
    );

    /* ------------------------------ app boot ------------------------------ */
    section('app boot');
    let resp = await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    check('index.html is served', resp?.status() === 200, `HTTP ${resp?.status()}`);
    await page.waitForSelector('[data-testid="dashboard-screen"]', { timeout: 25_000 });
    check('the dashboard boots', true);

    /* ------------------- ② sidebar-only navigation ------------------------ */
    section('② navigation is the sidebar (no top bar at all)');
    // Owner (38/100): the logo bar is gone — brand + global controls now live in
    // the sidebar. Navigation is still the sidebar's job alone.
    const topBarCount = await page.locator('header.topbar').count();
    check('there is no top bar (the logo bar was removed)', topBarCount === 0, `${topBarCount} found`);
    const topNav = await page.locator('header.topbar nav').count();
    check('the sidebar is the only navigation (no <nav> in a top bar)', topNav === 0, `${topNav} found`);
    const sideBtns = await page.locator('nav.side-nav button[data-screen]').count();
    check('the sidebar exposes every screen', sideBtns === SCREENS.length, `${sideBtns} of ${SCREENS.length}`);

    const reached = {};
    for (const id of SCREENS) {
      await clickNav(page, id);
      const sel = `[data-testid="${id}-screen"]`;
      const ok = await page
        .waitForSelector(sel, { timeout: 15_000 })
        .then(() => true)
        .catch(() => false);
      reached[id] = ok;
      check(`screen "${id}" is reachable from the sidebar`, ok);
    }
    report.nav = { topBarCount, topNavCount: topNav, sidebarButtons: sideBtns, reached };

    /* ------------------- ③ theme: dark → light → persist → canvas --------- */
    section('③ day/night theme (switch, persistence, and the canvas itself)');

    // Start from a clean dark boot (no stored choice, OS = dark).
    await bootWith(page, baseUrl, { colorScheme: 'dark', storedMode: null });
    let st = await paintState(page);
    report.theme.bootDark = st;
    check('OS dark + no choice → <html data-theme="dark">', st.theme === 'dark', st.theme);
    checkColor('the dark theme is actually painted (--bg is dark)', st.bg, HEX.darkBg);
    check('the toggle reflects dark', st.toggleCurrent === 'dark', st.toggleCurrent);
    check('theme-color meta is dark', st.themeColor === HEX.darkBg, st.themeColor);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, '01-dark.png'), fullPage: false });
    report.screenshots.push('01-dark.png');

    // Flip to light via the button.
    await page.locator('[data-testid="theme-toggle"]').click();
    await page.waitForTimeout(300);
    st = await paintState(page);
    report.theme.afterToggle = st;
    check('the toggle flips the document to light', st.theme === 'light', st.theme);
    checkColor('light paints a light background', st.bg, HEX.lightBg);
    check('colorScheme reports light (native chrome follows)', /light/.test(st.colorScheme || ''), st.colorScheme);
    check('the toggle now reflects light', st.toggleCurrent === 'light', st.toggleCurrent);
    check('theme-color meta switched to white', st.themeColor === HEX.lightChart, st.themeColor);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, '02-light.png'), fullPage: false });
    report.screenshots.push('02-light.png');

    // Persistence across a reload (same OS scheme).
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="dashboard-screen"]', { timeout: 25_000 });
    st = await paintState(page);
    check('the light choice survives a reload', st.theme === 'light', st.theme);

    // ★ The chart canvas must follow the theme. This is the whole reason the
    //   chart is drawn with a JS palette instead of CSS alone.
    section('③★ the chart canvas repaints with the theme (independent pixel check)');
    await clickNav(page, 'chart');
    await page.waitForSelector('[data-testid="chart-screen"]', { timeout: 20_000 });
    await page.waitForSelector('[data-testid="chart-canvas"] canvas', { timeout: 20_000 }).catch(() => {});
    await sleep(600);

    const lightCanvas = await dominantCanvasColor(page, 'chart-canvas');
    report.theme.lightCanvas = lightCanvas;
    if (lightCanvas.error) {
      check('the chart canvas is readable', false, lightCanvas.error);
    } else {
      check(
        'in light mode the chart canvas paints the LIGHT background',
        closeTo(lightCanvas.rgb, HEX.lightChart),
        `rgb(${lightCanvas.rgb.join(',')})`,
      );
    }

    // Flip back to dark and re-measure. Both directions must move.
    await page.locator('[data-testid="theme-toggle"]').click();
    await page.waitForTimeout(600);
    st = await paintState(page);
    check('toggling back returns the document to dark', st.theme === 'dark', st.theme);
    const darkCanvas = await dominantCanvasColor(page, 'chart-canvas');
    report.theme.darkCanvas = darkCanvas;
    if (darkCanvas.error) {
      check('the chart canvas is readable (dark)', false, darkCanvas.error);
    } else {
      check(
        'in dark mode the chart canvas paints the DARK background',
        closeTo(darkCanvas.rgb, HEX.darkChart),
        `rgb(${darkCanvas.rgb.join(',')})`,
      );
      if (!lightCanvas.error) {
        check(
          'the canvas colour actually changed between themes (not a constant)',
          JSON.stringify(lightCanvas.rgb) !== JSON.stringify(darkCanvas.rgb),
          `light rgb(${lightCanvas.rgb.join(',')}) vs dark rgb(${darkCanvas.rgb.join(',')})`,
        );
      }
    }
    await page.screenshot({ path: path.join(EVIDENCE_DIR, '03-chart-dark.png'), fullPage: false });
    report.screenshots.push('03-chart-dark.png');

    // `system` must follow the OS; an explicit choice must not.
    section('③ `system` follows the OS, an explicit choice does not');
    await bootWith(page, baseUrl, { colorScheme: 'light', storedMode: 'system' });
    st = await paintState(page);
    check('system + OS light → light', st.theme === 'light', st.theme);
    await bootWith(page, baseUrl, { colorScheme: 'dark', storedMode: 'system' });
    st = await paintState(page);
    check('system + OS dark → dark', st.theme === 'dark', st.theme);
    await bootWith(page, baseUrl, { colorScheme: 'dark', storedMode: 'light' });
    st = await paintState(page);
    check('an explicit light choice ignores an OS-dark preference', st.theme === 'light', st.theme);

    // Leave the app in dark for the responsive pass.
    await bootWith(page, baseUrl, { colorScheme: 'dark', storedMode: null });

    /* ------------------- ④ responsive comfort ------------------------------ */
    section('④ responsive layout — no overflow, real breathing room');
    for (const vp of WIDTHS) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.waitForTimeout(350);
      const ov = await measureOverflow(page);
      const metrics = await page.evaluate(() => {
        const mc = document.querySelector('.main-col');
        const cs = mc ? getComputedStyle(mc) : null;
        // Measure the controls that are actually *rendered*. Below 1181px the
        // hamburger is visible; at desktop the sidebar's global controls are.
        // A hidden button has a 0×0 box and would make the check vacuous.
        const btns = [...document.querySelectorAll('.sidebar-controls button, .drawer-toggle, .handle')].filter((b) => {
          const d = getComputedStyle(b).display;
          return d !== 'none' && b.getBoundingClientRect().width > 0;
        });
        const shortest = btns.length
          ? Math.min(...btns.map((b) => Math.min(b.getBoundingClientRect().width, b.getBoundingClientRect().height)))
          : null;
        const drawer = document.querySelector('.drawer-toggle');
        return {
          padLeft: cs ? parseFloat(cs.paddingLeft) : null,
          padRight: cs ? parseFloat(cs.paddingRight) : null,
          visibleControls: btns.length,
          topbarBtnMin: shortest,
          drawerVisible: !!drawer && getComputedStyle(drawer).display !== 'none',
        };
      });
      report.responsive.push({ ...vp, ...ov, ...metrics });
      check(`no horizontal overflow at ${vp.name} (${vp.width}px)`, ov.docOverflow <= 2, `${ov.docOverflow}px`);
      check(
        `content keeps its padding at ${vp.name} (≥12px)`,
        metrics.padLeft !== null && metrics.padLeft >= 12 && metrics.padRight >= 12,
        `L${metrics.padLeft} R${metrics.padRight}`,
      );
      if (vp.width <= 1180) {
        check(
          `the drawer (hamburger) is visible at ${vp.name}`, 
          metrics.drawerVisible,
          String(metrics.drawerVisible),
        );
        check(
          `visible global controls stay tappable at ${vp.name} (≥40px)`,
          metrics.topbarBtnMin !== null && metrics.topbarBtnMin >= 40,
          `${metrics.topbarBtnMin}px`,
        );
      } else {
        check(`the drawer (hamburger) is hidden at ${vp.name}`, !metrics.drawerVisible, String(metrics.drawerVisible));
      }
    }

    // N4: a *tablet* used with a finger must also get ≥40px controls. The
    // phone-width rule misses this, so the same minimums now hang off
    // `(pointer: coarse)`; Playwright's `hasTouch` is what makes it evaluate
    // true here.
    for (const w of [768, 1024]) {
      const tctx = await browser.newContext({ viewport: { width: w, height: 1000 }, hasTouch: true, colorScheme: 'dark' });
      const tpage = await tctx.newPage();
      await tpage.goto(baseUrl, { waitUntil: 'domcontentloaded' });
      await tpage.waitForSelector('[data-testid="dashboard-screen"]', { timeout: 25000 });
      await tpage.waitForTimeout(300);
      const min = await tpage.evaluate(() => {
        const btns = [...document.querySelectorAll('.sidebar-controls button, .drawer-toggle, .handle')].filter((b) => {
          const d = getComputedStyle(b).display;
          return d !== 'none' && b.getBoundingClientRect().width > 0;
        });
        return btns.length
          ? Math.min(...btns.map((b) => Math.min(b.getBoundingClientRect().width, b.getBoundingClientRect().height)))
          : null;
      });
      check(`touch controls stay tappable on a ${w}px tablet (≥40px)`, min !== null && min >= 40, `${min}px`);
      await tctx.close();
    }

    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);

    // End-to-end proof that the phone nav actually works: the hamburger was
    // hidden at every width before this phase, so this is the check that would
    // have caught it.
    section('②★ the phone drawer opens and navigates');
    await bootWith(page, baseUrl, { colorScheme: 'dark', storedMode: null });
    const drawer = page.locator('.drawer-toggle').first();
    check('the hamburger is present on a phone', await drawer.isVisible());
    await drawer.click();
    await page.waitForTimeout(450);
    const drawerOpen = await page.evaluate(() => {
      const sb = document.querySelector('.sidebar');
      return !!sb && getComputedStyle(sb).transform !== 'none' && sb.classList.contains('open');
    });
    check('tapping the hamburger opens the sidebar drawer', drawerOpen);
    await clickNav(page, 'chart');
    const phoneNavOk = await page
      .waitForSelector('[data-testid="chart-screen"]', { timeout: 15_000 })
      .then(() => true)
      .catch(() => false);
    check('a phone user can navigate via the drawer', phoneNavOk);

    // The drawer must also be *dismissible* — the Phase-5 QA found it could not
    // be (no scrim, no Escape, no close button). Both paths are asserted now.
    await page.locator('.drawer-toggle').first().click();
    await page.waitForTimeout(400);
    const scrimState = await page.evaluate(() => {
      const scrim = document.querySelector('.scrim');
      const r = scrim?.getBoundingClientRect();
      return {
        present: !!scrim,
        display: scrim ? getComputedStyle(scrim).display : null,
        box: r ? [Math.round(r.width), Math.round(r.height)] : null,
      };
    });
    check('the scrim is rendered while the drawer is open', scrimState.display !== 'none' && (scrimState.box?.[0] ?? 0) > 0, JSON.stringify(scrimState));
    // Tap outside the sidebar (the scrim) → closes.
    await page.mouse.click(300, 300);
    await page.waitForTimeout(350);
    const closedByTap = await page.evaluate(() => !document.querySelector('.sidebar')?.classList.contains('open'));
    check('tapping outside (the scrim) closes the drawer', closedByTap, String(closedByTap));
    // Escape → closes.
    await page.locator('.drawer-toggle').first().click();
    await page.waitForTimeout(400);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(350);
    const closedByEsc = await page.evaluate(() => !document.querySelector('.sidebar')?.classList.contains('open'));
    check('Escape closes the drawer', closedByEsc, String(closedByEsc));
    report.drawer = { scrim: scrimState, closedByTap, closedByEsc };

    await page.screenshot({ path: path.join(EVIDENCE_DIR, '04-phone.png'), fullPage: false });
    report.screenshots.push('04-phone.png');

    /* ------------------- ⑤ app (installable PWA) form --------------------- */
    section('⑤ installable app form (manifest + service worker are served)');
    await page.setViewportSize({ width: 1280, height: 900 });
    const manifestHref = await page.getAttribute('link[rel="manifest"]', 'href');
    check('index.html links a web manifest', !!manifestHref, String(manifestHref));
    if (manifestHref) {
      const mres = await page.request.get(new URL(manifestHref, baseUrl).toString());
      const manifest = mres.ok() ? await mres.json() : null;
      report.pwa.manifest = manifest;
      check('the manifest is served (200)', mres.ok(), `HTTP ${mres.status()}`);
      const sizes = (manifest?.icons ?? []).map((i) => i.sizes);
      check('the manifest ships 192 and 512 icons', sizes.includes('192x192') && sizes.includes('512x512'), sizes.join(','));
      check('the manifest is standalone (app-like, no browser chrome)', manifest?.display === 'standalone', String(manifest?.display));
      check('the manifest declares a start_url', !!manifest?.start_url, String(manifest?.start_url));
    }
    // The service worker is what makes it installable + offline-capable.
    const swReady = await page
      .evaluate(async () => {
        if (!('serviceWorker' in navigator)) return { supported: false };
        const reg = await navigator.serviceWorker.getRegistration();
        return { supported: true, scope: reg?.scope ?? null, active: !!reg?.active };
      })
      .catch((e) => ({ error: e.message }));
    report.pwa.serviceWorker = swReady;
    check('a service worker registers for the app scope', !!swReady.active, JSON.stringify(swReady));

    /* ------------------- console ----------------------------------------- */
    section('console');
    check('zero console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | ') || 'none');
    check('zero unhandled page errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | ') || 'none');
    report.consoleErrors = consoleErrors;
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
    console.error(`\n✗ phase 5 browser evidence FAILED — ${passed} passed, ${failures.length} failed`);
    for (const f of failures) console.error(`   • ${f}`);
    process.exit(1);
  }
  console.log(`\n✓ phase 5 browser evidence PASSED — ${passed} checks, ${skipped.length} skipped`);
}

main().catch((err) => {
  console.error('fatal:', err);
  process.exit(1);
});
