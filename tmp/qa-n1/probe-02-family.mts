/**
 * QA N1 probe — audit the whole `DividendFacts` family for the GBP-vs-GBp hazard.
 *
 * Boots the server (ephemeral port), then for each symbol dumps every fact that
 * originates from `summaryDetail` / `defaultKeyStatistics` next to the chart's
 * own scale (meta.currency, per-payment amounts, trailing-12m sum) and prints a
 * verdict per field: reconciled / same-unit / withheld / OFF-SCALE.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import path from 'node:path';

const ROOT = process.cwd();
const freePort = () =>
  new Promise((res) => {
    const s = createServer();
    s.once('error', () => res(0));
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => res(p));
    });
  });
const PORT = await freePort();
const work = mkdtempSync(path.join(tmpdir(), 'qa-n1-fam-'));
const server = spawn('npx', ['tsx', 'server/index.ts'], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(PORT), DB_PATH: path.join(work, 'db.sqlite') },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const base = `http://127.0.0.1:${PORT}`;
let up = false;
for (let i = 0; i < 240 && !up; i++) {
  try {
    const r = await fetch(`${base}/api/dividends/KO`);
    up = !!r.status;
  } catch {}
  if (!up) await new Promise((r) => setTimeout(r, 500));
}
if (!up) {
  console.log('server never came up');
  server.kill();
  process.exit(1);
}

const payoutOf = (f) => f.payoutRatioLtm;
try {
  for (const sym of ['ULVR.L', 'BP.L', 'VOD.L', 'HSBA.L', 'KO', 'O']) {
    const p = (await (await fetch(`${base}/api/dividends/${encodeURIComponent(sym)}`)).json()).data;
    const f = p.facts;
    const ev = p.events ?? [];
    const last = ev.length ? Math.max(...ev.map((e) => e.exDate)) : 0;
    const ttm = ev.filter((e) => e.exDate > last - 365 * 86400).reduce((a, e) => a + e.amount, 0);
    const amts = ev.slice(-6).map((e) => e.amount);
    const mid = amts.slice().sort((a, b) => a - b)[Math.floor(amts.length / 2)] || 0;
    const S = (s) => (s?.value == null ? `— (${s?.source}${s?.note ? ', ' + s.note : ''})` : `${s.value} ${f.currency?.value}`);
    console.log(`\n=== ${sym}  label ccy=${f.currency?.value}  chart meta ccy=${p.events?.[0]?.currency ?? 'n/a'} ===`);
    console.log(`  chart per-payment median(6)=${mid.toFixed(4)}  trailing-12m sum=${ttm.toFixed(3)}  last4=${amts.slice(-4).join(',')}`);
    console.log(`  indicatedYield     = ${S(f.indicatedYield)}`);
    console.log(`  trailingYield      = ${S(f.trailingYield)}`);
    console.log(`  forwardYield       = ${S(f.forwardYield)}`);
    console.log(`  annualRate         = ${S(f.annualRate)}   <-- per-year amount`);
    console.log(`  lastDividendValue  = ${S(f.lastDividendValue)}   <-- per-payment amount`);
    console.log(`  payoutRatioLtm     = ${S(payoutOf(f))}`);
    console.log(`  fiveYearAvgYield   = ${S(f.fiveYearAvgYield)}`);
    // verdicts for the *amount* fields (per-payment / per-year), the only ones with a GBP/GBp hazard
    const n = (s) => s?.value ?? null;
    for (const [name, v, ref] of [
      ['annualRate', n(f.annualRate), ttm],
      ['lastDividendValue', n(f.lastDividendValue), mid],
    ]) {
      if (v == null) console.log(`  → ${name}: withheld/absent (honest)`);
      else if (ref > 0 && (v / ref < 0.02 || v / ref > 50)) console.log(`  → ${name}: **OFF-SCALE** (${(v / ref).toFixed(4)}x its series ref ${ref.toFixed(3)})`);
      else console.log(`  → ${name}: consistent with series (${(v / ref).toFixed(3)}x ref)`);
    }
  }
} finally {
  server.kill();
  rmSync(work, { recursive: true, force: true });
}
