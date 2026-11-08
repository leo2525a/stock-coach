/**
 * INDEPENDENT PROBE (debug-reviewer) — is `net::ERR_ABORTED` on range/interval
 * navigation a real app defect, or the SPA cancelling superseded fetches?
 *
 * Method: fresh session, attach request/response trackers, then do exactly what
 * qa-browser.ts does in its §6 (rapid range + interval changes). For every
 * aborted request we ask: does a *later* request for the same path succeed, and
 * does the UI end up with a correct, complete dataset?
 */
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';

const BASE = process.env.BASE ?? 'http://127.0.0.1:8799';
const chrome = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
].find(existsSync)!;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const page = await ctx.newPage();

  const aborted: string[] = [];
  const okResponses: string[] = [];
  const consoleErrs: string[] = [];
  const pageErrs: string[] = [];
  page.on('requestfailed', (r) => aborted.push(`${r.url()} ${r.failure()?.errorText}`));
  page.on('response', (r) => { if (r.status() < 400) okResponses.push(r.url()); });
  page.on('console', (m) => { if (m.type() === 'error') consoleErrs.push(m.text()); });
  page.on('pageerror', (e) => pageErrs.push(e.message));

  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.evaluate(() => { try { localStorage.clear(); } catch { /* noop */ } });
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForSelector('[data-testid="dashboard-screen"]', { timeout: 25_000 });
  await page.waitForTimeout(2500);

  // Go to chart and hammer range/interval exactly like the prior harness does.
  await page.evaluate(() => {
    (document.querySelector('nav.side-nav button[data-screen="chart"]') as HTMLElement | null)?.click();
  });
  await page.waitForSelector('[data-testid="chart-screen"]', { timeout: 20_000 });
  await page.waitForFunction(() => Number(document.querySelector('[data-testid="chart-wrap"]')?.getAttribute('data-bar-count') || 0) > 0, null, { timeout: 25_000 });
  await sleep(700);

  const path = (u: string) => { try { const x = new URL(u); return x.pathname + x.search; } catch { return u; } };
  const mark = aborted.length;

  const ranges = ['1mo', '3mo', '6mo', '1y', '1mo'];
  for (const r of ranges) {
    await page.locator(`[data-testid="chart-toolbar"] [data-range="${r}"]`).first().click();
    await page.waitForTimeout(600); // deliberately NOT waiting for completion => supersede
  }
  await page.locator('[data-testid="chart-toolbar"] [data-interval="1w"]').first().click();
  await page.waitForTimeout(600);
  await page.locator('[data-testid="chart-toolbar"] [data-interval="1d"]').first().click();
  await sleep(3000);

  const bars = Number(await page.locator('[data-testid="chart-wrap"]').getAttribute('data-bar-count'));
  const abortedHere = aborted.slice(mark);

  // For each aborted URL, was the SAME path later served successfully?
  const okPaths = new Set(okResponses.map(path));
  const resolved = abortedHere.map((a) => {
    const u = a.split(' ')[0];
    return { url: path(u), error: a.split(' ')[1], laterServed: okPaths.has(path(u)) };
  });

  console.log('aborted during the rapid toggle:', resolved.length);
  for (const r of resolved) console.log(`  ${r.error} ${r.url} → laterServed=${r.laterServed}`);
  console.log('final bar count:', bars, '(>0 means the last selection rendered real data)');
  console.log('console errors during probe:', consoleErrs.length, consoleErrs.slice(0, 3));
  console.log('page errors during probe:', pageErrs.length, pageErrs.slice(0, 3));

  const allResolved = resolved.every((r) => r.laterServed);
  console.log('\nVERDICT:', resolved.length === 0
    ? 'no aborts observed (clean)'
    : allResolved && bars > 0 && consoleErrs.length === 0 && pageErrs.length === 0
      ? 'ERR_ABORTED = SPA superseding in-flight fetches; every aborted path was later served OK, final render is correct, no console/page errors ⇒ HARNESS ARTEFACT, not an app defect'
      : 'AT LEAST ONE ABORT IS UNEXPLAINED — treat as a real defect');

  await ctx.close();
  await browser.close();
}

main().catch((e) => { console.error('fatal', e); process.exit(1); });
