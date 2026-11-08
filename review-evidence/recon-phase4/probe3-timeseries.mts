/**
 * RECON PHASE 4 — probe 3: (a) fundamentals-timeseries dividend/buyback/debt
 * series (shareholder-yield decomposition inputs), (b) enumerate quoteSummary
 * modules that might carry announced/record/payable dates, (c) any per-share
 * dividend series. READ-ONLY against the live provider.
 */
import { writeFileSync } from 'node:fs';
import { fetchQuery2Json, timeseriesPath, fetchProviderJson, isCrumbRejection } from '../../server/provider';

const OUT = new URL('./out/', import.meta.url).pathname;
const SYM = process.argv[2] ?? 'AAPL';
const P1 = 1100000000, P2 = Math.floor(Date.now() / 1000);

async function ts(typeNames: string[]) {
  const json = await fetchQuery2Json(timeseriesPath(SYM, typeNames, P1, P2));
  const results = (json as any)?.timeseries?.result ?? [];
  const byType = new Map<string, any[]>();
  for (const block of results) {
    const t = block?.meta?.type?.[0];
    const rows = (block?.[t] ?? []).filter((x: any) => x != null);
    byType.set(t, rows);
  }
  return byType;
}

// --- (a) candidate series for shareholder yield + dividends ---
const CANDIDATES = [
  'CashDividendsPaid','CommonStockDividendPaid','DividendsPaid','RepurchaseOfCapitalStock',
  'LongTermDebtPayments','LongTermDebtIssuance','LongTermDebt','CashAndCashEquivalents',
  'TotalDebt','NetDebt','ShortLongTermDebtIssuance','IssuanceOfDebt','RepaymentOfDebt','DebtIssuance',
  'DividendsPerShare','CommonStockDividendsPerShare','CashDividendsPaidPerShare','DividendPerShare',
  'TotalDividendPerShare','PayoutRatio','DividendYield','StockholdersEquity','CommonStockEquity',
  'RepurchaseOfStock','TreasuryStockRetired','FreeCashFlow','NetIncome','NetIncomeCommonStockholders',
  'ShareIssued','OrdinarySharesNumber','NetIncomeContinuousOperations',
];
const PREFIXES = ['annual','quarterly','trailing'];
const all = [...new Set(PREFIXES.flatMap((p) => CANDIDATES.map((c) => `${p}${c}`)) )];

console.log(`=== ${SYM} fundamentals-timeseries presence (${all.length} types) ===`);
const found = await ts(all);
const present: string[] = [], missing: string[] = [];
for (const t of all) (found.has(t) && found.get(t)!.length ? present : missing).push(t);
console.log(`PRESENT (${present.length}):`);
for (const t of present) {
  const rows = found.get(t)!;
  const last = rows[rows.length - 1];
  const vals = rows.map((r: any) => `${r.asOfDate}=${r.reportedValue?.raw}`).join(' | ');
  console.log(`  ${t.padEnd(38)} n=${String(rows.length).padStart(2)} cur=${last?.reportedValue?.currencyCode}  ${vals}`);
}
console.log(`MISSING (${missing.length}): ${missing.join(', ')}`);
writeFileSync(`${OUT}ts-${SYM.replace(/[^A-Za-z0-9]/g,'_')}.json`, JSON.stringify(Object.fromEntries([...found].map(([k,v])=>[k,v])), null, 2));

// --- (b) which quoteSummary modules exist at all (date-bearing?) ---
const MODULES = [
  'summaryDetail','defaultKeyStatistics','calendarEvents','price','financialData','earnings','earningsHistory',
  'dividends','dividend','calendarEventsHistory','history','chart','netSharePurchaseActivity',
  'capitalGains','fundProfile','fundPerformance','topHoldings','insiderTransactions','majorHoldersBreakdown',
  'institutionOwnership','esgScores','summaryProfile','quoteType','tradeSummary','bulk','earningsTrend',
];
console.log(`\n=== ${SYM} quoteSummary module probe ===`);
for (const m of MODULES) {
  const r = await fetchProviderJson(`/v10/finance/quoteSummary/${encodeURIComponent(SYM)}?modules=${m}`);
  const root = (r?.json as any)?.quoteSummary;
  const rt = root?.result?.[0];
  const err = root?.error;
  const mod = rt?.[m];
  let shape = 'ABSENT/EMPTY';
  if (err === null && rt && mod && typeof mod === 'object' && Object.keys(mod).length) {
    const ks = Object.keys(mod);
    const dateish = ks.filter((k) => /date/i.test(k));
    shape = `keys=[${ks.slice(0,8).join(',')}${ks.length>8?',…':''}] dateKeys=[${dateish.join(',')}]`;
  } else if (err) shape = `err=${JSON.stringify(err).slice(0,50)}`;
  console.log(`  ${m.padEnd(26)} ${shape}`);
}

// --- (c) the 'dividends' module deep dump if it exists ---
const d = await fetchProviderJson(`/v10/finance/quoteSummary/${encodeURIComponent(SYM)}?modules=dividends,calendarEvents`);
console.log(`\n=== ${SYM} dividends+calendarEvents raw ===\n` + JSON.stringify((d?.json as any)?.quoteSummary?.result?.[0] ?? null, null, 2).slice(0, 2500));
console.log('\nDONE probe3');
