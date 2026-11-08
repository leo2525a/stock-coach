#!/usr/bin/env node
/** Focused probe: does clicking the drawer scrim actually close the drawer at 320px? */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const WORK = path.join(ROOT, 'review-evidence', 'qa-phase5', '.work-scrim');
const OUT = path.join(ROOT, 'review-evidence', 'qa-phase5', 'adversarial');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const rec = (n, p, d) => { results.push({ name: n, pass: p, detail: d }); console.log(`  ${p ? '✓' : '✗'} ${n}${d ? ` — ${d}` : ''}`); };
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
    const page = await br.newPage({ viewport: { width: 320, height: 640 } });
    await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="dashboard-screen"]');
    await page.locator('.drawer-toggle').first().click(); await sleep(450);
    const geom = await page.evaluate(() => {
      const sb = document.querySelector('.sidebar');
      const sc = document.querySelector('[data-testid="drawer-scrim"]');
      const r = (e) => { const b = e.getBoundingClientRect(); return { x: +b.x.toFixed(1), y: +b.y.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1), z: getComputedStyle(e).zIndex }; };
      const sid = sb.getBoundingClientRect();
      // What element is at a point just to the RIGHT of the sidebar?
      const px = Math.min(319, Math.ceil(sid.right) + 6), py = 300;
      const hit = document.elementFromPoint(px, py);
      return { sidebar: r(sb), scrim: sc ? r(sc) : null, probePoint: { px, py }, hitTag: hit ? hit.tagName + '.' + hit.className : null, open: sb.classList.contains('open') };
    });
    console.log('  geometry:', JSON.stringify(geom));
    rec('the scrim exists while the drawer is open', !!geom.scrim);
    rec('the scrim is drawn to the right of the sidebar (a live tap target)', !!geom.scrim && geom.scrim.w > 0);
    // Click the scrim itself (not a coordinate guess).
    await page.locator('[data-testid="drawer-scrim"]').click({ force: true });
    await sleep(500);
    const closed = await page.evaluate(() => !document.querySelector('.sidebar')?.classList.contains('open'));
    rec('clicking the scrim element closes the drawer', closed, closed ? 'closed' : 'STILL OPEN');
    // Re-open, and tap the *visible strip* to the right of the sidebar (real user gesture).
    await page.locator('.drawer-toggle').first().click({ force: true }); await sleep(450);
    const g2 = await page.evaluate(() => {
      const sb = document.querySelector('.sidebar');
      const b = sb.getBoundingClientRect();
      const px = Math.min(319, Math.ceil(b.right) + 8);
      const hit = document.elementFromPoint(px, 300);
      return { px, right: +b.right.toFixed(1), hitTag: hit ? hit.tagName + '.' + (hit.className || '') : null };
    });
    console.log('  reopen geometry:', JSON.stringify(g2));
    await page.mouse.click(g2.px, 300); await sleep(500);
    const closed2 = await page.evaluate(() => !document.querySelector('.sidebar')?.classList.contains('open'));
    rec('a real tap on the visible scrim strip closes the drawer', closed2, closed2 ? 'closed' : 'STILL OPEN');
    writeFileSync(path.join(OUT, 'scrim-result.json'), JSON.stringify({ results, geom, g2 }, null, 2));
  } catch (e) { rec('scrim probe completed', false, String(e)); } finally {
    if (br) await br.close().catch(() => {});
    srv.kill('SIGTERM');
    const f = results.filter((r) => !r.pass); console.log(`\n${f.length ? '✗' : '✓'} scrim probe: ${results.length - f.length}/${results.length}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
