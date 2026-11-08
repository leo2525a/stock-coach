import type { Candle, Interval, SymbolMeta } from './types';

/**
 * Pure mapping layer for the Yahoo Finance "chart" endpoint.
 *
 * Kept pure (no fetch, no clock, no database) so it can be unit-tested against
 * captured fixtures and so the backend, the CLI and the tests all agree on one
 * interpretation of the wire format.
 *
 * Source shape:
 *   { chart: { result: [ { meta, timestamp: number[], indicators: { quote: [ {...} ] } } ], error } }
 */

/** Our interval id -> Yahoo's `interval` query value. */
export const YAHOO_INTERVAL: Record<Interval, string> = {
  '1m': '1m',
  '5m': '5m',
  '15m': '15m',
  '1h': '1h',
  '1d': '1d',
  '1w': '1wk',
  '1mo': '1mo',
};

/** Nominal length of one bar, in seconds (used for cache-freshness maths). */
export const BAR_SECONDS: Record<Interval, number> = {
  '1m': 60,
  '5m': 300,
  '15m': 900,
  '1h': 3600,
  '1d': 86400,
  '1w': 604800,
  '1mo': 2592000,
};

/** Yahoo's own error envelope. */
interface YahooError {
  code?: string;
  description?: string;
}

interface YahooChartResult {
  meta?: Record<string, unknown>;
  timestamp?: unknown;
  indicators?: {
    quote?: Array<{
      open?: unknown;
      high?: unknown;
      low?: unknown;
      close?: unknown;
      volume?: unknown;
    }>;
  };
}

interface YahooChartRoot {
  chart?: {
    result?: YahooChartResult[] | null;
    error?: YahooError | null;
  };
}

export class YahooParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'YahooParseError';
  }
}

const asNumber = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

function asNumberArray(v: unknown): (number | null)[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => asNumber(x));
}

/**
 * Extract candles from a Yahoo chart response.
 *
 * Rows where any of O/H/L/C is missing are dropped: Yahoo emits `null`s for
 * halted sessions and for the live, still-forming last bar's missing fields.
 * We never invent a price to fill the gap (SPEC §7).
 */
export function parseCandles(json: unknown): Candle[] {
  const root = json as YahooChartRoot;
  const result = root?.chart?.result?.[0];
  if (!result) {
    const desc = root?.chart?.error?.description;
    throw new YahooParseError(desc ? `Yahoo returned an error: ${desc}` : 'Yahoo response had no result');
  }

  const timestamps = asNumberArray(result.timestamp);
  const quote = result.indicators?.quote?.[0];
  if (!quote) throw new YahooParseError('Yahoo response had no quote data');

  const open = asNumberArray(quote.open);
  const high = asNumberArray(quote.high);
  const low = asNumberArray(quote.low);
  const close = asNumberArray(quote.close);
  const volume = asNumberArray(quote.volume);

  const candles: Candle[] = [];
  for (let i = 0; i < timestamps.length; i += 1) {
    const time = timestamps[i];
    const o = open[i];
    const h = high[i];
    const l = low[i];
    const c = close[i];
    if (time === null || o === null || h === null || l === null || c === null) continue;
    candles.push({
      time,
      open: o,
      high: h,
      low: l,
      close: c,
      volume: volume[i] ?? 0,
    });
  }

  // Guard against out-of-order or duplicated timestamps from the provider.
  candles.sort((a, b) => a.time - b.time);
  const deduped: Candle[] = [];
  for (const candle of candles) {
    if (deduped.length && deduped[deduped.length - 1].time === candle.time) {
      deduped[deduped.length - 1] = candle;
    } else {
      deduped.push(candle);
    }
  }
  return deduped;
}

/** Extract the symbol metadata block. Missing fields stay `null`, never 0. */
export function parseMeta(json: unknown, fallbackSymbol: string): SymbolMeta {
  const root = json as YahooChartRoot;
  const result = root?.chart?.result?.[0];
  if (!result) throw new YahooParseError('Yahoo response had no result');

  const m = (result.meta ?? {}) as Record<string, unknown>;
  const str = (v: unknown, fallback = ''): string => (typeof v === 'string' && v ? v : fallback);

  /**
   * Prior-close derivation (verified against the live endpoint):
   * `meta.chartPreviousClose` is the close *before the requested range starts*,
   * NOT the previous trading day. For range=6mo it returns the close from ~6
   * months ago, which would make the daily change read as -17%. We therefore
   * prefer the provider's explicit change and back out the previous close from
   * it; `chartPreviousClose` is only a last resort.
   */
  const lastPrice = asNumber(m.regularMarketPrice);
  const explicitChange = asNumber(m.regularMarketChange) ?? asNumber(m.fulldayChange);
  const chartPrev = asNumber(m.chartPreviousClose) ?? asNumber(m.previousClose);

  let previousClose: number | null = null;
  let computedChange: number | null = null;
  if (lastPrice !== null && explicitChange !== null) {
    computedChange = explicitChange;
    previousClose = lastPrice - explicitChange;
  } else if (lastPrice !== null && chartPrev !== null) {
    previousClose = chartPrev;
    computedChange = lastPrice - chartPrev;
  } else {
    previousClose = chartPrev;
  }

  const changePercent =
    asNumber(m.regularMarketChangePercent) ??
    asNumber(m.fulldayChangePercent) ??
    (computedChange !== null && previousClose ? (computedChange / previousClose) * 100 : null);

  return {
    symbol: str(m.symbol, fallbackSymbol).toUpperCase(),
    name: str(m.longName) || str(m.shortName) || str(m.symbol, fallbackSymbol).toUpperCase(),
    currency: str(m.currency, 'USD'),
    exchange: str(m.fullExchangeName) || str(m.exchangeName),
    exchangeTimezone: str(m.exchangeTimezoneName) || str(m.timezone, 'UTC'),
    lastPrice,
    previousClose,
    change: computedChange,
    changePercent,
    dayHigh: asNumber(m.regularMarketDayHigh),
    dayLow: asNumber(m.regularMarketDayLow),
    fiftyTwoWeekHigh: asNumber(m.fiftyTwoWeekHigh),
    fiftyTwoWeekLow: asNumber(m.fiftyTwoWeekLow),
    volume: asNumber(m.regularMarketVolume),
    marketTime: asNumber(m.regularMarketTime),
  };
}

/** Does this payload contain enough candles to be worth showing? */
export function hasUsableData(candles: Candle[]): boolean {
  return candles.length >= 2;
}

/** Median gap between consecutive candles, in seconds (0 when undefined). */
export function medianGapSeconds(candles: Candle[]): number {
  if (candles.length < 3) return 0;
  const gaps: number[] = [];
  for (let i = 1; i < candles.length; i += 1) gaps.push(candles[i].time - candles[i - 1].time);
  gaps.sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)];
}

/**
 * Guard against Yahoo silently downgrading the granularity we asked for.
 *
 * Returns a human-readable problem description, or `null` when the data looks
 * like the interval we requested. The bar-frequency check is intentionally
 * loose (markets have weekends, holidays and half-days) but catches the gross
 * mismatches, e.g. asking for daily bars and receiving monthly ones.
 */
export function validateIntervalMatch(candles: Candle[], interval: Interval): string | null {
  if (candles.length < 3) return null;
  const gap = medianGapSeconds(candles);
  if (gap <= 0) return null;
  const expected = BAR_SECONDS[interval];
  const ratio = gap / expected;

  // Monthly data arriving when something finer was requested is the dangerous
  // case: it would silently corrupt every indicator and signal downstream.
  if (interval !== '1mo' && gap > 45 * 86400) {
    return `Requested ${interval} bars but received roughly monthly data (~${Math.round(gap / 86400)} day bars)`;
  }
  if (ratio > 6 || ratio < 0.15) {
    return `Requested ${interval} bars but received roughly ${Math.round(gap / 60)}-minute data`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Range / interval resolution
// ---------------------------------------------------------------------------

/** Selected range -> nominal length in seconds (used to window cached data). */
export const RANGE_SECONDS: Record<string, number> = {
  '1d': 86400,
  '5d': 5 * 86400,
  '1mo': 30 * 86400,
  '3mo': 90 * 86400,
  '6mo': 180 * 86400,
  '1y': 365 * 86400,
  '2y': 730 * 86400,
  '3y': 3 * 365 * 86400,
  '5y': 1825 * 86400,
  '10y': 3650 * 86400,
  max: 3650 * 86400,
};

/** When the user picks only an interval, which range should we pull? */
export const INTERVAL_DEFAULT_RANGE: Record<Interval, string> = {
  '1m': '5d',
  '5m': '1mo',
  '15m': '1mo',
  '1h': '3mo',
  '1d': '1y',
  '1w': '5y',
  '1mo': '10y',
};

/** When the user picks only a range, which interval fits it best? */
export const RANGE_DEFAULT_INTERVAL: Record<string, Interval> = {
  '1d': '5m',
  '5d': '15m',
  '1mo': '1h',
  '3mo': '1d',
  '6mo': '1d',
  '1y': '1d',
  '2y': '1d',
  '3y': '1d',
  '5y': '1w',
  '10y': '1mo',
  max: '1mo',
};

/**
 * How much history Yahoo will serve for each intraday interval (in days).
 * Requesting more returns an upstream error, so we clamp instead.
 */
export const INTERVAL_MAX_RANGE_DAYS: Record<Interval, number> = {
  '1m': 7,
  '5m': 60,
  '15m': 60,
  '1h': 730,
  '1d': Number.POSITIVE_INFINITY,
  '1w': Number.POSITIVE_INFINITY,
  '1mo': Number.POSITIVE_INFINITY,
};

/**
 * `range=max` is a documented trap: Yahoo silently ignores the requested
 * interval and returns MONTHLY bars (verified 2026-11-06 — range=max&interval=1d
 * yields 169 bars with a ~92-day median gap). We therefore never ask for `max`
 * unless the caller genuinely wants monthly bars.
 */
function clampMaxRange(range: string, interval: Interval): string {
  return range === 'max' && interval !== '1mo' ? '10y' : range;
}

/** Range ids ordered from shortest to longest, for clamping. */
const RANGE_ORDER = ['1d', '5d', '1mo', '3mo', '6mo', '1y', '2y', '3y', '5y', '10y'] as const;

/** Shorten `range` until it fits the interval's upstream limit. */
export function clampRangeForInterval(range: string, interval: Interval): string {
  const safeRange = clampMaxRange(range, interval);
  const maxDays = INTERVAL_MAX_RANGE_DAYS[interval];
  if (!Number.isFinite(maxDays)) return safeRange;
  const idx = (RANGE_ORDER as readonly string[]).indexOf(safeRange);
  if (idx < 0) return '1mo';
  let chosen = RANGE_ORDER[0] as string;
  for (const candidate of RANGE_ORDER) {
    if ((RANGE_SECONDS[candidate] ?? 0) / 86400 <= maxDays) chosen = candidate;
  }
  const requestedDays = (RANGE_SECONDS[safeRange] ?? 0) / 86400;
  return requestedDays <= maxDays ? safeRange : chosen;
}

export interface ResolvedView {
  range: string;
  interval: Interval;
}

/**
 * Turn loose UI parameters into a concrete, *upstream-valid* (range, interval)
 * pair. An explicit `interval` always wins, and the range is then clamped to
 * what that interval can actually serve.
 */
export function resolveView(range?: string | null, interval?: string | null): ResolvedView {
  const validIntervals = Object.keys(YAHOO_INTERVAL) as Interval[];
  const wantedInterval =
    interval && (validIntervals as string[]).includes(interval) ? (interval as Interval) : null;

  const requestedRange =
    range && RANGE_SECONDS[range] !== undefined
      ? range
      : wantedInterval
        ? INTERVAL_DEFAULT_RANGE[wantedInterval]
        : '1y';

  if (wantedInterval) {
    return { range: clampRangeForInterval(requestedRange, wantedInterval), interval: wantedInterval };
  }

  const resolvedInterval: Interval = RANGE_DEFAULT_INTERVAL[requestedRange] ?? '1d';
  return { range: clampRangeForInterval(requestedRange, resolvedInterval), interval: resolvedInterval };
}

/**
 * Drop candles older than the requested window.
 *
 * Used when serving cache: we store more history than any single view needs, so
 * the window has to be trimmed to what was actually asked for.
 *
 * The cutoff is deliberately exact rather than padded. A backward pad would
 * make a "1Y" view show 1 year + a few days, which is both dishonest about the
 * range and — more importantly — makes the candle count differ depending on
 * whether the row came from the network or from SQLite. The same request must
 * return the same series either way.
 */
export function windowCandles(candles: Candle[], range: string, nowSeconds: number): Candle[] {
  const seconds = RANGE_SECONDS[range];
  if (seconds === undefined || !Number.isFinite(seconds)) return candles;
  const cutoff = nowSeconds - seconds;
  const windowed = candles.filter((c) => c.time >= cutoff);
  return windowed.length ? windowed : candles;
}
