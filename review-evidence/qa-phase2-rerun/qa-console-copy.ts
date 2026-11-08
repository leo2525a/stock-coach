/**
 * INDEPENDENT QA (debug-reviewer) — console/network cleanliness probe.
 *
 * Isolates app-originated console errors and failed requests from harness
 * artefacts: no reloads after the first load, and no deliberate bad requests.
 */
import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser } from 'playwright-core';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE ?? 'http://127.0.0.1:8797';
const CHROME = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium'].find(existsSync);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const browser: Browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  await ctx.addInitScript(() => { try { localStorage.clear(); } catch { /* noop */ } });
  const page = await ctx.newPage();

  const consoleErrs: string[] = [];
  const pageErrs: string[] = [];
  const failed: string[] = [];
  let step = 'load';
  page.on('console', (m) => { if (m.type() === 'error') consoleErrs.push(`[${step}] ${m.text()}`); });
  page.on('pageerror', (e) => pageErrs.push(`[${step}] ${e.message}`));
  page.on('requestfailed', (r) => failed.push(`[${step}] ${r.method()} ${r.url()} → ${r.failure()?.errorText}`));
  // Record HTTP status responses (>=400) with the step attribution + initiator.
  const badResponses: string[] = [];
  page.on('response', (r) => {
    if (r.status() >= 400) badResponses.push(`[${step}] HTTP ${r.status()} ${r.url()}`);
  });

  step = 'initial-load';
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForSelector('[data-testid="dashboard-screen"]', { timeout: 30_000 });
  await sleep(4000); // let all dashboard queries settle

  const domClick = (id: string) => page.evaluate((sid) => {
    const el = document.querySelector(`nav.side-nav button[data-screen="${sid}"]`) as HTMLElement | null;
    if (el) { el.click(); return true; } return false;
  }, id);

  for (const id of ['chart', 'signals', 'watchlist', 'help', 'dashboard']) {
    step = `nav:${id}`;
    await domClick(id);
    await sleep(3000);
  }

  step = 'lang:en';
  await page.locator('[data-testid="lang-switch"] button[data-lang="en"]').click();
  await sleep(1500);
  step = 'lang:zh-HK';
  await page.locator('[data-testid="lang-switch"] button[data-lang="zh-HK"]').click();
  await sleep(1500);

  step = 'group:sector';
  await domClick('watchlist');
  await sleep(2000);
  await page.locator('[data-testid="wl-group-sector"]').first().click();
  await sleep(2500);
  step = 'group:type';
  await page.locator('[data-testid="wl-group-type"]').first().click();
  await sleep(2000);

  step = 'chart:toggles';
  await domClick('chart');
  await sleep(2500);
  for (const sel of ['[data-overlay="sma20"]', '[data-pane="rsi"]', '[data-range="1mo"]']) {
    await page.locator(`[data-testid="chart-toolbar"] ${sel}`).first().click();
    await sleep(2500);
  }

  step = 'final-dwell';
  await sleep(4000);

  const out = { base: BASE, consoleErrs, pageErrs, failed, badResponses };
  writeFileSync(path.join(__dirname, 'qa-console-report.json'), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  await ctx.close();
  await browser.close();
}

main().catch((e) => { console.error('fatal', e); process.exit(1); });
