/**
 * QA probe 15 — reliability of the two schedule defects:
 *  (a) duplicate Ex-Date rows on the HISTORY route (which actually feeds the
 *      on-screen schedule) across every span, repeated to rule out a fluke;
 *  (b) payable-before-ex on the same route.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp, bootstrap } from '../../server/app';
import { openDb } from '../../server/db';

const dir = mkdtempSync(path.join(tmpdir(), 'qa-p4-rel-'));
const db = openDb(path.join(dir, 'db.sqlite')); bootstrap(db);
const app = createApp(db); const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const port = (server.address() as { port: number }).port;
const base = `http://127.0.0.1:${port}`;
const iso = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);
const SPANS = ['1y', '3y', '5y', '10y', '20y', 'ALL'];
try {
  for (const sym of ['O', 'COST', 'AGNC', 'AAPL', 'KO', 'MSFT']) {
    const found: string[] = [];
    for (const span of SPANS) {
      const r = await fetch(`${base}/api/dividends/${sym}/history?span=${span}`);
      const b = await r.json() as any; const p = b.data ?? b;
      const rows = p.rows as any[];
      const exs = rows.map((x) => x.exDate);
      const dups = [...new Set(exs.filter((d, i) => exs.indexOf(d) !== i))];
      const inverted = rows.filter((x) => x.payableDate !== null && x.payableDate < x.exDate);
      const marks: string[] = [];
      if (dups.length) marks.push(`DUP(${dups.map(iso).join(',')})`);
      for (const x of inverted) marks.push(`PAY<EX(${iso(x.exDate)} pay ${iso(x.payableDate)})`);
      if (marks.length) found.push(`span=${span}: ${marks.join(' ')}`);
    }
    console.log(`\n### ${sym}`);
    if (found.length === 0) console.log('   clean on all six spans');
    for (const f of found) console.log('   ', f);
  }

  console.log('\n### repeatability of O on the MAIN route (5x)');
  for (let i = 0; i < 5; i++) {
    const r = await fetch(`${base}/api/dividends/O`);
    const b = await r.json() as any; const p = b.data ?? b;
    const exs = p.events.map((x: any) => x.exDate);
    const dups = [...new Set(exs.filter((d: number, idx: number) => exs.indexOf(d) !== idx))];
    console.log(`   run ${i + 1}: rows=${p.events.length} dups=${dups.map(iso).join(',') || 'none'}`);
  }
} finally { await new Promise<void>((r) => server.close(() => r())); db.close(); rmSync(dir, { recursive: true, force: true }); }
