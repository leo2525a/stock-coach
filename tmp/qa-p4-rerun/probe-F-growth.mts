/**
 * QA rerun probe F — exit-code assertion for §A.8 "no positional year runs":
 *   - consecutiveAnnualIncreases must equal the honest contiguous-year streak
 *     for every live symbol (AAPL is the load-bearing case: 13, not 14), and
 *   - growthOver must return null (not a positional guess) when the base
 *     calendar year is absent from the series — the latent hole-in-window twin.
 * Fails when a positional walk is in place.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp, bootstrap } from '../../server/app';
import { openDb } from '../../server/db';
import { annualSeries, consecutiveIncreases, growthOver } from '../../shared/dividends';

const dir = mkdtempSync(path.join(tmpdir(), 'qa-p4-f-'));
const db = openDb(path.join(dir, 'db.sqlite'));
bootstrap(db);
const app = createApp(db);
const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const port = (server.address() as unknown as { port: number }).port;
const base = `http://127.0.0.1:${port}`;
const fails: string[] = [];

try {
  // --- part 1: the shipped symbols ---
  for (const sym of ['AAPL', 'KO', 'MSFT', 'COST', 'O']) {
    const p = ((await (await fetch(`${base}/api/dividends/${sym}`)).json()) as any).data;
    const evs = p.series.payments.map((x: any) => ({ date: x.date, amount: x.amount }));
    const s = annualSeries(evs, 2026);
    const code = consecutiveIncreases(s);
    let honest = 0;
    for (let i = s.fullYears.length - 1; i > 0; i -= 1) {
      if (s.fullYears[i] === s.fullYears[i - 1] + 1 && s.totals.get(s.fullYears[i])! > s.totals.get(s.fullYears[i - 1])!) honest += 1;
      else break;
    }
    if (code !== honest) fails.push(`${sym}: consecutiveAnnualIncreases=${code} but the contiguous-year streak is ${honest}`);
    // The served payload must match the code too.
    const served = p.growth.consecutiveAnnualIncreases.value;
    if (served !== honest) fails.push(`${sym}: served streak=${served} but the contiguous-year streak is ${honest}`);
  }

  // --- part 2: the latent hole-in-window twin (deterministic, no network) ---
  const mk = (years: number[], value: number) => ({
    fullYears: years,
    excludedYears: [] as number[],
    totals: new Map(years.map((y) => [y, value])),
  });
  // 2016..2025, so a "10Y" horizon needs the base year 2015, which is absent →
  // must be null, never a positional stand-in. A "9Y" needs 2016 (present).
  const holed = mk([2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025], 2);
  if (growthOver(holed, 10) !== null) fails.push(`growthOver(holed,10) = ${growthOver(holed, 10)} but the base year 2015 is absent`);
  if (growthOver(holed, 9) === null) fails.push('growthOver(holed,9) unexpectedly null (2016 is the correct base)');
  // And a hole inside the window must still label the true calendar span: a true
  // contiguous 5Y needs base 2020, which is absent from this series → null.
  const holeMid = mk([2016, 2017, 2019, 2021, 2022, 2023, 2024, 2025], 2);
  if (growthOver(holeMid, 5) !== null) fails.push('growthOver(holeMid,5) should be null: base year 2020 is absent');
} finally {
  await new Promise<void>((r) => server.close(() => r()));
  db.close();
  rmSync(dir, { recursive: true, force: true });
}

if (fails.length) {
  console.log(`PROBE-F: FAIL (${fails.length})`);
  for (const f of fails) console.log(`   • ${f}`);
  process.exit(1);
}
console.log('PROBE-F: PASS — streak is the contiguous-year streak; growth horizon is calendar-based');
