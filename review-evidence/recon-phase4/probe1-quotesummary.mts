/**
 * RECON PHASE 4 — probe 1: does quoteSummary carry dividend fields at all, and
 * WHY were they null? Compare (a) app provider path (cookie+crumb, query1),
 * (b) crumb-free query2, (c) a raw no-crumb query1 call. Dumps raw module keys.
 * READ-ONLY: network reads + writes evidence JSON under tmp/recon-phase4/out.
 */
import { writeFileSync } from 'node:fs';
import {
  fetchProviderJson,
  quoteSummaryPath,
  analystSummaryPath,
  fetchQuery2Json,
  fetchWithRetry,
  getSession,
  cookieHeader,
  isCrumbRejection,
} from '../../server/provider';

const SYM = process.argv[2] ?? 'AAPL';
const OUT = new URL('./out/', import.meta.url).pathname;

const DIV_KEYS = [
  'dividendRate','dividendYield','trailingAnnualDividendRate','trailingAnnualDividendYield',
  'payoutRatio','fiveYearAvgDividendYield','exDividendDate','dividendDate','lastDividendValue',
  'lastDividendDate','lastSplitFactor','lastSplitDate','yield','ytdReturn','exDividendDateFmt',
];
const show = (v: unknown) => JSON.stringify(v ?? null);

function report(label: string, json: unknown): void {
  const root = json as any;
  const rt = root?.quoteSummary?.result?.[0];
  const err = root?.quoteSummary?.error;
  console.log(`\n### ${label}`);
  console.log(`  error=${show(err)}`);
  if (!rt) { console.log(`  NO RESULT BLOCK. top-level keys=${JSON.stringify(Object.keys(root ?? {}))}`); return; }
  console.log(`  module keys: ${JSON.stringify(Object.keys(rt))}`);
  for (const mod of Object.keys(rt)) {
    const m = rt[mod];
    const keys = m && typeof m === 'object' ? Object.keys(m) : [];
    console.log(`  - ${mod.padEnd(20)} ${keys.length} keys`);
  }
  const hits: string[] = [];
  for (const mod of ['summaryDetail','defaultKeyStatistics','financialData','calendarEvents','price']) {
    const m = rt[mod];
    if (!m || typeof m !== 'object') continue;
    for (const k of Object.keys(m)) {
      if (/div|payout|yield|date|frequency/i.test(k)) hits.push(`${mod}.${k}=${show((m as any)[k])}`);
    }
  }
  console.log('  DATE/DIV/YIELD-ish fields:');
  for (const h of hits) console.log(`    ${h}`);
  console.log('  calendarEvents dump: ' + show(rt.calendarEvents));
  console.log('  summaryDetail dump: ' + JSON.stringify(rt.summaryDetail));
}

async function tryRaw(url: string, label: string, withCrumb: boolean): Promise<unknown | null> {
  try {
    let final = url;
    const headers: Record<string, string> = { 'user-agent': 'Mozilla/5.0', accept: 'application/json' };
    if (withCrumb) {
      const s = await getSession();
      if (!s) { console.log(`\n### ${label}: NO SESSION`); return null; }
      final = `${url}${url.includes('?') ? '&' : '?'}crumb=${encodeURIComponent(s.crumb)}`;
      headers.cookie = cookieHeader(s.cookies);
    }
    const res = await fetchWithRetry(final, { headers });
    const text = res ? await res.text() : '';
    console.log(`\n### ${label}: status=${res?.status} bytes=${text.length} head=${text.slice(0, 140).replace(/\s+/g, ' ')}`);
    try { return JSON.parse(text); } catch { return null; }
  } catch (e: any) {
    console.log(`\n### ${label}: THROW ${e?.message}`);
    return null;
  }
}

// (a) app provider path (cookie + crumb, query1) — Phase 2 module set
const a = await fetchProviderJson(quoteSummaryPath(SYM));
report(`(a) quoteSummaryPath(${SYM}) [provider, crumb]`, a?.json);
if (a) writeFileSync(`${OUT}qs-summary-${SYM}.json`, JSON.stringify(a.json, null, 2));

// (b) analyst module set (superset incl. calendarEvents)
const b = await fetchProviderJson(analystSummaryPath(SYM));
report(`(b) analystSummaryPath(${SYM}) [provider, crumb]`, b?.json);
if (b) writeFileSync(`${OUT}qs-analyst-${SYM}.json`, JSON.stringify(b.json, null, 2));

// (c) crumb-free query2 quoteSummary
const c = await fetchQuery2Json(`/v10/finance/quoteSummary/${encodeURIComponent(SYM)}?modules=summaryDetail,defaultKeyStatistics,financialData,calendarEvents,price`);
report(`(c) query2 quoteSummary [crumb-FREE]`, c);

// (d) raw query1 with NO crumb — is the rejection a crumb rejection or empty module?
const d = await tryRaw(`https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(SYM)}?modules=summaryDetail`, `(d) query1 quoteSummary [NO crumb]`, false);
console.log(`  isCrumbRejection=${isCrumbRejection(d)}`);

// (e) v7 quote REST (classic dividend fields: trailingAnnualDividendRate etc.)
const e1 = await tryRaw(`https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(SYM)}&fields=trailingAnnualDividendRate,trailingAnnualDividendYield,dividendYield,dividendDate,exDividendDate,regularMarketPrice,currency,marketCap`, `(e) v7/quote query1 [crumb]`, true);
if (e1) writeFileSync(`${OUT}v7-quote-${SYM}.json`, JSON.stringify(e1, null, 2));
const eQ = (e1 as any)?.quoteResponse?.result?.[0];
if (eQ) {
  console.log('  v7 quote result keys: ' + JSON.stringify(Object.keys(eQ)));
  for (const k of Object.keys(eQ)) if (/div|yield|date|currency/i.test(k)) console.log(`    ${k}=${show(eQ[k])}`);
}

console.log('\nDONE probe1');
