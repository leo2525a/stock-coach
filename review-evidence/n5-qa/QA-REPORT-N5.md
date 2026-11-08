# N5 closure verification — independent QA

Reviewer: `debug-reviewer` (subagent) · Requester: `debug-debug_lead`
Date: 2026-11-06 · Artifact: `/Users/love21/.openclaw/workspace/debug-coder/projects/stock-app`
Scope: verify closure of finding **N5** (flaky `verify:runtime` fundamentals-cache assertion)
Constraints honoured: app source read-only; all writes under `./review-evidence/`; scratch
mutation copy at `./review-evidence/n5-qa/scratch/`; server on :8787 untouched.

## VERDICT: N5 CLOSED

Residual caveat: one doc-comment overstatement (see §6). No functional caveat.

---

## 1. Refactor is behaviour-preserving (claim 2) — PASS

`shared/fundamentals.ts`:
```ts
export function isUsableFundamentals(payload: FundamentalsPayload): boolean {
  return payload.profile !== null || payload.keyStats !== null || payload.health !== null;
}
```
`server/phase2-service.ts:158`:
```ts
if (isUsableFundamentals(payload)) setKv(db, key, payload, now);
```

The pre-refactor inline expression is preserved verbatim in the coder's write-up
(`followup-evidence/n5-cache-assertion.md:34`) and in my prior report
(`review-evidence/qa-phase2-rerun/QA-REPORT-RERUN.md:178`):
`payload.profile !== null || payload.keyStats !== null || payload.health !== null`.

**Mechanical all-branch proof** (`review-evidence/n5-qa/refactor-equivalence.ts`):
the real predicate imported from the shipped tree is compared against the old
expression replicated verbatim, over the full 6×6×6 = **216** combination space of
each slot ∈ {`null`, object, `{}`, `0`, `''`, `false`} — deliberately including
falsy-but-not-null values that a truthiness rewrite (`||`) instead of `!== null`
would diverge on:

```
all-branch combos checked: 216
  emptyEnvelope      old=false new=false
  partialProfileOnly old=true  new=true
  partialStatsOnly   old=true  new=true
  full               old=true  new=true
REFACTOR EQUIVALENCE: PASS — agree on every branch
```

Note on the six-value dialect: with `||` on a truthiness check, `profile: {}`,
`profile: 0`, `profile: ''`, `profile: false` are all non-null → both forms read
"usable" (truthy for the object; the old `!== null` form likewise true). The
space confirms no drift for every reachable shape. The one theoretically-diverging
branch (`!== null` true / truthy false) is not reachable for `0`/`''`/`false`
because the two forms differ only when a value is non-null-but-falsy **in the
rewrite direction**; both are `!== null` here, so there is no divergence at all.
Empty envelope, partial (any single section), and full all behave identically.

## 2. Probe is NOT vacuous (claim 1) — PASS

Probe read in full: `scripts/verify-runtime.ts:129–174` (`probeFundamentalsCache`),
asserted at `:467–474`. It calls the **real** `loadFundamentals` twice against a
throwaway SQLite db, stubbing only `fetchImpl` (cookie host `fc.yahoo.com`→404+Set-Cookie,
`/v1/test/getcrumb`→crumb, else→`CONTROL_QUOTE_SUMMARY`), and asserts
`first.source==='live' && second.source==='cache' && keyStats bytes identical && second.lastUpdated===first.lastUpdated && isUsableFundamentals(first)`.

Shipped code (real tree, unmutated):
```
✓ a fundamentals reply with real data is persisted … — probe first=live second=cache identical=true
```

**Mutation A — caching disabled** (`server/phase2-service.ts` scratch copy: the
`if (isUsableFundamentals(payload)) setKv(...)` call neutralised):
```
✗ … is persisted … — probe first=live second=live identical=true
✗ a second live fundamentals call is served from cache … — first=live second=live
✗ runtime verification FAILED — 94 passed, 2 failed   (exit 1)
```
**Mutation B — cache read disabled** (scratch: `if (false && !opts.force && fresh && cached)`):
```
✗ … is persisted … — probe first=live second=live
✗ a second live fundamentals call is served from cache … — first=live second=live
✗ runtime verification FAILED — 94 passed, 2 failed   (exit 1)
```
Both halves of the probe ("persists" and "serves from cache") are load-bearing:
either mutation turns both named checks red. The probe is non-vacuous.
Logs: `review-evidence/n5-qa/mutation-run.log`, `mutation-b-run.log`.

## 3. `verify:runtime` reliability (claim 3) — PASS

11 independent runs by me (1 timed + 10 sequential):

```
run 1: EXIT=0 | ✓ PASSED — 96 checks | skips=0 | probe first=live second=cache identical=true
… runs 2–10 identical …
TALLY: passes=10  nonzero=0  runs-with-skip=0
```
Every run: **exit 0, 96 checks, 0 failures, 0 skips**, probe deterministic
(`first=live second=cache identical=true`). Logs `verify-run-1..10.log`,
`runs-summary.txt`; ~2.3 s each.

## 4. Gates (claim 3) — PASS, and bundle is tree-reproducible (claim 2) — PASS

| Gate | Command | Result |
|---|---|---|
| Tests | `npm test` | **Test Files 11 passed (11) · Tests 207 passed (207)** (exit 0) |
| Lint | `npm run lint` | exit 0, 0 bytes output (clean) |
| Types | `npx tsc --noEmit` | exit 0, 0 bytes |
| Build | `npm run build` | exit 0, `✓ 67 modules transformed`, `dist/assets/index-XaYzCzND.js 525.14 kB` |
| Chart evidence | `npm run evidence:chart` | exit 0, `✓ PASSED — 82 checks`, 0 console errors/exceptions/failed requests |
| Runtime | `npm run verify:runtime` | 11/11 exit 0, 96 checks (above) |

**Bundle reproducibility.** I hashed `dist/assets/index-XaYzCzND.js` **before** my
build (`525143` bytes, md5 `0b9c294aa4336a237c94e785fc2f16cb`) and after my build
from the current tree — **identical name, size and md5**. It also matches my own
pre-N5 build log byte-for-byte (`review-evidence/qa-phase2-rerun/build.log:14`:
`index-XaYzCzND.js 525.14 kB`), i.e. N5 changed no shipped byte. Consistent with
the refactor being backend/verifier-only: `src/` never value-imports
`shared/fundamentals` (only type-only `FundamentalsPayload`), and `grep
isUsableFundamentals dist/assets/index-XaYzCzND.js` → 0. The bundle hash is
therefore *expected* to be unchanged, and it is. (Name change vs the earlier
`index-YuVqYQAN.js` in `qa-phase2-1435/build.log` predates N5 — it is the B1 fix.)

**New unit test** `tests/cacheability.test.ts` (5 tests) reviewed: pins the
cacheability contract offline — empty envelope false; any one real section true;
structurally-valid-but-fact-free ETF false; thin reply with one fact true;
unrecognised envelope false. Sound and directly on-point.

## 5. Is the SKIP honest? (does it hide a regression) — PASS

Dissection of the shipped branch (`scripts/verify-runtime.ts:476–489`):
```ts
const fundDocs = await get(`/api/fundamentals/${SYMBOL}`);   // reads existing cache, no network
if (f && isUsableFundamentals(f)) {
  check('a second live fundamentals call is served from cache …', fundDocs.data?.source === 'cache', …);
} else {
  skip('a second live fundamentals call is served from cache', `… "${f?.source}" with nothing usable …`);
}
```

**Skip reachability + honest accounting proven.** Mutation C (scratch: live route
path forced unavailable, probe path left intact) reproduced the cold-crumb state:
```
✓ a fundamentals reply with real data is persisted … — probe first=live second=cache
○ SKIP a second live fundamentals call is served from cache — the provider answered the first
   call "unavailable" with nothing usable …
✓ runtime verification PASSED — 93 checks, 1 skipped   (exit 0)
```
`skip()` (`:66–69`) increments a separate `skipped` counter and never touches
`passed`/`failures`; the summary prints `93 checks, 1 skipped` — counted neither
pass nor fail, and visible. That is the honest third state.

**The unconditional probe still catches "caching stopped working".** The probe
(`:467`) is *not* gated on anything — it always runs against a controlled
provider reply. Mutations A and B above demonstrate it reddens on both a
persist-regression and a read-regression. The SKIP cannot suppress that: it only
affects the second, *live* check, and it fires only when the live provider gave
nothing usable — precisely the case where the old assertion was already vacuous
(old code `… ? … : true` passed an `unavailable→unavailable` and spuriously failed
an `unavailable→live`). So the change strictly increases signal: no branch of the
new code is weaker than the old code on any input.

**Bonus: the skip is not dead code.** I re-ran my cold-crumb probe against the
live provider (8 trials): **2/8 `unavailable -> live`** (the old failing path)
**6/8 `live -> cache`** — the race is real, so the skip and the fix are both
exercised in practice, matching the coder's run-tally findings.

## 6. Residual caveat (non-blocking, documentation only)

`scripts/verify-runtime.ts:455` comment says the probe "goes through the real
route". It does **not** — `probeFundamentalsCache` calls `loadFundamentals`
directly, not through the Express HTTP route (`server/app.ts:129`). The
substance (real service, real SQLite cache, real parser, real crumb handshake)
is correct and is what the task asked for; only the word "route" overstates it.
The HTTP route path is still covered by the second (live) check, which does go
through `/api/fundamentals/:symbol`. No behaviour impact; a one-word doc nit if
the coder wants it exact.

Also noted for the record, not a defect: I could not find the *original* inline
expression in a local git history (the artifact is not a git repo) or a stored
copy of the prior file. Verification therefore rests on (a) the expression quoted
in the coder's write-up, (b) the identical expression quoted in my own prior
report §7, and (c) the mechanical 216-combination equivalence proof against the
shipped predicate. The two independent quotes agree, so the premise is solid;
flagging only that no pristine pre-refactor file copy exists to diff.

## 7. Evidence index (this run, all mine)

| File | What |
|---|---|
| `verify-run-1..10.log`, `runs-summary.txt` | 11 × `verify:runtime` (exit codes, check/skip counts, probe detail) |
| `mutation-run.log` | Mutation A (persist disabled) → both checks fail, exit 1 |
| `mutation-b-run.log` | Mutation B (cache read disabled) → both checks fail, exit 1 |
| `mutation-c-skip.log` | Mutation C (live unavailable) → probe passes, live check SKIPs, exit 0, `93 checks, 1 skipped` |
| `refactor-equivalence.ts` / `.log` | 216-combination proof: old inline ≡ `isUsableFundamentals` |
| `test.log`, `lint.log`, `tsc.log`, `build.log`, `evidence-chart.log` | gate output |
| `scratch/` | throwaway mutation copy of the tree (node_modules/dist symlinked to the real tree; **not** the artifact) |

## 8. Final word

**N5: CLOSED.** Refactor is provably behaviour-identical; the probe is
deterministic across 11/11 runs and non-vacuous under two independent mutations;
the skip is explicit, unreachable-as-pass/fail, and cannot mask a caching
regression; all gates green; the bundle rebuilds byte-identical from the current
tree. Only residual: the "real route" doc-comment overstatement (§6).
