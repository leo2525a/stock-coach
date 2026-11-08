/**
 * QA N1 probe — live DOM §C.1 unit coherence for the LSE (GBp) names and a USD
 * control, on an ephemeral port. Reads the rendered "Annual rate", "Last
 * Dividend", currency, the §C.5 newest Amount, and the chart's own trailing-12m
 * sum for the same symbol, and flags any Annual-rate cell that is ~100x below a
 * single payment.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';

const ROOT = process.cwd();
// ephemeral: pick a free high port ourselves (never 8787)
import { createServer } from 'node:net';
const freePort = async () => {
  for (const p of [8791, 8792, 8793, 8794, 8795, 8796, 8797]) {
    const ok = await new Promise((res) => {
      const s = createServer();
      s.once('error', () => res(false));
      s.once('listening', () => s.close(() => res(true)));
      s.listen(p, '127.0.0.1');
    });
    if (ok) return p;
  }
  return 0;
};
const PORT = await freePort();
const work = mkdtempSync(path.join(tmpdir(), 'qa-n1-dom-'));
const server = spawn('npx', ['tsx', 'server/index.ts'], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(PORT), DB_PATH: path.join(work, 'db.sqlite') },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let base = `http://127.0.0.1:${PORT}`;
const up = async () => {
  for (let i = 0; i < 240; i++) {
    try {
      const r = await fetch(`${base}/api/dividends/KO`);
      if (r.status) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
};
if (!(await up())) {
  console.log(`server never came up (base=${base || 'unknown'})`);
  server.kill();
  process.exit(1);
}
console.log(`server up at ${base}`);

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
  await page.waitForTimeout(6000);
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

const results = [];
try {
  await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('[data-testid="dashboard-screen"]', { timeout: 25000 });
  await clickNav('dividends');
  await page.waitForSelector('[data-testid="dividends-screen"]', { timeout: 20000 });

  for (const sym of ['ULVR.L', 'BP.L', 'VOD.L', 'HSBA.L', 'KO']) {
    const ok = await setSymbolExact(sym);
    if (!ok) {
      console.log(`${sym}: could not select (explicit failure, not a pass)`);
      results.push({ sym, selected: false });
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
      const chart = document.querySelector('[data-testid="div-span-c4"]');
      return {
        currency: g('div-f-currency'),
        annualRate: g('div-f-rate'),
        lastDiv: g('div-f-last'),
        indicated: g('div-f-indicated'),
        trailing: g('div-f-trailing'),
        forward: g('div-f-forward'),
        nextEx: g('div-f-nextex'),
        nextPay: g('div-f-nextpay'),
        newestRow: first,
        chartPresent: !!chart,
      };
    });
    // fetch the API payload for the same symbol to get the series' own annual sum
    const api = await (await fetch(`${base}/api/dividends/${encodeURIComponent(sym)}`)).json();
    const facts = api?.data?.facts ?? {};
    const ev = api?.data?.events ?? [];
    const day = 86400;
    const last = ev.length ? Math.max(...ev.map((e) => e.exDate)) : 0;
    const ttm = ev.filter((e) => e.exDate > last - 365 * day).reduce((a, e) => a + e.amount, 0);
    const r = { sym, ...cells, apiAnnualRate: facts.annualRate, apiAnnualNote: facts.annualRate?.note ?? null, ttmSum: ttm, selected: true };
    results.push(r);
    const num = (s) => (/^[\u2014-]$/.test(String(s ?? '').trim()) || s == null ? null : Number(String(s).replace(/[^0-9.-]/g, '')));
    const rn = num(cells.annualRate), ln = num(cells.lastDiv);
    const withheld = rn === null && /^[\u2014-]$/.test(String(cells.annualRate ?? '').trim());
    const ratio = rn != null && ln ? (rn / ln).toFixed(3) : 'withheld';
    console.log(
      `${sym.padEnd(8)} ccy=${cells.currency} | rate=${cells.annualRate} last=${cells.lastDiv} ratio=${ratio} | ` +
        `ind=${cells.indicated} trail=${cells.trailing} fwd=${cells.forward} | apiRate=${JSON.stringify(facts.annualRate)} ttm=${ttm.toFixed(3)}`,
    );
    void withheld;
  }
} finally {
  const bad = results.filter((r) => {
    if (!r.selected) return true;
    const s = String(r.annualRate ?? '').trim();
    if (/^[\u2014-]$/.test(s)) return false; // honest withholding is a pass
    const num = (x) => (x == null ? null : Number(String(x).replace(/[^0-9.-]/g, '')));
    const rn = num(r.annualRate), ln = num(r.lastDiv);
    return rn != null && ln != null && ln > 0 && rn < ln * 0.5;
  });
  await browser.close();
  server.kill();
  rmSync(work, { recursive: true, force: true });
  console.log(`\nN1-DOM: ${bad.length === 0 ? 'PASS — no Annual-rate cell ~100x below a single payment' : 'FAIL'}`);
  for (const b of bad) console.log(`  • ${b.sym}: rate=${b.annualRate} last=${b.lastDiv}${b.selected ? '' : ' (could not select)'}`);
  process.exit(bad.length === 0 ? 0 : 1);
}
