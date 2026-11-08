import { chromium } from 'playwright-core';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await b.newContext({ viewport: { width: 393, height: 852 }, hasTouch: true, isMobile: true });
const p = await ctx.newPage();
await p.goto('http://127.0.0.1:8787/', { waitUntil: 'domcontentloaded' });
await p.waitForSelector('[data-testid="dashboard-screen"]', { timeout: 25000 });
await sleep(1200);
await p.locator('.drawer-toggle').first().click({ force: true });
await sleep(600);
await p.locator('[data-testid="sidebar-collapse"]').click({ force: true });
await sleep(800);

const probe = await p.evaluate(() => {
  const sc = document.querySelector('.scrim');
  const r = sc.getBoundingClientRect();
  const mid = { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  const top = document.elementFromPoint(mid.x, mid.y);
  const st = getComputedStyle(sc);
  // Find the dashboard "chart" nav button coordinates and ask what is on top there
  const nav = document.querySelector('nav.side-nav button[data-screen="chart"]');
  const nb = nav ? nav.getBoundingClientRect() : null;
  const nbTop = nb ? document.elementFromPoint(nb.x + nb.width / 2, nb.y + nb.height / 2) : null;
  return {
    scrimClass: sc.className,
    scrimPointer: st.pointerEvents,
    scrimZ: st.zIndex,
    scrimOpacity: st.opacity,
    sidebarClass: document.querySelector('.sidebar').className,
    sidebarLeft: Math.round(document.querySelector('.sidebar').getBoundingClientRect().left),
    elementAtCenter: top ? top.tagName + '.' + (top.className || '').toString().split(' ').filter(Boolean).join('.') : 'none',
    elementAtNavItem: nbTop ? nbTop.tagName + '.' + (nbTop.className || '').toString().split(' ').filter(Boolean).join('.') : 'none',
  };
});
console.log(JSON.stringify(probe, null, 2));

// Now try tapping where a nav item is (behind the scrim) — does it navigate?
await p.evaluate(() => {
  const nav = document.querySelector('nav.side-nav button[data-screen="signals"]');
  if (nav) nav.click();
});
await sleep(500);
console.log('signals screen after programmatic click:', await p.locator('[data-testid="signals-screen"]').count());
await b.close();
