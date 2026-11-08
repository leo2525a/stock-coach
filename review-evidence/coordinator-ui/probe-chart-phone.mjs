import { chromium } from 'playwright-core';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await b.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });
const p = await ctx.newPage();
await p.goto('http://127.0.0.1:8787/', { waitUntil: 'domcontentloaded' });
await p.waitForSelector('[data-testid="dashboard-screen"]', { timeout: 25000 });
await sleep(1200);
// open drawer, go to chart
await p.locator('.drawer-toggle').first().click({ force: true });
await sleep(500);
await p.locator('nav.side-nav button[data-screen="chart"]').click({ force: true });
await sleep(1500);
await p.screenshot({ path: '/tmp/phone-chart.png' });

const layout = await p.evaluate(() => {
  const tb = document.querySelector('.chart-toolbar');
  const rows = new Set([...tb.querySelectorAll(':scope > .toolbar-group')].map((g) => Math.round(g.getBoundingClientRect().top)));
  const r = tb.getBoundingClientRect();
  return {
    toolbarHeight: Math.round(r.height),
    toolbarTop: Math.round(r.top),
    rows: rows.size,
    groups: tb.querySelectorAll(':scope > .toolbar-group').length,
    buttons: tb.querySelectorAll('button').length,
    scrollWidth: tb.scrollWidth,
    clientWidth: tb.clientWidth,
  };
});
console.log('chart toolbar:', JSON.stringify(layout));
const head = await p.evaluate(() => {
  const h = document.querySelector('.symbol-head');
  const r = h.getBoundingClientRect();
  return { top: Math.round(r.top), height: Math.round(r.height), display: getComputedStyle(h).display, text: h.innerText.trim().slice(0, 60) };
});
console.log('symbol-head:', JSON.stringify(head));
await b.close();
