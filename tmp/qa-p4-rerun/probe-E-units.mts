/**
 * QA rerun probe E — exit-code assertion for the §A.8 unit rule (§C.1 + §C.5):
 *   - the upcoming §C.5 row's amount is in its own series unit (within 5x of the
 *     recent per-payment median), and
 *   - the §C.1 "Last Dividend" figure is either the dash or in the series unit.
 * FAILs when a 100x (pence/pound) or 7.8x (fractional-HKD) figure survives.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp, bootstrap } from '../../server/app';
import { openDb } from '../../server/db';

const dir = mkdtempSync(path.join(tmpdir(), 'qa-p4-e-'));
const db = openDb(path.join(dir, 'db.sqlite'));
bootstrap(db);
const app = createApp(db);
const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const port = (server.address() as unknown as { port: number }).port;
const base = `http://127.0.0.1:${port}`;
const med = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.floor(s.length / 2)] : null;
};
const fails: string[] = [];

try {
  for (const sym of ['ULVR.L', 'BP.L', 'HSBA.L', 'VOD.L', '0005.HK', 'KO', 'O', 'AAPL', 'MSFT', 'COST', 'AGNC']) {
    const p = ((await (await fetch(`${base}/api/dividends/${sym}`)).json()) as any).data;
    const h = ((await (await fetch(`${base}/api/dividends/${sym}/history?span=1y`)).json()) as any).data;
    const recent = (h.payments ?? []).map((x: any) => x.amount).filter((n: number) => n > 0).slice(-8);
    const m = med(recent);
    if (m === null || m <= 0) continue;

    // §C.5 upcoming row amount
    const up = p.events.find((r: any) => r.payableDate !== null);
    if (up) {
      const r = up.amount / m;
      if (r < 0.2 || r > 5) fails.push(`${sym}: §C.5 upcoming amount ${up.amount} is ${r.toFixed(3)}x the series median ${m}`);
    }

    // §C.1 last dividend (may legitimately be null → dash)
    const lv = p.facts.lastDividendValue.value;
    if (lv !== null && lv !== undefined) {
      const r = lv / m;
      if (r < 0.2 || r > 5) fails.push(`${sym}: §C.1 lastDividendValue ${lv} is ${r.toFixed(3)}x the series median ${m}`);
    }

    // §C.1 annual rate: printed with the same currency label, so it must be in
    // that unit. Compare it to the chart's own trailing annual total.
    const ar = p.facts.annualRate.value;
    if (ar !== null && ar !== undefined) {
      const trailing = recent.reduce((a: number, b: number) => a + b, 0);
      if (trailing > 0) {
        const r = ar / trailing;
        if (r < 0.2 || r > 5) {
          fails.push(`${sym}: §C.1 annualRate ${ar} is ${r.toFixed(4)}x the chart trailing annual total ${trailing.toFixed(4)}`);
        }
      }
    }

    // No duplicate-Ex-Date row with a conflicting amount (defect 1+3 combined)
    const byDay = new Map<number, number[]>();
    for (const row of p.events) {
      const d = Math.floor(row.exDate / 86400);
      byDay.set(d, [...(byDay.get(d) ?? []), row.amount]);
    }
    for (const [d, amts] of byDay) {
      if (amts.length > 1) fails.push(`${sym}: ${amts.length} rows on day ${d} (${amts.join(' vs ')})`);
    }
  }
} finally {
  await new Promise<void>((r) => server.close(() => r()));
  db.close();
  rmSync(dir, { recursive: true, force: true });
}

if (fails.length) {
  console.log(`PROBE-E: FAIL (${fails.length})`);
  for (const f of fails) console.log(`   • ${f}`);
  process.exit(1);
}
console.log('PROBE-E: PASS — §C.5 upcoming amount and §C.1 last-dividend are in their series unit');
