# Independent QA — Stock App v1, PHASE 2

Reviewer: `debug-reviewer` (subagent) · Requester: `debug-debug_lead` · Date: 2026-11-06
Artifact: `/Users/love21/.openclaw/workspace/debug-coder/projects/stock-app`
Binding specs: `./SPEC-PHASE2.md`, `./SPEC.md`

> All evidence below was produced by the reviewer. The builder-modified
> `./review-evidence/browser-check.ts` was treated as BUILD-OWNED and **not** used
> as evidence. The reviewer's own harness lives in
> `./review-evidence/qa-phase2-1435/`.

## VERDICT: **PASS-WITH-FINDINGS**

All five declared gates are green and were re-run by the reviewer with observed
output. Phase 1 has not regressed. The i18n default, toggle and persistence are
correct; categorisation, dashboard and news are real data; data-honesty degrades
correctly. **One concrete Phase 2 spec violation remains** (§A.6 / §B / §F):
several user-facing relative-time strings are hard-coded English and render
inside the Chinese UI. The builder's own "no hard-coded strings" gate is
structurally unable to catch it (it does not scan the shared formatter layer).

---

## 1. Gates re-run by the reviewer (observed output)

| Gate | Command | Observed |
|---|---|---|
| Build | `npm run build` | `BUILD_EXIT=0`; `✓ 67 modules transformed`; `dist/assets/index-YuVqYQAN.js 522.94 kB │ gzip: 165.22 kB`; `dist/assets/index-DW7FAXh8.css 18.19 kB`; `✓ built in 1.03s`; PWA `precache 16 entries (542.80 KiB)`. No errors/warnings. (`build.log`, `build.exit`) |
| Tests | `npm test` | `Test Files 10 passed (10)`, `Tests 192 passed (192)`, `Duration 2.11s`. (`test.log`) |
| Lint | `npx eslint .` | `LINT_EXIT=0`, no output. (`lint.log`) |
| Runtime | `npm run verify:runtime` | `EXIT=0`, `✓ runtime verification PASSED — 95 checks`. (`verify-runtime.log`) |
| Chart evidence | `npm run evidence:chart` | `EXIT=0`, `✓ browser evidence PASSED — 76 checks`, `0 console errors`, `0 exceptions`, `0 failed network requests`; overflow 0px @390/834/1600. (`evidence-chart.log`) |
| Typecheck | `tsc --noEmit -p tsconfig.json` | clean, `TSC_CLEAN=0` (tree is coherent, not half-migrated) |

Per-file test counts (Phase 1 files all present and green):
`format` 24 · `no-hardcoded-strings` 5 · `mapping` 33 · `phase2` 33 ·
`indicators` 17 · `signals` 40 · `i18n` 17 · `error-copy` 8 ·
`stale-badge` 7 · `stockchart` 8.

**Reviewer's own harness** (`BASE=http://127.0.0.1:8797 node_modules/.bin/tsx …`),
real app booted on a throwaway SQLite DB, port 8797:
- `qa-browser.ts` → **67 passed / 8 failed**, but 5 of the 8 fails are the
  reporter's own over-broad assertions (see §6), leaving the real defects below.
- `qa-console.ts` (clean session, no reloads, no deliberate bad requests) →
  `consoleErrs: []`, `pageErrs: []`, `failed: []`, `badResponses: []`.

---

## 2. BLOCKING finding

### B1 — Hard-coded English relative-time strings render inside the zh-HK UI

- **Location:** `shared/format.ts:99-106` (`humanAge()`), consumed by
  `src/components/TopBar.tsx:170,175` (`SourceBadge`) and
  `src/components/NewsPanel.tsx:74`.
- **Spec clause:** SPEC-PHASE2 §A.6 (*"No hard-coded user-facing strings left
  outside the translation layer"*), §B (*"Translate **every** user-facing string
  … error/stale messages … timestamps stay HKT and are labelled"*),
  §F (*"relative time (HKT)"*).
- **Observation (reviewer's browser run, zh-HK default):**
  - Source badge: `"快取 · 7 min ago"` (chart/signals/dashboard); its tooltip is
    the grammatically broken `"7 min ago前更新"`.
  - News item meta: `"… | · 1 h ago前更新 | 提及 AAPL | 開啟原文 ↗"`.
  - The words `min ago` / `just now` are baked into the shipped bundle:
    `grep -o "just now\|min ago\| h ago\| d ago" dist/assets/index-YuVqYQAN.js`
    → each present.
- **Repro:**
  ```
  grep -n "min ago\| h ago\|just now" shared/format.ts        # hard-coded English
  # then run the app in zh-HK and read [data-testid="source-badge"] / .news-meta
  ```
- **Root cause:** `humanAge()` returns literal English (`'just now'`,
  `` `${n} min ago` `` …) and is rendered raw; it is never routed through `t()`.
- **Why the builder's gate missed it:** `tests/no-hardcoded-strings.test.ts`
  scans **only** `src/` (explicitly `SRC = path.join(ROOT,'src')`) and
  `tests/i18n.test.ts` only compares the two dictionary objects. The shared
  formatter is outside both, so the "no hard-coded strings" criterion passes
  vacuously for that whole layer.
- **Repair:** make the age rendering locale-aware — e.g. move the buckets into
  keys (`age.justNow`, `age.min`, `age.hour`, `age.day` with `{n}`) and have
  `SourceBadge`/`NewsPanel` call `t()`; or pass the translator/`lang` into the
  formatter. Then extend `no-hardcoded-strings` (or add a dedicated test) to
  cover `shared/`, so the guarantee survives.

---

## 3. NON-BLOCKING findings

- **N1 — Same class of defect latent in the shared layer.** `shared/format.ts`
  returns literal `'no data'` (and `'unknown'`) for missing values. It was not
  observed leaking on the screens exercised (the numeric panels render 「—」 via
  `common.noData`), but it is an untranslated shared-layer string one data path
  away from the screen. Fold into the B1 repair.
- **N2 — CategoryPanel country always 未知.** `/api/categories` returns
  `country: null` for every symbol (AAPL/NVDA/SPY/0700.HK all `null`), so
  國家／地區 is permanently 「未知」 in the category chips. This is *honest* (not
  invented), but the field is dead weight, and it is **inconsistent** with
  `ProfilePanel`, which shows country "United States" for AAPL from
  `quoteSummary`. Either populate it from the profile source or drop the row.
  Spec §E lists "classification chips: type / sector / industry" (country is not
  required), so this is polish, not a blocker.
- **N3 — Screen-reader duplication in the source badge.** `SourceBadge` renders
  the raw age as visible text (` · ${age}`) *and* embeds it in the `title`, so
  the accessible text is "快取 · 7 min ago" even after B1 is fixed. Render the
  age text as one translated unit.
- **N4 — Dead export.** `shared/glossary.ts` (`UI_GLOSSARY`, `INDICATOR_GLOSSARY`)
  is imported nowhere in `src/`, `server/` or `shared/` (Help uses dictionary
  keys). Pre-existing; harmless, but it is unused surface.

---

## 4. What the reviewer verified as real (not trusting the builder's report)

- **i18n (§B):** clean profile → `<html lang="zh-HK">`, title全中文, sidebar全中文,
  中 active. Top-bar toggle switches nav+`lang`+title both ways **with no page
  reload** (marker survived) and persists `stockcoach.lang`. Help copy genuinely
  differs per locale. zh-HK dictionary is authentic native Cantonese (e.g.
  「呢個係咩 / 而家代表咩 / 要留意咩」, 「對唔住，暫時攞唔到資料」) — high quality,
  not machine-garbled.
- **Responsive (§C):** horizontal overflow **0px** on all 5 screens at
  390 / 834 / 1600px (reviewer's own DOM measurement).
- **Keyboard/focus:** 10/10 tab stops are real controls with a visible focus
  outline; mobile hamburger opens the drawer.
- **Phase 1 chart controls post-refactor:** 251 bars; canvas non-blank (26
  colours); overlay `sma20`, `bb` and panes `rsi`/`macd`/`volume` each redraw;
  range `1mo` reloads a different window (251→155); interval `1w` changes bar
  count (155→5). No regression.
- **Categorisation (§D):** group-by-sector → 「資訊科技」+「未分類」 buckets;
  group-by-type → 「股票」+「交易所買賣基金 (ETF)」; choice persists
  (`localStorage.stockcoach.groupBy='type'`, `aria-pressed=true`) and survives
  reload. Real metadata: AAPL stock/Technology/NASDAQ, **SPY → ETF with sector
  null → 未分類** (honest Unknown, not invented), **0700.HK → stock/HKEX/
  Communication Services**.
- **Dashboard (§E):** all six panels present. Key stats 18 numeric tokens;
  health panel real (淨利率 27.60%, ROE 142.26%, 收入增長 11.70%, 分析師評級 買入);
  52-week marker rendered at `left: 89.9875%`; category chips real.
  **Independent cross-checks** (computed by the reviewer from the API payload):
  `trailingPE × trailingEps = 344.17` == the quoted price; implied shares
  `marketCap / price = 14.53B` (Apple ≈14.6B); 52w position 89.99% == marker
  89.9875%; dividend yield 0.31%, beta 1.089, profit margin 27.60%, ROE 142.26%,
  revenue growth 11.70%, target mean 333.28 — all match SPEC-PHASE2 §G.
- **News (§F):** `/api/news/AAPL` → 6 real items; **6/6** headlines are real
  absolute URLs on `finance.yahoo.com`; no placeholder/fake hrefs; publisher +
  relative time shown. `/api/news/SPY` returns real items; `/api/news/0700.HK`
  and `/api/news/BRK-B` return an **honest empty** envelope (`items:[]`,
  `source:"live"`) — no fabrication.
- **Data honesty (§G):** `/api/fundamentals/ZZZZZZ` → **HTTP 200** with
  `profile/keyStats/health/quoteType/currency` all `null` (honest empty, *no
  invented numbers*). `/api/news/@@bad@@` → **HTTP 400** `BAD_SYMBOL`.
  `/api/fundamentals/AAPL`: no `Set-Cookie`; payload contains no crumb/cookie
  material (`hasCrumb:false`, `hasCookie:false`). Credential flow does not leak.
- **Console (§A.6 / §J):** clean session (initial load + 5 nav transitions +
  both language switches + grouping + chart toggles, no reloads) →
  **0 console errors, 0 page exceptions, 0 failed requests, 0 HTTP≥400.**

---

## 5. SPEC-PHASE2 §A criteria table (reviewer-observed)

| # | Criterion | Verdict | Evidence (reviewer's) |
|---|---|---|---|
| 1 | `npm run build` exit 0, no warnings | ✅ PASS | `build.exit=BUILD_EXIT=0`; log has no warning lines |
| 2 | `npm test` green + new i18n/news/fundamentals/categorisation tests | ✅ PASS | 10 files / 192 tests, incl. `i18n`(17), `phase2`(33), `mapping`(33), `no-hardcoded-strings`(5) |
| 3 | `npm run lint` clean | ✅ PASS | `LINT_EXIT=0`, empty output |
| 4 | `verify:runtime` extended | ✅ PASS | 95 checks; `/api/categories`, sector classification, news included |
| 5 | `evidence:chart` covers dashboard + language switch | ✅ PASS | 76 checks, includes dashboard panels + lang switch |
| 6 | zh-HK DEFAULT; instant toggle; no hard-coded strings | ⚠️ **PARTIAL** | Default/toggle/persistence ✅ (verified); **no-hard-coded-strings ❌ — B1** |
| 7 | Independent QA PASS | ⚠️ **PASS-WITH-FINDINGS** | this report |
| §B | Every user-facing string translated, same key set test | ⚠️ **PARTIAL** | key parity ✅; **relative-time strings ❌ (B1)**; `'no data'` latent (N1) |
| §C | Sidebar/hierarchy; no overflow @390/834/1600 | ✅ PASS | 0px overflow on all screens; drawer works |
| §C | Phase 1 controls still work | ✅ PASS | overlays/panes/range/interval all redraw |
| §D | Categorisation by real metadata; honest Unknown; grouping persists | ✅ PASS | SPY→ETF/未分類; 0700.HK→HKEX; `groupBy` persists |
| §E | Profile/key/health/range/category panels populated | ✅ PASS | numbers present & independently cross-checked |
| §F | Real news, real URLs, honest empty, HKT relative time | ⚠️ **PARTIAL** | real items/URLs/empty ✅; **HKT label renders English (B1)** |
| §G | Degrade honestly; no credential leakage | ✅ PASS | ZZZZZZ→all null; bad symbol→400; no crumb/cookie |

---

## 6. Reviewer's harness: corrected assertions (transparency)

The first `qa-browser.ts` run reported 8 fails. Five were **reporter-side
artefacts**, corrected after investigation:

1. `<noscript>` copy "Stock Coach needs JavaScript enabled…" was counted as a
   leak → dropped `noscript` from the text scan (correct: it *is* an English
   fallback, acceptable).
2. Watchlist "leak" was provider **company names** (Apple Inc., NVIDIA Corp…) →
   provider data, not UI chrome; excluded from the sweep.
3. `ZZZZZZ` "should be 4xx" → the endpoint honestly returns **200 with all-null
   data**, which is the spec-correct behaviour (§G), so my assertion was wrong.
4. `SPY` "should be empty" → SPY **has** real fundamentals; my premise was wrong.
5. "400 console error" was caused by the harness's *own* deliberate
   `/api/news/@@bad@@` call; the clean-session probe shows 0 errors.

The remaining real fails are the B1 English-time leaks.

## 7. UNVERIFIED / limits

- **Live external fidelity:** numbers were not re-fetched from Yahoo by the
  reviewer directly; cross-checks were computed from the app's own API payload.
  Internal consistency is strong (PE×EPS == price), but upstream staleness of
  the cache cannot be ruled out.
- **Cross-browser / real device:** only headless Chrome (system Chrome binary)
  was exercised; Safari/Firefox and physical iOS/Android were not.
- **§H design rationale:** `DESIGN-PHASE2.md` contents were not assessed against
  Dribbble (out of reviewer scope; no external fetch performed).
- **Long-tail i18n:** the leak sweep covers the 5 screens in their default
  states; rarely-hit states (all error branches, every tooltip) were not each
  rendered. B1 proves at least one such gap is real.
