# Targeted re-QA #2 — Phase 4 (Dividends) — N1 rework

**Reviewer:** `debug-reviewer` subagent (independent; did not trust the fix description, the new tests, or the lead's probe)
**Date:** 2026-11-07
**Project root:** `/Users/love21/.openclaw/workspace/debug-coder/projects/stock-app`
**Trigger:** lead-reported N1 rework (series-sum reference → provider yield identity), declared the last gate before CLOSED.
**Predecessor:** `review-evidence/qa-phase4/QA-REPORT-N1.md` (verdict **FAIL**; N1 fix confirmed, R1 0005.HK regression + R2 coverage skip found).
**Change under review:** `shared/dividends.ts` sha256 `b05ae8796a06dc5f6c84b914068d6f45ae0d0113d9e9741305e3da2bf78ddaff` (confirmed equal to the lead-supplied hash; verified before and after every mutation).

**Nature:** read-only on product code. Mutation applied on an APFS clone at `/tmp/qa-n1r/mutant` (`cp -c -R`), never on the product tree; clone restored and both hashes re-verified after every mutation. Probes under `tmp/qa-n1/`; artifacts under `review-evidence/qa-phase4/n1-rerun-artifacts/`. Port 8787 left alone; every server used an ephemeral port (OS-assigned, e.g. 54049).

---

## Verdict: **PASS** — with three recorded follow-up findings (F1–F3, none blocking)

The rework is correct: 0005.HK shows `3.14 HKD` again, the LSE names are no longer 100× off, HSBA.L
is now reconciled to `30 GBp` instead of withheld, and **every** rendered Annual rate equals the
provider's own `price × indicated yield` identity. The full gate stack is green and
`evidence:phase4` is back to **88 checks, 0 skipped**. The fix is mutation-sensitive: deleting the
reconciliation fails the unit test, the evidence assertion, and my independent DOM probe.

I also found that the *evidence assertion* cannot detect an R1-class regression (it skips), and that
the "trust the raw figure" branch is an unfalsifiable latent hole on LSE names — both recorded below
as F1/F2. Neither is a user-visible defect in the shipped rework, and neither falsifies the four
requested gates.

| Item | Verdict |
|---|---|
| 1. Reproduce the rework live (LSE + same-unit names) | ✅ **Confirmed** |
| 2. Mutation-test the rework (break the identity reference) | ✅ **Caught** (unit test + evidence + DOM); restored |
| 3. No new regression (P1–P5, coherence, gate stack, 88/0 skipped) | ✅ **Confirmed** |
| 4. Re-run family audit for the GBP-vs-GBp hazard | ✅ No off-scale field |
| **F1** | ⚠️ evidence assertion is **vacuous on the R1-class regression** it was added for (skips, exit 0) |
| **F2** | ⚠️ "trust raw" branch emits a **100×-off** Annual rate on LSE names when `dividendYield` is absent (latent; not reachable on any sampled live symbol) |
| **F3** | ⚠️ the HKD test is **mislabeled**: the helper injects `price.currency='USD'`, so that test does not actually carry `HKD` into `parseDividendFacts` |

---

## Item 1 — rework independently reproduced

My own server on an **ephemeral port**, my own DOM probe (`probe-06-rework-dom.mjs`), comparing the
rendered §C.1 Annual rate against an independently recomputed `price × indicatedYield` from the API
payload:
```
$ node tmp/qa-n1/probe-06-rework-dom.mjs            # product tree, sha b05ae879…
server up at http://127.0.0.1:54049
ULVR.L   ccy=GBp  rate=156.00 GBp  last=39.07 GBp  ind=3.11%  identity=153.3230  rate/identity=1.0175
BP.L     ccy=GBp  rate=25.00 GBp   last=8.66 GBp   ind=4.42%  identity=24.7255   rate/identity=1.0111
VOD.L    ccy=GBp  rate=4.00 GBp    last=2.3625 GBp ind=3.33%  identity=3.8794    rate/identity=1.0311
HSBA.L   ccy=GBp  rate=30.00 GBp   last=10.00 GBp  ind=2.27%  identity=29.6144   rate/identity=1.0130
0005.HK  ccy=HKD  rate=3.14 HKD    last=—          ind=2.28%  identity=3.1350    rate/identity=1.0016
0700.HK  ccy=HKD  rate=5.30 HKD    last=—          ind=1.26%  identity=5.2895    rate/identity=1.0020
KO       ccy=USD  rate=2.12 USD    last=0.53 USD   ind=2.22%  identity=2.1239    rate/identity=0.9982
O        ccy=USD  rate=3.26 USD    last=0.272 USD  ind=5.52%  identity=3.2590    rate/identity=1.0003
AAPL     ccy=USD  rate=1.08 USD    last=0.27 USD   ind=0.32%  identity=1.0956    rate/identity=0.9858

REWORK-DOM: PASS — every rendered Annual rate matches price × indicated yield, or is honestly withheld
```
→ `n1-rerun-artifacts/probe-06-rework-dom.out`. **R1 is closed**: 0005.HK is `3.14 HKD` (was `—`).
HSBA.L is `30 GBp` (was withheld). Every LSE rate is within 4% of the yield identity (the residual is
the provider's own rate/yield rounding, not a unit error). All nine requested symbols selected
successfully — no silent skip.

## Item 2 — mutation-testing the rework

Mutation **B** — remove the reconciliation entirely (`annualReconciled = annualRate`, the pre-N1
behaviour). Clone sha `18ba919a1370d38f01f98a29baf1a87f67058105dbbc399dfa47e1483c193774`.

**(a) unit tests fail (2):** `npx vitest run tests/dividends.test.ts` →
`× reconciles a GBP annual rate onto the GBp series for an LSE name (N1)`,
`× reconciles an LSE rate whose series is inflated by a special (HSBA, N1)` — `2 failed | 66 passed`
→ `mut-B-unit-tests.log`

**(b) evidence assertion fails:** `npm run evidence:phase4` →
`✗ ULVR.L: the Annual rate shares the §C.5 Amount unit (not ~100x off) — annual=1.56 GBp vs column median 41.58 (ratio 0.038)`
`✗ phase 4 browser evidence FAILED — 87 passed, 1 failed` → `mut-B-evidence-phase4.log`

**(c) my DOM probe fails on all four LSE names** — verbatim:
```
=========== MUTATION B: reconciliation removed (raw direct(annualRate)) ===========
ULVR.L  rate=1.56 GBp   rate/identity=0.0102
BP.L    rate=0.25 GBp   rate/identity=0.0101
VOD.L   rate=0.04 GBp   rate/identity=0.0103
HSBA.L  rate=0.30 GBp   rate/identity=0.0101
0005.HK rate=3.14 HKD   (unchanged, correct)
KO/O/AAPL unchanged, correct
REWORK-DOM: FAIL  • ULVR.L • BP.L • VOD.L • HSBA.L
```
→ `mut-B-dom-before-after.log`. Gate exit **0 before**, **1 after**; clone restored, hash re-verified.
**The check is not vacuous.**

Mutation **C** — restore the old series-sum pathology (`[indicatedYield * price * 2.12]`). Over-withheld
**all nine** symbols (`rate=—` everywhere) and, notably, the evidence assertion then **passed
84 checks with 4 skipped (exit 0)** → `mut-C-evidence-phase4.log`. This is the vacuity in F1.

## Item 3 — no new regression

Predecessor probes, product tree, all exit 0:
```
probe-B-coherence  → PROBE-B: PASS — no duplicate Ex-Date day, no PAY<EX, one unit, both routes, six spans
probe-C-nextpay    → PROBE-C: PASS — no facts-level PAY<=EX; withheld path exercised=true
probe-F-growth     → PROBE-F: PASS — streak is the contiguous-year streak; growth horizon is calendar-based
probe-J-merge      → day-merge branch live (O ind/trail ratio 1.01)
probe-Q-export     → PROBE-Q: PASS — export §C.5/§C.6 obey §A.8 (no dup Ex-Date day, no PAY<EX)
probe-19-rel2      → 8/8 "same-day duplicates=none" across O/COST/AGNC/0005.HK/AAPL/KO/MSFT/ULVR.L
```
→ `n1-rerun-artifacts/reg-*.out`. `evidence/phase4/report.json`: coherence `[O,AAPL,0005.HK,ULVR.L]×{1y,5y}`
all `dupes:0 badPay:0`; units `O 3.26 USD (colMedian 0.263)`, `AAPL 1.08 USD (0.25)`,
`0005.HK 3.14 HKD (0.784)`, `ULVR.L 156.00 GBp (41.58)`.

### Full gate stack (product tree)
| Gate | Result | Log |
|---|---|---|
| `npx tsc --noEmit` | exit 0 | `n1-rerun-artifacts/gate-tsc.log` |
| `npm run lint` | exit 0 | `gate-lint.log` |
| `npm test` | **22 files / 454 tests passed** | `gate-vitest.log` |
| `npm run build` | exit 0 | `gate-build.log` |
| `npm run verify:runtime` | **175 checks, 1 skipped** | `gate-vr.log` |
| `npm run evidence:phase4` | **88 checks, 0 skipped, PASSED** | `gate-ep4.log` |
| `npm run evidence:phase3` | **76 checks, 0 skipped, PASSED** | `gate-ep3.log` |
| `npm run evidence:chart` | **82 checks PASSED** | `gate-ec.log` |
| `npm run evidence:colour` | **35 checks PASSED** | `gate-eco.log` |

`evidence:phase4` = **88 checks, 0 skipped** — matches the lead's claim and R2 is closed. The four
§C.1 unit-coherence checks (`O`, `AAPL`, `0005.HK`, `ULVR.L`) all report ✓.

**`verify:runtime` note (honest delta):** I measured **175 checks + 1 skipped**, not the lead's 178.
The skip is environmental, not a regression: the provider answered a live fundamentals call
"unavailable" this run, so `SKIP a second live fundamentals call is served from cache — … nothing was
cached to read from`. The same script reported 178 on my previous run; the delta is the provider's
session behaviour, and the skipped check is covered by a controlled path. No gate is failing.

## Item 4 — family re-audit (GBP-vs-GBp hazard)

Live dump, product tree, ephemeral port (`probe-02-family.mts`):
```
ULVR.L  annualRate 156 GBp (0.976x)   lastDividendValue 39.07 GBp (0.964x)  fiveYearAvgYield 0.0355  payoutRatioLtm 0.4617
BP.L    annualRate 25 GBp  (0.741x)   lastDividendValue 8.66 GBp  (1.388x)  fiveYearAvgYield 0.0468
VOD.L   annualRate 4 GBp   (0.681x)   lastDividendValue 2.3625 GBp(1.198x)  fiveYearAvgYield 0.062
HSBA.L  annualRate 30 GBp  (0.475x)   lastDividendValue 10 GBp    (1.336x)  fiveYearAvgYield 0.0476
KO      annualRate 2.12 USD(0.806x)   lastDividendValue 0.53 USD  (1.000x)
O       annualRate 3.26 USD(0.926x)   lastDividendValue 0.272 USD (1.004x)
```
→ `n1-rerun-artifacts/probe-02-family.out`. **No field is off-scale.**

| Field | Source | Verdict |
|---|---|---|
| `annualRate` | `summaryDetail.dividendRate` | ✅ reconciled via the yield identity for LSE; same-unit names untouched; = `price × yield` |
| `lastDividendValue` | `defaultKeyStatistics.lastDividendValue` | ✅ reconciled (`note.dividendAmountScaleUnreconciled` on the ×100 rescale) |
| `trailingAnnualDividendRate` | `summaryDetail.trailingAnnualDividendRate` | ✅ used only as the `payoutRatio` cross-check reference; not rendered, no unit hazard introduced |
| `fiveYearAvgYield` | `summaryDetail.fiveYearAvgDividendYield` | ✅ correctly ÷100 (raw 3.55 → 0.0355) |
| `payoutRatio` | `summaryDetail.payoutRatio`, `normalizeRatio` | ✅ unit-normalised; `—` on BP.L (provider absent) |
| `indicatedYield` / `forwardYield` | `dividendYield`; reconciled rate ÷ price | ✅ same-unit fractions; forward = indicated (or reconciled rate ÷ price) |
| `trailingYield` | `summaryDetail.trailingAnnualDividendYield` | ⚠️ provider-supplied ~87× cross-surface discrepancy (pre-existing; already reported in QA-REPORT-N1; not a local unit error) |

---

## Findings (non-blocking)

### F1 — the evidence assertion cannot detect an R1-class regression (it skips, exit 0)
The assertion compares the rendered Annual rate to the §C.5 Amount-column median, and **skips when the
rate cell is a dash**. The R1 symptom *is* the rate cell becoming a dash, so a rework that re-withholds
the same-unit names passes the gate vacuously. Mutation **D′** (withhold 0005.HK only, keyed on
`summaryDetail.currency === 'HKD'`) reproduces exactly R1, and:
```
$ npm run evidence:phase4            # mutant D′ (sha e02aee46…)
  ✓ O … ✓ AAPL … ~ skipped 0005.HK: Annual-rate unit coherence — rate cell is the dash or the column is empty
  ✓ ULVR.L …  ✓ phase 4 browser evidence PASSED — 87 checks, 1 skipped    (exit 0)
$ npx vitest run tests/dividends.test.ts
  × leaves a same-unit (HKD) annual rate untouched — no false `—` (R1 regression)   1 failed | 67 passed
```
→ `n1-rerun-artifacts/mut-Dprime-evidence-phase4.log`, `mut-Dprime-unit-tests.log`.
**So R2's guarantee ("0005.HK covered again, 0 skipped") holds only while the code is correct — the
gate does not *catch* the regression it was written for.** The shipped **unit test does** catch it, so
the shipped build is protected; the evidence gate is the gap. Suggested hardening: assert that each
`COHERENCE_SYMBOLS` Annual-rate cell is a **non-dash** (an emitted `—` on a known payer is itself the
failure), rather than skipping.

### F2 — the "trust raw" branch is an unfalsifiable latent 100× hole on LSE names
When no `dividendYield` reference is available the rework passes the raw `dividendRate` through
(`hasYieldRef ? reconcileScale(...) : annualRate`, `shared/dividends.ts:449–451`). For an LSE
(GBp-quoted) 100%-payer that raw value is GBP, so it renders 100× small again — deterministically:
```
$ npx tsx tmp/qa-n1/probe-07-trust.mts
(a) LSE shape, dividendYield ABSENT:
    annualRate   = {"value":1.56,"source":"direct"}        <-- 100x off, no note
    forwardYield = {"value":0.00031643002028397565,...}    <-- 0.03% instead of ~3.16%
```
→ `n1-rerun-artifacts/probe-07-trust.out`. The shipped test
`trusts the raw annual rate when there is no like-for-like reference (no yield)` enshrines this.
**Reachability:** I sampled 14 LSE names (ULVR.L, BP.L, VOD.L, HSBA.L, SHEL.L, AZN.L, GSK.L, BATS.L,
LGEN.L, TSCO.L, BA.L, RR.L, IAG.L; RDS.L returned no result) — **every** one carries both
`dividendRate` and a positive `dividendYield`, so the branch is **not reachable on any sampled live
symbol today**. It is a latent hole, not a live defect; a stricter rule (withhold on a minor-unit quote
when the identity is unavailable) would close it at the cost of one more `—`.

### F3 — the "(HKD)" test does not actually test HKD (test hygiene)
`tests/dividends.test.ts:82` builds its envelope as
`{ price: { currency: 'USD' }, ...modules }`, and `parseDividendFacts` reads
`price.currency` **before** `summaryDetail.currency`. So the test named
`leaves a same-unit (HKD) annual rate untouched` runs with `currency === 'USD'`; only the
`summaryDetail.currency: 'HKD'` literal (never read) carries the label. Verified: mutation D keyed on
`currency==='HKD'` left all 68 tests passing, while D′ keyed on `summaryDetail.currency` failed the
HKD test (`mut-Dprime-*`). The test does still pin the *value* `3.14` (same-unit no-withhold), so it is
not useless — but R1's real discriminator is `summaryDetail.currency`/the quote unit, and no test
exercises that field. Low impact; worth correcting the helper or the test name so HK coverage is not
over-trusted.

---

## Residual uncertainty
- **`trailingYield` provider discrepancy** (ULVR.L trailing 0.0375% vs its chart series 3.39%) is
  unchanged and still needs an owner decision (reconcile / withhold / footnote). Reported before; not a
  regression from this rework.
- **`verify:runtime` 175+1 vs the lead's 178** — I attribute the delta to a provider "unavailable"
  response this run, not a code change, but I did not force a second live fundamentals call to make the
  count reproduce.
- **F2 reachability** is bounded to the 14 LSE symbols I sampled; a 100%-payer LSE name whose
  `dividendYield` is dropped by the provider would reach it.

## Boundary notes
Read-only on product code; no commit, no publish; `projects/stock-analyzer` never touched; port 8787
left alone. All mutations confined to `/tmp/qa-n1r/mutant` and restored (hashes re-verified). All
artifacts under `review-evidence/qa-phase4/`.

## Recommended next step
Return to the coordinator: **the rework passes and N1/R1/R2 are genuinely closed on the shipped build
— do not re-open them.** Record F1 (evidence gate skips on an R1-class regression) and F2 (latent
100× on the no-yield LSE path) as follow-up tickets; neither blocks CLOSED because the shipped unit
tests cover F1 and F2's precondition is unreachable on every sampled live symbol. Optionally fix F3.

### Artifact index (`review-evidence/qa-phase4/n1-rerun-artifacts/`)
| Artifact | Proves |
|---|---|
| `probe-06-rework-dom.out` | Item 1/3: live DOM, every rate = `price × yield`; R1/R2 closed |
| `probe-02-family.out`, `probe-07-trust.out` | Item 4 family audit; F2 latent branch |
| `mut-B-dom-before-after.log`, `mut-B-unit-tests.log`, `mut-B-evidence-phase4.log` | Item 2: mutation caught (verbatim before/after) |
| `mut-C-*.log` | mutation C over-withholds; evidence passes 84/4-skipped (vacuous) |
| `mut-Dprime-*.log` | F1: R1-class regression passes the evidence gate (0 skipped→1), caught only by the unit test |
| `gate-*.log` | full green stack (ep4 = 88 checks, 0 skipped; vr = 175 + 1 skipped) |
| `reg-*.out` | P1–P5 + §C.5/§C.6 coherence re-verified |
| `probes/` | probe sources (probe-06/07/02) for self-contained re-run |
