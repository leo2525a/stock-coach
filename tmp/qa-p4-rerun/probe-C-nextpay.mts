/**
 * QA rerun probe C — the §C.6 load-bearing assertion at the FACTS level, as an
 * exit-code probe: the next-payable date rendered by §C.6 (and carried by the
 * export) must never be on or before the next ex-date on the same screen.
 * AAPL is the live case (ex 2026-11-12, pay 2026-08-13).
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp, bootstrap } from '../../server/app';
import { openDb } from '../../server/db';

const dir = mkdtempSync(path.join(tmpdir(), 'qa-p4-c-'));
const db = openDb(path.join(dir, 'db.sqlite'));
bootstrap(db);
const app = createApp(db);
const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const port = (server.address() as unknown as { port: number }).port;
const base = `http://127.0.0.1:${port}`;
const day = (t: number) => Math.floor(t / 86400);
const fails: string[] = [];
let sawWithheld = false;

try {
  for (const sym of ['AAPL', 'KO', 'O', 'COST', 'AGNC', '0005.HK', 'ULVR.L', 'MSFT']) {
    const p = ((await (await fetch(`${base}/api/dividends/${sym}`)).json()) as any).data;
    const ex = p.facts.nextExDate.value;
    const pay = p.facts.nextPayDate.value;
    if (ex !== null && pay !== null && day(pay) <= day(ex)) {
      fails.push(`${sym}: facts nextPay ${pay} <= nextEx ${ex}`);
    }
    if (pay === null && p.facts.nextPayDate.note === 'note.dividendPayableBeforeEx') sawWithheld = true;

    // The upcoming schedule row must agree: its payable (when present) is after ex.
    const up = p.events.find((r: any) => r.exDate === ex) ?? p.events[p.events.length - 1];
    if (up && up.payableDate !== null && up.payableDate <= up.exDate) {
      fails.push(`${sym}: schedule upcoming PAY<=EX (ex=${up.exDate} pay=${up.payableDate})`);
    }
  }
} finally {
  await new Promise<void>((r) => server.close(() => r()));
  db.close();
  rmSync(dir, { recursive: true, force: true });
}

if (fails.length) {
  console.log(`PROBE-C: FAIL (${fails.length})`);
  for (const f of fails) console.log(`   • ${f}`);
  process.exit(1);
}
console.log(`PROBE-C: PASS — no facts-level PAY<=EX; withheld path exercised=${sawWithheld}`);
