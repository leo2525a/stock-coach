/**
 * Independent QA probe — realistic partial outage for the F-1 residual.
 *
 * The analyst BUNDLE (quoteSummary, crumb-authenticated) succeeds, but the
 * crumb-free CHART endpoint fails. That is the case where the ratings panel has a
 * live bundle (so it renders the whole panel, including the 1Y return row) while
 * the price series must come from the stale cache.
 *
 * With a deep, stale daily cache the stale branch returns the raw un-windowed
 * series, so the 1Y return becomes the decade change.
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, recordFetch, saveCandles, saveMeta } from '../../server/db';
import { loadRatings } from '../../server/phase3-service';
import type { Candle, SymbolMeta } from '../../shared/types';

const DAY = 86400;
const REAL_NOW = Math.floor(Date.now() / 1000);
const NOW = REAL_NOW - 10 * DAY; // stale seed
const QUOTE = JSON.parse(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../tests/fixtures/quotesummary-AAPL.json'), 'utf8'));

function dailyCandles(n: number, end: number): Candle[] {
  const out: Candle[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const t = end - i * DAY;
    const close = 100 + ((n - 1 - i) / (n - 1)) * 100; // 100 → 200 over the decade
    out.push({ time: t, open: close, high: close, low: close, close, volume: 1_000_000 });
  }
  return out;
}

const META: SymbolMeta = {
  symbol: 'AAPL', name: 'Apple Inc.', currency: 'USD', exchange: 'NasdaqGS',
  exchangeTimezone: 'America/New_York', lastPrice: 200, previousClose: 199, change: 1,
  changePercent: 0.5, dayHigh: 201, dayLow: 198, fiftyTwoWeekHigh: 210,
  fiftyTwoWeekLow: 150, volume: 1_000_000, marketTime: NOW,
};

async function main() {
  const db = openDb(':memory:');
  const candles = dailyCandles(2513, NOW);
  saveCandles(db, 'AAPL', '1d', candles);
  saveMeta(db, META, NOW);
  recordFetch(db, 'AAPL', '1d', NOW, 'live', candles.length, 'max', META);

  // Bundle works; the chart endpoint (crumb-free price history) fails.
  const impl = (async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes('/v1/test/getcrumb')) return new Response('abc123.Crumb', { status: 200, headers: { 'set-cookie': 'A3=c; Path=/' } });
    if (url.includes('fc.yahoo.com')) return new Response('', { status: 200, headers: { 'set-cookie': 'A1=p; Path=/' } });
    if (url.includes('/v10/finance/quoteSummary/')) return new Response(JSON.stringify(QUOTE), { status: 200 });
    // Any chart/fundamentals call fails.
    return new Response('upstream down', { status: 503 });
  }) as unknown as typeof fetch;

  const r = await loadRatings(db, 'AAPL', { fetchImpl: impl });
  const w = candles.filter((c) => c.time >= REAL_NOW - 365 * DAY);
  const expected = (w.at(-1)!.close - w[0].close) / Math.abs(w[0].close);

  console.log(JSON.stringify({
    source: r.source,
    hasBundle: r.ratings.buckets.length > 0,
    targetMean: r.target.mean,
    oneYearReturn_observed_pct: r.oneYearReturn === null ? null : Number((r.oneYearReturn * 100).toFixed(2)),
    oneYearReturn_expected_pct: Number((expected * 100).toFixed(2)),
    CORRECT: r.oneYearReturn !== null && Math.abs(r.oneYearReturn - expected) < 0.02,
  }, null, 2));
  db.close();
}

void main();
