/** Phase 3 recon, pass 7 — pre/post market price availability. */
import { fetchProviderJson } from '../../server/provider';

for (const sym of ['AAPL', '0700.HK']) {
  try {
    const res = await fetchProviderJson(`/v10/finance/quoteSummary/${sym}?modules=price`);
    const p = (res.json as any)?.quoteSummary?.result?.[0]?.price;
    if (!p) { console.log(`${sym}: no price module (status ${res.status})`); continue; }
    const pick = (k: string) => (p as any)[k]?.raw ?? (p as any)[k] ?? null;
    console.log(`\n${sym}:`);
    for (const k of ['regularMarketPrice', 'regularMarketChangePercent', 'regularMarketVolume', 'marketState', 'preMarketPrice', 'preMarketChangePercent', 'postMarketPrice', 'postMarketChangePercent', 'currency', 'exchangeName', 'longName', 'quoteType']) {
      console.log(`  ${k} = ${JSON.stringify(pick(k))}`);
    }
  } catch (e: any) { console.log(`${sym}: THROW ${e?.message?.slice(0, 60)}`); }
}

// volume + pre/post via chart meta (crumb-free)
const HOST = 'https://query2.finance.yahoo.com';
const res = await fetch(`${HOST}/v8/finance/chart/AAPL?range=1d&interval=1d&includePrePost=true`, { headers: { 'user-agent': 'Mozilla/5.0' } });
const meta = (await res.json() as any)?.chart?.result?.[0]?.meta;
console.log('\nchart meta keys:', meta ? Object.keys(meta).join(',') : 'none');
console.log('chart: preMarketPrice=', meta?.preMarketPrice, 'postMarketPrice=', meta?.postMarketPrice, 'state=', meta?.marketState, 'vol=', meta?.regularMarketVolume);
