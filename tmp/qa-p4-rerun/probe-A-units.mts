/**
 * QA rerun probe A — does ANY §C.1 / §C.5 / export figure still ship in a
 * different unit from the currency label it is printed with?
 *
 * Targets the class the brief asks about: "any place a wrong-scale/wrong-unit
 * figure can still reach a column". `reconcileLastDividend` covers
 * lastDividendValue; this probe checks annualRate and every other Amount-typed
 * fact against the chart series' own scale + the currency label.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp, bootstrap } from '../../server/app';
import { openDb } from '../../server/db';

const dir = mkdtempSync(path.join(tmpdir(), 'qa-p4-units-'));
const db = openDb(path.join(dir, 'db.sqlite'));
bootstrap(db);
const app = createApp(db);
const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const port = (server.address() as unknown as { port: number }).port;
const base = `http://127.0.0.1:${port}`;

const median = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.floor(s.length / 2)] : null;
};

try {
  for (const sym of ['ULVR.L', '0005.HK', 'KO', 'O', 'AAPL', 'MSFT', 'COST', 'AGNC']) {
    const b = (await (await fetch(`${base}/api/dividends/${sym}`)).json()) as any;
    const p = b.data ?? b;
    const h = (await (await fetch(`${base}/api/dividends/${sym}/history?span=1y`)).json()) as any;
    const hp = h.data ?? h;
    const recent = (hp.payments ?? []).slice(-8).map((x: any) => x.amount);
    const mid = median(recent);
    const last = p.events?.[p.events.length - 1];
    console.log(`\n### ${sym}`);
    console.log(`  label currency (facts.currency) = ${JSON.stringify(p.facts.currency.value)}`);
    console.log(`  chart currency (history)       = ${JSON.stringify(hp.currency)}`);
    console.log(`  recent per-payment amounts     = [${recent.join(', ')}]  median=${mid}`);
    console.log(`  §C.1 indicated  = ${p.facts.indicatedYield.value}`);
    console.log(`  §C.1 trailing   = ${p.facts.trailingYield.value}`);
    console.log(`  §C.1 annualRate = ${p.facts.annualRate.value}   <-- printed with the label currency`);
    console.log(`  §C.1 lastDiv    = ${p.facts.lastDividendValue.value} (note=${p.facts.lastDividendValue.note ?? '-'})`);
    const ar = p.facts.annualRate.value;
    if (ar !== null && ar !== undefined && mid !== null) {
      console.log(`  annualRate / recent-median = ${(ar / mid).toFixed(4)}  (per-payment scale)`);
      console.log(`  annualRate / (4*median)    = ${(ar / (4 * mid)).toFixed(4)}  (quarterly annualiser)`);
    }
    const lv = p.facts.lastDividendValue.value;
    if (lv !== null && mid !== null) console.log(`  lastDiv / recent-median    = ${(lv / mid).toFixed(4)}`);
  }
} finally {
  await new Promise<void>((r) => server.close(() => r()));
  db.close();
  rmSync(dir, { recursive: true, force: true });
}
