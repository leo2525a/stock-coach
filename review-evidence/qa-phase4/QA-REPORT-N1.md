# Targeted re-QA — Phase 4 (Dividends) — N1 fix

**Reviewer:** `debug-reviewer` subagent (independent; did not trust the fix description or the new tests)
**Date:** 2026-11-07
**Project root:** `/Users/love21/.openclaw/workspace/debug-coder/projects/stock-app`
**Trigger:** lead-reported N1 fix (GBP→GBp annual-rate reconciliation) — declared the last gate before CLOSED.
**Predecessor:** `review-evidence/qa-phase4/QA-REPORT-RERUN.md` (verdict **FAIL**, N1 blocking).
**Change under review:** `shared/dividends.ts` sha256 `43464150b0b0b5f66ff8d60a4be914f791d36d80b88a3a75af6dfc91952a5841` (confirmed equal to the lead-supplied hash).

**Nature:** read-only on product code. No product file was modified. Mutation was applied on an APFS
copy-on-write clone at `/tmp/qa-n1/mutant` (`cp -c -R`), never on the product tree; after every
mutation the clone was restored and both `shared/dividends.ts` hashes re-verified equal to
`43464150…52841`. Probes live under `tmp/qa-n1/`; all artifacts saved under
`review-evidence/qa-phase4/n1-artifacts/`. Port 8787 was left alone; every server used an ephemeral
port (`8791`, or an OS-assigned free port).

---

## Verdict: **FAIL**

**The N1 fix itself is correct and mutation-sensitive** — I reproduced the GBp correction live for
ULVR.L / BP.L / VOD.L, the honest `—` withholding for HSBA.L, and the unchanged USD control (KO);
deleting the fix fails both the new unit test and the new evidence assertion. That item passes.

**But the fix over-reaches, and it regresses a correct figure on 0005.HK.** `reconcileScale` — a
*GBP-vs-GBp* 2×-plausibility gate that compares the field against the chart's stored-event sum — was
applied unconditionally to `annualRate`, including for **same-unit** symbols. For 0005.HK (HKD = HKD,
no unit hazard at all) the provider annual figure `3.14 HKD` — exactly consistent with its own
`dividendYield × price` — now renders **`—`**. A figure whose unit is fully resolved is being
withheld, which §A.5 does not license. Because 0005.HK is in the evidence suite's
`COHERENCE_SYMBOLS`, the new assertion also **skips** it (`93` → the HK fractional case loses
coverage) rather than covering it.

| # | Item | Verdict |
|---|------|---------|
| N1 | §C.1 Annual rate GBP→GBp for LSE names | ✅ **FIXED, mutation-sensitive** (ULVR.L 156, BP.L 25, VOD.L 4, HSBA.L `—`, KO 2.12) |
| **R1** | **N1 regression: 0005.HK §C.1 Annual rate `3.14 HKD` → `—`** (same-unit field wrongly withheld) | ❌ **NEW** |
| **R2** | **N1 evidence assertion skips 0005.HK** — the HK fractional case loses coverage | ❌ **NEW (coverage)** |
| R3 | `reconcileScale` divisor mismatch (chart event sum ÷ payment-count vs provider annual) is the mechanism behind R1 | ❌ **NEW (root cause of R1)** |
| Item 2 | Audit of the rest of the `DividendFacts` family for the GBP hazard | ✅ No off-scale field remains |
| Item 3 | No regression on P1–P5 or §C.5/§C.6 coherence | ✅ Confirmed |

---

## Item 1 — N1 fix: independently reproduced

Live rendered §C.1 cells, my own server on **ephemeral port 8791**, my own DOM probe
(`probe-01-dom.mjs`, product tree):

```
$ node tmp/qa-n1/probe-01-dom.mjs          # product tree, sha 43464150…
server up at http://127.0.0.1:8791
ULVR.L   ccy=GBp | rate=156.00 GBp last=39.07 GBp ratio=3.993 | ind=3.11% trail=0.04% fwd=3.11%計算值 | apiRate={"value":156,"source":"direct","note":"note.dividendAmountScaleUnreconciled"} ttm=159.870
BP.L     ccy=GBp | rate=25.00 GBp last=8.66 GBp ratio=2.887 | ... apiRate={"value":25,"source":"direct","note":"note.dividendAmountScaleUnreconciled"} ttm=33.716
VOD.L    ccy=GBp | rate=4.00 GBp last=2.3625 GBp ratio=1.693 | ... apiRate={"value":4,"source":"direct","note":"note.dividendAmountScaleUnreconciled"} ttm=5.877
HSBA.L   ccy=GBp | rate=— last=10.00 GBp ratio=withheld | ... apiRate={"value":null,"source":"absent","note":"note.dividendAmountScaleUnreconciled"} ttm=63.159
KO       ccy=USD | rate=2.12 USD last=0.53 USD ratio=4.000 | ... apiRate={"value":2.12,"source":"direct"} ttm=2.630

N1-DOM: PASS — no Annual-rate cell ~100x below a single payment
```
→ `n1-artifacts/probe-01-dom.out`. Every value matches the lead's claim (ULVR.L 1.56→156, BP.L
0.25→25, VOD.L 0.04→4, HSBA.L withheld, KO unchanged). **Not falsified.**

### Mutation — the check is *not* vacuous

Mutation applied on the clone: restore `annualRate: … direct(annualRate)` and derive the forward
yield from the **raw** `annualRate` (i.e. exactly the pre-N1 code). Clone sha became
`cc18518d5457677810128b04c7d9877780a322a3fc0169bf9952d6ba5d9577e5`.

**(a) the new unit tests fail (3 of them):**
```
$ npx vitest run tests/dividends.test.ts            # mutant clone
× reconciles a GBP annual rate onto the GBp series for an LSE name (N1)
× withholds the annual rate rather than show it 100x off when the scale cannot be resolved (N1)
× derives the forward yield from the reconciled annual rate, not the raw GBP figure (N1)
 Test Files  1 failed (1)   Tests  3 failed | 64 passed (67)
```
→ `n1-artifacts/mut-01-unit-tests.log`

**(b) the new `evidence:phase4` assertion fails:**
```
$ npm run evidence:phase4                            # mutant clone (after rebuilding dist)
✓ O: the Annual rate is not ~100x below a single payment (unit coherence)
✓ AAPL: …            ✗ ULVR.L: the Annual rate is not ~100x below a single payment (unit coherence)
                       — annual=1.56 GBp last=39.07 GBp (ratio 0.040)
✗ phase 4 browser evidence FAILED — 86 passed, 1 failed
```
→ `n1-artifacts/mut-02-evidence-phase4.log`

**(c) my independent DOM probe fails on all four LSE names** — verbatim before/after:
```
### BEFORE mutation (product tree, sha 43464150…)
ULVR.L  rate=156.00 GBp  ratio=3.993   …   N1-DOM: PASS
BP.L    rate=25.00 GBp   VOD.L rate=4.00 GBp   HSBA.L rate=—
### AFTER mutation (raw direct(annualRate) + raw forward yield, sha cc18518d…)
ULVR.L  rate=1.56 GBp    ratio=0.040
BP.L    rate=0.25 GBp    VOD.L rate=0.04 GBp   HSBA.L rate=0.30 GBp
N1-DOM: FAIL  • ULVR.L • BP.L • VOD.L • HSBA.L
```
→ `n1-artifacts/mut-03-dom-before-after.log` (full verbatim).

Gate exit was **0 before** the mutation and **1 after**; clone restored, hash re-verified.

---

## R1 — N1 regression: 0005.HK §C.1 "Annual rate" went from a correct figure to `—`

**Before N1** (my own prior artifact, `review-evidence/qa-phase4/rerun-artifacts/probe-H.out`):
```
### 0005.HK DOM §C.1 / §C.5
   §C.1 Annual rate    = 3.14 HKD
   §C.5 newest row     = ["—","2026-11-05 HKT","—","—","HKD","0.784","0.784","—","—"]
```
**After N1** (this run):
```
$ npx tsx tmp/qa-n1/probe-03-0005.mts
currency          = HKD
annualRate        = {"value":null,"source":"absent","note":"note.dividendAmountScaleUnreconciled"}
reconcileScale(3.14, [ttm]) = null
trailingAnnualTotal(events) = [ 6.65190004 ]
```
→ `n1-artifacts/probe-03-0005-hk.out`

**The withheld figure is correct, and not a unit hazard.** Raw provider fields for 0005.HK
(`probe-04c.mts`):
```
summaryDetail.currency = HKD | price.currency = HKD | price = 137.5
dividendRate = 3.14 | dividendYield = 0.0228
ratio dividendRate/price = 0.022836363636363637
```
→ `n1-artifacts/probe-04-raw-fields.out`. The chart currency is also HKD, and
`137.5 × 0.0228 = 3.135` — i.e. the raw `3.14 HKD` is exactly the provider's own annual figure in the
chart's own unit. There is **no GBP-vs-GBp hazard here**; §A.5's `—`-rule ("when a unit cannot be
resolved") does not apply, because the unit *is* resolved. The screen now suppresses a correct,
useful figure.

**Root cause (R3).** The N1 change reuses `reconcileScale(annualRate, annualReference)` where
`annualReference = trailingAnnualTotal(events)` is a **trailing-12m sum** (a divisor already
multiplied by the payments-per-year), while `amount` is an **annual rate**. `reconcileScale`
(line 741) compares `amount / median(reference)` against `{1, 100, 0.01}`:
```
reconcileScale(3.14, [6.6519]) = null      # 3.14/6.6519 = 0.47 → outside the 0.5–2 band
```
`0005.HK`'s stored chart events include an outsized/interim set (TTM sum 6.65 vs provider annual
3.14 → 0.47×), so the plausibility gate rejects a field that was never off-scale. For the LSE names
this mismatch is invisible because the dominant error is a clean ×100 (ULVR.L 156/159.87 = 0.98,
BP.L 0.74, VOD.L 0.68 — inside or rescued by the ×100 branch), so the fix helps them and only the
same-unit fractional case is penalised.

Minimal reproduction (no network):
```
$ npx tsx -e "import {reconcileScale} from './shared/dividends.ts'; console.log(reconcileScale(3.14,[6.6519]))"
null
```

**Repair options** (for the coder via the coordinator — I am not changing the artifact):
1. Only reconcile when a *unit hazard is actually present*: gate on the label/quote being a
   minor-unit quote (`GBp`, or `summaryDetail.currency !== price.currency`), and otherwise pass the
   raw `annualRate` through unchanged. This targets exactly the LSE case N1 was about.
2. Or compare like for like: divide the annual reference by the derived payments-per-year before the
   plausibility test, so a same-unit field with a matching annual aggregate is not rejected.
3. Or keep the current gate but treat "no factor lands" on a **same-unit** symbol as "trust the raw
   field" rather than "withhold".

---

## R2 — the new evidence assertion skips 0005.HK (coverage erosion)

`0005.HK` is one of the `COHERENCE_SYMBOLS` and was an original defect-3 symbol. Its §C.1 Annual-rate
cell is now `—`, so the new check falls into its `else` branch and **skips**:
```
$ grep -E "Annual rate is not|skipped" n1-artifacts/gate-ep4.log
✓ O: the Annual rate is not ~100x below a single payment (unit coherence)
✓ AAPL: …
~ skipped 0005.HK: Annual-rate unit coherence — rate or last cell is the dash
✓ ULVR.L: …
✓ phase 4 browser evidence PASSED — 87 checks, 1 skipped
```
→ `n1-artifacts/gate-ep4.log`. Net effect of the N1 change on coverage: the suite grew from
`84 checks, 0 skipped` to `87 checks, 1 skipped`, but the one newly-skipped symbol is precisely the
HK fractional case. The assertion is sound; it is the R1 withholding that removes its subject.

---

## Item 2 — audit of the rest of the `DividendFacts` family for the GBP-vs-GBp hazard

Live family dump, product tree, ephemeral port (`probe-02-family.mts`): each non-yield *amount*
field compared against the chart series' own scale.
```
=== ULVR.L  label ccy=GBp  chart meta ccy=GBp ===
  last4=40.52,40.46,39.82,39.07  trailing-12m sum=159.870  per-payment median=40.52
  annualRate         = 156 GBp        → consistent (0.976x ref)
  lastDividendValue  = 39.07 GBp      → consistent (0.964x ref)
=== BP.L   annualRate 25 GBp (0.741x)   lastDividendValue 8.66 GBp (1.388x)
=== VOD.L  annualRate 4 GBp  (0.681x)   lastDividendValue 2.3625 GBp (1.198x)
=== HSBA.L annualRate — (withheld)      lastDividendValue 10 GBp (1.336x)
=== KO     annualRate 2.12 USD (0.806x) lastDividendValue 0.53 USD (1.000x)
=== O      annualRate 3.26 USD (0.926x) lastDividendValue 0.272 USD (1.004x)
```
→ `n1-artifacts/probe-02-family.out`. **No per-year / per-payment amount field is still off-scale.**

Field-by-field verdict for the hazard the lead asked about:

| Field | Source | Verdict on GBp names |
|---|---|---|
| `indicatedYield` | `summaryDetail.dividendYield` | ✅ same-unit fraction (0.0311); rendered as % — no pence/pound ratio applies |
| `trailingYield` | `summaryDetail.trailingAnnualDividendYield` | ⚠️ **provider-supplied discrepancy**, see below — not a local 100× error and unchanged by N1 |
| `forwardYield` | indicated, or `annualRate÷price` | ✅ N1 fixed the fallback to use the reconciled rate (ULVR.L now 3.11%, was 0.0316%) |
| `payoutRatioLtm` | `summaryDetail.payoutRatio`, normalised | ⚠️ 0005.HK renders `—`; see "not attributed to N1" below |
| `fiveYearAvgYield` | `summaryDetail.fiveYearAvgDividendYield` | ✅ correctly ÷100 (SPEC §A.5): raw 3.55 → 0.0355 |
| `lastDividendValue` | `defaultKeyStatistics.lastDividendValue` | ✅ reconciled (39.07 GBp for ULVR.L); 0005.HK withheld |
| `annualRate` | `summaryDetail.dividendRate` | ✅ **now** reconciled for LSE (this fix); ⚠️ **over-withheld for 0005.HK (R1)** |

**`trailingYield` (unchanged by N1, restated for completeness).** On GBp names the API's
`summaryDetail.trailingAnnualDividendYield` is ~87× below the same screen's chart trailing-yield
series (ULVR.L 0.0375% vs 3.39%; KO 2.19% vs 2.23%). This is the *provider's own* value (raw
`0.00037480128`), so it is not a local 100× bug; it is a genuine cross-surface inconsistency that
predates and is untouched by N1. Recorded, not gated.

**`payoutRatioLtm` on 0005.HK (`—`) — explicitly NOT attributed to N1.** The N1 change touched only
`annualRate` and the forward-yield fallback (lines 447, 460, 489–497); `payoutRatioLtm` is a separate
branch. I did not verify when it began withholding, so I report it as an open observation, not a N1
finding, and did not gate on it.

---

## Item 3 — no regression on the earlier fixes / coherence

Re-ran the predecessor probes on the product tree (all exit 0):
```
$ npx tsx tmp/qa-p4-rerun/probe-B-coherence.mts → PROBE-B: PASS — no duplicate Ex-Date day, no PAY<EX, one unit, both routes, six spans
$ npx tsx tmp/qa-p4-rerun/probe-C-nextpay.mts   → PROBE-C: PASS — no facts-level PAY<=EX; withheld path exercised=false
$ npx tsx tmp/qa-p4-rerun/probe-F-growth.mts    → PROBE-F: PASS — streak is the contiguous-year streak; growth horizon is calendar-based
$ npx tsx tmp/qa-p4-rerun/probe-J-merge.mts     → KO ind/trail ratio 1.01, O ratio 1.01 (day-merge branch still live)
$ npx tsx tmp/qa-p4-rerun/probe-Q-export.mts    → PROBE-Q: PASS — export §C.5/§C.6 obey §A.8
      ULVR.L §C.5 rows=104 exDup=0 | §C.6 nextEx=2026-11-12 nextPay=— | §C.1 annualRate=156.00 GBp lastDiv=39.07 GBp
$ npx tsx tmp/qa-p4/probe-19-rel2.mts           → 8/8 "same-day duplicates=none", 8/8 "clean on all six spans"
```
→ `n1-artifacts/reg-*.out`. P1 (no duplicate Ex-Date), P2 (no PAY<EX), P4 (contiguous streak), P5
(day-merge live) and §C.5/§C.6 coherence all still hold; the export table now carries the corrected
`156.00 GBp` annual rate with `exDup=0`.

`evidence/phase4/report.json` coherence rows: O/AAPL/0005.HK/ULVR.L × {1y,5y} all `dupes:0 badPay:0`.
Unit rows: O `3.26 USD`/`0.272 USD`; AAPL `1.08 USD`/`0.27 USD`; ULVR.L `156.00 GBp`/`39.07 GBp`;
0005.HK `—`/`—` (R1).

### Full gate stack (product tree, all green)
| Gate | Result | Log |
|---|---|---|
| `npx tsc --noEmit` | exit 0 | `n1-artifacts/gate-tsc.log` |
| `npm run lint` | exit 0 | `gate-lint.log` |
| `npm test` | **22 files / 453 tests passed** | `gate-vitest.log` |
| `npm run build` | exit 0 | `gate-build.log` |
| `npm run verify:runtime` | **178 checks PASSED** | `gate-vr.log` |
| `npm run evidence:phase4` | **87 checks, 1 skipped, PASSED** | `gate-ep4.log` |
| `npm run evidence:phase3` | **76 checks, 0 skipped, PASSED** | `gate-ep3.log` |
| `npm run evidence:chart` | **82 checks PASSED** | `gate-ec.log` |
| `npm run evidence:colour` | **35 checks PASSED** | `gate-eco.log` |

---

## Residual uncertainty

- **The "correct" 0005.HK annual figure depends on provider intent.** I assert `3.14 HKD` is honest
  because it equals `price × dividendYield` in the chart's own currency; if the team believes the
  trailing-12m chart sum is authoritative over `summaryDetail.dividendRate` for HK names, R1 becomes a
  *documentation* question rather than a defect — but either way the §A.5 `—`-rule is not satisfied by
  "the unit is unresolved", because HKD = HKD.
- **`payoutRatioLtm` withholding on 0005.HK** (observed `—`) was not attributed or bisected — it
  predates N1 in my checks but I did not confirm the introducing change.
- **`m5_no_upcoming_monotonicity`** (the vacuous schedule-level guard flagged in the prior report) was
  **not** re-tested this round; it is out of N1's scope and remains as previously reported.
- I selected symbols via the app's own watchlist/DOM flow; all five requested symbols selected
  successfully this run (no silent skip).

## Boundary notes

Read-only on product code; no commit, no publish; `projects/stock-analyzer` never touched; port 8787
left alone. Mutation confined to `/tmp/qa-n1/mutant` and restored (hashes re-verified). All artifacts
are under `review-evidence/qa-phase4/`.

## Recommended next step

Return to the coordinator. **N1 is genuinely fixed for the LSE names and the fix is mutation-sensitive
— do not re-open it.** But **R1 blocks CLOSED**: the same change withdraws a correct `3.14 HKD`
Annual-rate figure on 0005.HK and skips its evidence check (R2), because a GBP-vs-GBp plausibility
gate is applied to a same-unit field (R3). Scope the reconciliation to actual unit hazards (option 1
above) and re-run; coverage for 0005.HK should return to `0 skipped`.

### Artifact index (`review-evidence/qa-phase4/n1-artifacts/`)

| Artifact | Proves |
|---|---|
| `probe-01-dom.out`, `probe-02-family.out`, `probe-03-0005-hk.out`, `probe-04-raw-fields.out`, `probe-05-frequency.out` | N1 live; family audit; R1; raw provider fields; frequency unaffected |
| `mut-03-dom-before-after.log` | **verbatim before/after mutation DOM output** |
| `mut-01-unit-tests.log`, `mut-02-evidence-phase4.log`, `mut-00*.log` | mutation fails the unit tests + evidence assertion; build logs |
| `gate-*.log` | full green gate stack (ep4 = 87 checks, 1 skipped) |
| `reg-*.out` | P1–P5 + §C.5/§C.6 coherence re-verified |
| `probes/` | probe sources for self-contained re-run |
