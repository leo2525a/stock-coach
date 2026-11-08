import { chromium } from 'playwright-core';
const b=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const p=await b.newPage({viewport:{width:402,height:874},deviceScaleFactor:3});
const errs=[]; p.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
p.on('console',m=>{ if(m.type()==='error') errs.push('CONSOLE: '+m.text().slice(0,200)); });
await p.goto('http://127.0.0.1:8787/',{waitUntil:'networkidle'}).catch(e=>errs.push('NAV: '+e.message));
await new Promise(r=>setTimeout(r,2500));
const info=await p.evaluate(()=>{
  const root=document.getElementById('root');
  const app=document.querySelector('.app');
  const vis=[...document.querySelectorAll('section.panel, .panel')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0;});
  return {rootChildren: root?root.children.length:-1, appFound:!!app,
    appRect: app?{x:app.getBoundingClientRect().x,y:app.getBoundingClientRect().y,w:Math.round(app.getBoundingClientRect().width),h:Math.round(app.getBoundingClientRect().height)}:null,
    appPadTop: app?getComputedStyle(app).paddingTop:null,
    panelsVisible: vis.length, textLen: (document.body.innerText||'').trim().length,
    snippet: (document.body.innerText||'').trim().slice(0,120)};
});
console.log(JSON.stringify(info,null,1));
console.log('errors:', errs.length? errs.slice(0,6): 'none');
await b.close();
