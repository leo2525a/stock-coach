/**
 * QA N1 probe — focused: did the N1 fix *regress* 0005.HK? Pre-fix the screen
 * showed "Annual rate = 3.14 HKD"; the evidence report now shows "—". Decide
 * whether withholding is honest (scale genuinely unresolvable) or a regression
 * (a resolvable, correct figure was dropped).
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
const work = mkdtempSync(path.join(tmpdir(), 'qa-n1-0005-'));
const server = spawn('npx', ['tsx', 'server/index.ts'], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(PORT), DB_PATH: path.join(work, 'db.sqlite') },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const base = `http://127.0.0.1:${PORT}`;
let up = false;
for (let i = 0; i < 240 && !up; i++) {
  try {
    up = !!(await fetch(`${base}/api/dividends/0005.HK`)).status;
  } catch {}
  if (!up) await new Promise((r) => setTimeout(r, 500));
}
if (!up) {
  console.log('server never came up');
  server.kill();
  process.exit(1);
}
try {
  const p = (await (await fetch(`${base}/api/dividends/0005.HK`)).json()).data;
  const f = p.facts;
  const ev = p.events ?? [];
  const last = Math.max(...ev.map((e) => e.exDate));
  const ttm = ev.filter((e) => e.exDate > last - 365 * 86400).reduce((a, e) => a + e.amount, 0);
  const amts = ev.slice(-8).map((e) => e.amount);
  console.log('currency          =', f.currency?.value);
  console.log('events last 8     =', amts.join(', '));
  console.log('trailing-12m sum  =', ttm);
  console.log('annualRate        =', JSON.stringify(f.annualRate));
  console.log('lastDividendValue =', JSON.stringify(f.lastDividendValue));
  console.log('indicatedYield    =', JSON.stringify(f.indicatedYield));
  console.log('forwardYield      =', JSON.stringify(f.forwardYield));
  console.log('frequency         =', JSON.stringify(f.frequency), '\n');
  // What would reconcileScale do on plausible annual refs?
  const { reconcileScale, trailingAnnualTotal } = await import(
    path.join(ROOT, 'shared/dividends.ts')
  );
  console.log('reconcileScale(3.14, [ttm])        =', reconcileScale(3.14, [ttm]));
  console.log('trailingAnnualTotal(events)        =', trailingAnnualTotal(ev.map((e) => ({ date: e.exDate, amount: e.amount }))));
  console.log('\ninterpretation: if annualRate is withheld while the raw field was already the');
  console.log('correct HKD annual figure, the N1 fix is OVER-withholding for HK fractional fields.');
} finally {
  server.kill();
  rmSync(work, { recursive: true, force: true });
}
