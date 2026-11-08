/**
 * QA probe 12 — (1) debt-leg SIGN independence, (2) independent KO growth
 * recompute, (3) the history route's schedule for the duplicate-row defect.
 */
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp, bootstrap } from '../../server/app';
import { openDb } from '../../server/db';
import {
  deriveShareholderYield, deriveGrowth, yearlyTotals, parseDividendEvents,
  annualSeries, consecutiveIncreases, growthOver,
} from '../../shared/dividends';

console.log('=== (1) debt-leg sign: cases the shipped fix does NOT pin ===');
const mcap = 1_000_000_000; // 1B, round numbers so the sign is obvious
const cases: Array<[string, number, number, 'negative' | 'positive' | 'zero']> = [
  ['net ISSUANCE (KO FY25 shape)', -4_967_000_000, 4_980_000_000, 'negative'],
  ['net ISSUANCE larger (IBM shape)', -5_489_000_000, 8_391_000_000, 'negative'],
  ['gross PAYDOWN (payments > issuance)', -10_000_000_000, 3_000_000_000, 'positive'],
  ['exactly net zero', -4_000_000_000, 4_000_000_000, 'zero'],
];
for (const [name, pay, iss, want] of cases) {
  const sy = deriveShareholderYield({
    dividendsPaid: 0, repurchaseOfStock: 0, longTermDebtPayments: pay,
    longTermDebtIssuance: iss, sharesAtFyEnd: 1, priceAtFyEnd: mcap, asOf: '2026-09-30',
  });
  const v = sy.debtPaydownPart.value!;
  const sign = v > 0 ? 'positive' : v < 0 ? 'negative' : 'zero';
  console.log(`  ${sign === want ? 'OK  ' : 'FAIL'} ${name}: |pay|-|iss|=${Math.abs(pay) - Math.abs(iss)} -> value=${v} (${sign}, want ${want})`);
  // and the naive abs(payments - issuance) the spec forbids:
  const naive = Math.abs(pay - iss) / mcap;
  console.log(`       (forbidden naive abs(pay-iss)/mcap would be +${naive})`);
}

console.log('\n=== (2) KO growth: independent recompute from the captured chart ===');
const ko = JSON.parse(readFileSync('review-evidence/recon-phase4/out/div-KO-max.json', 'utf8'));
const events = parseDividendEvents({ chart: { result: [{ events: { dividends: ko } }] } });
const NOW = 1793980336;
const NOW_YEAR = new Date(NOW * 1000).getUTCFullYear();
console.log('KO chart events:', events.length, 'first', new Date(events[0].date * 1000).toISOString().slice(0, 10), 'last', new Date(events.at(-1).date * 1000).toISOString().slice(0, 10));
const totals = yearlyTotals(events);
const last6 = [...totals.keys()].sort((a, b) => a - b).slice(-8);
console.log('last 8 annual totals:', last6.map((y) => `${y}=${totals.get(y)!.toFixed(3)}`).join(' '));
const series = annualSeries(events, NOW_YEAR);
console.log('excluded (special) years:', series.excludedYears.join(',') || 'none');
console.log('full years counted:', series.fullYears.length, 'span', series.fullYears[0], '→', series.fullYears.at(-1));
const g = deriveGrowth(events, NOW_YEAR);
console.log('code growth:', JSON.stringify({
  streak: g.consecutiveAnnualIncreases.value, g1: g.growth1y.value, g3: g.growth3y.value, g5: g.growth5y.value, g10: g.growth10y.value,
}));
// independent recompute with the spec formula, no specials in the last decade
for (const n of [1, 3, 5, 10]) {
  const full = series.fullYears;
  const last = series.totals.get(full[full.length - 1])!;
  const base = full.length > n ? series.totals.get(full[full.length - 1 - n]) : null;
  const indep = base && base > 0 ? (last / base) ** (1 / n) - 1 : null;
  const coded = [g.growth1y.value, g.growth3y.value, g.growth5y.value, g.growth10y.value][[1, 3, 5, 10].indexOf(n)];
  console.log(`  growth${n}y: independent=${indep} code=${coded} match=${indep === null ? 'n/a (code absent)' : Math.abs(indep - coded!) < 1e-12}`);
}
console.log('  consecutiveIncreases independent=', consecutiveIncreases(series), 'code=', g.consecutiveAnnualIncreases.value);

console.log('\n=== (3) history route: does the duplicate "upcoming" row appear there too? ===');
const dir = mkdtempSync(path.join(tmpdir(), 'qa-p4-hist-'));
const db = openDb(path.join(dir, 'db.sqlite')); bootstrap(db);
const app = createApp(db); const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const port = (server.address() as { port: number }).port;
const iso = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);
try {
  for (const sym of ['O', 'AAPL', 'COST']) {
    const r = await fetch(`http://127.0.0.1:${port}/api/dividends/${sym}/history?span=1y`);
    const b = await r.json() as any; const p = b.data ?? b;
    const rows = p.rows as any[];
    const exs = rows.map((x) => x.exDate);
    const dups = [...new Set(exs.filter((d, i) => exs.indexOf(d) !== i))];
    console.log(`  ${sym} span=1y rows=${rows.length} duplicateExDates=${dups.map(iso).join(',') || 'none'}`);
    for (const d of dups) {
      console.log('     ', rows.filter((x) => x.exDate === d).map((x) => `amt=${x.amount} pay=${x.payableDate === null ? '—' : iso(x.payableDate)}`).join(' | '));
    }
    const badPay = rows.filter((x) => x.payableDate !== null && x.payableDate < x.exDate);
    for (const x of badPay) console.log(`      !! payable ${iso(x.payableDate)} precedes ex ${iso(x.exDate)} by ${Math.round((x.exDate - x.payableDate) / 86400)}d`);
  }
} finally { await new Promise<void>((r) => server.close(() => r())); db.close(); rmSync(dir, { recursive: true, force: true }); }
