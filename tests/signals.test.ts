import { describe, expect, it } from 'vitest';
import {
  bollingerRule,
  evaluateSignals,
  macdRule,
  maTrendRule,
  rsiRule,
  squeezeRule,
  summarize,
  volumeRule,
  type Signal,
} from '../shared/signals';
import type { Candle, IndicatorSeries } from '../shared/types';
import { computeIndicators } from '../shared/indicators';
import { candlesFromCloses, trendCandles, upThenDown, wobbleCandles } from './helpers';

/** Build a full IndicatorSeries, overriding only the lines a test cares about. */
function mkIndicators(over: Partial<IndicatorSeries> = {}): IndicatorSeries {
  const empty: IndicatorSeries = {
    sma20: [],
    sma50: [],
    sma200: [],
    ema12: [],
    ema26: [],
    bb: [],
    rsi14: [],
    macd: [],
  };
  return { ...empty, ...over };
}

const line = (time: number, value: number) => ({ time, value });

/** Deterministic candle at a given time. */
function candle(time: number, o: number, h: number, l: number, c: number, v = 1_000_000): Candle {
  return { time, open: o, high: h, low: l, close: c, volume: v };
}

const STATES = ['bullish', 'bearish', 'neutral'];

function expectValidSignal(s: Signal): void {
  expect(s.id).toBeTruthy();
  expect(s.label).toBeTruthy();
  expect(s.what.length).toBeGreaterThan(10);
  expect(s.meaning.length).toBeGreaterThan(10);
  expect(s.watch.length).toBeGreaterThan(10);
  expect(STATES).toContain(s.state);
  expect(s.strength).toBeGreaterThanOrEqual(0);
  expect(s.strength).toBeLessThanOrEqual(100);
  expect(Number.isInteger(s.strength)).toBe(true);
  // Every signal must cite the numbers behind it.
  expect(s.evidence.length).toBeGreaterThan(0);
  for (const e of s.evidence) expect(e.length).toBeGreaterThan(0);
}

/** Minimal complete Signal, for tests that only care about one field. */
function sig(over: Partial<Signal> & Pick<Signal, 'id' | 'state' | 'strength'>): Signal {
  return {
    label: 'L',
    what: 'W'.repeat(11),
    meaning: 'M'.repeat(11),
    watch: 'X'.repeat(11),
    evidence: ['e'],
    variant: 'test',
    evidenceI18n: [{ key: 'sig.ev.test', params: {} }],
    facts: {},
    ...over,
  };
}

// ---------------------------------------------------------------------------

describe('R1 ma-trend', () => {
  it('is bullish on a sustained uptrend with full alignment', () => {
    const candles = trendCandles(320, 1);
    const s = maTrendRule({ candles, indicators: computeIndicators(candles) })!;
    expect(s.state).toBe('bullish');
    expect(s.strength).toBeGreaterThanOrEqual(85); // all 3 checks agree
    expectValidSignal(s);
  });

  it('is bearish on a sustained downtrend', () => {
    const candles = trendCandles(320, -1);
    const s = maTrendRule({ candles, indicators: computeIndicators(candles) })!;
    expect(s.state).toBe('bearish');
    expect(s.strength).toBeLessThan(100);
    expectValidSignal(s);
  });

  it('detects a golden cross from the latest two SMA pairs', () => {
    const candles = [candle(1, 100, 101, 99, 100), candle(2, 101, 102, 100, 101)];
    const indicators = mkIndicators({
      sma50: [line(1, 95), line(2, 105)], // was below SMA200, now above
      sma200: [line(1, 100), line(2, 100)],
    });
    const s = maTrendRule({ candles, indicators })!;
    expect(s.label).toContain('golden cross');
    expect(s.state).toBe('bullish');
    expect(s.evidence.join(' ')).toContain('golden cross');
    expectValidSignal(s);
  });

  it('detects a death cross from the latest two SMA pairs', () => {
    const candles = [candle(1, 100, 101, 99, 100), candle(2, 106, 107, 105, 106)];
    const indicators = mkIndicators({
      sma50: [line(1, 105), line(2, 95)], // was above, now below
      sma200: [line(1, 100), line(2, 100)],
    });
    const s = maTrendRule({ candles, indicators })!;
    expect(s.label).toContain('death cross');
    // Price is above both averages (2 of 3 checks true) but the SMA50/SMA200
    // structure has just broken, so the reading is a genuine toss-up.
    expect(s.state).toBe('neutral');
    expect(s.strength).toBeLessThanOrEqual(55);
    expect(s.evidence.join(' ')).toContain('death cross');
    expectValidSignal(s);
  });

  it('is bearish when the death cross coincides with price below both averages', () => {
    const candles = [candle(1, 100, 101, 99, 100), candle(2, 92, 93, 91, 92)];
    const indicators = mkIndicators({
      sma50: [line(1, 105), line(2, 97)], // now below SMA200 and above price
      sma200: [line(1, 100), line(2, 100)],
    });
    const s = maTrendRule({ candles, indicators })!;
    expect(s.state).toBe('bearish');
    expect(s.label).toContain('death cross');
    expectValidSignal(s);
  });

  it('is neutral when the signals conflict', () => {
    const candles = [candle(1, 100, 101, 99, 100)];
    const indicators = mkIndicators({
      sma50: [line(1, 78)], // price above
      sma200: [line(1, 130)], // price below; SMA50 also below SMA200 -> 1 of 3
    });
    const s = maTrendRule({ candles, indicators })!;
    expect(s.state).toBe('neutral');
    expect(s.evidence.join(' ')).toContain('1 of 3 trend checks agree');
    expectValidSignal(s);
  });

  it('returns null (not a fake reading) when SMA200 is unavailable', () => {
    const candles = trendCandles(10, 1);
    expect(maTrendRule({ candles, indicators: computeIndicators(candles) })).toBeNull();
  });
});

describe('R2 rsi', () => {
  const ctx = (value: number) => ({ candles: [], indicators: mkIndicators({ rsi14: [line(1, value)] }) });

  it('is bullish and labelled oversold below 30', () => {
    const s = rsiRule(ctx(22))!;
    expect(s.state).toBe('bullish');
    expect(s.label).toContain('oversold');
    expect(s.evidence.join(' ')).toContain('22.00');
    expectValidSignal(s);
  });

  it('is bearish and labelled overbought above 70', () => {
    const s = rsiRule(ctx(78))!;
    expect(s.state).toBe('bearish');
    expect(s.label).toContain('overbought');
    expectValidSignal(s);
  });

  it('is neutral between 30 and 70', () => {
    const s = rsiRule(ctx(50))!;
    expect(s.state).toBe('neutral');
    expect(s.label).toContain('balanced');
    expectValidSignal(s);
  });

  it('scales strength with distance past the threshold', () => {
    const mild = rsiRule(ctx(72))!.strength;
    const extreme = rsiRule(ctx(95))!.strength;
    expect(extreme).toBeGreaterThan(mild);
  });

  it('returns null with no RSI data', () => {
    expect(rsiRule({ candles: [], indicators: mkIndicators() })).toBeNull();
  });

  it('reads a real oversold market as oversold', () => {
    const candles = upThenDown(80, 40);
    const s = rsiRule({ candles, indicators: computeIndicators(candles) })!;
    expect(s.state).toBe('bullish');
    expect(s.evidence.join(' ')).toContain('RSI(14)');
  });
});

describe('R3 macd', () => {
  it('flags a bullish crossover and explains it', () => {
    const indicators = mkIndicators({
      macd: [
        { time: 1, macd: -1, signal: -0.5, histogram: -0.5 },
        { time: 2, macd: 0.8, signal: 0.3, histogram: 0.5 },
      ],
    });
    const s = macdRule({ candles: [candle(2, 1, 1, 1, 1)], indicators })!;
    expect(s.state).toBe('bullish');
    expect(s.label).toContain('bullish crossover');
    expect(s.evidence.join(' ')).toContain('crossover');
    expectValidSignal(s);
  });

  it('flags a bearish crossover', () => {
    const indicators = mkIndicators({
      macd: [
        { time: 1, macd: 1, signal: 0.5, histogram: 0.5 },
        { time: 2, macd: -0.4, signal: 0.1, histogram: -0.5 },
      ],
    });
    const s = macdRule({ candles: [candle(2, 1, 1, 1, 1)], indicators })!;
    expect(s.state).toBe('bearish');
    expect(s.label).toContain('bearish crossover');
    expectValidSignal(s);
  });

  it('falls back to "above/below signal" when there is no fresh cross', () => {
    const above = macdRule({
      candles: [candle(3, 1, 1, 1, 1)],
      indicators: mkIndicators({
        macd: [
          { time: 1, macd: 1, signal: 0.5, histogram: 0.5 },
          { time: 2, macd: 1.2, signal: 0.7, histogram: 0.5 },
          { time: 3, macd: 1.4, signal: 0.9, histogram: 0.5 },
        ],
      }),
    })!;
    expect(above.state).toBe('bullish');
    expect(above.label).toContain('above signal');
    expectValidSignal(above);
  });

  it('reports histogram direction as evidence', () => {
    const indicators = mkIndicators({
      macd: [
        { time: 1, macd: 0.1, signal: 0.5, histogram: -0.4 },
        { time: 2, macd: 0.2, signal: 0.5, histogram: -0.3 },
      ],
    });
    const s = macdRule({ candles: [candle(2, 1, 1, 1, 1)], indicators })!;
    expect(s.evidence.join(' ')).toContain('expanding upward');
  });

  it('returns null with no MACD data', () => {
    expect(macdRule({ candles: [], indicators: mkIndicators() })).toBeNull();
  });
});

describe('R4 bollinger', () => {
  it('reads a close near the upper band as stretched high (bearish)', () => {
    const indicators = mkIndicators({ bb: [{ time: 1, upper: 110, middle: 100, lower: 90 }] });
    const s = bollingerRule({ candles: [candle(1, 100, 110, 90, 109.5)], indicators })!;
    expect(s.state).toBe('bearish');
    expect(s.label).toContain('stretched high');
    expect(s.evidence.join(' ')).toContain('%B');
    expectValidSignal(s);
  });

  it('reads a close near the lower band as stretched low (bullish)', () => {
    const indicators = mkIndicators({ bb: [{ time: 1, upper: 110, middle: 100, lower: 90 }] });
    const s = bollingerRule({ candles: [candle(1, 100, 110, 90, 90.5)], indicators })!;
    expect(s.state).toBe('bullish');
    expect(s.label).toContain('stretched low');
    expectValidSignal(s);
  });

  it('is neutral in the middle of the band', () => {
    const indicators = mkIndicators({ bb: [{ time: 1, upper: 110, middle: 100, lower: 90 }] });
    const s = bollingerRule({ candles: [candle(1, 100, 110, 90, 100)], indicators })!;
    expect(s.state).toBe('neutral');
    expect(s.label).toContain('inside the range');
    expectValidSignal(s);
  });

  it('returns null when the band has zero width', () => {
    const indicators = mkIndicators({ bb: [{ time: 1, upper: 100, middle: 100, lower: 100 }] });
    expect(bollingerRule({ candles: [candle(1, 100, 100, 100, 100)], indicators })).toBeNull();
  });
});

describe('R5 volume', () => {
  function series(volumes: number[], closeUp: boolean): Candle[] {
    const closes = volumes.map((_, i) => 100 + i * 0.1);
    return closes.map((c, i) =>
      candle(i + 1, closeUp ? c - 1 : c + 1, c + 2, c - 2, c, volumes[i]),
    );
  }

  it('reports the volume ratio against the trailing 20-bar average', () => {
    // The 20-bar window includes the latest bar: (19 x 1.0M + 3.0M) / 20 = 1.1M.
    // Pin the exact ratio so the metric stays auditable from the evidence line.
    const vols = [...Array(24).fill(1_000_000), 3_000_000];
    const s = volumeRule({ candles: series(vols, true), indicators: mkIndicators() })!;
    expect(s.state).toBe('bullish');
    expect(s.label).toContain('confirming an up move');
    expect(s.evidence.join(' ')).toContain('2.73x');
    expectValidSignal(s);
  });

  it('confirms a down move on heavy volume (bearish)', () => {
    const vols = [...Array(24).fill(1_000_000), 3_000_000];
    const s = volumeRule({ candles: series(vols, false), indicators: mkIndicators() })!;
    expect(s.state).toBe('bearish');
    expect(s.label).toContain('confirming a down move');
    expectValidSignal(s);
  });

  it('reports quiet participation on low volume', () => {
    const vols = [...Array(24).fill(1_000_000), 200_000];
    const s = volumeRule({ candles: series(vols, true), indicators: mkIndicators() })!;
    expect(s.state).toBe('neutral');
    expect(s.label).toContain('quiet');
    expectValidSignal(s);
  });

  it('reports normal volume near the average', () => {
    const vols = [...Array(24).fill(1_000_000), 1_050_000];
    const s = volumeRule({ candles: series(vols, true), indicators: mkIndicators() })!;
    expect(s.label).toContain('normal');
    expectValidSignal(s);
  });

  it('returns null when there is not a full 20-bar window', () => {
    expect(volumeRule({ candles: series([1, 2, 3], true), indicators: mkIndicators() })).toBeNull();
  });
});

describe('R6 volatility squeeze', () => {
  /** Wild swings early, dead calm late -> the last bar is a low percentile. */
  function calmerTail(): Candle[] {
    const closes: number[] = [];
    let price = 100;
    for (let i = 0; i < 140; i += 1) {
      price *= i < 70 ? 1 + Math.sin(i) * 0.03 : 1.0002;
      closes.push(Number(price.toFixed(4)));
    }
    return candlesFromCloses(closes);
  }

  it('detects a squeeze when band width is in the lowest percentiles', () => {
    const s = squeezeRule({ candles: calmerTail(), indicators: mkIndicators() })!;
    expect(s.label).toContain('squeezed');
    expect(s.state).toBe('neutral');
    expect(s.evidence.join(' ')).toContain('Percentile');
    expectValidSignal(s);
  });

  it('detects expansion when band width is in the highest percentiles', () => {
    // Widening saw-tooth whose amplitude escalates, so the final bar is the
    // widest in the window by a clear margin.
    const closes: number[] = [];
    let price = 100;
    for (let i = 0; i < 200; i += 1) {
      const amp = i < 120 ? 0.002 : 0.02 + (i - 120) * 0.004;
      price *= 1 + (i % 2 === 0 ? amp : -amp * 0.6);
      closes.push(Number(price.toFixed(4)));
    }
    const s = squeezeRule({ candles: candlesFromCloses(closes), indicators: mkIndicators() })!;
    expect(s.label).toContain('expanded');
    expectValidSignal(s);
  });

  it('returns null without enough width history', () => {
    expect(squeezeRule({ candles: trendCandles(25, 1), indicators: mkIndicators() })).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe('evaluateSignals + summarize', () => {
  it('produces every rule once on a long real-shaped series and all are valid', () => {
    const candles = wobbleCandles(400);
    const signals = evaluateSignals({ candles, indicators: computeIndicators(candles) });
    const ids = signals.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length); // no duplicates
    expect(ids).toEqual(expect.arrayContaining(['ma-trend', 'rsi', 'macd', 'bollinger', 'volume', 'squeeze']));
    signals.forEach(expectValidSignal);
  });

  it('omits rules that lack data rather than inventing a reading', () => {
    const candles = trendCandles(30, 1); // too short for SMA200 / squeeze
    const signals = evaluateSignals({ candles, indicators: computeIndicators(candles) });
    const ids = signals.map((s) => s.id);
    expect(ids).not.toContain('ma-trend');
    expect(ids).not.toContain('squeeze');
    expect(ids).toContain('rsi'); // this one only needs 15 bars
  });

  it('caps the ma-trend strength when the reading is only a toss-up', () => {
    const candles = [candle(1, 100, 101, 99, 100)];
    const indicators = mkIndicators({
      sma50: [line(1, 78)], // price above (1 of 3)
      sma200: [line(1, 130)], // price below
    });
    const s = maTrendRule({ candles, indicators })!;
    expect(s.state).toBe('neutral');
    expect(s.strength).toBeLessThanOrEqual(55);
  });

  it('only reports a high ma-trend strength when all checks agree', () => {
    const candles = trendCandles(320, 1);
    const s = maTrendRule({ candles, indicators: computeIndicators(candles) })!;
    expect(s.state).toBe('bullish');
    expect(s.strength).toBeGreaterThan(75);
  });

  it('returns an empty list (never a fabricated signal) for empty input', () => {
    expect(evaluateSignals({ candles: [], indicators: mkIndicators() })).toEqual([]);
  });

  it('is deterministic: identical input yields identical output', () => {
    const candles = wobbleCandles(300);
    const a = evaluateSignals({ candles, indicators: computeIndicators(candles) });
    const b = evaluateSignals({ candles, indicators: computeIndicators(candles) });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('summarize tallies states and keeps the score within 0-100', () => {
    const signals = evaluateSignals({
      candles: wobbleCandles(400),
      indicators: computeIndicators(wobbleCandles(400)),
    });
    const sum = summarize(signals);
    expect(sum.bullish + sum.bearish + sum.neutral).toBe(signals.length);
    expect(sum.score).toBeGreaterThanOrEqual(0);
    expect(sum.score).toBeLessThanOrEqual(100);
    expect(sum.verdict).toBeTruthy();
  });

  it('summarize leans bullishly when every signal is bullish and strongly', () => {
    const bull: Signal[] = ['a', 'b'].map((id) => sig({ id, state: 'bullish', strength: 90 }));
    const sum = summarize(bull);
    expect(sum.score).toBeGreaterThan(65);
    expect(sum.verdict).toContain('bullish');
  });

  it('summarize reports no edge when signals disagree evenly', () => {
    const mixed: Signal[] = [
      sig({ id: 'a', state: 'bullish', strength: 50 }),
      sig({ id: 'b', state: 'bearish', strength: 50 }),
    ];
    expect(summarize(mixed).score).toBe(50);
    expect(summarize(mixed).verdict).toContain('Mixed');
  });

  it('summarize handles no signals', () => {
    const sum = summarize([]);
    expect(sum.score).toBe(50);
    expect(sum.verdict).toContain('Not enough data');
  });
});
