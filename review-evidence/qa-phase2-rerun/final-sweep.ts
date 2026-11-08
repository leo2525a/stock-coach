/**
 * FINAL EXHAUSTIVE SWEEP (debug-reviewer) — belt-and-braces for B1.
 *
 * No exclusions at all: we read the ENTIRE visible innerText of document.body on
 * every screen in a zh-HK session and also every /title|aria-label|placeholder/
 * attribute, then report every occurrence of an English relative-time word.
 * The only legitimate hits would be provider data (e.g. a headline containing
 * "ago"), which we surface explicitly rather than filter.
 */
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';

const BASE = process.env.BASE ?? 'http://127.0.0.1:8799';
const chrome = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
].find(existsSync)!;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const RE = /(just now|\d+\s*min ago|\d+\s*h ago|\d+\s*d ago|\bago\b)/gi;

async function main() {
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 950 } })).newPage();
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => { try { localStorage.clear(); } catch { /* noop */ } });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="dashboard-screen"]', { timeout: 25_000 });
  await sleep(4000);

  let total = 0;
  for (const id of ['dashboard', 'chart', 'signals', 'watchlist', 'help']) {
    await page.evaluate((sid) => {
      (document.querySelector(`nav.side-nav button[data-screen="${sid}"]`) as HTMLElement | null)?.click();
    }, id);
    await sleep(1200);
    const dump = await page.evaluate(() => {
      const text = document.body.innerText || '';
      const attrs = [...document.querySelectorAll('[title],[aria-label],[placeholder],[alt]')]
        .map((n) => [n.getAttribute('title'), n.getAttribute('aria-label'), n.getAttribute('placeholder'), n.getAttribute('alt')].filter(Boolean).join(' | '))
        .join('\n');
      return { text, attrs };
    });
    const hitsText = [...dump.text.matchAll(RE)].map((m) => m[0]);
    const hitsAttr = [...dump.attrs.matchAll(RE)].map((m) => m[0]);
    total += hitsText.length + hitsAttr.length;
    console.log(`[zh-HK ${id}] visible hits=${hitsText.length} ${JSON.stringify(hitsText)}  attr hits=${hitsAttr.length} ${JSON.stringify(hitsAttr)}`);
  }
  console.log(`\nTOTAL English relative-time hits across all 5 zh-HK screens: ${total}`);
  console.log(total === 0
    ? 'B1 RESOLVED — no English relative-time word renders anywhere in the zh-HK UI'
    : 'LEAK — investigate the hits above');
  await browser.close();
  process.exit(total === 0 ? 0 : 2);
}
main().catch((e) => { console.error('fatal', e); process.exit(1); });
