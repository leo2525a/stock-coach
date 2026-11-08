import { chromium } from 'playwright-core';
const b=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const p=await b.newPage({viewport:{width:402,height:874}});
await p.goto('http://127.0.0.1:8787/',{waitUntil:'networkidle'}).catch(()=>{});
await new Promise(r=>setTimeout(r,1200));

async function measure(label){
  const r=await p.evaluate(()=>{
    const t=document.querySelector('.drawer-toggle');
    const app=document.querySelector('.app');
    const main=document.querySelector('.main-col');
    const tr=t?.getBoundingClientRect();
    return {toggle: tr?{top:Math.round(tr.top),left:Math.round(tr.left),w:Math.round(tr.width),h:Math.round(tr.height)}:null,
      appPadTop: app?getComputedStyle(app).paddingTop:null,
      mainTop: main?Math.round(main.getBoundingClientRect().top):null};
  });
  console.log(label, JSON.stringify(r));
  return r;
}
const before=await measure('NO INSET   ');
// simulate iPhone 17 notch
await p.evaluate(()=>document.documentElement.style.setProperty('--safe-top','62px'));
await new Promise(r=>setTimeout(r,300));
const after=await measure('62pt INSET ');
console.log('');
console.log('toggle cleared notch?', after.toggle.top >= 62 ? 'PASS ('+after.toggle.top+'pt >= 62pt)' : 'FAIL ('+after.toggle.top+'pt)');
console.log('content cleared notch?', after.mainTop >= 62 ? 'PASS' : 'FAIL ('+after.mainTop+'pt)');
await b.close();
