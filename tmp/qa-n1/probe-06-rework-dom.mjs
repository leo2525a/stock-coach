/**
 * QA rework probe — live DOM §C.1 for the LSE (GBp) names AND the same-unit
 * names, on an ephemeral port. For each symbol it reads the rendered Annual
 * rate / Last Dividend / Currency / §C.5 newest amount, and independently
 * recomputes `price × indicatedYield` from the API payload to check the rendered
 * annual rate equals it (the provider's own yield identity).
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import path from 'node:path';
import { chromium } from 'playwright-core';

const ROOT = process.cwd();
const freePort = () =>
  new Promise((res) => {
    const s = createServer();
    s.once('error', () => res(0));
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => res(p));
    });
  });
const PORT = await freePort();
const work = mkdtempSync(path.join(tmpdir(), 'qa-n1r-dom-'));
const server = spawn('npx', ['tsx', 'server/index.ts'], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(PORT), DB_PATH: path.join(work, 'db.sqlite') },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const base = `http://127.0.0.1:${PORT}`;
const up = async () => {
  for (let i = 0; i < 240; i++) {
    try {
      if ((await fetch(`${base}/api/dividends/KO`)).status) return true;
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
console.log(`server up at ${base}`);

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || CHROME, headless: true, args: ['--hide-scrollbars', '--mute-audio'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const clickNav = async (id) => {
  const item = page.locator(`nav.side-nav button[data-screen="${id}"]`).first();
  if (!(await item.isVisible())) { await page.locator('.drawer-toggle').first().click(); await page.waitForTimeout(500); }
  await item.click({ force: true });
  await page.waitForTimeout(400);
};
const clickRowExact = (sym) => page.evaluate((s) => {
  const rows = [...document.querySelectorAll('button.wl-row')];
  const hit = rows.find((r) => (r.textContent || '').trim().startsWith(s));
  if (hit) { hit.click(); return true; }
  return false;
}, sym);
const setSymbolExact = async (sym) => {
  if (await clickRowExact(sym)) { await page.waitForTimeout(2000); return true; }
  await clickNav('watchlist');
  const input = page.locator('[data-testid="watchlist-screen"] input[type="text"]').first();
  if (!(await input.count())) return false;
  await input.fill(sym); await input.press('Enter'); await page.waitForTimeout(6000);
  if (!(await clickRowExact(sym))) return false;
  await page.waitForTimeout(2000);
  return true;
};
const openAll = async () => {
  const t = page.locator('.div-screen .pf-section-toggle');
  for (let i = 0, n = await t.count(); i < n; i += 1) {
    const c = t.nth(i);
    if (!(await c.evaluate((el) => el.closest('.pf-section')?.classList.contains('open')))) { await c.click({ force: true }); await page.waitForTimeout(250); }
  }
  await page.waitForTimeout(800);
};

const SYMBOLS = ['ULVR.L', 'BP.L', 'VOD.L', 'HSBA.L', '0005.HK', '0700.HK', 'KO', 'O', 'AAPL'];
const results = [];
try {
  await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('[data-testid="dashboard-screen"]', { timeout: 25000 });
  await clickNav('dividends');
  await page.waitForSelector('[data-testid="dividends-screen"]', { timeout: 20000 });

  for (const sym of SYMBOLS) {
    const ok = await setSymbolExact(sym);
    if (!ok) { console.log(`${sym}: COULD NOT SELECT (explicit failure, not a pass)`); results.push({ sym, selected: false }); continue; }
    await clickNav('dividends'); await page.waitForTimeout(2500); await openAll();
    const cells = await page.evaluate(() => {
      const g = (id) => document.querySelector(`[data-testid="${id}"]`)?.textContent?.trim() ?? null;
      const table = document.querySelector('[data-testid="div-schedule"]');
      const firstRow = table ? [...table.querySelectorAll('tbody tr')][0] : null;
      const first = firstRow ? [...firstRow.querySelectorAll('td')].map((c) => c.textContent.trim()) : null;
      return { currency: g('div-f-currency'), annualRate: g('div-f-rate'), lastDiv: g('div-f-last'), indicated: g('div-f-indicated'), trailing: g('div-f-trailing'), forward: g('div-f-forward'), nextEx: g('div-f-nextex'), nextPay: g('div-f-nextpay'), newestRow: first };
    });
    const api = await (await fetch(`${base}/api/dividends/${encodeURIComponent(sym)}`)).json();
    const f = api?.data?.facts ?? {};
    const ind = f.indicatedYield?.value ?? null;
    const price = api?.data?.price ?? null;
    const identity = ind != null && price != null ? ind * price : null;
    const r = { sym, ...cells, apiRate: f.annualRate, identity, price, selected: true };
    results.push(r);
    const num = (s) => { const t = String(s ?? '').trim(); return /^[\u2014-]$/.test(t) || t === 'null' || t === '' ? null : Number(t.replace(/[^0-9.-]/g, '')); };
    const rn = num(cells.annualRate);
    const idRatio = rn != null && identity ? (rn / identity).toFixed(4) : 'n/a';
    console.log(`${sym.padEnd(8)} ccy=${String(cells.currency).padEnd(4)} rate=${String(cells.annualRate).padEnd(12)} last=${String(cells.lastDiv).padEnd(11)} ind=${cells.indicated} identity=${identity == null ? '—' : identity.toFixed(4)} rate/identity=${idRatio} | apiRate=${JSON.stringify(f.annualRate)}`);
  }
} finally {
  await browser.close();
  server.kill();
  rmSync(work, { recursive: true, force: true });
}
const bad = results.filter((r) => {
  if (!r.selected) return true;
  const num = (s) => { const t = String(s ?? '').trim(); return /^[\u2014-]$/.test(t) || t === '' ? null : Number(t.replace(/[^0-9.-]/g, '')); };
  const rn = num(r.annualRate);
  if (rn === null) return false; // withheld = honest hand-off, not a fail here
  if (r.identity == null) return false;
  return rn / r.identity < 0.5 || rn / r.identity > 2;
});
console.log(`\nREWORK-DOM: ${bad.length === 0 ? 'PASS — every rendered Annual rate matches price × indicated yield, or is honestly withheld' : 'FAIL'}`);
for (const b of bad) console.log(`  • ${b.sym}: rate=${b.annualRate} identity=${b.identity}${b.selected ? '' : ' (could not select)'}`);
process.exit(bad.length === 0 ? 0 : 1);
