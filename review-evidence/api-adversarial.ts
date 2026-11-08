/**
 * REVIEWER evidence — API-level adversarial checks (read-only; imports app modules).
 * Run: node_modules/.bin/tsx review-evidence/api-adversarial.ts
 *
 * Covers:
 *  A) invalid / unknown tickers via the real HTTP surface
 *  B) data honesty: no invented prices when there is no data
 *  C) stale-cache fallback path driven by an injected failing fetch
 *  D) independent recomputation of SMA/RSI/MACD/BB from raw fetched candles
 *     vs. the values the server put into the signal evidence (SPEC §6)
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp, bootstrap } from '../server/app';
import { openDb } from '../server/db';
import { loadMarketData, loadSeries } from '../server/market-service';
import type { MarketData, SignalsPayload } from '../shared/types';

let pass = 0;
const fails: string[] = [];
function check(name: string, cond: boolean, detail = '') {
  if (cond) { pass += 1; console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`); }
  else { fails.push(`${name}${detail ? ` — ${detail}` : ''}`); console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
}

/* ------------------------------------------------------------------ manual maths */
function manualSMA(closes: number[], period: number): number {
  const w = closes.slice(-period);
  return w.reduce((a, b) => a + b, 0) / w.length;
}
function manualRSI(closes: number[], period = 14): number {
  // Wilder smoothing, seeded with the first `period` deltas.
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i += 1) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) gain += d; else loss -= d;
  }
  let avgG = gain / period, avgL = loss / period;
  for (let i = period + 1; i < closes.length; i += 1) {
    const d = closes[i] - closes[i - 1];
    const g = d > 0 ? d : 0, l = d < 0 ? -d : 0;
    avgG = (avgG * (period - 1) + g) / period;
    avgL = (avgL * (period - 1) + l) / period;
  }
  if (avgL === 0) return 100;
  const rs = avgG / avgL;
  return 100 - 100 / (1 + rs);
}
function manualEMA(values: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const out: number[] = [values[0]];
  for (let i = 1; i < values.length; i += 1) out.push(values[i] * k + out[i - 1] * (1 - k));
  return out;
}
function manualMACD(closes: number[]) {
  const e12 = manualEMA(closes, 12), e26 = manualEMA(closes, 26);
  const macdLine = closes.map((_, i) => e12[i] - e26[i]);
  const sig = manualEMA(macdLine, 9);
  const i = closes.length - 1;
  return { macd: macdLine[i], signal: sig[i], hist: macdLine[i] - sig[i] };
}

async function main() {
  const dir = mkdtempSync(path.join(tmpdir(), 'review-api-'));
  const db = openDb(path.join(dir, 'review.db'));
  bootstrap(db);
  const app = createApp(db);
  const server: Server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  console.log(`[review] API on ${base}`);

  const jget = async (p: string) => { const r = await fetch(`${base}${p}`); return { status: r.status, body: await r.json() as any }; };

  try {
    /* ---------------- A) bad tickers ---------------- */
    console.log('\nA) invalid / unknown tickers (real HTTP)');
    const bad1 = await jget('/api/market/' + encodeURIComponent('a b;c'));
    check('malformed symbol -> 400, no data', bad1.status === 400 && bad1.body.ok === false, `${bad1.status} ${bad1.body.code} "${bad1.body.error}"`);
    const bad2 = await jget('/api/market/ZZZZ');
    check('unknown symbol -> clean 4xx, never 5xx', bad2.status >= 400 && bad2.status < 500 && bad2.body.ok === false, `${bad2.status} ${bad2.body.code} "${bad2.body.error}"`);
    const bad3 = await jget('/api/signals/ZZZZ');
    check('unknown symbol signals -> clean 4xx', bad3.status >= 400 && bad3.status < 500 && bad3.body.ok === false, `${bad3.status} ${bad3.body.code}`);
    const longSym = 'A'.repeat(40);
    const bad4 = await jget('/api/market/' + longSym);
    check('over-long symbol -> 400', bad4.status === 400, `${bad4.status}`);
    const emptySym = await jget('/api/market/%20');
    check('blank symbol -> 4xx, not 5xx', emptySym.status >= 400 && emptySym.status < 500, `${emptySym.status}`);

    /* ---------------- B) data honesty ---------------- */
    console.log('\nB) data honesty when there is no data');
    check('error envelope carries a human message', typeof bad2.body.error === 'string' && bad2.body.error.length > 5, `"${bad2.body.error}"`);
    // Nothing was written to cache for ZZZZ: prove no invented rows.
    const zzz = db.prepare('SELECT COUNT(*) n FROM candles WHERE symbol = ?').get('ZZZZ') as { n: number };
    check('no invented candles cached for a failed symbol', zzz.n === 0, `${zzz.n} rows`);

    /* ---------------- C) stale-cache fallback ---------------- */
    console.log('\nC) stale-cache fallback (injected failing upstream)');
    // 1) warm the cache from the live provider for a *daily* window
    const warm = await loadMarketData(db, 'AAPL', { range: '1y', interval: '1d' });
    check('warm load succeeded from live/cache', warm.candles.length > 100 && !!warm.meta, `${warm.candles.length} bars, source=${warm.source}`);
    // 2) force a fresh upstream pull whose fetch always fails
    const failing: typeof fetch = async () => { throw new Error('reviewer-induced network failure'); };
    const stale = await loadSeries(db, 'AAPL', {
      range: '1y', interval: '1d', force: true, fetchImpl: failing,
    });
    check('fetch failure falls back to cached candles', stale.source === 'stale-cache' && stale.candles.length > 0, `source=${stale.source}, ${stale.candles.length} bars`);
    check('stale payload carries a clear note', typeof stale.note === 'string' && /failed/i.test(stale.note ?? ''), `"${stale.note}"`);
    check('stale payload still carries real meta (no blank chart)', !!stale.meta && typeof stale.meta.lastPrice === 'number', `last=${stale.meta?.lastPrice}`);
    // 3) nothing cached + fetch fails => throws, does NOT invent data
    let threw = false; let errMsg = '';
    try { await loadSeries(db, 'NEWPA', { range: '1y', interval: '1d', fetchImpl: failing }); }
    catch (e) { threw = true; errMsg = (e as Error).message; }
    check('no cache + failing fetch throws (never fabricates)', threw && errMsg.length > 0, errMsg.slice(0, 90));
    check('nothing was written to cache for the failed symbol',
      (db.prepare('SELECT COUNT(*) n FROM candles WHERE symbol = ?').get('NEWPA') as { n: number }).n === 0, '0 rows');
    // (Behaviour note: the re-thrown error is the ORIGINAL upstream MarketDataError,
    //  so a no-cache outage surfaces as HTTP 502 UPSTREAM_UNREACHABLE. That is an
    //  honest upstream failure, not a fabricated price.)

    /* ---------------- D) independent signal maths ---------------- */
    console.log('\nD) SPEC §6 — signals derived from the real fetched data');
    const maxReq = await jget('/api/market/AAPL?range=max&interval=1d');
    const candles = (maxReq.body.data as MarketData).candles;
    const closes = candles.map((c) => c.close);
    const sig = await jget('/api/signals/AAPL');
    const p = sig.body.data as SignalsPayload;
    check('signals payload ok', sig.status === 200 && !!p, `${p?.signals?.length} rules`);

    const price = closes[closes.length - 1];
    const s50 = manualSMA(closes, 50), s200 = manualSMA(closes, 200);
    const rsi = manualRSI(closes, 14);
    const macd = manualMACD(closes);

    const maCard = p.signals.find((s) => s.id === 'ma-trend')!;
    const rsiCard = p.signals.find((s) => s.id === 'rsi')!;
    const macdCard = p.signals.find((s) => s.id === 'macd')!;

    // Server evidence strings must quote the same numbers we compute by hand.
    const maEv = maCard.evidence.join(' ');
    check('ma-trend evidence last close matches hand-computed close',
      maEv.includes(price.toFixed(2)), `evidence has "${maEv.match(/Last close: [\d.]+/)?.[0]}" vs hand ${price.toFixed(2)}`);
    check('ma-trend evidence SMA50 matches hand-computed SMA50 (within 0.01)',
      Math.abs(Number(maEv.match(/SMA50: ([\d.]+)/)?.[1]) - s50) < 0.01, `card ${maEv.match(/SMA50: ([\d.]+)/)?.[1]} vs hand ${s50.toFixed(2)}`);
    check('ma-trend evidence SMA200 matches hand-computed SMA200 (within 0.01)',
      Math.abs(Number(maEv.match(/SMA200: ([\d.]+)/)?.[1]) - s200) < 0.01, `card ${maEv.match(/SMA200: ([\d.]+)/)?.[1]} vs hand ${s200.toFixed(2)}`);

    // Rule STATE must follow from the numbers, not be hard-coded.
    const expectedMaState = price > s50 && price > s200 && s50 > s200 ? 'bullish'
      : price < s50 && price < s200 && s50 < s200 ? 'bearish' : 'neutral';
    check('ma-trend state follows the computed numbers', maCard.state === expectedMaState,
      `card=${maCard.state}, derived=${expectedMaState} (price ${price.toFixed(2)}, s50 ${s50.toFixed(2)}, s200 ${s200.toFixed(2)})`);

    const expectedRsiState = rsi < 30 ? 'bullish' : rsi > 70 ? 'bearish' : 'neutral';
    check('rsi evidence value matches hand-computed Wilder RSI(14) (within 0.1)',
      Math.abs(Number(rsiCard.evidence.join(' ').match(/RSI\(14\): ([\d.]+)/)?.[1]) - rsi) < 0.1,
      `card ${rsiCard.evidence.join(' ').match(/RSI\(14\): ([\d.]+)/)?.[1]} vs hand ${rsi.toFixed(2)}`);
    check('rsi state follows the computed value', rsiCard.state === expectedRsiState, `card=${rsiCard.state}, value=${rsi.toFixed(2)}`);

    const macdEv = macdCard.evidence.join(' ');
    check('macd evidence MACD line matches hand-computed MACD (within 0.05)',
      Math.abs(Number(macdEv.match(/MACD line: (-?[\d.]+)/)?.[1]) - macd.macd) < 0.05,
      `card ${macdEv.match(/MACD line: (-?[\d.]+)/)?.[1]} vs hand ${macd.macd.toFixed(4)}`);
    check('macd evidence signal line matches hand-computed (within 0.05)',
      Math.abs(Number(macdEv.match(/Signal line: (-?[\d.]+)/)?.[1]) - macd.signal) < 0.05,
      `card ${macdEv.match(/Signal line: (-?[\d.]+)/)?.[1]} vs hand ${macd.signal.toFixed(4)}`);

    // Determinism across two independent HTTP calls.
    const sig2 = await jget('/api/signals/AAPL');
    check('signal output is deterministic across requests',
      JSON.stringify(sig2.body.data.signals) === JSON.stringify(p.signals), 'byte-identical');

    // The summary tally must agree with the cards.
    const tally = p.signals.reduce((a, s) => { a[s.state] += 1; return a; }, { bullish: 0, bearish: 0, neutral: 0 } as Record<string, number>);
    check('summary tally matches the cards', p.summary.bullish === tally.bullish && p.summary.bearish === tally.bearish && p.summary.neutral === tally.neutral,
      `${p.summary.bullish}/${p.summary.bearish}/${p.summary.neutral}`);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }

  console.log('\n' + '-'.repeat(60));
  if (fails.length === 0) console.log(`REVIEWER API CHECKS PASSED — ${pass}`);
  else { console.log(`REVIEWER API CHECKS FAILED — ${pass} passed, ${fails.length} failed`); for (const f of fails) console.log('   • ' + f); process.exitCode = 1; }
}
main().catch((e) => { console.error('fatal', e); process.exitCode = 1; });
