/**
 * Phase 3 data-source recon — does Yahoo actually serve analyst estimates,
 * price targets, ratings, and the three statements? Probe, don't assume.
 */
import { fetchWithRetry, mintSession, getSession, absorbCookies, cookieHeader, isCrumbRejection } from '../../server/provider';

const HOST = 'https://query1.finance.yahoo.com';
const SYM = process.argv[2] ?? 'AAPL';

async function qs(modules: string): Promise<{ status: number; body: any; bytes: number }> {
  const s = await getSession(async () => mintSession());
  if (!s) return { status: 0, body: null, bytes: 0 };
  const url = `${HOST}/v10/finance/quoteSummary/${SYM}?modules=${modules}&crumb=${encodeURIComponent(s.crumb)}`;
  const res = await fetchWithRetry(url, { headers: { cookie: cookieHeader(s.cookies), 'user-agent': 'Mozilla/5.0' } });
  const text = await res.text();
  let body: any = null;
  try { body = JSON.parse(text); } catch { body = text.slice(0, 120); }
  return { status: res.status, body, bytes: text.length };
}

const MODULES = [
  'price', 'summaryDetail', 'assetProfile', 'defaultKeyStatistics', 'financialData',
  'calendarEvents', 'earnings', 'earningsHistory', 'earningsTrend', 'recommendationTrend',
  'upgradeDowngradeHistory', 'indexTrend', 'industryTrend',
  'incomeStatementHistory', 'incomeStatementHistoryQuarterly',
  'balanceSheetHistory', 'balanceSheetHistoryQuarterly',
  'cashflowStatementHistory', 'cashflowStatementHistoryQuarterly',
];

const results: Record<string, string> = {};
for (const m of MODULES) {
  try {
    const r = await qs(m);
    const rt = r.body?.quoteSummary?.result?.[0];
    const err = r.body?.quoteSummary?.error;
    let shape = 'EMPTY';
    if (err) shape = `ERR ${JSON.stringify(err).slice(0, 80)}`;
    else if (rt && rt[m]) {
      const v = rt[m];
      const keys = Object.keys(v);
      shape = `OK keys=[${keys.slice(0, 6).join(',')}${keys.length > 6 ? ',…' : ''}]`;
    } else if (rt) shape = `result-but-no-${m}`;
    results[m] = `${r.status} ${r.bytes}b ${shape}`;
  } catch (e: any) {
    results[m] = `THROW ${e?.message?.slice(0, 60)}`;
  }
}

console.log(`\n=== quoteSummary modules for ${SYM} ===`);
for (const [k, v] of Object.entries(results)) console.log(`${k.padEnd(34)} ${v}`);

// Deep dump the analyst-critical ones if present
const deep = await qs('earningsTrend,recommendationTrend,financialData,calendarEvents,upgradeDowngradeHistory');
const rt = deep.body?.quoteSummary?.result?.[0];
console.log('\n=== earningsTrend shape ===');
if (rt?.earningsTrend?.trend) {
  for (const t of rt.earningsTrend.trend.slice(0, 5)) {
    console.log(` ${t.period}(${t.endDate ?? '?'}) epsEst=${JSON.stringify(t.earningsEstimate?.avg?.raw ?? t.earningsEstimate?.avg ?? null)} revEst=${JSON.stringify(t.revenueEstimate?.avg?.raw ?? null)} #analysts=${t.earningsEstimate?.numberOfAnalysts?.raw ?? '?'} growth=${JSON.stringify(t.growth?.raw ?? null)}`);
  }
} else console.log(' none', JSON.stringify(rt?.earningsTrend ?? null).slice(0, 200));

console.log('\n=== recommendationTrend shape ===');
console.log(JSON.stringify(rt?.recommendationTrend ?? null).slice(0, 500));

console.log('\n=== financialData target ===');
const fd = rt?.financialData;
console.log(JSON.stringify({ currentPrice: fd?.currentPrice, targetHigh: fd?.targetHighPrice, targetLow: fd?.targetLowPrice, targetMean: fd?.targetMeanPrice, targetMedian: fd?.targetMedianPrice, recKey: fd?.recommendationKey, recMean: fd?.recommendationMean, numAnalysts: fd?.numberOfAnalystOpinions }, null, 0));

console.log('\n=== calendarEvents ===');
console.log(JSON.stringify(rt?.calendarEvents?.earnings ?? rt?.calendarEvents ?? null).slice(0, 400));
