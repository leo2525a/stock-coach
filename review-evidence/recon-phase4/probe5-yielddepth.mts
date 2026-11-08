/**
 * RECON PHASE 4 — probe 5: depth/granularity of the `trailingDividendYield`
 * series per symbol, currencyCode presence in timeseries rows, and whether the
 * quoteSummary dividend fields survive across symbols.
 * READ-ONLY against the live provider.
 */
import { fetchQuery2Json, timeseriesPath, fetchProviderJson, analystSummaryPath } from '../../server/provider';

const SYMS = process.argv.slice(2).length ? process.argv.slice(2) : ['AAPL','MSFT','KO','O','AGNC','COST','TSLA','BRK-B','0700.HK'];
const P1 = 0, P2 = Math.floor(Date.now() / 1000);

const num = (v: unknown) => { const r = (v as any)?.raw; return typeof r === 'number' ? r : (typeof v === 'number' ? v : null); };

for (const sym of SYMS) {
  console.log(`\n========== ${sym} ==========`);
  const j = await fetchQuery2Json(timeseriesPath(sym, ['trailingDividendYield'], P1, P2));
  const blocks = (j as any)?.timeseries?.result ?? [];
  for (const b of blocks) {
    const t = b?.meta?.type?.[0];
    const rows = (b?.[t] ?? []).filter((r: any) => r != null);
    if (!rows.length) { console.log(`  ${t}: 0 rows`); continue; }
    const first = rows[0], last = rows[rows.length - 1];
    // granularity: median gap in days
    const gaps: number[] = [];
    for (let i = 1; i < rows.length; i++) gaps.push((Date.parse(rows[i].asOfDate) - Date.parse(rows[i-1].asOfDate)) / 86400000);
    gaps.sort((a,b)=>a-b);
    const medGap = gaps.length ? gaps[Math.floor(gaps.length/2)] : 0;
    const vals = rows.map((r:any)=>r.dataValue);
    console.log(`  ${t}: n=${rows.length} [${first.asOfDate}..${last.asOfDate}] medianGap=${medGap.toFixed(0)}d dataValue=${JSON.stringify(vals.slice(-3))} min=${Math.min(...vals).toFixed(5)} max=${Math.max(...vals).toFixed(5)}`);
    console.log(`    keys=${JSON.stringify(Object.keys(first))}`);
  }
  const qs = await fetchProviderJson(analystSummaryPath(sym));
  const rt = (qs?.json as any)?.quoteSummary?.result?.[0];
  const sd = rt?.summaryDetail ?? {};
  const ks = rt?.defaultKeyStatistics ?? {};
  console.log(`  QS modules=${rt?Object.keys(rt).length:0} dividendRate=${num(sd.dividendRate)} trailingADR=${num(sd.trailingAnnualDividendRate)} payoutRatio=${num(sd.payoutRatio)} currency=${rt?.price?.currency ?? sd.currency}`);
  const freqKeys = rt ? Object.keys(sd).filter(k=>/frequen|period|count|last.*div/i.test(k)) : [];
  console.log(`  frequency-ish keys in summaryDetail: ${JSON.stringify(freqKeys)}  lastDividendValue=${num(ks.lastDividendValue)}`);
}
console.log('\nDONE probe5');
