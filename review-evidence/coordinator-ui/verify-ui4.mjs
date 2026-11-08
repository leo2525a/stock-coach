/**
 * Round-4 independent verification of the owner's 3 complaints.
 * Owner of this file: coordinator (debug-debug_lead). Children must not edit it.
 * Run: node review-evidence/coordinator-ui/verify-ui4.mjs
 * App: http://127.0.0.1:8787/  (system Chrome; serves the built dist)
 */
import { chromium } from 'playwright-core';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL = process.env.UI_URL || 'http://127.0.0.1:8787/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  [' + detail + ']' : ''}`); };

const browser = await chromium.launch({ executablePath: CHROME, headless: true });

async function open(w, h) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: true, isMobile: w < 800, colorScheme: 'dark' });
  const p = await ctx.newPage();
  await p.goto(URL, { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('[data-testid="dashboard-screen"]', { timeout: 25000 });
  await sleep(800);
  return { ctx, p };
}

const isOpen = (p) => p.evaluate(() => {
  const s = document.querySelector('.sidebar');
  if (!s) return false;
  const cs = getComputedStyle(s);
  if (cs.display === 'none' || cs.visibility === 'hidden') return false;
  return s.getBoundingClientRect().width > 40;
});

async function ensureOpen(p) {
  if (await isOpen(p)) return;
  for (const sel of ['button.drawer-toggle', '.drawer-toggle', '.brand']) {
    const el = p.locator(sel).first();
    if (await el.count()) {
      try { await el.click({ force: true, timeout: 2500 }); await sleep(600); if (await isOpen(p)) return; } catch {}
    }
  }
}

// ---------- 1. the panel scrolls (activating mode: short viewport) ----------
for (const [w, h, label] of [[393, 852, 'phone'], [1280, 800, 'desktop']]) {
  const { ctx, p } = await open(w, h);
  await ensureOpen(p);
  const base = await p.evaluate(() => {
    const s = document.querySelector('.sidebar');
    return { overflowY: getComputedStyle(s).overflowY };
  });
  check(`${label}: panel declares an internal scroller (overflow-y auto|scroll)`, ['auto', 'scroll'].includes(base.overflowY), base.overflowY);
  await p.setViewportSize({ width: w, height: 400 });
  await sleep(450);
  const sc = await p.evaluate(() => {
    const s = document.querySelector('.sidebar');
    const before = s.scrollTop;
    s.scrollTop = 999999;
    const after = s.scrollTop;
    const last = document.querySelector('li:last-child .wl-row, .sidebar-list li:last-child');
    return { scrollH: s.scrollHeight, clientH: s.clientHeight, moved: after > before, lastText: (last?.textContent || '').trim().slice(0, 28) };
  });
  check(`${label}: panel actually scrolls to reach the last item`, sc.scrollH > sc.clientH && sc.moved, `${sc.scrollH}>${sc.clientH} moved=${sc.moved} last="${sc.lastText}"`);
  await ctx.close();
}

// ---------- 2. no slide anywhere ----------
for (const [w, h, label] of [[393, 852, 'phone'], [1280, 800, 'desktop']]) {
  const { ctx, p } = await open(w, h);
  const before = await p.evaluate(() => { const cs = getComputedStyle(document.querySelector('.sidebar')); return { transform: cs.transform, marginLeft: cs.marginLeft, transition: cs.transition, left: cs.left }; });
  await ensureOpen(p);
  const after = await p.evaluate(() => { const cs = getComputedStyle(document.querySelector('.sidebar')); return { transform: cs.transform, marginLeft: cs.marginLeft, left: cs.left }; });
  check(`${label}: sidebar transform is none (the app does not slide)`, before.transform === 'none' && after.transform === 'none', `${before.transform} / ${after.transform}`);
  check(`${label}: sidebar margin-left is static across the toggle`, after.marginLeft === before.marginLeft, `${before.marginLeft} -> ${after.marginLeft}`);
  check(`${label}: no transform/margin-left/padding-left transition declared`, !/transform|margin-left|padding-left/.test(before.transition || ''), (before.transition || '').slice(0, 70));
  // and the main column itself is not translated
  const mainTrans = await p.evaluate(() => getComputedStyle(document.querySelector('.main-col')).transform);
  check(`${label}: main column transform is none`, mainTrans === 'none', mainTrans);
  await ctx.close();
}

// ---------- 3. the logo is the menu button ----------
{
  const { ctx, p } = await open(1280, 800);
  const info = await p.evaluate(() => {
    const btn = document.querySelector('button .brand')?.closest('button') || document.querySelector('button.brand');
    const toggles = [...document.querySelectorAll('.drawer-toggle')];
    const separate = toggles.filter((el) => !el.querySelector('.brand') && !el.classList.contains('brand'));
    return {
      hasBrandInButton: !!document.querySelector('button .brand, button.brand'),
      brandAria: (document.querySelector('button .brand')?.closest('button') || {}).getAttribute?.('aria-label') || null,
      anyMenuGlyph: /[☰≡]/u.test(document.body.innerText || ''),
      nToggles: toggles.length,
      nSeparate: separate.length,
      logoIsToggle: toggles.some((el) => el.querySelector('.brand') || el.classList.contains('brand')),
    };
  });
  check('the brand mark lives inside a <button>', info.hasBrandInButton, JSON.stringify(info));
  check('that button has an accessible name (aria-label)', !!info.brandAria, String(info.brandAria));
  check('the logo button IS the menu toggle (.drawer-toggle carries the brand)', info.logoIsToggle, `toggles=${info.nToggles} separate=${info.nSeparate}`);
  check('no separate ☰/≡ hamburger glyph remains', info.nSeparate === 0 && !info.anyMenuGlyph, `separate=${info.nSeparate} glyph=${info.anyMenuGlyph}`);
  // clicking the logo really toggles
  if (!(await isOpen(p))) { await ensureOpen(p); }
  const w1 = await p.evaluate(() => document.querySelector('.sidebar').getBoundingClientRect().width);
  const logoBtn = p.locator('button .brand').first();
  await logoBtn.click({ force: true }); await sleep(600);
  const w0 = await p.evaluate(() => document.querySelector('.sidebar').getBoundingClientRect().width);
  await logoBtn.click({ force: true }); await sleep(600);
  const w2 = await p.evaluate(() => document.querySelector('.sidebar').getBoundingClientRect().width);
  check('clicking the logo closes then reopens the panel', w0 < 40 && w1 > 40 && w2 > 40, `${Math.round(w1)} -> ${Math.round(w0)} -> ${Math.round(w2)}`);
  await ctx.close();
}

// ---------- 4. no double safe-area inset (static + geometry) ----------
{
  const { readFileSync } = await import('node:fs');
  const root = '/Users/love21/.openclaw/workspace/debug-coder/projects/stock-app';
  const cap = readFileSync(`${root}/capacitor.config.ts`, 'utf8');
  // `src/styles.css` is an @import entry point — read the resolved graph so a
  // stylesheet split cannot blind this check.
  const css = (() => {
    const seen = new Set();
    const walk = (absFile, base) => {
      if (seen.has(absFile)) return '';
      seen.add(absFile);
      return readFileSync(absFile, 'utf8').replace(/@import\s+(?:url\()?['"]([^'"]+)['"]\)?\s*;/g, (m, spec) =>
        spec.startsWith('.') ? walk(`${base}/${spec.replace(/^\.\//, '')}`, base) : m);
    };
    return walk(`${root}/src/styles.css`, `${root}/src`);
  })();
  const idx = readFileSync(`${root}/index.html`, 'utf8');
  check('capacitor.config.ts uses ios.contentInset "never" (CSS owns the inset)', /contentInset:\s*'never'/.test(cap) && !/contentInset:\s*'always'/.test(cap));
  // Count the *declarations* that actually consume the top inset, not one exact
  // spelling of the expression. Round 7 moved the inset into a `--safe-top`
  // token (so a headless browser can inject a notch and the layout can be
  // tested), which the old `/env\(safe-area-inset-top\)/` pattern could not
  // see: it silently matched the one remaining raw use and called it "exactly
  // once" while two more consumers existed. What must hold is that the inset is
  // a *single source*: declared once as a token, and every consumer reads the
  // token.
  const tokenDecl = css.match(/--safe-top:\s*env\(safe-area-inset-top/g) || [];
  const rawUses = (css.match(/env\(safe-area-inset-top/g) || []).length;
  const tokenUses = (css.match(/var\(--safe-top/g) || []).length;
  check(
    'CSS declares the top inset once as --safe-top and every consumer uses the token',
    tokenDecl.length === 1 && rawUses === 1 && tokenUses >= 1,
    `token decl=${tokenDecl.length} raw env()=${rawUses} var consumers=${tokenUses}`,
  );
  check('index.html keeps viewport-fit=cover', /viewport-fit=cover/.test(idx));
  check('the drawer brand row has no oversized top padding at phone width', /\.sidebar \.brand-head\s*\{\s*padding-top:\s*4px/.test(css));
}

await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
