#!/usr/bin/env node
/**
 * Adversarial probe #3 (QA Phase 5): are the *hard-coded* reference-line colours
 * (REF_COLORS) actually painted onto the chart canvases in LIGHT mode, and are
 * they readable there? The shipped harness only samples the modal (background)
 * colour, so a low-contrast line is invisible to it.
 * Reads only; writes only under review-evidence/qa-phase5/.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.join(ROOT, 'review-evidence', 'qa-phase5', 'adversarial');
const WORK = path.join(ROOT, 'review-evidence', 'qa-phase5', '.work-adv3');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const REF_COLORS = { price: '#4c8dff', targetLow: '#7d8590', targetMean: '#26a69a', targetHigh: '#7d8590', estimate: '#f5c542' };
const results = [];
const rec = (n, p, d) => { results.push({ name: n, pass: p, detail: d }); console.log(`  ${p ? '✓' : '✗'} ${n}${d ? ` — ${d}` : ''}`); };
function run(c, a, cwd) { return new Promise((r) => { const p = spawn(c, a, { cwd, stdio: ['ignore', 'pipe', 'pipe'] }); let o = ''; p.stdout.on('data', (d) => (o += d)); p.stderr.on('data', (d) => (o += d)); p.on('close', (code) => r({ code, o })); }); }
async function freePort() { const { createServer } = await import('node:net'); return new Promise((res) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); }); }
const hex2rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
function contrast(a, b) { const L = (c) => { const v = c.map((x) => x / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; }; const la = L(a), lb = L(b); const hi = Math.max(la, lb), lo = Math.min(la, lb); return (hi + 0.05) / (lo + 0.05); }

async function main() {
  mkdirSync(WORK, { recursive: true }); mkdirSync(OUT, { recursive: true });
  const out = path.join(WORK, 's.mjs');
  const b = await run(path.join(ROOT, 'node_modules', '.bin', 'esbuild'), [path.join(ROOT, 'server', 'index.ts'), '--bundle', '--platform=node', '--target=node22', '--format=esm', '--outfile=' + out, '--packages=external', `--define:import.meta.url=${JSON.stringify('file://' + path.join(ROOT, 'server', 'index.ts'))}`], ROOT);
  if (b.code !== 0) throw new Error(b.o);
  const port = await freePort(); const base = `http://127.0.0.1:${port}`;
  const srv = spawn(process.execPath, [out], { cwd: ROOT, env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DB_PATH: path.join(WORK, 'a.db') }, stdio: 'ignore' });
  let br;
  try {
    for (let i = 0; i < 80; i += 1) { try { if ((await fetch(base + '/api/health')).ok) break; } catch {} await sleep(250); }
    br = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--hide-scrollbars'] });
    const page = await br.newPage({ viewport: { width: 1280, height: 1000 } });
    await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="dashboard-screen"]');

    const themeNow = () => page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    const force = async (want) => { if ((await themeNow()) !== want) { await page.locator('[data-testid="theme-toggle"]').click(); await sleep(600); } };

    const nav = async (s) => { const it = page.locator(`nav.side-nav button[data-screen="${s}"]`).first(); if (!(await it.isVisible())) { await page.locator('.drawer-toggle').first().click({ force: true }).catch(() => {}); await sleep(350); } await it.click({ force: true }); await sleep(900); };

    // A canvas pixel census: how much of the plot is *near* a hard-coded REF colour?
    const census = async (sel, bgHex) => page.evaluate(({ sel, targets, bgHex }) => {
      const c = document.querySelector(sel);
      if (!c) return { error: 'no canvas' };
      const ctx = c.getContext('2d');
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      const hex2 = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
      const counts = {};
      for (const t of targets) counts[t] = 0;
      let opaque = 0;
      for (let y = 0; y < c.height; y += 1) for (let x = 0; x < c.width; x += 1) {
        const i = (y * c.width + x) * 4;
        const [r, g, bl, a] = [d[i], d[i + 1], d[i + 2], d[i + 3]];
        if (a < 200) continue; opaque += 1;
        for (const t of targets) { const [tr, tg, tb] = hex2(t); if (Math.abs(r - tr) <= 12 && Math.abs(g - tg) <= 12 && Math.abs(bl - tb) <= 12) counts[t] += 1; }
      }
      return { counts, opaque, w: c.width, h: c.height, bg: bgHex };
    }, { sel, targets: Object.values(REF_COLORS), bgHex });

    await force('light');
    await nav('analysts');
    // open every section so both chart canvases exist
    const toggles = page.locator('.pf-section-toggle'); const n = await toggles.count();
    for (let i = 0; i < n; i += 1) { const c = toggles.nth(i); const open = await c.evaluate((el) => el.closest('.pf-section')?.classList.contains('open')); if (!open) { await c.click({ force: true }).catch(() => {}); await sleep(200); } }
    await sleep(900);

    const white = hex2rgb('#ffffff');
    for (const [label, sel] of [['ratings band (pf-band-chart)', '[data-testid="pf-band-chart"] canvas'], ['estimates NTM (pf-ntm-chart)', '[data-testid="pf-ntm-chart"] canvas']]) {
      const cen = await census(sel, '#ffffff');
      if (cen.error) { rec(`${label}: canvas present`, false, cen.error); continue; }
      console.log(`    ${label}: ${cen.w}×${cen.h}, ${cen.opaque} opaque px`);
      for (const [name, hexv] of Object.entries(REF_COLORS)) {
        const cr = contrast(hex2rgb(hexv), white);
        const hit = cen.counts[hexv] || 0;
        if (hit === 0) continue;
        rec(
          `${label}: REF_COLORS.${name} ${hexv} is painted on WHITE — contrast ${cr.toFixed(2)}:1`,
          cr >= 3,
          `${hit}px · ${cr >= 3 ? 'ok' : 'FAILS the 3:1 non-text minimum'}`,
        );
      }
    }
    writeFileSync(path.join(OUT, 'reference-line-result.json'), JSON.stringify({ results }, null, 2));
  } catch (e) { rec('probe #3 completed without a harness error', false, String(e)); } finally {
    if (br) await br.close().catch(() => {});
    srv.kill('SIGTERM');
    const f = results.filter((r) => !r.pass); console.log(`\n${f.length ? '✗' : '✓'} reference-line probe: ${results.length - f.length}/${results.length}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
