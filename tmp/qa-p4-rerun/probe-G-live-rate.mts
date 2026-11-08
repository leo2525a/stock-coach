/**
 * QA rerun probe G — LIVE provider check of the §C.1 "Annual Rate" unit.
 *
 * `reconcileLastDividend` reconciles `lastDividendValue`, but `annualRate` is
 * printed with the same currency label and is NOT reconciled. For LSE symbols
 * the provider appears to report `dividendRate` in GBP while the chart (and the
 * label) are in pence (GBp). This probe reads the REAL provider payload and the
 * REAL chart for the same symbol and compares the two scales.
 */
import { fetchProviderJson, analystSummaryPath } from '../../server/provider';
import { fetchQuery2Json } from '../../server/provider';

const sym = process.argv[2] ?? 'ULVR.L';
const now = Math.floor(Date.now() / 1000);

const summary = await fetchProviderJson(analystSummaryPath(sym));
const sd = (summary?.json as any)?.quoteSummary?.result?.[0]?.summaryDetail ?? {};
const price = (summary?.json as any)?.quoteSummary?.result?.[0]?.price ?? {};
console.log(`--- ${sym} live quoteSummary ---`);
console.log('  price.currency            =', price.currency);
console.log('  price.regularMarketPrice  =', price.regularMarketPrice?.raw);
console.log('  summaryDetail.currency    =', sd.currency);
console.log('  summaryDetail.dividendRate    =', sd.dividendRate?.raw);
console.log('  summaryDetail.dividendYield   =', sd.dividendYield?.raw);
console.log('  summaryDetail.trailingAnnualDividendRate =', sd.trailingAnnualDividendRate?.raw);
console.log('  summaryDetail.trailingAnnualDividendYield=', sd.trailingAnnualDividendYield?.raw);
console.log('  defaultKeyStatistics.lastDividendValue   =', (summary?.json as any)?.quoteSummary?.result?.[0]?.defaultKeyStatistics?.lastDividendValue?.raw);

const p1 = now - 3 * 365 * 86400;
const chartPath = `/v8/finance/chart/${encodeURIComponent(sym)}?period1=${p1}&period2=${now + 86400}&interval=1mo&events=div`;
const chart = (await fetchQuery2Json(chartPath)) as any;
const meta = chart?.chart?.result?.[0]?.meta ?? {};
const divs = Object.values(chart?.chart?.result?.[0]?.events?.dividends ?? {}).map((d: any) => ({ date: d.date, amount: d.amount }));
divs.sort((a: any, b: any) => a.date - b.date);
const last8 = divs.slice(-8);
console.log(`--- ${sym} live chart (crumb-free) ---`);
console.log('  meta.currency =', meta.currency);
console.log('  meta.regularMarketPrice =', meta.regularMarketPrice);
console.log('  last 8 per-payment amounts =', last8.map((d: any) => d.amount).join(', '));
const sum = last8.slice(-4).reduce((a: number, d: any) => a + d.amount, 0);
console.log(`  sum of last 4 payments = ${sum}  (a year of the series' own unit)`);
console.log(`  provider dividendRate  = ${sd.dividendRate?.raw}`);
console.log(`  -> ratio (dividendRate x100) / last-4-sum = ${(((sd.dividendRate?.raw ?? 0) * 100) / sum).toFixed(4)}`);
console.log(`  -> ratio dividendRate / (last-4-sum/100)  = ${((sd.dividendRate?.raw ?? 0) / (sum / 100)).toFixed(4)}`);
