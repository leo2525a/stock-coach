# Phase 4 (Dividends) — Status Snapshot (FINAL, 2026-11-07 ~21:10 HKT)

## State: ✅ CLOSED — independently re-QA'd PASS, all gates green, mutation-proven

### Fixed & verified (three rounds + hardening)
- Fix #1: §C.5 schedule coherence — de-dup by calendar day, `upcomingPayment` monotonicity, `reconcileScale` unit reconciliation, contiguous-year `consecutiveIncreases`, live `nextPayDate` path.
- Fix #2 (lead-found): `facts.nextPayDate` raw leak — §C.6 showed AAPL payable 2026-08-13 BEFORE ex-date 2026-11-12. Fixed at `shared/dividends.ts::reconciledNextPayDate` + `note.dividendPayableBeforeEx` (en+zh parity).
- Fix #3 / **N1**: §C.1 "Annual rate" 100× understated for GBp-quoted LSE names (`summaryDetail.dividendRate` is **GBP**, labelled **GBp**).
  - 3a (superseded): reconciled against the payment-series trailing sum → over-withheld 0005.HK.
  - **3b (final)**: reconcile against the provider's **own yield identity** — `reconcileScale(annualRate, [dividendYield × price])`. No series param; trust the provider figure when no yield reference exists.
  - Live: ULVR.L **156 GBp** · BP.L **25** · VOD.L **4** · HSBA.L **30** · 0005.HK **3.14 HKD** · 0700.HK 5.30 · KO 2.12 / O 3.26 / AAPL 1.08 USD (untouched). Every value = `price × indicated yield`.
- **R1** (reviewer-found regression of 3a) fixed by 3b; **R2** (coverage erosion) fixed by comparing the rate to the §C.5 Amount-column median (universal).
- **F1 hardening** (reviewer finding): the evidence unit check now FAILs on a dashed payer rate (the R1 symptom), instead of silently skipping.
- **F3**: corrected a mislabeled test comment (the HK pin keys off `price × yield`, not a currency label).
- **F2** (latent, non-blocking): an LSE name with `dividendYield` absent would show a raw 100×-off rate — **unreachable** on every sampled live LSE symbol; documented in code.

### Mutation proofs (lead-run)
- Round #3b: restore raw `direct(annualRate)` + raw forward yield → unit **2 FAIL** + browser `✗ ULVR.L annual=1.56 vs column median 41.58 (ratio 0.038)` → evidence FAILED. Restored.
- F1: force the reconciled rate to `—` → browser `✗ O / AAPL / 0005.HK / ULVR.L: the Annual rate is shown, not the dash (payer)` (4 FAILED) → evidence FAILED. Restored.

### Reviewer verdicts (independent, `debug-reviewer`)
- `QA-REPORT-N1.md`: FAIL (N1 fix correct+mutation-sensitive; R1/B blocking).
- `QA-REPORT-N1-RERUN.md`: **PASS** — rework correct + mutation-sensitive; R1 closed, HSBA reconciled, R2 closed; no field off-scale; no regression.

### Final gate stack (lead-run, ~21:10)
tsc 0 · lint 0 · **454 tests / 22 files** · build 0 · verify:runtime **178** · evidence:phase4 **88 (0 skipped)** · evidence:phase3 76 · evidence:chart 82 · evidence:colour 35
`shared/dividends.ts` sha256 `2dfce29f3df92025e8d0234af8c99918135ad3f188dccd4829ca7a6acb22f494`.

### Instrument fix (lead, earlier)
`scripts/evidence-phase4.mjs::setSymbol` used `:has-text("O")` (case-insensitive substring → matched MSFT) ⇒ §A.8 "O" check was VACUOUS. Fixed to exact `.wl-sym:text-is()` + `data-symbol` identity guard.

### Non-gating observations (owner decision, not defects)
- LSE `trailingAnnualDividendYield` ~87× below its own chart series (provider-supplied value; pre-existing).
- 0005.HK `payoutRatioLtm=—` (separate branch).

### Constraints held
- No commit / no publish. `projects/stock-analyzer` untouched. Port 8787 = dev server (left as-is). SPEC-PHASE4.md / RECON-PHASE4.md are reference.
