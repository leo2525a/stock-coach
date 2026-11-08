import type {
  Candle,
  DataSource,
  IndicatorSeries,
  Interval,
  MarketData,
  SymbolMeta,
} from '../shared/types';
import {
  YAHOO_INTERVAL,
  parseCandles,
  parseMeta,
  hasUsableData,
  resolveView,
  validateIntervalMatch,
  windowCandles,
  RANGE_SECONDS,
} from '../shared/yahoo';
import { computeIndicators } from '../shared/indicators';
import type { Db } from './db';
import {
  countCandles,
  getCandles,
  getFetchRecord,
  getMeta,
  recordFetch,
  saveCandles,
  saveMeta,
} from './db';

const YAHOO_HOST = 'https://query1.finance.yahoo.com';
const REQUEST_TIMEOUT_MS = 12_000;

/**
 * User-Agent policy (verified against the live endpoint, 2026-11-06):
 * Yahoo's edge returns **HTTP 429** for a verbose, full browser User-Agent
 * string, but serves **HTTP 200** for the short `Mozilla/5.0` token. This is
 * counter-intuitive but reproducible, so we keep the short token and never
 * "improve" it into a fake full Chrome string.
 */
export const YAHOO_USER_AGENT = 'Mozilla/5.0';

/** Retry policy for transient upstream throttling / network blips. */
const MAX_ATTEMPTS = 4;
const BASE_BACKOFF_MS = 700;

export class MarketDataError extends Error {
  code: string;
  constructor(message: string, code = 'MARKET_DATA_ERROR') {
    super(message);
    this.name = 'MarketDataError';
    this.code = code;
  }
}

/** How long a cached series is considered "fresh enough" before re-hitting Yahoo. */
export function cacheTtlSeconds(interval: Interval): number {
  switch (interval) {
    case '1m':
      return 60;
    case '5m':
      return 120;
    case '15m':
      return 300;
    case '1h':
      return 900;
    case '1d':
      return 3600;
    case '1w':
      return 6 * 3600;
    case '1mo':
      return 12 * 3600;
    default:
      return 3600;
  }
}

export function yahooChartUrl(symbol: string, interval: Interval, range: string): string {
  const params = new URLSearchParams({
    range,
    interval: YAHOO_INTERVAL[interval],
    includePrePost: 'false',
    events: 'div,split',
  });
  return `${YAHOO_HOST}/v8/finance/chart/${encodeURIComponent(symbol)}?${params.toString()}`;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Fetch the raw Yahoo chart payload, retrying transient 429/5xx responses with
 * exponential backoff. Retrying ourselves is what keeps the first paint honest:
 * a hiccup becomes a slightly slower live load rather than an instant stale badge.
 *
 * `fetchImpl` is injectable so tests can drive the retry logic deterministically.
 */
export async function fetchYahooChart(
  symbol: string,
  interval: Interval,
  range: string,
  fetchImpl: typeof fetch = fetch,
): Promise<unknown> {
  const url = yahooChartUrl(symbol, interval, range);
  let lastError: MarketDataError | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetchImpl(url, {
        headers: { 'User-Agent': YAHOO_USER_AGENT, Accept: 'application/json' },
        signal: controller.signal,
      });

      if (res.ok) return (await res.json()) as unknown;

      const retryable = res.status === 429 || res.status >= 500;
      lastError = new MarketDataError(
        `Yahoo responded with HTTP ${res.status} for ${symbol}`,
        res.status === 404 ? 'NOT_FOUND' : 'UPSTREAM_HTTP_ERROR',
      );
      if (!retryable || attempt === MAX_ATTEMPTS) throw lastError;
    } catch (err) {
      if (err instanceof MarketDataError) {
        if (err.code === 'NOT_FOUND') throw err;
        lastError = err;
      } else {
        const reason = err instanceof Error ? err.message : String(err);
        lastError = new MarketDataError(
          `Could not reach Yahoo Finance for ${symbol}: ${reason}`,
          'UPSTREAM_UNREACHABLE',
        );
      }
      if (attempt === MAX_ATTEMPTS) throw lastError;
    } finally {
      clearTimeout(timer);
    }

    // Exponential backoff with jitter, honouring Retry-After when present.
    await sleep(BASE_BACKOFF_MS * 2 ** (attempt - 1) + Math.random() * 250);
  }

  throw lastError ?? new MarketDataError(`Could not fetch ${symbol}`, 'UPSTREAM_UNREACHABLE');
}

export interface SeriesLoad {
  symbol: string;
  interval: Interval;
  range: string;
  candles: Candle[];
  meta: SymbolMeta;
  source: DataSource;
  lastUpdated: number | null;
  /** Translation key for the UI (see `shared/api-errors.ts` NOTE_KEYS). */
  note: string | null;
  /** English detail for logs only; never rendered. */
  noteText?: string | null;
}

interface LoadOptions {
  range?: string | null;
  interval?: string | null;
  /** Bypass the freshness check and force an upstream pull. */
  force?: boolean;
  /**
   * Minimum bars the caller can meaningfully use. If a cached series is shorter
   * than this (e.g. a 6-month chart cached 128 daily bars, but the signal rules
   * need SMA200), the cache is skipped and a deeper range is pulled instead.
   * Without this, signals could silently degrade just because the user opened a
   * short chart first.
   */
  minCandles?: number;
  /** Override the clock (tests). */
  now?: number;
  fetchImpl?: typeof fetch;
}

/**
 * Load a candle series for a symbol, preferring fresh cache and falling back to
 * the last cached data (clearly labelled) when the network is unavailable.
 */
export async function loadSeries(db: Db, rawSymbol: string, opts: LoadOptions = {}): Promise<SeriesLoad> {
  const symbol = rawSymbol.trim().toUpperCase();
  if (!symbol) throw new MarketDataError('A symbol is required', 'BAD_REQUEST');

  const view = resolveView(opts.range, opts.interval);
  const now = opts.now ?? Math.floor(Date.now() / 1000);

  const record = getFetchRecord(db, symbol, view.interval);
  const cachedCount = countCandles(db, symbol, view.interval);
  const ttl = cacheTtlSeconds(view.interval);
  const needed = opts.minCandles ?? 2;
  // Range coverage: only serve from cache when the window we stored *fully
  // contains* the one being asked for.
  //
  // This compares the calendar span of the stored range against the requested
  // range, rather than estimating days from the row count. Row-count maths is
  // wrong for any interval whose bars are not one per calendar day: a week of
  // 5-minute bars and a month of daily bars can hold the same number of rows
  // while covering wildly different windows.
  const storedRangeSeconds = record?.range ? RANGE_SECONDS[record.range] ?? 0 : 0;
  const requestedRangeSeconds = RANGE_SECONDS[view.range] ?? 0;
  const rangeCovered = storedRangeSeconds >= requestedRangeSeconds * 0.95;
  const cacheIsFresh =
    record !== null && cachedCount >= needed && rangeCovered && now - record.lastUpdated <= ttl;

  if (!opts.force && cacheIsFresh) {
    // The cache may hold a LONGER series than was asked for (e.g. Signals cached
    // `range:'max'`, then the ratings panel asks for `1y`). Serving the raw rows
    // would hand the caller ~10 years of bars for a 1-year request — the chart
    // path trimmed, but direct `loadSeries` callers did not, so the trailing-1y
    // return read a decade-old close. A caller asking for range X gets range X:
    // trim here so every caller (chart, signals, ratings) sees the same window.
    const all = getCandles(db, symbol, view.interval);
    const candles = windowCandles(all, view.range, now);
    const meta = getMeta(db, symbol);
    if (hasUsableData(candles) && meta) {
      return {
        symbol,
        interval: view.interval,
        range: view.range,
        candles,
        meta,
        source: 'cache',
        lastUpdated: record.lastUpdated,
        note: null,
      };
    }
  }

  // Try the live path.
  try {
    const json = await fetchYahooChart(symbol, view.interval, view.range, opts.fetchImpl);
    const candles = parseCandles(json);
    if (!hasUsableData(candles)) {
      throw new MarketDataError(`Yahoo returned no usable candles for ${symbol}`, 'NO_DATA');
    }
    // Never let silently-wrong granularity poison the cache or the indicators.
    const mismatch = validateIntervalMatch(candles, view.interval);
    if (mismatch) {
      throw new MarketDataError(`${mismatch} (symbol ${symbol}).`, 'INTERVAL_MISMATCH');
    }
    const meta = parseMeta(json, symbol);
    saveCandles(db, symbol, view.interval, candles);
    saveMeta(db, meta, now);
    recordFetch(db, symbol, view.interval, now, 'live', candles.length, view.range, meta);
    return {
      symbol,
      interval: view.interval,
      range: view.range,
      candles,
      meta,
      source: 'live',
      lastUpdated: now,
      note: null,
    };
  } catch (err) {
    // Live failed: fall back to whatever we have, clearly marked stale.
    //
    // The same "a caller asking for range X gets range X" contract as the
    // fresh-cache branch above applies here: the cache may hold a much longer
    // series than was asked for (Signals caches `range:'max'`, the ratings
    // panel asks for `1y`), so an un-windowed serve would hand a 1y caller ~10
    // years of bars and make `candles[0]` a decade-old close. Window it exactly
    // like the fresh path so no branch ever returns a window wider than asked.
    const cached = getCandles(db, symbol, view.interval);
    const candles = windowCandles(cached, view.range, now);
    const meta = getMeta(db, symbol);
    if (hasUsableData(candles) && meta) {
      const reason = err instanceof Error ? err.message : String(err);
      recordFetch(db, symbol, view.interval, record?.lastUpdated ?? 0, 'stale-cache', cached.length, record?.range ?? null);
      return {
        symbol,
        interval: view.interval,
        range: view.range,
        candles,
        meta,
        source: 'stale-cache',
        lastUpdated: record?.lastUpdated ?? null,
        // The UI localises the code; `reason` stays in `noteText` for logs.
        note: 'note.marketLiveFetchFailed',
        noteText: reason,
      };
    }
    // Nothing cached and nothing fetched: surface the real error, never invent data.
    if (err instanceof MarketDataError) throw err;
    throw new MarketDataError(
      `No cached data for ${symbol} and the live fetch failed (${err instanceof Error ? err.message : String(err)})`,
      'NO_DATA',
    );
  }
}

/** Keep indicator lines aligned with the visible window. */
function windowIndicators(ind: IndicatorSeries, fromTime: number): IndicatorSeries {
  const keep = <T extends { time: number }>(arr: T[]): T[] => arr.filter((p) => p.time >= fromTime);
  return {
    sma20: keep(ind.sma20),
    sma50: keep(ind.sma50),
    sma200: keep(ind.sma200),
    ema12: keep(ind.ema12),
    ema26: keep(ind.ema26),
    bb: keep(ind.bb),
    rsi14: keep(ind.rsi14),
    macd: keep(ind.macd),
  };
}

/**
 * Full payload for the chart: windowed candles, matching indicators, metadata
 * and provenance. Indicators are computed over the **full** cached history
 * (so SMA200 has enough bars) and then trimmed to the visible window.
 */
export async function loadMarketData(
  db: Db,
  rawSymbol: string,
  opts: LoadOptions = {},
): Promise<MarketData> {
  const series = await loadSeries(db, rawSymbol, opts);
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const view = resolveView(opts.range, opts.interval);

  const fullIndicators = computeIndicators(series.candles);
  const candles = windowCandles(series.candles, view.range, now);
  const fromTime = candles.length ? candles[0].time : 0;
  const indicators = candles.length ? windowIndicators(fullIndicators, fromTime) : fullIndicators;

  return {
    symbol: series.symbol,
    interval: series.interval,
    candles,
    indicators,
    meta: series.meta,
    source: series.source,
    lastUpdated: series.lastUpdated,
    fetchedAt: now,
    note: series.note,
    count: candles.length,
  };
}
