/**
 * RECON PHASE 4 — probe 4: (a) true shape of timeseries `trailingDividendYield`
 * (140 monthly rows — is it a real yield series?), (b) reliability of the
 * quoteSummary `summaryDetail` module (single- vs multi-module, repeats).
 * READ-ONLY against the live provider.
 */
import { writeFileSync } from 'node:fs';
import { fetchQuery2Json, timeseriesPath, fetchProviderJson, quoteSummaryPath } from '../../server/provider';

const OUT = new URL('./out/', import.meta.url).pathname;
const SYM = process.argv[2] ?? 'AAPL';
const P1 = 1100000000, P2 = Math.floor(Date.now() / 1000);

// --- (a) raw trailingDividendYield block ---
const j = await fetchQuery2Json(timeseriesPath(SYM, ['trailingDividendYield', 'annualDividendYield', 'annualCashDividendsPaid'], P1, P2));
const results = (j as any)?.timeseries?.result ?? [];
console.log(`=== ${SYM} timeseries: ${results.length} blocks ===`);
for (const b of results) {
  const t = b?.meta?.type?.[0];
  const rows = b?.[t] ?? [];
  console.log(`\n--- block type=${t} rows=${rows?.length}`);
  console.log('  meta: ' + JSON.stringify(b?.meta));
  const nonNull = (rows ?? []).filter((r: any) => r != null);
  console.log(`  sample rows (last 3): ${JSON.stringify(nonNull.slice(-3))}`);
}
writeFileSync(`${OUT}ts-yieldraw-${SYM}.json`, JSON.stringify(j, null, 2).slice(0, 200000));

// --- (b) summaryDetail reliability ---
console.log(`\n=== ${SYM} quoteSummary reliability ===`);
const tries: Array<[string, string]> = [
  ['single:summaryDetail', 'summaryDetail'],
  ['multi:summaryDetail,price', 'summaryDetail,price'],
  ['multi:summaryDetail,defaultKeyStatistics', 'summaryDetail,defaultKeyStatistics'],
  ['phase2 list', 'assetProfile,summaryDetail,defaultKeyStatistics,financialData,price'],
  ['analyst list', 'financialData,defaultKeyStatistics,summaryDetail,earningsTrend,recommendationTrend,upgradeDowngradeHistory,calendarEvents,earningsHistory,price,assetProfile'],
  ['no-modules (all)', ''],
];
for (const [label, modules] of tries) {
  const hits: string[] = [];
  for (let i = 0; i < 4; i++) {
    const path = `/v10/finance/quoteSummary/${encodeURIComponent(SYM)}?modules=${modules}`;
    const r = await fetchProviderJson(path);
    const rt = (r?.json as any)?.quoteSummary?.result?.[0];
    const sd = rt?.summaryDetail;
    const has = rt ? Object.keys(rt).length : -1;
    const hasDiv = sd ? (sd.divisor ?? sd.dividendRate ? 'DIV' : 'noDiv') : 'noSD';
    hits.push(`${has}mod${sd ? '+' + hasDiv : ''}`);
  }
  console.log(`  ${label.padEnd(42)} ${hits.join('  ')}`);
}
console.log('\nDONE probe4');
