import { chromium, devices } from 'playwright-core';
const b=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const tests=[['plain',{viewport:{width:402,height:874}}],
             ['iphone13',{...devices['iPhone 13']}],
             ['iphone14pro',{...devices['iPhone 14 Pro']}]];
for (const [name,opts] of tests){
  const p=await b.newPage(opts);
  await p.setContent(`<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <div id=probe style="position:absolute;top:calc(env(safe-area-inset-top,0px) + 8px);left:10px">x</div>`);
  const r=await p.evaluate(()=>{
    const d=document.getElementById('probe');
    return {top:getComputedStyle(d).top, insetTop:getComputedStyle(d).getPropertyValue('top')};
  });
  console.log(name, JSON.stringify(r));
  await p.close();
}
await b.close();
