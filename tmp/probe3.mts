/**
 * Phase 3 recon, pass 3 — the MODERN statements endpoint.
 * `fundamentals-timeseries` is what Yahoo's own financials page uses; the legacy
 * quoteSummary statement modules return gutted data (all-null balance sheet).
 */
const HOST = 'https://query2.finance.yahoo.com';
const SYM = process.argv[2] ?? 'AAPL';

async function raw(pathAndQuery: string) {
  // timeseries does not need a crumb, but does want a UA.
  const res = await fetch(`${HOST}${pathAndQuery}`, {
    headers: { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' },
  });
  const text = await res.text();
  try { return { status: res.status, body: JSON.parse(text) }; }
  catch { return { status: res.status, body: text.slice(0, 200) }; }
}

const now = Math.floor(Date.now() / 1000);
const period1 = now - 6 * 365 * 86400;
const period2 = now + 400 * 86400;

const TYPES = {
  income: 'annualTotalRevenue,annualCostOfRevenue,annualGrossProfit,annualOperatingIncome,annualNetIncome,annualEBIT,annualInterestExpense,annualPretaxIncome,annualTaxProvision,annualResearchAndDevelopment,annualSellingGeneralAndAdministration,annualBasicEPS,annualDilutedEPS',
  balance: 'annualTotalAssets,annualTotalLiabilitiesNetMinorityInterest,annualStockholdersEquity,annualTotalDebt,annualLongTermDebt,annualCurrentAssets,annualCurrentLiabilities,annualCashAndCashEquivalents,annualInventory,annualGoodwill,annualOtherIntangibleAssets,annualNetDebt',
  cashflow: 'annualOperatingCashFlow,annualCapitalExpenditure,annualInvestingCashFlow,annualFinancingCashFlow,annualFreeCashFlow,annualDepreciationAndAmortization,annualCashDividendsPaid,annualNetIncome',
  quarterly: 'quarterlyTotalRevenue,quarterlyNetIncome,quarterlyGrossProfit,quarterlyOperatingIncome,quarterlyEBITDA,quarterlyTotalDebt,quarterlyCashAndCashEquivalents',
};

for (const [label, types] of Object.entries(TYPES)) {
  const q = `/ws/fundamentals-timeseries/v1/finance/timeseries/${SYM}?symbol=${SYM}&type=${types}&period1=${period1}&period2=${period2}`;
  const r = await raw(q);
  const results = (r.body as any)?.timeseries?.result ?? [];
  console.log(`\n=== ${label}: status=${r.status} series=${results.length} ===`);
  for (const s of results.slice(0, 30)) {
    const t = (s.meta?.type ?? []).filter((x: string) => x !== 'symbol');
    const rows = s.timestamp?.length ?? 0;
    const first = s[t[0]]?.[0];
    console.log(`  ${t[0] ?? '?'} rows=${rows} lastValue=${JSON.stringify(first?.reportedValue?.raw ?? first?.reportedValue ?? null)}`);
  }
  if (!results.length) console.log('  RAW:', JSON.stringify(r.body).slice(0, 300));
}

// Currency + a non-US symbol sanity check
const sym2 = '0700.HK';
const q2 = `/ws/fundamentals-timeseries/v1/finance/timeseries/${sym2}?symbol=${sym2}&type=annualTotalRevenue,annualNetIncome&period1=${period1}&period2=${period2}`;
const r2 = await raw(q2);
console.log(`\n=== ${sym2} income: status=${r2.status} ===`);
for (const s of ((r2.body as any)?.timeseries?.result ?? []).slice(0, 4)) {
  console.log(' ', JSON.stringify(s).slice(0, 200));
}
