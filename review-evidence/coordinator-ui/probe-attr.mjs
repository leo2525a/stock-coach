import { chromium } from 'playwright-core';
const b=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const ctx=await b.newContext({viewport:{width:390,height:844},colorScheme:'dark',hasTouch:true,isMobile:true});
const p=await ctx.newPage();
await p.goto('http://127.0.0.1:8787/',{waitUntil:'domcontentloaded'});
await new Promise(r=>setTimeout(r,2000));
const o=await p.evaluate(()=>{
  const a=[...document.querySelectorAll('a[href]')].filter(x=>x.getBoundingClientRect().height>0)[0];
  if(!a) return 'none';
  const path=[];let e=a;
  for(let i=0;i<5&&e;i++,e=e.parentElement){
    const r=e.getBoundingClientRect();
    path.push({tag:e.tagName,cls:(e.className||'').toString().slice(0,60),w:Math.round(r.width),h:Math.round(r.height)});
  }
  return path;
});
console.log(JSON.stringify(o,null,1));
await b.close();
