# R6 — split the English dictionary by namespace (first mechanical delegation)

Owner (at 60/100): 「用機械式 patch 指派 但你要確保唔好再出現之前有既狀況」

Two things happened: the app was split, **and** the delegation actually worked
this time — after three rounds where the same child produced zero edits.

## The split

`shared/i18n/en.ts` was **1,069 lines** holding all 849 flat dotted keys in one
object literal. It is now an 11-line barrel plus four namespace modules:

| File | Keys | Prefixes |
|---|---|---|
| `shared/i18n/en/shell.ts` | 116 | `app` `nav` `theme` `sidebar` `topbar` `common` `api` `age` `mover` `cat` `src` `glossary` |
| `shared/i18n/en/screens.ts` | 255 | `dash` `chart` `signals` `signal` `ind` `help` `note` `watch` |
| `shared/i18n/en/analyst.ts` | 381 | `pf` `div` |
| `shared/i18n/en/sig.ts` | 97 | `sig` |

116 + 255 + 381 + 97 = **849**, the exact original count. `en.ts` keeps no key
literals — verified, not assumed.

`zh-HK.ts` was deliberately **not** touched: it is the same split's mirror image
and needs its own pass.

## Why the delegation worked this time (the actual fix)

The three prior failures were not the model refusing to work. They were
**output-token truncation**: 14 of 26 runs ended `stopReason=length`, 4 with
zero edits, with reasoning pinned at exactly 8192 tokens. The model was writing
an elaborate plan into reasoning and running out of budget mid-recon.

What changed:

1. **A written brief with the recon already done** — namespace table, exact file
   names, exact import lines, exact barrel body. Nothing left to discover.
2. **A forbidden list** — no `tests/`, no `review-evidence/`, no `zh-HK.ts`, no
   commit, no push.
3. **Numeric stop conditions** — `keys: 849`, `dupes: 0`, tsc 0, vitest 469/23.
   A mismatch means stop and report, never improvise.
4. **Scope of one** — "do not start a second refactor. One job."

Result: one run, no stall, all gates matched on the first attempt.

## The coordinator still verified independently

The child's report is input, not evidence. `verify-i18n-split.mjs` re-derives
the dictionary through the real module graph and diffs it against the object
literal **at baseline commit `2a9e6b1`**, parsed with the real TS parser:

- 849 keys at baseline, 849 assembled, **0 duplicates**
- no key lost, no key invented (set equality both directions)
- **every value character-for-character identical**
- zh-HK key-count parity still holds

**Calibration matters:** before the work started, the same verifier was run
against the *unmodified* tree and reported 8 substance checks PASS / 2
structural FAIL. So a later PASS means "equivalent", not "always green".

**Mutation counter-proof** (two independent mutants):

| Mutation | Caught by |
|---|---|
| delete `sig.ma-trend.title.golden` | 3 checks — count 848, missing key, locale parity |
| append one char to `chart.range`'s value | value-identity check, 1 changed |

## What the child got wrong, and what that revealed

The brief said "copy the `'key': value` lines only", so the child dropped **79
lines of comments** — including the docblock carrying two rules that prevent
real bugs (`sig.ev.*` must match `shared/signals.ts` exactly; en/zh-HK key sets
must stay identical).

The coordinator restored them: all **43 section comments** reattached to their
original keys (verified as an identical multiset against baseline), and the
two-rule docblock rewritten for the new barrel. Lesson for the next brief: when
specifying a mechanical copy, say explicitly whether comments travel with keys.

## Gates (coordinator-run)

| Gate | Result |
|---|---|
| `verify-i18n-split.mjs` | **10/10** |
| mutation (2 mutants) | 3 checks / 1 check caught |
| `tsc --noEmit` | 0 |
| `lint` | clean |
| `vitest` | **469 passed / 23 files** |
| `build` | 0 |
| `verify:runtime` | 178 |
| `evidence:phase3` | 76 |
| `evidence:phase4` | 88 |
| `evidence:phase5` | 61 |
| `evidence:chart` | 82 |
| `evidence:colour` | 35 |
| `verify-ui4` | 21/21 |

Every count identical to baseline. Bundled CSS md5 unchanged
(`a0e8674cb4993f6af3dd1aa470b706d5`) — the i18n split touched no styling.