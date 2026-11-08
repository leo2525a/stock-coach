import { chromium } from 'playwright-core';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await chromium.launch({ executablePath: CHROME, headless: true });

async function measure(width, height, label) {
  const ctx = await b.newContext({ viewport: { width, height }, hasTouch: true, isMobile: width < 800, colorScheme: 'dark' });
  const p = await ctx.newPage();
  await p.goto('http://127.0.0.1:8787/', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('[data-testid="dashboard-screen"]', { timeout: 25000 });
  await sleep(800);
  if (width <= 1180) { await p.locator('.drawer-toggle').click(); await sleep(700); }
  const m = await p.evaluate(() => {
    const s = document.querySelector('.sidebar');
    const cs = getComputedStyle(s);
    const appBody = document.querySelector('.app-body');
    return {
      sidebar: { overflowY: cs.overflowY, overflowX: cs.overflowX, position: cs.position, height: Math.round(s.getBoundingClientRect().height), clientH: s.clientHeight, scrollH: s.scrollHeight, canScroll: s.scrollHeight > s.clientHeight + 1 },
      mainCol: { paddingLeft: getComputedStyle(document.querySelector('.main-col')).paddingLeft, width: Math.round(document.querySelector('.main-col').getBoundingClientRect().width) },
      appBodyWidth: Math.round(appBody.getBoundingClientRect().width),
      toggleRect: (() => { const t = document.querySelector('.drawer-toggle'); const r = t.getBoundingClientRect(); return { left: Math.round(r.left), top: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), text: t.textContent.trim(), opacity: getComputedStyle(t).opacity }; })(),
      brandRect: (() => { const el = document.querySelector('.sidebar .brand'); const r = el.getBoundingClientRect(); return { top: Math.round(r.top), left: Math.round(r.left), text: el.textContent.trim() }; })(),
      firstTextY: (() => { const el = document.querySelector('.sidebar .brand'); return Math.round(el.getBoundingClientRect().top); })(),
      transition: cs.transition,
      marginLeft: cs.marginLeft,
    };
  });
  console.log(`--- ${label} (${width}x${height}) ---`);
  console.log(JSON.stringify(m));
  await ctx.close();
}

await measure(393, 852, 'phone');
await measure(1280, 800, 'desktop');
await b.close();
