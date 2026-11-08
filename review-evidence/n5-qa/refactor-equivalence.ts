/**
 * N5 refactor equivalence check (reviewer QA).
 *
 * The shipped fix replaced an inline expression in server/phase2-service.ts:
 *
 *   BEFORE: const usable = payload.profile !== null || payload.keyStats !== null || payload.health !== null;
 *           if (usable) setKv(db, key, payload, now);
 *   AFTER:  if (isUsableFundamentals(payload)) setKv(db, key, payload, now);
 *
 * This script proves the two decide identically for EVERY branch of the
 * (profile, keyStats, health) null-ness, including degenerate/falsy non-null
 * values (0, '', false) that a truthiness-based rewrite would miss.
 *
 * It imports the REAL predicate from the shipped tree. It replicates the old
 * expression verbatim and compares outputs. No app source is modified.
 */
import { isUsableFundamentals } from '../../shared/fundamentals';
import type { FundamentalsPayload } from '../../shared/types';

// The exact pre-refactor expression, verbatim.
function oldInline(payload: FundamentalsPayload): boolean {
  return payload.profile !== null || payload.keyStats !== null || payload.health !== null;
}

const base = {
  symbol: 'AAPL',
  quoteType: null,
  currency: null,
  source: 'live',
  lastUpdated: 1,
  note: null,
} as FundamentalsPayload;

// Values to drop into each of the three slots: null plus a spread of non-null
// shapes (truthy AND falsy-but-not-null) to catch !== vs truthiness drift.
const dialect = [
  ['null', null],
  ['object', { any: 1 }],
  ['empty-object', {}],
  ['zero', 0],
  ['empty-string', ''],
  ['false', false],
] as const;

type Triple = { p: unknown; k: unknown; h: unknown };
const combos: Triple[] = [];
for (const [, p] of dialect) for (const [, k] of dialect) for (const [, h] of dialect) {
  combos.push({ p, k, h });
}

let checked = 0;
const mismatches: string[] = [];
for (const c of combos) {
  const payload = { ...base, profile: c.p as never, keyStats: c.k as never, health: c.h as never };
  const a = oldInline(payload);
  const b = isUsableFundamentals(payload);
  checked += 1;
  if (a !== b) mismatches.push(`p=${JSON.stringify(c.p)} k=${JSON.stringify(c.k)} h=${JSON.stringify(c.h)} old=${a} new=${b}`);
}

// Also spot-check the canonical branches the coder names.
const named = {
  emptyEnvelope: { ...base, profile: null, keyStats: null, health: null },
  partialProfileOnly: { ...base, profile: { sector: 'Tech' } as never, keyStats: null, health: null },
  partialStatsOnly: { ...base, profile: null, keyStats: { marketCap: 1 } as never, health: null },
  full: { ...base, profile: { sector: 'Tech' } as never, keyStats: { marketCap: 1 } as never, health: { beta: 1 } as never },
} as Record<string, FundamentalsPayload>;

console.log(`all-branch combos checked: ${checked}`);
for (const [name, payload] of Object.entries(named)) {
  console.log(`  ${name.padEnd(18)} old=${oldInline(payload)} new=${isUsableFundamentals(payload)}`);
}

if (mismatches.length === 0) {
  console.log('\nREFACTOR EQUIVALENCE: PASS — old inline expression and isUsableFundamentals agree on every branch');
} else {
  console.log(`\nREFACTOR EQUIVALENCE: FAIL — ${mismatches.length} mismatch(es)`);
  for (const m of mismatches.slice(0, 10)) console.log(`  ${m}`);
  process.exitCode = 1;
}
