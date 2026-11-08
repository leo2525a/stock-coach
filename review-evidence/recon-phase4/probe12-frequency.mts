/**
 * RECON PHASE 4 — probe 12: can payment frequency be DERIVED honestly?
 * Hypothesis: paymentsPerYear ≈ round(summaryDetail.dividendRate /
 * defaultKeyStatistics.lastDividendValue). Cross-check vs median gap of chart
 * dividend events over the last 3y (spacing inference). READ-ONLY.
 */
import { fetchProviderJson, analystSummaryPath, fetchQuery2Json } from '../../server/provider';
const NOW = Math.floor(Date.now()/1000);
const num = (v: unknown) => { const r = (v as any)?.raw ?? v; return typeof r === 'number' ? r : null; };
const iso = (s: number) => new Date(s*1000).toISOString().slice(0,10);

async function events(sym: string) {
  const j = await fetchQuery2Json(`/v8/finance/chart/${encodeURIComponent(sym)}?range=3y&interval=1mo&events=div`);
  const res = (j as any)?.chart?.result?.[0];
  const divs = res?.events?.dividends ? Object.values(res.events.dividends).map((d:any)=>({amount:d.amount,date:d.date})).sort((a:any,b:any)=>a.date-b.date) : [];
  const gaps: number[] = []; for (let i=1;i<divs.length;i++) gaps.push((divs[i].date-divs[i-1].date)/86400);
  gaps.sort((a,b)=>a-b);
  const med = gaps.length ? gaps[Math.floor(gaps.length/2)] : null;
  return { n: divs.length, divs, medGap: med };
}
// frequency label from gap days
const label = (perYear: number | null) => perYear === null ? '?' : ({1:'annual',2:'semi-annual',4:'quarterly',12:'monthly',52:'weekly',26:'biweekly',24:'semi-monthly'} as any)[perYear] ?? `~${perYear}/yr`;

for (const sym of ['AAPL','MSFT','KO','O','AGNC','COST','MAIN','LTC','STAG','IBM','T','JNJ','PG','0700.HK','0005.HK','RY.TO','ULVR.L','VOD.L','BHP.AX','ENEL.MI','MO','CVX','WMT']) {
  const q = await fetchProviderJson(analystSummaryPath(sym));
  const rt = (q?.json as any)?.quoteSummary?.result?.[0];
  const sd = rt?.summaryDetail ?? {}, ks = rt?.defaultKeyStatistics ?? {};
  const rate = num(sd.dividendRate), last = num(ks.lastDividendValue);
  const e = await events(sym);
  const ratio = (rate != null && last) ? rate/last : null;
  const perYear = ratio != null ? Math.round(ratio) : (e.medGap ? Math.round(365/e.medGap) : null);
  const medLabel = e.medGap ? `${Math.round(e.medGap)}d→${Math.round(365/e.medGap)}/yr` : 'n/a';
  console.log(`${sym.padEnd(8)} rate=${String(rate).padEnd(7)} lastDiv=${String(last).padEnd(7)} ratio=${ratio!=null?ratio.toFixed(3):'  -  '} →perYear=${String(perYear).padEnd(3)} ${label(perYear).padEnd(11)} | chartEv n=${e.n} medGap=${medLabel}  lastEv=${e.divs.length?iso(e.divs[e.divs.length-1].date)+'('+e.divs[e.divs.length-1].amount+')':'-'}`);
}
console.log('\nDONE probe12');
