# QA REPORT — Phase 5 (UI/UX), independent adversarial review

**Reviewer:** debug-reviewer (independent QA)
**Repo:** `/Users/love21/.openclaw/workspace/debug-coder/projects/stock-app`
**Date:** 2026-11-07
**Brief:** `BRIEF-PHASE5-REVIEW.md`
**Write scope honoured:** everything below lives under `review-evidence/qa-phase5/`; no repo file was modified. Source hashes verified unchanged after the review (`src/styles.css c7917215…c88ef`, `src/App.tsx 32136252…678a6`, `src/chart/theme.ts d3c1d560…2d0af` — all match the brief).

---

## VERDICT: **FAIL**

The app looks correct at a glance and **every shipped gate is green**, but three defects survive
scrutiny — two of them live UX bugs in the exact flow the brief asks me to attack, and one a
vacuous-check bug *in the shipped evidence harness itself*. The green `evidence:phase5` 53/53 result is
partly unsupported: two of its assertions are provably incapable of failing.

| # | Severity | Finding | Location |
|---|----------|---------|----------|
| B1 | **Blocking** | The mobile drawer cannot be dismissed — the scrim never renders, there is no Escape handler and no close button | `src/styles.css:1315–1317` (+ `1117–1131`) |
| B2 | **Blocking** | Even once rendered, the scrim would sit *under* the sidebar (z-index 30 < 40) | `src/styles.css:1121` vs `1087` |
| B3 | **Blocking** | `parseRgb` cannot parse the hex values it is given, so `closeTo` is vacuously `true`; the dark/light *paint* assertions can never fail | `scripts/evidence-phase5.mjs:160–171`, `:367`, `:379` |
| N1 | Non-blocking | Hard-coded `REF_COLORS` are not themed; `targetMean` is painted at 2.9985:1 on white | `src/analyst/PriceSeriesChart.tsx:123–129` |

---

## Environment & baseline reproduced

```
npm run build            → 0   (89 modules; dist/assets/index-BmrMO_EJ.css 36.06 kB,
                                dist/assets/index-CECndj8D.js 642.49 kB; 16 precache entries)
npm run evidence:phase5  → PASSED 53 checks, 0 skipped
npm run evidence:chart   → PASSED 82 checks      (regression check)
npm run evidence:colour  → PASSED 35 checks      (regression check)
npm run evidence:phase3  → PASSED 76 checks      (regression check)
npm run evidence:phase4  → PASSED 88 checks      (regression check)
```
node v22.22.2 · headless Google Chrome · production build driven through the bundled Express server.

**The owner's five claims — status after adversarial testing:**

| Claim | Verdict |
|---|---|
| 1. Sidebar-only nav (no top `<nav>`, 7 screens incl. phone drawer) | **Partly falsified** — `topNavCount 0` and all 7 screens reachable, but the phone drawer cannot be *closed* (B1). "Usable drawer" fails. |
| 2. Responsive comfort (no overflow, pad ≥12px, targets ≥40px) | **Holds for phones** (320/390: 0px overflow, pad 12/16, targets 40px). Tablet/desktop top-bar targets are 19.5–34px (see N4). |
| 3. Light + day/night, pixel-level chart repaint | **Holds at runtime** (canvas repaints dark→light on all three charts, verified independently), but the *harness evidence* for the page background is vacuous (B3). |
| 4. Overall comfort at small widths | **Holds** — no overflow in EN or zh-HK, no overlap, zero console errors. |
| 5. App form (manifest + SW served, installable) | **Partly verified** — served correctly; real installability not verified (see limits). |

---

## BLOCKING FINDINGS

### B1 — The mobile drawer cannot be dismissed  🔴

**Location:** `src/styles.css:1315–1317` (top-level rule) vs `src/styles.css:1117–1131` (the `@media (max-width: 720px)` rule).

```css
/* styles.css — inside @media (max-width: 720px) { … }   (line 1117) */
  .scrim { display: block; position: fixed; inset: 0; z-index: 30; … }

/* styles.css — TOP LEVEL, later in the file           (line 1315) */
.scrim { display: none; }
```

Both selectors have identical specificity (`.scrim`); the later, **top-level, unscoped** rule wins
at every width. The `@media` rule that is supposed to switch the scrim on is dead.

**Falsifiable reproduction I ran:**
```bash
node review-evidence/qa-phase5/drawer-close-probe.mjs     # → 1/5 passed
node review-evidence/qa-phase5/scrim-probe.mjs            # → geometry dump
```

**Observed vs expected** (320 px, drawer open, `review-evidence/qa-phase5/adversarial/drawer-close-result.json`):

| | expected | observed |
|---|---|---|
| `getComputedStyle(scrim).display` | `block` | **`none`** |
| scrim box | e.g. 51×640 | **0 × 0** |
| `elementFromPoint(277, 300)` (right of sidebar) | the scrim | **`DIV.mover up`** (a dashboard card) |
| tapping that point | closes the drawer | **does nothing** (`sidebar.open` stays `true`) |
| `Escape` | closes the drawer | **no handler exists** (`grep -rn "Escape\|keydown" src/` → only `src/analyst/ui.tsx`) |
| a "close ✕" control in the sidebar | present | **absent** (`grep -n "close\|✕\|×" src/components/Sidebar.tsx` → only a comment) |

The hamburger *is* reachable-looking but is itself covered at the open drawer's left edge:
`hitAtHamburger: "STRONG.tiny sidebar-label sidebar-label-text"` → the toggle is not clickable while the drawer is open either.

**User impact:** a phone user who opens the nav and changes their mind must either tap a nav item
(navigating away, which is not "closing") or reload the page. The brief's own check list —
"*is the drawer truly usable at 320px (open → navigate → **close/scrim**)?*" — is exactly what fails.

**Concrete repair (not applied — report only):** scope the disabling rule so it cannot apply inside
the drawer widths, mirroring the fix already used for `.drawer-toggle`:

```css
@media (min-width: 721px) { .scrim { display: none; } }   /* was: top-level .scrim { display:none } */
```
and delete the bare top-level rule. Then add a dismissal affordance (Escape handler on the drawer,
and/or a close button in `.sidebar-head`), and extend `evidence:phase5` with a *close* assertion.

---

### B2 — The scrim would be under the sidebar even if it rendered  🔴

**Location:** `src/styles.css:1121` (`.scrim { z-index: 30 }`) vs `src/styles.css:1087` (`.sidebar { z-index: 40 }`), both inside the same `@media (max-width: 720px)` block.

The sidebar is `position: fixed; z-index: 40`; the scrim is `position: fixed; z-index: 30`. The scrim
is intended to dim the content *and* catch the tap outside the sidebar, but it is painted beneath the
sidebar's stacking level. Because the scrim covers the sidebar's own box, this is currently masked by
B1 (the scrim is 0×0), but it is a second, independent defect that a B1 fix alone would expose.

**Falsifiable reproduction:** after applying the B1 repair in a scratch copy, re-run
`scrim-probe.mjs` and compare the scrim's `zIndex` (30) with the sidebar's (40) — the sidebar stays
interactive on top of the scrim. Alternatively, from the current build, read both computed
`z-index` values with the drawer open (both are correct CSS values; the ordering is wrong).

**Concrete repair:** give the scrim a `z-index` above the sidebar (e.g. `45`) or lower the sidebar's
drawer `z-index` below it.

---

### B3 — Two shipped assertions are vacuously true (the harness cannot fail them)  🔴

**Location:** `scripts/evidence-phase5.mjs:160–171` (`closeTo`/`parseRgb`), `:367`, `:379`.

```js
function parseRgb(s) {                       // line 166
  const m = /rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(s || '');
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}
// call sites:
check('the dark theme is actually painted (--bg is dark)', closeTo(parseRgb(st.bg) ?? [], HEX.darkBg), st.bg);   // :367
check('light paints a light background',                   closeTo(parseRgb(st.bg) ?? [], HEX.lightBg), st.bg);  // :379
```

`st.bg` is `getComputedStyle(root).getPropertyValue('--bg')` — a **hex string** such as `#f6f8fa`.
The regex only matches `rgb(...)`/`rgba(...)`, so `parseRgb` returns `null`, the `?? []` turns it into
`[]`, and `[].every(…)` is **vacuously `true`**. Both assertions therefore pass for *any* colour.

**Proof it is vacuous — mutation `light-bg-dark`:** I appended
`html[data-theme=light]{--bg:#0d1117;}` to the built stylesheet (higher specificity, wins) so light
mode paints an essentially black page while every other token is correct. The harness reported:

```
[mutation light-bg-dark] exit code = 0
[mutation light-bg-dark] *** VACUOUS — the shipped checks PASSED against a broken app ***
afterToggle: { theme: "light", bg: "#0d1117", chartBg: "#ffffff", … }
→ passed 53 / failed []
```
`report.json` at `review-evidence/qa-phase5/mutation-light-bg-dark/report.json` records
`bg: "#0d1117"` next to `passed: 53`. The page was visibly wrong and the gate said green.

**Direct falsification of the helper (node):**
```
parseRgb("#f6f8fa")          = null
closeTo([], "#f6f8fa")       = true      ← every hex-colour assertion is a no-op
closeTo([13,17,23],"#f6f8fa")= false     ← the intended behaviour, reachable only for rgb()
```

**Scope of the damage:** the two `--bg` assertions are dead. The canvas assertions (`:406`, `:423`)
are *not* affected — they consume a real `[r,g,b]` from `getImageData`, which is why mutation
`chart-bg` correctly failed. So this is not a wholesale collapse of the suite, but the single
assertion the lead's "theme painted on boot" fix is supposed to be validated by is not actually
testing anything.

**Concrete repair:** make `parseRgb` accept hex (`#rgb`/`#rrggbb`), or change the call sites to
compare `st.bg` against the expected hex string directly, and drop the `?? []` fallback that turns a
parse failure into a pass (a parse failure should be a *failure*, not a vacuous success).

---

## MUTATION RESULTS (harness is not uniformly vacuous)

Method: `review-evidence/qa-phase5/mutation-run.mjs` builds a **mutant root** — the real `dist/`
copied, one stylesheet mutation applied, `server/`+`shared/`+`node_modules/` symlinked — then runs a
byte-for-byte copy of the shipped `scripts/evidence-phase5.mjs` (only `ROOT`/`EVIDENCE_DIR`/`WORK_DIR`
repointed). Nothing outside `review-evidence/qa-phase5/` is touched.

> Note on method: an earlier attempt to mutate CSS at runtime via `page.route('**/*.css')` was
> **invalid** — the service worker serves precached CSS that Playwright interception cannot see, so
> the mutation silently did not apply. A first `chart-bg` attempt that *prepended* the override into
> the same `[data-theme=light]` block was also invalid — the later real declaration won. Both were
> discarded; only the appends below are trustworthy, and each was confirmed present in the served CSS.

| mode | mutation applied to the built CSS | harness exit | which checks failed | verdict |
|---|---|---|---|---|
| `chart-bg` | `html[data-theme=light]{--chart-bg:#161b22}` | **1** | `in light mode the chart canvas paints the LIGHT background`; `the canvas colour actually changed between themes` | **non-vacuous ✓** |
| `drawer-hidden` | `@media (max-width:720px){.drawer-toggle{display:none!important}}` | **1** | `the drawer (hamburger) is visible at small-phone`; `… at phone`; `the hamburger is present on a phone` | **non-vacuous ✓** |
| `no-light-token` | strip all `[data-theme=light]` overrides | **1** | the 2 canvas checks failed… | canvas checks ✓ — **but** both `--bg` checks **wrongly passed** while light mode painted `#0d1117` (→ B3) |
| `light-bg-dark` | `html[data-theme=light]{--bg:#0d1117}` | **0** | *(none)* — 53/53 passed | **VACUOUS ✗ → blocking finding B3** |

Artifacts (logs + the mutant run's own `report.json`): `review-evidence/qa-phase5/mutation-*/`.
Conclusion: the **canvas** and **drawer-visibility** families are genuinely load-bearing; the
**page-background (`--bg`)** family is not.

---

## NON-BLOCKING OBSERVATIONS (owner decisions)

**N1 — Hard-coded reference-line colours are not themed, and one fails contrast on white.**
`src/analyst/PriceSeriesChart.tsx:123–129`:
```ts
export const REF_COLORS = { price:'#4c8dff', targetLow:'#7d8590', targetMean:'#26a69a',
                            targetHigh:'#7d8590', estimate:'#f5c542' } as const;
```
These are passed straight to `createPriceLine()` and never read from `chartPalette()`. Measured on the
real canvas in light mode (`review-evidence/qa-phase5/reference-line-probe.mjs`):

| colour | painted? | pixels | contrast on `#ffffff` | WCAG non-text (≥3:1) |
|---|---|---|---|---|
| `targetLow`/`targetHigh` `#7d8590` | yes (`pf-band-chart`) | 1984 | 3.73 | ok |
| `targetMean` `#26a69a` | yes (`pf-band-chart`) | 1430 | **2.9985** | **fails** |
| `price` `#4c8dff` | yes (`pf-ntm-chart`) | 1186 | 3.20 | ok (marginal) |
| `estimate` `#f5c542` | **not observed in use** | — | 1.62 | n/a (dead constant?) |

The *themed* palette does handle light properly (`--sma20 #b8860b` → 3.25, `--up #0f7d72` → 5.00,
`--chart-text #57606a`), so this is an inconsistency rather than a systemic failure — but it is the
exact "hard-coded colours left in components" the brief asks about. `#26a69a` is also retained as
`UP_COLOR` in `src/chart/data.ts:52` (used only as the pre-CSS fallback in `chartPalette`).

**N2 — Token completeness is otherwise sound.** `:root` declares 65 tokens, `[data-theme='light']`
overrides 60; the 5 not overridden (`--radius`, `--radius-sm`, `--gap`, `--font`, `--mono`) are
structural, not colours. No `var()` is referenced without a declaration; there are no light-only
tokens. (`review-evidence/qa-phase5/token-diff.mjs`.)

**N3 — Locale parity and i18n are clean.** `en` 845 keys / `zh-HK` 845 keys, none missing either
direction. 463 distinct `t()` keys are used; the only literal without a dictionary entry is the
*prefix* `'pf.est.period.'`, which is always suffixed at runtime (`pf.est.period.0q`, `.0y`,
`.fyPlus` all exist). Independently scanned the rendered DOM of all 7 screens in both locales for
raw keys — **none found**; no English leak into zh-HK and no CJK leak into EN (the single `中` glyph in
the EN UI is the intended language-switch label, `src/components/TopBar.tsx:137`).

**N4 — The `≥40px` touch-target claim is scoped to phones only, and the gate knows it.** At 768/1024/1600 px
four visible top-bar controls measure 19.5–34 px (theme toggle 25 px, language buttons 19.5 px,
refresh 34 px). `scripts/evidence-phase5.mjs` only applies the 40 px check when `width <= 390`, so the
shipped claim is not contradicted — but the tablet/desktop top bar is below common touch minimums for
touch-capable larger devices. Owner call.

**N5 — Things I tried to break that held up.**
- Light mode + **zh-HK** (CJK labels are wider): 0 px horizontal overflow at 320/360/390/768.
- A **live OS colour-scheme flip** while `system` is selected flips the app with no reload
  (`dark → light`, `--bg #f6f8fa`).
- **7 rapid theme toggles**: `data-theme`, computed `--bg`, the toggle's `data-theme-current` and
  `theme-color` meta all end consistent.
- **All three** chart canvases repaint: `pf-band-chart` and `div-chart` both give `rgb(22,27,34)` in
  dark and `rgb(255,255,255)` in light (the shipped harness only samples the main chart).
- The `.ohlc-legend` DOM overlay stays light-on-light in light mode
  (`rgba(255,255,255,.85)` bg, `rgb(27,35,44)` text).
- Zero console errors / page errors across every probe.

Reproduce with `node review-evidence/qa-phase5/adversarial-probe.mjs` (19 assertions),
`adversarial-probe2.mjs`, `reference-line-probe.mjs`, `tap-target-probe.mjs`.

---

## THE LEAD'S TWO FIXES

1. **Mobile hamburger visibility** — the `@media (min-width: 721px)` scoping of
   `.drawer-toggle{display:none}` (`src/styles.css:1293–1297`) is correct and load-bearing: mutation
   `drawer-hidden` fails the harness as required, and the hamburger is genuinely present and ≥40 px at
   320/390 px. **But the drawer it opens cannot be closed** (B1/B2) — the fix is incomplete for
   "truly usable".
2. **Theme painted on boot** — runtime behaviour is correct (verified independently, including the
   live-OS-flip and rapid-toggle paths). However the assertion that is supposed to *prove* it
   (`--bg` at `:367`/`:379`) is vacuous (B3), so this fix is effectively **uncovered by its own
   evidence**.

---

## WHAT I COULD NOT VERIFY (and why)

- **Real mobile browsers.** Everything here is headless Chrome on desktop macOS. iOS Safari/WebKit
  `100dvh`/safe-area handling, and Android Chrome's touch/scroll behaviour with a live drawer, were not
  exercised. The scrim defect found in Chromium is a CSS-cascade defect and will reproduce wherever the
  same stylesheet loads, but I did not confirm it on a device.
- **True PWA installability.** I confirmed the manifest is served with 192/512 icons, `display:
  standalone` and a `start_url`, and that a service worker registers (matching the harness). Whether the
  browser actually offers installation (`beforeinstallprompt` / iOS "Add to Home Screen") was **not**
  verified — that needs a real browser session and is beyond the headless harness.
- **Performance/memory** of the chart rebuild-on-theme-flip path under sustained toggling (the code
  rebuilds the canvas on every theme change). Not measured.
- **Screen-reader behaviour** of the drawer (focus trap / `aria-expanded` announcement). `aria-expanded`
  is wired on the hamburger, but the drawer cannot be dismissed, so focus-order behaviour after opening
  was not meaningful to test.
- **The `REF_COLORS.estimate` dead constant** — I could not find a call site that paints it, so its
  1.62:1 contrast is currently theoretical.

---

## RECOMMENDATION

Return to the owner with **B1, B2 and B3** as blocking. B1+B2 are a small CSS fix plus a dismissal
affordance; B3 is a helper fix in the harness. The remaining Phase 5 surface (responsive layout,
theme runtime behaviour, chart repaint, i18n parity, PWA shell) is in good shape and survived
adversarial testing.

### Artifacts produced (all under `review-evidence/qa-phase5/`)
```
QA-REPORT.md                     this report
mutation-run.mjs                 mutant-root mutation runner (modes: chart-bg, drawer-hidden,
                                 no-light-token, light-bg-dark)
mutation-<mode>/run.log          full harness output per mutation
mutation-<mode>/report.json      the mutant run's own evidence report
adversarial-probe.mjs            overflow(locale×theme), locale parity, OS flip, rapid toggles,
                                 other-chart repaint, legend readability
adversarial-probe2.mjs           drawer lifecycle + all-screen raw-key scan
scrim-probe.mjs                  scrim geometry / z-order
drawer-close-probe.mjs           can a user dismiss the drawer?  → 1/5
reference-line-probe.mjs         on-canvas REF_COLORS contrast census in light mode
tap-target-probe.mjs             top-bar touch-target audit by width
token-diff.mjs                   :root vs [data-theme='light'] token diff
adversarial/*.json               machine-readable results
```
