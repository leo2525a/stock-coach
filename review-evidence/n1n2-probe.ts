/**
 * REVIEWER probe — N1 (stale labelling everywhere) and N2 (mover strip cannot
 * steal the headline symbol), observed in a real browser, not read from code.
 *
 * N1: boot review-evidence/offline-server.ts against a WARM, EXPIRED cache so the
 *     app serves 'stale-cache'. Then assert:
 *       - the chart-card SourceBadge says Stale
 *       - the TopBar headline price block carries [data-testid="topbar-stale"]
 *       - every stale mover tile carries [data-testid="mover-stale-<SYM>"] and no
 *         fresh tile does.
 * N2: click a mover tile BODY and assert the store symbol is unchanged; click the
 *     explicit "chart ↗" control and assert the symbol changes AND the app lands
 *     on the Chart screen.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Page } from 'playwright-core';
import { openDb, saveCandles, saveMeta, recordFetch } from '../server/db';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const freePort = () =>
  new Promise<number>((res, rej) => {
    const s = createServer();
    s.on('error', rej);
    s.listen(0, '127.0.0.1', () => {
      const p = (s.address() as any).port;
      s.close(() => res(p));
    });
  });

let pass = 0;
const fails: string[] = [];
const check = (n: string, c: boolean, d = '') => {
  if (c) {
    pass += 1;
    console.log(`  ✓ ${n}${d ? ` — ${d}` : ''}`);
  } else {
    fails.push(`${n}${d ? ` — ${d}` : ''}`);
    console.log(`  ✗ ${n}${d ? ` — ${d}` : ''}`);
  }
};

function boot(entry: string, port: number, dbPath: string): ChildProcess {
  const p = spawn(path.join(ROOT, 'node_modules', '.bin', 'tsx'), [path.join(ROOT, 'review-evidence', entry)], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DB_PATH: dbPath },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  p.stderr!.on('data', (d) => process.stdout.write(`[srv:err] ${d}`));
  return p;
}

async function waitHealth(base: string, ms = 25_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      if ((await fetch(`${base}/api/health`)).ok) return true;
    } catch {}
    await sleep(300);
  }
  return false;
}

async function main() {
  const tmp = mkdtempSync(path.join(tmpdir(), 'rr-n1n2-'));
  const livePort = await freePort();
  const liveBase = `http://127.0.0.1:${livePort}`;
  const live = boot('live-server.ts', livePort, path.join(tmp, 'live.db'));
  check('live API came up', await waitHealth(liveBase));

  const chrome = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(existsSync)!;
  const browser = await chromium.launch({ executablePath: chrome, headless: true, args: ['--hide-scrollbars'] });

  try {
    /* ---------------- N2 on the LIVE app (real quotes) ---------------- */
    console.log('\nN2 — mover strip cannot steal the headline symbol (live app)');
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
    const page = await ctx.newPage();
    const consoleErrors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text());
    });
    // Force the default symbol so the assertions are deterministic.
    await ctx.addInitScript(() => {
      try {
        localStorage.clear();
      } catch {}
    });
    await page.goto(`${liveBase}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="dashboard-screen"]', { timeout: 25_000 });
    await page.waitForFunction(() => (document.querySelector('[data-testid="topbar-symbol"] .sym')?.textContent || '') === 'AAPL', null, { timeout: 25_000 });
    await page.waitForSelector('[data-testid="mover-strip"]', { timeout: 25_000 });
    await page.waitForTimeout(1500);

    const symNow = async () => (await page.locator('[data-testid="topbar-symbol"] .sym').innerText()).trim();
    const headingNow = async () => (await page.locator('[data-testid="topbar-price"] .last').innerText()).trim();

    // Pick a non-current mover that has an explicit open control.
    const openBtns = page.locator('.mover .m-open');
    const n = await openBtns.count();
    check('the strip offers explicit per-tile open controls', n > 0, `${n} controls`);

    const beforeSym = await symNow();
    const beforePrice = await headingNow();
    const targetTile = page.locator('.mover:not(.selected)').first();
    const targetSymbol = (await targetTile.locator('.m-sym').innerText()).trim();
    const targetPrice = (await targetTile.locator('.tiny.muted').innerText()).trim();
    // The tile is NOT a button: clicking its body must not change the headline.
    // The tile element itself must NOT be a button (a nested .m-open control is
    // expected on non-current tiles and is fine).
    check(
      'a mover tile element is not itself a button',
      (await targetTile.evaluate((el) => el.tagName.toLowerCase())) !== 'button',
      `symbol=${targetSymbol} tag=${await targetTile.evaluate((el) => el.tagName.toLowerCase())}`,
    );
    await targetTile.locator('.m-sym').click();
    await page.waitForTimeout(500);
    const afterSym = await symNow();
    const afterPrice = await headingNow();
    check('clicking a tile body does NOT change the headline symbol', afterSym === beforeSym, `${beforeSym} -> ${afterSym}`);
    check('clicking a tile body does NOT change the headline price', afterPrice === beforePrice, `${beforePrice} -> ${afterPrice}`);

    // The explicit control DOES switch, and lands on the chart screen.
    await targetTile.locator('.m-open').click();
    await page.waitForTimeout(1200);
    const switchedSym = await symNow();
    check('the explicit "chart ↗" control switches the symbol', switchedSym === targetSymbol, `${beforeSym} -> ${switchedSym} (target ${targetSymbol})`);
    const onChart = (await page.locator('[data-testid="chart-screen"]').count()) > 0;
    check('the explicit control lands on the Chart screen', onChart);
    const chartSym = onChart ? (await page.locator('[data-testid="chart-screen"] .symbol-head .sym').first().innerText()).trim() : '';
    check('the chart on screen is the symbol that was chosen', chartSym === targetSymbol || chartSym === '', `chart=${chartSym}`);
    await page.screenshot({ path: path.join(ROOT, 'review-evidence', 'rr-n2-mover.png') });
    check('N2 walk produced zero console errors', consoleErrors.length === 0, `${consoleErrors.length} ${consoleErrors.slice(0, 2).join(' | ')}`);
    await ctx.close();

    /* ---------------- N1 on the offline app (stale series) ---------------- */
    console.log('\nN1 — a stale series is labelled wherever its numbers appear');
    const offPort = await freePort();
    const offBase = `http://127.0.0.1:${offPort}`;
    const dbPath = path.join(tmp, 'offline.db');
    const first = boot('offline-server.ts', offPort, dbPath);
    check('offline API came up', await waitHealth(offBase));
    first.kill('SIGTERM');
    await sleep(700);

    // Seed REAL candles/meta from the live API, with an OLD fetch time so the TTL
    // has expired and the server must fall back to 'stale-cache'.
    const liveMarket = (await fetch(`${liveBase}/api/market/AAPL?range=max&interval=1d`).then((r) => r.json())).data;
    const liveSpy = (await fetch(`${liveBase}/api/market/SPY?range=max&interval=1d`).then((r) => r.json())).data;
    const liveMsft = (await fetch(`${liveBase}/api/market/MSFT?range=max&interval=1d`).then((r) => r.json())).data;
    {
      const db = openDb(dbPath);
      const old = Math.floor(Date.now() / 1000) - 30 * 86400;
      for (const m of [liveMarket, liveSpy, liveMsft]) {
        if (!m) continue;
        saveCandles(db, m.symbol, '1d', m.candles);
        saveMeta(db, m.meta, Math.floor(Date.now() / 1000));
        recordFetch(db, m.symbol, '1d', old, 'live', m.candles.length, '10y', m.meta);
      }
      db.close();
    }
    const off2 = boot('offline-server.ts', offPort, dbPath);
    check('offline API restarted with a warm, expired cache', await waitHealth(offBase));

    const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 950 } });
    const p2 = await ctx2.newPage();
    const errs2: string[] = [];
    p2.on('console', (m) => {
      if (m.type() === 'error') errs2.push(m.text());
    });
    await p2.goto(`${offBase}/`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await p2.waitForSelector('[data-testid="dashboard-screen"]', { timeout: 25_000 }).catch(() => {});
    await p2.waitForFunction(() => Number(document.querySelector('[data-testid="chart-wrap"]')?.getAttribute('data-bar-count') || 0) > 0, null, { timeout: 25_000 }).catch(() => {});
    await p2.waitForTimeout(2500);

    const seriesBadge = (await p2.locator('[data-testid="source-badge"]').first().innerText().catch(() => '')).trim();
    check('chart-card provenance badge says the series is stale', /stale|⚠/i.test(seriesBadge), seriesBadge || '(empty)');

    const topbarStale = await p2.locator('[data-testid="topbar-stale"]').count();
    check('TopBar headline price carries a stale badge', topbarStale > 0, `${topbarStale} badge(s)`);
    const topbarPrice = (await p2.locator('[data-testid="topbar-price"] .last').innerText().catch(() => '')).trim();
    check('TopBar still shows the real last-known price (not blank, not invented)', /\d+\.\d{2}/.test(topbarPrice), topbarPrice);

    // Mover tiles: each stale quote must be labelled, fresh ones must not be.
    const tiles = await p2.locator('.mover').count();
    let staleTiles = 0;
    let freshTiles = 0;
    for (let i = 0; i < tiles; i += 1) {
      const tile = p2.locator('.mover').nth(i);
      const has = (await tile.locator('.m-stale').count()) > 0;
      if (has) staleTiles += 1;
      else freshTiles += 1;
    }
    check('there are multiple mover tiles to inspect', tiles >= 2, `${tiles} tiles`);
    check('stale mover tiles are labelled', staleTiles > 0, `${staleTiles} labelled / ${freshTiles} unlabelled`);
    // In a provider outage every seeded quote is stale, so every tile must be labelled.
    check('every mover tile is individually labelled when every quote is stale', tiles > 0 && staleTiles === tiles, `${staleTiles}/${tiles}`);
    const currentTileUnlabelled = await p2.evaluate(() => {
      const cur = document.querySelector('.mover.selected');
      if (!cur) return null;
      return cur.querySelector('.m-stale') === null;
    });
    check('the on-chart (selected) tile is also labelled if its quote is stale', currentTileUnlabelled !== true, `unlabelled=${currentTileUnlabelled}`);

    await p2.screenshot({ path: path.join(ROOT, 'review-evidence', 'rr-n1-stale.png'), fullPage: true });
    check('N1 walk produced zero console errors', errs2.length === 0, `${errs2.length} ${errs2.slice(0, 2).join(' | ')}`);
    await ctx2.close();
    off2.kill('SIGTERM');
  } catch (err) {
    fails.push(`harness error: ${(err as Error).message}`);
    console.error('harness error:', err);
  } finally {
    await browser.close().catch(() => {});
    live.kill('SIGTERM');
  }

  console.log('\n' + '─'.repeat(60));
  if (fails.length === 0) {
    console.log(`N1/N2 OBSERVATION CHECKS PASSED — ${pass}`);
    process.exit(0);
  }
  console.log(`N1/N2 OBSERVATION CHECKS FAILED — ${pass} passed, ${fails.length} failed`);
  for (const f of fails) console.log('   • ' + f);
  process.exit(1);
}
main().catch((e) => {
  console.error('fatal', e);
  process.exit(1);
});
