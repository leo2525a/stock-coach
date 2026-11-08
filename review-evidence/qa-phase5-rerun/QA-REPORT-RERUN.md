# QA REPORT (RERUN) — Phase 5 (UI/UX), independent adversarial re-verification

**Reviewer:** debug-reviewer (independent QA)
**Repo:** `/Users/love21/.openclaw/workspace/debug-coder/projects/stock-app`
**Date:** 2026-11-07
**Brief:** `BRIEF-PHASE5-RERUN.md`
**Round-1 report:** `review-evidence/qa-phase5/QA-REPORT.md` (VERDICT: FAIL)
**Write scope honoured:** everything below lives under `review-evidence/qa-phase5-rerun/`; **no repo source/test/script/dist file was modified** and **nothing was committed**. All mutations were reproduced in a scratch copy (`review-evidence/qa-phase5-rerun/scratch/`).

---

## VERDICT: **PASS**

The lead's fixes for **B1, B3, N1 and N4** hold up under adversarial, independent reproduction. Every one of the four mutations I rebuilt from source now makes the **shipped** harness FAIL with the expected check(s) and exit code 1. The **B2 rejection is correct**: the current stacking is right and the scrim still dismisses on tap while leaving nav tappable. No new defect was introduced by the fixes.

Baseline (production build, shipped harness verbatim): **`evidence:phase5` PASSED 58 checks, 0 skipped** — matches the lead exactly.

### Per-finding verdicts

| # | Finding (round 1) | Round-2 verdict | Evidence |
|---|---|---|---|
| **B1** | Drawer cannot be dismissed (scrim never rendered, no Escape, no close) | **FIXED ✓** | Scrim renders 320×640 at 320px, tap-outside closes, Escape closes; mutation `b1` FAILs 3 checks, `b1b` FAILs `Escape closes the drawer` |
| **B2** | Scrim z-index (30) under sidebar (40) | **REJECTION UPHELD ✓** | z 30 < 40 is correct; hit-test right of sidebar → `BUTTON.scrim` (dismiss works); nav item → `BUTTON.side-item` (still tappable/navigates) |
| **B3** | `parseRgb` cannot parse hex → `closeTo` vacuously true | **FIXED ✓** | `parseRgb` now handles `#rgb`/`#rrggbb`/`rgb()`/`rgba()`, fails closed; mutation `b3` FAILs `light paints a light background` |
| **N1** | Reference colours hard-coded, target-mean 2.9985:1 on white | **FIXED ✓** | Five `--ref-*` tokens (dark+light) via `useRefColors()`; light mean `#0f7d72` = **5.00:1** on `#ffffff`; theme flip re-reads live |
| **N4** | ≥40px touch targets scoped to phones only | **FIXED ✓** | `@media (pointer: coarse)` re-applies; 768px+`hasTouch` → 44px; mutation `n4` FAILs both tablet checks at 19.5px |

---

## 1. Baseline — shipped harness verbatim (production build)

```
npm run build            → exit 0  (89 modules; dist/assets/index-DAoZRD4U.css 36.46 kB,
                                    dist/assets/index-DdWtJv7T.js 642.84 kB; 16 precache entries)
npm run evidence:phase5  → exit 0  PASSED 58 checks, 0 skipped   [log: evidence-phase5-shipped.log]
npm test (vitest run)    → 23 files, 469 passed (23)             [= expected 469/23]
npm run verify:runtime   → PASSED 178 checks                     [= expected 178]
npm run evidence:chart   → PASSED 82 checks                      [= expected 82]
npm run evidence:colour  → PASSED 35 checks                      [= expected 35]
npm run evidence:phase3  → PASSED 76 checks, 0 skipped           [= expected 76]
npm run evidence:phase4  → PASSED 88 checks, 0 skipped           [= expected 88]
```
node v22.22.2 · headless Google Chrome · production build served by the bundled Express server.
**All regression suites match the brief's expected counts exactly.** The three new phase-5 drawer checks
(`the scrim is rendered while the drawer is open`, `tapping outside (the scrim) closes the drawer`,
`Escape closes the drawer`) are present and green; the two new N4 tablet checks are present and green.

## 2. Source hashes — re-measured (all 7 MATCH)

```
6c2fec58b4d1549ab0de30951ce95909f49acb7c6c831027949d1f3cfe4d4d1b  src/styles.css            ✓
d679f459448fae69b3a931578729ccf2c4109c7ff8c7f2d8520ec93cc766ac53  src/App.tsx               ✓
766d15e7f3ceacad9cc4b7cf1a5c44e9c1b8929ad529b44a73141c231460d882  src/chart/theme.ts        ✓
5c11ca783d2268c82221e8d62343ee8145c36ba9b34c249546abe73274b99253  src/analyst/RatingsPanel.tsx   ✓
f7b9f8e69e719af97df9ba8e3372520927e80ca98f0b90829cb429c30ea1e694  src/analyst/EstimatesPanel.tsx ✓
6a5f3132a93d2507604a3a07579abcfe523f6854226a5da6a7ae410bd50f60f1  scripts/evidence-phase5.mjs    ✓
5bcb9212baa3b4c8f22acb126854fe6fc0b58716181eeb50b6bd233ebee11688  tests/theme.test.tsx           ✓
```
e.g. `shasum -a 256 src/styles.css src/App.tsx src/chart/theme.ts src/analyst/RatingsPanel.tsx src/analyst/EstimatesPanel.tsx scripts/evidence-phase5.mjs tests/theme.test.tsx`
All seven equal the brief's lead-reported values.

## 3. Mutation results — all four FAIL the harness as required

Method: `review-evidence/qa-phase5-rerun/mutation-rerun.mjs` edits the **source** in the scratch copy
(so Vite rebuilds `dist`), runs `npm run build`, then runs the **shipped** `scripts/evidence-phase5.mjs`
verbatim inside the scratch copy. No invalid approaches reused (no `page.route` interception, no
in-block prepending). Each mutation was confirmed applied (build succeeded; failure lines match the
targeted check).

| Mutation | Exact change (scratch `src/`) | build | harness exit | failing check(s) | verdict |
|---|---|---|---|---|---|
| **B1** | remove `@media (min-width:721px){ .scrim{display:none} }`; restore bare top-level `.scrim { display:none; }` | 0 | **1** | `the scrim is rendered while the drawer is open` — `{"present":true,"display":"none","box":[0,0]}` · `tapping outside (the scrim) closes the drawer` — `false` (then harness timeout) | **non-vacuous ✓** |
| **B1b** | delete the Escape `useEffect` in `src/App.tsx` | 0 | **1** | `Escape closes the drawer` — `false` | **non-vacuous ✓** |
| **B3** | append `html[data-theme='light'] { --bg: #0d1117; }` to `styles.css` | 0 | **1** | `light paints a light background` — `#0d1117 (≠ #f6f8fa)` | **non-vacuous ✓** |
| **N4** | delete the `@media (pointer: coarse)` block | 0 | **1** | `touch controls stay tappable on a 768px tablet (≥40px)` — `19.5px` · `touch controls stay tappable on a 1024px tablet (≥40px)` — `19.5px` | **non-vacuous ✓** |

Exact tail lines:
```
[b1 ] ✗ phase 5 browser evidence FAILED — 47 passed, 3 failed
[b1b] ✗ phase 5 browser evidence FAILED — 57 passed, 1 failed
[b3 ] ✗ phase 5 browser evidence FAILED — 57 passed, 1 failed
[n4 ] ✗ phase 5 browser evidence FAILED — 56 passed, 2 failed
```
Logs/artifacts: `mutations/{b1,b1b,b3,n4}.{build,run}.log`, `mutations/summary.json`.

**B3 helper falsified directly** (eval of the shipped `parseRgb`/`closeTo`): `#f6f8fa→[246,248,250]`,
`#fff→[255,255,255]`, `#0d1117→[13,17,23]`, `rgb(246,248,250)→[246,248,250]`, `rgba(38,166,154,.15)→[38,166,154]`,
`var(--bg)`/`""`/`#12345`→`null` (fail-closed). `closeTo([246,248,250],"#f6f8fa")=true`,
`closeTo([13,17,23],"#f6f8fa")=false`. **No `?? []` remains at any colour call site.** Both `--bg`
assertions now route through fail-closed `checkColor`; the canvas checks still consume real `getImageData`
RGB, so **no colour assertion is vacuous anymore.**

## 4. Independent runtime probes (real build, not the harness)

`probe-rerun.mjs` → **14/14 pass** (`probes/probe.log`, `probes/probe-results.json`); `probe-b2.mjs` → **3/3 pass**.

- **B1** — at 320px: scrim `display:block`, box `320×640`, `pointer-events:auto`; tapping outside closes; `Escape` closes; `Escape` when already closed is a no-op; **six** open/Escape cycles leave the app usable; zero console/page errors.
- **B2 attack** — geometry: sidebar `right=268.8, z=40`; scrim `z=30`. `elementFromPoint(277,300)=BUTTON.scrim` (outside tap → closes). Nav item centre hits `BUTTON.side-item` (scrim does **not** cover the drawer) and tapping it **navigates** to `chart-screen`. Raising the scrim above the sidebar would cover nav → the lead's rejection is correct.
- **N1** — `--ref-mean` dark `#26a69a` → light `#0f7d72` on a live flip (no reload). Computed contrasts on `#ffffff`: price `#1f6feb` 4.63, low/high `#6b757e` 4.70, mean `#0f7d72` **5.00**, estimate `#b8860b` 3.25 — **all ≥3:1**. The themed light mean is **actually painted** on `pf-band-chart` (1433 matching pixels).
- **N4** — 768px + `hasTouch` → 44px min; **1600px fine pointer → 19.5px** (the coarse block is inert on desktop, so hover/mouse layouts are unaffected — no regression).
- `t('common.close')` exists in both `shared/i18n/{en,zh-HK}.ts` (the scrim's `aria-label` is not a raw key).

## 5. New-defect hunt (fixes may have introduced)

- **Escape listener leak / double-close** — effect early-returns when the drawer is closed and cleans up on unmount; six cycles + Escape-when-closed produce no error and no state corruption. **Clean.**
- **Scrim covering content / nav** — see B2; nav stays above and interactive. **Clean.**
- **Light ref tokens unreadable** — all five clear 3:1 (min 3.25). **Clean.**
- **Coarse rule breaking desktop** — inert at 1600px fine-pointer. **Clean.**
- **New vacuous check** — the added drawer checks assert real geometry/hit behaviour and are falsified by mutations `b1`/`b1b`; not vacuous. **Clean.**

**No new blocking defect found.** Two pre-existing, non-blocking observations (not introduced by this rework): `--ref-estimate` has no observed paint call site (dead token; its 3.25:1 light value is theoretical), and desktop/tablet **fine-pointer** top-bar controls remain 19.5–34px — both are unchanged owner calls from round 1 (the harness only asserts ≥40px under `hasTouch`/≤390px, and it now does so honestly).

## 6. Residual uncertainty (unchanged from round 1)

- **Real mobile browsers** — all measurement is headless Chrome on desktop macOS. The B1 scrim defect and its fix are CSS-cascade/handler facts and will reproduce wherever the same stylesheet+JS load, but iOS Safari/WebKit `100dvh`/safe-area and Android touch behaviour were not exercised on a device.
- **True PWA installability** — manifest (192/512, `standalone`, `start_url`) and SW registration are verified; the browser's actual install prompt is not.
- **Screen-reader focus behaviour** of the drawer after the Escape fix — `aria-expanded` is wired but focus-trap/announcement was not instrumented.

## 7. Commands to reproduce

```bash
cd /Users/love21/.openclaw/workspace/debug-coder/projects/stock-app
npm run build && npm run evidence:phase5        # 58 checks, 0 skipped
npm test && npm run verify:runtime              # 469/23, 178
for s in chart colour phase3 phase4; do npm run evidence:$s; done   # 82/35/76/88
node review-evidence/qa-phase5-rerun/mutation-rerun.mjs all          # 4 mutants, all exit 1
node review-evidence/qa-phase5-rerun/probe-rerun.mjs                # 14/14
node review-evidence/qa-phase5-rerun/probe-b2.mjs                   # 3/3
```

## 8. Recommendation

**PASS.** B1, B3, N1, N4 are genuinely repaired and their evidence is load-bearing (all four mutations
fail the shipped gate); B2's rejection is correct and independently confirmed. The Phase-5 surface —
drawer lifecycle, responsive layout, day/night runtime behaviour, chart repaint, themed reference
lines, i18n parity, PWA shell — passes adversarial re-testing with no new defect introduced.

### Artifacts produced (all under `review-evidence/qa-phase5-rerun/`)
```
QA-REPORT-RERUN.md          this report
build.log                   npm run build output
evidence-phase5-shipped.log shipped harness, 58 checks
mutation-rerun.mjs          scratch-copy mutation runner (b1, b1b, b3, n4)
mutations/{b1,b1b,b3,n4}.{build,run}.log + summary.json   exact mutation evidence
probe-rerun.mjs / probes/probe.log / probe-results.json   14 independent probes
probe-b2.mjs / probes/b2.log / b2-results.json            B2 stacking attack (3/3)
scratch/                    disposable repo copy used for mutations (never the repo)
```
