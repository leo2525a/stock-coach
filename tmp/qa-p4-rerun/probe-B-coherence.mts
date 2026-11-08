/**
 * QA rerun probe B — the §A.8 load-bearing assertion (schedule coherence), as a
 * single-objective, exit-code probe:
 *   (1) no two rows share an Ex-Date calendar day (the de-dup path is live)
 *   (2) no row's Payable Date precedes its own Ex-Date
 *   (3) the UPCOMING row's amount is in its own series unit (within 5x of the
 *       recent chart per-payment median) — the exact defect-3 condition.
 * Runs BOTH routes, all six spans. Prints a machine-readable PASS/FAIL line.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp, bootstrap } from '../../server/app';
import { openDb } from '../../server/db';

const dir = mkdtempSync(path.join(tmpdir(), 'qa-p4-b-'));
const db = openDb(path.join(dir, 'db.sqlite'));
bootstrap(db);
const app = createApp(db);
const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const port = (server.address() as unknown as { port: number }).port;
const base = `http://127.0.0.1:${port}`;

const day = (t: number) => Math.floor(t / 86400);
const med = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.floor(s.length / 2)] : null;
};
const fails: string[] = [];

try {
  for (const sym of ['O', 'COST', 'AGNC', '0005.HK', 'AAPL', 'KO', 'MSFT', 'ULVR.L']) {
    const main = ((await (await fetch(`${base}/api/dividends/${sym}`)).json()) as any).data;
    const spanRows: Array<[string, any[]]> = [['MAIN', main.events]];
    for (const span of ['1y', '3y', '5y', '10y', '20y', 'ALL']) {
      const h = ((await (await fetch(`${base}/api/dividends/${sym}/history?span=${span}`)).json()) as any).data;
      spanRows.push([span, h.rows]);
    }
    for (const [label, rows] of spanRows) {
      // (1) duplicate Ex-Date day
      const days = rows.map((r) => day(r.exDate));
      const dup = days.length !== new Set(days).size;
      if (dup) fails.push(`${sym} ${label}: duplicate Ex-Date day`);
      // (2) payable before its own ex
      for (const r of rows) {
        if (r.payableDate !== null && r.payableDate < r.exDate) {
          fails.push(`${sym} ${label}: PAY<EX (ex=${r.exDate} pay=${r.payableDate})`);
        }
      }
      // (3) the UPCOMING row's amount is in the series unit. Only the upcoming
      // row is under review here: historical rows legitimately change scale
      // across splits/decades, which is not a defect.
      const upcoming = rows.find((r) => r.payableDate !== null);
      const recent = rows
        .filter((r) => r !== upcoming)
        .map((r) => r.amount)
        .filter((n) => Number.isFinite(n) && n > 0)
        .slice(-8);
      if (upcoming && recent.length >= 3) {
        const m = med(recent)!;
        if (upcoming.amount < m / 5 || upcoming.amount > m * 5) {
          fails.push(`${sym} ${label}: upcoming amount ${upcoming.amount} off-scale vs recent median ${m}`);
        }
      }
    }
  }
} finally {
  await new Promise<void>((r) => server.close(() => r()));
  db.close();
  rmSync(dir, { recursive: true, force: true });
}

if (fails.length) {
  console.log(`PROBE-B: FAIL (${fails.length})`);
  for (const f of fails) console.log(`   • ${f}`);
  process.exit(1);
}
console.log('PROBE-B: PASS — no duplicate Ex-Date day, no PAY<EX, one unit, both routes, six spans');
