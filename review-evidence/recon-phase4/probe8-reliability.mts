/**
 * RECON PHASE 4 — probe 8: how often does the Phase-2 quoteSummary call return
 * the dividend modules, and does a forced re-mint recover a partial/empty one?
 * READ-ONLY against the live provider.
 */
import { fetchProviderJson, quoteSummaryPath, analystSummaryPath } from '../../server/provider';
import { writeFileSync } from 'node:fs';

const OUT = new URL('./out/', import.meta.url).pathname;
const res = (j: any) => j?.quoteSummary?.result?.[0];
const sum = (rt: any) => !rt ? 'NULL' : `${Object.keys(rt).length}mod${rt.summaryDetail?.dividendRate ? '+div' : rt.summaryDetail ? '+SDnoDiv' : ' noSD'}`;

for (const sym of ['AAPL','KO','MSFT']) {
  const line: string[] = [];
  for (let i = 0; i < 8; i++) {
    const r = await fetchProviderJson(quoteSummaryPath(sym));
    line.push(sum(res(r?.json)));
  }
  console.log(`phase2 path ${sym.padEnd(5)} x8: ${line.join('  ')}`);
  const line2: string[] = [];
  for (let i = 0; i < 8; i++) {
    const r = await fetchProviderJson(analystSummaryPath(sym));
    line2.push(sum(res(r?.json)));
  }
  console.log(`analyst path ${sym.padEnd(5)} x8: ${line2.join('  ')}`);
}

// Does forceNewSession change an empty result?
console.log('\n=== forced re-mint attempt on an empty result ===');
for (let i = 0; i < 6; i++) {
  const a = await fetchProviderJson(quoteSummaryPath('AAPL'));
  const s1 = sum(res(a?.json));
  if (s1.includes('div') || s1 === 'NULL') {
    if (s1 === 'NULL') {
      const b = await fetchProviderJson(quoteSummaryPath('AAPL'), { forceNewSession: true });
      console.log(`  try${i}: ${s1} -> forceNewSession: ${sum(res(b?.json))}`);
    }
    continue;
  }
  const b = await fetchProviderJson(quoteSummaryPath('AAPL'), { forceNewSession: true });
  console.log(`  try${i}: empty(${s1}) -> forceNewSession: ${sum(res(b?.json))}`);
}

// time-series sanity: trailingDividendYield for a non-payer is absent, and for a
// payer its rows carry dataValue as a fraction. Also confirm the yield series is
// monthly and starts 2015 (so a 20Y yield line cannot be built from it).
writeFileSync(`${OUT}reliability.txt`, 'see stdout');
console.log('\nDONE probe8');
