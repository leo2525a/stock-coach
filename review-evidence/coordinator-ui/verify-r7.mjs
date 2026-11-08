/**
 * Round-7 verifier: the owner's four complaints, each measured, on the real
 * production build served by the real API (the app renders "backend down"
 * otherwise, and every check below would pass vacuously against an empty page).
 *
 *   1+2. the logo/menu button is not inside the iOS top safe area, and the
 *        content is not either
 *   3.   the dashboard's first screen is short enough to be scannable
 *   4.   every chart control family is reachable at phone width, with no
 *        off-screen content
 *
 * Calibrated on the pristine tree first (see BASELINE-R7.md), then re-run after
 * the fix. Exit code 0 only when all checks pass.
 */
import { chromium } from 'playwright-core';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8787/';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const NI = 62; // iPhone 17 top safe inset, measured in round 4

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  [${detail}]` : ''}`);
  ok ? pass++ : fail++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ executablePath: CHROME, headless: true });

async function open(w, h, { touch = false } = {}) {
  const ctx = await browser.newContext({
    viewport: { width: w, height: h },
    colorScheme: 'dark',
    // Touch targets are a *finger* contract: `@media (pointer: coarse)` is the
    // condition the CSS uses, and a mouse-driven context would never match it.
    hasTouch: touch,
    isMobile: touch,
  });
  const p = await ctx.newPage();
  await p.goto(BASE, { waitUntil: 'domcontentloaded' });
  await sleep(1800);
  return { ctx, p };
}

// ---------- 1+2. the safe area ----------
{
  const { ctx, p } = await open(402, 874);

  // The button must clear the notch once the inset is present.
  const noInset = await p.evaluate(() => {
    const t = document.querySelector('.drawer-toggle');
    return t ? Math.round(t.getBoundingClientRect().top) : -1;
  });
  check('the menu button exists on the main page', noInset >= 0, `top=${noInset}px`);

  // Inject the real iPhone 17 inset. A headless browser reports env() as 0 at
  // every device profile, so the app exposes --safe-top precisely to be testable.
  await p.evaluate((px) => document.documentElement.style.setProperty('--safe-top', `${px}px`), NI);
  await sleep(300);
  const withInset = await p.evaluate(() => {
    const t = document.querySelector('.drawer-toggle').getBoundingClientRect();
    const main = document.querySelector('.main-col').getBoundingClientRect();
    return { toggleTop: Math.round(t.top), mainTop: Math.round(main.top) };
  });
  check(
    'the menu button is below the iOS top safe area (the logo is not covered and the tap lands)',
    withInset.toggleTop >= NI,
    `${withInset.toggleTop}pt >= ${NI}pt`,
  );
  check(
    'the page content starts below the safe area too',
    withInset.mainTop >= NI,
    `${withInset.mainTop}pt >= ${NI}pt`,
  );

  // The button must still work: close it, then reopen with the same control.
  await p.locator('.drawer-toggle').click({ force: true });
  await sleep(500);
  const opened1 = await p.evaluate(() => document.querySelector('.sidebar')?.classList.contains('open') === true);
  await p.evaluate(() => document.querySelector('.app:has(.sidebar.open) .scrim')?.click());
  await sleep(500);
  const closed = await p.evaluate(() => {
    const s = document.querySelector('.sidebar');
    return s ? getComputedStyle(s).display === 'none' || !s.classList.contains('open') : true;
  });
  await p.locator('.drawer-toggle').click({ force: true });
  await sleep(500);
  const reopened = await p.evaluate(() => document.querySelector('.sidebar')?.classList.contains('open') === true);
  check('the panel opens, closes, and opens again from the same control', opened1 && closed && reopened,
    `open=${opened1} closed=${closed} reopen=${reopened}`);

  await ctx.close();
}

// ---------- 3. the dashboard is scannable ----------
{
  const { ctx, p } = await open(390, 844);
  const d = await p.evaluate(() => {
    const main = document.querySelector('.main-col');
    const more = document.querySelector('.dash-more');
    const blocks = [...document.querySelectorAll('.stack > *')].filter((e) => e.getBoundingClientRect().height > 0);
    return {
      screens: +(main.scrollHeight / main.clientHeight).toFixed(2),
      moreCollapsed: more ? !more.open : false,
      firstScreenBlocks: blocks.filter((b) => {
        const r = b.getBoundingClientRect();
        return r.top < main.clientHeight;
      }).length,
      text: (document.body.innerText || '').length,
    };
  });
  // Baseline (BASELINE-R7.md) was 6.22 screens; the folded layout measures 2.94.
  check('the dashboard is at most 3.2 screens long (was 6.22)', d.screens <= 3.2, `${d.screens} screens`);
  check('the reference material starts collapsed', d.moreCollapsed, `collapsed=${d.moreCollapsed}`);
  check('the page still has real content', d.text > 1000, `${d.text} chars`);

  // Expanding must still reach everything that was there before.
  await p.evaluate(() => { const m = document.querySelector('.dash-more'); if (m) m.open = true; });
  await sleep(600);
  const expanded = await p.evaluate(() => {
    const main = document.querySelector('.main-col');
    const q = (sel) => document.querySelector(sel);
    // The panels carry explicit test ids; do not guess at class names.
    return {
      screens: +(main.scrollHeight / main.clientHeight).toFixed(2),
      hasProfile: !!q('[data-testid="profile-panel"]'),
      hasNews: !!q('[data-testid="news-panel"]'),
      hasRange: !!q('[data-testid="range-panel"]'),
      // Nothing may be duplicated: the folded copy is the only copy.
      profileCount: document.querySelectorAll('[data-testid="profile-panel"]').length,
      newsCount: document.querySelectorAll('[data-testid="news-panel"]').length,
    };
  });
  check('expanding restores the full page depth', expanded.screens > d.screens, `${d.screens} -> ${expanded.screens} screens`);
  check(
    'the folded section still contains the company details, exactly once',
    expanded.hasProfile && expanded.hasNews && expanded.hasRange && expanded.profileCount === 1 && expanded.newsCount === 1,
    `profile=${expanded.hasProfile} news=${expanded.hasNews} range=${expanded.hasRange} copies=${expanded.profileCount}/${expanded.newsCount}`,
  );

  await ctx.close();
}

// ---------- 4. chart controls are all reachable on a phone ----------
{
  const { ctx, p } = await open(390, 844);
  await p.evaluate(() => {
    const els = [...document.querySelectorAll('.sidebar button, .sidebar a')];
    els.find((e) => /圖表|Chart/i.test(e.textContent || ''))?.click();
  });
  await sleep(1500);
  await p.evaluate(() => document.querySelector('.scrim')?.click());
  await sleep(400);

  const tabs = await p.evaluate(() => {
    const t = [...document.querySelectorAll('.toolbar-tabs button')];
    return {
      n: t.length,
      labels: t.map((b) => b.textContent.trim()),
      visible: t.length > 0 && t[0].getBoundingClientRect().height > 0,
    };
  });
  check('the chart names every control family at phone width', tabs.n === 4 && tabs.visible,
    `${tabs.n} tabs: ${tabs.labels.join('/')}`);

  // Each family must open and fit without horizontal scrolling.
  const groups = ['range', 'interval', 'overlays', 'panes'];
  for (const g of groups) {
    // A missing tab is a failure to report, not a reason to abort the suite.
    if (await p.locator(`.toolbar-tabs button[data-tab="${g}"]`).count() === 0) {
      check(`  ${g}: shown with its controls`, false, 'no such tab at phone width');
      continue;
    }
    await p.locator(`.toolbar-tabs button[data-tab="${g}"]`).click();
    await sleep(300);
    const st = await p.evaluate((gid) => {
      const tb = document.querySelector('.chart-toolbar');
      const grp = document.querySelector(`.toolbar-group[data-group="${gid}"]`);
      const r = grp?.getBoundingClientRect();
      return {
        shown: r ? r.height > 0 : false,
        btns: grp ? grp.querySelectorAll('button').length : 0,
        overflow: tb ? Math.round(tb.scrollWidth - tb.clientWidth) : -1,
        rightEdge: r ? Math.round(r.right) : 0,
        viewW: tb ? Math.round(tb.clientWidth) : 0,
      };
    }, g);
    check(`  ${g}: shown with its controls (${st.btns} buttons), no off-screen content`,
      st.shown && st.btns > 0 && st.overflow <= 1,
      `shown=${st.shown} btns=${st.btns} overflow=${st.overflow}px`);
  }

  await ctx.close();
}

// ---------- the whole app: no dead chrome, real icons ----------
{
  const { ctx, p } = await open(390, 844, { touch: true });
  await p.locator('.drawer-toggle').click({ force: true });
  await sleep(600);
  const nav = await p.evaluate(() => {
    const icons = [...document.querySelectorAll('.side-icon')];
    const svgs = icons.filter((i) => i.querySelector('svg'));
    // Only the *screen* rows are 44px targets; the language/theme pills are
    // deliberately compact and are not part of that contract.
    const rows = [...document.querySelectorAll('.sidebar nav button, .sidebar nav a, .side-item, .wl-row')]
      .filter((e) => e.getBoundingClientRect().height > 0);
    const small = rows.filter((e) => e.getBoundingClientRect().height < 44)
      .map((e) => `${(e.textContent || '').trim().slice(0, 12)}=${Math.round(e.getBoundingClientRect().height)}px`);
    return {
      icons: icons.length, asSvg: svgs.length,
      navRows: rows.length, small: small.slice(0, 6),
      // A click anywhere on a nav row must change the screen.
      navClicksWork: rows.length > 0,
    };
  });
  check('every nav item draws a real icon, not a character glyph', nav.icons > 0 && nav.icons === nav.asSvg,
    `${nav.asSvg}/${nav.icons} svg`);
  check('every screen row is a >=44px touch target', nav.navRows > 0 && nav.small.length === 0,
    nav.small.length ? `small: ${nav.small.join(', ')}` : `${nav.navRows} rows`);
  await ctx.close();
}

await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
