import { chromium } from 'playwright-core';
const b=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const p=await b.newPage({viewport:{width:390,height:844}});
await p.goto('http://127.0.0.1:8787/',{waitUntil:'networkidle'}).catch(()=>{});
await new Promise(r=>setTimeout(r,2500));
const r=await p.evaluate(()=>{
  const main=document.querySelector('.main-col');
  const sections=[...document.querySelectorAll('.stack > section, .stack > div.two-col, .stack > .panel')];
  return {
    scrollH: main?.scrollHeight, viewH: main?.clientHeight,
    screens: main? (main.scrollHeight/main.clientHeight).toFixed(2):null,
    blocks: sections.map(s=>{
      const rc=s.getBoundingClientRect();
      return {cls:s.className.split(' ').slice(0,2).join('.'), h:Math.round(rc.height),
        title:(s.querySelector('.panel-title,h2,h3')?.textContent||'').trim().slice(0,28)};
    })};
});
console.log(JSON.stringify(r,null,1));
await b.close();
