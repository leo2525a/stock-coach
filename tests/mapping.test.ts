import { describe, expect, it } from 'vitest';
import {
  BAR_SECONDS,
  RANGE_SECONDS,
  YAHOO_INTERVAL,
  clampRangeForInterval,
  hasUsableData,
  medianGapSeconds,
  parseCandles,
  parseMeta,
  resolveView,
  validateIntervalMatch,
  windowCandles,
  YahooParseError,
} from '../shared/yahoo';
import type { Candle } from '../shared/types';
import { candlesFromCloses, trendCandles, yahooFixture } from './helpers';

describe('parseCandles', () => {
  it('maps a faithful Yahoo payload into candles', () => {
    const candles = candlesFromCloses([10, 11, 12]);
    const parsed = parseCandles(yahooFixture(candles));
    expect(parsed).toHaveLength(3);
    expect(parsed[0]).toEqual({
      time: candles[0].time,
      open: candles[0].open,
      high: candles[0].high,
      low: candles[0].low,
      close: candles[0].close,
      volume: candles[0].volume,
    });
  });

  it('drops rows with any missing OHLC field instead of inventing a price', () => {
    const json = {
      chart: {
        result: [
          {
            timestamp: [1, 2, 3, 4],
            indicators: {
              quote: [
                {
                  open: [10, null, 12, 13],
                  high: [11, 11, null, 14],
                  low: [9, 9, 11, 12],
                  close: [10.5, 10.6, 11.5, 13.5],
                  volume: [100, 200, 300, 400],
                },
              ],
            },
          },
        ],
        error: null,
      },
    };
    const parsed = parseCandles(json);
    expect(parsed.map((c) => c.time)).toEqual([1, 4]);
    for (const c of parsed) {
      expect(Number.isFinite(c.open)).toBe(true);
      expect(Number.isFinite(c.close)).toBe(true);
    }
  });

  it('defaults a missing volume to 0 rather than NaN', () => {
    const json = {
      chart: {
        result: [
          {
            timestamp: [1, 2],
            indicators: { quote: [{ open: [1, 2], high: [2, 3], low: [0.5, 1], close: [1.5, 2.5], volume: [null, 500] }] },
          },
        ],
        error: null,
      },
    };
    const parsed = parseCandles(json);
    expect(parsed[0].volume).toBe(0);
    expect(parsed[1].volume).toBe(500);
  });

  it('sorts out-of-order timestamps ascending and de-duplicates them', () => {
    const json = {
      chart: {
        result: [
          {
            timestamp: [3, 1, 2, 3],
            indicators: {
              quote: [{ open: [3, 1, 2, 30], high: [3, 1, 2, 30], low: [3, 1, 2, 30], close: [3, 1, 2, 30], volume: [3, 1, 2, 30] }],
            },
          },
        ],
        error: null,
      },
    };
    const parsed = parseCandles(json);
    expect(parsed.map((c) => c.time)).toEqual([1, 2, 3]);
    // The later duplicate wins (Yahoo revises the live bar in place).
    expect(parsed.at(-1)!.close).toBe(30);
  });

  it('throws a descriptive error when Yahoo returns an error envelope', () => {
    expect(() => parseCandles({ chart: { result: null, error: { code: 'Not Found', description: 'No data found' } } })).toThrow(
      YahooParseError,
    );
    expect(() =>
      parseCandles({ chart: { result: null, error: { code: 'Not Found', description: 'No data found' } } }),
    ).toThrow(/No data found/);
  });

  it('throws when there is no quote block', () => {
    expect(() => parseCandles({ chart: { result: [{ timestamp: [1] }] } })).toThrow(YahooParseError);
  });

  it('returns an empty array for an empty but well-formed payload', () => {
    expect(parseCandles({ chart: { result: [{ timestamp: [], indicators: { quote: [{}] } }] } })).toEqual([]);
  });
});

describe('parseMeta', () => {
  it('reads the fields the UI shows', () => {
    const candles = candlesFromCloses([100, 105]);
    const meta = parseMeta(yahooFixture(candles), 'TEST');
    expect(meta.symbol).toBe('TEST');
    expect(meta.name).toBe('Test Corporation');
    expect(meta.currency).toBe('USD');
    expect(meta.exchange).toBe('NasdaqGS');
    expect(meta.exchangeTimezone).toBe('America/New_York');
    expect(meta.lastPrice).toBe(105);
    expect(meta.fiftyTwoWeekHigh).toBe(200);
    expect(meta.volume).toBe(1_234_567);
  });

  it('derives previousClose from the reported change, NOT from chartPreviousClose', () => {
    // Regression: chartPreviousClose is the close before the *range* starts.
    // For a 6-month range it is ~6 months old and would corrupt the daily change.
    const candles = candlesFromCloses([100, 105]);
    const meta = parseMeta(
      yahooFixture(candles, {
        regularMarketPrice: 344.17,
        regularMarketChange: -6.27,
        regularMarketChangePercent: -1.528,
        chartPreviousClose: 284.18, // stale range-start value
      }),
      'AAPL',
    );
    expect(meta.change).toBeCloseTo(-6.27, 6);
    expect(meta.previousClose).toBeCloseTo(350.44, 6); // 344.17 - (-6.27)
    expect(meta.changePercent).toBeCloseTo(-1.528, 6);
  });

  it('falls back to chartPreviousClose only when no explicit change exists', () => {
    const candles = candlesFromCloses([100, 105]);
    const meta = parseMeta(
      yahooFixture(candles, {
        regularMarketPrice: 110,
        regularMarketChange: undefined,
        regularMarketChangePercent: undefined,
        chartPreviousClose: 100,
      }),
      'X',
    );
    expect(meta.previousClose).toBe(100);
    expect(meta.change).toBeCloseTo(10, 6);
    expect(meta.changePercent).toBeCloseTo(10, 6);
  });

  it('keeps missing values as null rather than 0', () => {
    const candles = candlesFromCloses([100, 105]);
    const meta = parseMeta(
      yahooFixture(candles, {
        regularMarketDayHigh: undefined,
        fiftyTwoWeekLow: undefined,
        regularMarketVolume: undefined,
        regularMarketChange: undefined,
        regularMarketChangePercent: undefined,
        chartPreviousClose: undefined,
      }),
      'X',
    );
    expect(meta.dayHigh).toBeNull();
    expect(meta.fiftyTwoWeekLow).toBeNull();
    expect(meta.volume).toBeNull();
    expect(meta.previousClose).toBeNull();
    expect(meta.change).toBeNull();
  });

  it('falls back to the requested symbol when meta has none', () => {
    const candles = candlesFromCloses([1, 2]);
    const meta = parseMeta(yahooFixture(candles, { symbol: undefined, longName: undefined, shortName: undefined }), 'tsla');
    expect(meta.symbol).toBe('TSLA');
    expect(meta.name).toBe('TSLA');
  });
});

describe('hasUsableData', () => {
  it('requires at least two candles', () => {
    expect(hasUsableData([])).toBe(false);
    expect(hasUsableData([{ time: 1, open: 1, high: 1, low: 1, close: 1, volume: 1 }])).toBe(false);
    expect(hasUsableData(trendCandles(2, 1))).toBe(true);
  });
});

describe('medianGapSeconds / validateIntervalMatch', () => {
  it('measures the median gap of a daily series as ~86400s', () => {
    const daily = candlesFromCloses(Array.from({ length: 30 }, (_, i) => 100 + i));
    expect(medianGapSeconds(daily)).toBeCloseTo(86400, 0);
  });

  it('accepts data whose frequency matches the requested interval', () => {
    const daily = candlesFromCloses(Array.from({ length: 30 }, (_, i) => 100 + i));
    expect(validateIntervalMatch(daily, '1d')).toBeNull();
  });

  it('rejects monthly data masquerading as daily (the range=max trap)', () => {
    const monthly = candlesFromCloses(
      Array.from({ length: 20 }, (_, i) => 100 + i),
      { stepSeconds: Math.round(91.96 * 86400) },
    );
    const problem = validateIntervalMatch(monthly, '1d');
    expect(problem).toBeTruthy();
    expect(problem).toContain('monthly');
  });

  it('rejects hourly data when daily was requested', () => {
    const hourly = candlesFromCloses(Array.from({ length: 40 }, (_, i) => 100 + i), { stepSeconds: 3600 });
    expect(validateIntervalMatch(hourly, '1d')).toBeTruthy();
  });

  it('does not object to monthly data when monthly was requested', () => {
    const monthly = candlesFromCloses(
      Array.from({ length: 20 }, (_, i) => 100 + i),
      { stepSeconds: Math.round(91.96 * 86400) },
    );
    expect(validateIntervalMatch(monthly, '1mo')).toBeNull();
  });
});

describe('resolveView', () => {
  it('never asks Yahoo for range=max unless monthly bars are wanted', () => {
    expect(resolveView('max', '1d')).toEqual({ range: '10y', interval: '1d' });
    expect(resolveView('max', '1w')).toEqual({ range: '10y', interval: '1w' });
    expect(resolveView('max', '1mo')).toEqual({ range: 'max', interval: '1mo' });
  });

  it('clamps an intraday interval to the history Yahoo will actually serve', () => {
    // 1-minute bars are limited to ~7 days; asking for 1y must not error.
    expect(resolveView('1y', '1m').range).toBe('5d');
    expect(resolveView('10y', '5m').range).toBe('1mo');
    expect(resolveView('1y', '15m').range).toBe('1mo');
    expect(resolveView('10y', '1h').range).toBe('2y');
  });

  it('leaves a valid range untouched', () => {
    expect(resolveView('6mo', '1d')).toEqual({ range: '6mo', interval: '1d' });
    expect(resolveView('5y', '1w')).toEqual({ range: '5y', interval: '1w' });
  });

  it('uses a sane default when nothing is supplied', () => {
    expect(resolveView()).toEqual({ range: '1y', interval: '1d' });
    expect(resolveView(null, null)).toEqual({ range: '1y', interval: '1d' });
  });

  it('ignores an unknown interval and falls back to the range default', () => {
    expect(resolveView('1mo', 'banana').interval).toBe('1h');
    expect(resolveView('1d', 'banana').interval).toBe('5m');
  });

  it('ignores an unknown range', () => {
    expect(resolveView('banana', '1d')).toEqual({ range: '1y', interval: '1d' });
  });

  it('derives a matching interval from an interval-only request', () => {
    expect(resolveView(null, '1w')).toEqual({ range: '5y', interval: '1w' });
    expect(resolveView(null, '1m')).toEqual({ range: '5d', interval: '1m' });
  });

  it('clampRangeForInterval always yields a range within the interval budget', () => {
    for (const interval of Object.keys(YAHOO_INTERVAL) as Array<keyof typeof YAHOO_INTERVAL>) {
      for (const range of Object.keys(RANGE_SECONDS)) {
        const out = clampRangeForInterval(range, interval);
        const days = (RANGE_SECONDS[out] ?? 0) / 86400;
        const budget = interval === '1m' ? 7 : interval === '5m' || interval === '15m' ? 60 : interval === '1h' ? 730 : Infinity;
        expect(days, `${range}+${interval} -> ${out}`).toBeLessThanOrEqual(budget);
        expect(BAR_SECONDS[interval]).toBeGreaterThan(0);
      }
    }
  });
});

describe('windowCandles', () => {
  const now = 1_800_000_000;
  const candles: Candle[] = candlesFromCloses(
    Array.from({ length: 400 }, (_, i) => 100 + i),
    { startTime: now - 399 * 86400 },
  );

  it('trims to roughly the requested window', () => {
    const out = windowCandles(candles, '1mo', now);
    const days = (out.at(-1)!.time - out[0].time) / 86400;
    expect(days).toBeLessThanOrEqual(31);
    expect(out.length).toBeGreaterThan(20);
  });

  it('keeps everything for a long window', () => {
    expect(windowCandles(candles, '10y', now).length).toBe(candles.length);
  });

  it('never returns an empty window when data exists (no blank chart)', () => {
    const shortSeries = candlesFromCloses([1, 2, 3], { startTime: now - 200 * 86400 });
    expect(windowCandles(shortSeries, '1d', now).length).toBeGreaterThan(0);
  });

  it('does not pad the window: 1Y covers exactly 365 days, no more', () => {
    // Regression: a backward pad made a "1Y" view show 1 year + 5 days, so the
    // same request returned a different number of bars depending on whether it
    // was served live or from cache.
    const daily = candlesFromCloses(
      Array.from({ length: 400 }, (_, i) => 100 + i),
      { startTime: now - 399 * 86400 },
    );
    const oneYear = windowCandles(daily, '1y', now);
    const spanDays = (oneYear.at(-1)!.time - oneYear[0].time) / 86400;
    expect(spanDays).toBeLessThanOrEqual(365);
    expect(oneYear[0].time).toBeGreaterThanOrEqual(now - 365 * 86400);
  });

  it('is deterministic: the same window always selects the same bars', () => {
    const daily = candlesFromCloses(
      Array.from({ length: 400 }, (_, i) => 100 + i),
      { startTime: now - 399 * 86400 },
    );
    const a = windowCandles(daily, '1y', now).map((c) => c.time);
    const b = windowCandles(daily, '1y', now).map((c) => c.time);
    expect(a).toEqual(b);
  });
});

describe('interval + range tables', () => {
  it('maps every interval to a Yahoo interval string', () => {
    expect(YAHOO_INTERVAL['1h']).toBe('1h');
    expect(YAHOO_INTERVAL['1w']).toBe('1wk');
    expect(YAHOO_INTERVAL['1mo']).toBe('1mo');
    expect(YAHOO_INTERVAL['1d']).toBe('1d');
  });

  it('has a bar length for every interval', () => {
    for (const interval of Object.keys(YAHOO_INTERVAL)) {
      expect(BAR_SECONDS[interval as keyof typeof BAR_SECONDS], interval).toBeGreaterThan(0);
    }
  });
});
