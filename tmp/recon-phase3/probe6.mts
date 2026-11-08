/**
 * Phase 3 recon, pass 6 — last chance for multi-year estimates.
 * Try every plausible module/endpoint name; report honestly if none exist.
 */
import { fetchProviderJson } from '../../server/provider';

const SYM = 'AAPL';

async function mod(name: string) {
  try {
    const res = await fetchProviderJson(`/v10/finance/quoteSummary/${SYM}?modules=${name}`);
    const rt = (res.json as any)?.quoteSummary?.result?.[0];
    const v = rt?.[name];
    if (v === undefined) return `MISSING (result keys: ${rt ? Object.keys(rt).join(',') : 'none'})`;
    return `PRESENT ${JSON.stringify(v).slice(0, 120)}`;
  } catch (e: any) { return `THROW ${e?.message?.slice(0, 50)}`; }
}

for (const name of ['analystEstimates', 'earningsEstimates', 'estimate', 'estimates', 'forwardEstimates', 'analystEstimate', 'sectorTrend', 'growthEstimates']) {
  console.log(`${name.padEnd(20)} ${await mod(name)}`);
}

// Does the crumb-free timeseries return FUTURE estimate periods when asked far ahead?
const HOST = 'https://query2.finance.yahoo.com';
const now = Math.floor(Date.now() / 1000);
const far = now + 4 * 365 * 86400;
const url = `${HOST}/ws/fundamentals-timeseries/v1/finance/timeseries/${SYM}?symbol=${SYM}&type=annualTotalRevenue,annualDilutedEPS&period1=${now - 2 * 365 * 86400}&period2=${far}`;
const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0' } });
const body: any = await res.json();
console.log('\n=== far-future timeseries (any estimate/forward rows?) ===');
for (const s of (body?.timeseries?.result ?? [])) {
  const t = (s.meta?.type ?? []).filter((x: string) => x !== 'symbol')[0];
  for (const row of (s[t] ?? [])) console.log(`  ${t} asOf=${row.asOfDate} ${row.periodType} = ${row.reportedValue?.raw}`);
}
