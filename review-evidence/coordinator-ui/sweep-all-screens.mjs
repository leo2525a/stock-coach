/**
 * Whole-app UI sweep (owner round 7, item 5: 「全個 app ui 行一次我要整潔易用」).
 *
 * Walks every screen at every breakpoint and reports measurable defects rather
 * than impressions: horizontal overflow, controls under the 44px touch minimum,
 * content hidden under the top safe area, empty screens, console errors, and
 * pages long enough to be unusable. Writes a table to stdout.
 */
import { chromium } from 'playwright-core';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8787/';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const NI = 62;

const SCREENS = ['dashboard', 'chart', 'signals', 'watchlist', 'analysts', 'dividends', 'help'];
const VIEWPORTS = [
  { name: 'phone-390', w: 390, h: 844, touch: true },
  { name: 'phone-402-i17', w: 402, h: 874, touch: true },
  { name: 'tablet-834', w: 834, h: 1112, touch: true },
  { name: 'desktop-1440', w: 1440, h: 900, touch: false },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const issues = [];

for (const vp of VIEWPORTS) {
  for (const screen of SCREENS) {
    const ctx = await browser.newContext({
      viewport: { width: vp.w, height: vp.h },
      colorScheme: 'dark', hasTouch: vp.touch, isMobile: vp.touch,
    });
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', (e) => errs.push(String(e).slice(0, 90)));
    await p.goto(BASE, { waitUntil: 'domcontentloaded' });
    await sleep(1600);

    // Navigate by clicking the real row, the way a person would.
    if (screen !== 'dashboard') {
      await p.locator('.drawer-toggle').click({ force: true });
      await sleep(500);
      const clicked = await p.evaluate((s) => {
        const el = [...document.querySelectorAll('.side-item')]
          .find((e) => (e.getAttribute('data-screen') || '') === s);
        if (el) { el.click(); return true; }
        return false;
      }, screen);
      if (!clicked) { issues.push([vp.name, screen, 'nav', 'no nav row for this screen']); }
      await sleep(1500);
      await p.evaluate(() => document.querySelector('.scrim')?.click());
      await sleep(400);
    }

    await p.evaluate((px) => document.documentElement.style.setProperty('--safe-top', `${px}px`), NI);
    await sleep(300);

    const m = await p.evaluate(({ ni, isTouch }) => {
      const main = document.querySelector('.main-col');
      const de = document.documentElement;
      const vis = (e) => e.getBoundingClientRect().height > 0;
      const interactive = [...document.querySelectorAll('button, a[href], input, select, [role="button"]')]
        .filter((e) => vis(e) && !e.closest('.scrim'));
      // 44px is a *finger* contract: with a mouse it is merely wasteful, so a
      // desktop pass reports nothing here by design.
      const tiny = interactive
        .filter((e) => { const r = e.getBoundingClientRect(); return isTouch && (r.height < 44 || r.width < 44); })
        .map((e) => `${(e.textContent || e.getAttribute('aria-label') || e.tagName).trim().slice(0, 16)}=${Math.round(e.getBoundingClientRect().height)}`);
      // Anything painted inside the safe-area band is unreachable content.
      const inBand = [...document.querySelectorAll('.main-col *')]
        .filter((e) => vis(e) && e.getBoundingClientRect().top < ni)
        .slice(0, 4)
        .map((e) => `${e.tagName}.${(e.className || '').toString().split(' ')[0]}`);
      return {
        hOverflow: de.scrollWidth - de.clientWidth,
        hOverflowMain: main ? main.scrollWidth - main.clientWidth : 0,
        screens: main ? +(main.scrollHeight / main.clientHeight).toFixed(2) : 0,
        chars: (document.body.innerText || '').trim().length,
        interactive: interactive.length,
        tiny: tiny.slice(0, 5),
        inBand: inBand.slice(0, 3),
      };
    }, { ni: NI, isTouch: vp.touch });

    if (m.hOverflow > 1) issues.push([vp.name, screen, 'overflow-x', `${m.hOverflow}px`]);
    if (m.hOverflowMain > 1) issues.push([vp.name, screen, 'overflow-x-main', `${m.hOverflowMain}px`]);
    if (m.chars < 200) issues.push([vp.name, screen, 'empty', `${m.chars} chars`]);
    if (m.tiny.length) issues.push([vp.name, screen, 'touch<44', m.tiny.join(', ')]);
    if (m.inBand.length) issues.push([vp.name, screen, 'under-safe-area', m.inBand.join(', ')]);
    if (errs.length) issues.push([vp.name, screen, 'js-error', errs[0]]);

    console.log(
      `${vp.name.padEnd(15)} ${screen.padEnd(10)} h=${String(m.hOverflow).padStart(3)} ` +
      `screens=${String(m.screens).padStart(5)} ctl=${String(m.interactive).padStart(3)} ` +
      `tiny=${m.tiny.length} band=${m.inBand.length} chars=${m.chars}`,
    );
    await ctx.close();
  }
}

await browser.close();
console.log(`\n${issues.length} issue(s)`);
for (const [vp, s, kind, detail] of issues) console.log(`  ${vp} / ${s} / ${kind}: ${detail}`);

// This walk is a contract, not a report: the whole app must stay free of these
// defects, so a regression fails the build rather than printing a line.
process.exit(issues.length ? 1 : 0);
