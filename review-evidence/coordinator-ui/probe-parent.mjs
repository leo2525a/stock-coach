import { chromium } from 'playwright-core';
const b=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const ctx=await b.newContext({viewport:{width:390,height:844},colorScheme:'dark',hasTouch:true,isMobile:true});
const p=await ctx.newPage();
await p.goto('http://127.0.0.1:8787/',{waitUntil:'domcontentloaded'});
await new Promise(r=>setTimeout(r,1800));
await p.locator('.drawer-toggle').click({force:true});
await new Promise(r=>setTimeout(r,450));
await p.evaluate(()=>{const e=[...document.querySelectorAll('.side-item')].find(x=>x.getAttribute('data-screen')==='analysts');e?.click();});
await new Promise(r=>setTimeout(r,1600));
await p.evaluate(()=>document.querySelector('.scrim')?.click());
await new Promise(r=>setTimeout(r,400));
const o=await p.evaluate(()=>{
  const btn=[...document.querySelectorAll('button')].find(e=>/^(MTD|1M|QTD)$/.test((e.textContent||'').trim()));
  if(!btn) return 'not found';
  const chain=[];let e=btn;
  for(let i=0;i<4&&e;i++,e=e.parentElement){
    const cs=getComputedStyle(e);const r=e.getBoundingClientRect();
    chain.push({tag:e.tagName,cls:(e.className||'').toString().slice(0,40),h:Math.round(r.height),minH:cs.minHeight,height:cs.height,display:cs.display,alignItems:cs.alignItems,flexShrink:cs.flexShrink,overflow:cs.overflow});
  }
  return chain;
});
console.log(JSON.stringify(o,null,1));
await b.close();
