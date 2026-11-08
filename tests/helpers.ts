import type { Candle } from '../shared/types';

/**
 * Deterministic test data builders.
 *
 * Everything here is generated from a seeded, pure function so a failing test
 * is always reproducible and never depends on the network or the wall clock.
 */

/** Build a candle series from a list of closes. */
export function candlesFromCloses(
  closes: number[],
  opts: { volume?: (i: number) => number; startTime?: number; stepSeconds?: number } = {},
): Candle[] {
  const startTime = opts.startTime ?? 1_600_000_000;
  const step = opts.stepSeconds ?? 86400;
  return closes.map((close, i) => {
    const open = i === 0 ? close : closes[i - 1];
    return {
      time: startTime + i * step,
      open,
      high: Math.max(open, close) + Math.abs(close) * 0.01,
      low: Math.min(open, close) - Math.abs(close) * 0.01,
      close,
      volume: opts.volume ? opts.volume(i) : 1_000_000,
    };
  });
}

/** n candles trending steadily upward / downward / flat. */
export function trendCandles(n: number, direction: 1 | -1 | 0, start = 100, stepPct = 0.004): Candle[] {
  const closes: number[] = [];
  let price = start;
  for (let i = 0; i < n; i += 1) {
    closes.push(Number(price.toFixed(4)));
    price *= 1 + direction * stepPct;
  }
  return candlesFromCloses(closes);
}

/** A long uptrend followed by a sharp fall (used to force oversold RSI). */
export function upThenDown(upBars: number, downBars: number): Candle[] {
  const closes: number[] = [];
  let price = 100;
  for (let i = 0; i < upBars; i += 1) {
    closes.push(Number(price.toFixed(4)));
    price *= 1.006;
  }
  for (let i = 0; i < downBars; i += 1) {
    closes.push(Number(price.toFixed(4)));
    price *= 0.988;
  }
  return candlesFromCloses(closes);
}

/** A realistic-looking deterministic wobble (no randomness, no clock). */
export function wobbleCandles(n: number, start = 100): Candle[] {
  const closes: number[] = [];
  let price = start;
  for (let i = 0; i < n; i += 1) {
    const wave = Math.sin(i / 9) * 0.012 + Math.sin(i / 31) * 0.02;
    price *= 1 + wave * 0.35 + 0.0009;
    closes.push(Number(price.toFixed(4)));
  }
  return candlesFromCloses(closes);
}

/** A minimal but faithful Yahoo chart payload. */
export function yahooFixture(
  candles: Candle[],
  meta: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    chart: {
      result: [
        {
          meta: {
            currency: 'USD',
            symbol: 'TEST',
            longName: 'Test Corporation',
            fullExchangeName: 'NasdaqGS',
            exchangeTimezoneName: 'America/New_York',
            regularMarketPrice: candles.at(-1)?.close ?? 0,
            regularMarketChange: 2.5,
            regularMarketChangePercent: 1.1,
            regularMarketDayHigh: 110,
            regularMarketDayLow: 95,
            fiftyTwoWeekHigh: 200,
            fiftyTwoWeekLow: 50,
            regularMarketVolume: 1_234_567,
            regularMarketTime: candles.at(-1)?.time ?? 0,
            ...meta,
          },
          timestamp: candles.map((c) => c.time),
          indicators: {
            quote: [
              {
                open: candles.map((c) => c.open),
                high: candles.map((c) => c.high),
                low: candles.map((c) => c.low),
                close: candles.map((c) => c.close),
                volume: candles.map((c) => c.volume),
              },
            ],
          },
        },
      ],
      error: null,
    },
  };
}
