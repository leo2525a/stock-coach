/**
 * RECON PHASE 4 — probe 7: (a) decade histogram of chart div events at 20y/max,
 * (b) reconstruct trailing yield = LTM dividends / price and compare to the
 * real `trailingDividendYield` series, (c) ex- vs pay-date semantics check,
 * (d) foreign currency units. READ-ONLY against the live provider.
 */
import { fetchQuery2Json, timeseriesPath, fetchProviderJson, analystSummaryPath } from '../../server/provider';

const iso = (s: number) => new Date(s * 1000).toISOString().slice(0, 10);
const num = (v: unknown) => { const r = (v as any)?.raw ?? v; return typeof r === 'number' ? r : null; };

async function events(sym: string, range: string) {
  const j = await fetchQuery2Json(`/v8/finance/chart/${encodeURIComponent(sym)}?range=${range}&interval=1mo&events=div`);
  const res = (j as any)?.chart?.result?.[0];
  if (!res) return { n: 0, divs: [] as any[], meta: null, bars: 0, firstBar: null, lastBar: null };
  const divs = res.events?.dividends ? Object.values(res.events.dividends).map((d: any) => ({ amount: d.amount, date: d.date })).sort((a: any, b: any) => a.date - b.date) : [];
  return { n: divs.length, divs, meta: res.meta, bars: res.timestamp?.length ?? 0, firstBar: res.timestamp?.[0], lastBar: res.timestamp?.[res.timestamp.length-1] };
}

// (a) decade histogram
console.log('=== (a) chart div-event depth: 20y vs max ===');
for (const sym of ['KO','JNJ','PG','T','O','AAPL','IBM']) {
  for (const range of ['20y','max']) {
    const e = await events(sym, range);
    const hist: Record<string, number> = {};
    for (const d of e.divs) { const dec = `${Math.floor(new Date(d.date*1000).getUTCFullYear()/10)*10}s`; hist[dec] = (hist[dec] ?? 0) + 1; }
    console.log(`  ${sym.padEnd(5)} ${range.padEnd(4)} n=${String(e.n).padStart(3)} bars=${String(e.bars).padStart(3)} span=[${e.divs.length?iso(e.divs[0].date):'-'}..${e.divs.length?iso(e.divs[e.divs.length-1].date):'-'}] perDecade=${JSON.stringify(hist)}`);
  }
}

// (b) reconstruct yield vs real series
console.log('\n=== (b) reconstructed LTM yield vs trailingDividendYield series ===');
const P1 = 0, P2 = Math.floor(Date.now()/1000);
for (const sym of ['AAPL','KO','O']) {
  const e = await events(sym, '10y');
  const j = await fetchQuery2Json(timeseriesPath(sym, ['trailingDividendYield'], P1, P2));
  const blk = ((j as any)?.timeseries?.result ?? []).find((b: any) => b?.meta?.type?.[0] === 'trailingDividendYield');
  const yieldRows = (blk?.trailingDividendYield ?? []).filter((r: any) => r != null);
  // price at date: use chart monthly closes (rebuild from earlier events call is not enough) -> fetch separate
  const cj = await fetchQuery2Json(`/v8/finance/chart/${encodeURIComponent(sym)}?range=10y&interval=1mo`);
  const cres = (cj as any)?.chart?.result?.[0];
  const ts: number[] = cres?.timestamp ?? [];
  const close: (number|null)[] = cres?.indicators?.quote?.[0]?.close ?? [];
  const priceAt = (t: number) => { let best = -1, bd = Infinity; for (let i = 0; i < ts.length; i++) { const d = Math.abs(ts[i]-t); if (d < bd) { bd = d; best = i; } } return close[best]; };
  const ltmAt = (t: number) => { const from = t - 365*86400; return e.divs.filter((d: any) => d.date > from && d.date <= t).reduce((s: number, d: any) => s + d.amount, 0); };
  console.log(`  --- ${sym}: real series n=${yieldRows.length}, chart events n=${e.n}`);
  for (const k of [yieldRows.length-1, Math.max(0,yieldRows.length-13), Math.max(0,yieldRows.length-25)]) {
    const r = yieldRows[k]; if (!r) continue;
    const t = Date.parse(r.asOfDate) / 1000;
    const px = priceAt(t); const ltm = ltmAt(t + 86400); // include divs up to that date
    const recon = px ? ltm / px : null;
    console.log(`     ${r.asOfDate}  real=${r.dataValue}  recon(LTM=${ltm.toFixed(3)} / px=${px?.toFixed(2)}) = ${recon?.toFixed(5)}  Δ=${recon!=null?(recon - r.dataValue).toFixed(5):'-'}`);
  }
}

// (c) ex- vs pay-date semantics
console.log('\n=== (c) ex vs pay date semantics ===');
for (const sym of ['AAPL','MSFT','KO','O','MSFT']) {
  const qs = await fetchProviderJson(analystSummaryPath(sym));
  const rt = (qs?.json as any)?.quoteSummary?.result?.[0];
  const sd = rt?.summaryDetail ?? {}, ce = rt?.calendarEvents ?? {}, ks = rt?.defaultKeyStatistics ?? {};
  const e = await events(sym, '1y');
  console.log(`  ${sym}: lastDivDate=${num(ks.lastDividendDate)?iso(num(ks.lastDividendDate)!):null} lastDividendValue=${num(ks.lastDividendValue)} | sd.exDividendDate=${num(sd.exDividendDate)?iso(num(sd.exDividendDate)!):null} | ce.exDividendDate=${num(ce.exDividendDate)?iso(num(ce.exDividendDate)!):null} ce.dividendDate=${num(ce.dividendDate)?iso(num(ce.dividendDate)!):null} | lastChartEvent=${e.divs.length?iso(e.divs[e.divs.length-1].date):null}`);
}

// (d) foreign currency units
console.log('\n=== (d) foreign currency units (chart vs summaryDetail) ===');
for (const sym of ['ULVR.L','0700.HK','0005.HK','NESN.SW','RY.TO','ENEL.MI']) {
  const e = await events(sym, '5y');
  const qs = await fetchProviderJson(analystSummaryPath(sym));
  const rt = (qs?.json as any)?.quoteSummary?.result?.[0];
  const sd = rt?.summaryDetail ?? {};
  console.log(`  ${sym.padEnd(8)} chartCur=${e.meta?.currency} chartPrice=${num(e.meta?.regularMarketPrice)} chartLastDiv=${e.divs.length?e.divs[e.divs.length-1].amount:null} | QScur=${rt?.price?.currency} dividendRate=${num(sd.dividendRate)} tradingCurrency=${(rt?.price as any)?.currency} financialCurrency=${(rt?.financialData as any)?.financialCurrency}`);
}
console.log('\nDONE probe7');
