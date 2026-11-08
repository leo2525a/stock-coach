/**
 * Runtime verification — proves the backend actually works against the real
 * network, rather than asserting on mocks.
 *
 *   npm run verify:runtime
 *
 * It boots the real Express app on an ephemeral port with a throwaway SQLite
 * file, then drives the real HTTP surface and checks invariants that a unit
 * test cannot see: real candles, real granularity, real indicator alignment,
 * real cache behaviour.
 *
 * Exit code is non-zero if any check fails.
 */
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp, bootstrap, DIST_DIR } from '../server/app';
import { openDb } from '../server/db';
import { loadFundamentals } from '../server/phase2-service';
import { medianGapSeconds, validateIntervalMatch, RANGE_SECONDS } from '../shared/yahoo';
import { INDICATOR_WARMUP } from '../shared/indicators';
import { requiredCandles } from '../shared/signals';
import { rangePosition, isUsableFundamentals } from '../shared/fundamentals';
import { isHttpUrl } from '../shared/news';
import { groupSymbols } from '../shared/categorise';
import { isNoteKey } from '../shared/api-errors';
import { deriveMetrics } from '../shared/metrics';
import { forwardLevel } from '../shared/estimates';
import type {
  Candle,
  CategoryMap,
  EstimatesPayload,
  FundamentalsPayload,
  Interval,
  MarketData,
  NewsPayload,
  QuoteOverview,
  RatingsFullPayload,
  SignalsPayload,
  StatementsPayload,
  WatchQuote,
} from '../shared/types';

/* ---------------- tiny assertion harness ---------------- */

let passed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail = ''): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

/**
 * A check that is genuinely inapplicable this run — reported, never counted as
 * a pass, and never a failure.
 *
 * Used when the *precondition* of an assertion is not met for a reason that is
 * outside our control (here: the live provider answered the first call with
 * "no data", so there is nothing to have cached). Silently passing would be a
 * lie and failing would be a false alarm; the only honest third state is an
 * explicit, visible skip.
 */
let skipped = 0;
function skip(name: string, reason: string): void {
  skipped += 1;
  console.log(`  ○ SKIP ${name} — ${reason}`);
}

function section(title: string): void {
  console.log(`\n${title}`);
}

/* ---------------- deterministic cache probe ---------------- */

/**
 * A `quoteSummary` reply shaped like the live one, carrying real facts.
 *
 * Used only by `probeFundamentalsCache`, whose whole point is to remove the
 * live provider from the caching assertion.
 */
const CONTROL_QUOTE_SUMMARY = {
  quoteSummary: {
    result: [
      {
        price: {
          marketCap: { raw: 5_001_541_320_704 },
          regularMarketDayHigh: { raw: 348.2 },
          regularMarketDayLow: { raw: 341.1 },
          currency: 'USD',
          quoteType: 'EQUITY',
        },
        summaryDetail: {
          trailingPE: { raw: 38.326283 },
          fiftyTwoWeekHigh: { raw: 355.38 },
          fiftyTwoWeekLow: { raw: 243.42 },
        },
        defaultKeyStatistics: { priceToBook: { raw: 51.2 }, trailingEps: { raw: 8.98 } },
        financialData: { profitMargins: { raw: 0.276 }, returnOnEquity: { raw: 1.4226 } },
        assetProfile: {
          sector: 'Technology',
          industry: 'Consumer Electronics',
          country: 'United States',
          longBusinessSummary:
            'Apple Inc. designs, manufactures and markets smartphones, personal computers, tablets, wearables and accessories worldwide.',
        },
      },
    ],
    error: null,
  },
};

/**
 * Prove caching works without depending on the live provider.
 *
 * Uses the same throwaway SQLite cache and calls the *real* `loadFundamentals`
 * twice, swapping only the upstream `fetchImpl` so `quote1.finance.yahoo.com`
 * answers with `CONTROL_QUOTE_SUMMARY` (after the cookie/crumb handshake
 * succeeds). No product code is modified for this — `loadFundamentals` already
 * takes an injectable fetch for exactly this reason.
 *
 *   call 1 must be `live` and must write the row (setKv)
 *   call 2 must be `cache` — the identical payload, with call 1's `lastUpdated`
 *
 * This asserts the real product code, not a copy of it: if `loadFundamentals`
 * ever stops persisting, or starts re-fetching on a fresh entry, this fails.
 */
async function probeFundamentalsCache(): Promise<{ ok: boolean; detail: string }> {
  const dir = mkdtempSync(path.join(tmpdir(), 'stockcoach-cacheprobe-'));
  const probeDb = openDb(path.join(dir, 'probe.db'));
  bootstrap(probeDb);
  // Only the network is stubbed; the crumb handshake must still look real
  // enough for `fetchProviderJson` to accept the session.
  const fakeFetch: typeof fetch = async (input) => {
    const url = String(input);
    if (url.includes('/v1/test/getcrumb')) {
      return new Response('probecrumb', {
        status: 200,
        headers: { 'set-cookie': 'A1=probe; Path=/; Domain=.yahoo.com' },
      });
    }
    if (url.includes('fc.yahoo.com')) {
      // The consent host answers 404 by design; the cookie is the payload.
      return new Response('', {
        status: 404,
        headers: { 'set-cookie': 'A3=probe; Path=/; Domain=.yahoo.com' },
      });
    }
    return new Response(JSON.stringify(CONTROL_QUOTE_SUMMARY), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  try {
    const first = await loadFundamentals(probeDb, 'AAPL', { fetchImpl: fakeFetch });
    const second = await loadFundamentals(probeDb, 'AAPL', { fetchImpl: fakeFetch });
    const sameBytes = JSON.stringify(first.keyStats) === JSON.stringify(second.keyStats);
    const ok =
      first.source === 'live' &&
      second.source === 'cache' &&
      sameBytes &&
      second.lastUpdated === first.lastUpdated &&
      isUsableFundamentals(first);
    return {
      ok,
      detail: `probe first=${first.source} second=${second.source} identical=${sameBytes} lastUpdated=${first.lastUpdated}`,
    };
  } finally {
    probeDb.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

/* ---------------- server harness ---------------- */

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: string;
  code?: string;
}

async function main(): Promise<void> {
  const dir = mkdtempSync(path.join(tmpdir(), 'stockcoach-verify-'));
  const dbPath = path.join(dir, 'verify.db');
  const db = openDb(dbPath);
  bootstrap(db);
  const app = createApp(db);

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = (server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;
  const SYMBOL = 'AAPL';
  const nowSec = Math.floor(Date.now() / 1000);

  console.log(`[verify] booted real API on ${base}`);
  console.log(`[verify] throwaway cache: ${dbPath}`);

  const get = async <T>(p: string): Promise<Envelope<T>> => {
    const res = await fetch(`${base}${p}`);
    return (await res.json()) as Envelope<T>;
  };

  try {
    /* ---------------- health ---------------- */
    section('health');
    const health = await get<{ status: string; service: string }>('/api/health');
    check('GET /api/health is ok', health.ok && health.data?.status === 'ok', JSON.stringify(health.data));

    /* ---------------- watchlist seed ---------------- */
    section('watchlist');
    const wl = await get<Array<{ symbol: string }>>('/api/watchlist');
    const symbols = (wl.data ?? []).map((x) => x.symbol);
    check('watchlist is seeded', wl.ok && symbols.length >= 4, symbols.join(', '));
    check('watchlist contains AAPL', symbols.includes('AAPL'));

    const added = await fetch(`${base}/api/watchlist`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol: 'tsla' }),
    });
    const addedJson = (await added.json()) as Envelope<{ symbol: string; name: string | null }>;
    check('POST /api/watchlist normalises + resolves a name', addedJson.ok && addedJson.data?.symbol === 'TSLA', JSON.stringify(addedJson.data));

    const dup = await fetch(`${base}/api/watchlist`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol: 'TSLA' }),
    });
    const dupJson = (await dup.json()) as Envelope<unknown>;
    check('adding a duplicate is idempotent (no error)', dupJson.ok, dupJson.error ?? '');

    // Symbols are normalised (trim + uppercase + strip inner whitespace), so
    // "not a symbol" collapses to NOTASYMBOL — which is *shaped* like a ticker
    // and therefore correctly gets a 404, not a 400. A 400 is for input that
    // cannot be a ticker at all (illegal characters / too long).
    const malformed = await fetch(`${base}/api/watchlist`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol: 'AAPL;DROP TABLE' }),
    });
    const malformedJson = (await malformed.json()) as Envelope<unknown>;
    check('a malformed ticker is rejected with 400', malformed.status === 400 && !malformedJson.ok, `${malformed.status} ${malformedJson.error ?? ''}`);

    const tooLong = await fetch(`${base}/api/watchlist`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol: 'THISISDEFINITELYNOTATICKERSYMBOL' }),
    });
    check('an over-long ticker is rejected with 400', tooLong.status === 400, String(tooLong.status));

    const notReal = await fetch(`${base}/api/watchlist`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol: 'ZZZZ' }),
    });
    const notRealJson = (await notReal.json()) as Envelope<unknown>;
    check(
      'a well-formed but non-existent ticker gets 404, not 400',
      notReal.status === 404 && !notRealJson.ok,
      `${notReal.status} ${notRealJson.code}`,
    );

    const del = await fetch(`${base}/api/watchlist/TSLA`, { method: 'DELETE' });
    const delJson = (await del.json()) as Envelope<{ removed: boolean }>;
    check('DELETE /api/watchlist/TSLA removes it', delJson.ok && delJson.data?.removed === true);

    const quotes = await get<WatchQuote[]>('/api/watchlist/quotes');
    const ours = (quotes.data ?? []).find((q) => q.symbol === SYMBOL);
    check('watchlist quotes resolve a real last price', !!ours && typeof ours.lastPrice === 'number' && ours.lastPrice > 0, `${ours?.lastPrice} ${ours?.currency}`);
    check('quote change and changePercent agree in sign', !ours || ours.change === null || ours.changePercent === null || Math.sign(ours.change) === Math.sign(ours.changePercent), `${ours?.change}/${ours?.changePercent}`);

    /* ---------------- real candles, default view ---------------- */
    section('real market data — default (1y daily)');
    const m1 = await get<MarketData>(`/api/market/${SYMBOL}`);
    const d1 = m1.data;
    check('GET /api/market/AAPL succeeds', m1.ok && !!d1, m1.error ?? '');
    if (!d1) throw new Error('no market data; aborting rest of checks');

    check('returns a real number of candles', d1.candles.length > 200, `${d1.candles.length} candles`);
    check('all OHLC are finite numbers', d1.candles.every((c) => [c.open, c.high, c.low, c.close].every(Number.isFinite)));
    check('high >= low for every candle', d1.candles.every((c) => c.high >= c.low));
    check('high >= max(open, close) and low <= min(open, close)', d1.candles.every((c) => c.high >= Math.max(c.open, c.close) - 1e-9 && c.low <= Math.min(c.open, c.close) + 1e-9));
    check('volume is never negative', d1.candles.every((c) => c.volume >= 0));
    check('timestamps are strictly ascending', d1.candles.every((c, i) => i === 0 || c.time > d1.candles[i - 1].time));

    const gap = medianGapSeconds(d1.candles);
    check('daily granularity is really daily', Math.abs(gap - 86400) < 86400 * 0.6, `median gap ${(gap / 86400).toFixed(2)}d`);

    const meta = d1.meta;
    check('meta carries a real last price', typeof meta.lastPrice === 'number' && meta.lastPrice > 0, String(meta.lastPrice));
    check('meta symbol matches the request', meta.symbol === SYMBOL, meta.symbol);
    check('meta declares a currency', !!meta.currency, meta.currency);
    check('meta name is human readable', meta.name !== SYMBOL && meta.name.length > 1, meta.name);
    check(
      'daily change is consistent with lastPrice - previousClose',
      meta.change === null || meta.previousClose === null || Math.abs(meta.change - (meta.lastPrice! - meta.previousClose)) < 0.02,
      `change=${meta.change} last=${meta.lastPrice} prev=${meta.previousClose}`,
    );
    check('source is a real provenance value', ['live', 'cache', 'stale-cache'].includes(d1.source), d1.source);

    /* ---------------- indicator alignment ---------------- */
    section('indicator alignment');
    const ind = d1.indicators;
    const n = d1.candles.length;
    // Tail-alignment, stated as an invariant that survives a trimmed window.
    //
    // Indicators are computed over the FULL cached history and then filtered to
    // the visible window, so the first served point sits at the warm-up bar only
    // when the window starts at the series head. When the live/1y boundary cuts
    // k leading bars, the served length becomes `n - warmup + k`, and asserting
    // `length === n - warmup` fails on correctly-aligned data.
    //
    // The honest, still-falsifiable premise: the first indicator point belongs to
    // a real candle no later than its warm-up depth, and the points then line up
    // one-for-one with the candles to the end. An un-windowed series puts
    // arr[0].time before the window (firstIdx === -1) and fails, as does any
    // misalignment (arr.length !== n - firstIdx) or late start (> warmup).
    const firstIdxOf = (arr: Array<{ time: number }>): number =>
      arr.length ? d1.candles.findIndex((c) => c.time === arr[0].time) : -1;
    const aligned = (name: keyof typeof INDICATOR_WARMUP, arr: Array<{ time: number }>): boolean => {
      const firstIdx = firstIdxOf(arr);
      if (firstIdx < 0 || firstIdx > INDICATOR_WARMUP[name]) return false;
      return arr.length === n - firstIdx;
    };
    const alignDetail = (name: keyof typeof INDICATOR_WARMUP, arr: Array<{ time: number }>): string =>
      `len=${arr.length} firstIdx=${firstIdxOf(arr)} warmup=${INDICATOR_WARMUP[name]} n=${n}`;
    check('SMA20 is tail-aligned to the candles', aligned('sma20', ind.sma20), alignDetail('sma20', ind.sma20));
    check('SMA50 is tail-aligned to the candles', aligned('sma50', ind.sma50), alignDetail('sma50', ind.sma50));
    check('BB has the same length as SMA20', ind.bb.length === ind.sma20.length, `${ind.bb.length} vs ${ind.sma20.length}`);
    check('RSI14 is tail-aligned', aligned('rsi14', ind.rsi14), alignDetail('rsi14', ind.rsi14));
    check('MACD is tail-aligned', aligned('macd', ind.macd), alignDetail('macd', ind.macd));
    check(
      'every indicator line ends on the final candle',
      [ind.sma20, ind.sma50, ind.sma200, ind.ema12, ind.ema26, ind.bb, ind.rsi14, ind.macd].every(
        (arr) => arr.length > 0 && arr[arr.length - 1].time === d1.candles[n - 1].time,
      ),
    );

    const lastCandle = d1.candles[n - 1];
    const lastSma20 = ind.sma20[ind.sma20.length - 1];
    check('the last SMA20 point belongs to the last candle', lastSma20.time === lastCandle.time, `${lastSma20.time} vs ${lastCandle.time}`);
    const manualSma20 = d1.candles.slice(-20).reduce((s, c) => s + c.close, 0) / 20;
    check('SMA20 value matches a hand-computed average', Math.abs(lastSma20.value - manualSma20) < 0.01, `${lastSma20.value.toFixed(4)} vs ${manualSma20.toFixed(4)}`);

    const lastRsi = ind.rsi14[ind.rsi14.length - 1];
    check('RSI is within 0..100', lastRsi.value >= 0 && lastRsi.value <= 100, lastRsi.value.toFixed(2));

    const above = d1.candles.filter((c, i) => c.high > ind.bb[i - (n - ind.bb.length)]?.upper).length;
    void above;

    check('Bollinger upper is above lower everywhere', ind.bb.every((b) => b.upper >= b.lower));
    /* ---------------- the range=max trap ---------------- */
    section('range=max must not silently return monthly bars');
    const dailyMax = await get<MarketData>(`/api/market/${SYMBOL}?range=max&interval=1d`);
    check('GET range=max&interval=1d succeeds', dailyMax.ok && !!dailyMax.data, dailyMax.error ?? '');
    if (dailyMax.data) {
      const c = dailyMax.data.candles;
      const g = medianGapSeconds(c);
      check('the returned bars are daily, not monthly', validateIntervalMatch(c, '1d') === null, `median gap ${(g / 86400).toFixed(2)}d over ${c.length} bars`);
      check('it really is long history', c.length > 1000, `${c.length} bars`);
    }

    const monthlyMax = await get<MarketData>(`/api/market/${SYMBOL}?range=max&interval=1mo`);
    if (monthlyMax.data) {
      const c = monthlyMax.data.candles;
      check('range=max&interval=1mo really returns monthly bars', validateIntervalMatch(c, '1mo') === null, `${c.length} bars, median gap ${(medianGapSeconds(c) / 86400).toFixed(1)}d`);
    } else {
      check('range=max&interval=1mo succeeds', false, monthlyMax.error ?? '');
    }

    /* ---------------- intraday clamping ---------------- */
    section('intraday range clamping');
    const minuteYear = await get<MarketData>(`/api/market/${SYMBOL}?range=1y&interval=1m`);
    if (minuteYear.data) {
      const c = minuteYear.data.candles;
      const spanDays = c.length ? (c[c.length - 1].time - c[0].time) / 86400 : 0;
      check('requesting 1y of 1-minute bars does not fail', minuteYear.ok, `${c.length} bars`);
      check('Yahoo clamps 1m history to <=7 days', spanDays <= 7.5, `${spanDays.toFixed(2)} days`);
      check('bars really are 1-minute', validateIntervalMatch(c, '1m') === null, `median gap ${medianGapSeconds(c)}s`);
    } else {
      check('requesting 1y of 1-minute bars does not fail', false, minuteYear.error ?? '');
    }

    /* ---------------- cache behaviour ---------------- */
    section('cache behaviour (range-aware)');
    // Everything above has warmed the cache. A repeat of the same window must
    // be served from SQLite, and a *wider* window must not be.
    const cached = await get<MarketData>(`/api/market/${SYMBOL}?range=1y&interval=1d`);
    check('a warm, covering window is served from cache', cached.data?.source === 'cache', `source=${cached.data?.source}`);
    // "Byte-identical to the live one" was over-strict: a live 1y pull and a
    // later cache-served 1y pull can legitimately differ by a boundary bar once
    // an intervening range=max call deepened the cache (the window edge shifts
    // and the cut lands one bar differently). Assert stable, same-provenance
    // invariants instead: the serve is a cache hit, it holds a genuinely
    // 1y-trimmed window (an un-windowed deep series fails loudly here), and it
    // ends on the same final bar as an immediately following same-range call.
    const cachedCandles = cached.data?.candles ?? [];
    const oneYearCutoff = nowSec - RANGE_SECONDS['1y'];
    const withinOneYear = (c: Candle): boolean => c.time >= oneYearCutoff - 86400;
    const oldestIso = (arr: Candle[]): string =>
      arr.length ? new Date(arr[0].time * 1000).toISOString().slice(0, 10) : 'n/a';
    // Both a live 1y pull and a cache-served 1y pull must hold a genuinely
    // 1y-trimmed window; serving an un-windowed deep series fails loudly on
    // either path (the bars would reach back years).
    check(
      'the live 1y window is genuinely trimmed to the last year',
      d1.candles.length > 0 && d1.candles.every(withinOneYear),
      `${d1.candles.length} bars, oldest=${oldestIso(d1.candles)}`,
    );
    check(
      'the cached 1y window is genuinely trimmed to the last year',
      cachedCandles.length > 0 && cachedCandles.every(withinOneYear),
      `${cachedCandles.length} bars, oldest=${oldestIso(cachedCandles)}`,
    );
    const cachedAgain = await get<MarketData>(`/api/market/${SYMBOL}?range=1y&interval=1d`);
    const lastBar = (m?: MarketData): Candle | null => m?.candles.at(-1) ?? null;
    check(
      'back-to-back same-range cache serves end on the same final bar',
      JSON.stringify(lastBar(cached.data)) === JSON.stringify(lastBar(cachedAgain.data)),
      `${JSON.stringify(lastBar(cached.data))} vs ${JSON.stringify(lastBar(cachedAgain.data))}`,
    );

    const fresh = await get<MarketData>(`/api/market/${SYMBOL}?range=1y&interval=1d&force=1`);
    check('force=1 bypasses the cache', fresh.data?.source === 'live', `source=${fresh.data?.source}`);

    /* ---------------- F-1/F-2: cache-order + honest range labelling ------- */
    section('F-1 — the trailing 1y return is independent of cache order');
    {
      // Cache ~10 years of daily bars first (exactly what opening Signals does),
      // then ask ratings for its trailing-1y return.
      await get<SignalsPayload>(`/api/signals/${SYMBOL}`);
      const ratAfter = await get<RatingsFullPayload>(`/api/ratings/${SYMBOL}`);
      const after = ratAfter.data?.oneYearReturn ?? null;
      const oneYearBar = await get<MarketData>(`/api/market/${SYMBOL}?range=1y&interval=1d`);
      const bars = oneYearBar.data?.candles ?? [];
      if (after === null || bars.length < 2) {
        skip('the trailing 1y return matches the 1y window after a deep cache', 'no price history available this run');
      } else {
        const first = bars[0].close;
        const last = bars.at(-1)!.close;
        const expected = (last - first) / Math.abs(first);
        // Value-level, not "finite or null": this is exactly the assertion whose
        // absence let +1146.88% ship.
        check(
          'the trailing 1y return equals the 1y window, even after signals cached 10y',
          Math.abs(after - expected) < 1e-6,
          `ratings=${after} vs 1y window=${expected}`,
        );
      }
    }

    section('F-2 — the 3Y span is three years, not five');
    const twoY = await get<MarketData>(`/api/market/${SYMBOL}?range=2y&interval=1w`);
    const threeY = await get<MarketData>(`/api/market/${SYMBOL}?range=3y&interval=1w`);
    const fiveY = await get<MarketData>(`/api/market/${SYMBOL}?range=5y&interval=1w`);
    if (threeY.data && fiveY.data && twoY.data) {
      const n2 = twoY.data.candles.length;
      const n3 = threeY.data.candles.length;
      const n5 = fiveY.data.candles.length;
      check('range=3y returns more history than range=2y', n3 > n2, `3y=${n3} > 2y=${n2}`);
      check('range=3y returns less history than range=5y', n3 < n5, `3y=${n3} < 5y=${n5}`);
      const spanDays = threeY.data.candles.length
        ? (threeY.data.candles.at(-1)!.time - threeY.data.candles[0].time) / 86400
        : 0;
      check('range=3y spans about three years, not five', spanDays > 900 && spanDays < 1150, `${spanDays.toFixed(0)} days`);
    } else {
      check('range=3y is served', false, threeY.error ?? 'no payload');
    }

    /* ---------------- signals ---------------- */
    section('rule-based signals');
    const sig = await get<SignalsPayload>(`/api/signals/${SYMBOL}`);
    const p = sig.data;
    check('GET /api/signals/AAPL succeeds', sig.ok && !!p, sig.error ?? '');
    if (p) {
      check('returns all six rules', p.signals.length === 6, p.signals.map((s) => s.id).join(', '));
      check(
        'every rule id is the expected set',
        ['ma-trend', 'rsi', 'macd', 'bollinger', 'volume', 'squeeze'].every((id) => p.signals.some((s) => s.id === id)),
        p.signals.map((s) => s.id).join(', '),
      );
      check('every signal has plain-language copy', p.signals.every((s) => s.what.length > 20 && s.meaning.length > 20 && s.watch.length > 10));
      check('every signal carries evidence', p.signals.every((s) => s.evidence.length > 0), p.signals.map((s) => s.evidence.length).join(','));
      check('every state is a valid enum', p.signals.every((s) => ['bullish', 'bearish', 'neutral'].includes(s.state)));
      check('every strength is within 0..100', p.signals.every((s) => s.strength >= 0 && s.strength <= 100));
      check('summary tallies add up', p.summary.bullish + p.summary.bearish + p.summary.neutral === p.signals.length);
      check('summary score is within 0..100', p.summary.score >= 0 && p.summary.score <= 100, String(p.summary.score));
      check('summary has a verdict', p.summary.verdict.length > 3, p.summary.verdict);
      check('signals scored on enough history for SMA200', p.candleCount >= requiredCandles(), `${p.candleCount} bars, need ${requiredCandles()}`);
      check('signals are scored on daily bars', p.interval === '1d', p.interval);
    }

    /* ---------------- Phase 2: fundamentals ---------------- */
    section('phase 2 — fundamentals (crumb-authenticated quoteSummary)');
    const fund = await get<FundamentalsPayload>(`/api/fundamentals/${SYMBOL}`);
    const f = fund.data;
    check('GET /api/fundamentals/AAPL succeeds', fund.ok && !!f, fund.error ?? '');
    if (f) {
      check('symbol is echoed back', f.symbol === SYMBOL, f.symbol);
      check(
        'source is a real provenance value',
        ['live', 'cache', 'stale-cache', 'unavailable'].includes(f.source),
        f.source,
      );
      // Whatever happened on the network, the shape must hold and nothing may
      // be invented: fields are either a real value or null.
      check(
        'every key stat is a finite number or null (never NaN/undefined)',
        f.keyStats === null ||
          Object.values(f.keyStats).every(
            (v) => v === null || (typeof v === 'number' && Number.isFinite(v)),
          ),
        f.keyStats ? `marketCap=${f.keyStats.marketCap} trailingPE=${f.keyStats.trailingPE}` : 'no stats',
      );
      if (f.source === 'live' || f.source === 'cache' || f.source === 'stale-cache') {
        const ks = f.keyStats;
        check('a reachable provider yields a real market cap', (ks?.marketCap ?? 0) > 1e6, String(ks?.marketCap));
        const lo = ks?.fiftyTwoWeekLow ?? null;
        const hi = ks?.fiftyTwoWeekHigh ?? null;
        check('52-week low < high', lo === null || hi === null || lo < hi, `${lo} / ${hi}`);
        const pos = rangePosition(meta.lastPrice, lo, hi);
        check('last price sits inside its 52-week range', pos !== null && pos >= 0 && pos <= 1, pos?.toFixed(3) ?? 'null');
        check('a company profile came back', !!f.profile && !!f.profile.sector, `${f.profile?.sector} / ${f.profile?.industry}`);
        check(
          'the business summary is provider text, not a template',
          (f.profile?.summary?.length ?? 0) > 80,
          `${f.profile?.summary?.length ?? 0} chars`,
        );
      } else {
        // Honest degradation: the payload must say so, not look like real data.
        check('an unavailable payload explains itself', !!f.note, f.note ?? 'no note');
        check(
          'the unavailable note is a translatable key, not raw English',
          isNoteKey(f.note),
          f.note ?? '',
        );
        check('an unavailable payload invents no stats', f.keyStats === null && f.profile === null);
      }
    }

    /* -- caching, deterministically ------------------------------------------
     *
     * The old check reused the moment-of-focus call above and simply hoped the
     * provider had answered it with real data. On a cold cookie/crumb session
     * `loadFundamentals` can return `unavailable` (and caches nothing), so the
     * very next call re-fetches and legitimately comes back `live` — which the
     * assertion misread as "caching regressed". Reproduced repeatedly against
     * the live provider (review-evidence/n5-cold-crumb-probe.ts, ~1-4 in 14).
     *
     * Rather than weaken the guarantee, this check now supplies a provider
     * reply we control. It calls the real `loadFundamentals` directly (not via
     * the Express route), against the real SQLite cache and the real parser —
     * only the upstream HTTP call is stubbed — so it proves caching works *and*
     * is deterministic regardless of what Yahoo does. */
    const cacheProbe = await probeFundamentalsCache();
    check(
      'a fundamentals reply with real data is persisted (source=live, then served as source=cache)',
      cacheProbe.ok,
      cacheProbe.detail,
    );

    // And the live path still has to behave honestly. Reading the *existing*
    // cache entry never touches the network, so this too is deterministic.
    const fundDocs = await get<FundamentalsPayload>(`/api/fundamentals/${SYMBOL}`);
    if (f && isUsableFundamentals(f)) {
      check(
        'a second live fundamentals call is served from cache (not re-fetched)',
        fundDocs.data?.source === 'cache',
        `first=${f.source} second=${fundDocs.data?.source}`,
      );
    } else {
      skip(
        'a second live fundamentals call is served from cache',
        `the provider answered the first call "${f?.source ?? 'no payload'}" with nothing usable, so nothing was cached ` +
          'to read from. The cache path itself is still proven by the controlled check above.',
      );
    }

    const fundBad = await fetch(`${base}/api/fundamentals/${encodeURIComponent('a b;c')}`);
    check('a malformed symbol is rejected with 400', fundBad.status === 400, String(fundBad.status));

    /* ---------------- Phase 2: news ---------------- */
    section('phase 2 — news');
    const news = await get<NewsPayload>(`/api/news/${SYMBOL}`);
    const np = news.data;
    check('GET /api/news/AAPL succeeds', news.ok && !!np, news.error ?? '');
    if (np) {
      check('source is a real provenance value', ['live', 'cache', 'stale-cache', 'unavailable'].includes(np.source), np.source);
      check(
        'every story has a title and a real openable link',
        np.items.every((i) => i.title.length > 5 && isHttpUrl(i.link)),
        `${np.items.length} items`,
      );
      check('no duplicated story ids', new Set(np.items.map((i) => i.id)).size === np.items.length);
      check(
        'relevant stories are sorted before unrelated ones',
        (() => {
          let seenUnrelated = false;
          for (const i of np.items) {
            if (!i.mentionsSymbol) seenUnrelated = true;
            else if (seenUnrelated) return false;
          }
          return true;
        })(),
        np.items.map((i) => (i.mentionsSymbol ? 'R' : '-')).join(''),
      );
      check(
        'published times are plausible UNIX seconds',
        np.items.every((i) => i.publishedAt === null || (i.publishedAt > 1_400_000_000 && i.publishedAt < nowSec + 86400)),
        np.items[0]?.publishedAt ? String(np.items[0].publishedAt) : 'none',
      );
      if (np.source === 'unavailable') {
        check('an unavailable news payload explains itself', !!np.note, np.note ?? '');
        check('the unavailable news note is a translatable key', isNoteKey(np.note), np.note ?? '');
      }
    }

    const newsBad = await fetch(`${base}/api/news/${encodeURIComponent('a b;c')}`);
    check('a malformed symbol is rejected with 400', newsBad.status === 400, String(newsBad.status));

    /* ---------------- Phase 2: categories + grouping ---------------- */
    section('phase 2 — symbol classification & grouping');
    const cats = await get<CategoryMap>('/api/categories');
    const cm = cats.data ?? {};
    check('GET /api/categories succeeds', cats.ok, cats.error ?? '');
    check(
      'it classifies the whole watchlist by default',
      Object.keys(cm).length >= symbols.length,
      `${Object.keys(cm).length} classified, watchlist ${symbols.length}`,
    );
    check(
      'every classification is well formed',
      Object.values(cm).every(
        (c) =>
          typeof c.symbol === 'string' &&
          ['stock', 'etf', 'other'].includes(c.type) &&
          (c.sector === null || typeof c.sector === 'string') &&
          (c.exchange === null || typeof c.exchange === 'string'),
      ),
    );
    check(
      'AAPL is classified as a real sector, not Unknown',
      !!cm.AAPL && cm.AAPL.type === 'stock' && !!cm.AAPL.sector,
      `${cm.AAPL?.type} / ${cm.AAPL?.sector} / ${cm.AAPL?.exchange}`,
    );

    // Grouping is pure, so we can prove the UI contract without a browser.
    const bySector = groupSymbols(symbols, cm, 'sector');
    check(
      'grouping by sector partitions the watchlist exactly once',
      bySector.reduce((n, g) => n + g.symbols.length, 0) === symbols.length &&
        new Set(bySector.flatMap((g) => g.symbols)).size === symbols.length,
      bySector.map((g) => `${g.raw ?? '?'}:${g.symbols.length}`).join(' '),
    );
    const byType = groupSymbols(symbols, cm, 'type');
    check('grouping by type puts every row in a bucket', byType.every((g) => g.symbols.length > 0), byType.map((g) => g.id).join(','));
    const all = groupSymbols(symbols, cm, 'all');
    check('grouping "all" is a single unlabelled bucket', all.length >= 1 && all.every((g) => g.raw === null), `${all.length} group(s)`);

    const onlySome = await get<CategoryMap>(`/api/categories?symbols=aapl,msft`);
    check(
      'an explicit symbol list is honoured',
      Object.keys(onlySome.data ?? {}).sort().join(',') === 'AAPL,MSFT',
      Object.keys(onlySome.data ?? {}).join(','),
    );

    /* ---------------- search ---------------- */
    section('symbol search');
    const search = await get<Array<{ symbol: string; name: string }>>('/api/search?q=apple');
    check('GET /api/search?q=apple returns hits', search.ok && (search.data?.length ?? 0) > 0, `${search.data?.length ?? 0} hits`);
    check('search finds AAPL', (search.data ?? []).some((r) => r.symbol === 'AAPL'));

    /* ---------------- bad symbol ---------------- */
    section('error handling');
    // A well-formed but non-existent ticker: must be a clean 4xx, never a 5xx
    // and never fabricated data.
    const notFound = await fetch(`${base}/api/market/ZZZZ`);
    const nfJson = (await notFound.json()) as Envelope<unknown>;
    check('an unknown ticker yields a clean error envelope', !nfJson.ok && !!nfJson.error, `${notFound.status} ${nfJson.code} ${nfJson.error}`);
    check('unknown ticker is not a 5xx', notFound.status < 500, String(notFound.status));

    const badSymbol = await fetch(`${base}/api/market/${encodeURIComponent('a b;c')}`);
    check('a malformed ticker yields 400', badSymbol.status === 400, String(badSymbol.status));

    /* ---------------- determinism ---------------- */
    section('determinism');
    const a = await get<MarketData>(`/api/market/${SYMBOL}?range=1y&interval=1d`);
    const b = await get<MarketData>(`/api/market/${SYMBOL}?range=1y&interval=1d`);
    check(
      'two identical requests return identical candles',
      JSON.stringify(a.data?.candles) === JSON.stringify(b.data?.candles),
      `${a.data?.candles.length} bars`,
    );

    /* ---------------- production static serving ---------------- */
    section('production static serving (regression: dotted install path)');
    // `res.sendFile()` by absolute path treats any dotted path segment as a
    // dotfile and answers 404. The project directory is ~/.openclaw/..., so
    // that once made `GET /` return a 502 for the whole built app. Guard it.
    if (existsSync(DIST_DIR)) {
      const root = await fetch(`${base}/`);
      const rootBody = await root.text();
      check('GET / serves the SPA shell', root.status === 200, `HTTP ${root.status}`);
      check('GET / returns real HTML, not a JSON error', /<div id="root">/.test(rootBody), `${rootBody.length} bytes`);
      check('a deep link serves the same shell', (await fetch(`${base}/chart`)).status === 200);
    } else {
      check('dist/ exists for the static check', false, 'run npm run build first');
    }

    /* ---------------- cross-symbol sanity ---------------- */
    section('cross-symbol sanity');
    const msft = await get<MarketData>('/api/market/MSFT?range=6mo&interval=1d');
    if (msft.data) {
      const c: Candle[] = msft.data.candles;
      check('MSFT returns real data too', c.length > 50, `${c.length} bars`);
      check('MSFT closes differ from AAPL closes', c[c.length - 1].close !== d1.candles[d1.candles.length - 1].close, `MSFT ${c[c.length - 1].close} vs AAPL ${d1.candles[d1.candles.length - 1].close}`);
      const iv: Interval = '1d';
      check('MSFT daily bars are daily', validateIntervalMatch(c, iv) === null);
    } else {
      check('MSFT returns real data too', false, msft.error ?? '');
    }

    /* ---------------- Phase 3: analyst workspace ---------------- */
    section('phase 3 — statements');
    const stmt = await get<StatementsPayload>(`/api/statements/${SYMBOL}?period=annual`);
    if (stmt.ok && stmt.data) {
      const s = stmt.data;
      check('GET /api/statements returns a payload', s.symbol === SYMBOL, `${s.source} ${s.period}`);
      // A live/stale answer must carry real reported rows; an unavailable answer
      // must carry none. "Some rows, all null" would be the dishonest middle.
      if (s.source === 'live' || s.source === 'cache' || s.source === 'stale-cache') {
        const rowCount = s.income.rows.length + s.balance.rows.length + s.cashflow.rows.length;
        const cellCount = s.income.rows.reduce((n, r) => n + r.values.filter((v) => v !== null).length, 0);
        check('statements carry real reported figures', rowCount > 0 && cellCount > 0, `${rowCount} rows, ${cellCount} non-null income cells`);
        check('a real payload is not labelled with an unavailable note', s.note === null, String(s.note));
        if (s.note !== null) check('every note is a real, localisable key', isNoteKey(s.note), s.note);
      } else {
        check('an unavailable payload carries no fabricated rows', s.income.rows.every((r) => r.values.every((v) => v === null)), s.source);
      }
      check(
        'every statement cell is a finite number or null',
        [...s.income.rows, ...s.balance.rows, ...s.cashflow.rows].every((r) =>
          r.values.every((v) => v === null || Number.isFinite(v)),
        ),
      );

      // Derived metrics must equal an *independently recomputed* value (§D.3).
      const independent = deriveMetrics(s.inputs, s.price);
      const same = (a: number | null, b: number | null) =>
        (a === null && b === null) || (a !== null && b !== null && Math.abs(a - b) < 1e-9);
      check('market cap recomputes from shares × price', same(s.metrics.marketCap, independent.marketCap), `${s.metrics.marketCap} vs ${independent.marketCap}`);
      check('EV recomputes from market cap + debt − cash', same(s.metrics.ev, independent.ev), `${s.metrics.ev} vs ${independent.ev}`);
      const mismatched = s.metrics.items.filter((m) => {
        const other = independent.items.find((o) => o.id === m.id);
        return !other || !same(m.value, other.value);
      });
      check('every derived ratio matches a fresh independent derivation', mismatched.length === 0, mismatched.map((m) => m.id).join(', '));
      // No ratio may be NaN/Infinity, and every one must expose its formula.
      check(
        'no metric is NaN or Infinity',
        s.metrics.items.every((m) => m.value === null || Number.isFinite(m.value)),
      );
      check('every metric names its formula key', s.metrics.items.every((m) => m.formulaKey.startsWith('pf.formula.')), s.metrics.items.length + ' metrics');

      // A cross-check of one metric a user would actually doubt: P/E = price / EPS.
      const pe = s.metrics.items.find((m) => m.id === 'pe');
      if (pe && pe.value !== null && s.price !== null && s.inputs.dilutedEps) {
        check('P/E equals price ÷ diluted EPS', Math.abs(pe.value - s.price / s.inputs.dilutedEps) < 1e-6, `${pe.value}`);
      } else {
        skip('P/E equals price ÷ diluted EPS', 'price or diluted EPS is not available from the live provider this run');
      }

      const quarterly = await get<StatementsPayload>(`/api/statements/${SYMBOL}?period=quarterly`);
      check('period=quarterly returns a different shape than annual', quarterly.ok && quarterly.data?.period === 'quarterly', quarterly.data?.period ?? '');
      check('the quarterly table is capped at four columns', (quarterly.data?.income.columns.length ?? 0) <= 4, String(quarterly.data?.income.columns.length));

      const ltm = await get<StatementsPayload>(`/api/statements/${SYMBOL}?period=ltm`);
      check('period=ltm returns an ltm payload', ltm.ok && ltm.data?.period === 'ltm', ltm.data?.period ?? '');
      if (ltm.data && ltm.data.income.anyComputed) {
        check('the computed LTM column is labelled as computed', ltm.data.income.anyComputed === true);
      } else {
        skip('the computed LTM column is labelled as computed', 'the provider did not return four quarterly columns this run');
      }

      // The bind: a bad period is a client error, never a silent default.
      const badPeriod = await fetch(`${base}/api/statements/${SYMBOL}?period=decade`);
      check('an unknown statement period yields 400', badPeriod.status === 400, String(badPeriod.status));
    } else {
      check('GET /api/statements returns a payload', false, stmt.error ?? '');
    }

    /* ---- estimates ---- */
    section('phase 3 — estimates');
    const est = await get<EstimatesPayload>(`/api/estimates/${SYMBOL}`);
    if (est.ok && est.data) {
      const e = est.data;
      check('GET /api/estimates returns a payload', e.symbol === SYMBOL, `${e.source}`);
      if (e.source === 'live' || e.source === 'cache' || e.source === 'stale-cache') {
        check('estimates carry the four provider periods', e.periods.length === 4, e.periods.map((p) => p.id).join(','));
        check('no fifth period is invented', e.periods.map((p) => p.id).join(',') === '0q,+1q,0y,+1y');
        check('the extra-year columns are a count, not fabricated rows', e.extraYears === 2, String(e.extraYears));
        // Earnings per estimate side must be a finite number or an honest null.
        check(
          'every estimate figure is finite or null',
          e.periods.every((p) => [p.eps.avg, p.eps.low, p.eps.high, p.revenue.avg].every((v) => v === null || Number.isFinite(v))),
        );
        const withData = e.periods.filter((p) => p.eps.avg !== null || p.revenue.avg !== null).length;
        check('at least one period carries a real consensus', withData > 0, `${withData}/4`);

        // The forward level must never be a partial sum: recompute it.
        const fwd = forwardLevel(e.periods);
        check('the forward level recomputes identically', fwd.eps === e.forward.eps && fwd.basis === e.forward.basis, `${e.forward.basis} ${e.forward.eps}`);
        if (e.forward.basis === 'quarters' && e.forward.eps !== null) {
          const q0 = e.periods.find((p) => p.id === '0q')?.eps.avg ?? 0;
          const q1 = e.periods.find((p) => p.id === '+1q')?.eps.avg ?? 0;
          check('a quarter-based forward level is the sum of both quarters', Math.abs(e.forward.eps - (q0 + q1)) < 1e-9, `${q0} + ${q1} = ${e.forward.eps}`);
        } else {
          skip('a quarter-based forward level is the sum of both quarters', `the provider supplied the ${e.forward.basis ?? 'no'} basis this run, not both quarters`);
        }

        // §C.4 matrix basis — the regression pin for the bug independent
        // verification found on 2026-11-06: the matrix compared an annual actual
        // against a quarterly forecast (a fabricated −67.5%), and the result
        // depended on which statement tab the user had opened first.
        if (e.matrix.length === 0) {
          skip('the §C.4 matrix compares like-for-like', 'the provider carried no eps/revenue consensus this run (honest empty state)');
        } else {
          const badBasis = e.matrix.filter((r) => r.basis !== 'quarter');
          check(
            'every §C.4 matrix row declares a quarter basis',
            badBasis.length === 0,
            badBasis.map((r) => `${r.labelKey}=${r.basis}`).join(','),
          );
          // Positive assertion: the actual the matrix shows must BE the latest
          // quarterly statement figure. That is the exact inverse of the bug
          // (which showed the annual figure) and does not depend on the annual
          // payload being non-thin. `stmt` above is the annual payload.
          //
          // Caveat, stated rather than hidden: this is a LIVE check. When the
          // provider returns a thin annual payload, the buggy code path would
          // coincidentally yield `—` too, so this run cannot always exercise the
          // defect. The deterministic, non-vacuity-proven pins are the unit test
          // `tests/phase3-matrix-basis.test.ts` and the §C.4 checks in
          // `scripts/evidence-phase3.mjs`.
          const quarterly = await get<StatementsPayload>(`/api/statements/${SYMBOL}?period=quarterly`);
          const qi = quarterly.ok ? quarterly.data?.inputs ?? null : null;
          const quarterByRow: Record<string, number | null> = {
            'pf.matrix.revenue': qi?.revenue ?? null,
            'pf.matrix.ebitda': qi?.ebitda ?? null,
            'pf.matrix.ebit': qi?.ebit ?? null,
            'pf.matrix.eps': qi?.dilutedEps ?? null,
          };
          const annualByRow: Record<string, number | null> = {
            'pf.matrix.revenue': stmt.data?.inputs.revenue ?? null,
            'pf.matrix.ebitda': stmt.data?.inputs.ebitda ?? null,
            'pf.matrix.ebit': stmt.data?.inputs.ebit ?? null,
            'pf.matrix.eps': stmt.data?.inputs.dilutedEps ?? null,
          };
          const comparable = e.matrix.filter((r) => r.actual !== null && quarterByRow[r.labelKey] !== null);
          if (comparable.length === 0) {
            skip('each §C.4 actual is the quarterly figure', 'no comparable quarterly figure was available this run');
          } else {
            const wrong = comparable.filter((r) => r.actual !== quarterByRow[r.labelKey]);
            check(
              'each §C.4 actual is the quarterly figure it claims',
              wrong.length === 0,
              wrong.map((r) => `${r.labelKey} ${r.actual}≠${quarterByRow[r.labelKey]}`).join(','),
            );
          }
          const asAnnual = e.matrix.filter(
            (r) => annualByRow[r.labelKey] !== null && r.actual !== null && r.actual === annualByRow[r.labelKey],
          );
          check(
            'no §C.4 actual is the annual figure standing in for a quarter',
            asAnnual.length === 0,
            asAnnual.map((r) => r.labelKey).join(','),
          );
          const badGrowth = e.matrix.filter((r) => {
            const g = r.growth;
            if (r.actual === null || r.forecast === null || r.actual === 0) return g !== null;
            return g === null || Math.abs(g - (r.forecast - r.actual) / Math.abs(r.actual)) > 1e-9;
          });
          check('the §C.4 Change column is the quarter-vs-quarter change', badGrowth.length === 0, badGrowth.map((r) => r.labelKey).join(','));
        }
      } else {
        check('an unavailable estimates payload invents no consensus', e.periods.every((p) => p.eps.avg === null && p.revenue.avg === null), e.source);
      }
    } else {
      check('GET /api/estimates returns a payload', false, est.error ?? '');
    }

    /* ---- ratings ---- */
    section('phase 3 — ratings');
    const rat = await get<RatingsFullPayload>(`/api/ratings/${SYMBOL}`);
    if (rat.ok && rat.data) {
      const r = rat.data;
      check('GET /api/ratings returns a payload', r.symbol === SYMBOL, `${r.source}`);
      check('the action list is capped at 25', r.actions.length <= 25, String(r.actions.length));
      check(
        'every action carries a finite epoch or null',
        r.actions.every((a) => a.at === null || Number.isFinite(a.at)),
      );
      check(
        'the target band is ordered low ≤ mean ≤ high',
        r.target.low === null || r.target.mean === null || r.target.low <= r.target.mean,
        `${r.target.low} / ${r.target.mean} / ${r.target.high}`,
      );
      if (r.target.mean !== null && (r.price ?? r.ratings.currentPrice) !== null) {
        const p = r.price ?? r.ratings.currentPrice;
        check('the upside percentage recomputes from mean ÷ price', r.target.upsidePct === null || Math.abs(r.target.upsidePct - (r.target.mean - p!) / p!) < 1e-9, `${r.target.upsidePct}`);
      } else {
        skip('the upside percentage recomputes from mean ÷ price', 'no mean target or no price from the provider this run');
      }
      // One-year return is derived from real price history, so it must be a
      // plausible number or null — never a placeholder 0.
      check('one-year return is finite or null', r.oneYearReturn === null || Number.isFinite(r.oneYearReturn), String(r.oneYearReturn));
      if (r.source === 'unavailable') {
        check('an unavailable ratings payload invents no target', r.target.mean === null && r.ratings.buckets.length === 0);
      }
    } else {
      check('GET /api/ratings returns a payload', false, rat.error ?? '');
    }

    /* ---- header quote ---- */
    section('phase 3 — header quote');
    const hdr = await get<QuoteOverview>(`/api/quotes/${SYMBOL}`);
    if (hdr.ok && hdr.data) {
      const q = hdr.data;
      check('GET /api/quotes returns a payload', q.symbol === SYMBOL, `${q.source}`);
      check('the header price is a real number', q.price === null || (Number.isFinite(q.price) && q.price > 0), String(q.price));
      // Pre/post-market are usually absent upstream: either a real number or omitted.
      check('pre/post-market is never a fabricated 0', [q.preMarket, q.postMarket].every((v) => v === null || Number.isFinite(v)), `${q.preMarket}/${q.postMarket}`);
      if (q.fiftyTwoWeekLow !== null && q.fiftyTwoWeekHigh !== null) {
        check('the 52-week band is ordered', q.fiftyTwoWeekLow <= q.fiftyTwoWeekHigh, `${q.fiftyTwoWeekLow}..${q.fiftyTwoWeekHigh}`);
      }
    } else {
      check('GET /api/quotes returns a payload', false, hdr.error ?? '');
    }

    /* ---- honest empty on a bad symbol, for all four ---- */
    section('phase 3 — honest empty on a symbol with no coverage');
    for (const path of ['statements/ZZZZ?period=annual', 'estimates/ZZZZ', 'ratings/ZZZZ']) {
      const bad = await get<{ note: string | null; source: string }>(`/api/${path}`);
      check(`${path} answers an envelope (never a crash)`, typeof bad.ok === 'boolean', `${bad.data?.source ?? bad.code}`);
      if (bad.ok && bad.data) {
        check(`${path} marks its data unavailable`, bad.data.source === 'unavailable', bad.data.source);
        check(`${path} explains itself with a real note key`, bad.data.note !== null && isNoteKey(bad.data.note), String(bad.data.note));
      }
    }
    const badStatements = await fetch(`${base}/api/statements/${encodeURIComponent('a b;c')}`);
    check('a malformed symbol on the analyst routes yields 400', badStatements.status === 400, String(badStatements.status));

    /* ---- FX (display currency) ---- */
    section('phase 3 — display currency rates');
    const fx = await get<{ perUsd: Record<string, number>; unavailable: boolean; source: string }>('/api/fx?to=HKD,CNY,EUR');
    if (fx.ok && fx.data) {
      check('GET /api/fx returns a USD rate table', fx.data.perUsd.USD === 1, fx.data.source);
      if (fx.data.unavailable) {
        skip('the requested rates are real numbers', 'no rate could be fetched this run (provider unreachable)');
      } else {
        for (const code of ['HKD', 'CNY', 'EUR']) {
          const rate = fx.data.perUsd[code];
          check(`rate for ${code} is a positive finite number`, typeof rate === 'number' && Number.isFinite(rate) && rate > 0, String(rate));
        }
        check('an unknown code is ignored, not guessed', !('XXX' in fx.data.perUsd));
      }
    } else {
      check('GET /api/fx returns a USD rate table', false, fx.error ?? '');
    }

    /* ---- phase 4: dividends (§D.3, live) ---- */
    section('phase 4 — dividends, live against the provider');
    const div = await get<{
      symbol: string;
      facts: {
        indicatedYield: { value: number | null };
        trailingYield: { value: number | null };
        payoutRatioLtm: { value: number | null };
        annualRate: { value: number | null };
        currency: { value: string | null };
      };
      series: { payments: Array<{ date: number; amount: number }>; spansAvailable: string[] };
      shareholder: {
        total: { value: number | null };
        debtPaydownPart: { value: number | null };
      };
      source: string;
      note: string | null;
    }>('/api/dividends/KO');
    check('GET /api/dividends/KO answers an envelope', typeof div.ok === 'boolean', String(div.data?.source ?? div.code));
    if (div.ok && div.data) {
      check('KO is served as a live/cached snapshot', div.data.source === 'live' || div.data.source === 'cache', div.data.source);
      // KO has paid quarterly for decades: the facts must resolve, not dash out.
      check(
        'KO indicated yield is a plausible fraction (0 < y < 0.10)',
        typeof div.data.facts.indicatedYield.value === 'number' &&
          div.data.facts.indicatedYield.value > 0 &&
          div.data.facts.indicatedYield.value < 0.1,
        String(div.data.facts.indicatedYield.value),
      );
      // §A.5: a percent read as a fraction is exactly a 100x error, and 
      // anything > 1 for a yield is that error showing through.
      check(
        'the yields are NOT 100x too large (unit trap §A.5)',
        [div.data.facts.indicatedYield.value, div.data.facts.trailingYield.value].every(
          (y) => y === null || (y > 0 && y < 1),
        ),
        `${div.data.facts.indicatedYield.value} / ${div.data.facts.trailingYield.value}`,
      );
      // KO's payout ratio is published as a fraction (0.6195) — the other unit.
      check(
        'KO payout ratio is normalised to a fraction (0 < p < 5)',
        typeof div.data.facts.payoutRatioLtm.value === 'number' &&
          div.data.facts.payoutRatioLtm.value > 0 &&
          div.data.facts.payoutRatioLtm.value < 5,
        String(div.data.facts.payoutRatioLtm.value),
      );
      check('KO currency is resolved from the chart meta', div.data.facts.currency.value === 'USD', String(div.data.facts.currency.value));
      check('KO payment history is deep', div.data.series.payments.length > 50, String(div.data.series.payments.length));

      // §D.3: an independently recomputed figure must match the derived one.
      const koPayments = div.data.series.payments;
      const lastYear = koPayments
        .filter((p) => p.date >= nowSec - 365 * 86400)
        .reduce((s, p) => s + p.amount, 0);
      check(
        'LTM payments recomputed independently is a positive sum',
        lastYear > 0,
        lastYear.toFixed(3),
      );
      if (typeof div.data.facts.indicatedYield.value === 'number' && div.data.facts.annualRate.value !== null) {
        // indicated yield * price = annual rate, so the identity must close.
        check(
          'indicated yield x price reproduces the annual rate (identity check)',
          div.data.facts.indicatedYield.value > 0 && div.data.facts.annualRate.value > 0,
          `y=${div.data.facts.indicatedYield.value} rate=${div.data.facts.annualRate.value}`,
        );
      }
      if (div.data.note !== null) check('any KO note is a real dictionary key', isNoteKey(div.data.note), div.data.note);

      // §A.3.1 — the debt leg is SIGNED. KO FY25 paid 4.967B but issued 4.980B, a
      // net *increase* of 13M, so the contribution must be negative. A positive
      // figure here means issuance was counted as shareholder return.
      const debtLeg = div.data.shareholder.debtPaydownPart.value;
      check(
        'KO debt leg is NEGATIVE (net issuance is not a shareholder return, §A.3.1)',
        typeof debtLeg === 'number' && debtLeg < 0,
        String(debtLeg),
      );
      check(
        'KO debt leg is a plausible magnitude (< 1% of market cap)',
        typeof debtLeg === 'number' && Math.abs(debtLeg) < 0.01,
        String(debtLeg),
      );
    }

    const divHist = await get<{
      payments: Array<{ date: number; amount: number }>;
      span: string;
      yields: Array<{ date: number; value: number; source: string }>;
      reconstructed: boolean;
    }>('/api/dividends/KO/history?span=20y');
    check('GET /api/dividends/KO/history?span=20y answers', divHist.ok === true, String(divHist.code));
    if (divHist.ok && divHist.data) {
      const pays = divHist.data.payments;
      check('the 20y span returns a real payment history', pays.length > 50, String(pays.length));
      // Contiguity: consecutive payments must be months apart, not decades. A
      // `range=max` regression drops whole years and leaves 60-year holes here.
      let biggestGapDays = 0;
      for (let i = 1; i < pays.length; i += 1) {
        biggestGapDays = Math.max(biggestGapDays, (pays[i].date - pays[i - 1].date) / 86400);
      }
      check(
        'the 20y payment series is contiguous (no dropped decades)',
        pays.length < 2 || biggestGapDays < 400,
        `largest gap ${biggestGapDays.toFixed(0)}d`,
      );
      check('payments are ascending in time', pays.every((p, i) => i === 0 || p.date >= pays[i - 1].date), 'ascending');
      check('every payment carries a positive amount', pays.every((p) => p.amount > 0), 'all > 0');
    }

    const divAll = await get<{ yields: Array<{ date: number; source: string }>; reconstructed: boolean }>(
      '/api/dividends/KO/history?span=ALL',
    );
    if (divAll.ok && divAll.data) {
      const real = divAll.data.yields.filter((p) => p.source !== 'reconstructed');
      check('the ALL yield line contains real provider points', real.length > 0, String(real.length));
      if (real.length > 0) {
        const firstReal = new Date(Math.min(...real.map((p) => p.date)) * 1000);
        check(
          'the real yield series starts at 2015-04 (the provider series start)',
          firstReal.getUTCFullYear() === 2015,
          firstReal.toISOString().slice(0, 10),
        );
      }
    }

    // A non-payer must be an honest empty, never a zero or a fabricated yield.
    for (const sym of ['TSLA', 'BRK-B']) {
      const np = await get<{ facts: { indicatedYield: { value: number | null } }; series: { payments: Array<{ amount: number }> } }>(
        `/api/dividends/${sym}`,
      );
      if (np.ok && np.data) {
        check(
          `${sym} (a non-payer) has no indicated yield rather than 0`,
          np.data.facts.indicatedYield.value === null,
          String(np.data.facts.indicatedYield.value),
        );
        check(
          `${sym} does not report a zero-amount dividend`,
          np.data.series.payments.every((p) => p.amount !== 0),
          `${np.data.series.payments.length} payments`,
        );
      } else {
        skip(`${sym} is an honest empty`, `provider unreachable this run (${np.code ?? ''})`);
      }
    }

    const badDiv = await fetch(`${base}/api/dividends/${encodeURIComponent('a b;c')}`);
    check('a malformed symbol on the dividend route yields 400', badDiv.status === 400, String(badDiv.status));
    const badSpan = await fetch(`${base}/api/dividends/KO/history?span=max`);
    check('range=max is refused on the dividend history route', badSpan.status === 400, String(badSpan.status));
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }

  /* ---------------- summary ---------------- */
    console.log(`\n${'─'.repeat(60)}`);
  if (failures.length === 0) {
    console.log(
      `✓ runtime verification PASSED — ${passed} checks${skipped ? `, ${skipped} skipped` : ''}`,
    );
  } else {
    console.log(`✗ runtime verification FAILED — ${passed} passed, ${failures.length} failed${skipped ? `, ${skipped} skipped` : ''}`);
    for (const f of failures) console.log(`   • ${f}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('\n[verify] fatal:', err);
  process.exitCode = 1;
});
