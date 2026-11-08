/**
 * Phase 3 recon, pass 2 — statement depth + rolling-NTM feasibility + extras.
 */
import { fetchProviderJson } from '../../server/provider';

const SYM = process.argv[2] ?? 'AAPL';

async function qs(modules: string) {
  const res = await fetchProviderJson(`/v10/finance/quoteSummary/${SYM}?modules=${modules}`);
  const body = res.json as any;
  return body?.quoteSummary?.result?.[0] ?? null;
}

const r = await qs('incomeStatementHistory,balanceSheetHistory,cashflowStatementHistory,incomeStatementHistoryQuarterly,balanceSheetHistoryQuarterly,cashflowStatementHistoryQuarterly,earningsHistory,majorHoldersBreakdown,institutionOwnership,epsTrend,epsRevisions');
if (!r) { console.log('no session'); process.exit(1); }

const show = (label: string, arr: any[] | undefined, keep: string[]) => {
  console.log(`\n=== ${label}: ${arr?.length ?? 0} periods ===`);
  for (const p of arr ?? []) {
    const end = p.endDate?.fmt ?? p.endDate ?? '?';
    const sample: Record<string, any> = {};
    for (const k of keep) sample[k] = p[k]?.raw ?? p[k] ?? null;
    console.log(` ${end}`, JSON.stringify(sample));
  }
};

show('income (annual)', r.incomeStatementHistory?.incomeStatementHistory, ['totalRevenue','costOfRevenue','grossProfit','operatingIncome','netIncome','ebit','incomeBeforeTax','incomeTaxExpense','interestExpense','researchDevelopment','sellingGeneralAdministrative']);
show('income (quarterly)', r.incomeStatementHistoryQuarterly?.incomeStatementHistory, ['totalRevenue','grossProfit','operatingIncome','netIncome','ebit','interestExpense']);
show('balance (annual)', r.balanceSheetHistory?.balanceSheetStatements, ['totalAssets','totalLiab','totalStockholderEquity','longTermDebt','shortLongTermDebt','totalCurrentAssets','totalCurrentLiabilities','cash','inventory','goodWill','intangibleAssets']);
show('balance (quarterly)', r.balanceSheetHistoryQuarterly?.balanceSheetStatements, ['totalAssets','totalLiab','totalStockholderEquity','longTermDebt','cash']);
show('cashflow (annual)', r.cashflowStatementHistory?.cashflowStatements, ['totalCashFromOperatingActivities','capitalExpenditures','totalCashflowsFromInvestingActivities','totalCashFromFinancingActivities','netIncome','depreciation','dividendsPaid','freeCashFlow']);
show('cashflow (quarterly)', r.cashflowStatementHistoryQuarterly?.cashflowStatements, ['totalCashFromOperatingActivities','capitalExpenditures']);

console.log('\n=== earningsHistory ===');
for (const h of r.earningsHistory?.history ?? []) {
  console.log(` ${h.quarter?.fmt} actual=${h.epsActual?.raw} est=${h.epsEstimate?.raw} surprise%=${h.surprisePercent?.raw}`);
}
console.log('\n=== epsTrend / epsRevisions (meant to be analyst revision trend) ===');
console.log('epsTrend:', JSON.stringify(r.epsTrend ?? null).slice(0, 300));
console.log('epsRevisions:', JSON.stringify(r.epsRevisions ?? null).slice(0, 300));
console.log('majorHolders:', JSON.stringify(r.majorHoldersBreakdown ?? null).slice(0, 300));
console.log('institutionOwnership n=', r.institutionOwnership?.ownershipList?.length ?? 0);
