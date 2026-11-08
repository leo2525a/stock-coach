import { chromium } from 'playwright-core';
const b=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
for (const [w,h,label] of [[390,844,'PHONE'],[1440,900,'DESKTOP']]) {
  const p=await b.newPage({viewport:{width:w,height:h}});
  await p.goto('http://127.0.0.1:8787/',{waitUntil:'networkidle'}).catch(()=>{});
  await new Promise(r=>setTimeout(r,1200));
  await p.evaluate(()=>{const els=[...document.querySelectorAll('.sidebar button, .sidebar a')];els.find(e=>/圖表|Chart/i.test(e.textContent||''))?.click();});
  await new Promise(r=>setTimeout(r,1500));
  await p.evaluate(()=>document.querySelector('.scrim')?.click());
  await new Promise(r=>setTimeout(r,500));
  const base=await p.evaluate(()=>{
    const tb=document.querySelector('.chart-toolbar');
    const wrap=document.querySelector('.chart-toolbar-wrap');
    const tabs=[...document.querySelectorAll('.toolbar-tabs button')];
    const groups=[...document.querySelectorAll('.toolbar-group[data-group]')];
    const tbR=tb?.getBoundingClientRect();
    return {wrapFound:!!wrap, tabCount:tabs.length, tabLabels:tabs.map(t=>t.textContent.trim()),
      tabsVisible: tabs.length? tabs[0].getBoundingClientRect().height>0 : false,
      overflow: tb? Math.round(tb.scrollWidth - tb.clientWidth):null,
      groupsVisible: groups.filter(g=>g.getBoundingClientRect().height>0).length,
      groupNames: groups.map(g=>g.dataset.group+':'+(g.getBoundingClientRect().height>0?'shown':'hidden'))};
  });
  console.log(`\n=== ${label} ${w}x${h} ===`);
  console.log(JSON.stringify(base,null,1));
  if (label==='PHONE') {
    // click each tab, confirm its group appears and no horizontal overflow
    for (const id of ['interval','overlays','panes']) {
      await p.locator(`.toolbar-tabs button[data-tab="${id}"]`).click();
      await new Promise(r=>setTimeout(r,300));
      const st=await p.evaluate((gid)=>{
        const tb=document.querySelector('.chart-toolbar');
        const g=document.querySelector(`.toolbar-group[data-group="${gid}"]`);
        const r=g?.getBoundingClientRect();
        return {shown: r? r.height>0:false, btnCount:g?g.querySelectorAll('button').length:0,
          overflowPx: tb? Math.round(tb.scrollWidth-tb.clientWidth):null,
          groupW: r?Math.round(r.width):0, viewW: tb?Math.round(tb.clientWidth):0};
      }, id);
      console.log(`  tab ${id}:`, JSON.stringify(st));
    }
  }
  await p.close();
}
await b.close();
