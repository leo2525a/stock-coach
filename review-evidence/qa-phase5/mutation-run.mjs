#!/usr/bin/env node
/**
 * Adversarial mutation runner (QA Phase 5, review-evidence/qa-phase5).
 *
 * Proves the *shipped* `scripts/evidence-phase5.mjs` assertions are not vacuous:
 * it builds a mutant app root (the real `dist/` with exactly ONE stylesheet
 * mutation, plus symlinks to the real `server/`, `shared/`, `node_modules/`),
 * runs the shipped harness verbatim against it (only ROOT/EVIDENCE_DIR/WORK_DIR
 * are repointed), and reports whether the assertions FAIL as they must.
 *
 * Everything it writes lives under `review-evidence/qa-phase5/`; the repo is
 * untouched.
 *
 * Usage: node mutation-run.mjs <chart-bg|drawer-hidden|no-light-token>
 */
import { spawn } from 'node:child_process';
import {
  cpSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..');
const MODE = process.argv[2] ?? 'chart-bg';
const OUT_DIR = path.join(REPO, 'review-evidence', 'qa-phase5', `mutation-${MODE}`);
const WORK_DIR = path.join(REPO, 'review-evidence', 'qa-phase5', `.work-mut-${MODE}`);
const MUTANT_ROOT = path.join(REPO, 'review-evidence', 'qa-phase5', 'mutant-root');

/* ------------------------------------------------------------- mutant root */

const realDist = path.join(REPO, 'dist');
const cssName = readdirSync(path.join(realDist, 'assets')).find(
  (f) => f.startsWith('index-') && f.endsWith('.css'),
);
if (!cssName) throw new Error('no built css under dist/assets — run npm run build first');

rmSync(MUTANT_ROOT, { recursive: true, force: true });
mkdirSync(path.join(MUTANT_ROOT, 'dist'), { recursive: true });
cpSync(realDist, path.join(MUTANT_ROOT, 'dist'), { recursive: true });
for (const link of ['server', 'shared', 'node_modules']) {
  symlinkSync(path.join(REPO, link), path.join(MUTANT_ROOT, link), 'dir');
}
writeFileSync(
  path.join(MUTANT_ROOT, 'package.json'),
  JSON.stringify({ name: 'qa-mutant', private: true, type: 'module' }, null, 2),
);

const cssPath = path.join(MUTANT_ROOT, 'dist', 'assets', cssName);
let css = readFileSync(cssPath, 'utf8');
const before = css;
if (MODE === 'chart-bg') {
  // Force the light theme's chart background back to the DARK value, so the
  // canvas cannot follow the theme even though `data-theme` says light.
  // Appended LAST with a higher-specificity selector so it actually wins.
  css += '\nhtml[data-theme=light]{--chart-bg:#161b22;}\n';
} else if (MODE === 'drawer-hidden') {
  // Re-introduce the pre-fix bug: the hamburger is hidden at every width.
  css += '\n@media (max-width:720px){.drawer-toggle{display:none!important}}';
} else if (MODE === 'no-light-token') {
  // Drop ALL light overrides, so light mode keeps the dark palette.
  css = css.replace(/\[data-theme=light\]\{[^}]*\}/, '[data-theme=light]{}');
} else if (MODE === 'light-bg-dark') {
  // Only the --bg token is wrong: light mode paints the DARK page background
  // while every other light token (and the chart background) is correct.
  css += '\nhtml[data-theme=light]{--bg:#0d1117;}\n';
} else {
  throw new Error(`unknown mode ${MODE}`);
}
if (css === before) throw new Error(`mutation ${MODE} changed nothing — selector may have moved`);
writeFileSync(cssPath, css);

/* ------------------------------------------------- mutated harness (verbatim) */

const BASE = readFileSync(path.join(REPO, 'scripts', 'evidence-phase5.mjs'), 'utf8');
const mutated = BASE
  .replace("const ROOT = path.resolve(__dirname, '..');", `const ROOT = ${JSON.stringify(MUTANT_ROOT)};`)
  .replace(
    "const EVIDENCE_DIR = path.join(ROOT, 'evidence', 'phase5');",
    `const EVIDENCE_DIR = ${JSON.stringify(OUT_DIR)};`,
  )
  .replace(
    "const WORK_DIR = path.join(ROOT, 'evidence', '.work-phase5');",
    `const WORK_DIR = ${JSON.stringify(WORK_DIR)};`,
  );
if (!mutated.includes(MUTANT_ROOT)) throw new Error('harness ROOT was not repointed');
const MUT_PATH = path.join(__dirname, `_mut-${MODE}.mjs`);
writeFileSync(MUT_PATH, mutated);

rmSync(WORK_DIR, { recursive: true, force: true });
mkdirSync(OUT_DIR, { recursive: true });

const child = spawn(process.execPath, [MUT_PATH], { cwd: MUTANT_ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
child.stdout.on('data', (d) => (log += d));
child.stderr.on('data', (d) => (log += d));
child.on('close', (code) => {
  writeFileSync(path.join(OUT_DIR, 'run.log'), log);
  const fails = log.split('\n').filter((l) => l.includes('✗'));
  console.log(`[mutation ${MODE}] exit code = ${code}`);
  console.log(`[mutation ${MODE}] failing lines (${fails.length}):`);
  for (const f of fails) console.log('   ' + f.trim());
  console.log(`[mutation ${MODE}] log → ${path.join(OUT_DIR, 'run.log')}`);
  console.log(
    code === 0
      ? `[mutation ${MODE}] *** VACUOUS — the shipped checks PASSED against a broken app ***`
      : `[mutation ${MODE}] OK — the shipped checks FAILED as they must (non-vacuous)`,
  );
});
