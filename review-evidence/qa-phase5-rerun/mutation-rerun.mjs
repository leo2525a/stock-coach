#!/usr/bin/env node
/**
 * Round-2 adversarial mutation runner (review-evidence/qa-phase5-rerun).
 *
 * Faithful to the round-1 method that was validated: it edits a SCRATCH COPY of
 * the repo (source level, so Vite rebuilds dist), rebuilds, then runs the
 * SHIPPED `scripts/evidence-phase5.mjs` verbatim inside the scratch copy. Only
 * files under review-evidence/qa-phase5-rerun/scratch are touched; the real repo
 * source is never modified.
 *
 * Usage: node mutation-rerun.mjs <all|b1|b1b|b3|n4>
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..');
const SCRATCH = path.join(__dirname, 'scratch');
const OUT = path.join(__dirname, 'mutations');

const CSS = path.join(SCRATCH, 'src', 'styles.css');
const APP = path.join(SCRATCH, 'src', 'App.tsx');
const ORIG_CSS = readFileSync(path.join(REPO, 'src', 'styles.css'), 'utf8');
const ORIG_APP = readFileSync(path.join(REPO, 'src', 'App.tsx'), 'utf8');

const B1_OLD = `@media (min-width: 721px) {
  .scrim {
    display: none;
  }
}`;
const N4_OLD = `@media (pointer: coarse) {
  .topbar > button,
  .topbar .lang-switch button,
  .drawer-toggle,
  .theme-toggle {
    min-height: 44px;
    min-width: 44px;
  }
  .topbar .lang-switch button {
    padding: 8px 10px;
  }
}`;
const B1B_OLD = `  // Escape closes the mobile drawer. The scrim already closes it on a tap
  // outside; this is the keyboard affordance (found missing by the Phase-5 QA).
  useEffect(() => {
    if (!sidebarOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSidebarOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sidebarOpen, setSidebarOpen]);
`;

function apply(mode) {
  writeFileSync(CSS, ORIG_CSS);
  writeFileSync(APP, ORIG_APP);
  if (mode === 'b1') {
    if (!ORIG_CSS.includes(B1_OLD)) throw new Error('B1 anchor not found');
    writeFileSync(CSS, ORIG_CSS.replace(B1_OLD, '.scrim { display: none; }'));
  } else if (mode === 'b1b') {
    if (!ORIG_APP.includes(B1B_OLD)) throw new Error('B1b anchor not found');
    writeFileSync(APP, ORIG_APP.replace(B1B_OLD, ''));
  } else if (mode === 'b3') {
    writeFileSync(CSS, ORIG_CSS + `\nhtml[data-theme='light'] { --bg: #0d1117; }\n`);
  } else if (mode === 'n4') {
    if (!ORIG_CSS.includes(N4_OLD)) throw new Error('N4 anchor not found');
    writeFileSync(CSS, ORIG_CSS.replace(N4_OLD, ''));
  } else throw new Error(`unknown mode ${mode}`);
}

function run(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

const modes = process.argv[2] === 'all' || !process.argv[2] ? ['b1', 'b1b', 'b3', 'n4'] : [process.argv[2]];
mkdirSync(OUT, { recursive: true });

const summary = [];
for (const mode of modes) {
  apply(mode);
  const build = run('npm', ['run', 'build'], SCRATCH);
  const ev = build.code === 0 ? run(process.execPath, ['scripts/evidence-phase5.mjs'], SCRATCH) : { code: null, out: 'BUILD FAILED' };
  writeFileSync(path.join(OUT, `${mode}.build.log`), build.out);
  writeFileSync(path.join(OUT, `${mode}.run.log`), ev.out);
  const fails = ev.out.split('\n').filter((l) => l.trim().startsWith('✗'));
  const passed = /PASSED — (\d+) checks/.exec(ev.out);
  summary.push({ mode, buildCode: build.code, evCode: ev.code, passed: passed ? Number(passed[1]) : null, fails });
  console.log(`\n===== mutation ${mode} =====`);
  console.log(`build exit=${build.code}  evidence exit=${ev.code}`);
  console.log(`failing checks (${fails.length}):`);
  for (const f of fails) console.log('   ' + f.trim());
  const tail = ev.out.trim().split('\n').slice(-1)[0];
  console.log(`tail: ${tail}`);
}
writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 2));
console.log('\nsummary → ' + path.join(OUT, 'summary.json'));
