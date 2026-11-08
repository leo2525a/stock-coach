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
  const box = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { top: Math.round(r.top), h: Math.round(r.height), bottom: Math.round(r.bottom) };
  };
  const kids = [...s.children].map((el) => ({ cls: el.className, ...box(el) }));
  // find vertical gaps between consecutive children
  const gaps = [];
  for (let i = 1; i < kids.length; i++) {
    gaps.push({ after: kids[i - 1].cls, gap: kids[i].top - kids[i - 1].bottom });
  }
  const cs = getComputedStyle(s);
  return {
    sidebar: { ...box(s), overflowY: cs.overflowY, display: cs.display, pad: cs.padding, gap: cs.gap, scrollH: s.scrollHeight, clientH: s.clientHeight },
    children: kids,
    gaps,
    head: box(s.querySelector('.sidebar-head')),
    brandHead: box(s.querySelector('.brand-head')),
    controls: box(s.querySelector('.sidebar-controls')),
    nav: box(s.querySelector('.side-nav')),
    firstGroupLabel: box(s.querySelector('.side-group-label')),
    watch: box(s.querySelector('.sidebar-watch')),
    labelSpacer: box(s.querySelector('.sidebar-label-spacer')),
    labelSpacerStyle: (() => {
      const el = s.querySelector('.sidebar-label-spacer');
      if (!el) return null;
      const c = getComputedStyle(el);
      return { display: c.display, minHeight: c.minHeight, height: c.height, margin: c.margin, padding: c.padding, visibility: c.visibility };
    })(),
  };
});
console.log(JSON.stringify(m, null, 1));
await p.screenshot({ path: '/tmp/probe-sidebar-phone.png' });
await b.close();
