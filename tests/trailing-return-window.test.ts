/**
 * F-3 — one residual honesty edge in the trailing-1-year return.
 *
 * F-1 (see `cache-order-range.test.ts`) made `loadSeries` window its cache serves.
 * But `windowCandles` keeps a deliberate escape hatch: when NOTHING falls inside
 * the requested window it returns the input **unfiltered** rather than an empty
 * series — the chart paths must keep drawing an old series instead of erroring.
 *
 * `loadOneYearReturn` read `series.candles[0]` / `series.candles.at(-1)` and
 * trusted that promise. For a symbol whose newest cached bar is already older
 * than `now - 365d` — an extended halt, a delisting, a dead ticker the cache
 * still holds — the escape hatch hands back the WHOLE stored history, so the
 * difference spans a decade and gets presented as the "1-year return" (~+100%
 * on the merged QA repro) on a row that is otherwise honestly flagged
 * `stale-cache`. The provenance was truthful; the number was not.
 *
 * The fix lives at the call site: `loadOneYearReturn` re-windows against the
 * effective `now`, needs two in-window points, and otherwise returns `null`
 * (the row renders its existing `—`). `windowCandles` is deliberately unchanged.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { openDb, recordFetch, saveCandles, saveMeta, type Db } from '../server/db';
import { TTL3, loadRatings } from '../server/phase3-service';
import { growthBetween } from '../shared/estimates';
import { yahooFixture } from './helpers';
import type { Candle, SymbolMeta } from '../shared/types';

const DAY = 86400;
const NOW = 1_800_000_000; // fixed clock — the whole point of the fix is `now`
const TTL_1D = 3600; // `cacheTtlSeconds('1d')`

const fixture = JSON.parse(
  readFileSync(resolve(__dirname, 'fixtures', 'quotesummary-AAPL.json'), 'utf8'),
);

/** A fetch that always fails, as an outage / Yahoo 429 would. */
const failingFetch: typeof fetch = async () => {
  throw new Error('simulated upstream outage');
};

/** A routing fetch double: consent hosts, crumb, quoteSummary and chart. */
function makeFetch(scenario: { quoteSummary?: unknown; chart?: unknown } = {}): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes('/v1/test/getcrumb')) {
      return new Response('abc123.Crumb', {
        status: 200,
        headers: { 'set-cookie': 'A3=crumbcookie; Path=/; Domain=.yahoo.com' },
      });
    }
    if (url.includes('fc.yahoo.com')) {
      return new Response('', { status: 200, headers: { 'set-cookie': 'A1=prime; Path=/; Domain=.yahoo.com' } });
    }
    const body =
      url.includes('/v10/finance/quoteSummary/') ? scenario.quoteSummary
      : url.includes('/v8/finance/chart/') ? scenario.chart
      : undefined;
    // `undefined`/`null` both mean "the provider carries nothing here": a 404,
    // which `fetchYahooChart` surfaces immediately without retry backoff.
    return body === null || body === undefined
      ? new Response('not found', { status: 404 })
      : new Response(JSON.stringify(body), { status: 200 });
  }) as unknown as typeof fetch;
}

/**
 * `n` daily bars ending at `endTime`, closes interpolated linearly from `first`
 * to `last`, so the expected return is arithmetic rather than a magic constant.
 */
function bars(n: number, endTime: number, first: number, last: number): Candle[] {
  const out: Candle[] = [];
  for (let i = 0; i < n; i++) {
    const close = first + ((last - first) * i) / (n - 1);
    out.push({ time: endTime - (n - 1 - i) * DAY, open: close, high: close, low: close, close, volume: 1_000_000 });
  }
  return out;
}

function metaFor(candles: Candle[]): SymbolMeta {
  const lastPrice = candles.at(-1)!.close;
  return {
    symbol: 'AAPL',
    name: 'Apple Inc.',
    currency: 'USD',
    exchange: 'NasdaqGS',
    exchangeTimezone: 'America/New_York',
    lastPrice,
    previousClose: lastPrice,
    change: 0,
    changePercent: 0,
    dayHigh: lastPrice,
    dayLow: lastPrice,
    fiftyTwoWeekHigh: lastPrice * 1.2,
    fiftyTwoWeekLow: lastPrice * 0.8,
    volume: 1_000_000,
    marketTime: candles.at(-1)!.time,
  };
}

/**
 * Seed a STALE daily cache whose newest bar is `ageDays` old. The fetch record
 * is past its TTL, so `loadSeries` tries the live path first and only then falls
 * back here — the provenance under test.
 */
function seedStaleCache(db: Db, candles: Candle[], now = NOW): void {
  saveCandles(db, 'AAPL', '1d', candles);
  saveMeta(db, metaFor(candles), now);
  recordFetch(db, 'AAPL', '1d', now - (TTL_1D + 3600), 'live', candles.length, '1y', metaFor(candles));
}

/** Warm the analyst bundle (live), then let it expire so the serve is `stale-cache`. */
async function primeExpiredBundle(db: Db): Promise<void> {
  const prime = makeFetch({ quoteSummary: fixture });
  const first = await loadRatings(db, 'AAPL', { fetchImpl: prime, now: NOW - (TTL3.analyst + 10) });
  // The bundle is cached; the 1Y return on the *priming* call is irrelevant.
  expect(first.source).toBe('live');
}

/** Run `loadRatings` against a dead upstream, fast-forwarding the retry backoff. */
async function loadRatingsWithDeadUpstream(db: Db, now = NOW): ReturnType<typeof loadRatings> {
  vi.useFakeTimers();
  try {
    const pending = loadRatings(db, 'AAPL', { fetchImpl: failingFetch, now });
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

describe('F-3 — the trailing 1Y return is re-windowed at the call site', () => {
  it('a stale serve whose newest bar is >1y old returns oneYearReturn: null, never the decade change', async () => {
    await primeExpiredBundle(db);
    // A halt/delisting: the cache still holds a decade, but nothing newer than
    // 400 days ago. `windowCandles`' escape hatch lets that whole series
    // through, so the raw `candles[0]` here is ~2500 days old.
    const seeded = bars(2513, NOW - 400 * DAY, 100, 200);
    seedStaleCache(db, seeded);

    // What the old code would have reported: the whole-history change (~+100%),
    // masquerading as a one-year figure.
    const decadeChange = growthBetween(seeded[0].close, seeded.at(-1)!.close);
    expect(decadeChange).toBeCloseTo(1, 2);

    const r = await loadRatingsWithDeadUpstream(db);

    expect(r.source).toBe('stale-cache');
    expect(r.note).toBe('note.ratingsUnreachableCached');
    // The honest answer: fewer than two points inside the last 365 days means
    // there is no 1-year change to report — `—`, not +100%.
    expect(r.oneYearReturn).toBeNull();
    expect(r.oneYearReturn).not.toBeCloseTo(decadeChange as number, 6);
  });

  it('a stale serve with recent bars still returns the true 1Y value (no over-rejection)', async () => {
    await primeExpiredBundle(db);
    // A full year of history whose newest bar is only 5 days old: the cache is
    // stale as *provenance*, but the price history itself still covers the year.
    const seeded = bars(400, NOW - 5 * DAY, 100, 150);
    seedStaleCache(db, seeded);

    const inWindow = seeded.filter((c) => c.time >= NOW - 365 * DAY);
    const expected = growthBetween(inWindow[0].close, inWindow.at(-1)!.close);
    expect(expected).not.toBeNull();

    const r = await loadRatingsWithDeadUpstream(db);

    expect(r.source).toBe('stale-cache');
    expect(r.oneYearReturn).not.toBeNull();
    expect(r.oneYearReturn).toBeCloseTo(expected as number, 10);
    // A sane 1Y figure, not the +50% the full 400-bar series would give.
    expect(r.oneYearReturn! > 0).toBe(true);
    expect(Math.abs(r.oneYearReturn!)).toBeLessThan(1);
  });

  it('a fresh serve still returns the correct 1Y value (no regression)', async () => {
    const live = bars(366, NOW, 150, 195);
    const impl = makeFetch({ quoteSummary: fixture, chart: yahooFixture(live) });

    const r = await loadRatings(db, 'AAPL', { fetchImpl: impl, now: NOW });

    expect(r.source).toBe('live');
    // 150 → 195 over the year = +30%.
    expect(r.oneYearReturn).toBeCloseTo((195 - 150) / 150, 6);
    expect(r.oneYearReturn).toBeCloseTo(growthBetween(150, 195) as number, 10);
  });
});
