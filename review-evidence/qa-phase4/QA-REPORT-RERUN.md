# Adversarial QA re-run — Phase 4 (Dividends) backend + UI

**Reviewer:** `debug-reviewer` subagent (independent; did not trust the builder report, the fix
descriptions, or the shipped tests)
**Date:** 2026-11-07
**Project root:** `/Users/love21/.openclaw/workspace/debug-coder/projects/stock-app`
**Scope:** Re-run the adversarial review of Phase 4 from scratch and try to **falsify** the claim
that Phase 4 dividends is now complete / honest / verified after two fix rounds.
**Predecessor:** `review-evidence/qa-phase4/QA-REPORT.md` (verdict **FAIL**, 5 defects).
**Nature of this review:** read-only on product code. **No product file was modified.** Mutation
testing was done on an APFS copy-on-write clone at `/tmp/qa-p4-rerun/mutant` (`cp -c -R`), never on
the product tree; `shared/dividends.ts` was verified byte-identical to its pre-mutation backup
(sha256 `3699c75e…febf7e`, identical in all three copies) after every mutation was restored. Probes
live under `tmp/qa-p4/` and `tmp/qa-p4-rerun/` (disposable). Port 8787 was left untouched; every
server used an ephemeral port 0.

## Verdict: **FAIL**

All **five** predecessor defects are genuinely fixed — I reproduced the fix for each from the live
app, not from the builder's description. But the fix for predecessor defect 3 was applied to *one
field of a payload family and not its sibling*, and the sibling ships a **100× wrong figure on every
LSE (GBp) name**. The screen's entire premise is "don't fabricate, label every figure" (§A.5/§A.8);
a §C.1 core figure that is off by 100× under the wrong currency unit is exactly the case §A.5
forbids. That single defect is the release gate.

| # | Severity | Status | Defect |
|---|----------|--------|--------|
| P1 | BLOCKING | ✅ **FIXED** | Duplicate §C.5 schedule row for the same Ex-Date |
| P2 | MAJOR | ✅ **FIXED** | Payable Date rendered before its own Ex-Date |
| P3 | MAJOR | ⚠️ **PARTIALLY FIXED** | "Upcoming" Amount reconciled; sibling **§C.1 Annual rate** still 100× wrong → see **N1** |
| P4 | MAJOR | ✅ **FIXED** | `consecutiveAnnualIncreases` counted non-contiguous years |
| P5 | MINOR | ✅ **FIXED** | `buildSchedule`'s de-dup path was dead code (now reachable & proven live) |
| **N1** | **BLOCKING (new)** | ❌ **OPEN** | **§C.1 "Annual rate" is 100× understated for GBp-quoted LSE names** (ULVR.L, BP.L, HSBA.L, VOD.L); same error propagates into the derived Forward yield |
| **N2** | MINOR (new) | ❌ **OPEN** | Schedule-level upcoming **monotonicity guard is unexercised / vacuous** — removing it is caught by neither probe nor shipped tests |

---

## Baseline gates — all green (run by QA, not read from a report)

| Gate | Result | Log |
|------|--------|-----|
| `npx tsc --noEmit` | exit 0 | `review-evidence/qa-phase4/rerun-artifacts/gate-tsc.log` |
| `npm run lint` | exit 0 | `…/rerun-artifacts/gate-lint.log` |
| `npm test` | **22 files / 449 tests passed**, exit 0 | `…/rerun-artifacts/gate-vitest.log` |
| `npm run build` | exit 0 | `…/rerun-artifacts/gate-build.log` |
| `npm run verify:runtime` | **178 checks PASSED** | `…/rerun-artifacts/gate-vr.log` |
| `npm run evidence:phase4` | **84 checks, 0 skipped, PASSED** | `…/rerun-artifacts/gate-ep4.log` |
| `npm run evidence:phase3` | **74 checks, 2 skipped, PASSED** | `…/rerun-artifacts/gate-ep3.log` |
| `npm run evidence:chart` | **82 checks PASSED** | `…/rerun-artifacts/gate-ec.log` |
| `npm run evidence:colour` | **35 checks PASSED** | `…/rerun-artifacts/gate-eco.log` |

The suite is materially stronger than at the last review (`evidence:phase4` grew 46 → 84 checks and
now asserts row-set coherence: no duplicate Ex-Date day, no PAY<EX, one unit per Amount column).
**It still passes with N1 live on the page it screenshots** — the §A.8 unit check is scoped to the
§C.5 Amount column and does not cover the §C.1 Annual-rate cell. That is a coverage hole, not a
runtime bug (see §N1 Repairs).

---

## Predecessor defects — re-verified, one by one

Every line below is output I produced this run; none is copied from a fix description.

### P1 — BLOCKING — duplicate §C.5 Ex-Date row → **FIXED**

```
$ npx tsx tmp/qa-p4/probe-19-rel2.mts
O  MAIN rows=384 same-day duplicates=none   HIST clean on all six spans
COST … AGNC … 0005.HK … AAPL … KO … MSFT … ULVR.L : same-day duplicates=none / clean on all six spans
```
→ `review-evidence/qa-phase4/rerun-artifacts/probe-19.out`

```
$ npx tsx tmp/qa-p4-rerun/probe-B-coherence.mts
PROBE-B: PASS — no duplicate Ex-Date day, no PAY<EX, one unit, both routes, six spans
```
→ `…/rerun-artifacts/probe-B.out` (exit 0)

The merge branch is **proven live**, not just present: `probe-J-merge.mts` shows that for O/COST/AGNC
exactly one row carries the payable and its Ex-Date is the *chart* timestamp
`2026-10-30T13:30:00.000Z` — i.e. the payable was stamped onto the existing chart row instead of a
second row being appended. → `…/rerun-artifacts/probe-J.out`.

Migration sensitivity confirmed on the mutant clone: under `m2_schedule_always_append`,
`evidence:phase4` **FAILS** (`✗ O 1y: no two §C.5 rows share an Ex-Date day — duplicate day(s):
2026-10-30`) — `…/rerun-artifacts/gate-mut.log`. The guard is load-bearing.

### P2 — MAJOR — Payable Date before its own Ex-Date → **FIXED**

```
$ npx tsx tmp/qa-p4-rerun/probe-C-nextpay.mts
PROBE-C: PASS — no facts-level PAY<=EX; withheld path exercised=true
```
→ `…/rerun-artifacts/probe-C.out` (exit 0)

`probe-D-dump.mts` shows AAPL now renders `nextPay=— (src=absent, note=note.dividendPayableBeforeEx)`
with `newestRow ex=2026-11-12 pay=—`. → `…/rerun-artifacts/probe-D.out`.

Fact-level guard verified at the seam with `probe-N-edge.mts` (deterministic, offline):
ex-date absent + payable present → `nextPay = — (note.dividendPayableBeforeEx)`; ex==pay same day →
same withholding; `upcomingPayment` with ex==pay returns `payDate:null`. → `…/rerun-artifacts/probe-N.out`.

Mutation sensitivity: under `m4_no_nextpay_guard`, `evidence:phase4` **FAILS**
(`✗ AAPL: the shown Payable Date is after the shown Ex-Date — ex=2026-11-12 pay=2026-08-13`) —
`…/rerun-artifacts/gate-mut.log`.

### P3 — MAJOR — "Upcoming" Amount in a different unit/scale → **PARTIALLY FIXED**

The original symptom is gone for the amount cells:
```
$ npx tsx tmp/qa-p4/probe-23-sched-ui.mts
0005.HK newest §C.5 row amount = 0.784088 HKD   (was 0.1 — the ×7.8 case)
ULVR.L newest §C.5 row amount = 39.07 GBp       (was 100× off)
facts.lastDividendValue: ULVR.L = 39.07 ; 0005.HK = null (note=note.dividendAmountScaleUnreconciled)
```
`reconcileLastDividend` (shared/dividends.ts:971) now rescales `lastDividendValue` to the chart
series unit, and withholds it (`—`) when the scale cannot be resolved.

**But the same payload family contains a second per-share amount — `annualRate` — that is *not*
reconciled and ships wrong.** That is the new defect N1 below. P3 is therefore only half closed.

### P4 — MAJOR — a 17-year suspension counted as an increase → **FIXED**

```
$ npx tsx tmp/qa-p4/probe-22-streak.mts
AAPL: code streak=13 honest contiguous streak=13 (fullYears 23, last 2025)
KO 23/23 · MSFT 20/20 · COST 21/21 · O 1/1
$ npx tsx tmp/qa-p4-rerun/probe-F-growth.mts
PROBE-F: PASS — streak is the contiguous-year streak; growth horizon is calendar-based
```
→ `…/rerun-artifacts/probe-22.out`, `probe-F.out` (exit 0)

Mutation `m1_streak_no_contiguity` (remove the contiguity guard) is caught by **both** probe-F and
the shipped tests (`1 failed | 62 passed`), and separately by `m7_growth_positional` — so both the
streak guard and the calendar-base growth horizon are load-bearing and covered.

### P5 — MINOR — dead de-dup path → **FIXED**

The `buildSchedule` day-merge branch (formerly unreachable because both callers passed
`nextPayDate=null`) is now executed on live data — see P1's `probe-J-merge.mts` evidence. A
deterministic check (`probe-N-edge.mts` case F) confirms `buildSchedule` appends **exactly one** row
when the upcoming payment falls on a fresh day. The prior "false-confidence" unit test is no longer
misleading, because the path is now live.

---

## N1 — BLOCKING (new) — §C.1 "Annual rate" is 100× understated on GBp-quoted LSE names

**Where.** `shared/dividends.ts`: `annualRate` is read verbatim from
`summaryDetail.dividendRate` (line **427`) and emitted as `direct(annualRate)` (line **480**) with
**no** unit reconciliation, while the same payload's `lastDividendValue` *is* reconciled by
`reconcileLastDividend` (line **971**, applied at line **1085**). The cell is rendered by
`src/dividend/sections.tsx:199` as `formatAmount(v, currency)`, so it is printed with the label
currency **`GBp`** even though the provider value is in **GBP**.

**Why it is wrong.** For LSE names Yahoo returns `summaryDetail.dividendRate` in **GBP** while quoting
the share in **pence** (SPEC-PHASE4 §A.5.1: "`ULVR.L` is quoted in **pence**"). §A.5: "when a unit
cannot be resolved, render `—` rather than a number off by 100×"; §A.8: "One unit per column … never
place a 100×-scaled … figure in the column."

**Minimal, deterministic reproduction (no network):**
```
$ npx tsx tmp/qa-p4-rerun/probe-M-annualrate.mts
parseDividendFacts(ULVR.L-shape):
  currency      = GBp
  annualRate    = 1.56            <-- provider field is in GBP, label is GBp
  lastDividend  = 0.3907          <-- provider field is in GBP

§C.1 export table rows (figure | value | basis):
  Annual rate               | 1.56 GBp       | As published
  Last dividend (per share) | 0.3907 GBp     | As published
```
→ `…/rerun-artifacts/probe-M.out`

The provider shape in that probe is the **exact live shape captured this run** (`probe-G-live-rate.mts`):
`summaryDetail.currency=GBp`, `dividendRate=1.56`, `dividendYield=0.0311`, `price=4930`,
chart `meta.currency=GBp`, `lastDividendValue=0.3907`, last 4 payments summing to `164.99 GBp`.
→ `…/rerun-artifacts/probe-G.out`

**Live UI (DOM), the figure the user actually sees:**
```
$ npx tsx tmp/qa-p4-rerun/probe-H-dom.mjs
### ULVR.L DOM
   §C.1 Currency       = GBp
   §C.1 Annual rate    = 1.56 GBp        <-- honest value ≈ 156 GBp
   §C.1 Last Dividend  = 39.07 GBp
   §C.5 newest row     = [ … "GBp" "39.07" "39.07" … ]
```
→ `…/rerun-artifacts/probe-H.out`

**Exported file, the figure the user downloads:**
```
$ npx tsx tmp/qa-p4-rerun/probe-I-export.mts
ULVR.L  Annual rate 1.56 GBp | Last Dividend 39.07 GBp | chart annual total 120.8000 GBp | ratio ×100 = 1.2914
BP.L    Annual rate 0.25 GBp | Last Dividend  8.66 GBp | chart annual total  25.0557 GBp | ratio ×100 = 0.9978
```
→ `…/rerun-artifacts/probe-I.out`

**Systemic over LSE names** (`probe-E-units.mts`, extended this run):
```
ULVR.L  1.56    (0.0129× its own series annual total)
BP.L    0.25    (0.0100×)
HSBA.L  0.3     (0.0054×)
VOD.L   0.04    (0.0102×)
```
→ `…/rerun-artifacts/probe-E.out`

**Second manifestation — the *derived* Forward yield inherits the same scale error** when the
provider's indicated yield is absent and the fallback path (`annualRate ÷ price`, line 452) runs:
```
$ npx tsx tmp/qa-p4-rerun/probe-O-forward.mts
indicated  = absent
forwardYld = 0.00031643002028397565 (0.0316%)   <-- annualRate(GBP) ÷ price(GBp)
honest forward (1.56 GBP = 156 GBp / 4930 GBp) = 3.164%
```
→ `…/rerun-artifacts/probe-O.out`. So the bug is not confined to one cell: it also corrupts a
*computed* metric whenever the indicated yield is missing.

**Concrete repair.** Route `annualRate` through the same unit resolution as `lastDividendValue`: when
`facts.currency` is a minor-unit quote (`GBp`, or any ×100 quote) and `summaryDetail.currency` is the
major unit, rescale `annualRate × 100` before display, or — if the scale cannot be resolved — show
`—` with a note, exactly as `note.dividendAmountScaleUnreconciled` already does for
`lastDividendValue`. The `deriveFrequency` arithmetic (line 455, `annualRate / lastDividendValue`)
must use fields in the *same* unit or it silently divides a GBP rate by a GBP value (which happens to
be correct today only because both are unreconciled — reconciling one and not the other will break it).
Add a `evidence:phase4` assertion on the `div-f-rate` / `div-recap-*` cells analogous to the §C.5
Amount-column check, and a `tests/dividends.test.ts` case with a GBp payload.

---

## N2 — MINOR (new) — the schedule-level upcoming **monotonicity guard is unexercised**

`probe-B-coherence.mts` passes, **and** `tests/dividends.test.ts` passes (63 tests), when the
schedule-level upcoming monotonicity guard is deleted (`m5_no_upcoming_monotonicity`):
```
applied m5_no_upcoming_monotonicity
  probe-B exit=0  PROBE-B: PASS
  shipped-tests exit=0  Tests 63 passed (63)
```
→ `…/rerun-artifacts/mutation-results2.txt`

The facts-level guard (P2's fix, `reconciledNextPayDate`) *is* exercised, so no user-visible defect
ships from this today; but the schedule-level guard is currently **vacuous** — nothing in the probe
suite or the shipped tests would notice its removal. It should either be covered by a synthetic
"calendar date on/before the chart day" case or removed so it is not mistaken for protection.

Reciprocal coverage gaps worth recording (from the same mutation run):
- `m6_no_upcoming_scale` (upcoming amount not scale-reconciled) is **not** caught by `probe-E`
  (exit 0) but **is** caught by the shipped tests (`2 failed | 61 passed`).
- `m3_no_scale_reconcile` (§C.1 last-dividend not reconciled) is caught by `probe-E` (exit 1) but
  **not** by the shipped tests (`63 passed`).

Neither gap ships a defect by itself; both show the probe suite and the shipped tests fail to cover
each other on the §A.8 unit rules — the same blind spot that let **N1** through.

---

## Secondary finding — LSE trailing yield disagrees with the same screen's own series (reported, not gated)

For GBp names the API's `summaryDetail.trailingAnnualDividendYield` is ~87× smaller than the
§C.2 chart's trailing-yield series shown on the same screen, while §C.1 prints it as-is. USD names
agree (ratio ≈ 1). `probe-R-crosssurf.mts`:
```
ULVR.L  ccy=GBp  indicated=3.110%  trailing=0.0375%  chartSeriesLast=3.3900%  trail/chart=0.011
BP.L    ccy=GBp  indicated=4.420%  trailing=0.0599%  chartSeriesLast=3.9900%  trail/chart=0.015
KO      ccy=USD  indicated=2.220%  trailing=2.1937%  chartSeriesLast=2.2300%  trail/chart=0.984
```
→ `…/rerun-artifacts/probe-R.out` (and `probe-P.out`, `probe-K.out` which show the *provider's*
`trailingAnnualDividendYield` itself — not our code — carries the same ~87× split vs its own
`timeseries.trailingDividendYield`).

This one is **provider-supplied**: `summaryDetail.trailingAnnualDividendYield = 0.00037480128` is the
upstream value (probe-K), so it is not a locally-introduced 100× error. But §A.5's rule — "when a unit
cannot be resolved, render `—` rather than a number off by 100×" — arguably applies to the *displayed*
§C.1 "Trailing yield (LTM)" cell when it contradicts the chart series on the same screen. I record it
as a finding needing an owner decision (reconcile / withhold / footnote), **not** as the release gate.

---

## What I verified and holds (no finding)

- i18n parity: `en` 841 keys ↔ `zh-HK` 841 keys, `auditDictionaries` reports **0 missing, 0 extra, 0
  placeholder mismatches, 0 double-suffix**; the 14 byte-identical values are all technical tokens
  (`chart.rsi`, `chart.macd`, `pf.*`), none are dividend copy. `note.dividendPayableBeforeEx` present
  in both. → `…/rerun-artifacts/probe-L.out`
- Non-payer honesty: for TSLA/BRK-B every yield figure renders `—` with the `note.dividendNoDividend`
  note; **no** literal `0%`/`0.00%` cell anywhere; `annualRate` cell renders `—`. → `…/rerun-artifacts/probe-24.out`.
- Empty-envelope path: ex-date absent + payable present → payable withheld; all facts `absent` with
  `note.dividendFactsUnavailable`; `reconcileLastDividend` on an absent field is a no-op preserving the
  note. → `…/rerun-artifacts/probe-N.out` cases A–D, G.
- Export coherence: building the export tables with the product's own `buildDividendTables` for
  O/COST/AGNC/0005.HK/AAPL/KO/MSFT/ULVR.L gives **0 duplicate Ex-Date days and 0 PAY<EX** across
  §C.5 and §C.6 — every §A.8 date rule holds in the exported file too. → `…/rerun-artifacts/probe-Q.out`
- Product tree untouched by this review: `shasum -a 256 shared/dividends.ts` == the pre-mutation
  backup, and the mutant clone was restored to the same hash after every mutation.

## Could NOT verify (and why)

- **Trailing-yield "honest" value on LSE names** — depends on whether the provider's
  `trailingAnnualDividendYield` or its `timeseries.trailingDividendYield` is authoritative; I could not
  establish which without an external ground truth, so N2's secondary finding states the *inconsistency*
  only, not which side is right.
- Long-horizon (`20y`/`ALL`) coherence for symbols the evidence suite does not ship (BP.L, HSBA.L,
  VOD.L) was checked only at the amount/rate level, not end-to-end in the browser.

## Authority / boundary notes

- Read-only on product code, as required. All probes are disposable and under `tmp/`; all saved
  artifacts are under `review-evidence/qa-phase4/rerun-artifacts/`. `projects/stock-analyzer` was never
  touched. Port 8787 was left alone.
- This review does not authorize changing the artifact. Repairs below should be requested through the
  coordinator (`agent:debug-debug_lead:main`).

## Recommended next step

Return to the coordinator with **N1 as the sole release gate**: §C.1 "Annual rate" (and the derived
Forward yield) must be unit-resolved for GBp-quoted LSE names before Phase 4 can be called complete.
Predecessor defects P1, P2, P4, P5 are verified fixed and should not be re-opened; P3 is closed only
for the amount cells and shares its repair with N1. N2 (vacuous monotonicity guard) and the trailing
yield inconsistency are recorded for a coverage/owner decision and do not by themselves block release.

### Artifact index (all under `review-evidence/qa-phase4/rerun-artifacts/`)

| Artifact | Proves |
|---|---|
| `gate-*.log` | tsc / lint / vitest / build / verify:runtime / evidence:phase3|4 / chart / colour |
| `gate-mut.log` | `evidence:phase4` fails under `m2` and `m4` (P1/P2 guards load-bearing) |
| `mutation-results.txt`, `mutation-results2.txt` | full mutation matrix vs probe-B/C/E/F and shipped tests |
| `probe-19.out`, `probe-B.out`, `probe-J.out` | P1 fixed + merge branch live |
| `probe-C.out`, `probe-D.out`, `probe-N.out` | P2 fixed + edge cases |
| `probe-22.out`, `probe-F.out` | P4 fixed |
| `probe-M.out` | **N1** deterministic minimal reproduction |
| `probe-G.out`, `probe-H.out`, `probe-I.out`, `probe-E.out` | **N1** live / DOM / export / systemic |
| `probe-O.out` | **N1** second manifestation (derived forward yield) |
| `probe-P.out`, `probe-K.out`, `probe-R.out` | LSE trailing-yield inconsistency (secondary) |
| `probe-L.out` | i18n parity |
| `probe-Q.out` | export §C.5/§C.6 coherence |
| `probe-24.out` | non-payer honesty (no literal 0% cells) |
