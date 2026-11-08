/**
 * Phase 3 build probe: verify fundamentals-timeseries shape and the exact
 * series names available (annual + quarterly + trailing) for AAPL and 0700.HK.
 * Read-only against the live provider; writes a fixture for tests.
 */
import { writeFileSync } from 'node:fs';

const HOST = 'https://query2.finance.yahoo.com';
const UA = 'Mozilla/5.0';

const INCOME = [
  'TotalRevenue','CostOfRevenue','GrossProfit','OperatingIncome','EBIT','NetIncome','NetIncomeCommonStockholders',
  'BasicEPS','DilutedEPS','ResearchAndDevelopment','SellingGeneralAndAdministration','InterestExpense','PretaxIncome','TaxProvision',
  'EBITDA','OperatingRevenue',
];
const BALANCE = [
  'TotalAssets','TotalLiabilitiesNetMinorityInterest','StockholdersEquity','TotalDebt','LongTermDebt','CurrentAssets','CurrentLiabilities',
  'CashAndCashEquivalents','CashCashEquivalentsAndShortTermInvestments','Inventory','NetDebt','Goodwill','OtherIntangibleAssets','TotalEquityGrossMinorityInterest','MinorityInterest',
];
const CASH = [
  'OperatingCashFlow','CapitalExpenditure','InvestingCashFlow','FinancingCashFlow','FreeCashFlow','DepreciationAndAmortization','CashDividendsPaid','RepurchaseOfCapitalStock','StockBasedCompensation',
];

function series(prefix: string, names: string[]): string[] {
  return names.map((n) => `${prefix}${n}`);
}

async function fetchSeries(sym: string, types: string[], period1 = 1500000000, period2 = Math.floor(Date.now()/1000)) {
  const url = `${HOST}/ws/fundamentals-timeseries/v1/finance/timeseries/${encodeURIComponent(sym)}?symbol=${encodeURIComponent(sym)}&type=${types.join(',')}&period1=${period1}&period2=${period2}`;
  const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' } });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { return { status: res.status, error: text.slice(0,200) }; }
  return { status: res.status, json };
}

for (const sym of ['AAPL']) {
  for (const [label, prefix] of [['annual','annual'],['quarterly','quarterly'],['trailing','trailing']]) {
    const types = [...series(prefix, INCOME), ...series(prefix, BALANCE), ...series(prefix, CASH)];
    const r = await fetchSeries(sym, types);
    if (!r.json) { console.log(`${sym} ${label}: ERROR ${r.error}`); continue; }
    const results = r.json?.timeseries?.result ?? [];
    console.log(`\n=== ${sym} ${label}: ${results.length} result blocks, status ${r.status}`);
    let present = 0, missing: string[] = [];
    for (const block of results) {
      const typeName = block.meta?.type?.[0] ?? '?';
      const rows = (block[typeName] ?? []).filter((x: any)=>x!=null);
      if (rows.length) {
        present++;
        if (label === 'annual' && present <= 3) {
          const last = rows[rows.length-1];
          console.log(`  ${typeName}: ${rows.length} rows, last asOf=${last?.asOfDate} periodType=${last?.periodType} val=${last?.reportedValue?.raw} cur=${last?.reportedValue?.currencyCode}`);
        }
      } else missing.push(typeName);
    }
    console.log(`  present=${present} missing(${missing.length}): ${missing.join(',')}`);
  }
}
