import { fetchProviderJson, analystSummaryPath, fetchQuery2Json, timeseriesPath } from '../../server/provider';
const now = Math.floor(Date.now() / 1000);
for (const sym of ['ULVR.L','BP.L','HSBA.L','VOD.L','KO','O','AAPL']) {
  const s: any = (await fetchProviderJson(analystSummaryPath(sym)))?.json?.quoteSummary?.result?.[0] ?? {};
  const sd = s.summaryDetail ?? {}; const px = s.price ?? {};
  const ts: any = await fetchQuery2Json(timeseriesPath(sym, ['trailingDividendYield'], now - 60*86400, now));
  const rows = ts?.timeseries?.result?.[0]?.trailingDividendYield ?? [];
  const last = rows[rows.length-1]?.dataValue ?? null;
  const raw = sd.trailingAnnualDividendYield?.raw ?? null;
  console.log(`${sym.padEnd(8)} ccy=${(px.currency||'').padEnd(5)} ind=${sd.dividendYield?.raw} | sd.trailingYield=${raw} (${(raw*100).toFixed(4)}%) | timeseries=${last} (${(last*100).toFixed(4)}%) | ratio ts/sd=${raw? (last/raw).toFixed(1):'—'}`);
}
