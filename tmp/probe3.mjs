import { chromium } from 'playwright-core';
const BASE='http://127.0.0.1:8787';
const CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const b = await chromium.launch({ executablePath: CHROME, headless: true, args:['--hide-scrollbars'] });
const ctx = await b.newContext({ viewport:{width:393,height:844} });
const p = await ctx.newPage();
await p.goto(BASE+'/', { waitUntil:'domcontentloaded' });
await p.waitForSelector('[data-testid="dashboard-screen"]',{timeout:25000});
await p.evaluate(()=>localStorage.setItem('stockcoach.sidebarCollapsed','1'));
await p.reload({waitUntil:'domcontentloaded'});
await p.waitForSelector('[data-testid="dashboard-screen"]',{timeout:25000});
await p.waitForTimeout(600);
const r = await p.evaluate(() => {
  const out = { sheets: [], media: [], disp: null, classes: null };
  out.mw = window.innerWidth;
  out.mediaMatch720 = window.matchMedia('(max-width:720px)').matches;
  for (const sheet of document.styleSheets) {
    out.sheets.push(sheet.href || '(inline)');
    let list; try { list = sheet.cssRules } catch(e) { out.sheets.push('ERR '+e.message); continue }
    const walk = (rules, cond) => {
      for (const rule of rules) {
        if (rule.media) { walk(rule.cssRules, cond + ' && ' + rule.media.mediaText); }
        else if (rule.selectorText && /sidebar\.collapsed/.test(rule.selectorText)) {
          out.media.push(cond + ' :: ' + rule.selectorText.slice(0,200) + ' {' + rule.style.cssText.slice(0,120) + '}');
        }
      }
    };
    walk(list, '(none)');
  }
  const sb = document.querySelector('.sidebar');
  out.classes = sb.className;
  const q = (s) => { const el = sb.querySelector(s); if (!el) return null; const cs = getComputedStyle(el); return cs.display; };
  out.disp = { wlName: q('.wl-name'), sideText: q('.side-text') };
  return out;
});
console.log(JSON.stringify(r, null, 1));
await b.close();
