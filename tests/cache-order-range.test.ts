/**
 * F-1 / F-2 — two cache-order and range-labelling defects found by independent
 * QA on 2026-11-06, pinned here so they cannot silently return.
 *
 * F-1: `loadSeries` served the WHOLE stored series when the stored range merely
 * *covered* the requested one. Signals caches `range:'max'` (~10 years of daily
 * bars); the ratings panel then asked for `1y` and read `candles[0]`, a
 * decade-old close — the trailing 1-year return became **+1146.88%** instead of
 * **+27.58%**. The contract being wrong is "a caller asking for range X gets
 * range X", so `loadSeries` now windows cache serves too.
 *
 * F-2: `spanRange('3y')` returned `'3y'`, but `RANGE_SECONDS` had no `'3y'` key,
 * so `resolveView` fell through to the interval default (`5y`) — the "3Y" span
 * drew five years of bars.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb, recordFetch, saveCandles, saveMeta, type Db } from '../server/db';
import { loadSeries } from '../server/market-service';
import { RANGE_SECONDS, RANGE_DEFAULT_INTERVAL, resolveView, windowCandles } from '../shared/yahoo';
import { isNoteKey } from '../shared/api-errors';
import { spanRange } from '../shared/fx';
import type { Candle, SymbolMeta } from '../shared/types';

const DAY = 86400;
const NOW = 1_800_000_000; // fixed clock
const TTL_1D = 3600; // `cacheTtlSeconds('1d')` — the freshness window for daily bars

/**
 * A fetch that always fails, as an outage / Yahoo 429 would. `loadSeries`
 * retries transient failures with exponential backoff, so the tests below drive
 * the clock with fake timers instead of sleeping ~5 real seconds per attempt.
 */
const failingFetch: typeof fetch = async () => {
  throw new Error('simulated upstream outage');
};

/** `n` daily candles ending today, oldest at `close=100`, newest at `close=200`. */
function dailyCandles(n: number, now = NOW): Candle[] {
  const out: Candle[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const t = now - i * DAY;
    // A monotonically rising series: the oldest close (100) and newest (200)
    // give a deterministic expected return.
    const close = 100 + ((n - 1 - i) / (n - 1)) * 100;
    out.push({ time: t, open: close, high: close, low: close, close, volume: 1_000_000 });
  }
  return out;
}

const META: SymbolMeta = {
  symbol: 'AAPL',
  name: 'Apple Inc.',
  currency: 'USD',
  exchange: 'NasdaqGS',
  exchangeTimezone: 'America/New_York',
  lastPrice: 200,
  previousClose: 199,
  change: 1,
  changePercent: 0.5,
  dayHigh: 201,
  dayLow: 198,
  fiftyTwoWeekHigh: 210,
  fiftyTwoWeekLow: 150,
  volume: 1_000_000,
  marketTime: 1_800_000_000,
};

/** Seed the cache exactly as a `range:'max'` fetch would have left it. */
function seedMaxCache(db: Db, bars: number, now = NOW): void {
  const candles = dailyCandles(bars, now);
  saveCandles(db, 'AAPL', '1d', candles);
  saveMeta(db, META, now);
  recordFetch(db, 'AAPL', '1d', now, 'live', candles.length, 'max', META);
}

/**
 * Seed the cache and log a fetch that is already PAST its TTL, so the fresh
 * branch is skipped and `loadSeries` falls into the live path — which fails.
 */
function seedStaleMaxCache(db: Db, bars: number, now = NOW): void {
  const candles = dailyCandles(bars, now);
  saveCandles(db, 'AAPL', '1d', candles);
  saveMeta(db, META, now);
  recordFetch(db, 'AAPL', '1d', now - (TTL_1D + 3600), 'live', candles.length, 'max', META);
}

/** Run `loadSeries` against a dead upstream, fast-forwarding the retry backoff. */
async function loadSeriesWithDeadUpstream(
  db: Db,
  opts: Parameters<typeof loadSeries>[2],
): ReturnType<typeof loadSeries> {
  vi.useFakeTimers();
  try {
    const pending = loadSeries(db, 'AAPL', { ...opts, fetchImpl: failingFetch });
    await vi.advanceTimersByTimeAsync(60_000); // flush every retry backoff
    return await pending;
  } finally {
    vi.useRealTimers();
  }
}

let db: Db;
beforeEach(() => {
  db = openDb(':memory:');
});
afterEach(() => {
  db.close();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('F-1 — a caller asking for range X gets range X, whatever is cached', () => {
  it('a request for 1y over a 10y cache returns the 1y window, not the whole decade', async () => {
    seedMaxCache(db, 2513);
    const series = await loadSeries(db, 'AAPL', { range: '1y', interval: '1d', now: NOW });
    expect(series.source).toBe('cache');
    // The window: bars within the last 365 days — nowhere near 2513.
    expect(series.candles.length).toBeLessThan(400);
    expect(series.candles.length).toBeGreaterThan(200);
    // The first bar must be inside the requested window, not a decade ago.
    expect(series.candles[0].time).toBeGreaterThanOrEqual(NOW - RANGE_SECONDS['1y']);
  });

  it('the trailing 1-year return is identical whether a 10y or a 1y series is cached', async () => {
    // Both databases hold the SAME underlying price history; only what was
    // *already cached* differs. Order A cached just the last year; order B
    // cached the whole decade (as Signals leaves behind).
    const full = dailyCandles(2513);
    const lastYear = full.filter((c) => c.time >= NOW - RANGE_SECONDS['1y']);

    const dbA = openDb(':memory:');
    saveCandles(dbA, 'AAPL', '1d', lastYear);
    saveMeta(dbA, META, NOW);
    recordFetch(dbA, 'AAPL', '1d', NOW, 'live', lastYear.length, '1y', META);
    const a = await loadSeries(dbA, 'AAPL', { range: '1y', interval: '1d', now: NOW });
    dbA.close();

    const dbB = openDb(':memory:');
    seedMaxCache(dbB, 2513);
    const b = await loadSeries(dbB, 'AAPL', { range: '1y', interval: '1d', now: NOW });
    dbB.close();

    const ret = (s: Awaited<ReturnType<typeof loadSeries>>) => {
      const first = s.candles[0]?.close ?? null;
      const last = s.candles.at(-1)?.close ?? null;
      return first !== null && last !== null ? (last - first) / Math.abs(first) : null;
    };
    // Same window ⇒ same candles ⇒ same return. (The named defect made these
    // differ wildly: +27.58% vs +1146.88% on the live server.)
    expect(b.candles.length).toBe(a.candles.length);
    expect(ret(b)).toBeCloseTo(ret(a) as number, 9);
  });

  it('the fixed value is the real 1y change, not a decade change', async () => {
    seedMaxCache(db, 2513);
    const series = await loadSeries(db, 'AAPL', { range: '1y', interval: '1d', now: NOW });
    const first = series.candles[0].close;
    const last = series.candles.at(-1)!.close;
    const ret = (last - first) / first;
    // dailyCandles is linear from 100→200 over 2513 bars; the last 365 bars span
    // a small slice of that, so the 1y return must be far below the decade's ~1.0.
    expect(ret).toBeGreaterThan(0);
    expect(ret).toBeLessThan(0.5);
  });

  it('windowCandles leaves the series intact when the range is unknown', () => {
    const candles = dailyCandles(10);
    expect(windowCandles(candles, 'nonsense', NOW)).toHaveLength(10);
  });
});

describe('F-2 — the "3Y" span really is three years', () => {
  it("RANGE_SECONDS has a real '3y' key of three years", () => {
    expect(RANGE_SECONDS['3y']).toBe(3 * 365 * 86400);
  });

  it("resolveView('3y','1w') resolves to a 3y range, never the 5y interval default", () => {
    const view = resolveView('3y', '1w');
    expect(view.range).toBe('3y');
    expect(RANGE_SECONDS[view.range]).toBe(RANGE_SECONDS['3y']);
  });

  it('every span the UI offers resolves to a range it actually names', () => {
    for (const span of ['mtd', '1m', 'qtd', '3m', '6m', 'ytd', '1y', '3y', '5y', '10y'] as const) {
      const range = spanRange(span);
      // 'mtd'/'qtd'/'ytd' are calendar windows resolved elsewhere; the fixed
      // spans must all name a real range.
      if (['mtd', 'qtd', 'ytd'].includes(span)) continue;
      expect(RANGE_SECONDS[range], `span ${span} → range ${range}`).toBeDefined();
      const view = resolveView(range, '1w');
      expect(view.range, `span ${span} resolved to ${view.range}, not ${range}`).toBe(range);
    }
  });

  it('a 3y request does not render 5 years of weekly bars', () => {
    // 5 years of weekly bars is ~260; 3 years is ~156. Assert the resolved
    // window excludes anything older than 3 years.
    const view = resolveView('3y', '1w');
    const now = NOW;
    const fiveYearsWeekly: Candle[] = [];
    for (let w = 260; w >= 0; w--) {
      const t = now - w * 7 * DAY;
      fiveYearsWeekly.push({ time: t, open: 100, high: 100, low: 100, close: 100, volume: 1 });
    }
    const windowed = windowCandles(fiveYearsWeekly, view.range, now);
    expect(windowed.length).toBeLessThan(200);
    expect(windowed[0].time).toBeGreaterThanOrEqual(now - RANGE_SECONDS['3y']);
  });

  it('the 3y range falls back to a daily interval, like its 2y/5y neighbours', () => {
    expect(RANGE_DEFAULT_INTERVAL['3y']).toBe('1d');
  });
});

describe('F-1 (stale branch) — a failed live fetch still honours the requested range', () => {
  it('a stale-cache serve of a 10y cache answers a 1y request with the 1y window', async () => {
    seedStaleMaxCache(db, 2513);
    const series = await loadSeriesWithDeadUpstream(db, { range: '1y', interval: '1d', now: NOW });

    expect(series.source).toBe('stale-cache');
    // The defect: the raw decade cache was returned (2513 bars, oldest bar
    // ~2512 days old), so `candles[0]` was a decade-old close. The contract: a
    // 1y caller gets the 1y window — on EVERY path.
    expect(series.candles.length).toBeLessThan(400);
    expect(series.candles.length).toBeGreaterThan(200);
    expect(series.candles[0].time).toBeGreaterThanOrEqual(NOW - RANGE_SECONDS['1y']);
    expect(NOW - series.candles[0].time).toBeLessThan(RANGE_SECONDS['1y'] + 2 * DAY);

    // The implied trailing-1y return is the real 1y change, never the ~100%
    // decade change the un-windowed serve produced.
    const first = series.candles[0].close;
    const last = series.candles.at(-1)!.close;
    const ret = (last - first) / first;
    expect(ret).toBeGreaterThan(0);
    expect(ret).toBeLessThan(0.5);
  });

  it('the stale-cache 1y serve matches the fresh-cache 1y serve bar for bar', async () => {
    // Same stored history; the ONLY difference is freshness ⇒ the ONLY
    // difference in the answer must be the provenance, never the window.
    const fresh = openDb(':memory:');
    seedMaxCache(fresh, 2513);
    const freshSeries = await loadSeries(fresh, 'AAPL', { range: '1y', interval: '1d', now: NOW });
    fresh.close();

    seedStaleMaxCache(db, 2513);
    const staleSeries = await loadSeriesWithDeadUpstream(db, { range: '1y', interval: '1d', now: NOW });

    expect(freshSeries.source).toBe('cache');
    expect(staleSeries.source).toBe('stale-cache');
    expect(staleSeries.candles).toEqual(freshSeries.candles);
  });

  it('the stale serve carries an honest staleness signal, not just fewer bars', async () => {
    seedStaleMaxCache(db, 2513);
    const series = await loadSeriesWithDeadUpstream(db, { range: '1y', interval: '1d', now: NOW });
    // Provenance the user can act on: `stale-cache` + a localisable note code.
    expect(series.source).toBe('stale-cache');
    expect(series.note).toBe('note.marketLiveFetchFailed');
    // A real note *key*, never raw prose the client would `t()` into a miss.
    expect(isNoteKey(series.note)).toBe(true);
    expect(series.lastUpdated).not.toBeNull();
    expect(series.noteText).toContain('simulated upstream outage');
  });

  it('every served window on the stale path stays within the requested range', async () => {
    // Sweep the ranges the UI offers: none may return bars older than its own
    // cutoff, whatever the (much longer) cache holds.
    for (const range of ['1mo', '3mo', '6mo', '1y', '2y'] as const) {
      const local = openDb(':memory:');
      seedStaleMaxCache(local, 2513);
      const series = await loadSeriesWithDeadUpstream(local, { range, interval: '1d', now: NOW });
      local.close();
      expect(series.source).toBe('stale-cache');
      expect(series.candles[0].time).toBeGreaterThanOrEqual(NOW - RANGE_SECONDS[range]);
    }
  });
});
