/**
 * INDEPENDENT REPLICATION of the shipped shared/ scan (debug-reviewer).
 *
 * `tests/no-hardcoded-strings.test.ts` scans `shared/` for English prose that the
 * dictionary does not publish. Its helper `proseLiteralsIn()` is not exported,
 * and the boundary for this review is read-only on app source, so we replicate
 * its scan **verbatim** here and run it against:
 *   (a) the real `shared/` tree  → expect no unexplained prose; and
 *   (b) a MUTATED copy of `shared/format.ts`, kept under review-evidence/,
 *       with an invented English user-facing literal → expect the scan to catch
 *       it, proving the guard is not vacuous.
 *
 * Verbose run:  ./node_modules/.bin/tsx review-evidence/qa-phase2-rerun/shared-scan-replica.ts
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { en } from '../../shared/i18n';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

/* ---- verbatim from tests/no-hardcoded-strings.test.ts ---- */
const ALLOWED_LITERALS = new Set([
  'StockCoach', 'Stock', 'Coach', 'Stock Coach', 'button', 'submit', 'px', 'page',
  'true', 'false', 'none', 'all', 'other', 'stock', 'etf', 'active', 'collapsed',
  'open', 'selected', 'is-stale', 'SF Mono', 'SFMono-Regular', 'Menlo', 'Consolas',
]);
const DIAGNOSTIC_PATTERNS = [
  /\b(?:error|noteText|message|reason|desc)\s*:\s*(?:`[^`]*`|'[^']*'|"[^"]*")/g,
  /\bnew (?:Error|MarketDataError|YahooParseError|RangeError|TypeError)\s*\([^()]*\)/g,
  /\bnew (?:Error|MarketDataError|YahooParseError|RangeError|TypeError)\s*\(\s*(?:`[^`]*`|'[^']*'|"[^"]*")/g,
];
const SOURCED_BY_DESIGN = new Set(['NYSE Arca']);

function decodeEscapes(value: string): string {
  return value.replace(
    /\\(u\{([0-9a-fA-F]+)\}|u([0-9a-fA-F]{4})|x([0-9a-fA-F]{2})|([ntrbfv0'"\\]))/g,
    (_m, _all: string, brace: string, u4: string, x2: string, ch: string) => {
      if (brace) return String.fromCodePoint(parseInt(brace, 16));
      if (u4) return String.fromCharCode(parseInt(u4, 16));
      if (x2) return String.fromCharCode(parseInt(x2, 16));
      const map: Record<string, string> = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v', '0': '\0', "'": "'", '"': '"', '\\': '\\' };
      return map[ch] ?? ch;
    },
  );
}
function stripDiagnostics(source: string): string {
  return DIAGNOSTIC_PATTERNS.reduce((acc, re) => acc.replace(re, '<diagnostic>'), source);
}
function looksLikeCopy(text: string): boolean {
  const s = text.trim();
  if (s.length < 3) return false;
  if (ALLOWED_LITERALS.has(s)) return false;
  if (/^[A-Z0-9.]{1,6}$/.test(s)) return false;
  if (/^[a-z][a-z0-9-]*$/.test(s)) return false;
  if (/^[^\p{L}]+$/u.test(s)) return false;
  if (/[\u3400-\u9fff]/.test(s)) return s.length >= 2;
  if (!/[A-Z]/.test(s)) return false;
  return /\p{L}{2,}\s+\p{L}{2,}/u.test(s) && s.length >= 6;
}
function proseLiteralsIn(absFiles: string[]): string[] {
  const found: string[] = [];
  for (const file of absFiles) {
    const src = readFileSync(file, 'utf8');
    src.split('\n').forEach((line, i) => {
      const trimmed = line.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return;
      const scan = stripDiagnostics(line);
      for (const m of scan.matchAll(/'([^'\n]*)'/g)) {
        const value = decodeEscapes(m[1]).trim();
        if (value !== m[1].trim() && looksLikeCopy(value)) found.push(`${file}:${i + 1} → ${JSON.stringify(value)}`);
        else if (looksLikeCopy(m[1])) found.push(`${file}:${i + 1} → ${JSON.stringify(m[1].trim())}`);
      }
    });
  }
  return found;
}
/* ---- end verbatim ---- */

const englishValues = new Set(Object.values(en));
const isPublished = (literal: string) =>
  englishValues.has(literal) || [...englishValues].some((v) => v.includes(literal));

const SHARED = ROOT + '/shared';
const declared = ['signals.ts', 'categorise.ts', 'format.ts', 'api-errors.ts', 'types.ts', 'yahoo.ts']
  .map((f) => path.join(SHARED, f));

console.log('--- (a) real shared/ tree ---');
const real = proseLiteralsIn(declared);
console.log('prose literals found (raw):', real.length);
const unexplained = real.filter((h) => {
  const lit = JSON.parse(h.slice(h.indexOf('→ ') + 2));
  return !isPublished(lit) && !SOURCED_BY_DESIGN.has(lit);
});
console.log('unexplained English prose in shared/ (should be 0):', unexplained.length);
unexplained.forEach((u) => console.log('   ' + u));

console.log('\n--- (b) mutated copy of format.ts (reintroduced hard-coded English) ---');
const realFormat = readFileSync(path.join(SHARED, 'format.ts'), 'utf8');
const mutated = realFormat.replace(
  "export const NO_DATA = '—';",
  "export const NO_DATA = '—';\nexport function oops(): string { return 'Sorry, no numbers here'; }",
);
console.log('mutation applied:', mutated !== realFormat);
const mutHits = proseLiteralsIn([path.join(SHARED, 'format.ts')]); // scan real file for baseline
// Scan the mutated text directly (same algorithm, in-memory).
const mutFound: string[] = [];
mutated.split('\n').forEach((line, i) => {
  const trimmed = line.trim();
  if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return;
  for (const m of stripDiagnostics(line).matchAll(/'([^'\n]*)'/g)) {
    if (looksLikeCopy(m[1])) mutFound.push(`format.ts:${i + 1} → ${JSON.stringify(m[1].trim())}`);
  }
});
const mutUnexplained = mutFound.filter((h) => {
  const lit = JSON.parse(h.slice(h.indexOf('→ ') + 2));
  return !isPublished(lit) && !SOURCED_BY_DESIGN.has(lit);
});
console.log('baseline hits on real format.ts:', mutHits.length, JSON.stringify(mutHits));
console.log('unexplained hits on MUTATED format.ts (should be ≥1):', mutUnexplained.length);
mutUnexplained.forEach((u) => console.log('   ' + u));

const ok = unexplained.length === 0 && mutUnexplained.length >= 1;
console.log('\nREPLICATION RESULT:', ok
  ? 'PASS — real shared/ is clean AND the scan catches a reintroduced English literal (guard is not vacuous)'
  : 'FAIL');
process.exit(ok ? 0 : 1);
