/**
 * Phase 3 build: capture LIVE fixtures into tests/fixtures so the pure mappers
 * can be unit-tested against real provider shapes without a network at test time.
 *
 * Read-only. Writes JSON fixtures only.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const TS_HOST = 'https://query2.finance.yahoo.com';
const Q1 = 'https://query1.finance.yahoo.com';
const UA = 'Mozilla/5.0';
const OUT = path.resolve(HERE, '..', '..', 'tests', 'fixtures');
mkdirSync(OUT, { recursive: true });

const INCOME = [
  'TotalRevenue', 'CostOfRevenue', 'GrossProfit', 'OperatingIncome', 'OperatingRevenue', 'EBIT', 'EBITDA',
  'NetIncome', 'NetIncomeCommonStockholders', 'NetIncomeContinuousOperations', 'BasicEPS', 'DilutedEPS',
  'ResearchAndDevelopment', 'SellingGeneralAndAdministration', 'InterestExpense', 'PretaxIncome', 'TaxProvision',
];
const BALANCE = [
  'TotalAssets', 'TotalLiabilitiesNetMinorityInterest', 'StockholdersEquity', 'TotalEquityGrossMinorityInterest',
  'MinorityInterest', 'TotalDebt', 'LongTermDebt', 'CurrentDebt', 'CurrentAssets', 'CurrentLiabilities',
  'CashAndCashEquivalents', 'CashCashEquivalentsAndShortTermInvestments', 'Inventory', 'NetDebt', 'Goodwill',
  'OtherIntangibleAssets', 'OrdinarySharesNumber', 'ShareIssued', 'TotalCapitalization',
];
const CASH = [
  'OperatingCashFlow', 'CapitalExpenditure', 'InvestingCashFlow', 'FinancingCashFlow', 'FreeCashFlow',
  'DepreciationAndAmortization', 'ReconciledDepreciation', 'CashDividendsPaid', 'RepurchaseOfCapitalStock',
  'StockBasedCompensation',
];

async function fetchTimeseries(sym: string, prefix: string): Promise<unknown> {
  const types = [...INCOME, ...BALANCE, ...CASH].map((n) => `${prefix}${n}`);
  const url = `${TS_HOST}/ws/fundamentals-timeseries/v1/finance/timeseries/${encodeURIComponent(sym)}?symbol=${encodeURIComponent(sym)}&type=${types.join(',')}&period1=1500000000&period2=${Math.floor(Date.now() / 1000)}`;
  const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' } });
  const text = await res.text();
  return JSON.parse(text);
}

async function main() {
  // 1) statements for AAPL (annual + quarterly + trailing) and 0700.HK annual.
  for (const [sym, prefixes] of [
    ['AAPL', ['annual', 'quarterly', 'trailing']],
    ['0700.HK', ['annual']],
  ] as const) {
    for (const prefix of prefixes) {
      const json = await fetchTimeseries(sym, prefix);
      const file = path.join(OUT, `timeseries-${sym.replace('.', '_')}-${prefix}.json`);
      writeFileSync(file, JSON.stringify(json));
      const results = (json as any)?.timeseries?.result ?? [];
      const present: string[] = [];
      const missing: string[] = [];
      for (const block of results) {
        const t = block.meta?.type?.[0];
        const rows = (block[t] ?? []).filter((x: any) => x != null);
        (rows.length ? present : missing).push(t);
      }
      console.log(`${sym} ${prefix}: blocks=${results.length} present=${present.length} missing=${missing.join(',')}`);
    }
  }

  // 2) quoteSummary for the analyst modules. Needs cookie+crumb.
  const prime = await fetch('https://fc.yahoo.com/', { headers: { 'user-agent': UA }, redirect: 'manual' });
  const cookies = (prime.headers as any).getSetCookie?.() ?? [];
  const cookieHeader = cookies.map((c: string) => c.split(';')[0].trim()).filter(Boolean).join('; ');
  const crumbRes = await fetch(`${Q1}/v1/test/getcrumb`, { headers: { 'user-agent': UA, Cookie: cookieHeader } });
  const crumb = (await crumbRes.text()).trim();
  console.log('crumb:', crumb ? 'ok' : 'MISSING');

  const modules = [
    'financialData', 'defaultKeyStatistics', 'summaryDetail', 'earningsTrend', 'recommendationTrend',
    'upgradeDowngradeHistory', 'calendarEvents', 'earningsHistory', 'price', 'assetProfile',
  ].join(',');
  const qsRes = await fetch(
    `${Q1}/v10/finance/quoteSummary/AAPL?modules=${modules}&crumb=${encodeURIComponent(crumb)}`,
    { headers: { 'user-agent': UA, Cookie: cookieHeader, accept: 'application/json' } },
  );
  const qsJson = (await qsRes.json()) as any;
  writeFileSync(path.join(OUT, 'quotesummary-AAPL.json'), JSON.stringify(qsJson));
  console.log('quoteSummary status', qsRes.status, 'modules:', Object.keys(qsJson?.quoteSummary?.result?.[0] ?? {}).join(','));

  // 3) FX chart pair.
  const fxRes = await fetch(`${TS_HOST}/v8/finance/chart/USDCNY=X?range=1d&interval=1d`, {
    headers: { 'user-agent': UA, accept: 'application/json' },
  });
  const fxJson = (await fxRes.json()) as any;
  writeFileSync(path.join(OUT, 'fx-USDCNY.json'), JSON.stringify(fxJson));
  console.log('fx status', fxRes.status, 'price', fxJson?.chart?.result?.[0]?.meta?.regularMarketPrice);
}

main().catch((e) => {
  console.error('fatal', e);
  process.exitCode = 1;
});
