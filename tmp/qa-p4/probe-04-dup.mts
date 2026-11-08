import { readFileSync } from 'node:fs';
import { parseDividendEvents, assembleDividends } from '../../shared/dividends';
const OUT = 'review-evidence/recon-phase4/out/';
const read = (f: string) => JSON.parse(readFileSync(OUT + f, 'utf8'));
const iso = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);

const FACTS = {
  AAPL: { lv: 0.27, ex: 1794441600, pay: 1786579200 },
  MSFT: { lv: 0.91, ex: 1795132800, pay: 1796256000 },
  KO:   { lv: 0.53, ex: 1796083200, pay: 1797292800 },
  O:    { lv: 0.272, ex: 1793318400, pay: 1794528000 },
  AGNC: { lv: 0.12, ex: 1793318400, pay: 1794268800 },
  COST: { lv: 1.47, ex: 1793318400, pay: 1794528000 },
} as Record<string, {lv:number;ex:number;pay:number|null}>;
const FILES = ['AAPL','MSFT','KO','O','AGNC','COST'];

for (const sym of FILES) {
  const divMap = read(`div-${sym}-max.json`);
  const f = FACTS[sym];
  const chartJson = { chart: { result: [{ meta: { currency: 'USD' }, events: { dividends: divMap } }] } };
  const factsJson = { quoteSummary: { result: [{
    price: { currency: 'USD' },
    summaryDetail: { dividendRate: { raw: f.lv * 4 }, exDividendDate: { raw: f.ex } },
    defaultKeyStatistics: { lastDividendValue: { raw: f.lv } },
    calendarEvents: f.pay === null ? {} : { dividendDate: { raw: f.pay } },
  }], error: null } };
  const p = assembleDividends({ symbol: sym, price: 100, factsJson, chartJson, yieldJson: {}, shareholder: { dividendsPaid:null,repurchaseOfStock:null,longTermDebtPayments:null,longTermDebtIssuance:null,sharesAtFyEnd:null,priceAtFyEnd:null,asOf:'' }, source:'live', lastUpdated:'', note:null, now:1793980336 } as never);
  const exs = p.events.map(r=>r.exDate);
  const maxEx = Math.max(...exs);
  const countAtMax = exs.filter(d=>d===maxEx).length;
  console.log(`${sym.padEnd(5)} rows=${p.events.length} maxChartEx=${iso(maxEx)} occurrences=${countAtMax} nextExDate=${iso(f.ex)} nextExDateInChart=${exs.includes(f.ex)}`);
  if (countAtMax > 1) {
    console.log(`      DUPLICATE ex-date ${iso(maxEx)} appears ${countAtMax}x ->`, p.events.filter(r=>r.exDate===maxEx).map(r=>`amt=${r.amount} payable=${r.payableDate?iso(r.payableDate):'—'}`).join(' | '));
  }
}
