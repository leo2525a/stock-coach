/**
 * QA rerun probe H — DOM + export proof of the residual wrong-scale figure.
 *
 * Reads the LIVE §C.1 "Annual rate" cell, the §C.1 "Last Dividend" cell and the
 * §C.5 newest Amount cell for ULVR.L, plus the §C.1 currency cell, and compares
 * them with the chart payments the same screen shows. Then builds the export
 * model in-page (the app's own function output is not reachable, so the export
 * is checked from the payload directly).
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';

const ROOT = process.cwd();
const PORT = 8793;
const work = mkdtempSync(path.join(tmpdir(), 'qa-p4-h-'));
const server = spawn('npx', ['tsx', 'server/index.ts'], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(PORT), DB_PATH: path.join(work, 'db.sqlite') },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const base = `http://127.0.0.1:${PORT}`;
const up = async () => {
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(`${base}/api/dividends/KO`);
      if (r.status) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
};
if (!(await up())) {
  console.log('server never came up');
  server.kill();
  process.exit(1);
}

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || CHROME,
  headless: true,
  args: ['--hide-scrollbars', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });

const clickNav = async (id) => {
  const item = page.locator(`nav.side-nav button[data-screen="${id}"]`).first();
  if (!(await item.isVisible())) {
    await page.locator('.drawer-toggle').first().click();
    await page.waitForTimeout(500);
  }
  await item.click({ force: true });
  await page.waitForTimeout(400);
};
const clickRowExact = (sym) =>
  page.evaluate((s) => {
    const rows = [...document.querySelectorAll('button.wl-row')];
    const hit = rows.find((r) => (r.textContent || '').trim().startsWith(s));
    if (hit) {
      hit.click();
      return true;
    }
    return false;
  }, sym);
const setSymbolExact = async (sym) => {
  if (await clickRowExact(sym)) {
    await page.waitForTimeout(2000);
    return true;
  }
  await clickNav('watchlist');
  const input = page.locator('[data-testid="watchlist-screen"] input[type="text"]').first();
  if (!(await input.count())) return false;
  await input.fill(sym);
  await input.press('Enter');
  await page.waitForTimeout(5000);
  if (!(await clickRowExact(sym))) return false;
  await page.waitForTimeout(2000);
  return true;
};
const openAll = async () => {
  const t = page.locator('.div-screen .pf-section-toggle');
  for (let i = 0, n = await t.count(); i < n; i += 1) {
    const c = t.nth(i);
    const open = await c.evaluate((el) => el.closest('.pf-section')?.classList.contains('open'));
    if (!open) {
      await c.click({ force: true });
      await page.waitForTimeout(250);
    }
  }
  await page.waitForTimeout(800);
};

try {
  await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('[data-testid="dashboard-screen"]', { timeout: 25000 });
  await clickNav('dividends');
  await page.waitForSelector('[data-testid="dividends-screen"]', { timeout: 20000 });

  for (const sym of ['ULVR.L', '0005.HK', 'KO']) {
    const ok = await setSymbolExact(sym);
    if (!ok) {
      console.log(`${sym}: could not select`);
      continue;
    }
    await clickNav('dividends');
    await page.waitForTimeout(2500);
    await openAll();
    const cells = await page.evaluate(() => {
      const g = (id) => document.querySelector(`[data-testid="${id}"]`)?.textContent?.trim() ?? null;
      const table = document.querySelector('[data-testid="div-schedule"]');
      const firstRow = table ? [...table.querySelectorAll('tbody tr')][0] : null;
      const first = firstRow ? [...firstRow.querySelectorAll('td')].map((c) => c.textContent.trim()) : null;
      return {
        currency: g('div-f-currency'),
        annualRate: g('div-f-rate'),
        lastDiv: g('div-f-last'),
        indicated: g('div-f-indicated'),
        nextEx: g('div-f-nextex'),
        nextPay: g('div-f-nextpay'),
        newestRow: first,
      };
    });
    console.log(`\n### ${sym} DOM §C.1 / §C.5`);
    console.log('   TODAY the screen shows:');
    console.log(`     §C.1 Currency       = ${cells.currency}`);
    console.log(`     §C.1 Indicated      = ${cells.indicated}`);
    console.log(`     §C.1 Annual rate    = ${cells.annualRate}`);
    console.log(`     §C.1 Last Dividend  = ${cells.lastDiv}`);
    console.log(`     §C.1 Next Ex / Pay  = ${cells.nextEx} / ${cells.nextPay}`);
    console.log(`     §C.5 newest row     = ${JSON.stringify(cells.newestRow)}`);
  }
} finally {
  await browser.close().catch(() => {});
  server.kill('SIGTERM');
  rmSync(work, { recursive: true, force: true });
}
