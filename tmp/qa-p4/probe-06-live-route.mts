/**
 * QA probe 06 — LIVE: boot the real Express app on an ephemeral port and ask
 * the real provider for O (Realty Income, a monthly payer whose ex-date equals
 * its last paid date). Prints the schedule tail and every row that carries a
 * Payable Date, flagging payable-before-ex and duplicate ex-dates.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp, bootstrap } from '../../server/app';
import { openDb } from '../../server/db';

const dir = mkdtempSync(path.join(tmpdir(), 'qa-p4-live-'));
const db = openDb(path.join(dir, 'db.sqlite'));
bootstrap(db);
const app = createApp(db);
const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const port = (server.address() as { port: number }).port;
const base = `http://127.0.0.1:${port}`;
const iso = (t: number | null) => (t === null ? '—' : new Date(t * 1000).toISOString().slice(0, 10));

try {
  for (const sym of ['O', 'AAPL', 'KO', 'MSFT', 'COST', 'AGNC']) {
    const res = await fetch(`${base}/api/dividends/${sym}`);
    if (!res.ok) { console.log(`${sym}: HTTP ${res.status}`); continue; }
    const body = await res.json() as any; const p = body.data ?? body;
    const rows = p.events as any[];
    const exs = rows.map((r) => r.exDate);
    const dups = [...new Set(exs.filter((d, i) => exs.indexOf(d) !== i))];
    const paid = rows.filter((r) => r.payableDate !== null);
    console.log(`\n=== ${sym} (rows=${rows.length}) source=${p.source} ===`);
    console.log('  facts.nextExDate=', iso(p.facts.nextExDate.value), ' nextPayDate=', iso(p.facts.nextPayDate.value), ' freq=', JSON.stringify(p.facts.frequency.value));
    console.log('  duplicate ex-dates:', dups.map(iso).join(',') || 'none');
    console.log('  rows carrying a Payable Date:');
    for (const r of paid) {
      const days = Math.round((r.exDate - r.payableDate) / 86400);
      const flag = days > 0 ? `  <<< PAYABLE IS ${days}d BEFORE EX-DATE` : '';
      console.log(`    ex=${iso(r.exDate)} pay=${iso(r.payableDate)} amt=${r.amount}${flag}`);
    }
    console.log('  tail:', rows.slice(-3).map((r) => `${iso(r.exDate)}=${r.amount}/pay=${iso(r.payableDate)}`).join(' '));
  }
} finally {
  await new Promise<void>((r) => server.close(() => r()));
  db.close();
  rmSync(dir, { recursive: true, force: true });
}
