import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp, bootstrap } from '../../server/app';
import { openDb } from '../../server/db';
const dir = mkdtempSync(path.join(tmpdir(), 'qa-p4-hd-'));
const db = openDb(path.join(dir, 'db.sqlite')); bootstrap(db);
const app = createApp(db); const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const port = (server.address() as any).port;
const iso = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);
try {
  for (const sym of ['O', 'COST']) {
    const r = await fetch(`http://127.0.0.1:${port}/api/dividends/${sym}/history?span=5y`);
    const b = await r.json() as any; const p = b.data ?? b;
    console.log(`\n### ${sym} history span=5y rows=${p.rows.length} payments=${p.payments.length}`);
    for (const row of p.rows.slice(-4)) console.log('   ', JSON.stringify({ ex: iso(row.exDate), pay: row.payableDate===null?'—':iso(row.payableDate), amt: row.amount }));
    const r2 = await fetch(`http://127.0.0.1:${port}/api/dividends/${sym}`);
    const b2 = await r2.json() as any; const p2 = b2.data ?? b2;
    console.log(`   MAIN route events=${p2.events.length}`);
    for (const row of p2.events.slice(-4)) console.log('   ', JSON.stringify({ ex: iso(row.exDate), pay: row.payableDate===null?'—':iso(row.payableDate), amt: row.amount }));
  }
} finally { await new Promise<void>((r) => server.close(() => r())); db.close(); rmSync(dir, { recursive: true, force: true }); }
