/**
 * QA probe 10 — DOM-level honesty at the real provider for payers the
 * builder's harness never drives (O, COST) plus the harness's own KO.
 *
 * Boots the real server on an ephemeral port (never 8787) with throwaway
 * SQLite, drives the PRODUCTION build in headless Chrome, and reads the
 * rendered schedule: how many rows carry a Payable Date, whether any row's
 * Payable date precedes its Ex-Date, whether any figure cell is coloured, and
 * whether the document overflows horizontally.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';

const ROOT = process.cwd();
const PORT = 8791;
const work = mkdtempSync(path.join(tmpdir(), 'qa-p4-dom-'));
const server = spawn('npx', ['tsx', 'server/index.ts'], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(PORT), DB_PATH: path.join(work, 'db.sqlite') },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const base = `http://127.0.0.1:${PORT}`;
const up = async () => {
  for (let i = 0; i < 120; i++) {
    try { const r = await fetch(`${base}/api/dividends/KO`); if (r.status) return true; } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
};
if (!(await up())) { console.log('server never came up'); server.kill(); process.exit(1); }

const browser = await chromium.launch({ channel: 'chrome', headless: true }).catch(() => chromium.launch({ headless: true }));
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push(String(e)));
const clickNav = async (id) => {
  const item = page.locator(`nav.side-nav button[data-screen="${id}"]`).first();
  if (!(await item.isVisible())) { await page.locator('.drawer-toggle').first().click(); await page.waitForTimeout(500); }
  await item.click({ force: true });
  await page.waitForTimeout(400);
};
const setSymbol = async (symbol) => {
  const row = page.locator(`button.wl-row:has-text("${symbol}")`).first();
  if ((await row.count()) > 0) { await row.click({ force: true }); await page.waitForTimeout(1500); return true; }
  await clickNav('watchlist');
  const input = page.locator('[data-testid="watchlist-screen"] input[type="text"]').first();
  if ((await input.count()) === 0) { console.log('  no watchlist input'); return false; }
  await input.fill(symbol); await input.press('Enter'); await page.waitForTimeout(4000);
  const msg = await page.locator('[data-testid="add-message"]').first().textContent().catch(() => null);
  console.log(`  add-message for ${symbol}:`, msg);
  const newRow = page.locator(`button.wl-row:has-text("${symbol}")`).first();
  if ((await newRow.count()) === 0) return false;
  await newRow.click({ force: true }); await page.waitForTimeout(1500);
  return true;
};

const openAllSections = async () => {
  const toggles = page.locator('.div-screen .pf-section-toggle');
  const n = await toggles.count();
  for (let i = 0; i < n; i += 1) {
    const caret = toggles.nth(i);
    const isOpen = await caret.evaluate((el) => el.closest('.pf-section')?.classList.contains('open'));
    if (!isOpen) { await caret.click({ force: true }); await page.waitForTimeout(300); }
  }
  await page.waitForTimeout(1200);
};

await page.goto(base, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(4000);
console.log('sidebar rows:', await page.locator('button.wl-row').count(), 'nav items:', await page.locator('nav button[data-screen]').count());
console.log('current symbol text:', await page.locator('.wl-row.selected').first().textContent().catch(() => null));

for (const sym of ['KO', 'O', 'COST']) {
  if (!(await setSymbol(sym))) { console.log(`could not switch to ${sym}`); continue; }
  await clickNav('dividends');
  await page.waitForSelector('[data-testid="dividends-screen"]', { timeout: 20000 }).catch(() => {});
  await page.waitForFunction(() => !document.querySelector('[data-testid="div-loading"]'), null, { timeout: 40000 }).catch(() => {});
  await page.waitForTimeout(2000);
  await openAllSections();
  const dump = await page.evaluate(() => {
    const trs = [...document.querySelectorAll('#pf-body-c5 tbody tr')];
    const rows = trs.map((tr) => [...tr.querySelectorAll('td')].map((td) => (td.textContent || '').trim()));
    const payable = rows.map((r) => r[3]);
    const ex = rows.map((r) => r[1]);
    const filled = payable.map((p, i) => (p && p !== '\u2014' ? { i, ex: ex[i], payable: p } : null)).filter(Boolean);
    return {
      rowCount: trs.length,
      firstRows: rows.slice(0, 5),
      filled,
      forbidden: [...document.querySelectorAll('.div-screen *')].filter((e) => e.children.length === 0)
        .map((e) => (e.textContent || '').trim()).filter((t) => /^(null|NaN|undefined|Infinity)$/.test(t)),
      colouredLevels: ['div-f-indicated','div-f-trailing','div-f-forward','div-f-payout','div-f-5y','div-f-rate','div-sh-total','div-sh-dividend','div-sh-buyback','div-sh-debt']
        .filter((id) => { const e = document.querySelector(`[data-testid="${id}"]`); return e && /chg-(up|down|flat)/.test(e.className.toString()); }),
      overflowDoc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      overflowBody: document.body.scrollWidth - document.body.clientWidth,
    };
  });
  console.log(`\n===== ${sym} @1600px =====`);
  console.log('schedule rows:', dump.rowCount);
  console.log('first rows (Announced|Ex|Record|Payable|Ccy|Amt|Adj|Freq|Type):');
  for (const r of dump.firstRows) console.log('   ', JSON.stringify(r));
  console.log('rows with a Payable Date:', dump.filled.length, JSON.stringify(dump.filled));
  for (const f of dump.filled) {
    const d = Math.round((Date.parse(f.ex) - Date.parse(f.payable)) / 86400000);
    if (d > 0) console.log(`   !! PAYABLE (${f.payable}) IS ${d}d BEFORE EX (${f.ex})`);
  }
  console.log('forbidden tokens:', dump.forbidden);
  console.log('coloured levels (should be 0):', dump.colouredLevels);
  console.log('horizontal overflow:', dump.overflowDoc, dump.overflowBody);
}

/* narrow widths on the last symbol */
for (const w of [390, 834]) {
  await page.setViewportSize({ width: w, height: 900 });
  await page.waitForTimeout(800);
  const o = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth - document.documentElement.clientWidth }));
  console.log(`overflow @${w}px:`, o.doc);
}
console.log('\nconsole errors:', consoleErrors.slice(0, 6));
await browser.close(); server.kill(); rmSync(work, { recursive: true, force: true });
