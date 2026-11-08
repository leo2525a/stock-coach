/**
 * QA probe 17 — (a) exact epoch seconds of the duplicated rows, (b) whether the
 * CSV/JSON export carries the duplicate and the mixed-unit amount, (c) whether
 * `buildSchedule`'s next-payment day-match is dead code on the shipped routes.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp, bootstrap } from '../../server/app';
import { openDb } from '../../server/db';
import { buildDividendTables } from '../../src/dividend/exportModel';
import { createTranslator } from '../../shared/i18n';
import { en } from '../../shared/i18n/en';

const dir = mkdtempSync(path.join(tmpdir(), 'qa-p4-x-'));
const db = openDb(path.join(dir, 'db.sqlite')); bootstrap(db);
const app = createApp(db); const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const port = (server.address() as any).port;
const base = `http://127.0.0.1:${port}`;
const t = createTranslator(en, {}, 'en');
try {
  for (const sym of ['O', 'AAPL', 'ULVR.L']) {
    const r = await fetch(`${base}/api/dividends/${sym}`);
    const b = await r.json() as any; const p = b.data ?? b;
    console.log(`\n### ${sym}`);
    const tail = p.events.slice(-3);
    for (const row of tail) console.log('   ', JSON.stringify({ exDate: row.exDate, exISO: new Date(row.exDate * 1000).toISOString(), pay: row.payableDate, payISO: row.payableDate === null ? null : new Date(row.payableDate * 1000).toISOString(), amt: row.amount, ccy: row.currency }));
    const exDays = tail.map((x: any) => Math.floor(x.exDate / 86400));
    console.log('   same-day duplicates in the tail:', exDays.length !== new Set(exDays).size);
    // build the export table
    const payload = { ...p, shareholder: p.shareholder, symbol: sym };
    const tables = buildDividendTables(t, payload as any, null);
    const sched = (tables as any).schedule ?? (tables as any).find?.((x: any) => x.id === 'schedule');
    const schedTable = Array.isArray(tables) ? (tables as any[]).find((x) => /schedule|payout/i.test(JSON.stringify(x.header ?? x.title ?? ''))) : null;
    // fall back: stringify and count occurrences of the last ex-date
    const lastEx = new Date(tail.at(-1).exDate * 1000).toISOString().slice(0, 10);
    const blob = JSON.stringify(tables);
    const occurrences = blob.split(lastEx).length - 1;
    console.log(`   export tables: ${Array.isArray(tables) ? tables.length : Object.keys(tables).length}`);
    console.log(`   occurrences of ${lastEx} in the export model: ${occurrences}`);
    console.log(`   export contains the upcoming amount ${tail.at(-1).amount}:`, blob.includes(String(tail.at(-1).amount)));
  }
} finally { await new Promise<void>((r) => server.close(() => r())); db.close(); rmSync(dir, { recursive: true, force: true }); }
