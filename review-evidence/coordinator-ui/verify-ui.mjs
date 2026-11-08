/**
 * Coordinator's INDEPENDENT verifier for the owner's 5 UI complaints.
 * Runs against the production build and asserts NUMBERS, not adjectives.
 * Deliberately written by the coordinator (not the coder) so it is a second
 * opinion, and it exits non-zero on any failure.
 *
 *   node review-evidence/coordinator-ui/verify-ui.mjs
 */
import pkg from '/Users/love21/.openclaw/workspace/debug-coder/projects/stock-app/node_modules/playwright-core/index.js';
const { chromium } = pkg;

const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL = process.env.UI_URL || 'http://127.0.0.1:8787';

const results = [];
const check = (id, ok, detail) => { results.push({ id, ok: !!ok, detail }); };

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--hide-scrollbars', '--mute-audio'] });

async function ctx(W, H) {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  return { page, errs };
}
const box = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), display: cs.display, opacity: cs.opacity, transitionProperty: cs.transitionProperty, transitionDuration: cs.transitionDuration, pointerEvents: cs.pointerEvents, sw: e.scrollWidth, cw: e.clientWidth }; }, sel);

// ---- C5: no horizontal overflow on any screen size ----
for (const [W, H] of [[320, 640], [393, 852], [768, 1024], [1280, 800]]) {
  const { page, errs } = await ctx(W, H);
  const ov = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  check(`C5.no-h-overflow@${W}`, ov.sw <= ov.cw + 1, `scrollWidth=${ov.sw} clientWidth=${ov.cw}`);
  if (errs.length) check(`C7.console-clean@${W}`, false, errs.slice(0, 3).join(' | '));
  await page.close();
}

// ---- C4: topbar height on a phone ----
{
  const { page } = await ctx(393, 852);
  const tb = await box(page, '.topbar');
  check('C4.topbar-height@393<=100', tb && tb.h <= 100, `topbar height=${tb && tb.h}px`);
  await page.close();
}

// ---- C1/C2: desktop collapse animation + collapsed rail content ----
{
  const { page } = await ctx(1280, 800);
  const before = await box(page, '.sidebar');
  const cb = await page.$('[data-testid="sidebar-collapse"]');
  if (cb) { await cb.click(); await page.waitForTimeout(600); }
  const sb = await box(page, '.sidebar');
  // C1: width transition duration
  const dur = parseFloat((sb?.transitionDuration || '0s').split(',')[0]) || 0;
  const prop = sb?.transitionProperty || '';
  check('C1.desktop-collapse-animated', dur >= 0.15 && /width|all/.test(prop), `transitionProperty="${prop}" duration=${sb?.transitionDuration}`);
  // C2: display none for the text parts
  for (const sel of ['.wl-name', '.wl-quote', '.side-text', '.side-group-label', '.group-by']) {
    const d = await page.evaluate((s) => { const e = document.querySelector(s); return e ? getComputedStyle(e).display : 'MISSING'; }, sel);
    check(`C2.collapsed-hidden@1280${sel}`, d === 'none', `display=${d}`);
  }
  // rail overflow
  const rail = await box(page, '.sidebar');
  check('C2.rail-no-overflow@1280', rail && rail.sw <= rail.cw + 1, `scrollWidth=${rail?.sw} clientWidth=${rail?.cw} width=${rail?.w}`);
  check('C2.rail-width-sane@1280', rail && rail.w >= 56 && rail.w <= 96, `rail width=${rail?.w}px`);
  // the symbol must still be readable (not clipped) in the rail
  const symOk = await page.evaluate(() => { const e = document.querySelector('.wl-sym'); if (!e) return null; const r = e.getBoundingClientRect(); const row = e.closest('.wl-row').getBoundingClientRect(); return { symW: Math.round(r.width), rowW: Math.round(row.width), nowrap: getComputedStyle(e).whiteSpace }; });
  check('C2.symbol-fits-rail@1280', symOk && symOk.symW <= symOk.rowW, `sym=${symOk?.symW}px row=${symOk?.rowW}px nowrap=${symOk?.nowrap}`);
  await page.close();
}

// ---- C2 (phone): collapsed rail must not show text ----
{
  const { page } = await ctx(393, 852);
  const ham = await page.$('.drawer-toggle');
  if (ham && await ham.isVisible()) { await ham.click(); await page.waitForTimeout(400); }
  const cb = await page.$('[data-testid="sidebar-collapse"]');
  if (cb && await cb.isVisible()) { await cb.click(); await page.waitForTimeout(600); }
  const collapsed = await page.evaluate(() => document.querySelector('.sidebar').classList.contains('collapsed'));
  for (const sel of ['.wl-name', '.wl-quote', '.side-text']) {
    const d = await page.evaluate((s) => { const e = document.querySelector(s); return e ? getComputedStyle(e).display : 'MISSING'; }, sel);
    check(`C2.collapsed-hidden@393${sel}`, d === 'none', `collapsed=${collapsed} display=${d}`);
  }
  const rail = await box(page, '.sidebar');
  check('C2.rail-no-overflow@393', rail && rail.sw <= rail.cw + 1, `scrollWidth=${rail?.sw} clientWidth=${rail?.cw} width=${rail?.w}`);
  check('C2.rail-width-sane@393', rail && rail.w >= 56 && rail.w <= 96, `rail width=${rail?.w}px`);
  await page.close();
}

// ---- C6: scrim animates, not a pop ----
{
  const { page } = await ctx(393, 852);
  const ham = await page.$('.drawer-toggle');
  if (ham && await ham.isVisible()) { await ham.click(); }
  await page.waitForTimeout(450);
  const open = await box(page, '.scrim');
  const dur = parseFloat((open?.transitionDuration || '0s').split(',')[0]) || 0;
  const hasOpacity = /opacity|all/.test(open?.transitionProperty || '');
  check('C6.scrim-animated', !!open && dur >= 0.15 && hasOpacity, `transitionProperty="${open?.transitionProperty}" duration=${open?.transitionDuration}`);
  check('C6.scrim-opaque-when-open', !!open && parseFloat(open.opacity) > 0.9, `opacity=${open?.opacity}`);
  // close it
  await page.evaluate(() => { const s = document.querySelector('.scrim'); if (s) s.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await page.waitForTimeout(500);
  const closed = await box(page, '.scrim');
  check('C6.scrim-hidden-when-closed', !closed || (parseFloat(closed.opacity) < 0.1 && closed.pointerEvents === 'none'), closed ? `opacity=${closed.opacity} pointerEvents=${closed.pointerEvents}` : 'not rendered (display:none ok)');
  await page.close();
}

await browser.close();

let pass = 0, fail = 0;
for (const r of results) { r.ok ? pass++ : fail++; console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.id}  (${r.detail})`); }
console.log(`\n=== coordinator verifier: ${pass} pass / ${fail} fail ===`);
process.exit(fail === 0 ? 0 : 1);
