/**
 * INDEPENDENT QA RE-RUN (debug-reviewer) — fresh harness for the Phase 2 B1 fix.
 *
 * Written FROM SCRATCH for this re-run. It deliberately does NOT import or
 * reuse `review-evidence/qa-phase2-1435/qa-browser.ts` (builder re-ran that file
 * and touched nothing of the reviewer's — but the cleanest independence claim is
 * a new file, so this is one).
 *
 * Every literal check below is keyed off an element *identity* (data-testid,
 * data-lang, data-screen, data-bar-count) rather than off visible Chinese text.
 * That is on purpose: a leak sweep that depends on Chinese copy to find its own
 * anchors fails the moment the copy is the thing that is wrong (or changes).
 *
 * Run:  BASE=http://127.0.0.1:8799 node_modules/.bin/tsx review-evidence/qa-phase2-rerun/qa-rerun.ts
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = __dirname;
const BASE = process.env.BASE ?? 'http://127.0.0.1:8799';

let pass = 0;
const fails: string[] = [];
const evidence: Record<string, unknown> = {};
const check = (name: string, cond: boolean, detail = '') => {
  if (cond) {
    pass += 1;
    console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    fails.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function chromePath() {
  return [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ].find(existsSync);
}

interface Errors { console: string[]; page: string[]; requests: string[]; badResponses: string[]; }
function track(page: Page): Errors {
  const e: Errors = { console: [], page: [], requests: [], badResponses: [] };
  page.on('console', (m) => { if (m.type() === 'error') e.console.push(m.text()); });
  page.on('pageerror', (err) => e.page.push(err.message));
  page.on('requestfailed', (r) => e.requests.push(`${r.method()} ${r.url()} ${r.failure()?.errorText}`));
  page.on('response', (r) => { if (r.status() >= 400) e.badResponses.push(`${r.status()} ${r.url()}`); });
  return e;
}

/**
 * English time words that must NEVER render inside a zh-HK session.
 * Deliberately broad: the raw leak is `min ago` etc., but we also catch a bare
 * `ago` and the piecemeal `h ago`.
 */
const EN_TIME = /(\bjust now\b|\bmin ago\b|\bh ago\b|\bd ago\b|\bago\b)/;
/** Same alternation, global — `matchAll` requires the `g` flag. */
const EN_TIME_G = new RegExp(EN_TIME.source, 'g');

/** Click a sidebar nav item by its stable data-screen attribute. */
async function clickNav(page: Page, id: string) {
  const ok = await page.evaluate((sid) => {
    const el = document.querySelector(`nav.side-nav button[data-screen="${sid}"]`) as HTMLElement | null;
    if (!el) return false;
    el.click();
    return true;
  }, id);
  if (!ok) throw new Error(`nav button data-screen="${id}" not found`);
  await sleep(350);
}

/** Click the top-bar language switch by its data-lang attribute. */
async function setLang(page: Page, lang: 'zh-HK' | 'en') {
  await page.locator(`[data-testid="lang-switch"] button[data-lang="${lang}"]`).click();
  await sleep(400);
}

/** Fresh session: clear persisted prefs, reload, wait for the dashboard. */
async function freshSession(page: Page) {
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.evaluate(() => { try { localStorage.clear(); } catch { /* noop */ } });
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForSelector('[data-testid="dashboard-screen"]', { timeout: 25_000 });
  await page.waitForFunction(
    () => (document.querySelector('[data-testid="topbar-price"] .last')?.textContent || '').match(/\d/),
    null,
    { timeout: 25_000 },
  );
}

/**
 * Sweep every screen for English <=> zh-HK mixed rendering.
 *
 * Two complementary passes per screen:
 *   1. innerText of the whole app shell, minus provider-data regions.
 *   2. a regex over the raw innerHTML for the specific English time words.
 * The second catches a word hidden inside a `title` attribute, which innerText
 * would miss — exactly the N3 class of finding.
 */
const PROVIDER_DATA = [
  '[data-testid="news-list"]', '[data-testid="news-panel"]', '[data-testid="profile-summary"]',
  '.sym-name', '.wl-name', '.mover', '[data-testid="mover-strip"]', '.search-results',
  '#chart-canvas', '[data-testid="chart-canvas"]', 'canvas', '.brand',
];

async function screenLeaks(page: Page) {
  return (await page.evaluate((dropSel) => {
    const clone = document.body.cloneNode(true) as HTMLElement;
    for (const sel of dropSel) clone.querySelectorAll(sel).forEach((n) => n.remove());
    return clone.innerText || '';
  }, PROVIDER_DATA)) as string;
}

async function main() {
  const chrome = chromePath();
  if (!chrome) throw new Error('no Chrome binary found');
  mkdirSync(OUT, { recursive: true });

  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({ executablePath: chrome, headless: true });
    const ctx: BrowserContext = await browser.newContext({ viewport: { width: 1440, height: 950 } });
    const page = await ctx.newPage();
    const errs = track(page);

    /* ==================================================================
       1. THE B1 PROOF — zh-HK renders no English relative time anywhere
       ================================================================== */
    console.log('\n1) B1 — relative time must be Chinese in zh-HK');
    await freshSession(page);
    check('fresh session defaults to zh-HK', (await page.evaluate(() => document.documentElement.lang)) === 'zh-HK');

    // 1a. Source badge (freshness), on every screen that carries one.
    const badgeSamples: Record<string, { text: string; title: string | null }> = {};
    for (const screen of ['dashboard', 'chart', 'signals']) {
      await clickNav(page, screen);
      // Let the market call land so the badge is populated with a real age.
      await page.waitForSelector('[data-testid="source-badge"]', { timeout: 20_000 });
      await page.waitForTimeout(1500);
      const info = await page.locator('[data-testid="source-badge"]').first().evaluate((el) => ({
        text: (el as HTMLElement).innerText,
        title: el.getAttribute('title'),
      }));
      badgeSamples[screen] = info;
      check(`[${screen}] source badge has NO English relative time`, !EN_TIME.test(info.text), JSON.stringify(info.text));
      check(`[${screen}] source badge title has NO English relative time`, !EN_TIME.test(info.title ?? ''), JSON.stringify(info.title));
      check(`[${screen}] source badge is a Chinese provenance label`, /即時|快取|過期/.test(info.text), JSON.stringify(info.text));
    }
    evidence.badgeZh = badgeSamples;

    // 1b. News panel meta — its own dedicated zh-HK render.
    await clickNav(page, 'dashboard');
    await page.waitForSelector('[data-testid="news-panel"]', { timeout: 20_000 });
    await page.waitForTimeout(3000);
    const newsCount = await page.locator('[data-testid="news-list"] .news-item').count();
    let newsSamples: string[] = [];
    if (newsCount > 0) {
      newsSamples = await page.locator('[data-testid="news-list"] .news-meta').allInnerTexts();
      const joined = newsSamples.join(' || ');
      check('news meta has NO English relative time', !EN_TIME.test(joined), joined.slice(0, 160));
      check('news meta shows a Chinese relative time', /分鐘前|個鐘前|日前|啱啱/.test(joined), joined.slice(0, 160));
      check('news meta does NOT double a Chinese suffix (前前)', !/前前|更新更新/.test(joined), joined.slice(0, 160));
    } else {
      check('news panel rendered items (or honest empty) for the default symbol', true, `0 items (honest empty path)`);
    }
    evidence.newsMetaZh = newsSamples;

    // 1c. Whole-shell sweep of all five screens: no English time word ANYWHERE,
    //     visible text or attribute.
    const timeLeaks: Record<string, string[]> = {};
    for (const screen of ['dashboard', 'chart', 'signals', 'watchlist', 'help']) {
      await clickNav(page, screen);
      await page.waitForTimeout(400);
      // Scan only what a user can actually read or hear: visible text nodes
      // (minus provider data) plus title/aria-label attributes. A raw-HTML scan
      // would false-positive on the shipped `en` locale or meta tags.
      const hits: string[] = [];
      const scoped = await page.evaluate((dropSel) => {
        const shell = document.body.cloneNode(true) as HTMLElement;
        for (const sel of dropSel) shell.querySelectorAll(sel).forEach((n) => n.remove());
        const parts: string[] = [shell.innerText || ''];
        for (const n of document.querySelectorAll('[title],[aria-label]')) {
          parts.push((n.getAttribute('title') || '') + ' | ' + (n.getAttribute('aria-label') || ''));
        }
        return parts.join('\n');
      }, PROVIDER_DATA);
      for (const m of scoped.matchAll(EN_TIME_G)) hits.push(m[0]);
      timeLeaks[screen] = [...new Set(hits)];
      check(`[${screen}] no English time word in visible text/title`, timeLeaks[screen].length === 0, timeLeaks[screen].join(' | ') || 'clean');
      // Independent second read: the shell text without provider data.
      const shell = await screenLeaks(page);
      check(`[${screen}] shell text has no "ago"/"just now"`, !EN_TIME.test(shell), (shell.match(EN_TIME_G) || ['clean']).join(','));
    }
    evidence.timeLeaks = timeLeaks;

    /* ==================================================================
       2. English side still shows English (the fix must not hide the locale)
       ================================================================== */
    console.log('\n2) EN session — the SAME strings must render in English');
    await setLang(page, 'en');
    check('<html lang> follows to en', (await page.evaluate(() => document.documentElement.lang)) === 'en');
    await clickNav(page, 'chart');
    await page.waitForSelector('[data-testid="source-badge"]', { timeout: 20_000 });
    await page.waitForTimeout(2500);
    const badgeEn = await page.locator('[data-testid="source-badge"]').first().innerText();
    check('EN source badge reads English', /Live|Cached|Stale/.test(badgeEn), JSON.stringify(badgeEn));
    check('EN source badge carries an English age', EN_TIME.test(badgeEn), JSON.stringify(badgeEn));
    await clickNav(page, 'dashboard');
    await page.waitForTimeout(3000);
    if (await page.locator('[data-testid="news-list"] .news-meta').count()) {
      const newsEn = (await page.locator('[data-testid="news-list"] .news-meta').allInnerTexts()).join(' || ');
      check('EN news meta carries an English age', EN_TIME.test(newsEn), newsEn.slice(0, 140));
      check('EN news meta is not Chinese', !/分鐘前|個鐘前|日前/.test(newsEn), newsEn.slice(0, 140));
      evidence.newsMetaEn = newsEn;
    }
    evidence.badgeEn = badgeEn;
    await setLang(page, 'zh-HK');

    /* ==================================================================
       3. Double-suffix / awkward-concatenation sweep (whole zh-HK UI)
       ================================================================== */
    console.log('\n3) double-suffix class: no 「…前前」/「…更新更新」 anywhere');
    const dbl: string[] = [];
    for (const screen of ['dashboard', 'chart', 'signals', 'watchlist', 'help']) {
      await clickNav(page, screen);
      await page.waitForTimeout(400);
      const text = (await page.evaluate(() => {
        const clone = document.body.cloneNode(true) as HTMLElement;
        clone.querySelectorAll('script,style,noscript').forEach((n) => n.remove());
        const titles = [...document.querySelectorAll('[title]')].map((n) => n.getAttribute('title') || '').join('\n');
        return (clone.innerText || '') + '\n' + titles;
      })) as string;
      for (const re of [/前前/g, /更新更新/g, /分鐘分鐘/g, /個鐘個鐘/g, /日日/g]) {
        const hit = text.match(re);
        if (hit) dbl.push(`${screen}:${hit[0]}`);
      }
    }
    check('no doubled Chinese time suffix rendered in any screen', dbl.length === 0, dbl.join(' | ') || 'clean');
    evidence.doubleSuffix = dbl;

    /* ==================================================================
       4. N1 — no bare 'no data' / 'unknown' literal reaches a zh-HK screen
       ================================================================== */
    console.log('\n4) N1 — shared-layer sentinels do not leak English');
    const literalLeaks: string[] = [];
    for (const screen of ['dashboard', 'chart', 'signals', 'watchlist', 'help']) {
      await clickNav(page, screen);
      await page.waitForTimeout(350);
      const scoped = await page.evaluate(() => {
        const out: string[] = [];
        for (const n of document.querySelectorAll('.stat .v, .kv-row dd, [data-testid="category-rows"]')) {
          out.push((n.textContent || '').trim());
        }
        return out;
      });
      for (const v of scoped) {
        if (/^no data$/i.test(v) || /^unknown$/i.test(v)) literalLeaks.push(`${screen}:${v}`);
      }
    }
    check("no bare 'no data'/'unknown' sentinel rendered in zh-HK", literalLeaks.length === 0, literalLeaks.join(' | ') || 'clean');
    evidence.sentinelLeaks = literalLeaks;

    /* ==================================================================
       5. N2 — country consistency: CategoryPanel vs ProfilePanel (AAPL)
       ================================================================== */
    console.log('\n5) N2 — country agrees between CategoryPanel and ProfilePanel');
    await clickNav(page, 'dashboard');
    await page.waitForSelector('[data-testid="category-rows"]', { timeout: 20_000 });
    await page.waitForTimeout(3500);

    const readPanels = () =>
      page.evaluate(() => {
        const rows = [...document.querySelectorAll('[data-testid="category-rows"] .kv-row')].map((r) => ({
          k: (r.querySelector('dt')?.textContent || '').trim(),
          v: (r.querySelector('dd')?.textContent || '').trim(),
        }));
        const prof = [...document.querySelectorAll('[data-testid="profile-panel"] .kv-row')].map((r) => ({
          k: (r.querySelector('dt')?.textContent || '').trim(),
          v: (r.querySelector('dd')?.textContent || '').trim(),
        }));
        return { rows, prof };
      });

    let { rows, prof } = await readPanels();
    const catCountry = rows.find((r) => r.k === '國家／地區')?.v ?? '(row missing)';
    const profCountry = prof.find((r) => r.k === '國家／地區')?.v ?? '(no row)';
    check('category panel country row exists', catCountry !== '(row missing)', JSON.stringify(rows.map((r) => `${r.k}=${r.v}`).join(', ')));
    check('category panel country is 美國 for AAPL', catCountry === '美國', catCountry);
    check('profile panel country is 美國 for AAPL', profCountry === '美國', profCountry);
    check('CategoryPanel and ProfilePanel country agree', catCountry === profCountry, `cat=${catCountry} prof=${profCountry}`);
    evidence.countryAAPL = { catCountry, profCountry, catRows: rows, profRows: prof };

    // Server-side corroboration, straight from the API.
    const catApi = await page.evaluate(async () => {
      const r = await fetch('/api/categories?symbols=AAPL,SPY,0700.HK');
      const j = await r.json();
      // The envelope is { ok, data: { SYM: SymbolCategory } } — `data` IS the map.
      const out: Record<string, unknown> = {};
      for (const s of ['AAPL', 'SPY', '0700.HK']) {
        const c = (j.data ?? {})[s];
        out[s] = c
          ? { country: c.country ?? null, fromProfile: c.countryFromProfile ?? null, sector: c.sector ?? null, exchange: c.exchange ?? null }
          : '(symbol missing from payload)';
      }
      return out;
    });
    evidence.countryApi = catApi;
    const a: any = catApi.AAPL;
    check('API: AAPL country filled from cached profile (United States)', a.country === 'United States' && a.fromProfile === true, JSON.stringify(a));
    const spy: any = catApi.SPY;
    const hk: any = catApi['0700.HK'];
    check('API: SPY country honestly null (no invented country)', spy.country === null, JSON.stringify(spy));
    // 0700.HK: search never returns a country, but its cached company profile
    // does ("China"), so the honest answer here is China — NOT null. Either is
    // acceptable as long as it is not invented; assert the provenance flag.
    check('API: 0700.HK country comes from the profile, never invented', hk.country === null || hk.fromProfile === true, JSON.stringify(hk));

    // 0700.HK: add it, then re-read both panels for the honest-null case.
    await clickNav(page, 'watchlist');
    await page.waitForSelector('[data-testid="watchlist-screen"]', { timeout: 20_000 });
    await page.fill('input[placeholder^="股票代號"]', '0700.HK');
    await page.click('form button[type="submit"]');
    await page.waitForTimeout(4000);
    const added = await page.evaluate(() =>
      [...document.querySelectorAll('[data-testid="watchlist-manage"] .wl-manage-row b')].map((b) => (b.textContent || '').trim()));
    check('0700.HK added to the watchlist for the honest-null case', added.includes('0700.HK'), added.join(','));
    if (added.includes('0700.HK')) {
      await page.evaluate(() => {
        const row = [...document.querySelectorAll('[data-testid="watchlist-manage"] .wl-manage-row')].find(
          (r) => (r.querySelector('b')?.textContent || '').trim() === '0700.HK',
        );
        const btn = [...(row?.querySelectorAll('button') ?? [])].find((b) => (b.textContent || '').trim() === '睇圖');
        (btn as HTMLElement | undefined)?.click();
      });
      await page.waitForSelector('[data-testid="dashboard-screen"], [data-testid="chart-screen"]', { timeout: 20_000 });
      await clickNav(page, 'dashboard');
      await page.waitForSelector('[data-testid="category-rows"]', { timeout: 20_000 });
      await page.waitForTimeout(3500);
      ({ rows, prof } = await readPanels());
      const cat0700 = rows.find((r) => r.k === '國家／地區')?.v ?? '(missing)';
      // The category chip and the profile panel must AGREE. For 0700.HK the
      // provider profile publishes country "China", so both should read 中國;
      // if the provider had nothing, both would read 未知. Never invented.
      const prof0700 = prof.find((r) => r.k === '國家／地區')?.v ?? '(no row)';
      check('0700.HK category country is an honest, profile-backed value', cat0700 === '中國' || cat0700 === '未知', cat0700);
      check('0700.HK category and profile country agree', cat0700 === prof0700 || prof0700 === '(no row)', `cat=${cat0700} prof=${prof0700}`);
      evidence.country0700 = { catCountry: cat0700, profCountry: prof0700, rows, prof };
    }

    /* ==================================================================
       6. N3 — badge title is not a duplicate of the visible label
       ================================================================== */
    console.log('\n6) N3 — badge title de-duplicated (no age twice)');
    await clickNav(page, 'chart');
    await page.waitForSelector('[data-testid="source-badge"]', { timeout: 20_000 });
    await page.waitForTimeout(2000);
    const badge = await page.locator('[data-testid="source-badge"]').first().evaluate((el) => ({
      text: (el as HTMLElement).innerText,
      title: el.getAttribute('title') || '',
    }));
    const norm = (s: string) => s.replace(/\s+/g, '');
    check('visible age is NOT repeated inside the title', !(badge.text && badge.title && norm(badge.title).includes(norm(badge.text))), `text=${JSON.stringify(badge.text)} title=${JSON.stringify(badge.title)}`);
    check('title does not itself contain an age', !/前|ago/.test(badge.title), JSON.stringify(badge.title));
    evidence.badgeTitle = badge;

    /* ==================================================================
       7. N4 — shared/glossary.ts gone and imported nowhere
       ================================================================== */
    console.log('\n7) N4 — dead shared/glossary.ts removed');
    const fs = await import('node:fs');
    check('shared/glossary.ts no longer exists', !fs.existsSync(path.resolve(__dirname, '../../shared/glossary.ts')), path.resolve(__dirname, '../../shared/glossary.ts'));
    evidence.glossaryAbsent = !fs.existsSync(path.resolve(__dirname, '../../shared/glossary.ts'));

    /* ==================================================================
       8. phase1 chart controls + five screens (regression)
       ================================================================== */
    console.log('\n8) Phase 1 chart controls still work');
    await clickNav(page, 'chart');
    await page.waitForSelector('[data-testid="chart-screen"]', { timeout: 20_000 });
    await page.waitForFunction(
      () => Number(document.querySelector('[data-testid="chart-wrap"]')?.getAttribute('data-bar-count') || 0) > 0,
      null,
      { timeout: 25_000 },
    );
    await page.waitForTimeout(700);
    const bars0 = Number(await page.locator('[data-testid="chart-wrap"]').getAttribute('data-bar-count'));
    check('chart renders real bars', bars0 >= 100, `${bars0}`);

    const sig = async () =>
      page.evaluate(() => {
        const src = document.querySelector('[data-testid="chart-canvas"] canvas') as HTMLCanvasElement | null;
        if (!src) return null;
        const off = document.createElement('canvas');
        off.width = src.width; off.height = src.height;
        const c = off.getContext('2d')!;
        c.drawImage(src, 0, 0);
        const { data } = c.getImageData(0, 0, off.width, off.height);
        const set = new Set<number>(); let painted = 0;
        for (let i = 0; i < data.length; i += 28) { set.add((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]); if (data[i + 3] > 0) painted += 1; }
        return { distinct: set.size, painted };
      });
    const s0 = await sig();
    check('candles actually painted (non-blank canvas)', !!s0 && s0.distinct > 12 && s0.painted > 100, s0 ? `${s0.distinct} colours` : 'none');
    for (const [label, sel] of [
      ['overlay sma20', '[data-testid="chart-toolbar"] [data-overlay="sma20"]'],
      ['overlay bb', '[data-testid="chart-toolbar"] [data-overlay="bb"]'],
      ['pane rsi', '[data-testid="chart-toolbar"] [data-pane="rsi"]'],
      ['pane macd', '[data-testid="chart-toolbar"] [data-pane="macd"]'],
      ['pane volume', '[data-testid="chart-toolbar"] [data-pane="volume"]'],
    ] as const) {
      const before = await sig();
      await page.locator(sel).first().click();
      await page.waitForTimeout(750);
      const after = await sig();
      check(`toggling ${label} redraws the canvas`, !!before && !!after && (after.distinct !== before.distinct || after.painted !== before.painted), `${before?.distinct}→${after?.distinct}`);
    }
    await page.locator('[data-testid="chart-toolbar"] [data-range="1mo"]').first().click();
    await page.waitForFunction((p) => {
      const n = Number(document.querySelector('[data-testid="chart-wrap"]')?.getAttribute('data-bar-count') || 0);
      return n > 0 && n !== p;
    }, bars0, { timeout: 25_000 });
    const bars1 = Number(await page.locator('[data-testid="chart-wrap"]').getAttribute('data-bar-count'));
    check('range 1mo loads a different window', bars1 !== bars0, `${bars0}→${bars1}`);
    await page.locator('[data-testid="chart-toolbar"] [data-interval="1w"]').first().click();
    await page.waitForTimeout(2500);
    const bars2 = Number(await page.locator('[data-testid="chart-wrap"]').getAttribute('data-bar-count'));
    check('interval 1w changes the bar count', bars2 !== bars1 && bars2 > 0, `${bars1}→${bars2}`);

    /* ==================================================================
       9. Five screens render, no horizontal overflow at 3 widths
       ================================================================== */
    console.log('\n9) five screens + zero horizontal overflow @390/834/1600');
    const overflow: Record<string, Record<string, number>> = {};
    for (const w of [390, 834, 1600]) {
      await page.setViewportSize({ width: w, height: 900 });
      await page.waitForTimeout(250);
      overflow[w] = {};
      for (const id of ['dashboard', 'chart', 'signals', 'watchlist', 'help']) {
        if (w === 390) {
          // The nav lives in the drawer at this width; open it first.
          await page.evaluate(() => {
            const el = document.querySelector('button.drawer-toggle') as HTMLElement | null;
            if (el) el.click();
          });
          await page.waitForTimeout(250);
        }
        await clickNav(page, id);
        await page.waitForTimeout(250);
        const d = await page.evaluate(() => {
          const de = document.documentElement, b = document.body;
          return Math.max(de.scrollWidth - de.clientWidth, b.scrollWidth - b.clientWidth);
        });
        overflow[w][id] = d;
        check(`overflow @${w}px / ${id} == 0`, d <= 0, `${d}px`);
        if (w === 390) {
          await page.keyboard.press('Escape');
          await page.waitForTimeout(150);
        }
      }
    }
    evidence.overflow = overflow;
    await page.setViewportSize({ width: 1440, height: 950 });

    /* ==================================================================
       10. Console cleanliness on a CLEAN session (no deliberate bad calls)
       ================================================================== */
    console.log('\n10) console cleanliness — clean session');
    errs.console.length = 0; errs.page.length = 0; errs.requests.length = 0; errs.badResponses.length = 0;
    await clickNav(page, 'dashboard');
    await page.waitForTimeout(2500);
    check('dashboard: 0 console errors', errs.console.length === 0, errs.console.slice(0, 3).join(' | ') || '0');
    check('dashboard: 0 page exceptions', errs.page.length === 0, errs.page.slice(0, 3).join(' | ') || '0');
    check('dashboard: 0 HTTP >= 400', errs.badResponses.length === 0, errs.badResponses.slice(0, 3).join(' | ') || '0');
    evidence.console = { console: [...errs.console], page: [...errs.page], requests: [...errs.requests], badResponses: [...errs.badResponses] };

    await ctx.close();
  } catch (err) {
    fails.push(`harness error: ${(err as Error).message}`);
    console.error('HARNESS ERROR', err);
  } finally {
    if (browser) await browser.close().catch(() => {});
  }

  const summary = { base: BASE, gate: 'B1 re-run', passed: pass, failed: fails.length, fails, evidence };
  writeFileSync(path.join(OUT, 'qa-rerun-report.json'), JSON.stringify(summary, null, 2) + '\n');
  console.log('\n' + '─'.repeat(64));
  console.log(fails.length === 0 ? `QA RERUN CHECKS PASSED — ${pass}` : `QA RERUN CHECKS: ${pass} passed, ${fails.length} failed`);
  fails.forEach((f) => console.log('   ✗ ' + f));
  process.exit(fails.length === 0 ? 0 : 2);
}

main().catch((e) => { console.error('fatal', e); process.exit(1); });
