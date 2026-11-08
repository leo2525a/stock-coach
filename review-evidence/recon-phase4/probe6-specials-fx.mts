/**
 * RECON PHASE 4 — probe 6: (a) special dividends (irregular amounts/spacing),
 * (b) chart meta currency vs dividend amount currency (0700.HK + foreign),
 * (c) is there any per-share dividend series; (d) 0700.HK chart currency.
 * READ-ONLY against the live provider.
 */
import { fetchQuery2Json } from '../../server/provider';

const iso = (s: number) => new Date(s * 1000).toISOString().slice(0, 10);
const num = (v: unknown) => { const r = (v as any)?.raw ?? v; return typeof r === 'number' ? r : null; };

async function chartMeta(sym: string) {
  const j = await fetchQuery2Json(`/v8/finance/chart/${encodeURIComponent(sym)}?range=10y&interval=1mo&events=div`);
  const res = (j as any)?.chart?.result?.[0];
  if (!res) return null;
  const divs = res.events?.dividends ? Object.values(res.events.dividends).map((d: any) => ({ amount: d.amount, date: d.date })).sort((a: any, b: any) => a.date - b.date) : [];
  // gap analysis in months
  const gapsDays: number[] = [];
  for (let i = 1; i < divs.length; i++) gapsDays.push((divs[i].date - divs[i-1].date) / 86400);
  const gapMonths = gapsDays.map((g) => (g / 30.44));
  const distinctAmts = [...new Set(divs.map((d: any) => d.amount))];
  return {
    currency: res.meta?.currency, symbol: res.meta?.symbol, exch: res.meta?.fullExchangeName,
    price: num(res.meta?.regularMarketPrice),
    n: divs.length, first: divs[0], last: divs[divs.length-1],
    gapMonthsRounded: [...new Set(gapMonths.map((m) => Math.round(m*10)/10))].slice(0, 12),
    distinctAmts: distinctAmts.length, amtsTail: distinctAmts.slice(-6),
    divs,
  };
}

// (a) special / irregular payers
for (const sym of ['COST','MCD','TGT','WMT','MAIN','LTC','STAG','IBM','MSFT','SYY','WHR','GPC','CBRL']) {
  const m = await chartMeta(sym);
  if (!m) { console.log(`${sym.padEnd(6)} chart: NONE`); continue; }
  const lastAmt = m.last.amount, lastDate = iso(m.last.date);
  // anomalies: amount jumps > 1.5x previous, or gaps far from modal
  const anom: string[] = [];
  for (let i = 1; i < m.divs.length; i++) {
    const r = m.divs[i].amount / m.divs[i-1].amount;
    if (r > 1.6 || r < 0.6) anom.push(`${iso(m.divs[i-1].date)} ${m.divs[i-1].amount} -> ${iso(m.divs[i].date)} ${m.divs[i].amount} (x${r.toFixed(2)})`);
  }
  console.log(`${sym.padEnd(6)} cur=${m.currency} price=${m.price} n=${String(m.n).padStart(3)} last=${lastDate}(${lastAmt}) distinctAmt=${m.distinctAmts} gaps(mo)=${JSON.stringify(m.gapMonthsRounded)}`);
  if (anom.length) console.log(`       AMOUNT ANOMALIES: ${anom.slice(0,4).join(' ; ')}`);
}

// (b) foreign listings: chart currency vs quote currency
console.log('\n=== foreign listings: chart meta ===');
for (const sym of ['0700.HK','ULVR.L','NESN.SW','RY.TO','D05.SI','BHP.AX','ENEL.MI','ENI.MI','VOD.L','6944.HK','0005.HK']) {
  const m = await chartMeta(sym);
  if (!m) { console.log(`${sym.padEnd(9)} chart: NONE`); continue; }
  console.log(`${sym.padEnd(9)} currency=${m.currency} exch=${m.exch} price=${m.price} n=${m.n} last=${iso(m.last.date)}(${m.last.amount}) gaps(mo)=${JSON.stringify(m.gapMonthsRounded)}`);
}
console.log('\nDONE probe6');
