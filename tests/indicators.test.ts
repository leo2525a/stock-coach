import { describe, expect, it } from 'vitest';
import {
  bollinger,
  bbWidthPercent,
  computeIndicators,
  ema,
  macd,
  rsi,
  sma,
  atr,
  INDICATOR_PARAMS,
} from '../shared/indicators';
import { candlesFromCloses, trendCandles, upThenDown, wobbleCandles } from './helpers';

/**
 * The key property under test is **alignment**: every indicator point must
 * carry the timestamp of the candle it was derived from. If this ever breaks,
 * the chart silently draws lines against the wrong x positions.
 */

describe('indicator alignment', () => {
  it('sma returns points tail-aligned to the candles, with matching times', () => {
    const candles = trendCandles(60, 1);
    const out = sma(candles, 20);
    expect(out).toHaveLength(candles.length - 20 + 1);
    // Last point must belong to the last candle.
    expect(out.at(-1)!.time).toBe(candles.at(-1)!.time);
    // First point must belong to candle index 19 (period - 1).
    expect(out[0].time).toBe(candles[19].time);
    // Times must be strictly increasing (no duplicates / reordering).
    for (let i = 1; i < out.length; i += 1) expect(out[i].time).toBeGreaterThan(out[i - 1].time);
  });

  it('ema has the same alignment contract as sma', () => {
    const candles = wobbleCandles(80);
    const out = ema(candles, 12);
    expect(out.at(-1)!.time).toBe(candles.at(-1)!.time);
    expect(out[0].time).toBe(candles[11].time);
  });

  it('rsi is tail-aligned and needs period + 1 closes', () => {
    const candles = wobbleCandles(50);
    const out = rsi(candles, 14);
    expect(out.at(-1)!.time).toBe(candles.at(-1)!.time);
    expect(out).toHaveLength(candles.length - 14);
  });

  it('macd drops warmup rows so every point has macd, signal and histogram', () => {
    const candles = wobbleCandles(120);
    const out = macd(candles);
    expect(out.length).toBeGreaterThan(0);
    for (const p of out) {
      expect(Number.isFinite(p.macd)).toBe(true);
      expect(Number.isFinite(p.signal)).toBe(true);
      expect(Number.isFinite(p.histogram)).toBe(true);
    }
    expect(out.at(-1)!.time).toBe(candles.at(-1)!.time);
  });

  it('bollinger returns upper >= middle >= lower for every point', () => {
    const candles = wobbleCandles(120);
    const out = bollinger(candles);
    expect(out.length).toBeGreaterThan(0);
    for (const b of out) {
      expect(b.upper).toBeGreaterThanOrEqual(b.middle);
      expect(b.middle).toBeGreaterThanOrEqual(b.lower);
    }
    expect(out.at(-1)!.time).toBe(candles.at(-1)!.time);
  });
});

describe('indicator maths', () => {
  it('sma equals the arithmetic mean of the trailing window', () => {
    const closes = [10, 20, 30, 40, 50];
    const candles = candlesFromCloses(closes);
    const out = sma(candles, 3);
    expect(out).toHaveLength(3);
    expect(out[0].value).toBeCloseTo((10 + 20 + 30) / 3, 6);
    expect(out[1].value).toBeCloseTo((20 + 30 + 40) / 3, 6);
    expect(out[2].value).toBeCloseTo((30 + 40 + 50) / 3, 6);
  });

  it('ema weights recent values more heavily than sma', () => {
    const closes = [10, 10, 10, 10, 10, 10, 10, 10, 10, 100];
    const candles = candlesFromCloses(closes);
    const e = ema(candles, 5).at(-1)!.value;
    const s = sma(candles, 5).at(-1)!.value;
    expect(e).toBeGreaterThan(s);
  });

  it('rsi of a pure uptrend is 100 and of a pure downtrend is 0', () => {
    const up = candlesFromCloses(Array.from({ length: 30 }, (_, i) => 100 + i));
    const down = candlesFromCloses(Array.from({ length: 30 }, (_, i) => 100 - i));
    expect(rsi(up, 14).at(-1)!.value).toBeCloseTo(100, 4);
    expect(rsi(down, 14).at(-1)!.value).toBeCloseTo(0, 4);
  });

  it('rsi sits in the oversold zone after a sharp fall', () => {
    const candles = upThenDown(80, 40);
    const value = rsi(candles, 14).at(-1)!.value;
    expect(value).toBeLessThan(30);
  });

  it('macd histogram equals macd minus signal', () => {
    const candles = wobbleCandles(150);
    for (const p of macd(candles)) {
      expect(p.histogram).toBeCloseTo(p.macd - p.signal, 6);
    }
  });

  it('bollinger middle band equals the sma of the same period', () => {
    const candles = wobbleCandles(60);
    const bb = bollinger(candles, 20, 2);
    const s = sma(candles, 20);
    // Both are tail-aligned to the same candles, so they share a tail.
    const bbTail = bb.slice(-3);
    const smaTail = s.slice(-3);
    bbTail.forEach((b, i) => expect(b.middle).toBeCloseTo(smaTail[i].value, 6));
  });

  it('bb width grows when volatility grows', () => {
    const calm = candlesFromCloses(Array.from({ length: 60 }, (_, i) => 100 + (i % 2) * 0.1));
    const wild = candlesFromCloses(Array.from({ length: 60 }, (_, i) => 100 + (i % 2) * 20));
    const calmWidth = bbWidthPercent(calm).at(-1)!.value;
    const wildWidth = bbWidthPercent(wild).at(-1)!.value;
    expect(wildWidth).toBeGreaterThan(calmWidth);
  });

  it('atr is strictly positive for real price data', () => {
    const candles = wobbleCandles(60);
    const value = atr(candles, 14).at(-1)!.value;
    expect(value).toBeGreaterThan(0);
  });
});

describe('indicator edge cases', () => {
  it('returns an empty array (never throws, never fakes) when data is too short', () => {
    const candles = trendCandles(5, 1);
    expect(sma(candles, 50)).toEqual([]);
    expect(ema(candles, 20)).toEqual([]);
    expect(rsi(candles, 14)).toEqual([]);
    expect(macd(candles)).toEqual([]);
    expect(bollinger(candles)).toEqual([]);
    expect(atr(candles, 14)).toEqual([]);
  });

  it('handles an empty candle array', () => {
    expect(sma([], 20)).toEqual([]);
    expect(rsi([], 14)).toEqual([]);
    expect(macd([])).toEqual([]);
  });

  it('computeIndicators never throws and keeps every line aligned', () => {
    const candles = wobbleCandles(300);
    const ind = computeIndicators(candles);
    expect(ind.sma200.length).toBeGreaterThan(0);
    const lastTime = candles.at(-1)!.time;
    for (const [name, line] of Object.entries(ind)) {
      if (name === 'bb' || name === 'macd') continue;
      if ((line as unknown[]).length === 0) continue;
      expect((line as Array<{ time: number }>).at(-1)!.time, `${name} tail time`).toBe(lastTime);
    }
    expect(ind.bb.at(-1)!.time).toBe(lastTime);
    expect(ind.macd.at(-1)!.time).toBe(lastTime);
  });

  it('exposes its parameter set so the UI can disclose what it used', () => {
    expect(INDICATOR_PARAMS.sma).toEqual([20, 50, 200]);
    expect(INDICATOR_PARAMS.rsi).toBe(14);
  });
});
