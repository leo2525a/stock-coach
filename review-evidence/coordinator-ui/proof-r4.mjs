import { chromium } from 'playwright-core';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await chromium.launch({ executablePath: CHROME, headless: true });
const out = {};

async function probe(width, height) {
  const ctx = await b.newContext({ viewport: { width, height }, hasTouch: width < 800, isMobile: width < 800, colorScheme: 'dark' });
  const p = await ctx.newPage();
  await p.goto('http://127.0.0.1:8787/', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('[data-testid="dashboard-screen"]', { timeout: 25000 });
  await sleep(600);
  const r = {};
  const snap = () => p.evaluate(() => {
    const s = document.querySelector('.sidebar');
    const cs = s ? getComputedStyle(s) : null;
    const mc = document.querySelector('.main-col');
    const bt = document.querySelector('.drawer-toggle');
    // last watchlist row reachability
    const rows = document.querySelectorAll('.sidebar-list .wl-row');
    const last = rows[rows.length - 1];
    const lb = last ? last.getBoundingClientRect() : null;
    const sb = s ? s.getBoundingClientRect() : null;
    return {
      sidebarDisplay: cs?.display ?? null,
      overflowY: cs?.overflowY ?? null,
      overflowX: cs?.overflowX ?? null,
      transform: cs?.transform ?? null,
      marginLeft: cs?.marginLeft ?? null,
      clientH: s?.clientHeight ?? null,
      scrollH: s?.scrollHeight ?? null,
      scrollTop: s?.scrollTop ?? null,
      canScroll: s ? s.scrollHeight > s.clientHeight + 1 : null,
      rowCount: rows.length,
      lastRow: lb ? { top: Math.round(lb.top), bottom: Math.round(lb.bottom) } : null,
      sidebarBox: sb ? { top: Math.round(sb.top), bottom: Math.round(sb.bottom) } : null,
      mainLeft: mc ? Math.round(mc.getBoundingClientRect().left) : null,
      mainWidth: mc ? Math.round(mc.getBoundingClientRect().width) : null,
      toggleVisible: !!bt && getComputedStyle(bt).display !== 'none' && bt.getBoundingClientRect().width > 0,
      toggleText: bt ? bt.textContent.trim().replace(/\s+/g, ' ') : null,
      toggleAria: bt ? { label: bt.getAttribute('aria-label'), expanded: bt.getAttribute('aria-expanded') } : null,
      toggleIsBrand: !!bt && !!bt.querySelector('.brand'),
      brandText: document.querySelector('.sidebar .brand-head .brand')?.textContent.replace(/\s+/g, '') ?? null,
    };
  });

  r.closed = await snap();
  // (c) the logo is the button: click the brand (inside .drawer-toggle) toggles the panel
  await p.locator('.drawer-toggle').first().click({ force: true });
  await sleep(300);
  r.afterClickToggle = await snap();
  // scroll inside the panel to the last item
  if (r.afterClickToggle.sidebarDisplay !== 'none') {
    await p.evaluate(() => { const s = document.querySelector('.sidebar'); s.scrollTop = s.scrollHeight; });
    await sleep(150);
    r.scrolled = await snap();
    r.lastItemReachable = await p.evaluate(() => {
      const s = document.querySelector('.sidebar');
      const rows = document.querySelectorAll('.sidebar-list .wl-row');
      const last = rows[rows.length - 1];
      if (!s || !last) return null;
      const sb = s.getBoundingClientRect(); const lb = last.getBoundingClientRect();
      return lb.bottom <= sb.bottom + 1 && lb.top >= sb.top - 1;
    });
  }
  // toggle the panel CLOSED again and prove nothing slid
  const closeSel = width <= 1180 ? '.sidebar .brand-head .icon-btn' : '.drawer-toggle';
  await p.locator(closeSel).first().click({ force: true }).catch(async () => {
    await p.locator('.drawer-toggle').first().click({ force: true });
  });
  await sleep(300);
  r.afterClose = await snap();
  // last item text to name what we reached
  r.lastItemText = await p.evaluate(() => {
    const rows = document.querySelectorAll('.sidebar-list .wl-row');
    const last = rows[rows.length - 1];
    return last ? last.getAttribute('title') : null;
  });
  await ctx.close();
  return r;
}

out.phone393 = await probe(393, 852);
out.desktop1280 = await probe(1280, 800);
console.log(JSON.stringify(out, null, 1));
await b.close();
