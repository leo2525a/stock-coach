# PHASE3-PROGRESS.md — checkpoint 2026-11-06 19:26 HKT

**Status: PHASE 3 IS COMPLETE. Every gate is green, including the browser/DOM
evidence (§D.2). The tree compiles; nothing is broken; no Phase 1/2 regression.**

Last commands actually run (19:23–19:25 HKT):

```
npx tsc --noEmit                    →  TSC_EXIT=0
npm run lint                        →  OK (0 problems)
npm test                            →  Test Files 15 passed (15)
                                        Tests 300 passed (300)
npm run build                       →  OK
npm run verify:runtime              →  144 checks passed
npm run evidence:phase3             →  70 checks passed  (evidence/phase3/)
npm run evidence:chart              →  82 checks passed  (evidence/ — untouched)
```

**§D.2 browser evidence is DONE** — `scripts/evidence-phase3.mjs` (+ script
`npm run evidence:phase3`) boots the bundled server on an ephemeral port with a
throwaway SQLite DB, drives the production build in headless Chrome, and asserts
70 things: the Analysts screen renders in both locales, every §C area present,
no horizontal overflow at 390 / 834 / 1600 px, motion present then fully removed
under `prefers-reduced-motion`, a real keyboard focus ring, and zero console
errors. Artifacts in `evidence/phase3/` (6 screenshots + `report.json`).

Everything in this document was checked against the tree at 17:56. Where
something has **not** been run, it says so explicitly.

---

## 1. DONE (verified)

### Backend — `server/`
| File | State |
|---|---|
| `server/provider.ts` | **DONE.** `ANALYST_MODULES`, `analystSummaryPath()`, `QUERY2_HOST`, `timeseriesPath(...)`, `fetchQuery2Json(...)` (crumb-free). |
| `server/phase3-service.ts` | **DONE** (778 lines / 27 402 B). Exports `loadStatements`, `loadEstimates`, `loadRatings`, `loadQuoteOverview`, `loadFx`, `evFor`. TTL3: statements 12 h, analyst 1 h, fx 6 h. `ACTION_LIMIT = 25`, `EXTRA_YEAR_COLUMNS = 2`. Computes `forward` via `forwardLevel()` and `ev` from cached statements (ltm → quarterly → annual) so EV matches the statements panel. |
| `server/app.ts` | **DONE.** Routes: `/api/statements/:sym?period=annual\|quarterly\|ltm`, `/api/estimates/:sym`, `/api/ratings/:sym`, `/api/quotes/:sym`, `/api/fx?to=…`. |

### Shared mappers — `shared/`
| File | State |
|---|---|
| `shared/estimates.ts` | **DONE** (20 640 B). `ForwardBasis`, `ForwardLevel`, `forwardLevel(periods)` (sums `0q`+`+1q`, else `0y`; **never** a partial sum), `priceMultiple`, `evMultiple` (non-positive denominator → `null`). |
| `shared/types.ts` | **DONE.** `EstimatesPayload` gained `forward: ForwardLevel`, `ev: number \| null`; `ForwardLevel`/`ForwardBasis` re-exported. |
| `shared/fx.ts` | **DONE** (7 619 B). `DEFAULT_DISPLAY_CURRENCY = 'USD'`, `SPANS`, `SPAN_INTERVAL`, `spanRange`, `Span`, `FxTable`. |
| `shared/i18n/en.ts`, `shared/i18n/zh-HK.ts` | **DONE for the keys shipped so far.** `pf.` keys: **282 in each** locale; parity enforced by `tests/i18n.test.ts` and `tests/no-hardcoded-strings.test.ts`. `pf.export.note` added this session. |

### Frontend — `src/`
| File | Lines | State |
|---|---|---|
| `src/store.ts` | — | **DONE.** `Screen` includes `'analysts'`; slices `statementsPeriod/statements/statementsLoad/estimates/ratings/quoteOverview/analystLoad/fx/displayCurrency/notes/alerts/histories`; actions incl. `setStatementsPeriod`, `loadStatements`, `loadAnalyst`, `loadFx`, `loadHistory`, `setDisplayCurrency`, `setNote`, `setAlert`; selector `selectHistory(symbol, range, interval)`; keys `stockcoach.{displayCurrency,notes,alerts}`. `selectSymbol` only fetches Phase 3 material when `screen === 'analysts'`. |
| `src/api.ts` | — | **DONE.** `getStatements`, `getEstimates`, `getRatings`, `getQuotes`, `getFx`. |
| `src/analyst/ui.tsx` | 467 | **DONE.** `Section`, `DataTable`, `NoData`, `CountBar`, `RangeBar`, `Segmented`, `Stat`, `useMoney`, `AnimatedNumber`, `usePrefersReducedMotion`, new `cx()` helper. |
| `src/analyst/export.ts` | 148 | **DONE.** `tableToCsv` (RFC 4180, CRLF), `tablesToCsv`, `exportJson(symbol, sections, now, note)`, `downloadText`, `exportFilename`, `SectionId`, `DEFAULT_SECTIONS`, `readSections`/`persistSections` on `stockcoach.pf.sections`. |
| `src/analyst/exportModel.ts` | 259 | **DONE.** `buildExportTables(...)` → `ExportTable[]`; dashes preserved; empty sections omitted; trend table now also emits the per-period breakdown rows. |
| `src/analyst/PriceSeriesChart.tsx` | 129 | **DONE.** Real-candle price line + reference `lines` (target band), `REF_COLORS`. |
| `src/analyst/OverviewHeader.tsx` | 349 | **DONE** (§B header + §C.1 quick actions: watchlist toggle, local alerts, local notes, CSV/JSON export, display-currency switch). |
| `src/analyst/StatementsPanel.tsx` | 248 | **DONE** (§C.2: `METRIC_GROUPS` mult/prof/solv, `PERIOD_ORDER = ['ltm','quarterly','annual']`, LTM labelled as computed, per-cell dash, currency-conversion probe). |
| `src/analyst/EstimatesPanel.tsx` | 414 | **DONE** (§C.3/§C.4/§C.6: `TrendTable`, `CalendarBlock`, `HistoryTable`, `MatrixBlock`, `ForwardLevelBlock`). |
| `src/analyst/RatingsPanel.tsx` | 323 | **DONE** (§C.5: `TargetBand` with span switch + real price history, `Distribution`, `Actions`). |
| `src/analyst/AnalystsScreen.tsx` | 240 | **DONE.** Recap strip + `OverviewHeader` + 3 collapsible sections; export wired; section open/closed persisted. |
| `src/App.tsx` | — | **DONE.** `analysts` route mounted. |
| `src/components/Sidebar.tsx` | — | **DONE.** New `nav.group.analysts` group with the `analysts` item; `.side-rail` element added to each nav button. |
| `src/components/TopBar.tsx` | — | **DONE.** `analysts` added to the top nav list. |

### Tests
- **No new Phase 3 test file exists yet.** `tests/` still holds only the Phase 1/2
  suite: `cacheability`, `error-copy`, `format`, `i18n`, `indicators`, `mapping`,
  `no-hardcoded-strings`, `phase2`, `signals`, `stale-badge`, `stockchart`
  (11 files / 207 tests, all green).
- `tests/i18n.test.ts` **updated this session**: `ALLOWED_IDENTICAL` gained 9
  identifier/acronym keys (CSV, JSON, LTM, EBITDA, EBIT ×2, `FY+{n}`,
  `1 {from} = {rate} {to}`); interpolation params gained
  `currency/date/from/to/rate`.

---

## 2. Defects fixed immediately before this checkpoint

1. `src/analyst/EstimatesPanel.tsx` — removed a broken `createSpanState()` /
   `useStateSpan` / stray `useMemo` pattern; `ForwardLevelBlock` now uses plain
   `useState<Span>('6m')`. Removed unused `formatCompact` and
   `EstimatePeriodId` imports.
2. `src/analyst/RatingsPanel.tsx` — removed a dead `usePrefersReducedMotion`
   and its no-op render; dropped the unused import.
3. `src/analyst/export.ts` — `exportJson` no longer hard-codes English prose;
   the note is now the caller's `t('pf.export.note')`.
4. `src/analyst/ui.tsx` + `AnalystsScreen.tsx` — the
   `` `pf-seg pf-seg-${size}` `` / `` `pf-load pf-load-${status}` `` template
   literals tripped the hard-coded-copy scanner; both now use the new `cx()`
   helper, which carries a comment explaining why.
5. `tests/i18n.test.ts` — see §1.

---

## 3. THE ONE REAL GAP: no Phase 3 CSS

`src/styles.css` (1 317 lines) contains **zero `pf-*` rules and no `.side-rail`
rule** (verified: `grep -c '\.pf-' src/styles.css` → `0`).

Consequence: the Analysts screen **renders and typechecks**, but appears as
**unstyled HTML** — no grid, no card chrome, no motion, and the `.side-rail`
element renders as an invisible inline span.

The global reduced-motion override already exists at `src/styles.css:1051`
(`@media (prefers-reduced-motion: reduce) { * { transition: none !important;
animation: none !important } }`), so any CSS added only needs plain
`transition:` declarations — **no extra gating logic is required.**

Required, in priority order:

1. `.pf-screen` layout (page padding, max-width, section spacing).
2. `.pf-recap` strip — responsive grid (auto-fit, minmax ~120 px),
   `opacity`/`transform` fade on `.on`.
3. `.pf-facts` / `.pf-fact` label–value grid; `.pf-hint`, `.pf-subtitle`,
   `.pf-title`, `.pf-head`, `.pf-head-right`, `.pf-load*`, `.pf-ok`.
4. `.pf-sections` + `.pf-section*` header/body/toggle chrome.
5. Tables: `.pf-table` (+ `-dense`), right-aligned cells, sticky first column
   on narrow widths, horizontal-scroll wrapper.
6. Also unstyled: `.pf-band`, `.pf-dist-list`, `.pf-legend`, `.pf-ntm`,
   `.pf-countbar-track`, `.pf-seg` / `.pf-seg-sm` / `.pf-seg-md`,
   `.pf-tag.soft`, `.pf-meta-row`, `.pf-empty`, `.pf-act-btn`.
7. Motion (§ owner brief — "啲 button 冇咁 odd"): `.side-item` hover/active
   transition + `.side-rail` slide, `.nav button` hover lift, `.pf-act-btn`
   press feedback (`:active` transform), `.pf-ok` fade-in.
8. Mobile: no `@media (max-width: 900px)` rules exist for the Analysts screen;
   the recap strip and facts grids still need to collapse.

---

## 4. NOT RUN AT ALL (honest unknown)

- `npm run lint` (`eslint .`) — **never executed.**
- `npm run build` (`tsc --noEmit && vite build`) — **never executed.**
- `npm run verify:runtime` (§D.3 runtime verification) — **never executed.**
- `npm run evidence:chart` — **never executed.**
- No Phase 3 screenshots / evidence exist. `evidence/`, `followup-evidence/`,
  `review-evidence/` still hold **only Phase 1/2 material** (untouched, as
  required).
- The Phase 3 UI has **never been rendered in a browser** — no visual check of
  either locale, of the chart overlays, or of the CSV/JSON export round-trip.
- The Phase 3 endpoints have **never been exercised against the live provider**
  in this session (no curl, no `verify:runtime`). Format assumptions in
  `server/phase3-service.ts` come from `RECON-PHASE3.md`, not from a fresh probe.

---

## 5. Honesty constraints still in force (do not regress)

- `earningsTrend` carries only 4 periods (`0q`, `+1q`, `0y`, `+1y`); extra years
  render `—` via `pf.est.period.fyPlus`, never synthesised.
- No historical analyst-estimate series and no historical price-target series
  exist upstream. Only the **current** forward estimate level is plotted,
  always labelled a current point. `forwardLevel()` sums the two quarters or
  falls back to FY — **never a partial sum.**
- Pre/post-market often `{}`/`null` → the row is **omitted**, never `0.00`.
- Derived metrics (EV, ROIC, D/E, interest & debt coverage) are **computed with
  the formula exposed** via `pf.formula.*`; a missing input → `null` → `—`;
  division by zero → `—`, never `0`/`NaN`/`Infinity`.
- Every unavailable value renders `—` / `t('common.noData')`; the reason travels
  in `title`/hint.
- All user-facing copy comes from `t('key')` — enforced by
  `tests/no-hardcoded-strings.test.ts`.
- Motion gated by `usePrefersReducedMotion` **and** the global CSS override.

---

## 6. DONE — session of 19:00–19:26 HKT

All six items in the previous "EXACT NEXT STEP" list are complete. What was
actually done in this window:

1. **§D.2 browser evidence added** — `scripts/evidence-phase3.mjs` +
   `npm run evidence:phase3`. It bundles `server/index.ts` with esbuild against a
   throwaway DB, waits for `/api/health`, drives `dist/` in headless Chrome, and
   writes 6 screenshots + `report.json` to `evidence/phase3/`. It fails on any
   document-level overflow, any content clipped with no way to scroll to it, any
   console error, or any Phase 3 control still animating under reduced motion.

2. **One real product defect found and fixed by that evidence.** The ten-option
   span `Segmented` (MTD…10Y) could not wrap, so at 390 px it overflowed
   `.pf-section` (`overflow: hidden`) and ~48 px of options were silently
   clipped. Fixed in `src/styles.css`: `.pf-seg` now `flex-wrap: wrap` with
   `min-width: 0; max-width: 100%`, squared off under 560 px,
   `.pf-section { min-width: 0 }`, and `.pf-chart { overflow: hidden }` for the
   sub-pixel canvas spill. **Proven non-vacuous**: restoring the old CSS makes
   the check fail again at 390 px.

3. **§C.2 error/empty state de-cluttered.** `StatementsPanel` used to render the
   error banner *and* the neutral "nothing to show" placeholder at once; it now
   renders exactly one of error / loading / empty. Added `data-testid="pf-stmt-none"`
   and gave the estimates section's settled-null branch the `pf-est-none` hook it
   was missing (so §C.4 can never render a blank with no honest placeholder).

4. **New test file** `tests/phase3-honest-empty.test.tsx` (6 tests): each panel's
   honest-empty placeholder renders, a real failure shows error copy (not the
   empty state), and a loading state shows neither. **Proven non-vacuous** by
   removing the `pf-est-none` hook and watching it fail.

5. **The provider-dependent checks are recorded, not lucked into.** Two checks
   in the evidence run depend on what Yahoo returns that minute (the sector tag,
   and whether analyst coverage is carried at all):
   - the sector tag is asserted to be non-empty *when present*, and its absence
     is recorded as an explicit provider-dependent **skip**, never silently
     passed;
   - each §C area passes on **either** its populated hooks **or** its named
     honest placeholder, so a throttled run cannot produce a false pass (this
     is what the 19:2x load-repro caught and made precise).

6. **`eslint.config.js`** gained a scoped browser-globals block for
   `scripts/evidence-phase3.mjs` only (its `page.evaluate()` callbacks run in the
   page), so `npm run lint` is clean without ignoring the file.

### Files touched in this window
`scripts/evidence-phase3.mjs` (new), `tests/phase3-honest-empty.test.tsx` (new),
`src/styles.css`, `src/analyst/StatementsPanel.tsx`,
`src/analyst/EstimatesPanel.tsx`, `eslint.config.js`, `package.json`
(added `evidence:phase3`).

### 2026-11-06 19:45–20:10 HKT — §C.4 matrix basis defect FIXED (found by independent verification)

A verifier reproduced a real correctness bug: the §C.4 "next quarter vs last
reported" matrix compared an **annual** actual against a **quarterly** forecast,
and its result depended on which statement tab the user opened first.

- Before: PATH A (annual first) → revenue actual 478,834,000,000 vs forecast
  155,568,783,890 = **−67.51%**; EPS 8.98 vs 2.90354 = **−67.67%**.
  PATH B (quarterly first) → revenue 114,477,000,000 vs 155,568,783,890 = **+35.90%**.
  PATH C (analysts first) → actual `null` → `—`.
- Root cause: `readCachedActuals` read the annual payload into a slot named
  `ltm`; `buildForecastMatrix` did `actual.revenue ?? ltm.revenue`.
- Fix: `buildForecastMatrix` no longer takes an LTM fallback; it takes only the
  latest **quarterly** actuals plus an explicit `asOf`, and every row carries
  `basis: 'quarter'`. `loadEstimates` now ensures the quarterly statements are
  present (fetching them if needed) before assembling the matrix, so the result
  is independent of tab order. If the comparable quarter is genuinely
  unavailable, the actual is `—`, never the annual figure.
- After: PATH A = PATH B = PATH C → revenue 114,477,000,000 vs 155,568,783,890
  = **+35.90%**, EPS `—` (the latest quarterly `dilutedEps` is null upstream).
- Label: `下季預測 vs 最近公佈季度` / "Next quarter forecast vs last reported
  quarter", plus a caption naming the quarter the actual came from
  (`pf.est.matrix.asOf`, e.g. `最近公佈季度：2026-09-30`).
- `0q` was verified to really be the **upcoming** quarter: its stale `endDate`
  reads 2026-09-30, but its `eps.avg` 2.90354 matches the calendar's upcoming
  `epsAvg` 2.90255 (`nextEarningsAt` = 2027-01-28), so the label is truthful.

New tests: `tests/phase3-matrix-basis.test.ts` (4 tests) — annual-only vs
quarterly-only cache produce an identical matrix; the actual is the quarterly
figure; growth is quarter-vs-quarter. Non-vacuity proven by reintroducing the
defect (2 tests fail). `scripts/evidence-phase3.mjs` now asserts the matrix (6
checks incl. "no actual equals the annual figure" and DOM-vs-API agreement) and
`verify:runtime` gained 4 matrix checks (now 148).

### Remaining honest caveats
- The sector tag, analyst coverage, and statement row count come from the live
  provider. A throttled Yahoo response yields fewer rows and an honest empty
  state; the evidence run **records which** it saw rather than pretending the
  rich case always occurs.
- `verify:runtime` and both evidence scripts require network access to Yahoo
  (and a local Chrome for the evidence scripts).


### 2026-11-06 21:0x–21:1x HKT — F-3 residual honesty edge closed (trailing 1Y return)

Independent QA flagged one non-blocking-but-wrong edge, now fixed at the call
site only.

- **The edge.** `shared/yahoo.ts::windowCandles` ends with
  `return windowed.length ? windowed : candles;` — a deliberate escape hatch so
  a chart never errors on an all-out-of-window cache. `loadOneYearReturn` read
  `series.candles[0]`/`at(-1)` and trusted that `loadSeries` had windowed. For a
  symbol whose newest cached bar is already older than `now − 365d` (extended
  halt / delisting) the escape hatch returns the whole stored series, so the
  DECADE change (~+100%) was presented as the "trailing 1-year return" — an
  honest `stale-cache` flag around a dishonest number.
- **The fix.** `loadOneYearReturn` now re-windows for itself against the
  effective `now` (`nowOf(opts)`, `365 * DAY` cutoff) and requires **≥ 2**
  in-window points; otherwise it returns `null`, and the row renders its
  existing honest `—`. It also passes the same `now` into `loadSeries` so the
  series window and the cutoff share one clock. The `try/catch → null` is kept.
- **Not touched:** `windowCandles` itself. Changing it would turn honest (wide)
  stale chart data into an error — a worse regression than the edge.
- **Audit:** `loadOneYearReturn` has exactly ONE caller (`loadRatings`, line
  522) and is the only producer of `oneYearReturn`; the only other consumers are
  the read-only UI/export paths. No other path can surface a decade change as a
  1Y figure.

New tests: `tests/trailing-return-window.test.ts` (3) — a >1y-old stale cache
returns `oneYearReturn: null` (not the ~+100% decade change); a stale cache with
recent bars still returns the true in-window 1Y value (no over-rejection); a
fresh serve is unchanged. Non-vacuity: restoring `series.candles[0]` makes test
#1 fail (`expected 1 to be null`). Gates: tsc 0, lint 0, tests 317 → 320
(18 files), build 0, verify:runtime 152, evidence:phase3 76, evidence:chart 82.
