import { chromium } from 'playwright-core';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await chromium.launch({ executablePath: CHROME, headless: true });

// ---- desktop ----
const dctx = await b.newContext({ viewport: { width: 1440, height: 950 }, colorScheme: 'dark' });
const d = await dctx.newPage();
await d.goto('http://127.0.0.1:8787/', { waitUntil: 'domcontentloaded' });
await d.waitForSelector('[data-testid="dashboard-screen"]', { timeout: 25000 });
await sleep(1200);
const st = () =>
  d.evaluate(() => ({
    body: document.body.className,
    sidebarLeft: Math.round(document.querySelector('.sidebar').getBoundingClientRect().left),
    sidebarVis: getComputedStyle(document.querySelector('.sidebar')).visibility,
    menuVisible: getComputedStyle(document.querySelector('.drawer-toggle')).display !== 'none',
    menuBox: (() => { const r = document.querySelector('.drawer-toggle').getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width)]; })(),
    logoVisible: (() => { const r = document.querySelector('.sidebar .brand').getBoundingClientRect(); return r.left >= 0 && r.width > 0; })(),
  }));
console.log('DESKTOP initial (panel should be AWAY, menu visible):', JSON.stringify(await st()));
await d.locator('.drawer-toggle').first().click();
await sleep(500);
console.log('DESKTOP after menu click (panel SHOULD be open + logo):', JSON.stringify(await st()));
await d.screenshot({ path: '/tmp/r3-desktop-open.png' });
await d.locator('[data-testid="sidebar-collapse"]').click();
await sleep(500);
console.log('DESKTOP after « (panel away):', JSON.stringify(await st()));
await d.screenshot({ path: '/tmp/r3-desktop-closed.png' });

// toolbar rows at desktop
await d.locator('.drawer-toggle').first().click(); await sleep(400);
await d.locator('nav.side-nav button[data-screen="chart"]').click({ force: true });
await sleep(1200);
const tb = await d.evaluate(() => {
  const t = document.querySelector('.chart-toolbar');
  const rows = new Set([...t.querySelectorAll(':scope > .toolbar-group')].map((g) => Math.round(g.getBoundingClientRect().top)));
  return { height: Math.round(t.getBoundingClientRect().height), rows: rows.size, scrollable: t.scrollWidth > t.clientWidth };
});
console.log('DESKTOP chart toolbar:', JSON.stringify(tb));
await dctx.close();

// ---- phone ----
const pctx = await b.newContext({ viewport: { width: 393, height: 852 }, hasTouch: true, isMobile: true });
const p = await pctx.newPage();
await p.goto('http://127.0.0.1:8787/', { waitUntil: 'domcontentloaded' });
await p.waitForSelector('[data-testid="dashboard-screen"]', { timeout: 25000 });
await sleep(1000);
console.log('PHONE menu visible?', await p.locator('.drawer-toggle').isVisible());
await p.locator('.drawer-toggle').click(); await sleep(600);
console.log('PHONE menu auto-hidden while open?', !(await p.locator('.drawer-toggle').isVisible()));
await p.locator('[data-testid="sidebar-collapse"]').click(); await sleep(600);
const pAfter = await p.evaluate(() => ({
  sidebarOpen: document.querySelector('.sidebar').classList.contains('open'),
  body: document.body.className,
}));
console.log('PHONE after « (drawer should CLOSE):', JSON.stringify(pAfter));
await p.locator('.drawer-toggle').click(); await sleep(400);
await p.locator('nav.side-nav button[data-screen="chart"]').click({ force: true });
await sleep(1200);
const ptb = await p.evaluate(() => {
  const t = document.querySelector('.chart-toolbar');
  return { height: Math.round(t.getBoundingClientRect().height), scrollable: t.scrollWidth > t.clientWidth, sw: t.scrollWidth, cw: t.clientWidth };
});
console.log('PHONE chart toolbar (should be ONE row + scrollable):', JSON.stringify(ptb));
await p.screenshot({ path: '/tmp/r3-phone-chart.png' });
await pctx.close();
await b.close();
