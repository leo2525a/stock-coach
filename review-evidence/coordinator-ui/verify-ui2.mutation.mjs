/**
 * Mutation counter-proof for `verify-ui2.mjs`.
 *
 * Breaks each round-2 fix inside the *built* CSS, re-runs the coordinator
 * verifier, and asserts the matching check FAILS — so the pass on the real
 * build is not just "the checks always pass". Restores the build afterwards.
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const DIST = 'dist/assets';
const cssFile = readdirSync(DIST).find((f) => f.endsWith('.css'));
const cssPath = join(DIST, cssFile);
const original = readFileSync(cssPath, 'utf8');

const MUTATIONS = [
  {
    name: 'panel never leaves (chrome-hidden rule removed)',
    expect: '2c',
    apply: (css) => css.replace(/body\.chrome-hidden \.sidebar\{[^}]*\}/g, '/*removed*/'),
  },
  {
    name: 'panel has no slide transition',
    expect: '2b',
    apply: (css) =>
      css.replace(/transition:margin-left \.?22s ease,visibility 0s linear 0s/g, 'transition:none'),
  },
  {
    name: 'toolbar groups are square (not pills)',
    expect: '3b',
    apply: (css) => css.replace(/\.toolbar-group\{[^}]*\}/g, '.toolbar-group{display:inline-flex}'),
  },
  {
    name: 'headline row pinned to the viewport',
    expect: '4a',
    apply: (css) => css.replace(/\.head-row\{[^}]*\}/g, '.head-row{position:sticky;top:0;display:flex}'),
  },
];

function runVerifier() {
  try {
    const out = execFileSync('node', ['review-evidence/coordinator-ui/verify-ui2.mjs'], {
      encoding: 'utf8',
    });
    return out;
  } catch (e) {
    return (e.stdout || '') + (e.stderr || '');
  }
}

let caught = 0;
try {
  for (const m of MUTATIONS) {
    writeFileSync(cssPath, m.apply(original));
    const out = runVerifier();
    const lines = out.split('\n');
    const failed = lines.filter((l) => l.startsWith('FAIL'));
    const hit = failed.some((l) => l.includes(m.expect));
    console.log(`${hit ? 'CAUGHT' : 'MISSED'}  ${m.expect}  ${m.name}  → ${failed.length} FAIL`);
    if (hit) caught += 1;
    else console.log(failed.join('\n'));
  }
} finally {
  writeFileSync(cssPath, original);
}
console.log(`\n=== mutation counter-proof: ${caught}/${MUTATIONS.length} caught ===`);
process.exit(caught === MUTATIONS.length ? 0 : 1);
