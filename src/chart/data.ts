import type { Time, UTCTimestamp } from 'lightweight-charts';
import type {
  BandPoint,
  Candle,
  IndicatorSeries,
  Interval,
  LinePoint,
  MacdPoint,
  SymbolMeta,
} from '../../shared/types';

/**
 * Pure mapping from our domain objects to lightweight-charts' input shapes.
 *
 * Kept free of DOM/React so it can be unit-tested directly — the chart is the
 * part most likely to break silently, and "the axis looks wrong" is not a bug
 * you want to discover by eye.
 */

/**
 * lightweight-charts accepts a `BusinessDay` string for >=1d bars, or a branded
 * UTC timestamp (`UTCTimestamp`) for intraday bars. We re-export the library's
 * own `Time` union so the mapping functions satisfy `setData` exactly.
 */
export type ChartTime = Time;

export interface CandlestickPoint {
  time: ChartTime;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface HistogramPoint {
  time: ChartTime;
  value: number;
  color: string;
}

export interface LineDataPoint {
  time: ChartTime;
  value: number;
}

export interface MacdHistogramPoint {
  time: ChartTime;
  value: number;
  color: string;
}

export const UP_COLOR = '#26a69a';
export const DOWN_COLOR = '#ef5350';
export const UP_SOFT = 'rgba(38, 166, 154, 0.55)';
export const DOWN_SOFT = 'rgba(239, 83, 80, 0.55)';

export const SERIES_COLORS = {
  sma20: '#f5c542',
  sma50: '#4c8dff',
  sma200: '#b06bff',
  ema12: '#26c6da',
  ema26: '#ff8a65',
  bbUpper: '#7d8590',
  bbMiddle: '#5c6672',
  bbLower: '#7d8590',
  rsi: '#c792ea',
  macd: '#4c8dff',
  macdSignal: '#ff8a65',
} as const;

/** True for bars whose x-axis is a calendar date rather than a clock time. */
export function isDateInterval(interval: Interval): boolean {
  return interval === '1d' || interval === '1w' || interval === '1mo';
}

/**
 * Convert an epoch-seconds timestamp into the value lightweight-charts wants.
 *
 * For daily and longer bars the library requires a *date* (the trading day), so
 * we take the UTC calendar date. Yahoo stamps a daily bar at the session open,
 * which for US equities is 13:30/14:30 UTC — the same UTC day as the trade.
 * For intraday bars a plain UTC timestamp is correct.
 */
export function toChartTime(epochSeconds: number, interval: Interval): ChartTime {
  if (!Number.isFinite(epochSeconds)) {
    throw new Error(`toChartTime received a non-finite timestamp: ${epochSeconds}`);
  }
  if (isDateInterval(interval)) {
    return new Date(epochSeconds * 1000).toISOString().slice(0, 10);
  }
  return Math.floor(epochSeconds) as UTCTimestamp;
}

/** True when the bar closed at or above its open (used for colouring). */
export function isUpBar(c: Pick<Candle, 'open' | 'close'>): boolean {
  return c.close >= c.open;
}

export function candleData(candles: readonly Candle[], interval: Interval): CandlestickPoint[] {
  return candles.map((c) => ({
    time: toChartTime(c.time, interval),
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
  }));
}

/** One volume column per candle, tinted by the candle's direction. */
export function volumeData(candles: readonly Candle[], interval: Interval): HistogramPoint[] {
  return candles.map((c) => ({
    time: toChartTime(c.time, interval),
    value: c.volume,
    color: isUpBar(c) ? UP_SOFT : DOWN_SOFT,
  }));
}

export function lineData(points: readonly LinePoint[], interval: Interval): LineDataPoint[] {
  return points.map((p) => ({ time: toChartTime(p.time, interval), value: p.value }));
}

export function bandData(
  bands: readonly BandPoint[],
  key: 'upper' | 'middle' | 'lower',
  interval: Interval,
): LineDataPoint[] {
  return bands.map((b) => ({ time: toChartTime(b.time, interval), value: b[key] }));
}

export function macdHistogramData(points: readonly MacdPoint[], interval: Interval): MacdHistogramPoint[] {
  return points.map((p) => ({
    time: toChartTime(p.time, interval),
    value: p.histogram,
    color: p.histogram >= 0 ? UP_SOFT : DOWN_SOFT,
  }));
}

export function macdLineData(points: readonly MacdPoint[], key: 'macd' | 'signal', interval: Interval): LineDataPoint[] {
  return points.map((p) => ({ time: toChartTime(p.time, interval), value: p[key] }));
}

/**
 * How much of the visible price range the chart should show above/below the
 * data. Candles need a little air or the wicks touch the frame.
 */
export function priceScaleMargins(hasVolume: boolean): { top: number; bottom: number } {
  return { top: 0.08, bottom: hasVolume ? 0.26 : 0.08 };
}

/** Pick a sensible significant-figures setting from the price magnitude. */
export function precisionFor(price: number | null | undefined): number {
  if (price === null || price === undefined || !Number.isFinite(price)) return 2;
  const abs = Math.abs(price);
  if (abs >= 1000) return 2;
  if (abs >= 1) return 2;
  if (abs >= 0.01) return 4;
  return 6;
}

/** Tolerance used when deciding whether the last price is above/below a level. */
export const PRICE_EPSILON = 1e-9;

export interface LastPriceLine {
  price: number;
  color: string;
  title: string;
}

/**
 * A dashed line marking the latest close, so the user can see at a glance
 * where the market currently sits relative to the candles.
 */
export function lastPriceLine(
  candles: readonly Candle[],
  meta: SymbolMeta | null,
): LastPriceLine | null {
  const fallback = candles.length ? candles[candles.length - 1].close : null;
  const price = meta?.lastPrice ?? fallback;
  if (price === null || !Number.isFinite(price)) return null;
  const ref = meta?.previousClose ?? null;
  const up = ref === null ? true : price >= ref - PRICE_EPSILON;
  return {
    price,
    color: up ? UP_COLOR : DOWN_COLOR,
    title: meta?.symbol ? `${meta.symbol} ${price.toFixed(2)}` : price.toFixed(2),
  };
}

/** A compact legend line for the crosshair: `O H L C Δ%`. */
export function legendFor(
  candle: { open: number; high: number; low: number; close: number; volume?: number } | null,
  precision = 2,
): Array<{ key: string; value: string }> {
  if (!candle) return [];
  const f = (v: number) => v.toFixed(precision);
  const changePct = candle.open === 0 ? 0 : ((candle.close - candle.open) / candle.open) * 100;
  const rows: Array<{ key: string; value: string }> = [
    { key: 'O', value: f(candle.open) },
    { key: 'H', value: f(candle.high) },
    { key: 'L', value: f(candle.low) },
    { key: 'C', value: f(candle.close) },
    { key: 'Δ', value: `${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}%` },
  ];
  if (typeof candle.volume === 'number') {
    rows.push({ key: 'V', value: compactVolume(candle.volume) });
  }
  return rows;
}

export function compactVolume(v: number): string {
  if (!Number.isFinite(v)) return '—';
  const abs = Math.abs(v);
  if (abs >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(v / 1e3).toFixed(2)}K`;
  return String(Math.round(v));
}

/**
 * How many indicator lines we actually have data for. Used to decide whether
 * an overlay toggle should be offered at all (a 1-month window has no SMA200).
 */
export function availableOverlays(indicators: IndicatorSeries | null): {
  sma20: boolean;
  sma50: boolean;
  sma200: boolean;
  ema: boolean;
  bb: boolean;
} {
  const n = (arr: unknown[]) => Array.isArray(arr) && arr.length > 0;
  return {
    sma20: n(indicators?.sma20 ?? []),
    sma50: n(indicators?.sma50 ?? []),
    sma200: n(indicators?.sma200 ?? []),
    ema: n(indicators?.ema12 ?? []),
    bb: n(indicators?.bb ?? []),
  };
}
