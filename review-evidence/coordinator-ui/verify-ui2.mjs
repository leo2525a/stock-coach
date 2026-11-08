/**
 * Coordinator's independent verifier for UI round 2 (owner 38/100).
 *
 * Measures the *rendered* result of the owner's three asks on the production
 * build (real Chrome via playwright-core):
 *   1. no logo/top bar; brand + global controls live in the sidebar
 *   2. collapsing the sidebar puts it away in one move, with a reachable handle
 *   3. the controls are tidier and the panel slides (has a transition)
 *
 * Every check is a measurement, and each is paired with a mutation in
 * `verify-ui2.mutation.mjs` to prove the check is non-vacuous.
 *
 * Usage: node review-evidence/coordinator-ui/verify-ui2.mjs [baseUrl]
 */
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'round2');
const BASE = process.argv[2] || 'http://127.0.0.1:8787';

const CHROME = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
].find((p) => existsSync(p));

let pass = 0;
let fail = 0;
const checks = [];
function check(name, ok, detail = '') {
  checks.push({ name, ok, detail });
  if (ok) pass += 1;
  else fail += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 }, colorScheme: 'dark' });
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));

  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="dashboard-screen"]', { timeout: 25_000 });
  await page.waitForTimeout(1200);

  // ---- 1. the logo bar is gone ----
  check('1a no logo/top bar exists', (await page.locator('header.topbar').count()) === 0);
  const cc = await page.locator('[data-testid="sidebar-controls"]');
  check('1b brand lives in the sidebar', (await page.locator('.sidebar .brand').count()) > 0);
  check('1c global controls live in the sidebar', (await cc.count()) > 0);
  for (const id of ['theme-toggle', 'lang-switch', 'refresh-btn']) {
    check(`1d sidebar carries ${id}`, (await page.locator(`.sidebar [data-testid="${id}"]`).count()) > 0);
  }

  // ---- 2. one-move collapse + reachable handle (desktop) ----
  const box = () => page.evaluate(() => {
    const sb = document.querySelector('.sidebar');
    const r = sb.getBoundingClientRect();
    return { left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width), vis: getComputedStyle(sb).visibility };
  });
  const before = await box();
  check('2a sidebar starts in-flow at desktop', before.left === 0 && before.width > 200, JSON.stringify(before));
  check(
    '2b the sidebar has a slide transition (owner: 加 slide animation)',
    await page.evaluate(() => {
      const tr = getComputedStyle(document.querySelector('.sidebar')).transitionProperty;
      return /margin-left|width|transform/.test(tr);
    }),
  );
  await page.locator('[data-testid="sidebar-collapse"]').click();
  await sleep(450);
  const after = await box();
  check('2c one click puts the panel away', after.right <= 2 || after.vis === 'hidden', JSON.stringify(after));
  check('2d the handle is reachable while hidden', await page.locator('[data-testid="sidebar-handle"]').isVisible());
  const fab = await page.locator('[data-testid="sidebar-handle"]').boundingBox();
  check('2e the handle sits in a corner (not a full bar)', !!fab && fab.width < 60 && fab.height < 60, fab ? `${Math.round(fab.width)}x${Math.round(fab.height)}` : 'none');
  await page.screenshot({ path: join(OUT, 'desktop-hidden-1440.png') });
  await page.locator('[data-testid="sidebar-handle"]').click();
  await sleep(450);
  const back = await box();
  check('2f the handle brings it straight back', back.left === 0 && back.width > 200, JSON.stringify(back));
  await page.screenshot({ path: join(OUT, 'desktop-shown-1440.png') });

  // ---- 3. chart toolbar is tidier (grouped capsules) ----
  await page.locator('nav.side-nav button[data-screen="chart"]').click({ force: true });
  await page.waitForSelector('[data-testid="chart-screen"]', { timeout: 15_000 });
  await page.waitForTimeout(900);
  const tb = await page.evaluate(() => {
    const groups = [...document.querySelectorAll('.chart-toolbar .toolbar-group')];
    const seps = document.querySelectorAll('.chart-toolbar .toolbar-sep').length;
    return {
      groups: groups.length,
      pill: groups.every((g) => parseFloat(getComputedStyle(g).borderTopLeftRadius) >= 12),
      seps,
      btns: document.querySelectorAll('.chart-toolbar button').length,
    };
  });
  check('3a the toolbar is grouped into capsules', tb.groups >= 4, `${tb.groups} groups`);
  check('3b each group is a rounded pill', tb.pill);
  check('3c the hairline separators are gone', tb.seps === 0, `${tb.seps} seps`);
  await page.screenshot({ path: join(OUT, 'chart-toolbar-1440.png') });

  // ---- 4. the headline row is not pinned to the viewport ----
  const isPinned = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="topbar-symbol"]');
    return el ? getComputedStyle(el.closest('.head-row') || el).position : 'none';
  });
  check('4a the headline row is not a sticky/fixed bar', isPinned === 'static' || isPinned === 'relative', isPinned);

  // ---- 5. no overflow / console errors at four widths -+
  for (const w of [320, 393, 768, 1280]) {
    await page.setViewportSize({ width: w, height: 900 });
    await sleep(500);
    const ov = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    check(`5 no horizontal overflow @${w}`, ov <= 2, `${ov}px`);
    await page.screenshot({ path: join(OUT, `width-${w}.png`) });
  }
  check('5 zero console errors', consoleErrors.length === 0, consoleErrors.slice(0, 2).join(' | ') || 'none');

  await browser.close();
  console.log(`\n=== verifier: ${pass} pass / ${fail} fail ===`);
  writeFileSync(join(OUT, 'verify-report.json'), JSON.stringify({ pass, fail, checks, consoleErrors }, null, 2));
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error('fatal', e);
  process.exit(1);
});
