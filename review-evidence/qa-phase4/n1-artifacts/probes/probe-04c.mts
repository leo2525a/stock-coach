import { fetchProviderJson, analystSummaryPath } from '../../server/provider';
for (const sym of ['0005.HK', 'ULVR.L']) {
  const pj: any = await fetchProviderJson(analystSummaryPath(sym));
  const r: any = pj?.json?.quoteSummary?.result?.[0] ?? {};
  const sd = r.summaryDetail ?? {}, px = r.price ?? {}, dks = r.defaultKeyStatistics ?? {};
  console.log(`\n=== ${sym} ===`);
  console.log(' summaryDetail.currency =', sd.currency, '| price.currency =', px.currency, '| price =', px.regularMarketPrice?.raw);
  console.log(' dividendRate      =', sd.dividendRate?.raw);
  console.log(' dividendYield     =', sd.dividendYield?.raw);
  console.log(' trailingAnnualDividendRate  =', sd.trailingAnnualDividendRate?.raw);
  console.log(' trailingAnnualDividendYield =', sd.trailingAnnualDividendYield?.raw);
  console.log(' fiveYearAvgDividendYield    =', sd.fiveYearAvgDividendYield?.raw);
  console.log(' payoutRatio       =', sd.payoutRatio?.raw);
  console.log(' dks.lastDividendValue =', dks.lastDividendValue?.raw, '| dks.trailingEps =', dks.trailingEps?.raw);
  console.log(' ratio dividendRate/price =', sd.dividendRate?.raw / px.regularMarketPrice?.raw);
}
