/**
 * QA probe 23 — is the duplicate row ALSO visible when the schedule's amount is
 * inconsistent (0005.HK: 0.78396004 vs 0.10 on the same day)? Print the §C.5
 * DOM cells directly for 0005.HK and confirm which row the UI shows first.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp, bootstrap } from '../../server/app';
import { openDb } from '../../server/db';
const dir = mkdtempSync(path.join(tmpdir(), 'qa-p4-i-'));
const db = openDb(path.join(dir, 'db.sqlite')); bootstrap(db);
const app = createApp(db); const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const port = (server.address() as any).port;
const iso = (t: number | null) => (t === null ? '—' : new Date(t * 1000).toISOString().slice(0, 10));
try {
  for (const sym of ['0005.HK', 'ULVR.L']) {
    const b = await (await fetch(`http://127.0.0.1:${port}/api/dividends/${sym}`)).json() as any;
    const p = b.data ?? b;
    console.log(`\n### ${sym} — §C.5 rows as the UI sorts them (newest first) at the top`);
    const rows = [...p.events].sort((a: any, b2: any) => b2.exDate - a.exDate).slice(0, 4);
    console.log('   Announced | Ex-Date | Record | Payable | Ccy | Amount | Adj | Frequency | Type');
    for (const r of rows) {
      console.log(`   — | ${iso(r.exDate)} | — | ${iso(r.payableDate)} | ${r.currency} | ${r.amount} | ${r.adjAmount} | ${r.frequency ?? '—'} | —`);
    }
    console.log(`   facts: annualRate=${p.facts.annualRate.value} lastDividendValue=${p.facts.lastDividendValue.value} currency=${p.facts.currency.value}`);
    console.log(`   §C.1 "Last Dividend" cell would read: ${p.facts.lastDividendValue.value} ${p.facts.currency.value}`);
  }
} finally { await new Promise<void>((r) => server.close(() => r())); db.close(); rmSync(dir, { recursive: true, force: true }); }
