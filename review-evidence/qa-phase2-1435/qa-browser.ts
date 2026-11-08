/**
 * INDEPENDENT QA (debug-reviewer) — Phase 2 browser evidence.
 *
 * Owned by the reviewer. Written from scratch; does NOT reuse or trust the
 * builder-modified review-evidence/browser-check.ts.
 *
 * Run:  BASE=http://127.0.0.1:8797 node_modules/.bin/tsx review-evidence/qa-phase2-1435/qa-browser.ts
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const OUT = __dirname;
const BASE = process.env.BASE ?? 'http://127.0.0.1:8797';

let pass = 0;
const fails: string[] = [];
const notes: string[] = [];
const evidence: Record<string, unknown> = {};
function check(name: string, cond: boolean, detail = '') {
  if (cond) { pass += 1; console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`); }
  else { fails.push(`${name}${detail ? ` — ${detail}` : ''}`); console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
}
function note(text: string) { notes.push(text); console.log(`  · ${text}`); }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function chromePath() {
  const c = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ];
  return c.find(existsSync);
}

interface Errors { console: string[]; page: string[]; requests: string[]; }
function track(page: Page): Errors {
  const e: Errors = { console: [], page: [], requests: [] };
  page.on('console', (m) => { if (m.type() === 'error') e.console.push(m.text()); });
  page.on('pageerror', (err) => e.page.push(err.message));
  page.on('requestfailed', (r) => e.requests.push(`${r.method()} ${r.url()} ${r.failure()?.errorText}`));
  return e;
}

async function gotoFresh(page: Page, url = `${BASE}/`) {
  // Wipe persisted prefs so we observe the shipped default, then load.
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.evaluate(() => { try { localStorage.clear(); } catch { /* noop */ } });
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 });
}

async function canvasSignature(page: Page): Promise<{ distinct: number; colored: number; w: number; h: number } | null> {
  return page.evaluate(() => {
    const src = document.querySelector('[data-testid="chart-canvas"] canvas') as HTMLCanvasElement | null;
    if (!src) return null;
    const off = document.createElement('canvas'); off.width = src.width; off.height = src.height;
    const ctx = off.getContext('2d')!; ctx.drawImage(src, 0, 0);
    const { data } = ctx.getImageData(0, 0, off.width, off.height);
    const seen = new Set<number>(); let colored = 0;
    for (let i = 0; i < data.length; i += 4 * 7) {
      seen.add((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
      if (data[i + 3] > 0) colored += 1;
    }
    return { distinct: seen.size, colored, w: src.width, h: src.height };
  });
}

/**
 * Navigate by stable data-screen. Uses a DOM-level click so an off-canvas or
 * scrolled-out-of-view nav item (mobile drawer, long sidebar) never stalls the
 * actionability checks. Opens the drawer first when the item is not on-screen.
 */
async function clickNav(page: Page, screenId: string) {
  const domClick = (id: string) =>
    page.evaluate((sid) => {
      const el = document.querySelector(`nav.side-nav button[data-screen="${sid}"]`) as HTMLElement | null;
      if (!el) return false;
      el.click();
      return true;
    }, id);
  let ok = await domClick(screenId).catch(() => false);
  if (!ok) {
    await page.evaluate(() => {
      const el = document.querySelector('button.drawer-toggle') as HTMLElement | null;
      if (el) el.click();
    });
    await sleep(360);
    ok = await domClick(screenId).catch(() => false);
    const scrim = page.locator('[data-testid="drawer-scrim"]');
    if (await scrim.count()) await scrim.first().click().catch(() => {});
  }
  await sleep(240);
}

/** Visible text of the page with provider-data regions removed. */
const TEXT_SCAN = () => {
  const clone = document.body.cloneNode(true) as HTMLElement;
  const drop = [
    'noscript', 'script', 'style',
    // Provider-supplied DATA regions (company names, prices, headlines, charts).
    // These are real fetched data, not UI chrome, so they are out of scope for
    // the untranslated-UI-string sweep.
    '[data-testid="news-list"]', '[data-testid="profile-summary"]', '.sym-name', '.wl-name',
    '.news-item', '.news-title', '#chart-canvas', '[data-testid="chart-canvas"]', 'canvas',
    '.brand', '.sidebar-watch .wl-name', '.wl-manage-row .muted', '.wl-manage-row .mono',
  ];
  for (const sel of drop) clone.querySelectorAll(sel).forEach((n) => n.remove());
  return (clone.innerText || '');
};

/** Tokens that are legitimately Latin in a Chinese UI (codes, brands, acronyms). */
const ALLOW = new Set([
  'APP', 'EN', 'ET', 'PWA', 'OHLC', 'SMA', 'EMA', 'RSI', 'MACD', 'BB', 'ATR', 'ETF', 'HKT',
  'USD', 'HKD', 'EUR', 'JPY', 'GBP', 'CNY', 'US', 'UK', 'HK', 'Stock', 'Coach', 'StockCoach',
  'TradingView', 'Lightweight', 'Charts', 'NASDAQ', 'NYSE', 'ARCA', 'Arca', 'HKEX', 'LSE', 'TSX',
  'ASX', 'SSE', 'SZSE', 'XETRA', 'TSE', 'SIX', 'OK', 'No', 'X',
  'AAPL', 'MSFT', 'NVDA', 'SPY', 'QQQ', 'BAC', 'TLSA', 'TSLA', 'AMZN', 'GOOG', 'META', '0700.HK', '9988.HK',
]);

function latinLeaks(text: string, lang: string): string[] {
  const found = new Set<string>();
  // Words with 2+ latin letters. We only flag *prose-like* runs of 2+ words to
  // avoid flagging every ticker/acronym; a single Latin word is reported
  // separately as a lower-confidence candidate.
  const words = text.split(/\s+/).map((w) => w.replace(/[^\p{L}\p{N}.\-+%]/gu, '')).filter(Boolean);
  const isLatin = (w: string) => /^[A-Za-z][A-Za-z0-9.\-]*$/.test(w);
  const allowed = (w: string) => {
    if (ALLOW.has(w)) return true;
    if (/^[A-Z0-9.^=-]{1,8}$/.test(w)) return true;        // tickers/codes
    if (/^\d/.test(w)) return true;                        // numbers
    if (/^[A-Z]{1,6}$/.test(w)) return true;               // acronyms
    return false;
  };
  let run: string[] = [];
  const flush = () => {
    if (run.length >= 2 && run.some((w) => w.length >= 4)) found.add(run.join(' '));
    else if (run.length === 1 && run[0].length >= 5 && !allowed(run[0])) found.add(run[0]);
    run = [];
  };
  for (const w of words) {
    if (isLatin(w)) run.push(w); else flush();
  }
  flush();
  // Keep only multi-word prose for the strict zh leak list.
  return [...found].filter((s) => lang === 'zh-HK' ? /\s/.test(s) : true);
}

async function allScreens(page: Page, fn: (id: string) => Promise<void>) {
  for (const id of ['dashboard', 'chart', 'signals', 'watchlist', 'help']) {
    await clickNav(page, id);
    await fn(id);
  }
}

async function main() {
  const chrome = chromePath();
  if (!chrome) { console.error('no chrome'); process.exit(1); }
  mkdirSync(OUT, { recursive: true });

  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({ executablePath: chrome, headless: true });
    const ctx: BrowserContext = await browser.newContext({ viewport: { width: 1440, height: 950 } });
    const page = await ctx.newPage();
    const errs = track(page);

    /* ============================ 1. zh-HK default ========================= */
    console.log('\n1) zh-HK is the DEFAULT on a clean profile');
    await gotoFresh(page);
    await page.waitForSelector('[data-testid="dashboard-screen"]', { timeout: 25_000 });
    await page.waitForFunction(() => (document.querySelector('[data-testid="topbar-price"] .last')?.textContent || '').match(/\d/), null, { timeout: 25_000 });
    const htmlLang = await page.evaluate(() => document.documentElement.lang);
    check('document lang is zh-HK', htmlLang === 'zh-HK', htmlLang);
    const title = await page.title();
    check('document title is Chinese', /[\u3400-\u9fff]/.test(title), title);
    const navZh = await page.locator('nav.side-nav').innerText();
    check('sidebar nav is Chinese', /總覽/.test(navZh) && /圖表/.test(navZh) && /訊號/.test(navZh), navZh.replace(/\n/g, '|'));
    const activeLang = await page.locator('[data-testid="lang-switch"] .active').innerText();
    check('language switch shows 中 active', activeLang.includes('中'), activeLang);
    evidence.defaultLang = { htmlLang, title, navZh };

    /* ==================== 2. toggle both ways, instantly =================== */
    console.log('\n2) top-bar toggle switches BOTH ways with no reload');
    await page.evaluate(() => { (window as unknown as Record<string, unknown>).__qaAlive = 'yes'; });
    await page.locator('[data-testid="lang-switch"] button[data-lang="en"]').click();
    await sleep(350);
    const navEn = await page.locator('nav.side-nav').innerText();
    const htmlLangEn = await page.evaluate(() => document.documentElement.lang);
    const titleEn = await page.title();
    const alive1 = await page.evaluate(() => (window as unknown as Record<string, unknown>).__qaAlive);
    check('EN: nav switches to English', /Dashboard/.test(navEn) && /Watchlist/.test(navEn), navEn.replace(/\n/g, '|'));
    check('EN: <html lang> follows', htmlLangEn === 'en', htmlLangEn);
    check('EN: title switches', !/[\u3400-\u9fff]/.test(titleEn), titleEn);
    check('EN: no page reload (marker survived)', alive1 === 'yes', String(alive1));

    await page.locator('[data-testid="lang-switch"] button[data-lang="zh-HK"]').click();
    await sleep(350);
    const navBack = await page.locator('nav.side-nav').innerText();
    const alive2 = await page.evaluate(() => (window as unknown as Record<string, unknown>).__qaAlive);
    check('back to zh-HK restores Chinese', /總覽/.test(navBack), navBack.replace(/\n/g, '|'));
    check('back: no page reload either', alive2 === 'yes', String(alive2));
    const persisted = await page.evaluate(() => localStorage.getItem('stockcoach.lang'));
    check('language choice persisted to localStorage', persisted === 'zh-HK', String(persisted));
    evidence.toggle = { navZh, navEn, navBack, titleEn };

    /* ===================== 3. untranslated-string sweep =================== */
    console.log('\n3) English-leak sweep over EVERY screen in zh-HK');
    const leaks: Record<string, string[]> = {};
    await allScreens(page, async (id) => {});
    // Re-walk, capturing text per screen (data regions already stripped).
    for (const id of ['dashboard', 'chart', 'signals', 'watchlist', 'help']) {
      await clickNav(page, id);
      await sleep(300);
      const text = (await page.evaluate(TEXT_SCAN)) as string;
      leaks[id] = latinLeaks(text, 'zh-HK');
    }
    evidence.zhLeaks = leaks;
    for (const [id, list] of Object.entries(leaks)) {
      check(`zh-HK screen "${id}" has no English prose leak`, list.length === 0, list.join(' | ') || 'clean');
    }

    // Targeted probe: the live source-freshness badge, which embeds humanAge().
    await clickNav(page, 'dashboard');
    await page.waitForTimeout(2500);
    const badgeText = await page.locator('[data-testid="source-badge"]').first().innerText().catch(() => '(none)');
    evidence.sourceBadgeZh = badgeText;
    check('source badge (freshness) is Chinese in zh-HK', !/[A-Za-z]/.test(badgeText.replace(/AAPL|SPY|ETF/g, '')), JSON.stringify(badgeText));

    // Targeted probe: a news item's relative time in zh-HK.
    const newsAgeZh = await page.locator('[data-testid="news-list"] .news-item').first().innerText().catch(() => '(none)');
    evidence.newsAgeZh = newsAgeZh.replace(/\n/g, ' | ').slice(0, 160);
    check('news relative-time is Chinese in zh-HK', !/min ago|just now|h ago|d ago/.test(newsAgeZh), evidence.newsAgeZh as string);

    // Also: language switch must actually change body copy (not just nav).
    await clickNav(page, 'help');
    const zhHelp = await page.evaluate(TEXT_SCAN) as string;
    await page.locator('[data-testid="lang-switch"] button[data-lang="en"]').click(); await sleep(300);
    const enHelp = await page.evaluate(TEXT_SCAN) as string;
    check('help copy differs between locales (real translation)', zhHelp !== enHelp && enHelp.length > 100, `zh ${zhHelp.length}b vs en ${enHelp.length}b`);
    await page.locator('[data-testid="lang-switch"] button[data-lang="zh-HK"]').click(); await sleep(300);

    /* ============== 4. responsive: no horizontal overflow ================= */
    console.log('\n4) no horizontal overflow at 390 / 834 / 1600 across all screens');
    const widths = [390, 834, 1600];
    const overflow: Record<string, Record<string, number>> = {};
    for (const w of widths) {
      await page.setViewportSize({ width: w, height: 900 });
      await sleep(250);
      overflow[w] = {};
      for (const id of ['dashboard', 'chart', 'signals', 'watchlist', 'help']) {
        await clickNav(page, id);
        await sleep(250);
        const d = await page.evaluate(() => {
          const de = document.documentElement;
          const body = document.body;
          return Math.max(de.scrollWidth - de.clientWidth, body.scrollWidth - body.clientWidth);
        });
        overflow[w][id] = d;
        check(`overflow ${w}px / ${id} == 0`, d <= 0, `${d}px`);
      }
    }
    evidence.overflow = overflow;
    await page.setViewportSize({ width: 1440, height: 950 });
    await sleep(250);

    /* ======================= 5. keyboard/focus sanity ===================== */
    console.log('\n5) keyboard / focus basics');
    await gotoFresh(page);
    await page.waitForSelector('[data-testid="dashboard-screen"]', { timeout: 25_000 });
    await page.waitForTimeout(1500);
    const focusChain: string[] = [];
    for (let i = 0; i < 10; i += 1) {
      await page.keyboard.press('Tab');
      const info = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el) return null;
        const cs = getComputedStyle(el);
        return {
          tag: el.tagName.toLowerCase(),
          text: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 28),
          outline: cs.outlineStyle + ' ' + cs.outlineWidth,
          visible: !!el.offsetParent || cs.position === 'fixed',
        };
      });
      if (info) focusChain.push(`${info.tag}:${info.text||'(none)'}[${info.outline}]`);
    }
    evidence.focusChain = focusChain;
    const focusable = focusChain.filter((f) => /^(button|a):/.test(f));
    check('Tab reaches real interactive controls', focusable.length >= 5, `${focusable.length}/10 stops focusable`);
    const withOutline = focusChain.filter((f) => !/\[none 0px\]/.test(f));
    check('focused controls show a visible focus indicator', withOutline.length >= 3, withOutline.length + ' with outline; first stops: ' + focusChain.slice(0, 4).join(' , '));
    // Escape closes the mobile drawer?
    await page.setViewportSize({ width: 390, height: 844 });
    await sleep(300);
    await page.evaluate(() => {
      const el = document.querySelector('button.drawer-toggle') as HTMLElement | null;
      if (el) el.click();
    });
    await sleep(400);
    const drawerOpen = await page.locator('.sidebar.open').count();
    check('mobile: hamburger opens the drawer', drawerOpen > 0, `${drawerOpen}`);
    await page.keyboard.press('Escape');
    await sleep(300);
    evidence.drawerAfterEscape = await page.locator('.sidebar.open').count();
    note(`mobile: Escape closes drawer? open-after-escape=${evidence.drawerAfterEscape}`);
    await page.setViewportSize({ width: 1440, height: 950 });
    await sleep(250);

    /* ================= 6. Phase 1 chart controls post-refactor ============ */
    console.log('\n6) Phase 1 chart controls still work (overlays / panes / timeframe)');
    await clickNav(page, 'chart');
    await page.waitForSelector('[data-testid="chart-screen"]', { timeout: 20_000 });
    await page.waitForFunction(() => Number(document.querySelector('[data-testid="chart-wrap"]')?.getAttribute('data-bar-count') || 0) > 0, null, { timeout: 25_000 });
    await sleep(600);
    const baseBars = Number(await page.locator('[data-testid="chart-wrap"]').getAttribute('data-bar-count'));
    check('chart has real bars', baseBars >= 100, `${baseBars}`);
    const sig0 = await canvasSignature(page);
    check('candles actually drawn (non-blank canvas)', !!sig0 && sig0.distinct > 12 && sig0.colored > 200, sig0 ? `${sig0.distinct} colours` : 'none');

    for (const [name, sel] of [
      ['overlay sma20', '[data-testid="chart-toolbar"] [data-overlay="sma20"]'],
      ['overlay bb', '[data-testid="chart-toolbar"] [data-overlay="bb"]'],
      ['pane rsi', '[data-testid="chart-toolbar"] [data-pane="rsi"]'],
      ['pane macd', '[data-testid="chart-toolbar"] [data-pane="macd"]'],
      ['pane volume', '[data-testid="chart-toolbar"] [data-pane="volume"]'],
    ] as const) {
      const before = await canvasSignature(page);
      await page.locator(sel).first().click();
      await sleep(700);
      const after = await canvasSignature(page);
      check(`toggling ${name} redraws`, !!before && !!after && (after.distinct !== before.distinct || after.colored !== before.colored), `${before?.distinct}->${after?.distinct}`);
    }
    // timeframe
    await page.locator('[data-testid="chart-toolbar"] [data-range="1mo"]').first().click();
    await page.waitForFunction((p) => Number(document.querySelector('[data-testid="chart-wrap"]')?.getAttribute('data-bar-count') || 0) !== p && Number(document.querySelector('[data-testid="chart-wrap"]')?.getAttribute('data-bar-count') || 0) > 0, baseBars, { timeout: 25_000 });
    const bars2 = Number(await page.locator('[data-testid="chart-wrap"]').getAttribute('data-bar-count'));
    check('timeframe button reloads a different window', bars2 !== baseBars && bars2 > 0, `${baseBars}->${bars2}`);
    // interval
    await page.locator('[data-testid="chart-toolbar"] [data-interval="1w"]').first().click();
    await page.waitForTimeout(2500);
    const bars3 = Number(await page.locator('[data-testid="chart-wrap"]').getAttribute('data-bar-count'));
    check('interval button changes bar count too', bars3 !== bars2 && bars3 > 0, `${bars2}->${bars3}`);

    /* ============ 7. categorisation: grouping + persistence =============== */
    console.log('\n7) watchlist grouping by category + persistence');
    await clickNav(page, 'watchlist');
    await page.waitForSelector('[data-testid="watchlist-screen"]', { timeout: 20_000 });
    await sleep(500);
    await page.locator('[data-testid="group-sector"]').first().click();
    await sleep(500);
    const sectorHeads = await page.locator('[data-testid^="wl-group-"]').allInnerTexts();
    check('group-by-sector produces group headers', sectorHeads.length >= 1, sectorHeads.join(' | '));
    const hasUnknownBucket = sectorHeads.some((h) => /未分類|Unknown/.test(h));
    check('an ETF with no sector lands in the honest Unknown bucket', hasUnknownBucket, sectorHeads.join(' | '));
    evidence.sectorGroups = sectorHeads;
    // switch to type grouping
    await page.locator('[data-testid="group-type"]').first().click();
    await sleep(500);
    const typeHeads = await page.locator('[data-testid^="wl-group-"]').allInnerTexts();
    check('group-by-type shows Stock and ETF buckets', typeHeads.some((h) => /股票/.test(h)) && typeHeads.some((h) => /ETF/.test(h)), typeHeads.join(' | '));
    evidence.typeGroups = typeHeads;
    // persistence across reload
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="watchlist-screen"]', { timeout: 20_000 }).catch(() => {});
    await clickNav(page, 'watchlist');
    await sleep(600);
    const persistedMode = await page.evaluate(() => localStorage.getItem('stockcoach.groupBy'));
    const typePressed = await page.locator('[data-testid="group-type"]').first().getAttribute('aria-pressed');
    check('grouping choice persists across reload', persistedMode === 'type' && typePressed === 'true', `ls=${persistedMode} aria=${typePressed}`);
    const headsAfterReload = await page.locator('[data-testid^="wl-group-"]').allInnerTexts();
    check('groups still rendered after reload', headsAfterReload.length >= 1, headsAfterReload.join(' | '));

    /* =============== 8. dashboard panels populated ======================== */
    console.log('\n8) Dashboard panels present & populated with real numbers');
    await clickNav(page, 'dashboard');
    await page.waitForSelector('[data-testid="dashboard-screen"]', { timeout: 20_000 });
    await page.waitForTimeout(3000);
    for (const id of ['key-stats-panel', 'health-panel', 'range-panel', 'profile-panel', 'category-panel', 'news-panel']) {
      check(`panel ${id} is present`, (await page.locator(`[data-testid="${id}"]`).count()) > 0, id);
    }
    const statsText = await page.locator('[data-testid="stats-grid"]').innerText().catch(() => '');
    const statNums = (statsText.match(/\d+(\.\d+)?/g) || []).length;
    check('key stats show real numbers (not all dashes)', statNums >= 5, `${statNums} numeric tokens`);
    const healthText = await page.locator('[data-testid="health-grid"]').innerText().catch(() => '');
    check('health panel shows real numbers', (healthText.match(/\d/g) || []).length >= 4, healthText.replace(/\n/g, ' | ').slice(0, 110));
    const rangeFill = await page.locator('[data-testid="range-marker"]').getAttribute('style').catch(() => null);
    check('52-week range marker is positioned', !!rangeFill && /left:\s*[\d.]+%/.test(rangeFill), String(rangeFill));
    const catRows = await page.locator('[data-testid="category-rows"]').innerText().catch(() => '');
    check('category chips/rows populated (type+sector+exchange)', /(股票|ETF)/.test(catRows) && /(納斯達克|NASDAQ)/.test(catRows), catRows.replace(/\n/g, ' | ').slice(0, 110));
    evidence.dashboard = { statsText: statsText.slice(0, 400), healthText: healthText.slice(0, 300), rangeFill, catRows: catRows.slice(0, 220) };

    /* =============== 9. news panel ========================================= */
    console.log('\n9) news panel: real items, real URLs, honest state');
    const newsCount = await page.locator('[data-testid="news-list"] .news-item').count();
    check('news items rendered', newsCount > 0, `${newsCount} items`);
    const hrefs = await page.locator('[data-testid="news-list"] a.news-title').evaluateAll(
      (as) => as.map((a) => (a as HTMLAnchorElement).href));
    const realUrls = hrefs.filter((h) => /^https?:\/\//.test(h));
    check('every headline links to a real absolute URL', realUrls.length === hrefs.length && hrefs.length > 0, `${realUrls.length}/${hrefs.length}`);
    const placeholderish = hrefs.filter((h) => /example\.|localhost|#|javascript:|placeholder|TODO/i.test(h));
    check('no placeholder/fake hrefs', placeholderish.length === 0, placeholderish.join(' | ') || 'none');
    const urlShapes = new Set(hrefs.map((h) => new URL(h).host));
    check('headlines resolve to publisher/yahoo hosts', urlShapes.size >= 1, [...urlShapes].join(', '));
    const newsMeta = await page.locator('[data-testid="news-list"] .news-meta').first().innerText();
    check('news item shows publisher + relative time', newsMeta.length > 3, newsMeta.replace(/\n/g, ' · ').slice(0, 90));
    evidence.news = { count: newsCount, hrefs: hrefs.slice(0, 6), metaSample: newsMeta };

    // Relative time should be HKT-plausible: "X 分鐘/小時/日 前" or "just now"
    const relativeOk = /前|now|分鐘|小時|日/.test(newsMeta);
    check('relative time renders in a HKT-plausible form', relativeOk, newsMeta.replace(/\n/g, ' ').slice(0, 60));

    /* ============ 10. data honesty: break the fundamentals path =========== */
    console.log('\n10) data honesty — invalid symbol & missing data degrade honestly');
    const badApi = await page.evaluate(async () => {
      const r = await fetch('/api/fundamentals/ZZZZZZ', { headers: { Accept: 'application/json' } });
      return { status: r.status, body: await r.json() };
    });
    check('invalid fundamentals symbol rejected (4xx, no invented numbers)',
      badApi.status >= 400 && badApi.status < 500 && !/marketCap|trailingPE/.test(JSON.stringify(badApi.body)),
      `HTTP ${badApi.status}`);
    const okButEmpty = await page.evaluate(async () => {
      // A valid symbol the provider does not publish fundamentals for.
      const r = await fetch('/api/fundamentals/SPY', { headers: { Accept: 'application/json' } });
      return await r.json();
    });
    evidence.spyFundamentals = okButEmpty;
    check('valid-but-unpublished fundamentals returns honest empty envelope (no numbers)',
      okButEmpty.ok === true && JSON.stringify(okButEmpty).indexOf('marketCap') === -1,
      `source=${okButEmpty?.data?.source ?? '?'} keyStats=${JSON.stringify(okButEmpty?.data?.keyStats ?? 'missing').slice(0, 40)}`);

    // Malformed news symbol
    const badNews = await page.evaluate(async () => {
      const r = await fetch('/api/news/@@bad@@', { headers: { Accept: 'application/json' } });
      return { status: r.status, body: await r.json() };
    });
    check('malformed news symbol rejected', badNews.status === 400, `HTTP ${badNews.status}`);

    // No credential leakage to the client
    const leakProbe = await page.evaluate(async () => {
      const r = await fetch('/api/fundamentals/AAPL', { headers: { Accept: 'application/json' } });
      const setCookie = r.headers.get('set-cookie');
      const text = await r.text();
      return { setCookie, hasCrumb: /crumb/i.test(text), hasCookie: /eyJ|A1=|A3=|sessionId/i.test(text), len: text.length };
    });
    check('no Set-Cookie from the credential path', !leakProbe.setCookie, String(leakProbe.setCookie));
    check('no crumb/cookie material in the API payload', !leakProbe.hasCrumb && !leakProbe.hasCookie, JSON.stringify(leakProbe));
    evidence.leakProbe = leakProbe;

    /* ============ 11. console cleanliness (whole session) ================= */
    console.log('\n11) console cleanliness across the whole session');
    check('zero console errors', errs.console.length === 0, `${errs.console.length} — ${errs.console.slice(0, 3).join(' | ')}`);
    check('zero uncaught page exceptions', errs.page.length === 0, `${errs.page.length} — ${errs.page.slice(0, 3).join(' | ')}`);
    check('zero failed requests', errs.requests.length === 0, `${errs.requests.length} — ${errs.requests.slice(0, 3).join(' | ')}`);
    evidence.console = errs;

    await ctx.close();
  } catch (err) {
    fails.push(`harness error: ${(err as Error).message}`);
    console.error('HARNESS ERROR', err);
  } finally {
    if (browser) await browser.close().catch(() => {});
  }

  const summary = { base: BASE, passed: pass, failed: fails.length, fails, notes, evidence };
  writeFileSync(path.join(OUT, 'qa-browser-report.json'), JSON.stringify(summary, null, 2));
  console.log('\n' + '─'.repeat(64));
  if (fails.length === 0) console.log(`QA BROWSER CHECKS PASSED — ${pass}`);
  else { console.log(`QA BROWSER CHECKS: ${pass} passed, ${fails.length} failed`); fails.forEach((f) => console.log('   ✗ ' + f)); }
  process.exit(fails.length === 0 ? 0 : 2);
}

main().catch((e) => { console.error('fatal', e); process.exit(1); });
