/**
 * Mutation counter-proof for `verify-ui3.mjs`.
 *
 * Each round-3 fix is broken inside the *built* output (CSS or the JS bundle),
 * the coordinator verifier is re-run, and the matching check must FAIL. That is
 * what separates "the checks pass" from "the checks can fail".
 *
 * Notes learned while writing this:
 *   - the sidebar declares its transition twice (base rule + the
 *     `body.chrome-hidden` rule that wins while the panel is away), so the
 *     transition mutant must neutralise BOTH or the check passes on the
 *     surviving declaration;
 *   - "scrollable" must be tested together with the overflow mode, because
 *     `overflow-x:hidden` also reports scrollWidth > clientWidth;
 *   - the behaviour of the corner entry (it opens the drawer on a phone, and it
 *     steps aside while the drawer is open) lives in the JS bundle, so those
 *     mutants patch `.js` rather than `.css`.
 *
 * All mutated files are restored afterwards.
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const DIST = 'dist/assets';
const files = readdirSync(DIST);
const cssPath = join(DIST, files.find((f) => f.endsWith('.css')));
const jsPath = join(DIST, files.find((f) => f.endsWith('.js') && f.startsWith('index-')));
const cssOriginal = readFileSync(cssPath, 'utf8');
const jsOriginal = readFileSync(jsPath, 'utf8');

const MUTATIONS = [
  {
    file: 'css',
    name: 'the put-away panel is NOT pushed off-canvas (dead strip)',
    expect: 'pushed off-canvas',
    apply: (css) =>
      css.replace(/body\.chrome-hidden \.sidebar\{[^}]*\}/g, 'body.chrome-hidden .sidebar{margin-left:56px}'),
  },
  {
    file: 'css',
    name: 'the panel has no slide transition (BOTH declarations broken)',
    expect: 'the panel slides',
    apply: (css) => css.replace(/transition:margin-left \.?22s ease,visibility 0s linear [\d.]+s/g, 'transition:none'),
  },
  {
    file: 'css',
    name: 'the menu entry becomes a solid bar (not discreet)',
    expect: 'discreet',
    apply: (css) =>
      css.replace(
        /\.drawer-toggle\{[^}]*\}/g,
        '.drawer-toggle{display:inline-flex;position:absolute;top:0;left:0;z-index:60;min-width:40px;min-height:40px;background:#ff0000;border:1px solid #ff0000;border-radius:0;opacity:1}',
      ),
  },
  {
    file: 'css',
    name: 'the entry stays on top while the drawer is open (overlaps the brand)',
    expect: 'gets out of the way',
    apply: (css) => css + '\n.app:has(.sidebar.open) .drawer-toggle{display:inline-flex !important}',
  },
  {
    file: 'css',
    name: 'the phone toolbar wraps into rows again (no scroll)',
    expect: 'ONE row',
    apply: (css) =>
      css.replace(/\.chart-toolbar\{[^}]*\}/g, '.chart-toolbar{display:flex;flex-wrap:wrap;gap:6px;padding:8px;overflow-x:visible}'),
  },
  {
    file: 'css',
    name: 'the toolbar hides overflow instead of scrolling it',
    expect: 'scrolls horizontally',
    apply: (css) => css.replace(/overflow-x:auto/g, 'overflow-x:hidden'),
  },
  {
    file: 'css',
    name: 'scroll snapping is removed from the categories',
    expect: 'scroll snaps',
    apply: (css) => css.replace(/scroll-snap-type:x proximity/g, 'scroll-snap-type:none'),
  },
  {
    file: 'css',
    name: 'the category capsules are squeezed so their functions split across rows',
    expect: 'contiguous run',
    apply: (css) => css + '\n.toolbar-group{flex-wrap:wrap;max-width:110px}',
  },
  {
    file: 'js',
    name: 'the corner entry no longer opens the drawer on a phone',
    expect: 'the entry opens the drawer',
    apply: (js) =>
      js.replace(
        'onClick:()=>window.matchMedia("(max-width: 1180px)").matches?d(!c):z(O=>!O)',
        'onClick:()=>window.matchMedia("(max-width: 0px)").matches?d(!c):z(O=>!O)',
      ),
  },
  {
    file: 'js',
    name: 'the corner entry loses its accessible label',
    expect: 'the menu entry is labelled',
    apply: (js) => js.replace('"aria-label":l(E||!c?"nav.show":"nav.hide")', '"aria-label":""'),
  },
];

function runVerifier() {
  try {
    return execFileSync('node', ['review-evidence/coordinator-ui/verify-ui3.mjs'], { encoding: 'utf8' });
  } catch (e) {
    return (e.stdout || '') + (e.stderr || '');
  }
}

let caught = 0;
try {
  for (const m of MUTATIONS) {
    const path = m.file === 'css' ? cssPath : jsPath;
    const original = m.file === 'css' ? cssOriginal : jsOriginal;
    const mutated = m.apply(original);
    if (mutated === original) {
      console.log(`SKIP    ${m.name}  → pattern not found in the build`);
      continue;
    }
    writeFileSync(path, mutated);
    const out = runVerifier();
    const failed = out.split('\n').filter((l) => l.startsWith('FAIL'));
    const hit = failed.some((l) => l.toLowerCase().includes(m.expect.toLowerCase()));
    console.log(
      `${hit ? 'CAUGHT' : 'MISSED'}  ${m.name}  → ${failed.length} FAIL${hit ? '' : `\n${failed.join('\n')}`}`,
    );
    if (hit) caught += 1;
    writeFileSync(path, original);
  }
} finally {
  writeFileSync(cssPath, cssOriginal);
  writeFileSync(jsPath, jsOriginal);
  console.log('build restored');
}
console.log(`\n=== mutation counter-proof: ${caught}/${MUTATIONS.length} caught ===`);
process.exit(caught === MUTATIONS.length ? 0 : 1);
