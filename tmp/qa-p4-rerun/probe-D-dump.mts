/**
 * QA rerun probe D — dump the facts-level next-ex / next-pay pair and the
 * upcoming schedule row for each symbol, so the §A.8 monotonicity guard can be
 * seen to be either EXERCISED or VACUOUS on the live payload.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp, bootstrap } from '../../server/app';
import { openDb } from '../../server/db';

const dir = mkdtempSync(path.join(tmpdir(), 'qa-p4-d-'));
const db = openDb(path.join(dir, 'db.sqlite'));
bootstrap(db);
const app = createApp(db);
const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const port = (server.address() as unknown as { port: number }).port;
const base = `http://127.0.0.1:${port}`;
const iso = (t: number | null | undefined) => (t === null || t === undefined ? '—' : new Date(t * 1000).toISOString().slice(0, 10));

try {
  for (const sym of ['AAPL', 'KO', 'O', 'COST', 'AGNC', '0005.HK', 'ULVR.L', 'MSFT', 'TSLA']) {
    const p = ((await (await fetch(`${base}/api/dividends/${sym}`)).json()) as any).data;
    const f = p.facts;
    const up = p.events[p.events.length - 1];
    const isUpcoming = up && up.payableDate !== null;
    console.log(
      `${sym.padEnd(8)} nextEx=${iso(f.nextExDate.value).padEnd(11)} (src=${f.nextExDate.source}) ` +
        `nextPay=${iso(f.nextPayDate.value).padEnd(11)} (src=${f.nextPayDate.source}, note=${f.nextPayDate.note ?? '-'}) ` +
        `| newestRow ex=${iso(up?.exDate)} pay=${iso(up?.payableDate)} amt=${up?.amount}`,
    );
    void isUpcoming;
  }
} finally {
  await new Promise<void>((r) => server.close(() => r()));
  db.close();
  rmSync(dir, { recursive: true, force: true });
}
