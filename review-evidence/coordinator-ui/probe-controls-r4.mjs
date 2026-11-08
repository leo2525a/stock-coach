import { chromium } from 'playwright-core';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await b.newContext({ viewport: { width: 393, height: 852 }, hasTouch: true, isMobile: true, colorScheme: 'dark' });
const p = await ctx.newPage();
await p.goto('http://127.0.0.1:8787/', { waitUntil: 'domcontentloaded' });
await p.waitForSelector('[data-testid="dashboard-screen"]', { timeout: 25000 });
await sleep(900);
await p.locator('.drawer-toggle').click();
await sleep(700);

const m = await p.evaluate(() => {
  const s = document.querySelector('.sidebar');
  const cc = s.querySelector('.sidebar-controls');
  const ccs = getComputedStyle(cc);
  const kids = [...cc.children].map((el) => {
    const r = el.getBoundingClientRect();
    return { tag: el.tagName, cls: el.className, testid: el.getAttribute('data-testid'), text: (el.textContent || '').trim().slice(0, 24), top: Math.round(r.top), left: Math.round(r.left), w: Math.round(r.width), h: Math.round(r.height) };
  });
  // rows within controls
  const tops = kids.map((k) => k.top);
  const rows = new Set(tops).size;
  const headKids = [...s.querySelector('.brand-head').children].map((el) => {
    const r = el.getBoundingClientRect();
    return { cls: el.className, text: (el.textContent || '').trim().slice(0, 20), top: Math.round(r.top), h: Math.round(r.height) };
  });
  return {
    controls: { top: Math.round(cc.getBoundingClientRect().top), h: Math.round(cc.getBoundingClientRect().height), display: ccs.display, wrap: ccs.flexWrap, gap: ccs.gap, rows, children: kids },
    brandHead: { h: Math.round(s.querySelector('.brand-head').getBoundingClientRect().height), children: headKids },
    brandVisibleText: (s.querySelector('.brand')?.textContent || '').trim(),
    navOverflow: (() => { const n = s.querySelector('.side-nav'); const c = getComputedStyle(n); return { scrollH: n.scrollHeight, clientH: n.clientHeight, overflowY: c.overflowY, overflow: c.overflow }; })(),
    sidebarOverflow: getComputedStyle(s).overflowY,
    longPressHint: null,
  };
});
console.log(JSON.stringify(m, null, 1));
await b.close();
