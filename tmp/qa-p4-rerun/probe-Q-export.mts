/**
 * QA rerun probe Q — the EXPORT payload (§C.6) must obey the same §A.8 rules as
 * the screen: no two §C.5 rows share an Ex-Date day, no exported payable
 * precedes its ex-date, and the §C.6 facts rows show a validated next-payable.
 * Builds the tables with the product's own `buildDividendTables`.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp, bootstrap } from '../../server/app';
import { openDb } from '../../server/db';
import { buildDividendTables } from '../../src/dividend/exportModel';
import { en } from '../../shared/i18n';

const dir = mkdtempSync(path.join(tmpdir(), 'qa-p4-q-'));
const db = openDb(path.join(dir, 'db.sqlite'));
bootstrap(db);
const app = createApp(db);
const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const port = (server.address() as unknown as { port: number }).port;
const base = `http://127.0.0.1:${port}`;
const t = (k: string) => (en as any)[k] ?? k;
const day = (s: string) => s; // already YYYY-MM-DD from plainFormat
const fails: string[] = [];
const DASH = '\u2014';

try {
  for (const sym of ['O', 'COST', 'AGNC', '0005.HK', 'AAPL', 'KO', 'MSFT', 'ULVR.L']) {
    const payload = ((await (await fetch(`${base}/api/dividends/${sym}`)).json()) as any).data;
    const history = ((await (await fetch(`${base}/api/dividends/${sym}/history?span=ALL`)).json()) as any).data;
    const tables = buildDividendTables(t as any, payload, history);
    const c5 = tables.find((x) => x.title === t('div.s5.title'))!;
    const exCol = c5.columns.indexOf(t('div.col.exDate'));
    const payCol = c5.columns.indexOf(t('div.col.payable'));
    const exDays = c5.rows.map((r) => (r[exCol] || '').replace(/\s.*$/, ''));
    const dup = exDays.filter((d, i) => exDays.indexOf(d) !== i);
    if (dup.length) fails.push(`${sym}: export §C.5 has duplicate Ex-Date day(s) ${[...new Set(dup)].join(',')}`);
    for (const r of c5.rows) {
      const p = r[payCol];
      if (p && p !== DASH && p < r[exCol].replace(/\s.*$/, '')) {
        fails.push(`${sym}: export §C.5 payable ${p} precedes ex ${r[exCol]}`);
      }
    }
    // §C.6 facts rows: the exported next-payable must not precede the exported next-ex
    const c1 = tables[0];
    const rowVal = (label: string) => c1.rows.find((r) => r[0] === label)?.[1] ?? null;
    const ex = rowVal(t('div.f.nextEx'));
    const pay = rowVal(t('div.f.nextPay'));
    if (ex && pay && ex !== DASH && pay !== DASH && pay < ex) {
      fails.push(`${sym}: export §C.6 nextPayable ${pay} precedes nextEx ${ex}`);
    }
    console.log(
      `${sym.padEnd(8)} §C.5 rows=${c5.rows.length} exDup=${dup.length} | §C.6 nextEx=${ex} nextPay=${pay} | §C.1 annualRate=${rowVal(t('div.f.annualRate'))} lastDiv=${rowVal(t('div.f.lastDividend'))}`,
    );
    void day;
  }
} finally {
  await new Promise<void>((r) => server.close(() => r()));
  db.close();
  rmSync(dir, { recursive: true, force: true });
}

if (fails.length) {
  console.log(`PROBE-Q: FAIL (${fails.length})`);
  for (const f of fails) console.log(`   • ${f}`);
  process.exit(1);
}
console.log('PROBE-Q: PASS — export §C.5/§C.6 obey §A.8 (no dup Ex-Date day, no PAY<EX)');
