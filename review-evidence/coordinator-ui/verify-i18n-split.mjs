/**
 * Coordinator verifier — is the i18n split a true no-op?
 *
 * Does NOT trust the coder's report. Reconstructs the dictionary from the
 * working tree and compares it, key by key and character by character, against
 * the object literal as it existed at a known-good baseline commit.
 *
 * Owner of this file: coordinator (debug-debug_lead). Children must not edit it.
 * Run: node review-evidence/coordinator-ui/verify-i18n-split.mjs
 */
import { execSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REPO = '/Users/love21/.openclaw/workspace/debug-coder/projects/stock-app';
const BASELINE = '2a9e6b1';

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  [${detail}]` : ''}`);
};

// ---------- 1. the baseline dictionary, imported through the real TS parser ----------
const baselineSrc = execSync(`git show ${BASELINE}:shared/i18n/en.ts`, { cwd: REPO, encoding: 'utf8' });

// Parse the baseline with esbuild (via tsx), not a regex: the file has comment
// lines between key groups, which any line-oriented regex silently drops.
const tmp = mkdtempSync(join(tmpdir(), 'i18nverify-'));
const baseFile = join(tmp, 'baseline-en.ts');
writeFileSync(baseFile, baselineSrc);

const baselineProbe = join(tmp, 'probe-baseline.ts');
writeFileSync(baselineProbe, `
import { en } from ${JSON.stringify(baseFile)};
process.stdout.write(JSON.stringify(Object.entries(en)));
`);

let baselineEntries;
try {
  baselineEntries = JSON.parse(
    execSync(`npx tsx ${JSON.stringify(baselineProbe)}`, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }),
  );
} catch (e) {
  check('the baseline file at ' + BASELINE + ' parses', false, String(e).slice(0, 160));
  process.exit(1);
}

const baseline = new Map(baselineEntries);
check('baseline parses to the expected 849 keys', baseline.size === 849, `${baseline.size} keys`);

// ---------- 2. the working-tree dictionary, via the real module graph ----------
const probe = join(tmp, 'probe.ts');
writeFileSync(probe, `
import { en } from ${JSON.stringify(REPO + '/shared/i18n/index')};
import { zhHK } from ${JSON.stringify(REPO + '/shared/i18n/index')};
const ks = Object.keys(en);
const out = { keys: ks, entries: Object.entries(en), zh: Object.keys(zhHK).length };
process.stdout.write(JSON.stringify(out));
`);

let live;
try {
  const raw = execSync(`npx tsx ${JSON.stringify(probe)}`, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  live = JSON.parse(raw);
} catch (e) {
  check('the module graph loads (en + zhHK import cleanly)', false, String(e).slice(0, 120));
  process.exit(1);
}

check('the module graph loads (en + zhHK import cleanly)', true);
check('assembled key count is 849', live.keys.length === 849, `${live.keys.length} keys`);
check('no duplicate keys (a spread would silently hide one)', new Set(live.keys).size === live.keys.length,
  `${live.keys.length - new Set(live.keys).size} dupes`);

// ---------- 3. exact key-set equality, both directions ----------
const missing = [...baseline.keys()].filter((k) => !live.keys.includes(k));
const extra = live.keys.filter((k) => !baseline.has(k));
check('no key was lost in the split', missing.length === 0, missing.slice(0, 5).join(', ') || 'none');
check('no key was invented in the split', extra.length === 0, extra.slice(0, 5).join(', ') || 'none');

// ---------- 4. exact value equality — the part a spread can quietly break ----------
const liveMap = new Map(live.entries);
const changed = [];
for (const [k, v] of baseline) {
  if (!liveMap.has(k)) continue;
  if (liveMap.get(k) !== v) changed.push(k);
}
check('no value changed (character for character)', changed.length === 0,
  changed.length ? `${changed.length} changed: ${changed.slice(0, 3).join(', ')}` : 'all identical');

// ---------- 5. the locale parity contract still holds ----------
check('zh-HK still has the same key count as en', live.zh === live.keys.length, `zh=${live.zh} en=${live.keys.length}`);

// ---------- 6. the split is real, not cosmetic ----------
let tree = '';
try {
  tree = execSync(`ls ${REPO}/shared/i18n/en/`, { encoding: 'utf8' });
} catch {
  tree = '';
}
const modules = tree.split('\n').filter((f) => f.endsWith('.ts'));
check('shared/i18n/en/ exists with 4 namespace modules', modules.length === 4, modules.join(' '));

// The point is "no data here", not an arbitrary line budget: the barrel may
// carry a docblock of any length, but it must not contain key literals.
const barrelSrc = execSync(`cat ${REPO}/shared/i18n/en.ts`, { encoding: 'utf8' });
const keyLiterals = (barrelSrc.match(/^\s*'[^']+':/gm) || []).length;
const barrel = String(barrelSrc.split('\n').length);
check('en.ts is now a barrel, not the data', keyLiterals === 0 && /export const en/.test(barrelSrc),
  `${keyLiterals} key literals, ${barrel} lines`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);