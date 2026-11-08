#!/usr/bin/env node
/** Adversarial probe: at 320px with the drawer OPEN, what can a real user tap or
 *  press to close it? (brief: "open -> navigate -> close/scrim") */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.join(ROOT, 'review-evidence', 'qa-phase5', 'adversarial');
const WORK = path.join(ROOT, 'review-evidence', 'qa-phase5', '.work-close');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = []; const rec = (n, p, d) => { results.push({ name: n, pass: p, detail: d }); console.log(`  ${p ? '✓' : '✗'} ${n}${d ? ` — ${d}` : ''}`); };
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
    await page.locator('.drawer-toggle').first().click({ force: true }); await sleep(500);
    rec('drawer starts open', await page.evaluate(() => !!document.querySelector('.sidebar')?.classList.contains('open')));

    const facts = await page.evaluate(() => {
      const d = document.querySelector('.drawer-toggle'); const db = d.getBoundingClientRect();
      const cx = db.x + db.width / 2, cy = db.y + db.height / 2;
      const hit = document.elementFromPoint(cx, cy);
      const sc = document.querySelector('[data-testid="drawer-scrim"]'); const sr = sc.getBoundingClientRect();
      return {
        hamburgerCenter: { cx: +cx.toFixed(1), cy: +cy.toFixed(1) },
        hitAtHamburger: hit ? hit.tagName + '.' + (hit.className || '') : null,
        hamburgerReachable: hit === d || d.contains(hit),
        scrimDisplay: getComputedStyle(sc).display, scrimW: sr.width, scrimH: sr.height,
      };
    });
    console.log('  facts:', JSON.stringify(facts));
    rec('while the drawer is open the hamburger is still tap-to-close', facts.hamburgerReachable, `hit → ${facts.hitAtHamburger}`);
    rec('the scrim is a live tap target while the drawer is open', facts.scrimDisplay !== 'none' && facts.scrimW > 0, `display:${facts.scrimDisplay} ${facts.scrimW}×${facts.scrimH}`);

    await page.keyboard.press('Escape'); await sleep(450);
    rec('Escape closes the drawer', !(await page.evaluate(() => !!document.querySelector('.sidebar').classList.contains('open'))));
    await page.keyboard.press('Tab'); await page.keyboard.press('Escape'); await sleep(450);
    rec('Escape from a focused child also closes the drawer', !(await page.evaluate(() => !!document.querySelector('.sidebar').classList.contains('open'))));
    writeFileSync(path.join(OUT, 'drawer-close-result.json'), JSON.stringify({ results, facts }, null, 2));
  } catch (e) { rec('probe completed', false, String(e)); } finally {
    if (br) await br.close().catch(() => {}); srv.kill('SIGTERM');
    const f = results.filter((r) => !r.pass); console.log(`\n${f.length ? '✗' : '✓'} drawer-close probe: ${results.length - f.length}/${results.length}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
