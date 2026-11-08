/**
 * Live before/after probe for F-1 (cache-order-dependent trailing 1y return)
 * and F-2 (the 3Y span drawing 5 years). Boots the real bundled server against
 * a throwaway DB and drives the real HTTP API.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORK = path.join(ROOT, 'evidence', '.probe-f1f2');
const cap = (cmd, args, cwd) =>
  new Promise((res) => {
    const c = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let o = '', e = '';
    c.stdout.on('data', (d) => (o += d));
    c.stderr.on('data', (d) => (e += d));
    c.on('close', (code) => res({ code, stdout: o, stderr: e }));
  });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

rmSync(WORK, { recursive: true, force: true });
mkdirSync(WORK, { recursive: true });
const outfile = path.join(WORK, 'server.mjs');
const b = await cap(
  path.join(ROOT, 'node_modules/.bin/esbuild'),
  [
    path.join(ROOT, 'server/index.ts'), '--bundle', '--platform=node', '--target=node22',
    '--format=esm', '--outfile=' + outfile, '--packages=external',
    `--define:import.meta.url=${JSON.stringify('file://' + path.join(ROOT, 'server/index.ts'))}`,
  ],
  ROOT,
);
if (b.code !== 0) { console.error(b.stderr); process.exit(1); }

const PORT = process.env.PORT || '49320';
const srv = spawn(process.execPath, [outfile], {
  cwd: ROOT,
  env: { ...process.env, PORT, HOST: '127.0.0.1', DB_PATH: path.join(WORK, 'p.db'), NODE_ENV: 'production' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
srv.stdout.on('data', (d) => (log += d));
srv.stderr.on('data', (d) => (log += d));
const base = `http://127.0.0.1:${PORT}`;
for (let i = 0; i < 100; i++) {
  try { const r = await fetch(base + '/api/health'); if (r.ok) break; } catch { /* not up yet */ }
  await sleep(250);
}
const get = async (p) => {
  const r = await fetch(base + p);
  return { status: r.status, json: await r.json().catch(() => null) };
};

console.log('=== F-1 — trailing 1y return vs cache order ===');
const r1 = await get('/api/ratings/AAPL');
const before = r1.json?.data?.oneYearReturn ?? null;
console.log(`  1) ratings BEFORE any deep cache:  oneYearReturn = ${before}  (${(before * 100).toFixed(2)}%)`);

const sig = await get('/api/signals/AAPL');
const bars = sig.json?.data?.meta ? sig.json.data.range : null;
console.log(`  2) /api/signals/AAPL cached: range=${bars} source=${sig.json?.data?.source} signals=${sig.json?.data?.signals?.length ?? 0}`);

const r2 = await get('/api/ratings/AAPL');
const after = r2.json?.data?.oneYearReturn ?? null;
console.log(`  3) ratings AFTER deep cache:       oneYearReturn = ${after}  (${(after * 100).toFixed(2)}%)`);
const same = before !== null && after !== null && Math.abs(before - after) < 1e-9;
console.log(`  => cache-order independent: ${same ? 'YES ✓' : 'NO ✗'}  (Δ = ${before !== null && after !== null ? (after - before) : 'n/a'})`);

console.log('\n=== F-2 — the 3Y span ===');
for (const r of ['2y', '3y', '5y']) {
  const m = await get(`/api/market/AAPL?range=${r}&interval=1w`);
  const d = m.json?.data;
  const n = d?.candles?.length ?? 0;
  const first = d?.candles?.[0]?.time ? new Date(d.candles[0].time * 1000).toISOString().slice(0, 10) : '?';
  console.log(`  range=${r.padEnd(3)} → ${String(n).padStart(4)} bars, first=${first}`);
}

srv.kill('SIGTERM');
console.log('\n--- log tail ---\n' + log.split('\n').slice(-3).join('\n'));
