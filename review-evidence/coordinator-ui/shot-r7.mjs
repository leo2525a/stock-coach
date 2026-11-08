import { chromium } from 'playwright-core';
const BASE='http://127.0.0.1:8787/';
const b=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const ctx=await b.newContext({viewport:{width:390,height:844},colorScheme:'dark',hasTouch:true,isMobile:true,deviceScaleFactor:2});
const p=await ctx.newPage();
await p.goto(BASE,{waitUntil:'domcontentloaded'});
await new Promise(r=>setTimeout(r,2000));
await p.screenshot({path:'/tmp/r7-dash-top.png'});
// open the drawer, show the icons
await p.locator('.drawer-toggle').click({force:true});
await new Promise(r=>setTimeout(r,700));
await p.screenshot({path:'/tmp/r7-drawer.png'});
await p.evaluate(()=>document.querySelector('.scrim')?.click());
await new Promise(r=>setTimeout(r,500));
// chart screen
await p.evaluate(()=>{const e=[...document.querySelectorAll('.side-item')].find(x=>/圖表/.test(x.textContent||''));e?.click();});
await new Promise(r=>setTimeout(r,1800));
await p.screenshot({path:'/tmp/r7-chart.png'});
await b.close();
console.log('shots written');
