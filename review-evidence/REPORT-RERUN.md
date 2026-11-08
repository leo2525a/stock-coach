# Independent QA RE-RUN — Stock App v1 (`stock-coach`)

Reviewer: `debug-reviewer` (independent; did not build the artifact).
Requester: `agent:debug-debug_lead:main` (webchat).
Artifact: `/Users/love21/.openclaw/workspace/debug-coder/projects/stock-app`
Spec: `SPEC.md` (frozen, unchanged).
Date: 2026-11-06. Previous report (FAIL, blocking B1): `./review-evidence/REPORT.md` — preserved intact.
New evidence for this re-run: `./review-evidence/*-rerun.log`, `n1n2-probe.*`, `edge-probe.*`, `pane-probe-rerun.*`, `rr-*.png`.

Every claim below is backed by a command + observed output, reproduced by me on the
CURRENT source. I did not rely on the coder's report for anything.

---

## VERDICT: **PASS**

B1 (the blocking defect from the first review) is **RESOLVED** — reproduced as fixed
with the same distinct-colour / non-background-pixel probe, across 20/20 pane states
on both charts. N1 and N2 are **genuinely fixed** (observed in a real browser). No new
blocking or actionable non-blocking findings. SPEC §3.7 is now met.

---

## 1. B1 RE-VERIFICATION — status: **RESOLVED**

**Fix present in source:** `src/chart/StockChart.tsx` line 359 now reads
`}, [candles, indicators, interval, overlays, overlayKey, structureKey]);` — `structureKey`
was added to the data-push effect deps (line ~354 comment documents the regression guard).

**Independent reproduction** — `review-evidence/pane-probe-rerun.ts` → `pane-probe-rerun.log`.
Probe: real production build (`dist/`) in headless Chrome, sampled 5× over 2 s per state;
BLANK = every frame ≤ 12 distinct colours (the exact FAIL-report criterion).

```
=== CHART screen — full pane-toggle matrix ===
  (settled before sampling: true)
  BASELINE (defaults)                distinct=[22, 22, 22, 22, 22] nonBg=3274 barCount=251  POPULATED
  Volume OFF                         distinct=[19, 19, 19, 19, 19] nonBg=3460 barCount=251  POPULATED
  Volume ON                          distinct=[22, 22, 22, 22, 22] nonBg=3274 barCount=251  POPULATED
  Volume back OFF                    distinct=[19, 19, 19, 19, 19] nonBg=3460 barCount=251  POPULATED
  RSI OFF                            distinct=[19, 19, 19, 19, 19] nonBg=3460 barCount=251  POPULATED
  RSI ON                             distinct=[17, 17, 17, 17, 17] nonBg=2431 barCount=251  POPULATED
  RSI back OFF                       distinct=[19, 19, 19, 19, 19] nonBg=3460 barCount=251  POPULATED
  MACD OFF                           distinct=[19, 19, 19, 19, 19] nonBg=3460 barCount=251  POPULATED
  MACD ON                            distinct=[17, 17, 17, 17, 17] nonBg=2431 barCount=251  POPULATED
  MACD back OFF                      distinct=[19, 19, 19, 19, 19] nonBg=3460 barCount=251  POPULATED
  [pane states: Volume=true RSI=true MACD=true]
  ALL THREE ON                       distinct=[22, 22, 22, 22, 22] nonBg=2993 barCount=251  POPULATED
  ALL THREE OFF                      distinct=[19, 19, 19, 19, 19] nonBg=3460 barCount=251  POPULATED

=== rapid sequence (the FAIL-report click order) ===
  rapid click RSI / MACD / Volume / RSI / MACD — all POPULATED (16–22 colours, barCount=251)

=== DASHBOARD hero chart — pane toggle must not blank it either ===
  DASHBOARD baseline / after RSI / after MACD — all POPULATED

────────────────────────────────────────────────────────────
console errors=0 page exceptions=0 failed requests=0
PANE-TOGGLE VERDICT: RENDERED in all 20/20 states (B1 RESOLVED)
```

Compare to the FAIL report, where every pane toggle yielded `[1, 1, 1, 1, 1]`.
Now every state stays at 16–24 distinct colours with ~2.3k–3.5k non-background pixels,
and `data-bar-count=251` is consistent throughout.

**Edge paths also confirmed** (`review-evidence/edge-probe.log`, 12/12 PASSED):
- On the **stale / provider-outage** path (`Stale · 30 d ago ⚠`), toggling RSI then MACD
  keeps the chart populated (23/24 colours).
- **Rapid double-toggles** (ON then OFF with no wait — rebuild in flight) stay populated.
- **Forced ⟳ Refresh** while a pane is ON stays populated.

**Mutation check — do the new tests actually catch B1?** I temporarily removed
`structureKey` from the data-push deps (`src/chart/StockChart.tsx:359`), ran the new DOM
suite, then **restored the file byte-for-byte**:

```
× re-pushes the candles after toggling each sub-pane on
    AssertionError: Volume: the rebuilt chart must receive the candles, not stay blank: expected +0 to be 260
× re-pushes the candles after toggling the panes back off        expected +0 to be 260
× never leaves a chart instance with an empty candle series      expected [ { series: [ …(13) ] } ] to have a length of +0 but got 1
× keeps the RSI pane series bound to the RSI values              expected +0 to be 246
× toggling one pane off leaves the others intact                 expected +0 to be 260
 Tests  5 failed | 3 passed (8)
```
Restore verified: `shasum -a 256 src/chart/StockChart.tsx` =
`2056f667a6f2a0d4cbff2f6013b7ebfc6e7c82ba096be479755b4d2bf9918863` (identical before and
after); the suite returns to **8/8**. So the regression guard is real, not decorative.
**Source was restored exactly; no code change was left behind** (see §6).

---

## 2. GATES RE-RUN (my own runs, current source)

| Gate | Command | Observed |
|------|---------|----------|
| Build | `npm run build` | **BUILD_EXIT=0**; `tsc --noEmit` clean; vite 56 modules; PWA precache 16 entries (462.90 KiB); **no warnings** (`grep -iE "warn\|deprecat"` → nothing) |
| Tests | `npm test` | **TEST_EXIT=0**; `6 passed (6)` files, **129 passed (129)** — mapping 33, format 24, signals 40, indicators 17, **stockchart.test.tsx 8**, **stale-badge.test.tsx 7** |
| Lint | `npm run lint` | **LINT_EXIT=0**; `eslint .` with no output |
| Runtime | `npm run verify:runtime` | **VERIFY_EXIT=0**; `✓ runtime verification PASSED — 69 checks` (`verify-runtime-rerun.log`) |
| Coder chart harness | reproduced from a redirected copy | `✓ browser evidence PASSED — 71 checks` (`evidence-chart-rerun.log`) |

Test-count claim verified: 129 − 114 = **+15**, split exactly as claimed (+8 chart DOM, +7 stale-badge).

**The coder's chart harness now exercises the control that broke it** (N3 addressed):
`evidence-chart-rerun.log` shows a `sub-pane toggles — the chart must stay populated
(B1 regression)` section asserting the canvas stays populated after each Volume/RSI/MACD
on/off and with all three on/off, plus bar-count and interval-change survival — 21 checks.
That is the exact gap the first review flagged.

---

## 3. N1 / N2 — verified by observation (not by reading the report)

Probe: `review-evidence/n1n2-probe.ts` → `n1n2-probe.log`, **19/19 PASSED**.

**N1 (stale labelling everywhere):**
```
N1 — a stale series is labelled wherever its numbers appear
  ✓ chart-card provenance badge says the series is stale — Stale · 30 d ago ⚠
  ✓ TopBar headline price carries a stale badge — 1 badge(s)
  ✓ TopBar still shows the real last-known price (not blank, not invented) — 344.17 USD
  ✓ there are multiple mover tiles to inspect — 3 tiles
  ✓ every mover tile is individually labelled when every quote is stale — 3/3
  ✓ the on-chart (selected) tile is also labelled if its quote is stale — unlabelled=false
  ✓ N1 walk produced zero console errors — 0
```
The TopBar price block gains `[data-testid="topbar-stale"]`, and each stale mover tile
gets its own `mover-stale-<SYM>` badge driven by the quote's `stale` flag.

**N2 (mover tile cannot steal the headline symbol):**
```
N2 — mover strip cannot steal the headline symbol (live app)
  ✓ the strip offers explicit per-tile open controls — 3 controls
  ✓ a mover tile element is not itself a button — symbol=NVDA tag=div
  ✓ clicking a tile body does NOT change the headline symbol — AAPL -> AAPL
  ✓ clicking a tile body does NOT change the headline price — 344.17 USD -> 344.17 USD
  ✓ the explicit "chart ↗" control switches the symbol — AAPL -> NVDA
  ✓ the explicit control lands on the Chart screen
  ✓ the chart on screen is the symbol that was chosen — chart=NVDA
  ✓ N2 walk produced zero console errors — 0
```
The tile is a `<div>`; selection only happens via the labelled `chart ↗` control, which also
navigates to the Chart screen so the header and the chart can no longer disagree.

---

## 4. NO-REGRESSION CHECKS

- **Five SPEC §5 screens** — re-ran my full browser walk (`browser-check-rerun.log`):
  **`REVIEWER BROWSER CHECKS PASSED — 35`** (was 34 pass / 1 fail — the single failure was B1).
  Dashboard/Chart/Signals/Watchlist/Help all render; 6 signal cards; 9 glossary entries;
  crosshair OHLC legend; timeframe switch 251→155 bars.
- **All chart toggles redraw** — overlays SMA 20 / EMA 12-26 / Bollinger and panes RSI / MACD
  all change the canvas, and it stays populated.
- **Signals deterministic + from real data** — `api-adversarial-rerun.log`, **24/24 PASSED**:
  hand-computed vs server evidence on real AAPL (close 344.17, SMA50 335.46, SMA200 298.34,
  Wilder RSI(14) 53.01, MACD 2.2923/signal 3.0269); two requests **byte-identical**;
  summary tally 1/2/3 matches the cards.
- **Data honesty (§7)** — stale fallback serves `source=stale-cache` with a clear note and the
  real last-known meta (344.17); failing fetch with no cache **throws** rather than inventing;
  nothing is written to cache for a failed symbol; bad ticker → 400, unknown → 404 (never 5xx).
- **Console cleanliness (§3.6)** — **0** console errors / **0** page exceptions / **0** failed
  requests on every session I ran: live walk, all 20 pane states, the stale session, and all
  12 edge states.
- **Responsive / PWA** — coder harness rerun confirms no horizontal overflow at 390/834/1600 px
  and an installable manifest + registered service worker.

---

## 5. UPDATED SPEC §3 CRITERIA TABLE (reviewer-observed)

| # | Criterion | Result | Evidence I observed |
|---|-----------|--------|---------------------|
| 3.1 | `npm run build` zero TS errors, zero warnings | **PASS** | `BUILD_EXIT=0`; 56 modules; PWA 16 entries (462.90 KiB); no warnings |
| 3.2 | `npm test` all green | **PASS** | `TEST_EXIT=0`, 6 files, **129/129** (incl. 8 chart DOM + 7 stale-badge) |
| 3.3 | `npm run lint` clean | **PASS** | `LINT_EXIT=0` |
| 3.4 | Runs locally, real ticker + real candlestick chart | **PASS** | HTTP 200; price 344.17 USD; 251 real bars; canvas 1082×365 with 19 distinct colours; chart survives every pane toggle |
| 3.5 | Every §5 screen exists, reachable, **and fully works** | **PASS** | 5 screens render; the documented Pane controls no longer blank the chart (20/20 states populated on both charts) |
| 3.6 | Zero console errors on any shipped screen | **PASS** | 0/0/0 across live, stale, and all toggle/edge states |
| 3.7 | Independent review returns no blocking findings | **PASS** | B1 resolved; N1/N2 fixed; no new blocking or actionable findings |

---

## 6. SCOPE / INTEGRITY

- Wrote **only** under `./review-evidence/` (plus `./review-evidence/rerun-evidence/` for the
  redirected harness output). The coder's `./evidence/` was **not** touched
  (`evidence/report.json` mtime still `Nov 6 12:34:01`).
- **Mutations restored exactly:** I removed `structureKey` once for the mutation check and
  restored `src/chart/StockChart.tsx` from a sha256-verified copy
  (`2056f667a6f2a0d4cbff2f6013b7ebfc6e7c82ba096be479755b4d2bf9918863`). A before/after `stat`
  of all 44 source files differs only by the restored file's mtime; content is unchanged and
  `npm test` is back to 129/129.
- `/Users/love21/.openclaw/workspace/projects/stock-analyzer` was **not** modified (mtime
  `Nov 5 22:05`, preceding this session). No publish/deploy/purchase.
- **One harness bug of mine, corrected and disclosed:** my first N1/N2 run failed one check
  because I asserted a tile had *no* descendant `<button>`, but a non-current tile legitimately
  contains its own `.m-open` control. I fixed the assertion (the tile element itself must not be
  a `<button>`) and re-ran to 19/19. That was my error, not the app's.

---

## 7. UNVERIFIED / ASSUMPTIONS (unchanged limits of this review)

- **Live Yahoo fidelity beyond AAPL/SPY/MSFT.** Provenance works on 3 real symbols; I did not
  diff the displayed meta (52-wk high/low, day range, volume) against an independent second
  Yahoo read for many symbols.
- **Every intraday interval at runtime.** The coder harness exercises one intraday interval and
  I exercised `1Y`/`1M`/daily; I did not click through 1m/5m/15m/1H/1W/1M against the provider's
  per-interval limits in a live session.
- **Long-run behaviour / memory.** No soak test; pane rebuilds create and dispose chart
  instances each toggle — not measured for leaks.
- **Non-Chromium browsers, and I cannot view PNGs** (no image input), so all visual claims are
  canvas/DOM metrics. Screenshots saved for a human: `rr-panes-all-on.png`,
  `rr-panes-rapid.png`, `rr-edge-stale-panes.png`, `rr-n1-stale.png`, `rr-n2-mover.png`,
  and `r01`–`r08*.png`.
- **N4 (acceptance-bar suggestion) remains a process note, not an artifact defect.** The bar
  still grades "zero console errors" as green; the coder has now added functional pane-toggle
  assertions, which closes that specific gap in practice.

---

## 8. EVIDENCE INDEX (new this run)

| File | What it proves |
|------|----------------|
| `pane-probe-rerun.log` | B1 RESOLVED — 20/20 pane states populated on Chart + Dashboard |
| `edge-probe.log` | 12/12 — pane toggles survive stale path, rapid toggles, forced refresh |
| `n1n2-probe.log` | 19/19 — N1 badge on TopBar + every stale mover tile; N2 tile cannot steal the symbol |
| `browser-check-rerun.log` | 35/35 — five screens, real candles, crosshair, toggles, offline/stale, 0 console errors |
| `verify-runtime-rerun.log` | 69/69 — real backend/runtime invariants |
| `api-adversarial-rerun.log` | 24/24 — §6 determinism (hand-computed) + §7 honesty |
| `evidence-chart-rerun.log` | 71/71 — coder harness reproduced from a redirected copy; pane-toggle section present |
| `*.ts`, `*-copy.mjs` | Reviewer harnesses (app source untouched) |
| `rr-*.png`, `r0*.png` | Screenshots for human eyes |
