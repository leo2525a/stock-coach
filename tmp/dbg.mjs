import { chromium } from 'playwright-core';
const CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const b = await chromium.launch({ executablePath: CHROME, headless: true });
for (const w of [393, 1280]) {
  const ctx = await b.newContext({ viewport:{width:w,height:800} });
  const p = await ctx.newPage();
  await p.goto('file:///Users/love21/.openclaw/workspace/debug-coder/projects/stock-app/tmp/dbg.html');
  const r = await p.evaluate(() => {
    const sb = document.querySelector('.sidebar');
    const q = (s) => { const el = sb.querySelector(s); return el ? getComputedStyle(el).display : null; };
    const rules = [];
    for (const sheet of document.styleSheets) {
      let list; try { list = sheet.cssRules } catch { continue }
      const walk = (rules, cond) => {
        for (const rule of rules) {
          if (rule.media && window.matchMedia(rule.media.mediaText).matches) walk(rule.cssRules, rule.media.mediaText);
          else if (rule.selectorText && /sidebar\.collapsed/.test(rule.selectorText) && /display/.test(rule.style.cssText)) rules_out.push(cond + ' || ' + rule.selectorText + ' {' + rule.style.cssText + '}');
        }
      };
      var rules_out = rules;
      walk(list, '(none)');
    }
    return { disp: { wlName: q('.wl-name'), wlQuote: q('.wl-quote'), sideText: q('.side-text'), groupBy: q('.group-by') }, sbDisplay: getComputedStyle(sb).display, rules };
  });
  console.log('width', w, JSON.stringify(r, null, 1));
  await ctx.close();
}
await b.close();
