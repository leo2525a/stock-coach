import { fetchProviderJson, analystSummaryPath, fetchQuery2Json, timeseriesPath } from '../../server/provider';
const now = Math.floor(Date.now() / 1000);
for (const sym of ['ULVR.L','KO','O']) {
  const s = await fetchProviderJson(analystSummaryPath(sym));
  const sd: any = (s?.json as any)?.quoteSummary?.result?.[0]?.summaryDetail ?? {};
  const px: any = (s?.json as any)?.quoteSummary?.result?.[0]?.price ?? {};
  const ts = await fetchQuery2Json(timeseriesPath(sym, ['trailingDividendYield'], now - 400*86400, now));
  const rows = (ts as any)?.timeseries?.result?.[0]?.trailingDividendYield ?? [];
  const last = rows[rows.length-1];
  console.log(`\n### ${sym}  ccy=${px.currency} price=${px.regularMarketPrice?.raw}`);
  console.log(`  summaryDetail.dividendYield              = ${sd.dividendYield?.raw}  (${(sd.dividendYield?.raw*100).toFixed(3)}%)`);
  console.log(`  summaryDetail.dividendRate               = ${sd.dividendRate?.raw}`);
  console.log(`  summaryDetail.trailingAnnualDividendRate = ${sd.trailingAnnualDividendRate?.raw}`);
  console.log(`  summaryDetail.trailingAnnualDividendYield= ${sd.trailingAnnualDividendYield?.raw}  (${(sd.trailingAnnualDividendYield?.raw*100).toFixed(4)}%)`);
  console.log(`  rate/price = ${(sd.dividendRate?.raw/px.regularMarketPrice?.raw*100).toFixed(4)}%   trailingRate/price = ${(sd.trailingAnnualDividendRate?.raw/px.regularMarketPrice?.raw*100).toFixed(4)}%`);
  console.log(`  timeseries trailingDividendYield last = ${last?.dataValue} (${last?.asOfDate})`);
}
