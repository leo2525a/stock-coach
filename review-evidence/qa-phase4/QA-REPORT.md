# Adversarial QA — Phase 4 (Dividends) backend + UI

**Reviewer:** `debug-reviewer` subagent (independent; did not trust builder report or its tests)
**Date:** 2026-11-07
**Project root:** `/Users/love21/.openclaw/workspace/debug-coder/projects/stock-app`
**Scope:** Falsify the claim that Phase 4 dividends is complete / honest / verified.
**Nature of this review:** read-only on product code. No product file was modified. Probes live under `tmp/qa-p4/` and are disposable.

## Verdict: **FAIL**

The build is green and most of Phase 4 is genuinely honest and well-built — but **five user-visible honesty defects ship**, two of them
reproduce on every route and every span for real symbols, and the Phase-4 evidence suite passes despite them. A dividends screen
whose entire value proposition is "don't fabricate, label everything" cannot ship with a duplicated payout row and a Payable Date
that precedes its own Ex-Date.

| # | Severity | Defect | Ships on |
|---|----------|--------|----------|
| 1 | **BLOCKING** | Duplicate §C.5 schedule row for the same Ex-Date | O, COST, AGNC, 0005.HK — both routes, all six spans |
| 2 | **MAJOR** | Payable Date rendered 91 days *before* its own Ex-Date | AAPL — both routes, all six spans |
| 3 | **MAJOR** | "Upcoming" Amount in a different unit/scale from its own series | ULVR.L (100×), 0005.HK (7.8×, same day) |
| 4 | **MAJOR** | `consecutiveAnnualIncreases` counts a 17-year suspension as an increase | AAPL (14 vs honest 13) |
| 5 | **MINOR** | `buildSchedule`'s de-dup path is dead code; its unit test gives false confidence | all symbols |

---

## Baseline gates — all green (run by QA, not read from a report)

| Gate | Result | Log |
|------|--------|-----|
| `npx tsc --noEmit` | exit 0 | `/tmp/qa-tsc.log`, `/tmp/qa2-tsc.log` |
| `npm test` | **22 files / 436 tests passed**, exit 0 | `/tmp/qa2-test.log` |
| `npm run lint` | exit 0 | `/tmp/qa2-lint.log` |
| `npm run build` | exit 0 | `/tmp/qa-build.log` |
| `npm run verify:runtime` | **178 checks PASSED** | `/tmp/qa-vr.log` |
| `npm run evidence:phase4` | **46 checks, 0 skipped, PASSED** | `/tmp/qa-ep4.log` |
| `npm run evidence:phase3` | **76 checks, 0 skipped, PASSED** | `/tmp/qa-ep3.log` |
| `npm run evidence:chart` | **82 checks PASSED** | `/tmp/qa-ec.log` |
| `npm run evidence:colour` | **35 checks PASSED** | `/tmp/qa-eco.log` |

The green suite is the point: **`evidence:phase4` (46 checks) passes with defects 1–3 live on the page it screenshots.**
The suite checks that §C.5 *renders* and that no invented date strings appear — it never asserts row-set coherence (no duplicate
Ex-Dates, no payable-before-ex, no cross-row unit agreement). This is a coverage hole, not a runtime bug (see §Repairs).

---

## Defect 1 — BLOCKING — duplicate §C.5 row for the same Ex-Date

**Where.** `shared/dividends.ts` — `assembleDividends` line **950** and `assembleHistory` line **994** both do
`const next = upcomingRow(facts, ...); if (next) rows.push(next);` **appending** a row built from the calendar payload on top of
`buildSchedule(...)`'s chart-derived rows, with no day-level reconciliation.

`upcomingRow` (**line 858**) takes `exDate = facts.nextExDate.value` — read at line **418** from
`summaryDetail.exDividendDate ?? calendarEvents.exDividendDate` — and sets `payableDate = facts.nextPayDate.value`
(from `calendarEvents.dividendDate`). The chart's last event for the same payment carries a **13:30-UTC** timestamp; the
calendar `exDividendDate` is **00:00-UTC** of the same day. Two rows, same calendar day, one with a payable date, one without.

`buildSchedule` (**line 664**) already contains the intended fix — line **672**:
`const isNext = payDay !== null && Math.floor(e.date / 86400) === payDay;` — which would stamp the payable date onto the
*existing* chart row by day equality. **Both callers pass `nextPayDate = null`** (lines 950/994), so `payDay` is always `null`,
`isNext` is always `false`, and the de-dup branch is unreachable. That is why defect 5 is not cosmetic.

**Evidence (probe-19, corrected day-bucket detector; both routes × six spans).** Prior probes disagreed because earlier
detectors bucketed by exact epoch seconds; the two rows differ by 4.5 hours, not by day.

```
O       MAIN rows=385  dup 2026-10-30 x2
          1793367000 (2026-10-30T13:30Z) amt=0.272 USD pay=—
          1793318400 (2026-10-30T00:00Z) amt=0.272 USD pay=2026-11-13
        HIST 1y/3y/5y/10y/20y/ALL: dup(2026-10-30 x2)
COST    MAIN rows=97   dup 2026-10-30 x2  (1.47 USD; pay 2026-11-13)
        HIST all six spans: dup(2026-10-30 x2)
AGNC    MAIN rows=173  dup 2026-10-30 x2  (0.12 USD; pay 2026-11-10)
        HIST all six spans: dup(2026-10-30 x2)
0005.HK MAIN rows=94   dup 2026-11-05 x2  (0.78396004 vs 0.1 HKD — see Defect 3)
        HIST all six spans: dup(2026-11-05 x2)
AAPL / KO / MSFT / ULVR.L: no duplicate
```

The duplicate is rendered newest-first at the top of the table (`src/dividend/sections.tsx` line **510**,
`[...(history?.rows ?? [])].sort((a, b) => b.exDate - a.exDate)`), so it is the **first thing** a reader sees.

**Also propagates to the export channel** (probe-17): `buildDividendTables` (`src/dividend/exportModel.ts:61`) builds the §C.5
CSV/JSON table from the same rows, so the duplicate Ex-Date and the wrong-scale amount are written into the downloaded file too
(O: `2026-10-30` appears 3× in the export model; ULVR.L exports `0.3907 GBp` as the upcoming amount). A user who exports to
spreadsheet gets the same factual error.

**Reproduce:**
```bash
cd /Users/love21/.openclaw/workspace/debug-coder/projects/stock-app
npx tsx tmp/qa-p4/probe-19-rel2.mts   # duplicate detector, both routes
npx tsx tmp/qa-p4/probe-17-export.mts # export-channel propagation
```

**Repair.** Pass the real payable date into `buildSchedule` — `buildSchedule(events, currency, facts.frequency.value, facts.nextPayDate.value)`
— and skip the `upcomingRow` append when the next ex-date's **calendar day** already exists in the built rows. Add a
`dividends.test.ts` case asserting the row count for a payload whose chart event and `calendarEvents.exDividendDate` fall on the
same day (the current tests use disjoint dates, so they never hit this).

---

## Defect 2 — MAJOR — Payable Date precedes its own Ex-Date (AAPL)

**Where.** Same code path. `upcomingRow` (line 858) pairs two independently-sourced dates without a monotonicity check:
`exDate = summaryDetail.exDividendDate`, `payableDate = calendarEvents.dividendDate`.

**Evidence (probe-18, live).** For AAPL the provider's two fields are internally inconsistent:

```
facts.nextExDate  = 2026-11-12  (summaryDetail.exDividendDate)
facts.nextPayDate = 2026-08-13  (calendarEvents.dividendDate)   ← 91 days BEFORE the ex-date
```

The §C.5 upcoming row therefore renders `ex=2026-11-12  pay=2026-08-13`. Reproduced on the **main** route and on the
**history** route for all six spans (probe-19), and at **DOM level** by probe-11 (exact-symbol row:
`["—","2026-11-12 HKT","—","2026-08-13 HKT","USD","0.27",…]`).

Not present for KO/MSFT/O/COST/AGNC — but that is provider luck, not a guard. Any symbol whose `calendarEvents.dividendDate`
lags its `exDividendDate` renders a payment that precedes its own ex-date. This is precisely the class of output the spec's
honesty rules exist to prevent; showing `—` for the unresolvable payable date is the correct behaviour.

**Reproduce:** `npx tsx tmp/qa-p4/probe-18-final.mts` (AAPL block) — or `probe-19-rel2.mts` (`PAY<EX` on all spans).

**Repair.** In `upcomingRow`, drop `payableDate` (render `null`) when `nextPayDate <= nextExDate`; keep the row's ex-date and
amount. Add a unit test for `nextPayDate < nextExDate`.

---

## Defect 3 — MAJOR — "upcoming" Amount in a different unit from its own series

**Where.** `upcomingRow` line **860**: `const amount = facts.lastDividendValue.value;` — used verbatim with
`currency: facts.currency.value`, with **no cross-check against the chart series' own scale** (which is what every other §C.5
row uses).

**Evidence (probe-23, live).**

```
ULVR.L  §C.5, newest first (Announced|Ex|Record|Payable|Ccy|Amt|Adj|Freq|Type):
         — | 2026-11-12 | — | — | GBp | 0.3907 | 0.3907 | quarterly | —   ← upcoming
         — | 2026-08-06 | — | — | GBp | 39.82  | 39.82  | quarterly | —
         — | 2026-05-14 | — | — | GBp | 40.46  | 40.46  | quarterly | —
         — | 2026-02-26 | — | — | GBp | 40.52  | 40.52  | quarterly | —
   ratio lastDividendValue / chartLast = 0.0098  ≈ 100×
```
`lastDividendValue` is in **pounds** while the chart series (and the currency label) is in **pence (GBp)**. The screen reads
"0.3907 GBp" where the honest figure is 39.07 GBp.

```
0005.HK §C.5, newest first:
         — | 2026-11-05 | — | — | HKD | 0.78396004 | 0.78396004 | — | —   ← chart
         — | 2026-11-05 | — | — | HKD | 0.1        | 0.1        | — | —   ← upcoming (same day)
```
Two different amounts for the **same Ex-Date** (7.84×). This is defect 1 and defect 3 combined in one visible place.
`§C.1 "Last Dividend"` also reads `0.10 HKD` for 0005.HK and `0.3907 GBp` for ULVR.L — the same wrong-scale value leaks into
§C.1 via `lastDividendValue`.

**Reproduce:** `npx tsx tmp/qa-p4/probe-23-sched-ui.mts`.

**Repair.** Before using `lastDividendValue` as the upcoming amount, compare it to the series' own recent per-payment amounts
(median of the last N chart events); if it disagrees beyond a tolerance, render the amount as `—` with a note, or fall back to
the chart's own last amount. Same guard for §C.1.

---

## Defect 4 — MAJOR — a 17-year suspension counted as a "consecutive annual increase"

**Where.** `shared/dividends.ts` line **573** `consecutiveIncreases` walks `fullYears` **positionally** and only compares
`totals[i] > totals[i-1]`; it never checks that `fullYears[i] === fullYears[i-1] + 1`. Line **562** `growthOver` has the same
positional assumption for the horizon label.

**Evidence (probe-22, live).**

```
AAPL: code streak=14  honest contiguous streak=13
      HOLE 1995 -> 2012: totals 0.004284 -> 0.189286 (up=true)   ← the gap is counted as an increase
KO / MSFT / COST / O: code streak == honest streak (no holes)
```
The AAPL chart series has no dividends 1996–2011; walking back from 2025 the code counts the 1995→2012 jump as one more
"consecutive increase", so §C.2 overstates the streak by 1 and implies continuity across a 17-year suspension.

**Latent twin (probe-14):** when a hole falls *inside* the trailing window, `growthOver`'s positional indexing mislabels the
horizon ("5Y" computed across 8 calendar years). On the shipped symbols the only hole is outside the 10y window, so the live
mislabel is currently the streak only — but the guard is missing for both.

**Reproduce:** `npx tsx tmp/qa-p4/probe-22-streak.mts`; latent case `npx tsx tmp/qa-p4/probe-14-growth-horizon.mts`.

**Repair.** Require `fullYears[i] === fullYears[i-1] + 1` for a streak step; in `growthOver`, select the base year by
`lastYear - N` (or return `null` if that year is absent) instead of by positional index.

---

## Defect 5 — MINOR — dead de-dup path with a misleading unit test

`buildSchedule` line **672** implements day-equality payable attribution, but both call sites (lines **950**, **994**) pass
`nextPayDate = null`. `tests/dividends.test.ts:250` ("always renders announced / record / type as null, and payable next-only")
exercises `buildSchedule(..., at('2026-06-30'))` with a **disjoint** ex-date — so it passes while asserting a code path the
shipped routes never execute. The test reads as coverage of exactly the coherence property that defects 1–3 violate.

**Repair.** Covered by Defect 1's repair (route the payable date through `buildSchedule`), plus a same-day test.

---

## What was verified and holds (no finding)

- **Non-payer honesty (§A.2/§A.5).** TSLA and BRK-B render `—` (not `0%`) for indicated/trailing/forward yield and annual rate;
  `source:"absent"` with `note.dividendNoDividend`; **zero** literal-zero cells; zero schedule rows. probe-24.
- **Unit traps §A.5 (probe-01).** `normalizeRatio(0.118)=0.118`, `normalizeRatio(72,0.72)=0.72`, `normalizeRatio(2.2199)=2.2199`,
  `percentToFraction(0.47)=0.0047`, `percentToFraction(2.83)=0.0283` — all correct.
- **Indicated vs derived yield.** AAPL forwardYield is `derived` with `note.dividendForwardIsIndicated` (0.0031), **not**
  `rate/price` (0.0031265…) — the taxonomy is honest.
- **Debt-leg sign (probe-12).** Net issuance → negative; gross paydown → positive; net zero → zero, for both KO-shape and
  IBM-shape inputs; the naive `abs(pay−iss)/mcap` is correctly not used.
- **Yield reconstruction is labelled (probe-20).** KO/COST: every pre-2015-04 point is `source:"reconstructed"`, the first real
  point is `2015-04-30` (`yahoo:trailingDividendYield`), and `reconstructed:true` is set on the payload. `span=ALL` yields exist
  only by reconstruction and are declared so; `range=max` is refused with 400 on the history route (verify:runtime).
- **i18n parity.** `en` 839 keys, `zh-HK` 839 keys, 0 missing, 0 extra; 97 `div.`-prefixed keys; **0** keys where the en and
  zh-HK values are byte-identical. (`npx tsx /tmp/qa-i18n.mts`.)
- **Reduced motion.** `src/styles.css:1051` `@media (prefers-reduced-motion: reduce){ *{ transition:none!important; animation:none!important } }`
  neutralises the §B.2 recap fade-in.
- **KO growth recompute** from `review-evidence/recon-phase4/out/div-KO-max.json` matched the code exactly for 1y/3y/5y/10y and
  the streak (probe-12).
- **Phase 1/2/3 regression.** `evidence:phase3` 76/76, `evidence:chart` 82/82, `evidence:colour` 35/35, and the DOM probes
  showed no console errors, no horizontal overflow, no React lifecycle warnings.

---

## Could NOT verify (and why)

- **Any symbol outside the fixture set.** The dev server answers from a seeded/temp DB and the live fixture runs; I did not
  call the real upstream provider (no network access to Yahoo, and using it would be out of band). Defects 1–3 are payload-shape
  conditions, so they recur wherever `calendarEvents.exDividendDate` shares a calendar day with the last chart event or where
  `lastDividendValue`'s scale differs from the chart's — both are provider-shape facts, not symbol-specific bugs, but the
  *frequency* across the full universe is unknown.
- **Reconstructed-yield *accuracy*.** I confirmed the points are labelled and bounded; I did not re-derive the pre-2015
  reconstruction values against a second price source.
- **Debt-leg inputs beyond the two shapes.** Only KO-shape and IBM-shape fixtures were exercised for the shareholder
  decomposition.

## Authority / boundary notes

- No product file changed. No approval gate was crossed: nothing was published, deployed, deleted, or purchased; the
  forbidden path `/Users/love21/.openclaw/workspace/projects/stock-analyzer` was never touched; port 8787 was left alone
  (probes used ephemeral ports).
- The probes under `tmp/qa-p4/` are deliberately **kept** rather than deleted: they are the report's reproduction path and the
  coordinator will need them to confirm the fixes. Nothing in `tmp/` is product code. The durable evidence recording is
  `review-evidence/qa-phase4/probe-log.txt`; the report is `review-evidence/qa-phase4/QA-REPORT.md`.
  `review-evidence/recon-phase4/out/` was read only.

## Recommended next step

Return to the coordinator with defects 1–3 as the release gate (defect 1 alone is BLOCKING: a duplicated payout row is a
factual error on the primary table). Defects 4–5 are correctness/hygiene and should ride the same fix. After the repair,
re-run `npx tsx tmp/qa-p4/probe-19-rel2.mts` and `probe-23-sched-ui.mts` — the first must report `same-day duplicates=none` for
every symbol on both routes, the second must show no `PAY<EX` and no cross-row unit disagreement.
