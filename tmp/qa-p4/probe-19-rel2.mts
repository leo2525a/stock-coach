/**
 * QA probe 19 — corrected duplicate detector: bucket by UTC CALENDAR DAY, on
 * BOTH routes, every span. (probe-15 required identical epoch seconds and so
 * under-reported; the two rows differ by hours, not by day.)
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp, bootstrap } from '../../server/app';
import { openDb } from '../../server/db';

const dir = mkdtempSync(path.join(tmpdir(), 'qa-p4-rel2-'));
const db = openDb(path.join(dir, 'db.sqlite')); bootstrap(db);
const app = createApp(db); const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const port = (server.address() as any).port;
const base = `http://127.0.0.1:${port}`;
const day = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);
const dupDays = (rows: any[]) => {
  const m = new Map<string, any[]>();
  for (const r of rows) m.set(day(r.exDate), [...(m.get(day(r.exDate)) ?? []), r]);
  return [...m.entries()].filter(([, v]) => v.length > 1);
};
try {
  for (const sym of ['O', 'COST', 'AGNC', '0005.HK', 'AAPL', 'KO', 'MSFT', 'ULVR.L']) {
    const main = await (await fetch(`${base}/api/dividends/${sym}`)).json() as any;
    const p = main.data ?? main;
    const mainDups = dupDays(p.events);
    console.log(`\n### ${sym}`);
    console.log(`   MAIN  route: rows=${p.events.length} same-day duplicates=${mainDups.length ? mainDups.map(([d, v]) => `${d}x${v.length}`).join(',') : 'none'}`);
    for (const [d, v] of mainDups) {
      for (const r of v) console.log(`      ${d}: exSeconds=${r.exDate} amt=${r.amount} ${r.currency} pay=${r.payableDate === null ? '—' : day(r.payableDate)}`);
    }
    const hist: string[] = [];
    for (const span of ['1y', '3y', '5y', '10y', '20y', 'ALL']) {
      const h = await (await fetch(`${base}/api/dividends/${sym}/history?span=${span}`)).json() as any;
      const hp = h.data ?? h;
      const d2 = dupDays(hp.rows);
      const inv = hp.rows.filter((r: any) => r.payableDate !== null && r.payableDate < r.exDate);
      const marks: string[] = [];
      if (d2.length) marks.push(`dup(${d2.map(([dd, v]) => `${dd}x${v.length}`).join(',')})`);
      for (const r of inv) marks.push(`PAY<EX(${day(r.exDate)}/${day(r.payableDate)})`);
      if (marks.length) hist.push(`${span}:${marks.join(' ')}`);
    }
    console.log(`   HIST  route: ${hist.length ? hist.join(' | ') : 'clean on all six spans'}`);
  }
} finally { await new Promise<void>((r) => server.close(() => r())); db.close(); rmSync(dir, { recursive: true, force: true }); }
