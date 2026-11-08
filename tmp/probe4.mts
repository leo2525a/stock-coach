/**
 * Phase 3 recon, pass 4 — the two hardest asks:
 *  (a) Earnings Matrix across several future years — how deep does earningsTrend go?
 *  (b) Rolling NTM estimate-vs-price — is historical estimate data retrievable at all?
 */
import { fetchProviderJson } from '../../server/provider';

const SYM = process.argv[2] ?? 'AAPL';

const res = await fetchProviderJson(`/v10/finance/quoteSummary/${SYM}?modules=earningsTrend,earnings`);
const r = (res.json as any)?.quoteSummary?.result?.[0];

console.log('=== earningsTrend periods ===');
for (const t of r?.earningsTrend?.trend ?? []) {
  console.log(` ${t.period.padEnd(5)} end=${t.endDate ?? '?'} eps=${t.earningsEstimate?.avg?.raw ?? '?'} rev=${t.revenueEstimate?.avg?.raw ?? '?'} #an=${t.earningsEstimate?.numberOfAnalysts?.raw ?? '?'} growth=${t.growth?.raw ?? '?'}`);
}

console.log('\n=== earnings (financialsChart = last 4y revs/earnings + chart est) ===');
const e = r?.earnings;
console.log('yearly:', JSON.stringify(e?.financialsChart?.yearly ?? []).slice(0, 400));
console.log('quarterly:', JSON.stringify(e?.financialsChart?.quarterly ?? []).slice(0, 300));

// (b) historical analyst estimates over time — try the v1 "timeseries" style for estimates
const HOST = 'https://query2.finance.yahoo.com';
async function raw(pathAndQuery: string) {
  const res = await fetch(`${HOST}${pathAndQuery}`, { headers: { 'user-agent': 'Mozilla/5.0' } });
  const t = await res.text();
  try { return { status: res.status, body: JSON.parse(t) }; } catch { return { status: res.status, body: t.slice(0, 200) }; }
}
const now = Math.floor(Date.now() / 1000);
// annual "estimate" periodType sometimes appears in timeseries:
const q = `/ws/fundamentals-timeseries/v1/finance/timeseries/${SYM}?symbol=${SYM}&type=annualTotalRevenue&period1=${now - 3 * 365 * 86400}&period2=${now + 1200 * 86400}`;
const rr = await raw(q);
console.log('\n=== timeseries look-ahead (does it include FUTURE estimate periods?) ===');
for (const s of ((rr.body as any)?.timeseries?.result ?? [])) {
  for (const row of s[s.meta?.type?.filter((x: string) => x !== 'symbol')[0]] ?? []) {
    console.log(` asOf=${row.asOfDate} periodType=${row.periodType} value=${row.reportedValue?.raw ?? row.reportedValue}`);
  }
}
