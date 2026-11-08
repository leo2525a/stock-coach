/**
 * Phase 3 recon, pass 5 — full shapes of every analyst module + FX availability.
 * Dumps a machine-readable snapshot for the spec, prints a tight human summary.
 */
import { fetchProviderJson } from '../../server/provider';
import { writeFileSync, mkdirSync } from 'node:fs';

const SYM = process.argv[2] ?? 'AAPL';
const MODS = 'financialData,defaultKeyStatistics,summaryDetail,earningsTrend,recommendationTrend,upgradeDowngradeHistory,calendarEvents,earningsHistory,price';

const res = await fetchProviderJson(`/v10/finance/quoteSummary/${SYM}?modules=${MODS}`);
const r = (res.json as any)?.quoteSummary?.result?.[0] ?? {};

mkdirSync('tmp/recon-phase3', { recursive: true });
writeFileSync(`tmp/recon-phase3/dump-${SYM}.json`, JSON.stringify(r, null, 1));

const fd = r.financialData ?? {};
const ks = r.defaultKeyStatistics ?? {};
const sd = r.summaryDetail ?? {};

console.log('=== financialData fields ===');
for (const [k, v] of Object.entries(fd)) {
  const val = (v as any)?.raw ?? v;
  if (typeof val !== 'object' && val !== null && val !== undefined) console.log(`  ${k} = ${val}`);
}
console.log('\n=== defaultKeyStatistics (selected) ===');
for (const k of ['enterpriseValue', 'forwardPE', 'pegRatio', 'priceToBook', 'enterpriseToRevenue', 'enterpriseToEbitda', 'trailingEps', 'forwardEps', 'bookValue', 'sharesOutstanding']) {
  console.log(`  ${k} = ${JSON.stringify((ks as any)[k]?.raw ?? (ks as any)[k] ?? null)}`);
}
console.log('\n=== summaryDetail (selected) ===');
for (const k of ['marketCap', 'trailingPE', 'forwardPE', 'dividendYield', 'beta', 'volume', 'averageVolume']) {
  console.log(`  ${k} = ${JSON.stringify((sd as any)[k]?.raw ?? (sd as any)[k] ?? null)}`);
}
console.log('\n=== earningsTrend[0] full ===');
console.log(JSON.stringify(r.earningsTrend?.trend?.[0] ?? null, null, 1).slice(0, 900));
console.log('\n=== recommendationTrend periods ===');
console.log((r.recommendationTrend?.trend ?? []).map((t: any) => `${t.period}:SB${t.strongBuy} B${t.buy} H${t.hold} S${t.sell} SS${t.strongSell}`).join(' | '));
console.log('\n=== upgradeDowngradeHistory sample ===');
for (const h of (r.upgradeDowngradeHistory?.history ?? []).slice(0, 5)) {
  console.log(`  ${h.epochGradeDate} ${h.firm} ${h.fromGrade}->${h.toGrade} (${h.action})`);
}
console.log('  total:', (r.upgradeDowngradeHistory?.history ?? []).length);
console.log('\n=== calendarEvents.earnings ===');
console.log(JSON.stringify(r.calendarEvents?.earnings ?? null).slice(0, 600));

// FX: currency switch feasibility
const HOST = 'https://query2.finance.yahoo.com';
async function raw(p: string) {
  const res = await fetch(`${HOST}${p}`, { headers: { 'user-agent': 'Mozilla/5.0' } });
  const t = await res.text();
  try { return { s: res.status, b: JSON.parse(t) }; } catch { return { s: res.status, b: t.slice(0, 120) }; }
}
console.log('\n=== FX rates (query2, no crumb) ===');
for (const pair of ['HKDUSD=X', 'EURUSD=X', 'USDCNY=X']) {
  const rr = await raw(`/v8/finance/chart/${pair}?range=1d&interval=1d`);
  const price = (rr.b as any)?.chart?.result?.[0]?.meta?.regularMarketPrice;
  console.log(`  ${pair} status=${rr.s} price=${price ?? 'n/a'}`);
}
