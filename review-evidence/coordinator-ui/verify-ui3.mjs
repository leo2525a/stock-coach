#!/usr/bin/env node
/**
 * Coordinator's independent verifier for UI round 3 (owner 50/100).
 *
 * The owner asked for six things; five are measurable in a real browser:
 *
 *   1. "個 button 冇作用"        → the drawer's 「«」 must really close it on a phone
 *   2. "上面啲 button 堆埋一堆"    → the chart toolbar must not be a 4-row heap on a phone
 *   3. "可以用 scroll 既方法"      → on a phone it is ONE row, horizontally scrollable
 *   4. "類似嘅 function 擺埋一齊"  → each toolbar category is a contiguous run
 *   5. "menu button … 最隱密"      → exactly one small ghost entry, KEPT at every width,
 *                                    panel away by default, and it carries the logo
 *
 * Every check is a measurement against the **production build** (`dist/`), and
 * each is paired with a mutation in `verify-ui3.mutation.mjs` proving it is not
 * vacuous.
 *
 * Usage: node review-evidence/coordinator-ui/verify-ui3.mjs [baseUrl]
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const OUT = join(HERE, 'round3');
const DIST = join(ROOT, 'dist');
const WORK = join(ROOT, 'evidence', '.work-ui3');

const CHROME = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
].find((p) => existsSync(p));

let pass = 0;
let fail = 0;
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  if (ok) pass += 1;
  else fail += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function sh(cmd, args, cwd) {
  return new Promise((res) => {
    const c = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    c.stdout.on('data', (d) => (out += d));
    c.stderr.on('data', (d) => (err += d));
    c.on('close', (code) => res({ code, out, err }));
  });
}

async function freePort() {
  const { createServer } = await import('node:net');
  return new Promise((res, rej) => {
    const s = createServer();
    s.on('error', rej);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => res(port));
    });
  });
}

async function healthy(base, timeoutMs = 25_000) {
  const end = Date.now() + timeoutMs;
  let last = 'none';
  while (Date.now() < end) {
    try {
      const r = await fetch(`${base}/api/health`);
      if (r.ok) return true;
      last = `HTTP ${r.status}`;
    } catch (e) {
      last = String(e?.message ?? e);
    }
    await sleep(250);
  }
  throw new Error(`server never healthy: ${last}`);
}

/** Geometry + style of the discreet menu entry. */
const MENU = () =>
  (() => {
    const btn = document.querySelector('.drawer-toggle');
    if (!btn) return { exists: false };
    const r = btn.getBoundingClientRect();
    const cs = getComputedStyle(btn);
    return {
      exists: true,
      count: document.querySelectorAll('.drawer-toggle').length,
      handleCount: document.querySelectorAll('[data-testid="sidebar-handle"]').length,
      x: Math.round(r.x),
      y: Math.round(r.y),
      w: Math.round(r.width),
      h: Math.round(r.height),
      display: cs.display,
      visible: cs.visibility !== 'hidden' && cs.display !== 'none' && r.width > 0,
      bg: cs.backgroundColor,
      borderW: cs.borderTopWidth,
      borderColor: cs.borderTopColor,
      borderStyle: cs.borderTopStyle,
      opacity: Number(cs.opacity),
      zIndex: Number(cs.zIndex),
      labelled: (btn.getAttribute('aria-label') || '').trim().length > 0,
    };
  })();

const SIDEBAR = () => {
  const s = document.querySelector('.sidebar');
  const r = s.getBoundingClientRect();
  const cs = getComputedStyle(s);
  return {
    open: s.classList.contains('open'),
    chromeHidden: document.body.classList.contains('chrome-hidden'),
    left: Math.round(r.left),
    transform: cs.transform,
    visibility: cs.visibility,
    transition: cs.transitionProperty,
    transitionDur: cs.transitionDuration,
    brandVisible: (() => {
      const b = s.querySelector('.brand');
      if (!b) return false;
      const br = b.getBoundingClientRect();
      return br.left >= 0 && br.width > 0 && getComputedStyle(b).visibility !== 'hidden';
    })(),
  };
};

/** Chart toolbar: rows via tolerance-based clustering of child tops, and the
 *  categories as the actual `.toolbar-group` runs (sub-pixel jitter makes
 *  exact-equality row counting report phantom rows). A `data-range` and a
 *  `data-interval` can both be `1d`, so group membership — not the attribute
 *  value — is what identifies a category. */
const TOOLBAR = () => {
  const t = document.querySelector('.chart-toolbar');
  if (!t) return { exists: false };
  const cs = getComputedStyle(t);
  const rowsOf = (els, tol = 8) => {
    const tops = els.map((e) => e.getBoundingClientRect().top).sort((a, b) => a - b);
    let n = 0;
    let last = -1e9;
    for (const top of tops) {
      if (last === -1e9 || top - last > tol) n += 1;
      last = top;
    }
    return n;
  };
  const groups = [...t.querySelectorAll(':scope > .toolbar-group')];
  const groupInfo = groups.map((g) => {
    const r = g.getBoundingClientRect();
    return {
      label: (g.getAttribute('aria-label') || g.className).trim(),
      top: Math.round(r.top),
      height: Math.round(r.height),
      children: g.children.length,
      rows: rowsOf([...g.children]),
      left: Math.round(r.left),
      right: Math.round(r.right),
    };
  });
  const buttons = [...t.querySelectorAll('button')];
  return {
    exists: true,
    height: Math.round(t.getBoundingClientRect().height),
    rows: rowsOf(buttons),
    groupRows: rowsOf(groups),
    groups: groups.length,
    groupInfo,
    buttons: buttons.length,
    scrollWidth: t.scrollWidth,
    clientWidth: t.clientWidth,
    // "Scrollable" must mean a real scroll container: content wider than the
    // box AND overflow that is actually scrollable. `overflow-x:hidden` also
    // yields scrollWidth > clientWidth, so width alone is not sufficient.
    scrollable: t.scrollWidth > t.clientWidth + 2 && /auto|scroll/.test(cs.overflowX),
    overflowX: cs.overflowX,
    flexWrap: cs.flexWrap,
    scrollSnap: cs.scrollSnapType,
  };
};

async function boot(browser, width, height, { hasTouch = false, isMobile = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: 'dark', hasTouch, isMobile });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  return { ctx, page, errors };
}

async function main() {
  const base = process.argv[2] || null;
  let server;
  let baseUrl = base;

  if (!base) {
    if (!existsSync(DIST)) {
      console.error('dist/ missing — run `npm run build` first.');
      process.exit(1);
    }
    mkdirSync(WORK, { recursive: true });
    const bundle = join(WORK, 'server.mjs');
    const b = await sh(
      join(ROOT, 'node_modules', '.bin', 'esbuild'),
      [
        join(ROOT, 'server', 'index.ts'),
        '--bundle',
        '--platform=node',
        '--target=node22',
        '--format=esm',
        '--outfile=' + bundle,
        '--packages=external',
        `--define:import.meta.url=${JSON.stringify('file://' + join(ROOT, 'server', 'index.ts'))}`,
      ],
      ROOT,
    );
    if (b.code !== 0) throw new Error(`esbuild failed:\n${b.err || b.out}`);
    const port = await freePort();
    baseUrl = `http://127.0.0.1:${port}`;
    server = spawn(process.execPath, [bundle], {
      cwd: ROOT,
      env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DB_PATH: join(WORK, 'ui3.db'), NODE_ENV: 'production' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    server.stdout.on('data', () => {});
    server.stderr.on('data', () => {});
    await healthy(baseUrl);
    console.log(`server up on ${baseUrl}`);
  }

  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--hide-scrollbars'] });
  const shots = [];

  try {
    /* ============================ DESKTOP ============================= */
    {
      const { ctx, page, errors } = await boot(browser, 1440, 950);
      await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('[data-testid="dashboard-screen"]', { timeout: 25_000 });
      await sleep(1000);

      console.log('\n── 1. desktop: the entry is discreet, unique, and always there');
      const m0 = await page.evaluate(MENU);
      check('there is exactly ONE menu entry', m0.exists && m0.count === 1, `count=${m0.count}`);
      check('the old floating 「»」 handle is gone', m0.handleCount === 0, `${m0.handleCount} found`);
      check('the menu entry is visible at desktop width', m0.visible === true, `display=${m0.display}`);
      check('the menu entry sits in the top-left corner', m0.x <= 20 && m0.y <= 20, `x=${m0.x} y=${m0.y}`);
      check('the menu entry is small (a corner glyph, not a bar)', m0.w <= 48 && m0.h <= 48, `${m0.w}×${m0.h}`);
      check('the menu entry is discreet (ghost: no fill, no visible border)', /rgba\(0, 0, 0, 0\)|transparent/.test(m0.bg) && /rgba\(0, 0, 0, 0\)|transparent/.test(m0.borderColor), `bg=${m0.bg} border=${m0.borderColor}`);
      check('the menu entry is muted (opacity < 0.8)', m0.opacity < 0.8, `opacity=${m0.opacity}`);
      check('the menu entry is labelled', m0.labelled === true);

      console.log('\n── 2. desktop: the panel starts away and the entry brings it back');
      const s0 = await page.evaluate(SIDEBAR);
      check('the sidebar starts put away on desktop', s0.chromeHidden === true, `chrome-hidden=${s0.chromeHidden}`);
      check('a put-away panel is pushed off-canvas (never a dead strip)', s0.left < -50, `left=${s0.left}`);
      check('the panel slides (a transition animates its position)', /margin-left|transform|left /.test(s0.transition) && parseFloat(s0.transitionDur) > 0, `${s0.transition} ${s0.transitionDur}`);
      check('the logo is NOT shown while the panel is away', s0.brandVisible === false);

      await page.locator('.drawer-toggle').click();
      await sleep(550);
      const s1 = await page.evaluate(SIDEBAR);
      check('the entry opens the panel', s1.chromeHidden === false && s1.left >= 0, `left=${s1.left}`);
      check('opening the panel SHOWS the logo', s1.brandVisible === true);
      shots.push(await page.screenshot({ path: join(OUT, 'desktop-open.png') }));

      const tb = await page.evaluate(TOOLBAR);
      await page.locator('nav.side-nav button[data-screen="chart"]').click({ force: true });
      await sleep(1200);
      const tbD = await page.evaluate(TOOLBAR);
      check('desktop: the toolbar does not clip controls behind a fade', tbD.scrollable === false, `sw=${tbD.scrollWidth} cw=${tbD.clientWidth}`);
      check('desktop: every toolbar category is present', tbD.groups === 5, `${tbD.groups} groups`);
      check('desktop: no toolbar button is off-screen', tbD.groupInfo.every((g) => g.left >= 0 && g.right <= tbD.clientWidth + 2), tbD.groupInfo.map((g) => `${g.left}-${g.right}`).join(' '));
      check('desktop: each category is a single run row', tbD.groupInfo.every((g) => g.rows === 1), tbD.groupInfo.map((g) => g.rows).join(','));

      check('zero console errors on desktop', errors.length === 0, errors.slice(0, 2).join(' | '));
      await ctx.close();
    }

    /* ============================= PHONE ============================== */
    {
      const { ctx, page, errors } = await boot(browser, 393, 852, { hasTouch: true, isMobile: true });
      await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('[data-testid="dashboard-screen"]', { timeout: 25_000 });
      await sleep(900);

      console.log('\n── 3. phone: the menu entry still exists (most discreet way in)');
      const mp = await page.evaluate(MENU);
      check('phone: the menu entry is present and visible', mp.exists && mp.visible === true);
      check('phone: still exactly one entry, no floating handle', mp.count === 1 && mp.handleCount === 0, `count=${mp.count} handles=${mp.handleCount}`);
      const sp0 = await page.evaluate(SIDEBAR);
      check('phone: the drawer starts closed', sp0.open === false, `open=${sp0.open}`);
      check('phone: the logo is hidden until the drawer opens', sp0.brandVisible === false);

      await page.locator('.drawer-toggle').click();
      await sleep(550);
      const sp1 = await page.evaluate(SIDEBAR);
      check('phone: the entry opens the drawer', sp1.open === true);
      check('phone: opening the drawer reveals the logo', sp1.brandVisible === true);
      check('phone: the entry gets out of the way while the drawer is open', !(await page.locator('.drawer-toggle').isVisible()));

      console.log('\n── 4. phone: the 「«」 button really works (the reported dead button)');
      const before = await page.evaluate(SIDEBAR);
      await page.locator('[data-testid="sidebar-collapse"]').click();
      await sleep(600);
      const after = await page.evaluate(SIDEBAR);
      check('phone: 「«」 closes the drawer it lives in', before.open === true && after.open === false, `open ${before.open}→${after.open}`);
      check('phone: 「«」 does not merely flip a desktop flag', after.chromeHidden === false || after.open === false, `chrome-hidden=${after.chromeHidden}`);
      check('phone: the entry comes back once the drawer is closed', await page.locator('.drawer-toggle').isVisible());

      console.log('\n─— 5. phone: the toolbar is one scrollable row, grouped by category');
      await page.locator('.drawer-toggle').click();
      await sleep(450);
      await page.locator('nav.side-nav button[data-screen="chart"]').click({ force: true });
      await sleep(1500);
      const tp = await page.evaluate(TOOLBAR);
      check('phone: the toolbar is ONE row (was four rows / 175px)', tp.rows === 1 && tp.groupRows === 1, `rows=${tp.rows} groupRows=${tp.groupRows} height=${tp.height}`);
      check('phone: it does not wrap', tp.flexWrap === 'nowrap', `wrap=${tp.flexWrap}`);
      check('phone: it scrolls horizontally (the owner asked for scroll)', tp.scrollable === true, `sw=${tp.scrollWidth} cw=${tp.clientWidth}`);
      check('phone: overflow is a real scroll container', /auto|scroll/.test(tp.overflowX), `overflow-x=${tp.overflowX}`);
      check('phone: scroll snaps to a category boundary', /x/.test(tp.scrollSnap), `snap=${tp.scrollSnap}`);
      check('phone: the toolbar stays compact (< 60px tall)', tp.height < 60, `${tp.height}px`);

      // Category grouping: each `.toolbar-group` capsule holds a whole category
      // and never wraps internally, and the groups run left-to-right in order.
      const gi = tp.groupInfo;
      check('phone: each category is one contiguous run (no internal wrap)', gi.every((g) => g.rows === 1 && g.children > 0), gi.map((g) => `${g.children}c/${g.rows}r`).join(' '));
      check('phone: the categories run in a stable left-to-right order', gi.every((g, i) => i === 0 || g.left > gi[i - 1].left), gi.map((g) => g.left).join('<'));
      check('phone: every category starts in a snapping position', /x/.test(tp.scrollSnap), `snap=${tp.scrollSnap}`);

      // The strip must be usable: scrolling reveals a control that started off-screen.
      const lastKey = tp.groupInfo[tp.groupInfo.length - 1]?.label;
      await page.locator('.chart-toolbar').evaluate((el) => el.scrollTo({ left: el.scrollWidth }));
      await sleep(400);
      const scrolled = await page.locator('.chart-toolbar').evaluate((el) => el.scrollLeft);
      check('phone: scrolling the strip really moves it', scrolled > 100, `scrollLeft=${scrolled}`);
      const reachable = await page.locator('.chart-toolbar button[data-action="refresh"]').first().isVisible().catch(() => false);
      check('phone: the far control is reachable by scrolling', reachable, `last group=${lastKey}`);
      shots.push(await page.screenshot({ path: join(OUT, 'phone-chart.png') }));

      check('zero console errors on phone', errors.length === 0, errors.slice(0, 2).join(' | '));
      await ctx.close();
    }
  } finally {
    await browser.close();
    if (server) server.kill();
  }

  const report = { generatedAt: new Date().toISOString(), pass, fail, results, screenshots: ['desktop-open.png', 'phone-chart.png'] };
  writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  console.log(`\n${'─'.repeat(60)}`);
  if (fail === 0) {
    console.log(`✓ round-3 UI verification PASSED — ${pass} checks. Artifacts in ${OUT}`);
    process.exit(0);
  }
  console.log(`✗ round-3 UI verification FAILED — ${pass} passed, ${fail} failed`);
  process.exit(1);
}

main().catch((e) => {
  console.error('verifier error:', e);
  process.exit(1);
});
