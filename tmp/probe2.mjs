import { chromium } from 'playwright-core';
const BASE = 'http://127.0.0.1:8787';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--hide-scrollbars','--mute-audio'] });
const ctx = await browser.newContext({ viewport: { width: 393, height: 844 }, colorScheme: 'dark' });
const page = await ctx.newPage();
await page.goto(BASE+'/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-testid="dashboard-screen"]', { timeout: 25000 });
await page.waitForTimeout(500);

console.log('scrim count closed:', await page.locator('.scrim').count());
await page.locator('.drawer-toggle').click();
await page.waitForTimeout(500);
console.log('scrim count open:', await page.locator('.scrim').count());
const sc = await page.evaluate(() => {
  const el = document.querySelector('.scrim');
  if (!el) return null;
  const cs = getComputedStyle(el);
  return { transition: cs.transition, opacity: cs.opacity, display: cs.display, bg: cs.backgroundColor, pe: cs.pointerEvents };
});
console.log('scrim open:', JSON.stringify(sc));

// Escape to close
await page.keyboard.press('Escape');
await page.waitForTimeout(500);
console.log('scrim count after escape:', await page.locator('.scrim').count(), 'sidebar cls:', await page.evaluate(()=>document.querySelector('.sidebar').className));

// set collapsed through localStorage and reload
await page.evaluate(()=>localStorage.setItem('stockcoach.sidebarCollapsed','1'));
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-testid="dashboard-screen"]', { timeout: 25000 });
await page.waitForTimeout(500);
console.log('sidebar cls after reload:', await page.evaluate(()=>document.querySelector('.sidebar').className));
await page.locator('.drawer-toggle').click();
await page.waitForTimeout(600);
const col = await page.evaluate(() => {
  const sb = document.querySelector('.sidebar');
  const q = (s) => { const el = sb.querySelector(s); if(!el) return null; const cs = getComputedStyle(el); return { display: cs.display, opacity: cs.opacity, w: Math.round(el.getBoundingClientRect().width) }; };
  return { cls: sb.className, w: Math.round(sb.getBoundingClientRect().width), scrollW: sb.scrollWidth, clientW: sb.clientWidth, transform: getComputedStyle(sb).transform,
    wlName: q('.wl-name'), wlQuote: q('.wl-quote'), sideText: q('.side-text'), groupBy: q('.group-by'), labelText: q('.sidebar-label-text') };
});
console.log('393 collapsed:', JSON.stringify(col, null, 1));
await page.screenshot({ path: 'tmp/probe-393-collapsed.png' });
await browser.close();
