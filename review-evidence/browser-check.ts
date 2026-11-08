/**
 * REVIEWER evidence — real-browser, driven end to end.
 * Run: node_modules/.bin/tsx review-evidence/browser-check.ts
 *
 * Independently of the builder's harness this:
 *   1. bites the live build in headless Chrome (self-contained: boots the API
 *      itself via tsx against a throwaway SQLite file),
 *   2. walks all five SPEC §5 screens and asserts each renders,
 *   3. samples the chart <canvas> pixels to prove candles really drew,
 *   4. exercises the chart toggles (SMA/EMA/Bollinger overlays, Volume/RSI/MACD panes),
 *   5. drives the offline/stale path against a second server whose upstream fails,
 *   6. counts console errors / page errors / failed requests on every step.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright-core';
import { openDb, saveCandles, saveMeta, recordFetch } from '../server/db';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'review-evidence');

let pass = 0; const fails: string[] = [];
const check = (n: string, c: boolean, d = '') => {
  if (c) { pass += 1; console.log(`  ✓ ${n}${d ? ` — ${d}` : ''}`); }
  else { fails.push(n); console.log(`  ✗ ${n}${d ? ` — ${d}` : ''}`); }
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const freePort = () => new Promise<number>((res, rej) => {
  const s = createServer(); s.on('error', rej); s.listen(0, '127.0.0.1', () => { const p = (s.address() as any).port; s.close(() => res(p)); });
});

function chromePath() {
  const c = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium'];
  return c.find(existsSync);
}

async function bootServer(entry: string, port: number, dbPath: string): Promise<ChildProcess> {
  const p = spawn(path.join(ROOT, 'node_modules', '.bin', 'tsx'), [path.join(ROOT, 'review-evidence', entry)], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DB_PATH: dbPath },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  p.stdout!.on('data', (d) => process.env.REVIEW_VERBOSE && process.stdout.write(`[srv] ${d}`));
  p.stderr!.on('data', (d) => process.stdout.write(`[srv:err] ${d}`));
  return p;
}

async function waitHealth(base: string, ms = 25_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { const r = await fetch(`${base}/api/health`); if (r.ok) return true; } catch { /* retry */ }
    await sleep(300);
  }
  return false;
}

interface Errors { console: string[]; page: string[]; requests: string[]; }
function track(page: Page): Errors {
  const e: Errors = { console: [], page: [], requests: [] };
  page.on('console', (m) => { if (m.type() === 'error') e.console.push(m.text()); });
  page.on('pageerror', (err) => e.page.push(err.message));
  page.on('requestfailed', (r) => e.requests.push(`${r.method()} ${r.url()} ${r.failure()?.errorText}`));
  return e;
}
// Locale- and viewport-independent navigation: the sidebar button carries
// data-screen, and on narrow screens the sidebar is an off-canvas drawer.
async function clickNav(page: Page, screenId: string) {
  const item = page.locator(`nav.side-nav button[data-screen="${screenId}"]`).first();
  const visible = await item.isVisible().catch(() => false);
  if (visible) {
    await item.click();
  } else {
    await page.locator('button.drawer-toggle').first().click();
    await page.waitForTimeout(350);
    await item.click({ force: true });
    const scrim = page.locator('[data-testid="drawer-scrim"]');
    if (await scrim.count()) await scrim.first().click().catch(() => {});
  }
  await page.waitForTimeout(250);
}
async function canvasStats(page: Page) {
  return page.evaluate(() => {
    const src = document.querySelector('[data-testid="chart-canvas"] canvas') as HTMLCanvasElement | null;
    if (!src) return null;
    const off = document.createElement('canvas'); off.width = src.width; off.height = src.height;
    const ctx = off.getContext('2d')!; ctx.drawImage(src, 0, 0);
    const { data } = ctx.getImageData(0, 0, off.width, off.height);
    const seen = new Set<number>(); let colored = 0;
    for (let i = 0; i < data.length; i += 4 * 13) {
      seen.add((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
      if (data[i + 3] > 0) colored += 1;
    }
    return { distinct: seen.size, colored, w: src.width, h: src.height };
  });
}

async function main() {
  if (!existsSync(path.join(ROOT, 'dist', 'index.html'))) { console.error('run npm run build first'); process.exit(1); }
  mkdirSync(OUT, { recursive: true });
  const tmp = path.join(tmpdir(), `review-browser-${Date.now()}`);
  mkdirSync(tmp, { recursive: true });
  const chrome = chromePath();
  if (!chrome) { console.error('no chrome'); process.exit(1); }

  const livePort = await freePort();
  const liveBase = `http://127.0.0.1:${livePort}`;
  const live = await bootServer('live-server.ts', livePort, path.join(tmp, 'live.db'));
  let browser: Browser | null = null;

  try {
    console.log(`[review] live server ${liveBase}`);
    check('live API came up', await waitHealth(liveBase));

    browser = await chromium.launch({ executablePath: chrome, headless: true });
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
    const page = await ctx.newPage();
    const errs = track(page);

    console.log('\n1) live app — real ticker + real candles');
    const resp = await page.goto(`${liveBase}/`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    check('index served 200', resp?.status() === 200, `HTTP ${resp?.status()}`);
    await page.waitForSelector('[data-testid="dashboard-screen"]', { timeout: 25_000 });
    check('backend-down fallback NOT shown', (await page.locator('[data-testid="backend-down"]').count()) === 0);
    await page.waitForFunction(() => (document.querySelector('[data-testid="topbar-price"] .last')?.textContent || '').match(/\d/), null, { timeout: 25_000 });
    const price = (await page.locator('[data-testid="topbar-price"] .last').innerText()).trim();
    check('a real price is rendered', /\d+\.\d{2}/.test(price), price);
    const badge = (await page.locator('[data-testid="source-badge"]').first().innerText().catch(() => '')).trim();
    check('provenance badge is shown', badge.length > 0, badge);
    await page.screenshot({ path: path.join(OUT, 'r01-dashboard.png'), fullPage: true });

    // --- chart screen: candles + pixel proof ---
    await clickNav(page, 'chart');
    await page.waitForSelector('[data-testid="chart-screen"]', { timeout: 20_000 });
    await page.waitForFunction(() => Number(document.querySelector('[data-testid="chart-wrap"]')?.getAttribute('data-bar-count') || 0) > 0, null, { timeout: 25_000 });
    const bars = Number(await page.locator('[data-testid="chart-wrap"]').getAttribute('data-bar-count'));
    check('chart received real bars', bars >= 100, `${bars} bars`);
    await page.waitForTimeout(500);
    const stats = await canvasStats(page);
    check('chart canvas has real size', !!stats && stats.w > 200 && stats.h > 150, stats ? `${stats.w}x${stats.h}` : 'none');
    check('chart canvas is not blank (candles drawn)', !!stats && stats.distinct > 12 && stats.colored > 200, stats ? `${stats.distinct} colours` : 'none');
    const legend = (await page.locator('[data-testid="ohlc-legend"]').innerText()).trim();
    check('crosshair OHLC legend present at rest', /O\s*\d/.test(legend) && /C\s*\d/.test(legend), legend.replace(/\n/g, ' ').slice(0, 60));
    await page.screenshot({ path: path.join(OUT, 'r02-chart.png') });

    // --- hover the crosshair ---
    const box = await page.locator('[data-testid="chart-canvas"]').boundingBox();
    if (box) { await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.45); await page.waitForTimeout(400); }
    const hovered = (await page.locator('[data-testid="ohlc-legend"]').innerText()).trim();
    check('hovering updates OHLC legend', hovered.length > 0 && hovered !== legend, hovered.slice(0, 60));

    console.log('\n2) chart toggles — overlays + sub-panes');
    // Toggle by stable testid / data-pane attribute, not by visible English copy.
    const toggle = async (sel: string) => { await page.locator(sel).first().click(); await page.waitForTimeout(700); };
    const TOGGLES: Array<[string, string]> = [
      ['sma20', '[data-testid="chart-toolbar"] [data-overlay="sma20"]'],
      ['ema', '[data-testid="chart-toolbar"] [data-overlay="ema"]'],
      ['bollinger', '[data-testid="chart-toolbar"] [data-overlay="bb"]'],
      ['rsi', '[data-testid="chart-toolbar"] [data-pane="rsi"]'],
      ['macd', '[data-testid="chart-toolbar"] [data-pane="macd"]'],
    ];
    for (const [name, sel] of TOGGLES) {
      const before = await canvasStats(page);
      await toggle(sel);
      const after = await canvasStats(page);
      check(`toggling "${name}" redraws the chart`, !!before && !!after && after.distinct !== before.distinct, `${before?.distinct} -> ${after?.distinct}`);
    }
    await page.screenshot({ path: path.join(OUT, 'r03-chart-all-indicators.png'), fullPage: true });

    // --- timeframe switching ---
    const beforeBars = Number(await page.locator('[data-testid="chart-wrap"]').getAttribute('data-bar-count'));
    await page.locator('[data-testid="chart-toolbar"] [data-range="1mo"]').first().click();
    await page.waitForFunction((p) => Number(document.querySelector('[data-testid="chart-wrap"]')?.getAttribute('data-bar-count') || 0) !== p && Number(document.querySelector('[data-testid="chart-wrap"]')?.getAttribute('data-bar-count') || 0) > 0, beforeBars, { timeout: 25_000 });
    const afterBars = Number(await page.locator('[data-testid="chart-wrap"]').getAttribute('data-bar-count'));
    check('timeframe button reloads a different window', afterBars !== beforeBars && afterBars > 0, `${beforeBars} -> ${afterBars}`);

    console.log('\n3) remaining SPEC §5 screens');
    for (const [label, id] of [['signals', 'signals-screen'], ['watchlist', 'watchlist-screen'], ['help', 'help-screen'], ['dashboard', 'dashboard-screen']] as const) {
      await clickNav(page, label);
      const ok = await page.waitForSelector(`[data-testid="${id}"]`, { timeout: 20_000 }).then(() => true).catch(() => false);
      check(`${label} screen renders`, ok, id);
      if (label === 'signals') {
        const cards = await page.locator('[data-testid^="signal-"]').count();
        check('signals screen shows all six rule cards', cards >= 6, `${cards}`);
        await page.locator('details.evidence-toggle').first().click().catch(() => {});
        const ev = (await page.locator('details.evidence-toggle').first().innerText()).trim();
        check('signal card exposes the numbers behind it', /(\+|-)?\d/.test(ev), ev.replace(/\n/g, ' ').slice(0, 60));
        await page.screenshot({ path: path.join(OUT, 'r04-signals.png'), fullPage: true });
      }
      if (label === 'watchlist') await page.screenshot({ path: path.join(OUT, 'r05-watchlist.png'), fullPage: true });
      if (label === 'help') {
        const rows = await page.locator('[data-testid="glossary"] .glossary-row').count();
        check('help glossary teaches the jargon', rows >= 5, `${rows} entries`);
        await page.screenshot({ path: path.join(OUT, 'r06-help.png'), fullPage: true });
      }
    }

    console.log('\n4) console cleanliness (live session)');
    check('zero console errors (live)', errs.console.length === 0, `${errs.console.length} — ${errs.console.slice(0, 3).join(' | ')}`);
    check('zero page exceptions (live)', errs.page.length === 0, `${errs.page.length}`);
    check('zero failed requests (live)', errs.requests.length === 0, `${errs.requests.length} — ${errs.requests.slice(0, 3).join(' | ')}`);
    await ctx.close();

    /* ------------------------------------------------------------------ */
    console.log('\n5) OFFLINE provider — SPEC §7 stale behaviour');
    const offPort = await freePort();
    const offBase = `http://127.0.0.1:${offPort}`;
    const off = await bootServer('offline-server.ts', offPort, path.join(tmp, 'offline.db'));
    check('offline API came up', await waitHealth(offBase));

    const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const p2 = await ctx2.newPage();
    const errs2 = track(p2);
    // First load: the watchlist seeds but every price source fails.
    await p2.goto(`${offBase}/`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await p2.waitForSelector('[data-testid="dashboard-screen"]', { timeout: 25_000 }).catch(() => {});
    await p2.waitForTimeout(3500);
    // The app ships zh-HK by default, so accept the honest-message copy in either language.
    const emptyMsg = await p2
      .locator('text=/No price data|Could not load|未有價格資料|連接唔到|暫時未有|無法載入/i')
      .first()
      .innerText()
      .catch(() => '');
    const dashboardShown = (await p2.locator('[data-testid="dashboard-screen"]').count()) > 0;
    check('offline: app shell still renders (no crash/blank page)', dashboardShown, `dashboard=${dashboardShown}`);
    check('offline: user is told the data is unavailable (honest message)', emptyMsg.length > 0, emptyMsg.slice(0, 80));
    const invented = await p2.evaluate(() => {
      const t = document.body.innerText;
      // A fabricated price would appear as a bare decimal; with no data we expect "no data".
      return { hasNoData: /no data/i.test(t), hasDecimalPrice: /\b\d{2,4}\.\d{2}\b/.test(t) };
    });
    check('offline: no invented price shown on first-ever load', !invented.hasDecimalPrice || invented.hasNoData, JSON.stringify(invented));
    await p2.screenshot({ path: path.join(OUT, 'r07-offline-firstload.png'), fullPage: true });

    console.log('\n6) OFFLINE provider — cached data + stale badge');
    // Seed the offline server's SQLite with REAL candles+meta fetched from the
    // live API, so the offline UI has genuine last-known data to fall back to.
    off.kill('SIGTERM');
    await sleep(700);
    const liveMarket = (await fetch(`${liveBase}/api/market/AAPL?range=max&interval=1d`).then((r) => r.json())).data;
    {
      const seedDb = openDb(path.join(tmp, 'offline.db'));
      saveCandles(seedDb, 'AAPL', '1d', liveMarket.candles);
      saveMeta(seedDb, liveMarket.meta, Math.floor(Date.now() / 1000));
      // Seed an OLD fetch timestamp so the cache TTL has expired. That forces the
      // server to attempt a live pull (which fails) and therefore serve
      // 'stale-cache' — the exact SPEC §7 path we want to exercise.
      recordFetch(seedDb, 'AAPL', '1d', Math.floor(Date.now() / 1000) - 30 * 86400, 'live', liveMarket.candles.length, '10y', liveMarket.meta);
      seedDb.close();
    }
    const off2 = await bootServer('offline-server.ts', offPort, path.join(tmp, 'offline.db'));
    check('offline API restarted with a warm cache', await waitHealth(offBase));
    await p2.goto(`${offBase}/`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await p2.waitForSelector('[data-testid="dashboard-screen"]', { timeout: 25_000 }).catch(() => {});
    await p2.waitForTimeout(3500);
    const badge2 = (await p2.locator('[data-testid="source-badge"]').first().innerText().catch(() => '')).trim();
    check('offline+warm cache: stale badge is shown', /stale|⚠/i.test(badge2), badge2 || '(empty)');
    const bars2 = await p2.locator('[data-testid="chart-wrap"]').count();
    const price2 = (await p2.locator('[data-testid="topbar-price"] .last').innerText().catch(() => '')).trim();
    check('offline+warm cache: last known price still shown (not blank)', /\d+\.\d{2}/.test(price2), price2);
    check('offline+warm cache: chart host still mounted', bars2 > 0, `${bars2}`);
    await p2.screenshot({ path: path.join(OUT, 'r08-offline-cached-stale.png'), fullPage: true });
    check('offline session had zero page exceptions', errs2.page.length === 0, errs2.page.join(' | '));
    await ctx2.close();
    off2.kill('SIGTERM');
  } catch (err) {
    fails.push(`harness error: ${(err as Error).message}`);
    console.error('harness error:', err);
  } finally {
    if (browser) await browser.close().catch(() => {});
    live.kill('SIGTERM');
    await sleep(400);
    rmSync(tmp, { recursive: true, force: true });
  }

  console.log('\n' + '─'.repeat(60));
  if (fails.length === 0) { console.log(`REVIEWER BROWSER CHECKS PASSED — ${pass}`); process.exit(0); }
  else { console.log(`REVIEWER BROWSER CHECKS FAILED — ${pass} passed, ${fails.length} failed`); for (const f of fails) console.log('   • ' + f); process.exit(1); }
}
main().catch((e) => { console.error('fatal', e); process.exit(1); });
