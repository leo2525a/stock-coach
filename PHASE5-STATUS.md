# Phase 5 (UI/UX) — Status Snapshot (2026-11-07 HKT)

## Owner request (5 items)
1. 唔要 nav bar，淨係要 sidebar
2. responsive mode 啲嘢唔好咁迫（透氣）
3. 加白色（light）+ 日夜 mode 可 switch
4. 整體舒服啲
5. 想用 app 型式睇（PWA / 安裝）

## State: ✅ CLOSED 2026-11-07 (~23:50) — independent adversarial QA round 1 FAIL → all findings fixed + mutation-proven → round-2 re-QA **PASS**

The coder's run was truncated mid-stylesheet; the lead completed and **verified** the work, then commissioned an independent adversarial QA of the whole phase. Independent re-verification: `review-evidence/qa-phase5-rerun/QA-REPORT-RERUN.md` (VERDICT: **PASS**).

### Independent QA round (2026-11-07)
`debug-reviewer` returned **VERDICT: FAIL** — report `review-evidence/qa-phase5/QA-REPORT.md`. Every finding was then fixed by the lead and proven non-vacuous with mutation (see below):
- **B1 (blocking)** — the mobile drawer could not be dismissed: a bare top-level `.scrim { display:none }` won over the `≤720px` rule, so the scrim was `display:none`/0×0 at every width, and there was no Escape handler or close button. **Fixed**: scoped the hide to `@media (min-width:721px)` and added an Escape-to-close handler in `Shell`.
- **B2 (blocking, rejected as written)** — the reviewer argued the scrim's `z-index:30` should beat the sidebar's `40`. That is **wrong**: a drawer scrim belongs *below* the drawer it dims (raising it would cover the sidebar and make nav untappable; `.scrim` has no pointer handler anyway). Left as intended; the real fix is B1 (make the scrim render).
- **B3 (blocking)** — the two "theme is actually painted" assertions were vacuous: `parseRgb` only matched `rgb(...)` but was fed hex, so it returned `null` → `?? []` → `[].every()` → always true. **Fixed**: `parseRgb` now handles `#rgb`/`#rrggbb` **and** `rgb()/rgba()`, and the checks fail closed (an unparseable colour is a failure, not a pass).
- **N1 (non-blocking)** — the analyst reference lines were a hard-coded constant (`#26a69a` = 2.9985:1 on white). **Fixed**: moved the five reference colours to themed tokens (`--ref-*`) surfaced through `useRefColors()`; a light override now takes effect.
- **N4 (non-blocking)** — the ≥40/44px touch rule was phone-width only, so a *tablet* used with a finger still got 19.5–36px controls. **Fixed**: the min-sizes now also apply under `@media (pointer: coarse)`.

### Mutation proof for every fix (all run against the production build, shipped harness verbatim)
- restore the bare `.scrim{display:none}` → **3 FAILs** (scrim display:none/0×0, tap-outside no-op, + cascade abort).
- remove the Escape handler → **1 FAIL** (`Escape closes the drawer — false`).
- force light `--bg:#0d1117` (the old B3 mutant) → **1 FAIL** (`light paints a light background — #0d1117 (≠ #f6f8fa)`); it passed vacuously before.
- remove `@media (pointer: coarse)` → **2 FAILs** (`touch controls … 768px/1024px tablet — 19.5px`).
- unit pin: light `--ref-mean` must differ from dark (a copy-paste would leave them equal).

### Round-2 independent re-QA: PASS
`debug-reviewer` re-ran the shipped harness on the production build (**58 checks, 0 skipped**), re-measured all 7 hashes (match), independently reproduced **all four** mutations in a scratch copy (`b1` → 3 fails, `b1b` → `Escape closes the drawer` false, `b3` → `light paints a light background — #0d1117`, `n4` → both tablet checks `19.5px`), and attacked the B2 rejection with real hit-testing (scrim `elementFromPoint` right of the drawer → `BUTTON.scrim` closes; nav item → `BUTTON.side-item` navigates — so z30 < z40 is correct). No new defect introduced; six Escape cycles leak-free; `--ref-` light contrasts 3.25–5.00:1 (all ≥3:1). Non-gating observations left as owner calls: `--ref-estimate` is currently a token with no paint call site; desktop/tablet **fine-pointer** top-bar controls remain 19.5–34px (the ≥40px floor is asserted only under `hasTouch`/≤390px).


### What shipped
- **Sidebar-only nav.** `TopBar`'s duplicated `<nav>` (dashboard/chart/signals/… help) removed — the Sidebar already carries all 7 screens incl. dividends. TopBar keeps hamburger + brand + quote + theme + lang + refresh. Proven: `header.topbar nav` count = 0, and every screen still reachable from the sidebar.
- **Light + day/night.** `src/theme.ts` (pure): `ThemeMode dark|light|system`, `ResolvedTheme`, `THEME_KEY`, `resolveTheme`, `applyTheme` (`<html data-theme>` + `colorScheme` + `theme-color` + boot key). Light tokens in `styles.css` under `[data-theme='light']`. `index.html` boot script paints the first frame (no flash). Store has `themeMode`/`theme`/`setThemeMode`/`toggleTheme`/`syncSystemTheme`; `main.tsx` wires the OS `matchMedia` listener. TopBar sun/moon button.
- **Charts are theme-aware.** `src/chart/theme.ts` reads the *live* computed tokens and hands a palette to all three `lightweight-charts` canvases; the resolved theme is in each build effect's deps, so a flip rebuilds. Verified by sampling the **rendered canvas pixels**, not the CSS.
- **Comfortable responsive.** Existing ≤720px block + new ≤720/≤380 comfort rules; `.lang-switch` chips get a 40px floor; touch targets ≥44px.
- **App form.** Manifest + service worker served from the build (`display: standalone`, 192/512/maskable icons); install steps in `INSTALL-PHASE5.md`.

### Two real defects found by the evidence pass (both missed until measured)
1. **Mobile hamburger permanently hidden.** A late, un-scoped `.drawer-toggle { display:none }` came *after* the ≤720px block that re-enables it, so it won at every width — **no way to open the nav on a phone**. Fixed by scoping the hide to `@media (min-width:721px)`. Mutation (restore the bare rule) → **4 evidence FAILs** (`the drawer (hamburger) is visible … false`).
2. **Document theme not painted on boot.** A *fresh* boot with a stored `light` choice + OS `dark` rendered light components but left `<html data-theme>` dark (only the *transitions* called `applyTheme`). Fixed by painting the theme on mount in `Shell` (`useEffect([theme])`). Mutation (remove that effect) → **1 evidence FAIL** (`an explicit light choice ignores an OS-dark preference — dark`).

Both were caught by `scripts/evidence-phase5.mjs` (new, real-browser, production build).

### Verification instruments (new this phase)
- `tests/theme.test.tsx` — 14 tests: resolution, `applyTheme` paint, store transitions, **both palettes define the same chart tokens** (so light can't leak a dark canvas value), `index.html` boot, TopBar has no `<nav>`.
- `scripts/evidence-phase5.mjs` — **58** real-browser checks: sidebar-only nav (top `<nav>` absent + all screens reachable), theme switch/persist/`system`, **canvas pixel colour in both themes + "the colour actually changed"** (fail-closed), phone drawer **open → navigate → close** (scrim rendered, tap-outside closes, Escape closes), overflow + padding + touch targets at 320/390/768/1600px **+ coarse-pointer tablet targets**, manifest + service worker, clean console.
- Existing browser harnesses pinned to `colorScheme:'dark'` so their dark-palette assertions keep testing what they were written for.

### Final gate stack (lead-run, after the QA fixes)
tsc 0 · lint 0 · **469 tests / 23 files** · build 0 · verify:runtime **178** · evidence:chart **82** · evidence:colour **35** · evidence:phase3 **76** · evidence:phase4 **88** · **evidence:phase5 58 (0 skipped)** — exit 0.

### Non-gating observations (owner decision)
- The sidebar nav counts 7 screens; TopBar no longer duplicates them (intentional).
- The N1 fix supersedes the earlier "reference lines are left as-is" note: they are now themed.

### Constraints held
- No commit / no publish. `projects/stock-analyzer` untouched. Write scope = `projects/stock-app`.
- Lead-applied fixes (the coder run was truncated); coder's own edits (`theme.ts`, `store.ts`, `TopBar.tsx`, `index.html`, light tokens, responsive blocks) preserved and verified.

### Key file hashes (after the QA fixes)
- `src/styles.css` sha256 `6c2fec58b4d1549ab0de30951ce95909f49acb7c6c831027949d1f3cfe4d4d1b`
- `src/App.tsx` sha256 `d679f459448fae69b3a931578729ccf2c4109c7ff8c7f2d8520ec93cc766ac53`
- `src/chart/theme.ts` sha256 `766d15e7f3ceacad9cc4b7cf1a5c44e9c1b8929ad529b44a73141c231460d882`
- `scripts/evidence-phase5.mjs` sha256 `6a5f3132a93d2507604a3a07579abcfe523f6854226a5da6a7ae410bd50f60f1`
