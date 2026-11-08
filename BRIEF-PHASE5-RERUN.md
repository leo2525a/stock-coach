# Brief — Phase 5 (UI/UX) independent re-QA (round 2)

Repo: `/Users/love21/.openclaw/workspace/debug-coder/projects/stock-app`
Write scope: `review-evidence/qa-phase5-rerun/` **only**. Do not modify source, tests, scripts, or dist.

## Context

Your round-1 report (`review-evidence/qa-phase5/QA-REPORT.md`, VERDICT: FAIL) is accepted. The lead has applied fixes for B1, B3, N1 and N4, and explicitly **rejected B2 as written**. Verify the rework independently and adversarially — do not take the lead's word.

## What changed (verify each; find counterexamples)

1. **B1 — drawer dismissal.** `src/styles.css`: the bare top-level `.scrim { display:none }` is now scoped to `@media (min-width:721px)`. `src/App.tsx`: `Shell` now adds a `window` `keydown` listener (Escape → `setSidebarOpen(false)`) only while the drawer is open. Prove: at ≤720px with the drawer open the scrim renders (non-zero box) and tapping outside closes it; Escape closes it; at ≥721px the scrim is display:none and the hamburger is hidden.
2. **B2 — rejected.** The lead's position: a drawer scrim belongs *below* the drawer it dims; raising above the sidebar would cover it and make nav untappable, and `.scrim` has no click handler anyway. **Attack this**: is the current stacking correct and does the scrim still dismiss on tap? If you think it is genuinely wrong, prove a user-visible failure.
3. **B3 — vacuous colour checks.** `scripts/evidence-phase5.mjs`: `parseRgb` now handles `#rgb`/`#rrggbb` and `rgb()/rgba()`; call sites use a fail-closed `checkColor` (unparseable ⇒ FAIL). Reproduce your `light-bg-dark` mutant (force light `--bg:#0d1117`) and confirm it now FAILS. Confirm no *other* colour assertion is still vacuous.
4. **N1 — reference lines.** Five reference colours moved to themed tokens `--ref-*` (dark + light) in `styles.css`, surfaced via `useRefColors()` (`src/chart/theme.ts`) and used by `RatingsPanel`/`EstimatesPanel`. Prove the light target-mean line clears 3:1 on the light chart background, and that a theme flip re-reads them.
5. **N4 — touch targets.** `@media (pointer: coarse)` now re-applies the 44px/40px minimums (a *tablet* with a finger gets them). Prove at 768/1024px with `hasTouch:true`.

## Method (adversarial, non-negotiable)

- Run the **shipped** harness verbatim against the **production build**: `npm run build`, then `npm run evidence:phase5`. Report exact counts.
- Independently reproduce **all four mutations** (B1, B3, N1-family, N4) in a scratch copy; each must make the harness FAIL. Your round-1 mutants `light-bg-dark`, `drawer-hidden`, `chart-bg` are the reference. Do NOT reuse the two discarded invalid approaches (`page.route` cannot intercept the service-worker-precached CSS; in-block prepending loses the cascade).
- Re-measure the raw source hashes and confirm they match the values below.
- Look for **new** defects the lead's fixes may have introduced (e.g. the Escape listener leaking, a double-close, the light ref tokens being unreadable, the coarse rule breaking desktop hover, a vacuous new check).
- Confirm the other suites are unaffected: `npm test` (expect 469/23), `npm run verify:runtime` (178), `evidence:chart` (82), `evidence:colour` (35), `evidence:phase3` (76), `evidence:phase4` (88), `evidence:phase5` (58).

## Expected hashes (lead-reported)
- `src/styles.css` `6c2fec58b4d1549ab0de30951ce95909f49acb7c6c831027949d1f3cfe4d4d1b`
- `src/App.tsx` `d679f459448fae69b3a931578729ccf2c4109c7ff8c7f2d8520ec93cc766ac53`
- `src/chart/theme.ts` `766d15e7f3ceacad9cc4b7cf1a5c44e9c1b8929ad529b44a73141c231460d882`
- `src/analyst/RatingsPanel.tsx` `5c11ca783d2268c82221e8d62343ee8145c36ba9b34c249546abe73274b99253`
- `src/analyst/EstimatesPanel.tsx` `f7b9f8e69e719af97df9ba8e3372520927e80ca98f0b90829cb429c30ea1e694`
- `scripts/evidence-phase5.mjs` `6a5f3132a93d2507604a3a07579abcfe523f6854226a5da6a7ae410bd50f60f1`
- `tests/theme.test.tsx` `5bcb9212baa3b4c8f22acb126854fe6fc0b58716181eeb50b6bd233ebee11688`

## Deliverable

`review-evidence/qa-phase5-rerun/QA-REPORT-RERUN.md`: verdict PASS/FAIL, per-finding verdict, each mutation's exact result, any NEW finding with a minimal repro, exact commands + counts, and residual uncertainty. Nothing outside that directory. No commit.
