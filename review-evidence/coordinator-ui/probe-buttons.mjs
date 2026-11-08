/**
 * Probe: which control, if any, "does nothing" on a phone viewport?
 * Drives the production build in real Chrome at iPhone widths and reports each
 * control's presence, hit-testability and observed effect.
 */
import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';

const CHROME = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(existsSync);
const BASE = process.argv[2] || 'http://127.0.0.1:8787';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({
  viewport: { width: 393, height: 852 },
  hasTouch: true,
  isMobile: true,
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
});
const page = await ctx.newPage();
const errs = [];
page.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-testid="dashboard-screen"]', { timeout: 25000 });
await sleep(1200);

const describe = async (sel) => {
  const loc = page.locator(sel).first();
  const n = await page.locator(sel).count();
  if (!n) return { sel, count: 0 };
  const vis = await loc.isVisible().catch(() => false);
  const box = await loc.boundingBox().catch(() => null);
  let hit = null;
  if (box) {
    hit = await page.evaluate(
      ([x, y]) => {
        const el = document.elementFromPoint(x, y);
        if (!el) return 'none';
        return el.tagName + '.' + (el.className || '').toString().split(' ').filter(Boolean).join('.');
      },
      [box.x + box.width / 2, box.y + box.height / 2],
    );
  }
  return { sel, count: n, visible: vis, box: box && { w: Math.round(box.width), h: Math.round(box.height), x: Math.round(box.x), y: Math.round(box.y) }, hit };
};

console.log('--- controls at 393px ---');
for (const sel of [
  '.drawer-toggle',
  '[data-testid="sidebar-collapse"]',
  '[data-testid="sidebar-controls"] button',
  '[data-testid="theme-toggle"]',
  '[data-testid="lang-switch"]',
  '[data-testid="sidebar-handle"]',
  '[data-testid="drawer-scrim"]',
]) {
  console.log(sel, JSON.stringify(await describe(sel)));
}

// Try the hamburger: does it open the drawer?
console.log('\n--- hamburger effect ---');
const before = await page.locator('aside.sidebar').evaluate((el) => el.className);
await page.locator('.drawer-toggle').first().click({ force: true }).catch((e) => console.log('click err', e.message));
await sleep(500);
const after = await page.locator('aside.sidebar').evaluate((el) => el.className);
console.log('sidebar class before:', JSON.stringify(before), 'after:', JSON.stringify(after));
console.log('scrim open?', await page.locator('.scrim.open').count());

// Try a nav item
console.log('\n--- nav item effect ---');
const navBtn = page.locator('nav.side-nav button[data-screen="chart"]').first();
console.log('chart btn visible:', await navBtn.isVisible().catch(() => false));
await navBtn.click({ force: true }).catch((e) => console.log('nav click err', e.message));
await sleep(700);
console.log('chart screen present:', await page.locator('[data-testid="chart-screen"]').count());

console.log('\nconsole errors:', errs.length, errs.slice(0, 4));
await browser.close();
