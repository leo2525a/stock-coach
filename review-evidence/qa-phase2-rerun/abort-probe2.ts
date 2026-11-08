/**
 * INDEPENDENT PROBE 2 (debug-reviewer) — locate the source of the 8
 * `net::ERR_ABORTED` the prior harness reports in its session-wide counter.
 *
 * Hypothesis: they are caused by the harness's OWN `gotoFresh()` helper, which
 * performs `goto()` then immediately `reload()` while the first navigation's
 * in-flight fetches (market/news/fundamentals) are still pending. Reloading a
 * page cancels those fetches → ERR_ABORTED, attributed to the app, caused by the
 * test.
 *
 * This probe isolates each phase so the counts are unambiguous.
 */
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';

const BASE = process.env.BASE ?? 'http://127.0.0.1:8799';
const chrome = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
].find(existsSync)!;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function scenario(name: string, body: (p: import('playwright-core').Page, count: () => number) => Promise<void>) {
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 950 } })).newPage();
  const aborted: string[] = [];
  const consoleErrs: string[] = [];
  page.on('requestfailed', (r) => aborted.push(`${r.url()} ${r.failure()?.errorText}`));
  page.on('console', (m) => { if (m.type() === 'error') consoleErrs.push(m.text()); });
  await body(page, () => aborted.length);
  console.log(`\n[${name}]`);
  console.log(`  aborted requests: ${aborted.length}`);
  for (const a of aborted.slice(0, 10)) console.log(`    ${a}`);
  console.log(`  console errors: ${consoleErrs.length}`);
  await browser.close();
}

async function main() {
  // A. Plain load, wait for everything, do nothing else.
  await scenario('A: single load + settle (no reload)', async (page) => {
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="dashboard-screen"]', { timeout: 25_000 });
    await page.waitForTimeout(6000);
  });

  // B. Exactly what the prior harness's gotoFresh() does: goto, then reload
  //    immediately (while the first load is still fetching).
  await scenario('B: gotoFresh() = goto() then immediate reload()', async (page) => {
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.evaluate(() => { try { localStorage.clear(); } catch { /* noop */ } });
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForSelector('[data-testid="dashboard-screen"]', { timeout: 25_000 });
    await page.waitForTimeout(6000);
  });

  // C. Navigate around the five screens (no reload) then settle.
  await scenario('C: navigate 5 screens + settle (no reload)', async (page) => {
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="dashboard-screen"]', { timeout: 25_000 });
    await page.waitForTimeout(3000);
    for (const id of ['dashboard', 'chart', 'signals', 'watchlist', 'help', 'dashboard']) {
      await page.evaluate((sid) => {
        (document.querySelector(`nav.side-nav button[data-screen="${sid}"]`) as HTMLElement | null)?.click();
      }, id);
      await page.waitForTimeout(500);
    }
    await page.waitForTimeout(5000);
  });
}

main().catch((e) => { console.error('fatal', e); process.exit(1); });
