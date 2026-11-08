import { fetchProviderJson, fetchQuery2Json, analystSummaryPath } from '../../server/provider';
const NOW = Math.floor(Date.now() / 1000);
const iso = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);
const num = (x: any) => (x && typeof x.raw === 'number' ? x.raw : null);
const chartUrl = (sym: string) => {
  const p1 = NOW - 60 * 365 * 86400, p2 = NOW + 86400;
  return `/v8/finance/chart/${encodeURIComponent(sym)}?period1=${p1}&period2=${p2}&interval=1mo&events=div`;
};
for (const sym of ['ULVR.L', '0005.HK', '0700.HK', 'AAPL', 'O']) {
  console.log(`\n############ ${sym} ############`);
  const c = await fetchQuery2Json(chartUrl(sym));
  const r = (c as any)?.chart?.result?.[0];
  const meta = r?.meta ?? {};
  const evs = Object.values(r?.events?.dividends ?? {}).map((d: any) => ({ a: d.amount, d: d.date })).sort((x: any, y: any) => x.d - y.d);
  console.log('chart meta.currency =', meta.currency, ' regularMarketPrice =', meta.regularMarketPrice);
  console.log('chart last 3 payments =', evs.slice(-3).map((e: any) => `${iso(e.d)}=${e.a}`).join(' '));
  let res: any = null;
  for (let i = 0; i < 6 && !res; i++) {
    const q = await fetchProviderJson(analystSummaryPath(sym));
    const rr = (q as any)?.json?.quoteSummary?.result?.[0];
    if (rr) res = rr;
  }
  if (!res) { console.log('quoteSummary empty after retries'); continue; }
  const sd = res.summaryDetail ?? {}; const dks = res.defaultKeyStatistics ?? {};
  console.log('price.currency =', res.price?.currency, '| price.regularMarketPrice =', num(res.price?.regularMarketPrice));
  console.log('summaryDetail.dividendRate =', num(sd.dividendRate), '| dividendYield =', num(sd.dividendYield), '| trailingAnnualDividendYield =', num(sd.trailingAnnualDividendYield));
  console.log('summaryDetail.currency =', sd.currency);
  console.log('defaultKeyStatistics.lastDividendValue =', num(dks.lastDividendValue), '(the upcoming row Amount) | lastDividendDate =', dks.lastDividendDate?.raw ? iso(dks.lastDividendDate.raw) : null);
  console.log('calendarEvents =', JSON.stringify(res.calendarEvents ? { ex: res.calendarEvents.exDividendDate?.raw, pay: res.calendarEvents.dividendDate?.raw } : null));
  const last = evs.at(-1);
  if (last && num(dks.lastDividendValue)) console.log(`RATIO lastChartPayment/lastDividendValue = ${last.a}/${num(dks.lastDividendValue)} = ${(last.a / (num(dks.lastDividendValue) as number)).toFixed(4)}`);
}
