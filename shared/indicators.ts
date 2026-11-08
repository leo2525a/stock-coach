import { SMA, EMA, RSI, MACD, BollingerBands, ATR } from 'technicalindicators';
import type {
  BandPoint,
  Candle,
  IndicatorSeries,
  LinePoint,
  MacdPoint,
} from './types';

/**
 * Indicator engine.
 *
 * Design contract (also enforced by tests):
 *  - Every returned series is **tail-aligned** to the input candles, i.e.
 *    `out[k]` belongs to `candles[candles.length - out.length + k]`.
 *  - Each point carries the candle's own `time`, so callers never have to guess
 *    about offsets — this is what stops the chart drifting out of sync.
 *  - Insufficient data returns `[]`, never a throw and never a fabricated value.
 */

const dfault = {
  sma: [20, 50, 200],
  ema: [12, 26],
  rsi: 14,
  macd: { fast: 12, slow: 26, signal: 9 },
  bb: { period: 20, stdDev: 2 },
  atr: 14,
} as const;

function closes(candles: Candle[]): number[] {
  return candles.map((c) => c.close);
}

function tailTimes(candles: Candle[], outLength: number): number[] {
  const offset = candles.length - outLength;
  const times: number[] = [];
  for (let i = 0; i < outLength; i += 1) times.push(candles[offset + i].time);
  return times;
}

/** Simple moving average. */
export function sma(candles: Candle[], period: number): LinePoint[] {
  if (period <= 0 || candles.length < period) return [];
  const values = closes(candles);
  const out = SMA.calculate({ period, values });
  const times = tailTimes(candles, out.length);
  return out.map((value, i) => ({ time: times[i], value }));
}

/** Exponential moving average. */
export function ema(candles: Candle[], period: number): LinePoint[] {
  if (period <= 0 || candles.length < period) return [];
  const values = closes(candles);
  const out = EMA.calculate({ period, values });
  const times = tailTimes(candles, out.length);
  return out.map((value, i) => ({ time: times[i], value }));
}

/** Bollinger Bands (upper / middle / lower). */
export function bollinger(
  candles: Candle[],
  period = dfault.bb.period,
  stdDev = dfault.bb.stdDev,
): BandPoint[] {
  if (period <= 0 || candles.length < period) return [];
  const values = closes(candles);
  const out = BollingerBands.calculate({ period, stdDev, values });
  const times = tailTimes(candles, out.length);
  return out.map((b, i) => ({
    time: times[i],
    upper: b.upper,
    middle: b.middle,
    lower: b.lower,
  }));
}

/** Bollinger Band width as a percentage of the middle band. */
export function bbWidthPercent(candles: Candle[], period = dfault.bb.period, stdDev = dfault.bb.stdDev): LinePoint[] {
  return bollinger(candles, period, stdDev)
    .filter((b) => b.middle !== 0)
    .map((b) => ({ time: b.time, value: ((b.upper - b.lower) / b.middle) * 100 }));
}

/** Relative Strength Index. */
export function rsi(candles: Candle[], period = dfault.rsi): LinePoint[] {
  // RSI needs `period + 1` closes to produce its first value.
  if (period <= 0 || candles.length <= period) return [];
  const out = RSI.calculate({ period, values: closes(candles) });
  const times = tailTimes(candles, out.length);
  return out.map((value, i) => ({ time: times[i], value }));
}

/**
 * MACD.
 *
 * Note: `technicalindicators` seeds the MACD line early (pure-EMA warmup) and
 * only fills `signal`/`histogram` once enough bars exist. We deliberately drop
 * those warmup rows so every returned point has all four numbers — a partial
 * MACD point must never reach the UI.
 */
export function macd(
  candles: Candle[],
  fastPeriod = dfault.macd.fast,
  slowPeriod = dfault.macd.slow,
  signalPeriod = dfault.macd.signal,
): MacdPoint[] {
  if (candles.length < slowPeriod + signalPeriod) return [];
  const raw = MACD.calculate({
    values: closes(candles),
    fastPeriod,
    slowPeriod,
    signalPeriod,
    SimpleMAOscillator: false,
    SimpleMASignal: false,
  });
  const full = raw.filter(
    (r) =>
      typeof r.MACD === 'number' &&
      typeof r.signal === 'number' &&
      typeof r.histogram === 'number',
  );
  const times = tailTimes(candles, full.length);
  return full.map((r, i) => ({
    time: times[i],
    macd: r.MACD as number,
    signal: r.signal as number,
    histogram: r.histogram as number,
  }));
}

/** Average True Range — used as volatility evidence. */
export function atr(candles: Candle[], period = dfault.atr): LinePoint[] {
  if (candles.length <= period) return [];
  const out = ATR.calculate({
    period,
    high: candles.map((c) => c.high),
    low: candles.map((c) => c.low),
    close: closes(candles),
  });
  const times = tailTimes(candles, out.length);
  return out.map((value, i) => ({ time: times[i], value }));
}

/**
 * How many leading candles each indicator must discard as warm-up, once the
 * series is long enough for the indicator to be defined at all.
 *
 * These are contracts, not guesses:
 *   SMA(n)          -> n - 1     (an n-bar average starts at bar n)
 *   RSI(n)          -> n         (Wilder smoothing needs n deltas, from n bars)
 *   Bollinger(n)    -> n - 1     (same window as its middle SMA)
 *   MACD(f,s,sig)   -> s + (f-1) (the signal line re-smooths the slow EMA's warm-up)
 *
 * They are exported so the alignment invariant can be asserted rather than
 * re-derived by hand in every test.
 */
export const INDICATOR_WARMUP = {
  sma20: 19,
  sma50: 49,
  sma200: 199,
  ema12: 11,
  ema26: 25,
  bb: 19,
  rsi14: 14,
  macd: 33,
} as const;

/** Compute the whole indicator bundle for one candle series. */
export function computeIndicators(candles: Candle[]): IndicatorSeries {
  return {
    sma20: sma(candles, dfault.sma[0]),
    sma50: sma(candles, dfault.sma[1]),
    sma200: sma(candles, dfault.sma[2]),
    ema12: ema(candles, dfault.ema[0]),
    ema26: ema(candles, dfault.ema[1]),
    bb: bollinger(candles),
    rsi14: rsi(candles),
    macd: macd(candles),
  };
}

/** The default parameter set, exposed so the UI can tell the user what it used. */
export const INDICATOR_PARAMS = dfault;
