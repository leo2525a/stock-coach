import { chromium } from 'playwright-core';
const BASE='http://127.0.0.1:8787/';
const b=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const ctx=await b.newContext({viewport:{width:390,height:844},colorScheme:'dark',hasTouch:true,isMobile:true});
const p=await ctx.newPage();
await p.goto(BASE,{waitUntil:'domcontentloaded'});
await new Promise(r=>setTimeout(r,1800));
const screens=['dashboard','chart','signals','watchlist','analysts','dividends','help'];
for(const s of screens){
  if(s!=='dashboard'){
    await p.locator('.drawer-toggle').click({force:true});
    await new Promise(r=>setTimeout(r,450));
    await p.evaluate((sc)=>{const e=[...document.querySelectorAll('.side-item')].find(x=>x.getAttribute('data-screen')===sc);e?.click();},s);
    await new Promise(r=>setTimeout(r,1400));
    await p.evaluate(()=>document.querySelector('.scrim')?.click());
    await new Promise(r=>setTimeout(r,400));
  }
  const out=await p.evaluate(()=>{
    const seen=new Map();
    for(const e of document.querySelectorAll('button, a[href], input, select, [role="button"]')){
      const r=e.getBoundingClientRect();
      if(r.height===0||e.closest('.scrim'))continue;
      if(r.height<44||r.width<44){
        const cls=(e.className||'').toString().trim().split(/\s+/)[0]||e.tagName.toLowerCase();
        const k=`${cls}`;
        const prev=seen.get(k)||{n:0,h:Math.round(r.height),w:Math.round(r.width),txt:(e.textContent||'').trim().slice(0,12)};
        prev.n++; seen.set(k,prev);
      }
    }
    return [...seen.entries()].map(([k,v])=>`${k} x${v.n} ${v.h}x${v.w} "${v.txt}"`);
  });
  console.log(`--- ${s} ---`); out.forEach(l=>console.log('  '+l));
}
await b.close();
