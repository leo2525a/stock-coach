/**
 * QA probe 11 — DOM-level confirmation for the three defects found live:
 *   (a) duplicate schedule row for the same Ex-Date (O / COST / AGNC / 0005.HK),
 *   (b) a Payable Date that PRECEDES its own Ex-Date (AAPL),
 *   (c) an "upcoming" Amount in the wrong unit/currency (ULVR.L 100x, 0005.HK 7.8x).
 *
 * Symbol selection is exact (row text must START with the ticker) so "O" cannot
 * silently select "Microsoft".
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';

const ROOT = process.cwd();
const PORT = 8792;
const work = mkdtempSync(path.join(tmpdir(), 'qa-p4-dom2-'));
const server = spawn('npx', ['tsx', 'server/index.ts'], {
  cwd: ROOT, env: { ...process.env, PORT: String(PORT), DB_PATH: path.join(work, 'db.sqlite') },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const base = `http://127.0.0.1:${PORT}`;
const up = async () => { for (let i = 0; i < 120; i++) { try { const r = await fetch(`${base}/api/dividends/KO`); if (r.status) return true; } catch {} await new Promise((r) => setTimeout(r, 500)); } return false; };
if (!(await up())) { console.log('server never came up'); server.kill(); process.exit(1); }

const browser = await chromium.launch({ channel: 'chrome', headless: true }).catch(() => chromium.launch({ headless: true }));
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

const clickNav = async (id) => {
  const item = page.locator(`nav.side-nav button[data-screen="${id}"]`).first();
  if (!(await item.isVisible())) { await page.locator('.drawer-toggle').first().click(); await page.waitForTimeout(500); }
  await item.click({ force: true }); await page.waitForTimeout(400);
};
const clickRowExact = async (sym) =>
  page.evaluate((s) => {
    const rows = [...document.querySelectorAll('button.wl-row')];
    const hit = rows.find((r) => (r.textContent || '').trim().startsWith(s));
    if (hit) { hit.click(); return true; }
    return false;
  }, sym);
const setSymbolExact = async (sym) => {
  if (await clickRowExact(sym)) { await page.waitForTimeout(1600); return true; }
  await clickNav('watchlist');
  const input = page.locator('[data-testid="watchlist-screen"] input[type="text"]').first();
  if (!(await input.count())) return false;
  await input.fill(sym); await input.press('Enter'); await page.waitForTimeout(4500);
  if (!(await clickRowExact(sym))) return false;
  await page.waitForTimeout(1600); return true;
};
const openAll = async () => {
  const t = page.locator('.div-screen .pf-section-toggle');
  for (let i = 0, n = await t.count(); i < n; i += 1) {
    const c = t.nth(i);
    const open = await c.evaluate((el) => el.closest('.pf-section')?.classList.contains('open'));
    if (!open) { await c.click({ force: true }); await page.waitForTimeout(250); }
  }
  await page.waitForTimeout(1200);
};

await page.goto(base, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(4000);

for (const sym of ['AAPL', 'O', 'COST', 'AGNC', '0005.HK', 'ULVR.L']) {
  if (!(await setSymbolExact(sym))) { console.log(`\n##### ${sym}: could not select`); continue; }
  await clickNav('dividends');
  await page.waitForSelector('[data-testid="dividends-screen"]', { timeout: 20000 }).catch(() => {});
  await page.waitForFunction(() => !document.querySelector('[data-testid="div-loading"]'), null, { timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(2500);
  await openAll();
  const d = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#pf-body-c5 tbody tr')].map((tr) =>
      [...tr.querySelectorAll('td')].map((td) => (td.textContent || '').trim()));
    const ccyCell = document.querySelector('[data-testid="div-f-rate"]')?.textContent ?? null;
    return {
      rows: rows.slice(0, 8),
      count: rows.length,
      rate: ccyCell,
      currentSymbol: [...document.querySelectorAll('button.wl-row')].find((r) => r.classList.contains('selected'))?.textContent?.trim().slice(0, 30) ?? null,
    };
  });
  console.log(`\n##### ${sym} (selected: ${d.currentSymbol}) rows=${d.count}`);
  for (const r of d.rows) console.log('   ', JSON.stringify(r));
}
console.log('\nconsole errors:', errors.slice(0, 6));
await browser.close(); server.kill(); rmSync(work, { recursive: true, force: true });
