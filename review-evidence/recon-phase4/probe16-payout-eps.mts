/**
 * RECON PHASE 4 — probe 16: payoutRatio units + a clean DERIVED LTM payout
 * (LTM dividends / LTM EPS), and confirm ex-date semantics of chart events.
 * READ-ONLY.
 */
import { fetchProviderJson, analystSummaryPath, fetchQuery2Json, timeseriesPath } from '../../server/provider';
const NOW = Math.floor(Date.now()/1000);
const num = (v: unknown) => { const r = (v as any)?.raw ?? v; return typeof r === 'number' ? r : null; };
const iso = (s: number) => new Date(s*1000).toISOString().slice(0,10);

console.log('symbol  payoutRatio  trailingEps  trailingAnnDivRate  derivedPayout(rate/eps)  LTMdiv/LTMni');
for (const sym of ['AAPL','KO','O','AGNC','MSFT','IBM','MO']) {
  const q = await fetchProviderJson(analystSummaryPath(sym));
  const rt = (q?.json as any)?.quoteSummary?.result?.[0];
  const sd = rt?.summaryDetail ?? {}, ks = rt?.defaultKeyStatistics ?? {};
  const pr = num(sd.payoutRatio), eps = num(ks.trailingEps), rate = num(sd.trailingAnnualDividendRate);
  const derived = (rate != null && eps) ? rate/eps : null;
  const t = await fetchQuery2Json(timeseriesPath(sym, ['trailingCashDividendsPaid','trailingNetIncome'], 1100000000, NOW));
  const g = (ty: string) => { const b=((t as any)?.timeseries?.result??[]).find((x:any)=>x.meta?.type?.[0]===ty); const r=(b?.[ty]??[]).filter((x:any)=>x!=null); return r.length?r.at(-1).reportedValue?.raw:null; };
  const d = g('trailingCashDividendsPaid'), ni = g('trailingNetIncome');
  const ltm = (d!=null && ni) ? Math.abs(d)/ni : null;
  console.log(`${sym.padEnd(7)} ${String(pr).padEnd(12)} ${String(eps).padEnd(12)} ${String(rate).padEnd(19)} ${String(derived?.toFixed(4)).padEnd(24)} ${ltm?.toFixed(4)}`);
}

console.log('\n=== chart event date == ex-date? (compare with a known recent ex-div) ===');
for (const sym of ['MSFT','KO','O']) {
  const q = await fetchProviderJson(analystSummaryPath(sym));
  const rt = (q?.json as any)?.quoteSummary?.result?.[0];
  const c = await fetchQuery2Json(`/v8/finance/chart/${sym}?range=1y&interval=1mo&events=div`);
  const evs = Object.values((c as any).chart.result[0].events.dividends).map((d:any)=>({a:d.amount,d:d.date})).sort((x:any,y:any)=>x.d-y.d);
  console.log(`  ${sym}: lastChartEvent=${iso(evs.at(-1).d)}  lastDividendDate(KS)=${num(rt.defaultKeyStatistics.lastDividendDate)?iso(num(rt.defaultKeyStatistics.lastDividendDate)!):null}  exDivDate(SD)=${num(rt.summaryDetail.exDividendDate)?iso(num(rt.summaryDetail.exDividendDate)!):null}  nextPayDate(CE)=${num(rt.calendarEvents.dividendDate)?iso(num(rt.calendarEvents.dividendDate)!):null}`);
}
console.log('\nDONE probe16');
