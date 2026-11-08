import { chromium } from 'playwright-core';
const b=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const p=await b.newPage({viewport:{width:390,height:844}});
await p.goto('http://127.0.0.1:8787/',{waitUntil:'networkidle'}).catch(()=>{});
await new Promise(r=>setTimeout(r,1500));
await p.locator('.drawer-toggle').first().click({force:true});
await new Promise(r=>setTimeout(r,600));
const r=await p.evaluate(()=>{
  const items=[...document.querySelectorAll('.side-icon')];
  return {
    iconCount: items.length,
    detail: items.map(i=>{
      const svg=i.querySelector('svg');
      if(!svg) return {ok:false, text:i.textContent};
      const parts=[...svg.children].map(c=>c.tagName);
      return {ok:true, w:svg.getAttribute('width'), parts:parts.join('+'),
        hasStroke: svg.getAttribute('stroke'), fill:svg.getAttribute('fill'),
        paths: parts.length};
    })
  };
});
console.log(JSON.stringify(r,null,1));
await b.close();
