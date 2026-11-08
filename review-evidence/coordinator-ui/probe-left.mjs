import { chromium } from 'playwright-core';
const b=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const ctx=await b.newContext({viewport:{width:390,height:844},colorScheme:'dark',hasTouch:true,isMobile:true});
const p=await ctx.newPage();
await p.goto('http://127.0.0.1:8787/',{waitUntil:'domcontentloaded'});
await new Promise(r=>setTimeout(r,1800));
for(const s of ['dashboard','chart','analysts']){
  if(s!=='dashboard'){
    await p.locator('.drawer-toggle').click({force:true});
    await new Promise(r=>setTimeout(r,450));
    await p.evaluate((sc)=>{const e=[...document.querySelectorAll('.side-item')].find(x=>x.getAttribute('data-screen')===sc);e?.click();},s);
    await new Promise(r=>setTimeout(r,1500));
    await p.evaluate(()=>document.querySelector('.scrim')?.click());
    await new Promise(r=>setTimeout(r,400));
  }
  const o=await p.evaluate(()=>{
    const r=[];
    for(const e of document.querySelectorAll('button,a[href],input,select,[role="button"]')){
      const b=e.getBoundingClientRect();
      if(b.height===0||e.closest('.scrim'))continue;
      if(b.height<44||b.width<44)
        r.push(`${e.tagName}.${(e.className||'').toString().trim().split(/\s+/)[0]||'-'} ${Math.round(b.height)}x${Math.round(b.width)} "${(e.textContent||e.getAttribute('aria-label')||'').trim().slice(0,14)}"`);
    }
    return r;
  });
  console.log(`--- ${s} ---`); o.forEach(x=>console.log('  '+x));
}
await b.close();
