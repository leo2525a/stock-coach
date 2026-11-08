#!/usr/bin/env node
/**
 * Independent adversarial probe (QA Phase 5). Covers angles the shipped
 * evidence:phase5 harness does NOT:
 *
 *   A. light-mode horizontal overflow at the narrow widths *in zh-HK* (CJK labels
 *      are wider than the English ones the harness measures).
 *   B. locale × theme parity: no raw i18n key and no cross-locale text leak while
 *      toggling the theme.
 *   C. a live OS colour-scheme flip while `system` is selected (main.tsx listener).
 *   D. rapid toggling: data-theme, computed --bg, the toggle attribute and the
 *      chart canvas must all agree after a burst of clicks.
 *   E. the OTHER two charts (analyst band, dividend) must also repaint with the
 *      theme — the harness only samples the main chart canvas.
 *   F. the chart legend (`.ohlc-legend`, a DOM overlay) readability proxy on white.
 *
 * Reads only; writes only under review-evidence/qa-phase5/.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.join(ROOT, 'review-evidence', 'qa-phase5', 'adversarial');
const WORK = path.join(ROOT, 'review-evidence', 'qa-phase5', '.work-adv');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function spawnCapture(cmd, args, cwd) {
  return new Promise((resolve) => {
    const c = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let o = ''; c.stdout.on('data', (d) => (o += d)); c.stderr.on('data', (d) => (o += d));
    c.on('close', (code) => resolve({ code, o }));
  });
}
async function waitForHealth(baseUrl, ms = 25000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { try { const r = await fetch(`${baseUrl}/api/health`); if (r.ok) return; } catch {} await sleep(250); }
  throw new Error('server never healthy');
}
async function freePort() {
  const { createServer } = await import('node:net');
  return new Promise((res, rej) => { const s = createServer(); s.on('error', rej); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); }); });
}
const findChrome = () => ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium'].find(existsSync);

const results = [];
const rec = (name, pass, detail) => { results.push({ name, pass, detail }); console.log(`  ${pass ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`); };

async function modalCanvasColor(page, sel) {
  return page.evaluate((s) => {
    const c = document.querySelector(s);
    if (!c) return { error: 'no canvas' };
    const ctx = c.getContext('2d');
    if (!ctx) return { error: 'no ctx' };
    let d; try { d = ctx.getImageData(0, 0, c.width, c.height).data; } catch (e) { return { error: String(e) }; }
    const counts = new Map();
    for (let y = 0; y < c.height; y += 7) for (let x = 0; x < c.width; x += 7) { const i = (y * c.width + x) * 4; const k = `${d[i]},${d[i + 1]},${d[i + 2]}`; counts.set(k, (counts.get(k) ?? 0) + 1); }
    let best = null, n = -1; for (const [k, v] of counts) if (v > n) { best = k; n = v; }
    return { rgb: best, w: c.width, h: c.height };
  }, sel);
}

async function main() {
  rmSync(WORK, { recursive: true, force: true }); mkdirSync(WORK, { recursive: true }); mkdirSync(OUT, { recursive: true });
  const outfile = path.join(WORK, 'server.mjs');
  const b = await spawnCapture(path.join(ROOT, 'node_modules', '.bin', 'esbuild'), [
    path.join(ROOT, 'server', 'index.ts'), '--bundle', '--platform=node', '--target=node22', '--format=esm',
    '--outfile=' + outfile, '--packages=external', `--define:import.meta.url=${JSON.stringify('file://' + path.join(ROOT, 'server', 'index.ts'))}`,
  ], ROOT);
  if (b.code !== 0) throw new Error('esbuild failed: ' + b.o);

  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, [outfile], { cwd: ROOT, env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DB_PATH: path.join(WORK, 'a.db'), NODE_ENV: 'production' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let browser;
  const consoleErrors = [];
  try {
    await waitForHealth(baseUrl);
    browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || findChrome(), headless: true, args: ['--hide-scrollbars'] });
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' });
    const page = await ctx.newPage();
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
    page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));

    await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('[data-testid="dashboard-screen"]', { timeout: 25000 });

    const setLang = async (l) => { await page.locator(`[data-testid="lang-switch"] button[data-lang="${l}"]`).click(); await page.waitForTimeout(350); };
    const themeNow = () => page.evaluate(() => ({
      theme: document.documentElement.getAttribute('data-theme'),
      bg: getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(),
      toggle: document.querySelector('[data-testid="theme-toggle"]')?.getAttribute('data-theme-current'),
      meta: document.querySelector('meta[name="theme-color"]')?.getAttribute('content'),
    }));
    const overflow = () => page.evaluate(() => ({ doc: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth }));

    /* ---- A. light + zh-HK overflow at the narrow widths ---- */
    console.log('\nA. light-mode + zh-HK overflow');
    await page.locator('[data-testid="theme-toggle"]').click(); // → light
    void ctx;
    await setLang('zh-HK');
    for (const w of [320, 360, 390, 768]) {
      await page.setViewportSize({ width: w, height: 800 });
      await page.waitForTimeout(300);
      const o = await overflow();
      rec(`no overflow at ${w}px (light, zh-HK)`, o.doc <= 2, `${o.doc}px`);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(250);

    /* ---- B. locale × theme parity ---- */
    console.log('\nB. locale × theme parity (raw key / leak scan)');
    const KEY_RE = /\b[a-z][a-zA-Z0-9]*\.[a-zA-Z0-9]+(?:\.[a-zA-Z0-9]+)+\b/;
    for (const [lang, other] of [['zh-HK', 'en'], ['en', 'zh-HK']]) {
      await setLang(lang);
      const txt = await page.locator('body').innerText();
      const leak = KEY_RE.test(txt) ? (txt.match(KEY_RE) || [])[0] : null;
      rec(`${lang}: no raw i18n key in the rendered DOM`, !leak, leak ? `found "${leak}"` : 'clean');
      // CJK must not appear in EN, and the zh-HK page should actually contain CJK.
      const hasCJK = /[\u3400-\u9FFF]/.test(txt);
      if (lang === 'en') rec('en: no CJK glyphs leaked into the English UI', !hasCJK, hasCJK ? 'CJK present' : 'clean');
      else rec('zh-HK: the page really is localised (contains CJK)', hasCJK, hasCJK ? 'CJK present' : 'no CJK');
      void other;
    }

    /* ---- C. live OS flip while `system` ---- */
    console.log('\nC. live OS colour-scheme flip while `system`');
    await page.evaluate(() => { localStorage.setItem('stockcoach.theme', 'system'); });
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="dashboard-screen"]');
    let st = await themeNow();
    rec('system + OS dark → dark', st.theme === 'dark', st.theme);
    await page.emulateMedia({ colorScheme: 'light' }); // flip WITHOUT reload
    await page.waitForTimeout(600);
    st = await themeNow();
    rec('system: a live OS flip to light repaints the page', st.theme === 'light', `data-theme=${st.theme} --bg=${st.bg}`);

    /* ---- D. rapid toggling consistency ---- */
    console.log('\nD. rapid toggling consistency');
    await page.evaluate(() => { localStorage.setItem('stockcoach.theme', 'dark'); });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="dashboard-screen"]');
    await page.waitForTimeout(300);
    for (let i = 0; i < 7; i += 1) { await page.locator('[data-testid="theme-toggle"]').click(); await page.waitForTimeout(40); }
    await page.waitForTimeout(500);
    st = await themeNow();
    const bgIsFamily = (bg, theme) => (theme === 'light' ? bg === '#f6f8fa' : bg === '#0d1117');
    rec('after 7 rapid toggles, data-theme / --bg / toggle agree', bgIsFamily(st.bg, st.theme) && st.toggle === st.theme, JSON.stringify(st));
    rec('after 7 rapid toggles, theme-color meta matches', st.meta === (st.theme === 'light' ? '#ffffff' : '#0d1117'), `${st.meta}`);

    /* ---- E. the other two canvases also repaint ---- */
    console.log('\nE. analyst + dividend canvases repaint with the theme');
    const goto = async (screen) => { const item = page.locator(`nav.side-nav button[data-screen="${screen}"]`).first(); if (!(await item.isVisible())) { await page.locator('.drawer-toggle').first().click().catch(() => {}); await page.waitForTimeout(350); } await item.click({ force: true }); await page.waitForTimeout(400); };
    // ensure explicit dark, then sample; then light, sample.
    const forceTheme = async (want) => { let s = await themeNow(); if (s.theme !== want) { await page.locator('[data-testid="theme-toggle"]').click(); await page.waitForTimeout(500); } };
    await page.setViewportSize({ width: 1280, height: 1000 });
    for (const [screen, wrapSel] of [['analysts', '[data-testid="pf-band-chart"] canvas'], ['dividends', '[data-testid="div-chart"] canvas']]) {
      await goto(screen);
      await page.waitForTimeout(900);
      // Dividends sections may be collapsed; try to open all.
      const toggles = page.locator('.pf-section-toggle');
      const n = await toggles.count();
      for (let i = 0; i < n; i += 1) { const c = toggles.nth(i); const open = await c.evaluate((el) => el.closest('.pf-section')?.classList.contains('open')); if (!open) { await c.click({ force: true }).catch(() => {}); await page.waitForTimeout(200); } }
      await page.waitForTimeout(600);
      const hasCanvas = await page.locator(wrapSel).count();
      if (!hasCanvas) { rec(`${screen}: canvas present to test`, false, 'no canvas rendered (empty state — not verifiable here)'); continue; }
      await forceTheme('dark'); await page.waitForTimeout(500);
      const dark = await modalCanvasColor(page, wrapSel);
      await forceTheme('light'); await page.waitForTimeout(600);
      const light = await modalCanvasColor(page, wrapSel);
      rec(`${screen}: canvas background changes dark→light`, !!dark.rgb && !!light.rgb && dark.rgb !== light.rgb, `dark rgb(${dark.rgb}) vs light rgb(${light.rgb})`);
      rec(`${screen}: light canvas is the LIGHT background`, light.rgb === '255,255,255', `rgb(${light.rgb})`);
    }

    /* ---- F. chart legend overlay on white ---- */
    console.log('\nF. chart legend readability on white');
    await goto('chart');
    await forceTheme('light');
    await page.waitForTimeout(700);
    const legend = await page.evaluate(() => {
      const el = document.querySelector('.ohlc-legend');
      if (!el) return null;
      const s = getComputedStyle(el);
      return { bg: s.backgroundColor, color: s.color, display: s.display, text: (el.textContent || '').slice(0, 60) };
    });
    rec('light: the OHLC legend overlay exists and is painted', !!legend && legend.display !== 'none', legend ? JSON.stringify(legend) : 'no legend');
    if (legend) {
      // The overlay must not be a dark box on a light page.
      const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(legend.bg || '');
      const lum = m ? (0.299 * +m[1] + 0.587 * +m[2] + 0.114 * +m[3]) : null;
      rec('light: the legend overlay is light (not a dark box on white)', lum !== null && lum > 150, `bg=${legend.bg} lum≈${lum?.toFixed(0)}`);
    }

    rec('zero console errors during the adversarial run', consoleErrors.length === 0, consoleErrors.slice(0, 2).join(' | ') || 'none');
  } catch (e) {
    rec('probe completed without a harness error', false, String(e));
  } finally {
    if (browser) await browser.close().catch(() => {});
    server.kill('SIGTERM');
    writeFileSync(path.join(OUT, 'adversarial-result.json'), JSON.stringify({ results, consoleErrors }, null, 2));
    const failed = results.filter((r) => !r.pass);
    console.log(`\n${failed.length === 0 ? '✓' : '✗'} adversarial probe: ${results.length - failed.length}/${results.length} passed`);
    console.log(`result → ${path.join(OUT, 'adversarial-result.json')}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
