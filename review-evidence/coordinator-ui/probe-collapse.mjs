import { chromium } from 'playwright-core';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await b.newContext({ viewport: { width: 393, height: 852 }, hasTouch: true, isMobile: true });
const p = await ctx.newPage();
await p.goto('http://127.0.0.1:8787/', { waitUntil: 'domcontentloaded' });
await p.waitForSelector('[data-testid="dashboard-screen"]', { timeout: 25000 });
await sleep(1200);

const state = () => p.evaluate(() => ({
  sidebar: document.querySelector('.sidebar')?.className,
  body: document.body.className,
  handle: !!document.querySelector('[data-testid="sidebar-handle"]'),
  scrim: !!document.querySelector('.scrim.open'),
}));

console.log('initial:', JSON.stringify(await state()));
await p.locator('.drawer-toggle').first().click({ force: true });
await sleep(600);
console.log('after hamburger:', JSON.stringify(await state()));

// Now press the « collapse button inside the sidebar (what a phone user would tap)
const c = p.locator('[data-testid="sidebar-collapse"]');
console.log('collapse visible?', await c.isVisible().catch(() => false));
const box = await c.boundingBox().catch(() => null);
console.log('collapse box:', box && { x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.width) });
await c.click({ force: true }).catch((e) => console.log('click err', e.message.split('\n')[0]));
await sleep(700);
console.log('after « collapse:', JSON.stringify(await state()));

// Tap scrim to close
console.log('scrim clickable?', await p.locator('.scrim.open').count());
await p.locator('.scrim.open').click({ force: true }).catch((e) => console.log('scrim err', e.message.split('\n')[0]));
await sleep(600);
console.log('after scrim:', JSON.stringify(await state()));
await b.close();
