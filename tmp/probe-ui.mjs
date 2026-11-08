import { chromium } from 'playwright-core';
const BASE = 'http://127.0.0.1:8787';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--hide-scrollbars','--mute-audio'] });
for (const w of [393, 1280]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, colorScheme: 'dark' });
  const page = await ctx.newPage();
  const errs=[]; page.on('console',m=>{if(m.type()==='error')errs.push(m.text())}); page.on('pageerror',e=>errs.push('PE:'+e.message));
  await page.goto(BASE+'/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="dashboard-screen"]', { timeout: 25000 });
  await page.waitForTimeout(600);
  const top = await page.evaluate(() => {
    const tb = document.querySelector('.topbar');
    const kids = [...tb.children].map(el => ({ cls: el.className, w: Math.round(el.getBoundingClientRect().width), h: Math.round(el.getBoundingClientRect().height), y: Math.round(el.getBoundingClientRect().y) }));
    return { topbarH: Math.round(tb.getBoundingClientRect().height), kids, docOverflow: document.documentElement.scrollWidth - window.innerWidth };
  });
  console.log(`--- width ${w} ---`);
  console.log('topbar height', top.topbarH, 'docOverflow', top.docOverflow);
  console.log(JSON.stringify(top.kids));
  const sbTrans = await page.evaluate(() => getComputedStyle(document.querySelector('.sidebar')).transition);
  console.log('sidebar transition:', sbTrans);
  // collapse via desktop
  if (w === 1280) {
    await page.locator('[data-testid="sidebar-collapse"]').click();
    await page.waitForTimeout(400);
  } else {
    // open drawer, collapse inside
    await page.locator('.drawer-toggle').click({force:true});
    await page.waitForTimeout(400);
    await page.locator('[data-testid="sidebar-collapse"]').click();
    await page.waitForTimeout(400);
    await page.locator('.drawer-toggle').click({force:true});
    await page.waitForTimeout(400);
  }
  const col = await page.evaluate(() => {
    const sb = document.querySelector('.sidebar');
    const r = sb.getBoundingClientRect();
    const q = (s) => { const el = sb.querySelector(s); if(!el) return null; const cs = getComputedStyle(el); return { display: cs.display, w: Math.round(el.getBoundingClientRect().width) }; };
    const syms = [...sb.querySelectorAll('.wl-sym')].slice(0,3).map(el=>({t:el.textContent,w:Math.round(el.getBoundingClientRect().width)}));
    const row = sb.querySelector('.wl-row');
    return { railW: Math.round(r.width), railScrollW: sb.scrollWidth, railClientW: sb.clientWidth,
      collapsedCls: sb.className, wlName: q('.wl-name'), wlQuote: q('.wl-quote'), sideText: q('.side-text'), wlSym: q('.wl-sym'),
      syms, rowW: row?Math.round(row.getBoundingClientRect().width):null, rowScrollW: row?row.scrollWidth:null };
  });
  console.log('collapsed state:', JSON.stringify(col, null, 1));
  console.log('console errors:', errs.length ? errs.slice(0,5) : 'none');
  await page.screenshot({ path: `tmp/probe-${w}.png` });
  await ctx.close();
}
await browser.close();
