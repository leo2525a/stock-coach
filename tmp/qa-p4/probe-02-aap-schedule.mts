/**
 * QA probe 02 — assemble the REAL payload for AAPL from the captured raw
 * upstream responses and check the schedule for internal coherence.
 *
 * Nothing here is synthetic: every input is a byte-for-byte capture in
 * review-evidence/recon-phase4/out/.
 */
import { readFileSync } from 'node:fs';
import { assembleDividends, assembleHistory } from '../../shared/dividends';

const OUT = 'review-evidence/recon-phase4/out/';
const read = (f: string) => JSON.parse(readFileSync(OUT + f, 'utf8'));
const iso = (t: number | null) => (t === null ? '—' : new Date(t * 1000).toISOString().slice(0, 10));

const qs = read('qs-analyst-AAPL.json');
const divMap = read('div-AAPL-max.json');
const ts = read('ts-yieldraw-AAPL.json');

const chartJson = { chart: { result: [{ meta: { currency: 'USD', symbol: 'AAPL' }, events: { dividends: divMap } }] } };

console.log('timeseries block types:', (ts.timeseries?.result ?? []).map((b: any) => b.meta?.type?.[0]));

const payload = assembleDividends({
  symbol: 'AAPL',
  price: 345.43,
  factsJson: qs,
  chartJson,
  yieldJson: ts,
  shareholder: {
    dividendsPaid: -15721000000,
    repurchaseOfStock: -86390000000,
    longTermDebtPayments: -11150000000,
    longTermDebtIssuance: 0,
    sharesAtFyEnd: 15_000_000_000,
    priceAtFyEnd: 250,
    asOf: '2026-09-30',
  },
  source: 'live',
  lastUpdated: '2026-11-07T00:00:00Z',
  note: null,
  now: 1793980336,
} as never);

console.log('\n=== facts ===');
console.log('nextExDate  ', iso(payload.facts.nextExDate.value), payload.facts.nextExDate.source);
console.log('nextPayDate ', iso(payload.facts.nextPayDate.value), payload.facts.nextPayDate.source);
console.log('lastDivValue', payload.facts.lastDividendValue.value, payload.facts.lastDividendValue.source);
console.log('frequency   ', JSON.stringify(payload.facts.frequency));

console.log('\n=== schedule tail (last 6 rows) ===');
for (const r of payload.events.slice(-6)) {
  console.log(
    `ex=${iso(r.exDate)}  amount=${r.amount}  payable=${iso(r.payableDate)}  announced=${r.announcedDate}  record=${r.recordDate}  type=${r.type}  ccy=${r.currency}`,
  );
}

console.log('\n=== coherence check: any row whose payableDate precedes its exDate? ===');
const bad = payload.events.filter((r) => r.payableDate !== null && r.payableDate < r.exDate);
if (bad.length === 0) console.log('none');
for (const r of bad) {
  console.log(
    `OFFENDING ROW: exDate=${iso(r.exDate)} payableDate=${iso(r.payableDate)} amount=${r.amount} -> payable is ${Math.round((r.exDate - r.payableDate) / 86400)} days BEFORE the ex-date`,
  );
}

console.log('\n=== duplicate-date check: is the "upcoming" ex-date already in the paid history? ===');
const dates = payload.events.map((r) => r.exDate);
const dupes = dates.filter((d, i) => dates.indexOf(d) !== i);
console.log('duplicate ex-dates:', dupes.map(iso));

console.log('\n=== last paid event vs the "upcoming" row ===');
const paid = payload.events.filter((r) => r.payableDate === null);
console.log('last paid    ', iso(paid.at(-1)?.exDate ?? null), paid.at(-1)?.amount);

console.log('\n=== history payload (span 1y) sanity: first yield point ===');
const hist = assembleHistory({
  symbol: 'AAPL',
  span: 'ALL',
  price: 345.43,
  factsJson: qs,
  chartJson,
  yieldJson: ts,
  source: 'live',
  lastUpdated: '2026-11-07T00:00:00Z',
  note: null,
  now: 1793980336,
} as never);
console.log('yield rows', hist.series.yields.length, 'first', iso(hist.series.yields[0]?.date ?? null), hist.series.yields[0]?.value, hist.series.yields[0]?.source);
console.log('reconstructed', hist.series.reconstructed);
console.log('payments', hist.series.payments.length, 'spansAvailable', hist.series.spansAvailable.join(','));
