/**
 * RECON PHASE 4 — probe 13: PROVE the derivations actually work on real data.
 * (A) annual dividend totals + consecutive increases + 1/3/5/10Y growth from
 *     chart events; (B) shareholder yield decomposition from annual timeseries;
 *     (C) yield reconstruction. Records failure modes honestly.
 * READ-ONLY against the live provider.
 */
import { fetchQuery2Json, timeseriesPath } from '../../server/provider';
const NOW = Math.floor(Date.now()/1000);
const iso = (s: number) => new Date(s*1000).toISOString().slice(0,10);

async function divEvents(sym: string) {
  const j = await fetchQuery2Json(`/v8/finance/chart/${encodeURIComponent(sym)}?period1=${NOW-30*365*86400}&period2=${NOW}&interval=1mo&events=div`);
  const res = (j as any)?.chart?.result?.[0];
  const divs = res?.events?.dividends ? Object.values(res.events.dividends).map((d:any)=>({amount:d.amount,date:d.date})).sort((a:any,b:any)=>a.date-b.date) : [];
  const cur = res?.meta?.currency;
  const px: number[] = res?.indicators?.quote?.[0]?.close ?? [];
  const ts: number[] = res?.timestamp ?? [];
  return { divs, cur, ts, px, barCur: res?.meta?.currency };
}
// yearly totals by calendar year of the *ex/pay date*
function yearly(sym: string, divs: any[]) {
  const m: Record<number, number> = {};
  for (const d of divs) { const y = new Date(d.date*1000).getUTCFullYear(); m[y] = (m[y] ?? 0) + d.amount; }
  return m;
}

console.log('=== (A) annual dividend totals + growth ===');
for (const sym of ['AAPL','KO','O','COST','MSFT','TGT','0700.HK','0005.HK','ULVR.L']) {
  const { divs, cur } = await divEvents(sym);
  const y = yearly(sym, divs);
  const years = Object.keys(y).map(Number).sort((a,b)=>a-b);
  const withFull = years.filter((yy) => divs.filter((d:any)=>new Date(d.date*1000).getUTCFullYear()===yy).length >= 4 || (y[yy] && years.length));
  // consecutive increases (only full years; exclude the current partial year)
  const thisYear = new Date(NOW*1000).getUTCFullYear();
  const full = years.filter((yy) => yy < thisYear);
  let streak = 0;
  for (let i = full.length-1; i > 0; i--) { if (y[full[i]] > y[full[i-1]]) streak++; else break; }
  const g = (n: number) => full.length > n ? (Math.pow(y[full[full.length-1]] / y[full[full.length-1-n]], 1/n) - 1) : null;
  const pct = (v: number | null) => v==null?'--':(v*100).toFixed(2)+'%';
  console.log(`  ${sym.padEnd(8)} cur=${String(cur).padEnd(4)} years=${years[0]}..${years[years.length-1]} annualDiv=${JSON.stringify(full.slice(-4).map(x=>`${x}:${y[x].toFixed(3)}`))} streak=${streak}y 1Y=${pct(g(1))} 3Y=${pct(g(3))} 5Y=${pct(g(5))} 10Y=${pct(g(10))}`);
}

console.log('\n=== (B) shareholder yield decomposition (annual, latest FY) ===');
for (const sym of ['AAPL','MSFT','KO','O','IBM']) {
  const t = await fetchQuery2Json(timeseriesPath(sym, ['annualCashDividendsPaid','annualRepurchaseOfCapitalStock','annualLongTermDebtPayments','annualLongTermDebtIssuance','annualOrdinarySharesNumber','annualTotalDebt'], 1100000000, NOW));
  const get = (ty: string) => { const b = ((t as any)?.timeseries?.result ?? []).find((x:any)=>x.meta?.type?.[0]===ty); const rows=(b?.[ty]??[]).filter((r:any)=>r!=null); return rows; };
  const div = get('annualCashDividendsPaid'), buy = get('annualRepurchaseOfCapitalStock'), debtPay = get('annualLongTermDebtPayments'), debtIss = get('annualLongTermDebtIssuance'), shares = get('annualOrdinarySharesNumber'), td = get('annualTotalDebt');
  const last = (a: any[]) => a.length ? a[a.length-1].reportedValue?.raw : null;
  const lastDate = (a: any[]) => a.length ? a[a.length-1].asOfDate : null;
  const asOf = lastDate(div);
  // market cap for the same FY as-of: use current price? We don't have FY-end price here; report the RAW components only (formula needs price/shares).
  const ni = null;
  console.log(`  ${sym.padEnd(6)} FY=${asOf} divPaid=${last(div)} buyback=${last(buy)} LTdebtPay=${last(debtPay)} LTdebtIss=${last(debtIss)} shares=${last(shares)} totalDebt=${last(td)}`);
}
console.log('\n(components printed; the % version needs FY-end market cap = price(FYend) x shares(FYend))');
console.log('\nDONE probe13');
