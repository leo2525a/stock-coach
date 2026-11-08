#!/usr/bin/env node
/**
 * Round-2 independent probes (review-evidence/qa-phase5-rerun).
 * Runs against the REAL production build (repo dist + repo server). Read-only
 * of the repo; writes only under review-evidence/qa-phase5-rerun/probes/.
 *
 * Covers:
 *  A. drawer dismissal at 320px: scrim box, tap-outside closes, Escape closes,
 *     double-close is a no-op, no console errors.
 *  B. scrim/sidebar stacking (B2 attack): does the scrim still catch the tap?
 *  C. N1: light-mode --ref-mean contrast vs the light chart background (≥3:1),
 *     and a live theme flip re-reads the ref tokens.
 *  D. new-defect hunt: desktop (fine pointer, 1600px) controls are NOT forced to
 *     44px by the coarse block; coarse block IS active at 768/1024 with touch.
 *  E. Escape listener lifecycle: repeated open/close cycles, no leak/error.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..');
const OUT = path.join(__dirname, 'probes');
const WORK = path.join(__dirname, '.work-probes');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const rec = (n, p, d) => { results.push({ name: n, pass: !!p, detail: d ?? null }); console.log(`  ${p ? '✓' : '✗'} ${n}${d ? ` — ${d}` : ''}`); };

function run(cmd, args, cwd) {
  return new Promise((res) => {
    const c = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let o = ''; c.stdout.on('data', (d) => (o += d)); c.stderr.on('data', (d) => (o += d));
    c.on('close', (code) => res({ code, o }));
  });
}
async function freePort() { const { createServer } = await import('node:net'); return new Promise((res, rej) => { const s = createServer(); s.on('error', rej); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); }); }); }
async function waitForHealth(base, ms = 25000) { const end = Date.now() + ms; while (Date.now() < end) { try { if ((await fetch(base + '/api/health')).ok) return; } catch {} await sleep(250); } throw new Error('server never healthy'); }
const chrome = () => ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium'].find(existsSync);

const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const contrast = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
const parse = (s) => { s = String(s).trim(); const h = /^#([0-9a-f]{6})$/i.exec(s); if (h) return [0, 2, 4].map((i) => parseInt(h[1].slice(i, i + 2), 16)); const m = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(s); return m ? [+m[1], +m[2], +m[3]] : null; };

async function main() {
  rmSyncSafe(); mkdirSync(OUT, { recursive: true }); mkdirSync(WORK, { recursive: true });
  const srvFile = path.join(WORK, 'server.mjs');
  const b = await run(path.join(REPO, 'node_modules', '.bin', 'esbuild'), [path.join(REPO, 'server', 'index.ts'), '--bundle', '--platform=node', '--target=node22', '--format=esm', '--outfile=' + srvFile, '--packages=external', `--define:import.meta.url=${JSON.stringify('file://' + path.join(REPO, 'server', 'index.ts'))}`], REPO);
  if (b.code !== 0) throw new Error('esbuild failed');
  const port = await freePort(); const base = `http://127.0.0.1:${port}`;
  const srv = spawn(process.execPath, [srvFile], { cwd: REPO, env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DB_PATH: path.join(WORK, 'p.db'), NODE_ENV: 'production' }, stdio: 'ignore' });
  let br;
  const consoleErrors = [];
  try {
    await waitForHealth(base);
    br = await chromium.launch({ executablePath: chrome(), headless: true, args: ['--hide-scrollbars'] });

    /* -------------------- A + B: drawer at 320px -------------------- */
    const ctx = await br.newContext({ viewport: { width: 320, height: 640 }, colorScheme: 'dark' });
    const page = await ctx.newPage();
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
    page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));
    await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="dashboard-screen"]');
    await page.locator('.drawer-toggle').first().click();
    await sleep(450);
    const geom = await page.evaluate(() => {
      const sb = document.querySelector('.sidebar');
      const sc = document.querySelector('[data-testid="drawer-scrim"]');
      const rb = (e) => { const r = e.getBoundingClientRect(); return { w: +r.width.toFixed(1), h: +r.height.toFixed(1), right: +r.right.toFixed(1), z: getComputedStyle(e).zIndex, display: getComputedStyle(e).display, pe: getComputedStyle(e).pointerEvents }; };
      const sid = sb.getBoundingClientRect();
      const px = Math.min(319, Math.ceil(sid.right) + 8);
      const hit = document.elementFromPoint(px, 300);
      return { sidebar: rb(sb), scrim: sc ? rb(sc) : null, probeX: px, hit: hit ? hit.tagName + '.' + (hit.className || '') : null };
    });
    console.log('  geometry:', JSON.stringify(geom));
    rec('A1 scrim renders with a non-zero box at 320px', geom.scrim && geom.scrim.w > 0 && geom.scrim.h > 0 && geom.scrim.display !== 'none', JSON.stringify(geom.scrim));
    rec('B1 scrim z-index is below the sidebar z-index (still dismiss-able on tap)', geom.scrim && Number(geom.scrim.z) < Number(geom.sidebar.z), `scrim z=${geom.scrim?.z} sidebar z=${geom.sidebar.z}`);
    rec('B2 the point right of the sidebar hits the scrim (live tap target)', /scrim/.test(geom.hit || ''), String(geom.hit));
    // real tap outside
    await page.mouse.click(geom.probeX, 300); await sleep(400);
    rec('A2 tapping outside closes the drawer', await page.evaluate(() => !document.querySelector('.sidebar')?.classList.contains('open')));
    // reopen + Escape
    await page.locator('.drawer-toggle').first().click(); await sleep(400);
    await page.keyboard.press('Escape'); await sleep(350);
    rec('A3 Escape closes the drawer', await page.evaluate(() => !document.querySelector('.sidebar')?.classList.contains('open')));
    // double-close: Escape again with drawer already closed must not error
    await page.keyboard.press('Escape'); await sleep(200);
    const stillClosed = await page.evaluate(() => !document.querySelector('.sidebar')?.classList.contains('open'));
    rec('A4 Escape when already closed is a no-op (no double-close)', stillClosed);
    // repeated cycles (listener leak / error hunt)
    for (let i = 0; i < 6; i += 1) { await page.locator('.drawer-toggle').first().click(); await sleep(180); await page.keyboard.press('Escape'); await sleep(180); }
    const recovered = await page.evaluate(() => !!document.querySelector('.sidebar'));
    rec('A5 six open/Escape cycles leave the app usable', recovered);
    await ctx.close();

    /* -------------------- C: N1 light ref contrast + re-read -------------------- */
    const ctx2 = await br.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: 'dark' });
    const p2 = await ctx2.newPage();
    p2.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
    p2.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));
    await p2.goto(base + '/', { waitUntil: 'domcontentloaded' });
    await p2.waitForSelector('[data-testid="dashboard-screen"]');
    // dark ref-mean
    const darkRef = await p2.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--ref-mean').trim());
    const darkChartBg = await p2.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--chart-bg').trim());
    // flip to light
    await p2.locator('[data-testid="theme-toggle"]').click(); await sleep(400);
    const lightRef = await p2.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--ref-mean').trim());
    const lightChartBg = await p2.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--chart-bg').trim());
    const cr = contrast(parse(lightRef), parse(lightChartBg));
    console.log(`  ref-mean dark=${darkRef} (on ${darkChartBg})  light=${lightRef} (on ${lightChartBg})  contrast=${cr.toFixed(3)}`);
    rec('C1 light --ref-mean differs from dark (themed, not a dark-only constant)', darkRef !== lightRef, `${darkRef} vs ${lightRef}`);
    rec('C2 light target-mean clears 3:1 on the light chart background', cr >= 3, `${cr.toFixed(3)}:1`);
    rec('C3 a theme flip re-reads the ref tokens live (no reload)', lightRef !== darkRef && lightChartBg !== darkChartBg);
    // confirm the ref line is actually painted on the analyst band chart in light
    await p2.evaluate(() => localStorage.setItem('stockcoach.theme', 'light'));
    await p2.reload({ waitUntil: 'domcontentloaded' });
    await p2.waitForSelector('[data-testid="dashboard-screen"]');
    await sleep(300);
    // navigate to analysts via the sidebar
    await p2.locator('nav.side-nav button[data-screen="analysts"]').first().click({ force: true });
    await p2.waitForSelector('[data-testid="analysts-screen"]', { timeout: 20000 }).catch(() => {});
    await sleep(1200);
    const bandHit = await p2.evaluate(() => {
      const c = document.querySelector('[data-testid="pf-band-chart"] canvas');
      if (!c) return { error: 'no pf-band-chart canvas' };
      const ctx = c.getContext('2d'); const img = ctx.getImageData(0, 0, c.width, c.height).data;
      const want = [15, 125, 114]; // #0f7d72 light ref-mean (tol)
      let hits = 0;
      for (let i = 0; i < img.length; i += 4) {
        if (Math.abs(img[i] - want[0]) <= 14 && Math.abs(img[i + 1] - want[1]) <= 14 && Math.abs(img[i + 2] - want[2]) <= 14) hits += 1;
      }
      return { theme: document.documentElement.getAttribute('data-theme'), hits };
    });
    console.log('  band chart light ref-mean pixel hits:', JSON.stringify(bandHit));
    rec('C4 the themed light ref-mean (#0f7d72) is actually painted on the band chart', (bandHit.hits ?? 0) > 50, JSON.stringify(bandHit));
    await ctx2.close();

    /* -------------------- D: coarse-pointer scoping -------------------- */
    const ctx3 = await br.newContext({ viewport: { width: 768, height: 1000 }, hasTouch: true, colorScheme: 'dark' });
    const p3 = await ctx3.newPage();
    await p3.goto(base + '/', { waitUntil: 'domcontentloaded' });
    await p3.waitForSelector('[data-testid="dashboard-screen"]'); await sleep(300);
    const t768 = await p3.evaluate(() => Math.min(...[...document.querySelectorAll('header.topbar button')].filter((b) => getComputedStyle(b).display !== 'none' && b.getBoundingClientRect().width > 0).map((b) => Math.min(b.getBoundingClientRect().width, b.getBoundingClientRect().height))));
    rec('D1 768px with touch gets ≥40px controls', t768 >= 40, `${t768}px`);
    await ctx3.close();

    const ctx4 = await br.newContext({ viewport: { width: 1600, height: 1000 }, hasTouch: false, colorScheme: 'dark' });
    const p4 = await ctx4.newPage();
    await p4.goto(base + '/', { waitUntil: 'domcontentloaded' });
    await p4.waitForSelector('[data-testid="dashboard-screen"]'); await sleep(300);
    const d1600 = await p4.evaluate(() => Math.min(...[...document.querySelectorAll('header.topbar button')].filter((b) => getComputedStyle(b).display !== 'none' && b.getBoundingClientRect().width > 0).map((b) => Math.min(b.getBoundingClientRect().width, b.getBoundingClientRect().height))));
    rec('D2 1600px with a fine pointer is NOT forced to 44px (coarse block inert)', d1600 < 44, `${d1600}px`);
    await ctx4.close();

    /* -------------------- E: console -------------------- */
    rec('E1 zero console/page errors across all probes', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | ') || 'none');
  } catch (e) {
    rec('probe run completed', false, String(e));
  } finally {
    if (br) await br.close().catch(() => {});
    srv.kill('SIGTERM');
    writeFileSync(path.join(OUT, 'probe-results.json'), JSON.stringify({ results, consoleErrors }, null, 2));
    const failed = results.filter((r) => !r.pass);
    console.log(`\n${failed.length ? '✗' : '✓'} rerun probes: ${results.length - failed.length}/${results.length} passed`);
    if (failed.length) process.exitCode = 1;
  }
}
function rmSyncSafe() { try { rmSync(WORK, { recursive: true, force: true }); } catch {} }
main().catch((e) => { console.error(e); process.exit(1); });
