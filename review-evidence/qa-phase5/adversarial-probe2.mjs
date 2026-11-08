#!/usr/bin/env node
/**
 * Adversarial probe #2 (QA Phase 5): the drawer lifecycle at 320px, and a
 * raw-i18n-key / locale-leak scan across *every* screen in both locales.
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
const WORK = path.join(ROOT, 'review-evidence', 'qa-phase5', '.work-adv2');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SCREENS = ['dashboard', 'chart', 'signals', 'watchlist', 'analysts', 'dividends', 'help'];
const results = [];
const rec = (n, p, d) => { results.push({ name: n, pass: p, detail: d }); console.log(`  ${p ? '✓' : '✗'} ${n}${d ? ` — ${d}` : ''}`); };

function run(cmd, args, cwd) {
  return new Promise((res) => { const c = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] }); let o = ''; c.stdout.on('data', (d) => (o += d)); c.stderr.on('data', (d) => (o += d)); c.on('close', (code) => res({ code, o })); });
}
async function freePort() { const { createServer } = await import('node:net'); return new Promise((res) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); }); }
const findChrome = () => ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(existsSync);

async function main() {
  mkdirSync(WORK, { recursive: true }); mkdirSync(OUT, { recursive: true });
  const out = path.join(WORK, 's.mjs');
  const b = await run(path.join(ROOT, 'node_modules', '.bin', 'esbuild'), [path.join(ROOT, 'server', 'index.ts'), '--bundle', '--platform=node', '--target=node22', '--format=esm', '--outfile=' + out, '--packages=external', `--define:import.meta.url=${JSON.stringify('file://' + path.join(ROOT, 'server', 'index.ts'))}`], ROOT);
  if (b.code !== 0) throw new Error(b.o);
  const port = await freePort(); const baseUrl = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, [out], { cwd: ROOT, env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DB_PATH: path.join(WORK, 'a.db') }, stdio: 'ignore' });
  const errs = []; let browser;
  try {
    for (let i = 0; i < 80; i += 1) { try { if ((await fetch(baseUrl + '/api/health')).ok) break; } catch {} await sleep(250); }
    browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || findChrome(), headless: true, args: ['--hide-scrollbars'] });
    const page = await browser.newPage({ viewport: { width: 320, height: 640 } });
    page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
    page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
    await page.goto(baseUrl + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="dashboard-screen"]');

    /* ---- G. the drawer lifecycle at 320px ---- */
    console.log('\nG. phone drawer lifecycle at 320px');
    const drawer = page.locator('.drawer-toggle').first();
    rec('hamburger visible at 320px', await drawer.isVisible());
    const box = await drawer.boundingBox();
    rec('hamburger touch target ≥40px', !!box && Math.min(box.width, box.height) >= 40, box ? `${box.width.toFixed(1)}×${box.height.toFixed(1)}` : 'no box');
    await drawer.click(); await sleep(400);
    rec('tapping it opens the drawer', await page.evaluate(() => document.querySelector('.sidebar')?.classList.contains('open')));
    rec('the scrim appears to close it', await page.locator('[data-testid="drawer-scrim"]').count() === 1);
    // scrim click closes
    await page.locator('[data-testid="drawer-scrim"]').click({ position: { x: 300, y: 300 }, force: true }).catch(() => {});
    await sleep(400);
    rec('clicking the scrim closes the drawer', !(await page.evaluate(() => document.querySelector('.sidebar')?.classList.contains('open'))));
    // Escape closes too? open then try keyboard
    await drawer.click(); await sleep(350);
    await page.keyboard.press('Escape'); await sleep(350);
    const escClosed = !(await page.evaluate(() => document.querySelector('.sidebar')?.classList.contains('open')));
    rec('Escape also closes the drawer (a11y)', escClosed, escClosed ? 'closed' : 'STILL OPEN');
    // navigate through the drawer to every screen
    let allReachable = true;
    for (const s of SCREENS) {
      await drawer.click(); await sleep(300);
      await page.locator(`nav.side-nav button[data-screen="${s}"]`).first().click({ force: true });
      const ok = await page.waitForSelector(`[data-testid="${s}-screen"]`, { timeout: 12000 }).then(() => true).catch(() => false);
      if (!ok) allReachable = false;
      await sleep(200);
    }
    rec('every screen is reachable through the phone drawer at 320px', allReachable);

    /* ---- H. raw i18n key scan on EVERY screen, both locales ---- */
    console.log('\nH. raw i18n key scan across all screens and locales');
    const KEY_RE = /\b[a-z][a-zA-Z0-9]*(?:\.[a-zA-Z0-9]+){2,}\b/;
    const WHITELIST = new Set(['zh-HK']); // locale codes contain a dot-free hyphen, but guard anyway
    await page.setViewportSize({ width: 1280, height: 1000 });
    for (const lang of ['en', 'zh-HK']) {
      await page.locator(`[data-testid="lang-switch"] button[data-lang="${lang}"]`).click(); await sleep(350);
      const bad = [];
      for (const s of SCREENS) {
        const item = page.locator(`nav.side-nav button[data-screen="${s}"]`).first();
        await item.click({ force: true }); await sleep(700);
        const txt = await page.locator('body').innerText();
        for (const line of txt.split('\n')) {
          const m = line.match(KEY_RE);
          if (m && !WHITELIST.has(m[0]) && /^[a-z]+\.[a-zA-Z]+\.[a-zA-Z]/.test(m[0])) bad.push(`${s}: "${line.trim().slice(0, 70)}"`);
        }
      }
      rec(`${lang}: no raw i18n key rendered on any of the 7 screens`, bad.length === 0, bad.slice(0, 3).join(' | ') || 'clean');
    }

    /* ---- I. locale leak check per screen in zh-HK ---- */
    console.log('\nI. zh-HK pages carry no English UI leak');
    await page.locator('[data-testid="lang-switch"] button[data-lang="zh-HK"]').click(); await sleep(350);
    const leaks = [];
    for (const s of SCREENS) {
      await page.locator(`nav.side-nav button[data-screen="${s}"]`).first().click({ force: true }); await sleep(700);
      const txt = await page.locator('body').innerText();
      const hasCJK = /[\u3400-\u9FFF]/.test(txt);
      if (!hasCJK) leaks.push(s);
    }
    rec('every zh-HK screen contains localised (CJK) text', leaks.length === 0, leaks.join(',') || 'all CJK');

    rec('zero console errors', errs.length === 0, errs.slice(0, 2).join(' | ') || 'none');
  } catch (e) {
    rec('probe #2 completed without a harness error', false, String(e));
  } finally {
    if (browser) await browser.close().catch(() => {});
    server.kill('SIGTERM');
    writeFileSync(path.join(OUT, 'adversarial-2-result.json'), JSON.stringify({ results, consoleErrors: errs }, null, 2));
    const f = results.filter((r) => !r.pass);
    console.log(`\n${f.length ? '✗' : '✓'} adversarial probe #2: ${results.length - f.length}/${results.length} passed`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
