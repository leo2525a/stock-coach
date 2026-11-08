import { chromium } from 'playwright-core';
const b=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const p=await b.newPage({viewport:{width:390,height:844}});
await p.goto('http://127.0.0.1:8787/',{waitUntil:'networkidle'}).catch(()=>{});
await new Promise(r=>setTimeout(r,2500));
const r=await p.evaluate(()=>{
  const main=document.querySelector('.main-col');
  const stack=document.querySelector('.stack');
  const kids=[...stack.children];
  return {scrollH:main.scrollHeight, viewH:main.clientHeight,
    screens:+(main.scrollHeight/main.clientHeight).toFixed(2),
    moreOpen: document.querySelector('.dash-more')?.open,
    moreH: Math.round(document.querySelector('.dash-more')?.getBoundingClientRect().height||0),
    children: kids.map(k=>{const rc=k.getBoundingClientRect();
      return {tag:k.tagName.toLowerCase()+'.'+k.className.split(' ')[0], h:Math.round(rc.height),
        t:(k.querySelector('.panel-title,h2,h3,summary')?.textContent||'').trim().slice(0,30)};})};
});
console.log(JSON.stringify(r,null,1));
await b.close();
