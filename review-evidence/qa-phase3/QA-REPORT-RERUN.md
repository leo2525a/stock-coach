# Independent QA — Phase 3 RE-RUN (after builder fixes)

**Reviewer:** `debug-reviewer` (subagent), independent of the builder.
**Date:** 2026-11-06 (re-run)
**Trigger:** the builder fixed F-1 and F-2 from `QA-REPORT.md`; the builder's session then hit a context overflow and filed no report.
**Scope of this run:** re-verify the two fixes independently, judge whether `verify:runtime`'s own new pins are falsifiable, re-walk every acceptance criterion, and re-state the verdict. No product code was modified; writes are confined to `review-evidence/`.
**Prior report:** `review-evidence/qa-phase3/QA-REPORT.md` (unchanged; its evidence is preserved).

## Verdict: **FAIL** (narrow)

Both reported findings **are genuinely fixed** and the fix is **mutation-proven**. Gates are all green. **However, the F-1 fix is incomplete**: the same defect reproduces on the `loadSeries` **stale-cache fallback** path, where it still yields a **wrong, user-visible trailing 1-year return** (a decade change presented as one year) — and in the realistic partial-outage case the payload is even labelled `source: 'live'`, so no stale warning is shown. Because this is the same class, same function, same user-visible symptom as the blocking finding I raised last round, I classify it **BLOCKING**; §C.5 is therefore not fully met and Phase 3 is **not yet a clean PASS**.

Everything else passes (see §4). If the coordinator's bar is "the two reported findings are fixed", then this is PASS-WITH-FINDINGS; if the bar is "no blocking finding remains", it is FAIL. I am reporting FAIL on the stricter, consistent bar.

---

## 1. Gates — all re-run by the reviewer

| Gate | Command | Observed | Result |
|---|---|---|---|
| Types | `npx tsc --noEmit` | `TSC_EXIT=0` | ✅ |
| Lint | `npm run lint` | `LINT_EXIT=0` | ✅ |
| Unit | `npm test` | `TEST_EXIT=0` — **17 files / 313 tests passed** (was 16/304; `cache-order-range.test.ts` adds 9) | ✅ |
| Build | `npm run build` | `BUILD_EXIT=0` | ✅ |
| Runtime | `npm run verify:runtime` | `VERIFY_EXIT=0` — **152 checks passed** | ✅ |
| Browser | `npm run evidence:phase3` | `EV3_EXIT=0` — 76 checks, 0 skipped | ✅ |
| Browser | `npm run evidence:chart` | `EVCHART_EXIT=0` — 82 checks | ✅ |

Logs: `artifacts/rerun-gates.log`, `artifacts/rerun-verify-runtime.log`, `artifacts/rerun-evidence-phase3.log`, `artifacts/rerun-evidence-chart.log`.

## 2. F-1 — the reported cache-order defect is fixed (verified)

- **Fix present in the tree:** `server/market-service.ts` `loadSeries` cache-fresh branch now trims — `const all = getCandles(...); const candles = windowCandles(all, view.range, now);` (lines ~210-215). The comment states the contract ("a caller asking for range X gets range X").
- **Independent live reproduction** (own server, `PORT=8893`, throwaway DB; deep 10-year daily cache seeded via `/api/signals`, ≥2 symbols requested):

  | Symbol | bars cached by signals | 1Y return before signals | after signals | true 1Y window | identical? |
  |---|---|---|---|---|---|
  | AAPL | 2513 | +27.58% | +27.58% | +27.58% | ✅ |
  | MSFT | 2513 | +7.81% | +7.81% | +7.81% | ✅ |
  | NVDA | 2513 | −3.45% | −3.45% | −3.45% | ✅ |
  | 0700.HK | 2462 | −34.81% | −33.79% | −33.79% | ⚠️ ~1.0 pp |

  AAPL/MSFT/NVDA are byte-identical before/after and match the 1-year window — the old +1146.88% is gone. The 0700.HK ~1 pp delta is a *boundary-bar* difference (a fresh live 1y fetch starts at 2025-11-07/634; the windowed-10y cache starts one bar later); both are genuine ~1-year windows and the value matches its own window, so this is **not** the old defect — see §3 for the residual that *is*.
- **UI check (own harness, both locales):** the Ratings panel now renders `過去一年回報 +27.58%` (zh-HK) and `1-YEAR RETURN +27.58%` (EN). No value ≥300% anywhere in either body (`artifacts/rerun-zh-HK-body.txt`, `artifacts/rerun-en-body.txt`).
- **`verify:runtime` new pin (F-1):** `✓ the trailing 1y return equals the 1y window, even after signals cached 10y — ratings=0.2757905899247078 vs 1y window=0.2757905899247078`.

### 2a. Is `verify:runtime`'s new F-1 check falsifiable on its own? **YES** (judged directly)
The coordinator asked me to judge this, having not tested it. I reverted the fix in an isolated copy (`/tmp/qa-mutant2`, product tree untouched) and ran the real `verify:runtime` against the mutant:

```
✗ the trailing 1y return equals the 1y window, even after signals cached 10y
    — ratings=11.46879818901218 vs 1y window=0.2757905899247078
✓ one-year return is finite or null — 11.46879818901218      ← the OLD weak check still passes
✗ runtime verification FAILED — 143 passed, 5 failed
```

So the new check is **genuinely independent and falsifiable**: it compares the ratings value against a separately fetched `/api/market?range=1y` window and **fails on the mutant with the exact wrong value**, while the legacy finite-or-null assertion (still present at `verify-runtime.ts:878`) is demonstrably vacuous. `artifacts/rerun-mutant-verify-runtime.log`.

## 3. Residual BLOCKING finding — F-1 survives on the stale-cache path

- **Location:** `server/market-service.ts`, the **`catch` (live-failed) branch** of `loadSeries` (~line 259): `const cached = getCandles(db, symbol, view.interval);` … `return { …, candles: cached, …, source: 'stale-cache' }` — **raw, un-windowed**. The fix was applied only to the cache-**fresh** branch, not this one. `loadOneYearReturn` still reads `series.candles[0]`.
- **Reachability:** the stale branch is taken when the cache is present but older than the TTL **and** the live fetch fails. The chart TTL for `1d` is `3600 s` (1 h); the daily series is cached by Signals at boot. A transient Yahoo failure/rate-limit then routes a `range: '1y'` request through the stale branch. (Yahoo returned `429 Too Many Requests` to me during this review, so this is not hypothetical.)
- **Reproduction 1 — through the real service (`loadRatings`), own probe** (`artifacts/residual-stale-path-probe.log`, `probe-stale-endtoend.mts`): deep 10-year daily cache stamped 10 days old + a failing fetch ⇒
  ```json
  { "oneYearReturn_observed_pct": 100, "oneYearReturn_expected_pct": 7.58, "CORRECT": false }
  ```
  i.e. the **decade** change shown as the 1-year return.
- **Reproduction 2 — realistic partial outage** (`artifacts/residual-partial-outage-probe.log`, `probe-partial-outage.mts`): the analyst **bundle succeeds** (crumb-authenticated `quoteSummary`) while the crumb-free **chart** endpoint returns 503 ⇒
  ```json
  { "source": "live", "hasBundle": true, "targetMean": 333.28,
    "oneYearReturn_observed_pct": 100, "oneYearReturn_expected_pct": 7.6, "CORRECT": false }
  ```
  Note **`source: "live"`**: the payload carries a live bundle and a wrong 1Y return, so the UI shows a fully-populated "live" Ratings panel with **no stale warning** on a decade-change number. That is precisely the silent-wrong-number failure mode this review exists to catch.
- **Lower-level confirmation** (`artifacts/` — `probe-stale-window.mts`): `loadSeries({range:'1y'})` on that path returns **2513 candles whose first bar is 2512 days old** (and indeed `+100%`).
- **Gap in the new pins:** `tests/cache-order-range.test.ts` exercises only the cache-fresh and live paths, never the stale fallback (grep for it returns nothing); `verify:runtime`'s F-1 check likewise runs only on the happy path. So both gates pass green while this path stays broken.
- **Repair:** apply the same `windowCandles(...)` trim in the catch/stale branch (trimming there cannot regress the "nothing cached" case, since it only runs when candles exist) — consistent with the contract the fix already documents. Add a pin for the stale path: seed an over-wide cache past the TTL, force a failing fetch, and assert the served series is windowed (and that `oneYearReturn` equals the 1-year window).

## 4. F-2 — fixed (verified), and labelled honestly

- `shared/yahoo.ts` now has `RANGE_SECONDS['3y'] = 3*365*86400`, `RANGE_DEFAULT_INTERVAL['3y'] = '1d'`, `RANGE_ORDER` includes `'3y'`.
- **Live serving (own server):** `range=2y&interval=1w` → 105 bars/724 d; `range=3y&interval=1w` → **157 bars/1088 d**; `range=5y&interval=1w` → 262 bars/1823 d. No longer identical — 3Y is now three years.
- **UI-level:** clicking the analyst **3Y** span fires `/api/market/AAPL?range=3y&interval=1w` (own probe `artifacts/qa-3y-probe.mjs`), not 5y.
- **"Does 3y map to a faithful upstream range?"** Yes, as far as the app's own live fetch can show: `clampRangeForInterval('3y','1d')` is a no-op (1d `maxDays = ∞`), so the app genuinely requests `range=3y` upstream and received **751 daily bars (~3 trading years)** on a fresh live fetch — i.e. Yahoo serves `3y` faithfully and nothing is silently substituted. Honest.

## 5. Everything else — re-walked, still passing

| Criterion | Re-run evidence | Verdict |
|---|---|---|
| §C.4 matrix (do not regress) | `/api/estimates/AAPL` → revenue actual `114477000000` vs forecast `155568783890`, growth `0.3589523`, basis `quarter`, asOf `2026-09-30`; ebitda/ebit forecast `null`; eps actual `null`. `verify:runtime` §C.4 checks ✓ (kept mutation-proven from round 1). | ✅ |
| §A.2 / §D.5 honest `—` | `statements/ZZZZ`, `estimates/ZZZZ`, `ratings/ZZZZ` → empty arrays / `null` with `note.*Unavailable`, `source` honest. | ✅ |
| No cookie / crumb | Own scan of body **and** headers across `statements`, `estimates`, `ratings`, `quotes`, `fx`, `market?range=3y` → **no** `crumb` / `set-cookie` / `A1=` / `A3=` / `GB=`. | ✅ |
| §B reduced-motion | Own harness: `reduce` ⇒ **2892 durations, 0 non-zero**; control (motion allowed) ⇒ 324 non-zero (non-vacuous). | ✅ |
| §D.2 390/834/1600, zero console errors | Own harness re-run: `scrollW == clientW` at all three widths, 0 unreachable spill, **0 console errors / 0 page errors / 0 failed requests**; 13/13 checks. | ✅ |
| Phase 1/2 regression | `range=1d…max` return sane counts (1→2512); `/api/watchlist/quotes` ok; news 11 items; watchlist 4. (Note: `/api/quotes` is not a route — my earlier probe used a wrong path; the real endpoint is `/api/watchlist/quotes`, which is fine.) | ✅ |

## 6. Independent artifacts added this run

- `artifacts/rerun-gates.log`, `rerun-verify-runtime.log`, `rerun-evidence-phase3.log`, `rerun-evidence-chart.log`
- `artifacts/rerun-mutant-verify-runtime.log`, `rerun-mutant-unit.log` (mutation proof)
- `artifacts/residual-stale-path-probe.log`, `residual-partial-outage-probe.log` (+ `probe-stale-endtoend.mts`, `probe-partial-outage.mts`, `probe-stale-window.mts`)
- `artifacts/qa-3y-probe.mjs`, `artifacts/rerun-zh-HK-body.txt`, `artifacts/rerun-en-body.txt`, `artifacts/rerun-server.log`

## 7. Uncertainty / limits

- The stale-path finding is reproduced deterministically through the **real** `loadRatings`/`loadSeries` with a mocked failing fetch and a seeded stale cache; I did **not** force a live provider outage against the running server end-to-end (Yahoo was intermittently rate-limiting), so the degraded-mode UI screenshot is not captured — the service-level evidence is the proof.
- The 0700.HK ±1 pp before/after delta is a boundary-bar artefact, not the defect; flagged so it is not mistaken for one.
- I did not re-run the §C.4 live mutation against the *original* annual-vs-quarter code this round (the round-1 proof stands and the §C.4 checks still pass); this run's mutation targeted the new F-1/F-2 fixes.

## 8. Recommendation

Ship-blocking: apply the window trim to the `loadSeries` **stale** branch and add a stale-path pin (unit + `verify:runtime`). The F-1/F-2 fixes and all other criteria should then be preserved as-is; a narrow re-run of §C.5 plus the stale pin would be sufficient to close this out.

---

# FINAL CONFIRMATION (stale-path fix landed)

**Date:** 2026-11-06 (final). **Trigger:** the coordinator reports the F-1 residual (stale branch) has been fixed and asks for the final verdict, plus adjudication of the builder's self-reported `windowCandles` caveat.

## Verdict: **PASS-WITH-FINDINGS** — Phase 3 is acceptable to ship

Every blocking finding from the prior two rounds is **fixed and mutation-proven**, all gates are green, and every acceptance criterion passes on my own harness and probes. The one residual item is a **non-blocking, documented edge** in `windowCandles` (adjudicated below) that I judge acceptable for Phase 3, with a recommended cheap hardening for a later pass. No blocking defect remains.

### The stale-path fix is real (verified independently)
- **In the tree:** the `catch` branch of `loadSeries` now does `const candles = windowCandles(cached, view.range, now)` and guards on `hasUsableData(candles)`; `recordFetch(...)` still logs `cached.length` (stored rows) as the fresh path does; `source:'stale-cache'` + `note` unchanged.
- **Repro through the real `loadRatings`** (`artifacts/final-stale-probe.log`), deep 10 y cache older than TTL + failing fetch, `range:'1y'`:
  ```json
  { "oneYearReturn_observed_pct": 7.58, "oneYearReturn_expected_pct": 7.58, "CORRECT": true }
  ```
  **7.58%** — was **100%** in my previous run. Fixed.
- **Partial-outage case** (live bundle OK, chart 503) — `artifacts/final-partial-outage-probe.log`: `oneYearReturn_observed_pct: 7.6` vs expected `7.6`, `CORRECT: true`. The former silent `source:'live'` + decade number is gone.
- **Mutation check** (isolated copy, product tree untouched): reverting the stale-branch window makes **3 of the 13** tests in `tests/cache-order-range.test.ts` fail (`a stale-cache serve of a 10y cache answers a 1y request with the 1y window`, `…matches the fresh-cache 1y serve bar for bar`, `every served window on the stale path stays within the requested range`); restored ⇒ 13/13. The pins are falsifiable, not theatre.

### Gates — final re-run by the reviewer
| Gate | Observed | Result |
|---|---|---|
| `npx tsc --noEmit` | `TSC_EXIT=0` | ✅ |
| `npm run lint` | `LINT_EXIT=0` | ✅ |
| `npm test` | `TEST_EXIT=0` — **17 files / 317 tests passed** | ✅ |
| `npm run build` | `BUILD_EXIT=0` | ✅ |
| `npm run verify:runtime` | `VERIFY_EXIT=0` — **152 checks passed** | ✅ |
| `npm run evidence:phase3` | `EV3_EXIT=0` — 76 checks, 0 skipped | ✅ |
| `npm run evidence:chart` | `EVCHART_EXIT=0` — 82 checks | ✅ |

Logs: `artifacts/final-gates.log`, `final-verify-runtime.log`, `final-evidence-phase3.log`, `final-evidence-chart.log`.

### Full acceptance surface — re-walked (own harness + own probes)
| Criterion | Evidence | Verdict |
|---|---|---|
| §C.5 trailing 1Y return | own harness both locales: `過去一年回報 +27.58%` / `1-YEAR RETURN +27.58%`; no value ≥300% anywhere (`final-zh-HK-body.txt`, `final-en-body.txt`). | ✅ |
| §C.5 / F-2 3Y span | `range=3y` → 157 bars/1088 d vs `range=5y` → 262/1823; UI 3Y click requests `range=3y&interval=1w` (probe `qa-3y-probe.mjs`); Yahoo serves 3y faithfully. | ✅ |
| §C.4 matrix | revenue actual `114477000000` (quarter) vs forecast `155568783890`, growth `0.359`, basis `quarter`, asOf `2026-09-30`; ebitda/ebit forecast `null`; eps actual `null`. | ✅ |
| §A.2 / §D.5 honest `—` | `ratings/ZZZZ` → `oneYearReturn null`, `source unavailable`, `note note.ratingsUnavailable`; estimates/statements same shape. | ✅ |
| No cookie / crumb | own body+header scan across statements/estimates/ratings/quotes/fx/market → all clean. | ✅ |
| §B reduced-motion | own harness: `reduce` ⇒ 2884 durations, **0 non-zero**; control ⇒ 324 non-zero (non-vacuous). | ✅ |
| §D.2 390/834/1600 | own harness: `scrollW == clientW` all three, 0 unreachable spill, **0 console/page errors, 0 failed requests** (13/13). | ✅ |
| Phase 1/2 regression | ranges 1y…max return sane counts (251…2512); news/watchlist/quotes ok. | ✅ |

### Adjudication — the `windowCandles` caveat (`return windowed.length ? windowed : candles`)
**Non-blocking. Acceptable documented edge; not a Phase 3 blocker.** Reasoning, evidenced:
- **Does it apply to the reported scenario?** No. When recent bars exist, the window is non-empty and the trim works — that is the entire realistic case (the app's own boot caches the 10 y series including recent bars). My probe `artifacts/final-window-caveat.log`: newest bar 5 d old ⇒ `7.70%` (correct, windowed).
- **Could a real user hit it?** Only if the cache's **newest bar is already older than `now − 365 d`** (i.e. the symbol has had no daily bar in over a year). For a listed symbol being viewed this does not occur; it would require an extended halt/delisting, and the payload then still carries `source:'stale-cache'` + `note.marketLiveFetchFailed`, so it is *stale-and-flagged*, not fabricated-live. My probe confirms: newest bar 400 d old ⇒ `100%` **but** `source` is the stale/unavailable path (flagged).
- **Wrong or merely stale-but-flagged?** The latter. The value is a real change over the stored period, surfaced with the stale warning — materially different from the original defect, which presented a decade change as a **live** 1-year figure with no warning.
- **Why returning empty would be worse:** `windowCandles` is shared by three call sites; returning `[]` out-of-window would flip `hasUsableData` and push every caller to the error path, degrading honest stale data to an error. The current fallback is the safer choice.
- **Recommended (non-blocking) hardening for a later pass:** when `candles.length > 0 && windowed.length === 0`, return `[]` **only** at the `loadOneYearReturn` call site (or have `windowCandles` take an `emptyWhenOutOfWindow` flag), so a genuinely out-of-window 1 y request yields `—` rather than an unflagged decade change. Not required to ship.

### Final artifacts added
`artifacts/final-gates.log`, `final-verify-runtime.log`, `final-evidence-phase3.log`, `final-evidence-chart.log`, `final-stale-probe.log`, `final-partial-outage-probe.log`, `final-window-caveat.log`, `final-zh-HK-body.txt`, `final-en-body.txt` (+ `probe-window-caveat.mts`).

### Final uncertainty
The out-of-window caveat value (`100%`) was reproduced at the service level with a seeded cache and a failing fetch, not against a live provider outage; the flag (`stale-cache`/`unavailable`) is present in that reproduction, which is the basis for calling it stale-but-flagged rather than fabricated.

---

## 8. FINAL CONFIRMATION (round 3) — F-3 call-site fix, targeted re-check

Scope: verify the builder's last change only (call-site windowing in
`loadOneYearReturn`). No re-walk of the surface was needed; the four asks were
answered directly.

### (1) Diff is exactly as claimed; `windowCandles` untouched ✅
- `server/phase3-service.ts::loadOneYearReturn` now computes `const now = nowOf(opts)`, passes `now` into `loadSeries`, filters `c.time >= now - 365 * DAY`, needs `inWindow.length >= 2`, else `null`; returns `growthBetween(inWindow[0].close, inWindow.at(-1)!.close)`.
- `shared/yahoo.ts` L360–366 (`windowCandles`) read back **byte-identical** to the prior round (escape hatch `return windowed.length ? windowed : candles;` intact). Confirmed by direct read, not by the builder's assertion.
- New `tests/trailing-return-window.test.ts` present with the 3 tests described; its own `expect(decadeChange).toBeCloseTo(1,2)` makes the "before" value explicit.

### (2) New test passes; mutation-proven ✅
- `npx vitest run tests/trailing-return-window.test.ts` → **3 passed (3)** (`final2-trailingwindow.log`).
- Independent mutant `/tmp/qa-mut4`: reverted the body to the pre-F-3 `series.candles[0]`/`at(-1)` form → **2 failed | 1 passed (3)** — the out-of-window case fails `expected ... to be null` and the over-rejection guard fails; the fresh-serve case still passes (`final2-mutant-trailingwindow.log`). The two honesty tests are genuine, not tautological.

### (3) No other producer can surface a decade figure ✅
- `oneYearReturn` is produced **only** by `loadOneYearReturn` (called once, `phase3-service.ts:522`). The other two occurrences are the `null` placeholder at L359 (immediately filled by that call) and the type field. No second path.
- Only remaining window-start read of candles outside tests: none. All other `candles[0]`/`candles.at(-1)` reads are (a) `loadPrice` L230 (`meta.lastPrice` first, else newest bar — window-width-independent, unaffected) and (b) UI last-price displays in `src/`. The `fromTime: candles[0].time` at `market-service.ts:325` is computed *after* the series is already windowed.

### Independent repro (my own probes, not the builder's)
- `probe-window-caveat.mts`: newest bar 5 d old → `7.7%` (windowed, correct); newest bar 400 d old → **`null`** (was `100%`) (`final2-window-caveat.log`).
- `probe-stale-endtoend.mts` through the real `loadRatings`, deep stale cache + failing fetch, `range:'1y'` → observed **7.58%** == expected **7.58%**, `CORRECT: true` (was `100%`) (`final2-stale-probe.log`).
- `null` renders honestly as `—` in both surfaces: UI `RatingsPanel` → `<NoData/>` → `common.noData` (`—`); CSV/JSON export `f.pct(null)` → `common.noData` (`—`). So an out-of-window symbol shows `—`, never a decade number.

### (4) Gates re-run on this tree
`tsc 0 · lint 0 · build 0 · 320 tests / 18 files · verify:runtime 152 checks · evidence:phase3 74 checks / 2 skipped · evidence:chart 82 checks · own browser harness 13/13`.
- The 2 `evidence:phase3` skips are **provider-dependent, classified "not failures" (`EV3_EXIT=0`)**: Yahoo carried no `sector` for AAPL this run, so the `zh-HK`/`en` sector-tag assertions are skipped as an honest omission (§D.5) — unrelated to this change. Prior run showed 76/0; this is live-provider variance, not a regression.
- `evidence:chart` first attempt aborted with a transient Playwright "browser has been closed" (concurrent-Chrome contention); re-run alone → `82 checks PASSED`.

### Verdict
**Phase 3 is clean-to-ship. No remaining honesty edge.** The last non-blocking caveat is closed at the call site exactly as described, the fix is mutation-proven, and no other code path can present an out-of-window change as a trailing 1-year return.

Artifacts this round: `final2-trailingwindow.log`, `final2-mutant-trailingwindow.log`, `final2-window-caveat.log`, `final2-stale-probe.log`, `final2-gates.log`, `final2-test.log`, `final2-verify-runtime.log`, `final2-evidence-phase3.log`, `final2-evidence-chart.log`, `final2-zh-HK-body.txt`, `final2-en-body.txt`.
