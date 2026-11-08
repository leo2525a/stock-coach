/**
 * Independent QA probe — end-to-end residual check for F-1 on the STALE path.
 *
 * Calls the REAL `loadRatings` (the function behind `GET /api/ratings/:sym`)
 * with (a) a deep 10-year daily cache that is older than the 1h TTL and (b) an
 * upstream fetch that fails. If `loadSeries`' stale branch returns the raw
 * un-windowed series, `oneYearReturn` becomes the decade change (~+100% here)
 * instead of the 1-year change (~+3.4%).
 */
import { openDb, recordFetch, saveCandles, saveMeta } from '../../server/db';
import { loadRatings } from '../../server/phase3-service';
import type { Candle, SymbolMeta } from '../../shared/types';

const DAY = 86400;
// Seed relative to the REAL clock so the cache is genuinely older than the 1h TTL.
const NOW = Math.floor(Date.now() / 1000) - 10 * DAY;

function dailyCandles(n: number, now = NOW): Candle[] {
  const out: Candle[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const t = now - i * DAY;
    const close = 100 + ((n - 1 - i) / (n - 1)) * 100;
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

function expectedOneYear(candles: Candle[]): number {
  const realNow = Math.floor(Date.now() / 1000);
  const w = candles.filter((c) => c.time >= realNow - 365 * DAY);
  return (w.at(-1)!.close - w[0].close) / Math.abs(w[0].close);
}

async function main() {
  const db = openDb(':memory:');
  const candles = dailyCandles(2513);
  const old = NOW - 10 * DAY; // far past the 1h daily TTL
  saveCandles(db, 'AAPL', '1d', candles);
  saveMeta(db, META, old);
  recordFetch(db, 'AAPL', '1d', old, 'live', candles.length, 'max', META);

  const failingFetch = (async () => {
    throw new Error('simulated upstream outage');
  }) as unknown as typeof fetch;

  // NOTE: `loadRatings` computes staleness against the real clock (it does not
  // forward `now` into `loadSeries`), so we do not pass `now` here either.
  const r = await loadRatings(db, 'AAPL', { fetchImpl: failingFetch });
  const expected = expectedOneYear(candles);
  console.log(JSON.stringify({
    source: r.source,
    oneYearReturn_observed: r.oneYearReturn,
    oneYearReturn_observed_pct: r.oneYearReturn === null ? null : Number((r.oneYearReturn * 100).toFixed(2)),
    oneYearReturn_expected_pct: Number((expected * 100).toFixed(2)),
    CORRECT: r.oneYearReturn !== null && Math.abs(r.oneYearReturn - expected) < 0.02,
  }, null, 2));
  db.close();
}

void main();
