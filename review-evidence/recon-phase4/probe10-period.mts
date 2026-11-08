/**
 * RECON PHASE 4 — probe 10: use explicit period1/period2 (epoch seconds) instead
 * of range=max, and see whether dividend events come back complete and
 * un-truncated. READ-ONLY against the live provider.
 */
import { fetchQuery2Json } from '../../server/provider';
const iso = (s: number) => new Date(s * 1000).toISOString().slice(0, 10);

async function ev(sym: string, p1: number, p2: number, interval = '1mo') {
  const j = await fetchQuery2Json(`/v8/finance/chart/${encodeURIComponent(sym)}?period1=${p1}&period2=${p2}&interval=${interval}&events=div`);
  const res = (j as any)?.chart?.result?.[0];
  const err = (j as any)?.chart?.error;
  if (!res) return { err };
  const divs = res.events?.dividends ? Object.values(res.events.dividends).map((d: any) => ({ amount: d.amount, date: d.date })).sort((a: any, b: any) => a.date - b.date) : [];
  const hist: Record<string, number> = {};
  for (const d of divs) { const dec = `${Math.floor(new Date(d.date*1000).getUTCFullYear()/10)*10}s`; hist[dec] = (hist[dec] ?? 0) + 1; }
  const gaps: number[] = []; for (let i=1;i<divs.length;i++) gaps.push((divs[i].date-divs[i-1].date)/86400);
  return { n: divs.length, bars: res.timestamp?.length ?? 0, first: divs.length?iso(divs[0].date):'-', last: divs.length?iso(divs[divs.length-1].date):'-',
    maxGap: gaps.length?Math.round(Math.max(...gaps)):0, hist, metaCur: res.meta?.currency, err };
}

const NOW = Math.floor(Date.now()/1000);
console.log('=== explicit period windows (KO) ===');
for (const [label, years] of [['50y',50],['60y',60],['since-1970',NOW-56*365*86400]] as const) {
  const p1 = Number.isInteger(years) ? NOW - years*365*86400 : years;
  const e = await ev('KO', p1, NOW);
  console.log(`  ${String(label).padEnd(12)} n=${e.n} bars=${e.bars} span=[${e.first}..${e.last}] maxGap=${e.maxGap} perDecade=${JSON.stringify(e.hist)}`);
}
console.log('=== explicit period windows (IBM, O) ===');
for (const sym of ['IBM','O','JNJ']) {
  const e = await ev(sym, NOW-60*365*86400, NOW);
  console.log(`  ${sym.padEnd(5)} n=${e.n} bars=${e.bars} span=[${e.first}..${e.last}] maxGap=${e.maxGap} perDecade=${JSON.stringify(e.hist)}`);
}
console.log('\nDONE probe10');
