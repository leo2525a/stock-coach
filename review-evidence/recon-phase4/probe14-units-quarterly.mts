/**
 * RECON PHASE 4 — probe 14: (a) quarterly (LTM) shareholder-yield inputs and a
 * worked total; (b) the UNIT inconsistencies between fields/endpoints.
 * READ-ONLY against the live provider.
 */
import { fetchQuery2Json, timeseriesPath, fetchProviderJson, analystSummaryPath } from '../../server/provider';
const NOW = Math.floor(Date.now()/1000);
const num = (v: unknown) => { const r = (v as any)?.raw ?? v; return typeof r === 'number' ? r : null; };

console.log('=== (a) quarterly inputs for LTM shareholder yield (AAPL) ===');
const t = await fetchQuery2Json(timeseriesPath('AAPL', ['quarterlyCashDividendsPaid','quarterlyRepurchaseOfCapitalStock','quarterlyLongTermDebtPayments','quarterlyLongTermDebtIssuance','quarterlyOrdinarySharesNumber'], 1100000000, NOW));
const rowsOf = (ty: string) => { const b = ((t as any)?.timeseries?.result ?? []).find((x:any)=>x.meta?.type?.[0]===ty); return (b?.[ty]??[]).filter((r:any)=>r!=null); };
for (const ty of ['quarterlyCashDividendsPaid','quarterlyRepurchaseOfCapitalStock','quarterlyLongTermDebtPayments','quarterlyLongTermDebtIssuance','quarterlyOrdinarySharesNumber']) {
  const rows = rowsOf(ty);
  console.log(`  ${ty.padEnd(34)} n=${rows.length} rows=` + rows.map((r:any)=>`${r.asOfDate}:${r.reportedValue?.raw}`).join(' '));
}
// LTM = last 4 quarters
const sum4 = (ty: string) => { const r = rowsOf(ty).slice(-4); return r.length===4 ? r.reduce((s:number,x:any)=>s+(x.reportedValue?.raw??0),0) : null; };
console.log(`  LTM divPaid=${sum4('quarterlyCashDividendsPaid')} buyback=${sum4('quarterlyRepurchaseOfCapitalStock')} debtPay=${sum4('quarterlyLongTermDebtPayments')} debtIss=${sum4('quarterlyLongTermDebtIssuance')}`);

console.log('\n=== (b) UNIT INCONSISTENCY PROBE ===');
for (const sym of ['AAPL','KO','O','AGNC','MSFT']) {
  const q = await fetchProviderJson(analystSummaryPath(sym));
  const rt = (q?.json as any)?.quoteSummary?.result?.[0];
  const sd = rt?.summaryDetail ?? {};
  const t2 = await fetchQuery2Json(timeseriesPath(sym, ['trailingDividendYield'], 0, NOW));
  const blk = ((t2 as any)?.timeseries?.result ?? []).find((b:any)=>b.meta?.type?.[0]==='trailingDividendYield');
  const lastY = (blk?.trailingDividendYield ?? []).filter((r:any)=>r!=null).at(-1);
  console.log(`  ${sym.padEnd(5)} summaryDetail.dividendYield=${num(sd.dividendYield)}  trailingAnnualDividendYield=${num(sd.trailingAnnualDividendYield)}  fiveYearAvgDividendYield=${num(sd.fiveYearAvgDividendYield)}  payoutRatio=${num(sd.payoutRatio)}  ts.trailingDividendYield=${lastY?.dataValue}`);
}
// v7 units
const v7 = await fetchJson_v7();
async function fetchJson_v7() {
  const { fetchWithRetry, getSession, cookieHeader } = await import('../../server/provider');
  const s = await getSession();
  const res = await fetchWithRetry(`https://query1.finance.yahoo.com/v7/finance/quote?symbols=AAPL,KO,O&fields=dividendYield,trailingAnnualDividendRate,trailingAnnualDividendYield,dividendRate,trailingAnnualDividendYield,currency`, { headers: { 'user-agent':'Mozilla/5.0', cookie: cookieHeader(s!.cookies) } });
  return JSON.parse(await res!.text());
}
for (const q of v7.quoteResponse.result) console.log(`  v7 ${q.symbol}: currency=${q.currency} dividendYield=${q.dividendYield} trailingAnnualDividendYield=${q.trailingAnnualDividendYield} trailingAnnualDividendRate=${q.trailingAnnualDividendRate}`);
console.log('\nDONE probe14');
