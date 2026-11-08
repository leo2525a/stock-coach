/**
 * QA probe 03 — schedule coherence across real captures (duplicate "upcoming"
 * rows, payable-before-ex-date) and the yield-line/reconstruction labelling.
 */
import { readFileSync } from 'node:fs';
import { assembleDividends, assembleHistory, deriveFrequency, parseDividendEvents } from '../../shared/dividends';

const OUT = 'review-evidence/recon-phase4/out/';
const read = (f: string) => JSON.parse(readFileSync(OUT + f, 'utf8'));
const iso = (t: number | null) => (t === null ? '—' : new Date(t * 1000).toISOString().slice(0, 10));

/* Raw quoteSummary captures are only on disk for AAPL; the recon probe2.log
   prints the same three fields for every symbol, so we replay them verbatim. */
const FACTS: Record<string, { lastDividendValue: number | null; exDividendDate: number | null; dividendDate: number | null }> = {
  AAPL: { lastDividendValue: 0.27, exDividendDate: 1794441600, dividendDate: 1786579200 }, // probe2.log:5
  MSFT: { lastDividendValue: 0.91, exDividendDate: 1795132800, dividendDate: 1796256000 }, // probe2.log:29
  KO: { lastDividendValue: 0.53, exDividendDate: 1796083200, dividendDate: 1797292800 },   // probe2.log:53
  O: { lastDividendValue: 0.272, exDividendDate: 1793318400, dividendDate: 1794528000 },   // probe2.log:77
  '0700.HK': { lastDividendValue: 5.3, exDividendDate: 1778803200, dividendDate: null },   // probe2.log:125
  AGNC: { lastDividendValue: 0.12, exDividendDate: 1793318400, dividendDate: 1794268800 }, // probe2.log:149
  COST: { lastDividendValue: 1.47, exDividendDate: 1793318400, dividendDate: 1794528000 }, // probe2.log:173
};

const FILES: Record<string, string> = {
  AAPL: 'div-AAPL-max.json', MSFT: 'div-MSFT-max.json', KO: 'div-KO-max.json', O: 'div-O-max.json',
  '0700.HK': 'div-0700_HK-max.json', AGNC: 'div-AGNC-max.json', COST: 'div-COST-max.json',
};
const CCY: Record<string, string> = { AAPL: 'USD', MSFT: 'USD', KO: 'USD', O: 'USD', '0700.HK': 'HKD', AGNC: 'USD', COST: 'USD' };

const qs = (sym: string) => ({
  quoteSummary: { result: [{
    price: { currency: CCY[sym] },
    summaryDetail: {
      dividendRate: { raw: (FACTS[sym].lastDividendValue ?? 0) * 4 },
      exDividendDate: FACTS[sym].exDividendDate === null ? undefined : { raw: FACTS[sym].exDividendDate },
    },
    defaultKeyStatistics: { lastDividendValue: FACTS[sym].lastDividendValue === null ? undefined : { raw: FACTS[sym].lastDividendValue } },
    calendarEvents: FACTS[sym].dividendDate === null ? {} : { dividendDate: { raw: FACTS[sym].dividendDate } },
  }], error: null },
});

for (const sym of Object.keys(FACTS)) {
  const divMap = read(FILES[sym]);
  const events = parseDividendEvents({ chart: { result: [{ events: { dividends: divMap } }] } });
  const chartJson = { chart: { result: [{ meta: { currency: CCY[sym] }, events: { dividends: divMap } }] } };
  const payload = assembleDividends({
    symbol: sym, price: 100, factsJson: qs(sym), chartJson, yieldJson: {},
    shareholder: { dividendsPaid: null, repurchaseOfStock: null, longTermDebtPayments: null, longTermDebtIssuance: null, sharesAtFyEnd: null, priceAtFyEnd: null, asOf: '' },
    source: 'live', lastUpdated: '2026-11-07T00:00:00Z', note: null, now: 1793980336,
  } as never);

  const rows = payload.events;
  const exDates = rows.map((r) => r.exDate);
  const dups = [...new Set(exDates.filter((d, i) => exDates.indexOf(d) !== i))];
  const upcoming = rows.filter((r) => r.payableDate !== null);
  const inverted = upcoming.filter((r) => r.payableDate! < r.exDate);

  console.log(`\n################ ${sym} (${events.length} chart events) ################`);
  console.log('nextExDate', iso(payload.facts.nextExDate.value), '| nextPayDate', iso(payload.facts.nextPayDate.value), '| freq', JSON.stringify(payload.facts.frequency.value));
  console.log('DUPLICATE ex-dates:', dups.map(iso).join(',') || 'none');
  for (const u of upcoming) console.log('UPCOMING ROW: ex=', iso(u.exDate), 'payable=', iso(u.payableDate), 'amount=', u.amount);
  for (const u of inverted) console.log('  !! PAYABLE PRECEDES EX-DATE by', Math.round((u.exDate - u.payableDate!) / 86400), 'days');
  console.log('chart depth: first', iso(events[0].date), 'last', iso(events.at(-1).date));
}
