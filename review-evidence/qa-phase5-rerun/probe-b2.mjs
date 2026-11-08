#!/usr/bin/env node
/**
 * B2 attack (review-evidence/qa-phase5-rerun): the lead claims the scrim must sit
 * BELOW the drawer so nav stays tappable. Verify adversarially at 320px:
 *   - while the drawer + scrim are open, a sidebar nav item is still the hit
 *     target (scrim does not cover the sidebar), and tapping it navigates;
 *   - the scrim still catches the tap OUTSIDE the sidebar.
 * If the scrim covered the sidebar, a tap on a nav item would hit the scrim and
 * only close the drawer (no navigation) — a user-visible failure.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..');
const OUT = path.join(__dirname, 'probes'); const WORK = path.join(__dirname, '.work-b2');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = []; const rec = (n, p, d) => { results.push({ name: n, pass: !!p, detail: d ?? null }); console.log(`  ${p ? '✓' : '✗'} ${n}${d ? ` — ${d}` : ''}`); };
function run(cmd, args, cwd) { return new Promise((res) => { const c = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] }); let o = ''; c.stdout.on('data', (d) => (o += d)); c.stderr.on('data', (d) => (o += d)); c.on('close', (code) => res({ code, o })); }); }
async function freePort() { const { createServer } = await import('node:net'); return new Promise((res, rej) => { const s = createServer(); s.on('error', rej); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); }); }); }
const chrome = () => ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium'].find(existsSync);
async function main() {
  rmSync(WORK, { recursive: true, force: true }); mkdirSync(OUT, { recursive: true }); mkdirSync(WORK, { recursive: true });
  const srvFile = path.join(WORK, 'server.mjs');
  const b = await run(path.join(REPO, 'node_modules', '.bin', 'esbuild'), [path.join(REPO, 'server', 'index.ts'), '--bundle', '--platform=node', '--target=node22', '--format=esm', '--outfile=' + srvFile, '--packages=external', `--define:import.meta.url=${JSON.stringify('file://' + path.join(REPO, 'server', 'index.ts'))}`], REPO);
  if (b.code !== 0) throw new Error('esbuild failed');
  const port = await freePort(); const base = `http://127.0.0.1:${port}`;
  const srv = spawn(process.execPath, [srvFile], { cwd: REPO, env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DB_PATH: path.join(WORK, 'b2.db'), NODE_ENV: 'production' }, stdio: 'ignore' });
  let br;
  try {
    for (let i = 0; i < 100; i += 1) { try { if ((await fetch(base + '/api/health')).ok) break; } catch {} await sleep(250); }
    br = await chromium.launch({ executablePath: chrome(), headless: true, args: ['--hide-scrollbars'] });
    const ctx = await br.newContext({ viewport: { width: 320, height: 640 }, colorScheme: 'dark' });
    const page = await ctx.newPage();
    const errs = []; page.on('pageerror', (e) => errs.push(e.message));
    await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="dashboard-screen"]');
    await page.locator('.drawer-toggle').first().click(); await sleep(450);
    const hit = await page.evaluate(() => {
      const item = document.querySelector('nav.side-nav button[data-screen="chart"]');
      const r = item.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const el = document.elementFromPoint(cx, cy);
      const scrim = document.querySelector('[data-testid="drawer-scrim"]');
      const sr = scrim.getBoundingClientRect();
      return { center: { cx: +cx.toFixed(1), cy: +cy.toFixed(1) }, hit: el ? el.tagName + '.' + (el.className || '') : null, sidebarRight: +document.querySelector('.sidebar').getBoundingClientRect().right.toFixed(1), scrimLeft: +sr.left.toFixed(1) };
    });
    console.log('  nav-item hit test:', JSON.stringify(hit));
    rec('B2-1 a sidebar nav item is above the scrim (hit target is the nav button)', /side-item/.test(hit.hit || ''), hit.hit);
    await page.mouse.click(hit.center.cx, hit.center.cy); await sleep(600);
    const navigated = await page.evaluate(() => !!document.querySelector('[data-testid="chart-screen"]'));
    rec('B2-2 tapping a nav item while the scrim is open navigates (not merely closes)', navigated);
    rec('B2-3 no page errors', errs.length === 0, errs.join('|') || 'none');
  } catch (e) { rec('b2 probe completed', false, String(e)); }
  finally {
    if (br) await br.close().catch(() => {});
    srv.kill('SIGTERM');
    writeFileSync(path.join(OUT, 'b2-results.json'), JSON.stringify(results, null, 2));
    const f = results.filter((r) => !r.pass);
    console.log(`\n${f.length ? '✗' : '✓'} B2 probe: ${results.length - f.length}/${results.length}`);
    if (f.length) process.exitCode = 1;
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
