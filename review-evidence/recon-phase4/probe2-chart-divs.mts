/**
 * RECON PHASE 4 — probe 2: dividend history depth + shape from the chart
 * endpoint (`events=div`) across ranges and symbols, plus quoteSummary dividend
 * fields per symbol (direct yield/frequency/payout facts).
 * READ-ONLY against the live provider.
 */
import { writeFileSync } from 'node:fs';
import { fetchQuery2Json, fetchProviderJson, analystSummaryPath } from '../../server/provider';

const OUT = new URL('./out/', import.meta.url).pathname;
const SYMS = process.argv.slice(2).length ? process.argv.slice(2) : ['AAPL','MSFT','KO','O','TSLA','BRK-B','0700.HK'];
const RANGES = ['1y','3y','5y','10y','20y','max'];

const iso = (s: number) => new Date(s * 1000).toISOString().replace('.000','');
const num = (v: unknown) => {
  const r = (v as any)?.raw;
  return typeof r === 'number' ? r : (typeof v === 'number' ? v : null);
};

interface DivEv { amount: number; date: number }

for (const sym of SYMS) {
  console.log(`\n================= ${sym} =================`);

  // --- quoteSummary dividend facts (crumb-authenticated) ---
  const qs = await fetchProviderJson(analystSummaryPath(sym));
  const rt = (qs?.json as any)?.quoteSummary?.result?.[0];
  const sd = rt?.summaryDetail ?? {};
  const ks = rt?.defaultKeyStatistics ?? {};
  const ce = rt?.calendarEvents ?? {};
  const pr = rt?.price ?? {};
  console.log(`  QS: currency=${pr.currency ?? sd.currency ?? '?'} price=${num(pr.regularMarketPrice)}`);
  console.log(`  QS: dividendRate(indicated)=${num(sd.dividendRate)} dividendYield(indicated,frac)=${num(sd.dividendYield)} trailingAnnualDividendRate=${num(sd.trailingAnnualDividendRate)} trailingAnnualDividendYield(frac)=${num(sd.trailingAnnualDividendYield)} payoutRatio=${num(sd.payoutRatio)} fiveYearAvgDividendYield=${num(sd.fiveYearAvgDividendYield)}`);
  console.log(`  QS: lastDividendValue=${num(ks.lastDividendValue)} lastDividendDate=${num(ks.lastDividendDate)!=null?iso(num(ks.lastDividendDate)!):null} exDividendDate=${num(sd.exDividendDate)!=null?iso(num(sd.exDividendDate)!):null} calendarEvents.dividendDate=${num(ce.dividendDate)!=null?iso(num(ce.dividendDate)!):null}`);
  console.log(`  QS modules present: ${rt ? JSON.stringify(Object.keys(rt)) : 'NONE'}`);

  // --- chart dividends per range ---
  for (const range of RANGES) {
    const json = await fetchQuery2Json(`/v8/finance/chart/${encodeURIComponent(sym)}?range=${range}&interval=1mo&events=div`);
    const res = (json as any)?.chart?.result?.[0];
    const err = (json as any)?.chart?.error;
    if (!res) { console.log(`  chart ${range.padEnd(4)}: ERROR ${JSON.stringify(err)}`); continue; }
    const divs = res?.events?.dividends ?? null;
    const list: DivEv[] = divs ? Object.values(divs).map((d: any) => ({ amount: d.amount, date: d.date })).sort((a,b)=>a.date-b.date) : [];
    const firstT = res.timestamp?.[0], lastT = res.timestamp?.[res.timestamp.length-1];
    console.log(`  chart ${range.padEnd(4)}: bars=${res.timestamp?.length ?? 0} span=[${firstT?iso(firstT).slice(0,10):'?'}..${lastT?iso(lastT).slice(0,10):'?'}] divEvents=${list.length}${list.length?` first=${iso(list[0].date).slice(0,10)}(${list[0].amount}) last=${iso(list[list.length-1].date).slice(0,10)}(${list[list.length-1].amount})`:''}`);
    if (divs && list.length) {
      console.log(`      keys of a div event: ${JSON.stringify(Object.keys((divs as any)[Object.keys(divs)[0]]))}`);
      console.log(`      sample raw: ${JSON.stringify(Object.values(divs).slice(-2))}`);
    }
    if (range === 'max' && divs) writeFileSync(`${OUT}div-${sym.replace(/[^A-Za-z0-9]/g,'_')}-max.json`, JSON.stringify(divs, null, 2));
  }
}
console.log('\nDONE probe2');
