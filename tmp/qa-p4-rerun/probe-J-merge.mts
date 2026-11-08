/**
 * QA rerun probe J —
 *  (1) prove the `buildSchedule` day-merge branch is LIVE (not dead code): for a
 *      symbol whose upcoming ex-date shares the chart's last event day, exactly
 *      one row carries the payable date and its exDate is the CHART timestamp.
 *  (2) show whether `trailingAnnualDividendYield` is internally consistent with
 *      the indicated yield / the label unit for LSE symbols.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp, bootstrap } from '../../server/app';
import { openDb } from '../../server/db';

const dir = mkdtempSync(path.join(tmpdir(), 'qa-p4-j-'));
const db = openDb(path.join(dir, 'db.sqlite'));
bootstrap(db);
const app = createApp(db);
const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const port = (server.address() as unknown as { port: number }).port;
const base = `http://127.0.0.1:${port}`;
const iso = (t: number) => new Date(t * 1000).toISOString();

try {
  console.log('=== (1) is the day-merge branch live? ===');
  for (const sym of ['O', 'COST', 'AGNC']) {
    const p = ((await (await fetch(`${base}/api/dividends/${sym}`)).json()) as any).data;
    const rows = p.events;
    const last = rows[rows.length - 1];
    const withPay = rows.filter((r: any) => r.payableDate !== null);
    const ex = p.facts.nextExDate.value;
    const sameDay = rows.filter((r: any) => ex !== null && Math.floor(r.exDate / 86400) === Math.floor(ex / 86400));
    console.log(
      `${sym}: lastChartEvent=${iso(last.exDate)} factsNextEx=${ex ? iso(ex) : '—'} ` +
        `| rows with a payable=${withPay.length} | rows on the next-ex day=${sameDay.length}`,
    );
    if (withPay.length === 1 && sameDay.length === 1 && sameDay[0].exDate === last.exDate) {
      console.log(`   -> MERGE branch executed: the payable was stamped onto the existing chart row ${iso(last.exDate)}`);
    }
  }

  console.log('\n=== (2) trailing vs indicated yield, and unit consistency ===');
  for (const sym of ['ULVR.L', 'BP.L', 'KO', 'O']) {
    const p = ((await (await fetch(`${base}/api/dividends/${sym}`)).json()) as any).data;
    const f = p.facts;
    console.log(
      `${sym.padEnd(8)} ccy=${f.currency.value} indicated=${f.indicatedYield.value} trailing=${f.trailingYield.value} ` +
        `ratio(ind/trail)=${(f.indicatedYield.value / f.trailingYield.value).toFixed(2)} annualRate=${f.annualRate.value}`,
    );
  }
} finally {
  await new Promise<void>((r) => server.close(() => r()));
  db.close();
  rmSync(dir, { recursive: true, force: true });
}
