/**
 * RECON PHASE 4 — probe 9: is `range=max` dividend-event data trustworthy?
 * Compare 20y / 25y / 30y / max at interval=1mo and 1d for a serial payer.
 * READ-ONLY against the live provider.
 */
import { fetchQuery2Json } from '../../server/provider';
const iso = (s: number) => new Date(s * 1000).toISOString().slice(0, 10);

async function ev(sym: string, range: string, interval: string) {
  const j = await fetchQuery2Json(`/v8/finance/chart/${encodeURIComponent(sym)}?range=${range}&interval=${interval}&events=div`);
  const res = (j as any)?.chart?.result?.[0];
  if (!res) return null;
  const divs = res.events?.dividends ? Object.values(res.events.dividends).map((d: any) => ({ amount: d.amount, date: d.date })).sort((a: any, b: any) => a.date - b.date) : [];
  const hist: Record<string, number> = {};
  for (const d of divs) { const y = new Date(d.date * 1000).getUTCFullYear(); const dec = `${Math.floor(y/10)*10}s`; hist[dec] = (hist[dec] ?? 0) + 1; }
  // gaps in days
  const gaps: number[] = [];
  for (let i = 1; i < divs.length; i++) gaps.push((divs[i].date - divs[i-1].date) / 86400);
  const maxGap = gaps.length ? Math.max(...gaps) : 0;
  return { n: divs.length, bars: res.timestamp?.length ?? 0, first: divs.length ? iso(divs[0].date) : '-', last: divs.length ? iso(divs[divs.length-1].date) : '-',
    hist, dupes: divs.length - new Set(divs.map((d: any) => d.date)).size, maxGapDays: Math.round(maxGap),
    barFirst: res.timestamp?.[0] ? iso(res.timestamp[0]) : '-', barLast: res.timestamp?.[res.timestamp.length-1] ? iso(res.timestamp[res.timestamp.length-1]) : '-' };
}

for (const sym of ['KO','IBM','O']) {
  console.log(`\n=== ${sym} ===`);
  for (const [range, interval] of [['20y','1mo'],['25y','1mo'],['30y','1mo'],['max','1mo'],['max','1d'],['max','1wk'],['30y','1d']] as const) {
    const e = await ev(sym, range, interval);
    if (!e) { console.log(`  ${range}/${interval}: NONE`); continue; }
    console.log(`  ${range.padEnd(4)}/${interval.padEnd(3)} n=${String(e.n).padStart(3)} bars=${String(e.bars).padStart(4)} barSpan=[${e.barFirst}..${e.barLast}] evSpan=[${e.first}..${e.last}] maxGap=${e.maxGapDays}d dupes=${e.dupes} perDecade=${JSON.stringify(e.hist)}`);
  }
}
console.log('\nDONE probe9');
