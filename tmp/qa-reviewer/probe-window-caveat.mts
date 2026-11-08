/**
 * Independent QA probe — the builder's self-reported `windowCandles` caveat.
 *
 * `windowCandles` does `return windowed.length ? windowed : candles`. If NO
 * cached bar falls inside the requested window (newest bar older than
 * `now - rangeSeconds`), it returns the input UNFILTERED. This probe asks: what
 * does a 1y `loadRatings` return when the cache is entirely out of window, and
 * is the result wrong / flagged?
 */
import { openDb, recordFetch, saveCandles, saveMeta } from '../../server/db';
import { loadRatings } from '../../server/phase3-service';
import type { Candle, SymbolMeta } from '../../shared/types';

const DAY = 86400;
const REAL_NOW = Math.floor(Date.now() / 1000);

function dailyCandles(n: number, end: number): Candle[] {
  const out: Candle[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const t = end - i * DAY;
    const close = 100 + ((n - 1 - i) / (n - 1)) * 100;
    out.push({ time: t, open: close, high: close, low: close, close, volume: 1_000_000 });
  }
  return out;
}

const META: SymbolMeta = {
  symbol: 'AAPL', name: 'Apple Inc.', currency: 'USD', exchange: 'NasdaqGS',
  exchangeTimezone: 'America/New_York', lastPrice: 200, previousClose: 199, change: 1,
  changePercent: 0.5, dayHigh: 201, dayLow: 198, fiftyTwoWeekHigh: 210,
  fiftyTwoWeekLow: 150, volume: 1_000_000, marketTime: REAL_NOW,
};

async function run(label: string, newestBarAgeDays: number) {
  const db = openDb(':memory:');
  // Newest bar sits `newestBarAgeDays` in the past. Make the whole series end
  // there, so a 1y request has ZERO bars inside the window when age > 365.
  const end = REAL_NOW - newestBarAgeDays * DAY;
  const candles = dailyCandles(2513, end);
  const old = end; // recordFetch old enough to be past TTL
  saveCandles(db, 'AAPL', '1d', candles);
  saveMeta(db, META, old);
  recordFetch(db, 'AAPL', '1d', old, 'live', candles.length, 'max', META);

  const failingFetch = (async () => {
    throw new Error('simulated upstream outage');
  }) as unknown as typeof fetch;

  const r = await loadRatings(db, 'AAPL', { fetchImpl: failingFetch });
  console.log(JSON.stringify({
    scenario: label,
    newestBarAgeDays,
    source: r.source,
    oneYearReturn_pct: r.oneYearReturn === null ? null : Number((r.oneYearReturn * 100).toFixed(2)),
  }));
  db.close();
}

async function main() {
  await run('in-window (recent bars present)', 5);
  await run('fully out-of-window (newest bar 400d old)', 400);
}

void main();
