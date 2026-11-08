/**
 * Independent QA probe — does `loadSeries` still return an un-windowed series
 * on the STALE-CACHE path?
 *
 * The F-1 fix windowed the cache-FRESH branch. The stale fallback (reached when
 * the cache is older than the TTL and the live fetch then fails) still returns
 * `getCandles(...)` raw. If so, `loadOneYearReturn` would again read a
 * decade-old close whenever Yahoo is unreachable and a deep cache is present.
 *
 * Uses the REAL `loadSeries`; no product code is modified.
 */
import { openDb, recordFetch, saveCandles, saveMeta } from '../../server/db';
import { loadSeries } from '../../server/market-service';
import type { Candle, SymbolMeta } from '../../shared/types';

const DAY = 86400;
const NOW = 1_800_000_000;
const TTL_MS = 5 * 60 * 1000; // not needed; staleness is by `now - lastUpdated > ttl`

function dailyCandles(n: number, now = NOW): Candle[] {
  const out: Candle[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const t = now - i * DAY;
    const close = 100 + ((n - 1 - i) / (n - 1)) * 100; // 100 → 200
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
  const candles = dailyCandles(2513);
  // Seed a DEEP cache as Signals would, but stamp it OLD so it is not fresh.
  const old = NOW - 10 * DAY; // 10 days ago; the 1d TTL is far shorter
  saveCandles(db, 'AAPL', '1d', candles);
  saveMeta(db, META, old);
  recordFetch(db, 'AAPL', '1d', old, 'live', candles.length, 'max', META);

  const failingFetch = (async () => {
    throw new Error('simulated upstream outage');
  }) as unknown as typeof fetch;

  const series = await loadSeries(db, 'AAPL', { range: '1y', interval: '1d', now: NOW, fetchImpl: failingFetch });

  const first = series.candles[0];
  const ageDays = Math.round((NOW - first.time) / DAY);
  const ret = ((series.candles.at(-1)!.close - first.close) / first.close) * 100;

  console.log(JSON.stringify({
    source: series.source,
    range: series.range,
    candles: series.candles.length,
    firstBarAgeDays: ageDays,
    impliedReturnPct: Number(ret.toFixed(2)),
    WINDOWED: series.candles.length < 400,
  }, null, 2));
  db.close();
}

void main();
