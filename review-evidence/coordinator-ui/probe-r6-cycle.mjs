/**
 * Coordinator probe 2 — the close → reopen cycle, and logo occlusion.
 * Owner-of-file: coordinator (debug-debug_lead).
 * Run: node review-evidence/coordinator-ui/probe-r6-cycle.mjs
 */
import { chromium } from 'playwright-core';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL = process.env.UI_URL || 'http://127.0.0.1:8787/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
await page.goto(URL, { waitUntil: 'networkidle' }).catch(() => {});
await sleep(1500);

const snap = async (tag) => {
  const s = await page.evaluate(() => {
    const vis = (el) => {
      if (!el) return 'absent';
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      if (cs.display === 'none' || cs.visibility === 'hidden') return 'hidden';
      if (r.width === 0 || r.height === 0) return 'zero';
      return 'visible';
    };
    const sb = document.querySelector('.sidebar');
    const tg = document.querySelector('.drawer-toggle');
    const close = document.querySelector('.collapse-btn');
    const scrim = document.querySelector('.scrim');
    let hit = 'n/a';
    if (tg) {
      const r = tg.getBoundingClientRect();
      if (r.width && r.height) {
        const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        hit = el ? (el.closest('.drawer-toggle') ? 'SELF(ok)' : `${el.tagName}.${el.className}`) : 'none';
      }
    }
    return {
      sidebar: vis(sb), open: sb?.classList.contains('open') ?? null,
      chromeHidden: document.body.classList.contains('chrome-hidden'),
      toggle: vis(tg), toggleHit: hit,
      closeBtn: vis(close), scrim: vis(scrim),
    };
  });
  console.log(`${tag.padEnd(26)} ${JSON.stringify(s)}`);
  return s;
};

console.log('--- phone 390x844: full cycle ---');
await snap('initial (put away)');

// 1. open
await page.click('.drawer-toggle', { timeout: 3000 });
await sleep(500);
await snap('after 1st open');

// 2. close via the drawer's own close button
const closeVisible = await page.evaluate(() => {
  const c = document.querySelector('.collapse-btn');
  if (!c) return false;
  const r = c.getBoundingClientRect();
  return getComputedStyle(c).display !== 'none' && r.width > 0;
});
console.log('  collapse-btn usable:', closeVisible);

if (closeVisible) {
  await page.click('.collapse-btn', { timeout: 3000 });
  await sleep(500);
} else {
  // close via scrim instead
  await page.evaluate(() => document.querySelector('.scrim')?.click());
  await sleep(500);
}
await snap('after close');

// 3. THE OWNER'S COMPLAINT: can we get back out?
try {
  await page.click('.drawer-toggle', { timeout: 3000 });
  await sleep(600);
  const s = await snap('after 2nd open (reopen?)');
  console.log(`\n>>> REOPEN ${s.open ? 'WORKS' : 'FAILED'} (open=${s.open}, display=${s.sidebar})`);
} catch (e) {
  console.log(`\n>>> REOPEN FAILED — toggle not clickable: ${String(e).split('\n')[0]}`);
}

// 4. logo occlusion check at several scroll offsets
console.log('\n--- logo occlusion at scroll positions ---');
for (const y of [0, 200, 600, 1200]) {
  await page.evaluate((v) => window.scrollTo(0, v), y);
  await sleep(250);
  const r = await page.evaluate(() => {
    const tg = document.querySelector('.drawer-toggle');
    if (!tg) return null;
    const b = tg.getBoundingClientRect();
    const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
    // sample a grid inside the toggle; count how many points hit something else
    let covered = 0, total = 0, sample = null;
    for (let i = 0; i <= 4; i++) {
      for (let j = 0; j <= 2; j++) {
        const px = b.x + 4 + (b.width - 8) * (i / 4);
        const py = b.y + 4 + (b.height - 8) * (j / 2);
        const el = document.elementFromPoint(px, py);
        total++;
        if (el && !el.closest('.drawer-toggle')) {
          covered++;
          if (!sample) sample = `${el.tagName}.${String(el.className).slice(0, 40)}`;
        }
      }
    }
    return { y: Math.round(b.y), h: Math.round(b.height), covered, total, sample, scrollY: window.scrollY };
  });
  console.log(`  scrollY=${y}: ${JSON.stringify(r)}`);
}

await browser.close();