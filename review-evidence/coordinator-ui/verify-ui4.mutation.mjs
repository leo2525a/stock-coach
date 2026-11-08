/**
 * Round-4 mutation counter-proof (coordinator-owned).
 * Each mutant breaks exactly one of the 3 owner fixes; verify-ui4 must FAIL.
 * Usage: node review-evidence/coordinator-ui/verify-ui4.mutation.mjs
 */
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const ROOT = '/Users/love21/.openclaw/workspace/debug-coder/projects/stock-app';
const CSS = `${ROOT}/src/styles.css`;
const APP = `${ROOT}/src/App.tsx`;
const CAP = `${ROOT}/capacitor.config.ts`;
const files = [CSS, APP, CAP];
const backups = files.map((f) => `${f}.mutbak`);
files.forEach((f, i) => copyFileSync(f, backups[i]));

const mutants = [
  {
    name: 'M1 re-introduce the off-canvas slide',
    why: 'the app would slide again (owner complaint 1)',
    file: CSS,
    apply: (s) => s + '\n@media (max-width: 1180px) { .sidebar.open { transform: translateX(0); } .sidebar { transform: translateX(-104%); transition: transform 0.2s ease-out; } }\n',
  },
  {
    name: 'M2 clip the panel again (overflow hidden)',
    why: 'the panel could not scroll its content (owner complaint 1)',
    file: CSS,
    apply: (s) => s + '\n.sidebar { overflow-y: hidden !important; }\n',
  },
  {
    name: 'M3 separate ☰ button instead of the logo',
    why: 'the menu button is not the logo (owner complaint 2)',
    file: APP,
    apply: (s) => s.replace('<span className="brand">\n          Stock<span>Coach</span>\n        </span>', '☰'),
  },
  {
    name: 'M4 restore the double safe-area inset',
    why: 'WKWebView + CSS both inset again (owner complaint 3)',
    file: CAP,
    apply: (s) => s.replace("contentInset: 'never'", "contentInset: 'always'"),
  },
];

let caught = 0;
for (const m of mutants) {
  // restore then mutate
  files.forEach((f, i) => copyFileSync(backups[i], f));
  const cur = readFileSync(m.file, 'utf8');
  const next = m.apply(cur);
  if (next === cur) { console.log(`SKIP  ${m.name} — mutation did not apply`); continue; }
  writeFileSync(m.file, next);
  let rebuilt = true;
  try { execSync('npm run build', { cwd: ROOT, stdio: 'ignore' }); } catch { rebuilt = false; }
  let failed = false, out = '';
  try { out = execSync('node review-evidence/coordinator-ui/verify-ui4.mjs', { cwd: ROOT, encoding: 'utf8' }); }
  catch (e) { failed = true; out = (e.stdout || '') + (e.stderr || ''); }
  const nfail = (out.match(/^FAIL/m) || []).length;
  if (failed && nfail > 0) { caught++; console.log(`CAUGHT  ${m.name}  (${nfail} checks failed, rebuilt=${rebuilt})`); }
  else console.log(`MISSED  ${m.name}  (verify exit-fail=${failed}, nfail=${nfail}, rebuilt=${rebuilt})`);
}
// restore
files.forEach((f, i) => copyFileSync(backups[i], f));
files.forEach((f, i) => { try { execSync(`rm -f ${backups[i]}`); } catch {} });
execSync('npm run build', { cwd: ROOT, stdio: 'ignore' });
console.log(`\n${caught}/${mutants.length} mutants caught`);
process.exit(caught === mutants.length ? 0 : 1);
