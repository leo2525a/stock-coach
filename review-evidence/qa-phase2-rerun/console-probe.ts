/**
 * INDEPENDENT PROBE 3 (debug-reviewer) — attribute the "1 console error".
 *
 * The prior harness's session-wide console counter reports exactly one error:
 *   Failed to load resource: the server responded with a status of 400
 * This probe reproduces the harness's own deliberate `/api/news/@@bad@@` call
 * inside a page session and shows it is the *only* thing that puts a 400 in the
 * console — i.e. the error is caused by the test's negative probe, not by app
 * behaviour on any real path.
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
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 950 } })).newPage();
  const consoleErrs: string[] = [];
  const consoleAll: string[] = [];
  page.on('console', (m) => { consoleAll.push(`${m.type()}: ${m.text()}`); if (m.type() === 'error') consoleErrs.push(m.text()); });

  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="dashboard-screen"]', { timeout: 25_000 });
  await page.waitForTimeout(4000);

  console.log('console errors BEFORE the bad call:', consoleErrs.length);

  // The harness's own negative probe.
  const r = await page.evaluate(async () => {
    const res = await fetch('/api/news/@@bad@@', { headers: { Accept: 'application/json' } });
    return { status: res.status, body: await res.json() };
  });
  await page.waitForTimeout(800);
  console.log('bad-news probe result:', JSON.stringify(r));
  console.log('console errors AFTER the bad call:', consoleErrs.length);
  consoleErrs.forEach((e, i) => console.log(`  err[${i}] ${e}`));

  // And the honest-empty path note key (the fundamentals 'unavailable' branch).
  await ctxEvaluate(page);
  await browser.close();
}

/** Show the fundamentals note key is a translatable i18n key, not raw English. */
async function ctxEvaluate(page: import('playwright-core').Page) {
  const note = await page.evaluate(async () => {
    const res = await fetch('/api/fundamentals/ZZZZZZ', { headers: { Accept: 'application/json' } });
    const j = await res.json();
    return { source: j.data?.source, note: j.data?.note, keys: j.data ? Object.keys(j.data) : [] };
  });
  console.log('\nZZZZZZ honest-empty envelope:', JSON.stringify(note));
}

main().catch((e) => { console.error('fatal', e); process.exit(1); });
