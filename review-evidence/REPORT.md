# Independent QA Review — Stock App v1 (`stock-coach`)

Reviewer: `debug-reviewer` (independent; did not build the artifact).
Requester: `agent:debug-debug_lead:main` (webchat).
Artifact: `/Users/love21/.openclaw/workspace/debug-coder/projects/stock-app`
Spec: `SPEC.md` ("SPEC — Stock App v1 (MVP)"), frozen for Phase 1.
Date: 2026-11-06. All evidence under `./review-evidence/`.

Every claim below is backed by a command + observed output. Where I corrected my
own harness, I say so rather than hide it.

---

## VERDICT: **FAIL**

SPEC §3.7 requires "Independent review by `debug-reviewer` returns **no blocking
findings**", and §5 requires each screen to "fully work". Both are unmet: a
documented, first-class control on the chart (the **sub-pane toggles**) blanks
the chart and the data **never returns** without an unrelated action or a reload.

The failure is invisible to every gate the builder ran — build, unit tests,
lint, the runtime harness, and the builder's own chart harness are all green —
which is exactly why it got through. One blocking defect (B1) and four non-blocking findings.

---

## BLOCKING FINDINGS

### B1. Toggling any chart sub-pane (Volume / RSI / MACD) blanks the entire chart permanently

**Location:** `src/chart/StockChart.tsx`
- chart-build effect: line ~303, deps `[structureKey, precision]`
- data-push effect: line ~354, deps `[candles, indicators, interval, overlays, overlayKey]`

**Violated requirement:** SPEC §5.2 — *"Sub-panes: Volume, RSI(14), MACD. Toggle
each indicator on/off."* and §5 preamble — *"each must fully work"*.

**What happens:** `structureKey` (line 89) encodes the pane flags
`${interval}|${showVolume?'v':'-'}${showRsi?'r':'-'}${showMacd?'m':'-'}`. Toggling
a pane changes only `structureKey`, so the build effect runs: it calls
`chart.remove()` in its cleanup and constructs a **brand-new, empty** chart.
The data-push effect does **not** list `structureKey`, and none of its own deps
changed, so it never re-runs. Result: an empty chart until some other dependency
changes. The builder's own code comment at line ~302 shows they knew
`candles` is omitted from the build effect — but they did not add `structureKey`
to the *data* effect, so the two effects fall out of sync.

**Evidence (reviewer's own runs):**

`review-evidence/pane-probe.log` — canvas distinct-colour count sampled 5× over
2 s after each click:
```
baseline (volume pane on):        [20, 20, 20, 20, 20]   data-bar-count=251
after toggling RSI pane ON:       [1, 1, 1, 1, 1]        data-bar-count=251
after toggling MACD pane ON:      [1, 1, 1, 1, 1]        data-bar-count=251
after toggling SMA 20 overlay:    [1, 33, 33, 33, 33]    (recovers only because overlayKey changed)
after volume pane OFF:            [1, 1, 1, 1, 1]
after volume pane ON again:       [1, 1, 1, 1, 1]
PANE-TOGGLE VERDICT: BLANK (defect reproduced)
```
`review-evidence/scope-probe.log` — confirms it on **both** charts and its recovery paths:
```
=== DASHBOARD chart ===    baseline 20 → RSI 1 → SMA20 32 → MACD 1
=== CHART screen ===       baseline 19 → pane 1 → timeframe 1M 16 → timeframe 1Y 22
=== after full reload ===  21  (only a reload restores it)
```
`review-evidence/browser-check.log` catches the same defect in the main walk
(`✗ toggling "MACD" redraws the chart — 1 -> 1`).

`data-bar-count=251` stays put throughout — the component still *has* the data;
it just never pushes it into the rebuilt chart. So this is not a data problem,
it is a React effect-dependency bug.

**Impact for a beginner:** the Panes row is one of the most visible controls on
the centrepiece screen (SPEC §5.2 calls it out by name). Clicking "RSI" — the
single most common thing a beginner wants — makes the whole chart go blank with
no error message, and it stays blank. They will conclude the app is broken. This
is a shipped, primary-path failure, not an edge case.

**Concrete repair (coder's job, not done by me):** add `structureKey` to the
data-push effect's dependency array at `src/chart/StockChart.tsx:~354`, e.g.
```ts
}, [candles, indicators, interval, overlays, overlayKey, structureKey]);
```
(Alternatively push data from inside the build effect right after constructing
the series.) Then re-verify with a pane-toggle assertion (see N3).

---

## NON-BLOCKING FINDINGS

### N1. Stale state is badged on the chart card, but not on the other displays of the same stale series
On the stale path, `SourceBadge` correctly renders `Stale · 30 d ago ⚠`
(`browser-check.log` step 6), but `TopBar`'s big price (`src/components/TopBar.tsx`)
and the mover strip reuse the same stale numbers without any stale marker.
Reproduce: boot `review-evidence/offline-server.ts` against a warm, expired
cache and compare the TopBar price block to the Dashboard badge. A beginner
reading the top-of-screen price has no cue that it is old. Not blocking because
the number is real (last-known), not invented, and the §7 rule is satisfied
where the badge is shown.

### N2. Mover-strip selection silently changes the "current symbol" headline price
Clicking a mover updates the shared `symbol`, so the TopBar price/name changes to
a symbol whose chart is not on screen. A beginner can misread the header as
belonging to the chart below. Cosmetic/labelling risk; suggest labelling or
scrolling the chart into view. (Lower confidence — flagged from code reading of
`MoverStrip`/store `symbol` coupling; not separately probe-tested.)

### N3. The builder's chart harness cannot catch B1 — the 45/45 "pass" is false assurance
`scripts/evidence-chart.mjs` renders the chart and clicks the toolbar, but greps
show **no reference to RSI / MACD / Volume / pane toggling**. So the harness that
produced the "45/45, 0 console errors" evidence never exercised the exact
control that breaks. Recommend the coder add: click each pane toggle, assert the
canvas still has drawn pixels after a settle delay.

### N4. The acceptance bar allows "green" while a screen is functionally broken
SPEC §3.6 ("zero console errors") passes here — I observed 0 console errors, 0
page exceptions, 0 failed requests on the live session and the offline session —
yet the chart is broken after a normal click. Console cleanliness is necessary
but not sufficient; consider adding "remains functional after each documented
control is used" to the §3 bar.

---

## SPEC §3 CRITERIA TABLE (reviewer-observed)

| # | Criterion | Result | Evidence I observed |
|---|-----------|--------|---------------------|
| 3.1 | `npm run build` zero TS errors, zero warnings | **PASS** | `BUILD_EXIT=0`; vite built 55 modules, PWA precached 16 entries (461.61 KiB), no warnings |
| 3.2 | `npm test` all green | **PASS** | `TEST_EXIT=0`, 4 files, **114/114 passed** (mapping 33, format 24, indicators 17, signals 40) |
| 3.3 | `npm run lint` clean | **PASS** | `LINT_EXIT=0` |
| 3.4 | Runs locally, real ticker + real candlestick chart | **PASS (first paint)** | My Chrome run against `dist/`: HTTP 200, price `344.17 USD`, **251 real bars**, canvas 1082×365 with 19 distinct colours; but see B1 — the chart does not survive pane toggling |
| 3.5 | Every §5 screen exists and is reachable | **PASS (exists/reachable)** | dashboard, chart, signals, watchlist, help all render in `browser-check.log` step 3; **but §5 "each must fully work" FAILS** — B1 breaks a documented control on Dashboard + Chart |
| 3.6 | Zero console errors on any shipped screen | **PASS** | 0 console errors / 0 page exceptions / 0 failed requests (live + offline sessions) — note N4: green yet functionally broken |
| 3.7 | Independent review returns no blocking findings | **FAIL** | B1 is a blocking finding |

Additional spec sections I checked:
- **§6 determinism + real data** — PASS. Hand-computed vs server evidence on real
  AAPL data (`api-adversarial.log`): last close 344.17, SMA50 335.46, SMA200
  298.34 → `ma-trend` bullish; RSI(14) 53.01 → `neutral`; MACD line 2.2923,
  signal 3.0269; two requests **byte-identical**; summary tally 1/2/3 matches cards.
  Nothing hard-coded: injecting a failing upstream yields `stale-cache` with the
  real meta preserved, and *no cache + failing fetch throws* rather than inventing.
- **§7 data honesty** — PASS on the parts I exercised: `Stale · 30 d ago ⚠` badge
  shown (`browser-check.log` step 6), last known price 344.17 still shown (not
  blank), first-ever load with a dead provider shows the honest message
  `Could not load AAPL: … reviewer: simulated …` and **no invented decimal price**;
  bad ticker → 400 `BAD_SYMBOL`, unknown ticker → 404 `NOT_FOUND` (never 5xx).
  HKT labelling is implemented (`shared/format.ts`, explicit `HKT` label, real
  `Asia/Hong_Kong` tz). See N1 for the un-badged secondary displays.

---

## TEST-QUALITY ASSESSMENT

**Counts I measured:** 4 files / 114 cases / 279 `expect()` calls
(format 72, mapping 73, signals 90, indicators 44).

**Genuinely good:** the tests are substantive, not padding. They use a
round-trip strategy (`yahooFixture` → `parseCandles` → field-by-field equality),
test **invariants** rather than magic numbers (`upper ≥ middle ≥ lower`;
times strictly increasing; every indicator point carries the timestamp of the
candle it came from — which is precisely the check that would catch silent
x-axis misalignment), and cover state transitions plus parser edge cases
(dropping rows with a missing OHLC field rather than inventing a price). I found
**no tautologies** (`expect(true)`, self-referential `toBe(1)` etc.).

**The gap that let B1 through:** the suite is **100% unit-level** — there is no
component/DOM/browser test anywhere under `tests/` (grep for
`playwright|chromium|document|render(` → nothing). Nothing covers React state
wiring or the interaction between the chart's two effects, which is exactly where
B1 lives. The builder's separate Playwright harness covers static rendering but
(per N3) never toggles the panes. Recommendation: add one interaction test that
mounts the chart, toggles each pane, and asserts the series still has data.

**Honesty note about my own harness:** in my first `api-adversarial.ts` run I
wrote an assertion whose *wording* was wrong ("no cache + failing fetch throws"),
and the app actually behaved correctly (it threw instead of fabricating). I fixed
the wording, added a "nothing written to cache for the failed symbol" check, and
re-ran to **24/24 PASSED** (`api-adversarial.log`). The intermediate failure was
my bug, not the app's.

---

## WHAT REMAINS UNVERIFIED BY ME

- **Live Yahoo fidelity beyond AAPL.** I confirmed the live path works on one
  real symbol and that parsing is unit-tested, but I did not diff the app's
  displayed meta (`52-wk high/low`, day high/low, volume) against an independent
  second Yahoo read for multiple symbols.
- **Intraday intervals at runtime.** I exercised `1Y`/`1M` range defaults; I did
  not prove every interval button (1m/5m/15m/1H/1W/1M) returns data against the
  provider's actual per-interval limits in a live session.
- **Long-run behaviour.** No soak test; chart rebuilds on pane toggles leak a
  `ResizeObserver`/chart instance each time (the build effect disconnects and
  `chart.remove()`s, so it *should* be clean, but memory behaviour was not run).
- **Non-Chromium browsers** and **mobile/responsive** layouts (only headless
  Chrome at 1280×900 and 1440×950).
- **N2** (mover-strip → TopBar symbol coupling) is from code reading, not a
  targeted probe.
- I could not view my own screenshots (my model has no image input); all visual
  claims are backed by **DOM/canvas metrics**, not by me eyeballing a PNG. The
  PNGs are saved for a human to confirm: `r02-chart.png`, `r09/r10-pane-*.png`,
  `r07-offline-firstload.png`, `r08-offline-cached-stale.png`, etc.

---

## EVIDENCE INDEX (`./review-evidence/`)

| File | What it proves |
|------|----------------|
| `browser-check.log` | Full walk: 5 screens, real candles, canvas pixel proof, 34 pass / 1 fail (B1), offline + stale paths, 0 console errors |
| `pane-probe.log` | B1 isolated and reproduced over 2 s sampling |
| `scope-probe.log` | B1 affects Dashboard **and** Chart; recovery paths (overlay toggle / timeframe / reload) |
| `api-adversarial.log` | 24/24 API adversarial + §6 hand-computed determinism + §7 honesty |
| `browser-check.ts`, `pane-probe.ts`, `scope-probe.ts`, `api-adversarial.ts` | The harnesses (reviewer-only; app source untouched) |
| `live-server.ts`, `offline-server.ts` | Real production app / simulated provider outage |
| `r01`–`r10*.png` | Screenshots (dashboard, chart, signals, watchlist, help, offline states, blank-after-pane-toggle) |

**Scope respected:** I wrote only under `./review-evidence/`; `src/`, `shared/`,
`server/`, `tests/`, `scripts/` mtimes are unchanged (no writes after the build),
and `projects/stock-analyzer` was not touched.
