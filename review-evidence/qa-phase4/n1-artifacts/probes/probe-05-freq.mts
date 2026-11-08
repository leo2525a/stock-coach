import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import path from 'node:path';
const freePort = () => new Promise((res) => { const s = createServer(); s.once('error', () => res(0)); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
const PORT = await freePort();
const work = mkdtempSync(path.join(tmpdir(), 'qa-n1-fq-'));
const srv = spawn('npx', ['tsx', 'server/index.ts'], { cwd: process.cwd(), env: { ...process.env, PORT: String(PORT), DB_PATH: path.join(work, 'db.sqlite') }, stdio: ['ignore', 'pipe', 'pipe'] });
const base = `http://127.0.0.1:${PORT}`;
let up = false; for (let i = 0; i < 240 && !up; i++) { try { up = !!(await fetch(`${base}/api/dividends/KO`)).status; } catch {} if (!up) await new Promise((r) => setTimeout(r, 500)); }
if (!up) { console.log('server never came up'); srv.kill(); process.exit(1); }
try {
  for (const sym of ['ULVR.L','BP.L','VOD.L','HSBA.L','0005.HK','KO','O']) {
    const p = (await (await fetch(`${base}/api/dividends/${encodeURIComponent(sym)}`)).json()).data;
    console.log(`${sym.padEnd(8)} freq=${JSON.stringify(p.facts.frequency)} annualRate=${JSON.stringify(p.facts.annualRate.value)}`);
  }
} finally { srv.kill(); rmSync(work, { recursive: true, force: true }); }
