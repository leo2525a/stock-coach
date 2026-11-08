#!/usr/bin/env node
/** Which top-bar controls fall under the 40-44px touch minimum at tablet width? */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.join(ROOT, 'review-evidence', 'qa-phase5', 'adversarial');
const WORK = path.join(ROOT, 'review-evidence', 'qa-phase5', '.work-tap');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function run(c, a, cwd) { return new Promise((r) => { const p = spawn(c, a, { cwd, stdio: ['ignore', 'pipe', 'pipe'] }); let o = ''; p.stdout.on('data', (d) => (o += d)); p.stderr.on('data', (d) => (o += d)); p.on('close', (code) => r({ code, o })); }); }
async function freePort() { const { createServer } = await import('node:net'); return new Promise((res) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); }); }
async function main() {
  mkdirSync(WORK, { recursive: true }); mkdirSync(OUT, { recursive: true });
  const out = path.join(WORK, 's.mjs');
  await run(path.join(ROOT, 'node_modules', '.bin', 'esbuild'), [path.join(ROOT, 'server', 'index.ts'), '--bundle', '--platform=node', '--target=node22', '--format=esm', '--outfile=' + out, '--packages=external', `--define:import.meta.url=${JSON.stringify('file://' + path.join(ROOT, 'server', 'index.ts'))}`], ROOT);
  const port = await freePort(); const base = `http://127.0.0.1:${port}`;
  const srv = spawn(process.execPath, [out], { cwd: ROOT, env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DB_PATH: path.join(WORK, 'a.db') }, stdio: 'ignore' });
  let br;
  try {
    for (let i = 0; i < 80; i += 1) { try { if ((await fetch(base + '/api/health')).ok) break; } catch {} await sleep(250); }
    br = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--hide-scrollbars'] });
    const page = await br.newPage({ viewport: { width: 768, height: 1024 } });
    await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="dashboard-screen"]');
    const report = {};
    for (const w of [320, 390, 720, 768, 1024, 1600]) {
      await page.setViewportSize({ width: w, height: 900 }); await sleep(400);
      report[w] = await page.evaluate(() => {
        const btns = [...document.querySelectorAll('header.topbar button')].filter((b) => { const s = getComputedStyle(b); return s.display !== 'none' && b.getBoundingClientRect().width > 0; });
        return btns.map((b) => { const r = b.getBoundingClientRect(); return { cls: b.className, testid: b.getAttribute('data-testid') || '', aria: b.getAttribute('aria-label') || '', w: +r.width.toFixed(1), h: +r.height.toFixed(1), min: +Math.min(r.width, r.height).toFixed(1) }; });
      });
    }
    for (const [w, btns] of Object.entries(report)) {
      const bad = btns.filter((b) => b.min < 40);
      console.log(`  ${w}px: ${btns.length} visible topbar buttons; ${bad.length} under 40px`);
      for (const b of bad) console.log(`      ${b.min}px  ${b.cls} [${b.testid}] aria="${b.aria}"`);
    }
    writeFileSync(path.join(OUT, 'tap-target-result.json'), JSON.stringify(report, null, 2));
  } catch (e) { console.error(String(e)); } finally { if (br) await br.close().catch(() => {}); srv.kill('SIGTERM'); }
}
main().catch((e) => { console.error(e); process.exit(1); });
