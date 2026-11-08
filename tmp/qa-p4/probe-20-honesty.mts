/**
 * QA probe 20 — remaining honesty items:
 *  (a) pre-2015 reconstructed yield points are labelled,
 *  (b) span=ALL yield first point,
 *  (c) the "reconstructed" flag,
 *  (d) the schedule feeds §C.5 from the HISTORY payload (confirm data source).
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp, bootstrap } from '../../server/app';
import { openDb } from '../../server/db';
const dir = mkdtempSync(path.join(tmpdir(), 'qa-p4-hon-'));
const db = openDb(path.join(dir, 'db.sqlite')); bootstrap(db);
const app = createApp(db); const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const port = (server.address() as any).port;
const iso = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);
try {
  for (const sym of ['KO', 'COST']) {
    for (const span of ['20y', 'ALL']) {
      const r = await fetch(`http://127.0.0.1:${port}/api/dividends/${sym}/history?span=${span}`);
      const b = await r.json() as any; const p = b.data ?? b;
      const reals = p.yields.filter((y: any) => y.source !== 'reconstructed');
      const recs = p.yields.filter((y: any) => y.source === 'reconstructed');
      console.log(`${sym} span=${span}: yields=${p.yields.length} real=${reals.length} reconstructed=${recs.length} flagReconstructed=${p.reconstructed}`);
      if (reals.length) console.log(`   first real: ${iso(reals[0].date)} = ${reals[0].value} (source ${reals[0].source})`);
      if (recs.length) console.log(`   first recon: ${iso(recs[0].date)} = ${recs[0].value} (source ${recs[0].source})  last recon: ${iso(recs.at(-1).date)}`);
    }
  }
  // span clamp honesty
  const sp = await (await fetch(`http://127.0.0.1:${port}/api/dividends/KO`)).json() as any;
  console.log('\nspansAvailable:', JSON.stringify((sp.data ?? sp).series.spansAvailable));
  // range=max refusal already covered; confirm chunked ALL is not a single huge call
} finally { await new Promise<void>((r) => server.close(() => r())); db.close(); rmSync(dir, { recursive: true, force: true }); }
