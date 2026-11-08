import { chromium } from 'playwright-core';
const CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const b=await chromium.launch({executablePath:CHROME,headless:true});
for (const [w,h,label] of [[390,844,'phone'],[1440,900,'desktop']]) {
  const p=await b.newPage({viewport:{width:w,height:h}});
  await p.goto('http://127.0.0.1:8787/',{waitUntil:'networkidle'}).catch(()=>{});
  await new Promise(r=>setTimeout(r,1200));
  // open the drawer, click chart, close drawer
  await p.locator('.drawer-toggle').first().click({force:true}).catch(()=>{});
  await new Promise(r=>setTimeout(r,400));
  await p.evaluate(()=>{ const els=[...document.querySelectorAll('.sidebar button, .sidebar a')];
    const t=els.find(e=>/Chart|圖表/i.test(e.textContent||'')); t?.click(); });
  await new Promise(r=>setTimeout(r,1500));
  await p.evaluate(()=>document.querySelector('.scrim')?.click());
  await new Promise(r=>setTimeout(r,400));
  const info=await p.evaluate(()=>{
    const tb=document.querySelector('.chart-toolbar') || document.querySelector('[class*=toolbar]');
    const groups=[...document.querySelectorAll('.toolbar-group')];
    return {
      toolbarFound: !!tb,
      toolbarRect: tb? {x:Math.round(tb.getBoundingClientRect().x),y:Math.round(tb.getBoundingClientRect().y),w:Math.round(tb.getBoundingClientRect().width),h:Math.round(tb.getBoundingClientRect().height),scrollW:tb.scrollWidth,clientW:tb.clientWidth}:null,
      overflowX: tb? getComputedStyle(tb).overflowX : null,
      groupCount: groups.length,
      groups: groups.map(g=>{const r=g.getBoundingClientRect();const cs=getComputedStyle(g);
        return {label:g.getAttribute('aria-label'), disp:cs.display, visible:r.width>0&&r.height>0, x:Math.round(r.x), w:Math.round(r.width), btnCount:g.querySelectorAll('button').length};}),
    };
  });
  console.log(`\n=== ${label} ${w}x${h} ===`); console.log(JSON.stringify(info,null,1));
  await p.close();
}
await b.close();
