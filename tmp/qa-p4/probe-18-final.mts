/**
 * QA probe 18 — the remaining specifics:
 *  (a) 0005.HK duplicate ex-date with an inconsistent amount,
 *  (b) ULVR.L §C.1 "last dividend" figure and its unit,
 *  (c) `buildSchedule`'s nextPayDate parameter is dead on both shipped routes,
 *  (d) whether the "upcoming" ex-date is actually in the future.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { createApp, bootstrap } from '../../server/app';
import { openDb } from '../../server/db';
import { formatYield, sourcedText, formatAmount, DASH } from '../../src/dividend/format';

const dir = mkdtempSync(path.join(tmpdir(), 'qa-p4-y-'));
const db = openDb(path.join(dir, 'db.sqlite')); bootstrap(db);
const app = createApp(db); const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const port = (server.address() as any).port;
const iso = (t: number | null) => (t === null || t === undefined ? '—' : new Date(t * 1000).toISOString().slice(0, 10));
try {
  for (const sym of ['0005.HK', 'ULVR.L', 'O']) {
    const r = await fetch(`http://127.0.0.1:${port}/api/dividends/${sym}`);
    const b = await r.json() as any; const p = b.data ?? b;
    console.log(`\n############ ${sym} ############`);
    const exs = p.events.map((x: any) => x.exDate);
    const dupDays = new Map<number, any[]>();
    for (const row of p.events) {
      const d = Math.floor(row.exDate / 86400);
      dupDays.set(d, [...(dupDays.get(d) ?? []), row]);
    }
    for (const [d, rows] of dupDays) {
      if (rows.length > 1) {
        console.log(`  DUPLICATE day-bucket ${iso(rows[0].exDate)} (${rows.length} rows):`);
        for (const x of rows) console.log(`     exSeconds=${x.exDate} (${new Date(x.exDate * 1000).toISOString()}) amt=${x.amount} ccy=${x.currency} pay=${iso(x.payableDate)}`);
      }
    }
    const last = p.events.at(-1);
    console.log(`  last row: ex=${new Date(last.exDate * 1000).toISOString()} amt=${last.amount} pay=${iso(last.payableDate)}`);
    console.log(`  facts.nextExDate=${new Date(p.facts.nextExDate.value * 1000).toISOString()}  facts.nextPayDate=${p.facts.nextPayDate.value === null ? '—' : new Date(p.facts.nextPayDate.value * 1000).toISOString()}`);
    console.log(`  NOW=2026-11-07 → nextExDate is ${p.facts.nextExDate.value * 1000 > Date.parse('2026-11-07') ? 'FUTURE' : '*** IN THE PAST ***'}`);
    if (p.facts.nextPayDate.value !== null) {
      console.log(`  → nextPayDate is ${p.facts.nextPayDate.value * 1000 > Date.parse('2026-11-07') ? 'FUTURE' : '*** IN THE PAST ***'}`);
      console.log(`  → nextPayDate - nextExDate = ${Math.round((p.facts.nextPayDate.value - p.facts.nextExDate.value) / 86400)} days`);
    }
    // §C.1 figures as the UI would render them
    const ccy = p.facts.currency.value;
    console.log(`  §C.1 last dividend cell -> "${sourcedText(p.facts.lastDividendValue, (v) => formatAmount(v, ccy)).text}" (currency=${ccy})`);
    console.log(`  §C.1 annual rate cell   -> "${sourcedText(p.facts.annualRate, (v) => formatAmount(v, ccy)).text}"`);
    console.log(`  §C.1 indicated yield    -> "${sourcedText(p.facts.indicatedYield, (v) => formatYield(v)).text}"`);
    const chartLast = p.series.payments.at(-1);
    console.log(`  chart last payment = ${chartLast.amount} ${ccy}  (ratio lastDividendValue/chartLast = ${(p.facts.lastDividendValue.value / chartLast.amount).toFixed(4)})`);
  }

  console.log('\n############ (c) buildSchedule nextPayDate argument at its call sites ############');
  const src = readFileSync('shared/dividends.ts', 'utf8');
  for (const m of src.matchAll(/buildSchedule\([^)]*\)/gs)) console.log('   ', m[0].replace(/\s+/g, ' '));
  console.log('   (both callers pass `null` → the `isNext` payable branch inside buildSchedule is unreachable)');
} finally { await new Promise<void>((r) => server.close(() => r())); db.close(); rmSync(dir, { recursive: true, force: true }); }
