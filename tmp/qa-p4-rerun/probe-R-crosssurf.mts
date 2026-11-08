/**
 * QA rerun probe R — cross-surface unit coherence of the §C.1 yields against the
 * §C.2 chart series the SAME screen draws. For an LSE (GBp) name the API returns
 * `summaryDetail.trailingAnnualDividendYield` divided by ~87 versus the chart's
 * own trailing-yield series, while §C.1 prints it as-is.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp, bootstrap } from '../../server/app';
import { openDb } from '../../server/db';

const dir = mkdtempSync(path.join(tmpdir(), 'qa-p4-r-'));
const db = openDb(path.join(dir, 'db.sqlite'));
bootstrap(db);
const app = createApp(db);
const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const port = (server.address() as unknown as { port: number }).port;
const base = `http://127.0.0.1:${port}`;
try {
  for (const sym of ['ULVR.L', 'BP.L', 'KO', 'O', 'AAPL']) {
    const p = ((await (await fetch(`${base}/api/dividends/${sym}`)).json()) as any).data;
    const f = p.facts;
    const lastYield = (p.series?.yields ?? []).slice(-1)[0];
    const ccy = f.currency?.value;
    const ind = f.indicatedYield?.value;
    const trail = f.trailingYield?.value;
    const ratio = trail && lastYield?.value ? trail / lastYield.value : null;
    console.log(
      `${sym.padEnd(8)} ccy=${String(ccy).padEnd(5)} indicated=${ind == null ? '—' : (ind * 100).toFixed(3) + '%'} trailing=${trail == null ? '—' : (trail * 100).toFixed(4) + '%'} chartSeriesLast=${lastYield?.value == null ? '—' : (lastYield.value * 100).toFixed(4) + '%'} trail/chart=${ratio == null ? '—' : ratio.toFixed(3)}`,
    );
  }
} finally {
  await new Promise<void>((r) => server.close(() => r()));
  db.close();
  rmSync(dir, { recursive: true, force: true });
}
