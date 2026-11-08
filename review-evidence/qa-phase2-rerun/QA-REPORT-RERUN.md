# Independent QA RE-RUN — Stock App v1, Phase 2 B1 fix

Reviewer: `debug-reviewer` (subagent) · Requester: `debug-debug_lead` · Date: 2026-11-06 ~15:55 HKT
Artifact: `/Users/love21/.openclaw/workspace/debug-coder/projects/stock-app`
Specs: `./SPEC-PHASE2.md`, `./SPEC.md`
Prior report: `./review-evidence/qa-phase2-1435/QA-REPORT.md` (byte-intact, md5 unchanged)

> **Evidence provenance.** Everything in `./review-evidence/qa-phase2-rerun/` is
> **mine**, produced in this re-run. The original harness
> (`qa-phase2-1435/qa-browser.ts`, `qa-console.ts`) is also mine: its mtime
> (14:48/14:49) predates both my prior report (14:53) and the builder's re-run
> (15:28–15:30), and my copies are **byte-identical** to it (md5
> `fcee8853…`, `5994ebc5…`). The builder did **not** modify it. The
> builder's `./followup-evidence/` re-ran that same file unmodified.

## VERDICT: **PASS-WITH-FINDINGS**

The blocking Phase 2 finding **B1 is RESOLVED**, verified by direct DOM
observation. All four non-blocking items **N1–N4 are genuinely fixed**. All five
gates are green on the current tree. No Phase 1 regression. The findings that
remain are non-blocking and outside the B1 scope: a **flaky `verify:runtime`
check** (N5) and the builder's ZZZZZZ/harness-premise point (correct).

---

## 1. B1 — RESOLVED (independent, fresh harness)

Harness: `qa-rerun.ts` (new file, 70 checks) + `final-sweep.ts` (exhaustive, no
exclusions). Both boot my own server (`qa-phase2-1435/qa-server.ts`,
`PORT=8799`, throwaway DB) against the shipped `dist/` build.

**Rendered strings observed in a clean zh-HK session:**

| Surface | zh-HK (observed) | en (observed) |
|---|---|---|
| Source badge — dashboard | `快取 · 啱啱` | `Cached · just now` |
| Source badge — chart | `快取 · 啱啱` | `Cached · just now` |
| Source badge — signals | `即時 · 啱啱` | — |
| Badge `title` | `呢個數字對上一次由數據商拿取嘅時間。` | English hint |
| News meta | `GuruFocus.com · 2 個鐘前更新 · 提及 AAPL · 開啟原文 ↗` | `GuruFocus.com · Updated 2 h ago · Mentions AAPL · Open the story ↗` |
| News meta (other items) | `· 4 個鐘前更新`, `· 6 個鐘前更新` | `· Updated 4 h ago` |

`humanAge(120s).zh-HK` → `"2 分鐘前"`; `src.updated('{age}更新')` →
`"2 分鐘前更新"` (single suffix).

**Exhaustive sweep** (`final-sweep.ts`): the **entire `document.body.innerText`
plus every `title`/`aria-label`/`placeholder`/`alt`** on all five screens, regex
`/(just now|\d+ min ago|\d+ h ago|\d+ d ago|\bago\b)/gi`:

```
[zh-HK dashboard] visible hits=0  attr hits=0
[zh-HK chart]     visible hits=0  attr hits=0
[zh-HK signals]   visible hits=0  attr hits=0
[zh-HK watchlist] visible hits=0  attr hits=0
[zh-HK help]      visible hits=0  attr hits=0
TOTAL English relative-time hits across all 5 zh-HK screens: 0
```

**B1 RESOLVED.** No `min ago` / `just now` / `h ago` / `d ago` renders in zh-HK
anywhere; toggling to `en` shows English again (verified above). The bundle still
*contains* the English words — correctly, `en` is a shipped locale; the bug was
that a zh-HK session rendered them, and it no longer does.

## 2. Double-suffix class — clean

- Whole-UI zh-HK scan for `/前前/`, `/更新更新/`, `/分鐘分鐘/`, `/個鐘個鐘/`,
  `/日日/` across all five screens **and every `title` attribute** → **0 hits**
  (`qa-rerun.ts` §3, `evidence.doubleSuffix = []`).
- The proposed guard is real, not decorative. `auditDictionaries()` exports a
  `doubleSuffix` check with two patterns. **Mutation check**
  (`mutation-check.ts`, calls the shipped pure function with a synthetic bundle —
  no app-source edit):
  ```
  REAL shipped bundle doubleSuffix: []   missing: {"zh-HK":[]}   placeholderMismatches: []
  MUTATED bundle doubleSuffix: [{lang:"zh-HK", key:"src.updated", value:"{age}前更新", ...}]
  GOOD src.updated({age}): "2 分鐘前更新"   BAD src.updated({age}): "2 分鐘前前更新"
  MUTATION CHECK: PASS
  ```
  The guard flags the reintroduced bug and reports the shipped bundle clean.

## 3. Gates re-run by the reviewer (observed output)

| Gate | Command | Observed |
|---|---|---|
| Build | `npm run build` | `BUILD_EXIT=0`; `✓ 67 modules transformed`; `index-XaYzCzND.js 525.14 kB`; `✓ built in 931ms`; PWA `precache 16 entries (544.95 KiB)`. No warnings. (`build.log`, `build.exit`) |
| Tests | `npm test` | `Test Files 10 passed (10)`, `Tests 202 passed (202)`, `Duration 1.55s` (`test.log`) |
| Lint | `npx eslint .` | `LINT_EXIT=0`, **0 bytes** of output (`lint.log`) |
| Runtime | `npm run verify:runtime` | `✓ runtime verification PASSED — 95 checks` on re-run — **flaky, see N5** (`verify-runtime*.log`) |
| Chart evidence | `npm run evidence:chart` | `✓ browser evidence PASSED — 82 checks`, `0 console errors`, `0 exceptions`, `0 failed requests`, no React warnings (`evidence-chart.log`) |

Per-file test counts: `format` 26 · `no-hardcoded-strings` **8** · `mapping` 33 ·
`phase2` 37 · `indicators` 17 · `signals` 40 · `i18n` 18 · `error-copy` 8 ·
`stale-badge` 7 · `stockchart` 8.

**"Test now covers `shared/`" — confirmed.** `tests/no-hardcoded-strings.test.ts`
grew 5 → 8 tests and adds a `describe('shared/ — engine prose is either published
copy or a diagnostic')` block that scans `signals.ts, categorise.ts, format.ts,
api-errors.ts, types.ts, yahoo.ts` with its own `proseLiteralsIn()`; it asserts
zero unexplained English prose and includes a non-vacuity floor
(`> 40` published sentences).

**Independent replication + mutation** (`shared-scan-replica.ts`, replicates the
scan verbatim because the helper is not exported and app source is read-only):
```
real shared/ prose literals: 58 raw → 0 unexplained
MUTATED format.ts (+ 'Sorry, no numbers here') → 1 unexplained  (caught)
REPLICATION RESULT: PASS
```

## 4. N1–N4 — verified by observation

- **N1 (bare `'no data'`/`'unknown'`) — FIXED.** `shared/format.ts` now exports
  `NO_DATA = '—'` and every `format*()` takes an optional `Formatter`; the
  `shared/` scan above proves no unexplained English literal remains (58 raw
  literals, 0 unexplained). Rendered sweep of `.stat .v`, `.kv-row dd`,
  `[data-testid="category-rows"]` on all five zh-HK screens → **0** bare
  `no data`/`unknown`. Because `'no data'` is now only reachable via a dictionary
  key (`common.noData='—'`), no screen can print the English words.
- **N2 (CategoryPanel country) — FIXED & CONSISTENT.** AAPL: CategoryPanel
  `國家／地區=美國`, ProfilePanel `國家／地區=美國` — **they agree**.
  `GET /api/categories?symbols=AAPL` → `{country:"United States",
  countryFromProfile:true, sector:"Technology", exchange:"NASDAQ"}`. `SPY` →
  `country:null` (honest). `0700.HK` → `country:"China", countryFromProfile:true`
  (from its cached `quoteSummary` profile, `country:"China"`); the UI renders
  `中國` in **both** panels — consistent, and provenance-flagged rather than
  invented. `countryLabel()` (`shared/i18n/terminology.ts`) resolves through one
  `COUNTRIES_ZH` table used by both panels.
- **N3 (screen-reader duplication) — FIXED.** Badge `text="快取 · 啱啱"`,
  `title="呢個數字對上一次由數據商拿取嘅時間。"` — the age appears **once**;
  the title carries only the explanation and contains no age token.
- **N4 (dead `shared/glossary.ts`) — FIXED.** File absent from the tree; present
  in `~/.Trash/glossary.ts` (3947 B). `grep -rn` for
  `glossary'`/`UI_GLOSSARY`/`INDICATOR_GLOSSARY` across `src server shared tests
  scripts` → **no imports** (only unrelated `help.glossary.title` dict keys).
  `zh-HK.ts` contains **no** bare English time words.

## 5. No regression

- **Phase 1 chart controls:** 246 bars; canvas painted (19 colours); overlays
  `sma20` 19→33, `bb` 33→59; panes `rsi` 59→57, `macd` 57→60, `volume` 60→62;
  range `1mo` 246→147; interval `1w` 147→5. All redraw.
- **Five screens** present; **horizontal overflow 0px** at 390 / 834 / 1600 on
  all five screens (15 checks).
- **Clean-session console:** 0 console errors, 0 page exceptions, 0 HTTP ≥ 400.
  `evidence:chart` independently reports 0/0/0 + 0 React warnings.

## 6. The builder's "71 passed / 4 failed, all reporter-side" claim — **CONFIRMED**

I re-ran the builder's exact procedure with a byte-identical copy
(`qa-browser-copy.ts`) on my own server: **71 passed / 4 failed** — reproduced.
I judged each of the 4 from the app's own behaviour, not by trusting the claim:

| Failing assertion | My conclusion | Evidence |
|---|---|---|
| `invalid fundamentals symbol rejected (4xx)` → HTTP 200 | **Harness premise wrong** | `GET /api/fundamentals/ZZZZZZ` → 200 with `profile/keyStats/health/quoteType/currency` all `null` — the §G-mandated *honest empty*. The app's real rejection path works: `/api/fundamentals/a b;c` → **HTTP 400 `BAD_SYMBOL`**. |
| `valid-but-unpublished fundamentals returns honest empty` | **Harness premise wrong** | SPY *has* real fundamentals (`trailingPE 23.32`, `dividendYield 0.0074`, `dayHigh/Low`, `volume`…) — not empty. |
| `zero console errors` → 1 (`… 400`) | **Harness-caused** | `console-probe.ts`: 0 errors before the harness's *own* `/api/news/@@bad@@` call, **1** immediately after. That 400 is the test's negative probe. |
| `zero failed requests` → 8 `net::ERR_ABORTED` | **Harness-caused** | `abort-probe2.ts` isolates it: a plain load = **0**; 5-screen navigation = **0**; rapid range/interval toggles = **0** (`abort-probe.ts`); only the harness's own `gotoFresh()` (`goto()` + immediate `reload()` mid-fetch) = **4**. The aborts are the SPA's first load cancelled by the test's reload. |

`qa-console-copy.ts` — a clean session, no deliberate bad calls, no reloads —
reports `consoleErrs:[] pageErrs:[] failed:[] badResponses:[]`. **Conclusion: all 4
are reporter-side artefacts, not app defects.** No genuine app defect is hidden
behind them.

## 7. Residual findings (non-blocking)

### N5 — `npm run verify:runtime` is FLAKY (2 of 5 observed runs failed)

- **Observed:** runs 1 and 5 → `✗ runtime verification FAILED — 92 passed, 1 failed
  • a second fundamentals call is served from cache (not re-fetched) — first=unavailable second=live`.
  Runs 2, 3, 4 → `✓ … PASSED — 95 checks`.
- **Spec clause:** §A.4 / §J — gates must run and pass with pasteable output;
  a gate that fails ~40% of the time is not a reliable gate.
- **Root cause (traced):** the check reads `verify-runtime.ts:337`:
  `fundDocs.data?.source === 'live' ? fundDocs.data.source === f?.source : true`.
  On a **cold/stale crumb**, the first `loadFundamentals()` call's `quoteSummary`
  fetch fails, returns `{source:'unavailable'}` and caches nothing
  (`server/phase2-service.ts:158` only caches *usable* payloads); the immediate
  second call re-mints the crumb, succeeds, and returns `{source:'live'}`.
  So `first=unavailable second=live` trips the assertion — which is only
  meaningful when the first call was itself `live`. The failure is a race
  between crumb minting and the assertion, not a caching error: when the first
  call is `live`, the second is always `cache` (verified: fresh DB, call 1 `live`
  → calls 2–4 `cache`).
- **Impact:** transient only. The user-visible path degrades honestly
  (`source:'unavailable'`, translated `note.fundamentalsUnavailable`, all-null
  stats → `—`) and a refresh recovers. No invented numbers, no crash.
- **Suggested repair (builder's call, outside my read-only boundary):** make the
  assertion tolerant of a cold crumb (e.g. skip when `first === 'unavailable'`,
  or warm the session first), so the gate measures caching rather than the
  crumb race.
- **Why not blocking:** the i18n/B1/N1–N4 scope is unaffected; the gate passes on
  re-run; the underlying behaviour is honest. It is a gate-determinism defect,
  not a feature defect.

**Minor (informational, not a defect):** `ZZZZZZ` (well-formed, unpublished)
returns 200 all-null rather than 4xx. That matches §G's "degrade honestly — show
『—』/ 暫無資料" and §J's explicit allowance that unverified paths are stated, not
implied; the real malformed-symbol path returns 400. So the prior harness's 4xx
expectation was simply wrong. No action required; noting for the record because
the builder's table calls it out.

## 8. SPEC-PHASE2 §A criteria table (updated, reviewer-observed)

| # | Criterion | Verdict | Evidence (this re-run) |
|---|---|---|---|
| 1 | `npm run build` exit 0, no warnings | ✅ PASS | `build.exit=0`; 67 modules; no warning lines |
| 2 | `npm test` green + i18n/news/fundamentals/categorisation tests | ✅ PASS | 10 files / 202 tests; `no-hardcoded-strings` now **8** (incl. `shared/` scan) |
| 3 | `npm run lint` clean | ✅ PASS | `LINT_EXIT=0`, 0 bytes output |
| 4 | `verify:runtime` extended | ⚠️ **PASS but FLAKY (N5)** | 95 checks; 2/5 runs failed the fundamentals-cache check (crumb race) |
| 5 | `evidence:chart` covers dashboard + language switch | ✅ PASS | 82 checks; 0 console errors/exceptions/failed requests |
| 6 | zh-HK DEFAULT; instant toggle; **no hard-coded strings** | ✅ **PASS** | default/toggle/persistence ✅; **B1 RESOLVED** — 0 English time words across all 5 zh-HK screens; `shared/` now scanned |
| 7 | Independent QA PASS | ⚠️ **PASS-WITH-FINDINGS** | this report |
| §B | Every user-facing string translated; same key set | ✅ PASS | key parity ✅; age buckets in dict ✅; `'no data'` gone (N1) ✅; zh-HK dict has no English time words |
| §B | Double-suffix / awkward concatenation | ✅ PASS | 0 hits; `auditDictionaries().doubleSuffix` guard is real (mutation-verified) |
| §C | Sidebar/hierarchy; no overflow @390/834/1600 | ✅ PASS | 0px on all 5 screens × 3 widths |
| §C | Phase 1 controls still work | ✅ PASS | overlays/panes/range/interval all redraw |
| §D | Categorisation by real metadata; honest Unknown; grouping persists | ✅ PASS | AAPL stock/Technology/NASDAQ; SPY ETF→未分類; 0700.HK HKEX |
| §E | Profile/key/health/range/category panels populated | ✅ PASS | real numbers; country consistent (N2) |
| §F | Real news, real URLs, honest empty, HKT relative time | ✅ **PASS** | real items/URLs; honest empty; **relative time now Chinese (B1 fixed)** |
| §G | Degrade honestly; no credential leakage | ✅ PASS | ZZZZZZ→all-null 200; malformed→400; no crumb/cookie in payload |

## 9. UNVERIFIED / limits

- **Live upstream fidelity:** numbers were not re-fetched from Yahoo by me
  directly; cross-checks are from the app's own API payload. The N5 crumb race
  shows the upstream session is not perfectly deterministic, so record
  freshness/reliability of the live path is the weakest link.
- **Cross-browser / real device:** headless Chrome only (system Chrome binary);
  no Safari/Firefox, no physical iOS/Android.
- **§H design rationale:** `DESIGN-PHASE2.md` not assessed against Dribbble (out
  of scope; no external fetch).
- **Long-tail i18n:** the sweep covers the five screens in their default states
  plus the badge/news render sites; rarely-hit branches (every error toast,
  every tooltip) were not each rendered. The extended `shared/` scan reduces —
  but does not eliminate — this class.

## 10. Evidence index (all mine)

| File | What |
|---|---|
| `qa-rerun.ts` / `qa-rerun.log` / `qa-rerun-report.json` | fresh 70-check harness (B1, N1–N4, regression, overflow, console) |
| `final-sweep.ts` / `.log` | exhaustive no-exclusion English-time sweep, 5 screens → 0 hits |
| `abort-probe.ts`, `abort-probe2.ts` / `.log` | isolates `net::ERR_ABORTED` to the harness's own reload |
| `console-probe.ts` / `.log` | attributes the 1 console 400 to the harness's own bad-symbol call |
| `mutation-check.ts` / `.log` | proves the double-suffix guard is non-vacuous |
| `shared-scan-replica.ts` / `.log` | replicates + mutates the extended `shared/` scan |
| `qa-browser-copy.ts`, `qa-console-copy.ts` (+ logs/jsons) | byte-identical copies of my prior harness, re-run here → 71/4 reproduced |
| `build.*`, `test.*`, `lint.*`, `verify-runtime*.log`, `evidence-chart.log` | gate output |
| `qa-server.ts` (in `qa-phase2-1435/`, mine) / `qa-server.log` | server launcher + boot log |
