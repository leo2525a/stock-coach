/**
 * RECON PHASE 4 — probe 11: print the exact trimmed raw payload snippets that
 * RECON-PHASE4.md cites, so every claim has a visible source.
 * READ-ONLY against the live provider.
 */
import { fetchQuery2Json, fetchProviderJson, analystSummaryPath, timeseriesPath } from '../../server/provider';
const NOW = Math.floor(Date.now()/1000);
const j = (x: unknown) => JSON.stringify(x);

// 1) chart events.div (crumb-free query2)
const c = await fetchQuery2Json(`/v8/finance/chart/KO?range=20y&interval=1mo&events=div`);
const cres = (c as any)?.chart?.result?.[0];
const evs = Object.values(cres.events.dividends).map((d:any)=>({amount:d.amount,date:d.date})).sort((a:any,b:any)=>a.date-b.date);
console.log('SNIPPET 1 — chart events.div (KO, range=20y):');
console.log('  meta.currency=' + cres.meta.currency + ' meta.regularMarketPrice=' + cres.meta.regularMarketPrice);
console.log('  keys(event)=' + j(Object.keys(Object.values(cres.events.dividends)[0])));
console.log('  events count=' + evs.length + ' last3=' + j(evs.slice(-3)));

// 2) trailingDividendYield timeseries (crumb-free query2, period1=0)
const t = await fetchQuery2Json(timeseriesPath('KO', ['trailingDividendYield'], 0, NOW));
const tblk = (t as any).timeseries.result[0];
console.log('\nSNIPPET 2 — trailingDividendYield (KO, period1=0):');
console.log('  meta=' + j(tblk.meta));
console.log('  first=' + j(tblk.trailingDividendYield[0]) + ' last=' + j(tblk.trailingDividendYield.at(-1)));

// 3) summaryDetail dividend fields (cookie+crumb query1) — retry on the
// documented intermittency (an empty envelope with no quoteSummary key at all).
let rt: any = null;
for (let i = 0; i < 5 && !rt; i++) {
  const q = await fetchProviderJson(analystSummaryPath('KO'));
  const r = (q as any)?.json?.quoteSummary?.result?.[0];
  if (!r) { console.log(`  [retry ${i}] quoteSummary envelope empty (keys=${JSON.stringify(Object.keys((q as any) ?? {}))})`); continue; }
  rt = r;
}
if (!rt) { console.log('  quoteSummary never returned for KO'); }
const pick = (o: any, ks: string[]) => Object.fromEntries(ks.filter(k=>k in o).map(k=>[k,o[k]]));
console.log('\nSNIPPET 3 — quoteSummary dividend fields (KO, cookie+crumb):');
console.log('  summaryDetail=' + j(pick(rt.summaryDetail, ['dividendRate','dividendYield','exDividendDate','payoutRatio','fiveYearAvgDividendYield','trailingAnnualDividendRate','trailingAnnualDividendYield','currency'])));
console.log('  defaultKeyStatistics=' + j(pick(rt.defaultKeyStatistics, ['lastDividendValue','lastDividendDate'])));
console.log('  calendarEvents=' + j(pick(rt.calendarEvents, ['exDividendDate','dividendDate'])));

// 4) annual shareholder-yield inputs (crumb-free query2)
const s = await fetchQuery2Json(timeseriesPath('AAPL', ['annualCashDividendsPaid','annualRepurchaseOfCapitalStock','annualLongTermDebtPayments','annualLongTermDebtIssuance','annualOrdinarySharesNumber'], 1100000000, NOW));
console.log('\nSNIPPET 4 — annual shareholder-yield inputs (AAPL):');
for (const b of (s as any).timeseries.result) {
  const ty = b.meta.type[0]; const rows = (b[ty]??[]).filter((r:any)=>r!=null);
  console.log(`  ${ty}: n=${rows.length} last=` + j(rows.at(-1)?.reportedValue?.raw) + ' asOf=' + rows.at(-1)?.asOfDate + ' cur=' + rows.at(-1)?.currencyCode);
}

// 5) prove NO frequency / record-date / announced-date fields
console.log('\nSNIPPET 5 — search for frequency/record/announce fields:');
for (const mod of ['summaryDetail','defaultKeyStatistics','calendarEvents','price','financialData','netSharePurchaseActivity','insiderTransactions','quoteType','summaryProfile']) {
  const ks = rt[mod] ? Object.keys(rt[mod]) : [];
  const hits = ks.filter((k: string) => /frequen|record|announce|payable|payment/i.test(k));
  if (hits.length) console.log(`  ${mod}: ${j(hits)}`);
}
console.log('  (no output above = no such keys in any probed module)');
console.log('\nDONE probe11');
