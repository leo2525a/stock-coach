import { chromium } from 'playwright-core';
const b=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const ctx=await b.newContext({viewport:{width:390,height:844},colorScheme:'dark',hasTouch:true,isMobile:true});
const p=await ctx.newPage();
await p.goto('http://127.0.0.1:8787/',{waitUntil:'domcontentloaded'});
await new Promise(r=>setTimeout(r,1800));
const o=await p.evaluate(()=>[...document.querySelectorAll('a[href]')].filter(a=>{
  const r=a.getBoundingClientRect();
  return r.height>0 && !a.closest('.scrim') && (r.height<44||r.width<44);
}).map(a=>{
  const r=a.getBoundingClientRect();
  return {h:Math.round(r.height),w:Math.round(r.width),cls:(a.className||'').toString().slice(0,50),
          href:(a.getAttribute('href')||'').slice(0,40),txt:(a.textContent||'').trim().slice(0,20),
          html:a.innerHTML.slice(0,90)};
}));
console.log(JSON.stringify(o,null,1));
await b.close();
