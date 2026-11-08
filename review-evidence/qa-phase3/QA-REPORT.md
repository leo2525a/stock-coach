# Independent QA — Phase 3 (Stock Coach)

**Reviewer:** `debug-reviewer` (subagent), independent of the builder.
**Date:** 2026-11-06
**Artifact under review:** production `dist/` build (vite, `index-C8VKX0z5.js`) + Express API in `server/`.
**Specs read:** `SPEC.md`, `SPEC-PHASE2.md`, `SPEC-PHASE3.md` (binding, additive), `RECON-PHASE3.md`.
**Method:** every gate re-run by the reviewer; own (independently written) DOM/browser harness; own defect probes; mutation testing of the regression pins. No product file was modified — the only writes are under `review-evidence/qa-phase3/`.

## Verdict: **FAIL**

The `§C.4` earnings-matrix defect the coordinator raised **is genuinely fixed and mutation-proven** (see F-3). However, this review found **one new blocking defect in the same error class** that is worse in magnitude and reachability — the `§C.5` **trailing 1-year return** can be a 10-year return labelled as one year (**+1146.88% for AAPL**), reaching the UI in the default navigation order — plus **one non-blocking span-window defect**. Because a blocking, user-visible correctness defect is reproducible in the shipped build, the artifact does not meet `§C.5` as written.

---

## 1. Gates (all re-run by the reviewer, observed output)

| Gate | Command | Observed | Result |
|---|---|---|---|
| Types | `npx tsc --noEmit` | `TSC_EXIT=0` | ✅ |
| Lint | `npm run lint` | `LINT_EXIT=0` (no findings) | ✅ |
| Unit | `npm test` | `TEST_EXIT=0` — **16 files, 304 tests passed** | ✅ |
| Build | `npm run build` | `BUILD_EXIT=0` — vite ok, 79 modules, PWA 16 precache entries | ✅ |
| Runtime | `npm run verify:runtime` | `PASSED — 148 checks, 0 fail` | ✅ (but see F-1: passes while printing the buggy value) |
| Browser | `npm run evidence:phase3` | `PASSED — 76 checks, 0 skipped` | ✅ |
| Browser | `npm run evidence:chart` | `PASSED — 82 checks` | ✅ |

`verify:runtime` was repeated (3 base-rate runs: 148/148/145 checks, the 145 run skipped one live-fundamentals-cache check when the provider answered `unavailable`). Stable.

Logs: `artifacts/gates-fast2.log`, `artifacts/verify-runtime-clean.log`, `artifacts/evidence-phase3.log`, `artifacts/evidence-chart.log`.

## 2. Findings

### BLOCKING

#### F-1 — `§C.5` trailing 1-year return is wrong whenever a wider daily series is already cached (cache-order defect)
- **Location:** `server/phase3-service.ts` `loadOneYearReturn()` (~line 650) reads `series.candles[0].close`; `server/market-service.ts` `loadSeries()` (~182–222) serves a cached series whose stored range merely *covers* the request (`rangeCovered = storedRangeSeconds >= requestedRangeSeconds * 0.95`) **without trimming it to the requested window**. The reviewer's own harness `server/app.ts` path applies `windowCandles(series.candles, view.range, now)` (line 309) before returning chart data — `loadOneYearReturn` bypasses that.
- **Violated requirement:** `SPEC-PHASE3` §C.5 — "trailing 1y return".
- **Reproduction** (`artifacts/defect-repro.log`, own ephemeral server + throwaway DB):
  ```
  chart 1y candles 251  implied 1Y return = 27.58 %
  ratings oneYearReturn BEFORE signals cache = 0.2757905899247078
  signals candles 2513 range 10y
  ratings oneYearReturn AFTER  signals cache = 11.46879818901218
  ```
  On a clean DB the value is correct (**+27.58%**, matching the chart's own 1-year change). After anything caches the 10-year daily series (the Signals tab does this on boot), `/api/ratings/AAPL` returns **11.46879818901218 → +1146.88%**.
- **Reachable in the default flow:** `src/store.ts` boot calls `loadMarket()` **and** `loadSignals()` (lines 316–317); `loadSignals` → `GET /api/signals` → `loadSeries(db, symbol, { range: 'max' })` (server), which caches the 10-year daily series. The Analysts screen then derives `oneYearReturn` from it.
- **UI impact (both locales, own harness):** the Ratings panel renders **`過去一年回報 +1146.88%`** (zh-HK) beside **`潛在回報 -3.16%`**, i.e. the same panel shows a +1147% "1-year return" and a −3% price-vs-target gap for AAPL. Reproduced for AAPL, MSFT, NVDA, SPY, TSLA, 0700.HK (`1146.9% / 243.9% / 2568.3% / …`). It also flows into the CSV/JSON export (`src/analyst/exportModel.ts:205`).
- **Why the gates miss it:** `tests/phase3-service.test.ts:325` asserts only `oneYearReturn === null || Number.isFinite(...)`, and `scripts/verify-runtime.ts:834` asserts only "finite or null". `11.4687` is finite, so both pass — the clean run literally prints `✓ one-year return is finite or null — 11.46879818901218`. This is the **same blind spot** (a plausible-looking finite number) that hid the `§C.4` matrix bug.
- **Repair:** in `loadOneYearReturn`, window the series before taking the first close — e.g. `const w = windowCandles(series.candles, '1y', nowOf(opts))` and use `w[0]`. The deeper fix is to make `loadSeries` return a series trimmed to the requested range (or to key/track the cached range and slice), so no caller can accidentally read a wider window than it asked for. Add a pin asserting the 1Y return matches the 1-year price change (e.g. compare against the windowed chart), and make `verify:runtime` compare `oneYearReturn` to the same symbol's 1-year chart change instead of merely finite-or-null.

### NON-BLOCKING

#### F-2 — the analyst "3Y" span requests `range=3y`, which is not a known range and silently resolves to a 5-year window
- **Location:** `shared/fx.ts` `spanRange('3y')` returns `'3y'` (line ~218) and `SPAN_INTERVAL['3y']='1w'`; `src/analyst/{RatingsPanel,EstimatesPanel}.tsx` offer the `3y` span. `shared/yahoo.ts` `RANGE_SECONDS` (line 236) has **no `'3y'` key**, so `resolveView` falls back to `INTERVAL_DEFAULT_RANGE['1w'] = '5y'`.
- **Evidence:** `range=3y&interval=1w` and `range=5y&interval=1w` return byte-for-byte the same 262 weekly bars over **1823 days** (2021-11-08 → 2026-11-05). A 3-year control should span ~1095 days.
- **Impact:** the "3Y" span draws ~5 years of price. Not fabricated data, but the window is not what the control says. Non-blocking (cosmetic/UX, no wrong number invented).
- **Repair:** add `'3y': 3 * 365 * 86400` to `RANGE_SECONDS` (and align `RANGE_DEFAULT_INTERVAL`), or map `spanRange('3y') → '5y'` and label it honestly. Add a unit test pinned on the span→window mapping.

### CONFIRMED FIXED (re-verified, mutation-proven)

#### F-3 — `§C.4` earnings-matrix "annual actual as a quarter" defect (coordinator's finding) — genuinely fixed
- **Re-verify (live, own server):** `/api/estimates/AAPL` matrix = revenue actual `114477000000` (latest quarter) vs forecast `155568783890` → `growth 0.3589523` (**+35.9%**), basis `quarter`, asOf `2026-09-30`; ebitda/ebit forecast `null` (honest `—`); eps actual `null`. Matches the coordinator's A/B/C result.
- **Mutation check (`artifacts/mutant-verify-runtime.log`, isolated copy under `/tmp/qa-mutant`, product tree untouched):**
  - Reintroducing the defect (M1: annual payload feeds the actual) → `tests/phase3-matrix-basis.test.ts` **2 of 4 pins fail**, and `verify:runtime` **FAILS** with the precise messages `each §C.4 actual is the quarterly figure it claims` and `no §C.4 actual is the annual figure standing in for a quarter`.
  - Removing only `ensureQuarterlyStatements` (M2: nav-order dependence) → the order-independence pin fails.
  - ⇒ The pins are **falsifiable, not theatre**.
- **Honest caveat (the builder already documents it):** `verify:runtime`'s matrix "actual" check is a *live* check — on a thin annual payload it can coincide with `—`. The deterministic, non-vacuity-proven pin is the unit test. For its *own* claim, `verify:runtime`'s matrix Growth self-consistency check still passes under M1 (it only checked growth = (forecast−actual)/|actual|, which is internally consistent even with the wrong base) — a residual weakness in that one check, not a failure of the fix.

## 3. Per-criterion evidence

| Criterion | Evidence | Verdict |
|---|---|---|
| **§A.2** not-available items ship honest `—`, never synthesised | `curl /api/statements/ZZZZ` → `columns:[]`, `rows[].values:[]`, `currency:null`, `source` honest; AAPL annual goodwill/intangibles = `[None,None,None,None]`; SPY (an ETF with no income statement) → `source:"unavailable"`, revenue `null`; estimates/ratings for ZZZZ → empty arrays + `null`, `note:note.*Unavailable`. Metric rule in `shared/metrics.ts` (`number|null`, `formulaKey`, never 0/NaN/Inf). | ✅ |
| **§B** design system / motion / reduced-motion | Own harness: `prefers-reduced-motion: reduce` → **all 2884 transition/animation durations compute to 0s**; control run with motion allowed → 324 non-zero durations (harness proven non-vacuous). | ✅ |
| **§C.1** Overview header | `quotes/AAPL` returns price/52w range/PE/etc.; pre/post-market shown only when supplied ("…只有供應商確實有提供嗰陣才會顯示"). | ✅ |
| **§C.2/C.3** Statements LTM/Q/A + 3 tables | LTM labelled computed, "最近呈報期間：2026-09-30"; quarterly capped at 4 columns; all three statements render; per-row currency (0700.HK CNY). | ✅ |
| **§C.4** Estimates trend & breakdown | Matrix basis `quarter`, EPS −67.7% artefact **gone** (+35.9% on comparable basis); only 4 periods, FY+2/FY+3 = `—` with an explicit "no such data exists" note. Mutation-proven (F-3). | ✅ |
| **§C.5** Ratings / target / **trailing 1y return** | Target band, distribution, trend, upgrades list all render. **But the trailing 1y return is wrong** (+1146.88% shown) → see **F-1**. `3Y` span window wrong → **F-2**. | ❌ |
| **§C.6** Ratings distribution etc. | Buckets 6/18/13/3/3, composite 2.23, month-by-month trend, recent actions present. | ✅ |
| **§D.5** unavailable figures render `—`/`暫無資料`; no cookie/crumb reaches the client | `—` observed throughout statements/metrics; own endpoint scan found **zero** `crumb`/`set-cookie`/`A1=`/`A3=`/`GB=` in any body or header across `statements`, `estimates`, `ratings`, `quotes`, `fx`, and on 4xx/5xx error paths. | ✅ |
| **§D.2** 390/834/1600, zero console errors | Own harness, fresh load at each width: `scrollW == clientW` (390/834/1600), zero unreachable spill (wide tables scroll inside `.pf-table-wrap`), **0 console errors, 0 page errors, 0 failed requests**. | ✅ |
| Phase 1/2 regression | Market ranges 1d…max all return sane counts; news (11 items), watchlist, quotes, fx all OK. No regression observed. | ✅ |

## 4. Independent artifacts (reviewer-produced)

- `review-evidence/qa-phase3/QA-REPORT.md` — this report.
- `review-evidence/qa-phase3/artifacts/defect-repro.log` — F-1 + F-2 reproduction.
- `review-evidence/qa-phase3/artifacts/mutant-verify-runtime.log` — M1 mutant fails `verify:runtime`.
- `review-evidence/qa-phase3/artifacts/qa-browser.mjs` — **own** browser harness (not the builder's `scripts/evidence-phase3.mjs`).
- `review-evidence/qa-phase3/artifacts/qa-overflow-detail.mjs` — focused overflow probe.
- `review-evidence/qa-phase3/artifacts/{gates-fast2,verify-runtime-clean,evidence-phase3,evidence-chart}.log`.
- `review-evidence/qa-phase3/browser/` — `qa-{phone-390,tablet-834,desktop-1600}.png`, `desktop-body.txt`, `locale-second.txt`, `report.json`.

## 5. Unverified / limits / uncertainty

- **Unverified:** the exact percentage of real users who hit F-1 before the Signals prefetch completes; the fix's behaviour for symbols whose 1-year window contains a split unadjusted by the provider.
- **Harness caveat (resolved):** my first harness reported a phone-390 overflow. Root-caused to a **resize artefact** (a JS-measured chart canvas keeps its desktop width when the viewport is resized). On a fresh 390 px load the overflow is zero. The builder's `measureOverflow` accepted self-scrolling ancestors; my stricter rule had also counted a resize artefact. Corrected, both agree. Documented so the discrepancy is not mistaken for a product bug.
- **Not a product defect:** `range=3y` resolving to a 5-year window is only reachable via the analyst panels' "3Y" span (the Dashboard range control never sends `3y`), which is why F-2 is classified non-blocking.
- **No price/fabrication defects** found in the `§C.4` matrix beyond F-3's fix; `verify:runtime` and the unit pins catch a reintroduction.

## 6. Recommendation

Do not ship as PASS. Fix **F-1** (Blocking) by windowing the 1-year series in `loadOneYearReturn` (or fixing `loadSeries` to return a trimmed series), and add a falsifiable assertion (1Y return ≈ the symbol's own 1-year chart change) to `tests/phase3-service.test.ts` and `verify:runtime` — the current "finite or null" assertion is what let this through. Fix **F-2** (non-blocking) by adding `'3y'` to `RANGE_SECONDS` or relabelling the span. Re-run this review after the fix; the `§C.4` fix should be preserved as-is.
