/**
 * QA rerun probe I — does the residual wrong-scale §C.1 figure reach the EXPORT?
 * Reproduces what `buildDividendTables` would emit for §C.1 from the live
 * payload (the export prints annualRate with the same currency label as §C.1).
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp, bootstrap } from '../../server/app';
import { openDb } from '../../server/db';

const dir = mkdtempSync(path.join(tmpdir(), 'qa-p4-i2-'));
const db = openDb(path.join(dir, 'db.sqlite'));
bootstrap(db);
const app = createApp(db);
const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const port = (server.address() as unknown as { port: number }).port;
const base = `http://127.0.0.1:${port}`;

try {
  for (const sym of ['ULVR.L', 'BP.L']) {
    const p = ((await (await fetch(`${base}/api/dividends/${sym}`)).json()) as any).data;
    const f = p.facts;
    const recent = ((await (await fetch(`${base}/api/dividends/${sym}/history?span=1y`)).json()) as any).data.payments
      .map((x: any) => x.amount)
      .slice(-4);
    const annualFromChart = recent.reduce((a: number, b: number) => a + b, 0);
    const cur = f.currency.value;
    console.log(`\n### ${sym}`);
    console.log(`  export §C.1 row "Annual rate" would be: ${f.annualRate.value} ${cur}`);
    console.log(`  export §C.1 row "Last Dividend" would be: ${f.lastDividendValue.value} ${cur}`);
    console.log(`  chart's own annual total (last 4 payments, ${cur}) = ${annualFromChart.toFixed(4)}`);
    console.log(`  ratio served/server  = ${(f.annualRate.value / annualFromChart).toFixed(4)}  <= 1 means same unit`);
    console.log(`  ratio x100           = ${((f.annualRate.value * 100) / annualFromChart).toFixed(4)}  <= 1 means the served figure is 100x too small`);
  }
} finally {
  await new Promise<void>((r) => server.close(() => r()));
  db.close();
  rmSync(dir, { recursive: true, force: true });
}
