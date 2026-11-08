/**
 * Coordinator probe — owner's 4 new complaints, measured not guessed.
 * Owner-of-file: coordinator (debug-debug_lead).
 * Run: node review-evidence/coordinator-ui/probe-r6.mjs
 */
import { chromium } from 'playwright-core';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL = process.env.UI_URL || 'http://127.0.0.1:8787/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ executablePath: CHROME, headless: true });

async function at(width, height, label) {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.goto(URL, { waitUntil: 'networkidle' }).catch(() => {});
  await sleep(1200);

  const state = await page.evaluate(() => {
    const vis = (el) => {
      if (!el) return 'absent';
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      if (cs.display === 'none' || cs.visibility === 'hidden') return 'hidden';
      if (r.width === 0 || r.height === 0) return 'zero-size';
      return 'visible';
    };
    const sb = document.querySelector('.sidebar');
    const tg = document.querySelector('.drawer-toggle');
    const tgRect = tg?.getBoundingClientRect();
    // what covers the toggle?
    let cover = null;
    if (tgRect) {
      const hit = document.elementFromPoint(tgRect.x + tgRect.width / 2, tgRect.y + tgRect.height / 2);
      cover = hit ? (hit.closest('.drawer-toggle') ? 'SELF' : hit.className || hit.tagName) : 'none';
    }
    const sr = sb?.getBoundingClientRect();
    return {
      sidebar: vis(sb),
      sidebarOpenClass: sb?.classList.contains('open') ?? null,
      toggle: vis(tg),
      toggleRect: tgRect ? { x: Math.round(tgRect.x), y: Math.round(tgRect.y), w: Math.round(tgRect.width), h: Math.round(tgRect.height) } : null,
      toggleTopHit: cover,
      bodyChromeHidden: document.body.classList.contains('chrome-hidden'),
      ariaExpanded: tg?.getAttribute('aria-expanded'),
      sidebarRect: sr ? { x: Math.round(sr.x), w: Math.round(sr.width) } : null,
    };
  });

  console.log(`\n=== ${label} (${width}x${height}) ===`);
  console.log(JSON.stringify(state, null, 2));

  // Try to click the toggle and see whether the sidebar comes back
  if (state.toggle === 'visible' || state.toggle === 'zero-size') {
    try {
      await page.click('.drawer-toggle', { timeout: 2500 });
      await sleep(600);
      const after = await page.evaluate(() => {
        const sb = document.querySelector('.sidebar');
        const cs = sb ? getComputedStyle(sb) : null;
        return { display: cs?.display, open: sb?.classList.contains('open') ?? null };
      });
      console.log(`  after click: ${JSON.stringify(after)}`);
    } catch (e) {
      console.log(`  CLICK FAILED: ${String(e).split('\n')[0]}`);
    }
  } else {
    console.log('  -> toggle not clickable, cannot reopen');
  }
  return page;
}

const p1 = await at(390, 844, 'iPhone');
await p1.close();
const p2 = await at(1440, 900, 'Desktop');
await p2.close();
const p3 = await at(834, 1112, 'Tablet');
await p3.close();

await browser.close();