/**
 * QA probe 13 — LIVE growth block + annual-series contiguity, to check whether
 * the `fullYears` hole (a truncated window leaves gap years) is reachable on the
 * shipped routes. Also prints the "$" amounts for the unit defect.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp, bootstrap } from '../../server/app';
import { openDb } from '../../server/db';
import { yearlyTotals, parseDividendEvents, annualSeries } from '../../shared/dividends';

const dir = mkdtempSync(path.join(tmpdir(), 'qa-p4-g-'));
const db = openDb(path.join(dir, 'db.sqlite')); bootstrap(db);
const app = createApp(db); const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const port = (server.address() as { port: number }).port;
try {
  for (const sym of ['KO', 'AAPL', 'O', 'MSFT', 'COST']) {
    const r = await fetch(`http://127.0.0.1:${port}/api/dividends/${sym}`);
    const b = await r.json() as any; const p = b.data ?? b;
    const pays = p.series.payments as Array<{ date: number; amount: number }>;
    const yearly = yearlyTotals(pays.map((x) => ({ date: x.date, amount: x.amount })));
    const years = [...yearly.keys()].sort((a, b) => a - b);
    const gaps: string[] = [];
    for (let i = 1; i < years.length; i++) if (years[i] !== years[i - 1] + 1) gaps.push(`${years[i - 1]}→${years[i]}`);
    console.log(`\n=== ${sym}: payments=${pays.length} years=${years.length} ${years[0]}..${years.at(-1)}`);
    console.log('   year gaps (missing calendar years):', gaps.join(', ') || 'none');
    const g = p.growth;
    console.log('   growth:', JSON.stringify({ streak: g.consecutiveAnnualIncreases.value, g1: g.growth1y.value, g3: g.growth3y.value, g5: g.growth5y.value, g10: g.growth10y.value }));
    for (const k of ['growth1y', 'growth3y', 'growth5y', 'growth10y']) console.log(`     ${k} source=${g[k].source} note=${g[k].note ?? '-'}`);
    const lastYears = years.slice(-6).map((y) => `${y}=${yearly.get(y)!.toFixed(3)}`);
    console.log('   last years:', lastYears.join(' '));
  }
} finally { await new Promise<void>((r) => server.close(() => r())); db.close(); rmSync(dir, { recursive: true, force: true }); }
