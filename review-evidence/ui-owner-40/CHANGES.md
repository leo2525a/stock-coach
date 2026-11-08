# UI fix round 1 — what changed (owner scored the UI 40/100)

Every "before" number was measured on the shipped production build with a real
Chrome browser (`playwright-core`), 2026-11-08. Verified after the fix by the
coordinator's independent verifier
(`review-evidence/coordinator-ui/verify-ui.mjs`, 22/22 pass) plus the full
regression gate suite.

## 1. Collapsed sidebar had no animation
- **Before:** desktop `.sidebar` had no `transition`; collapsing snapped
  `264px → 62px` in one frame (`transition-duration: 0s`).
- **Fix:** `transition: width .22s ease, flex-basis .22s ease` + a `.14s` opacity
  fade on the labels that disappear.
- **After:** `transitionProperty="width, flex-basis"`, `duration=0.22s` — the
  panel slides in/out.

## 2. Collapsed rail looked broken
- **Before (real bug):** the `@media (max-width:720px)` block set
  `.sidebar.collapsed … { display: revert }`, so `.wl-name` / `.wl-quote` /
  `.side-text` reappeared inside the 62px rail → collision/overflow.
- **Fix:** deleted the `display: revert` overrides (one width-agnostic hide
  rule now); widened the rail `62px → 72px`; `.wl-sym` is nowrap.
- **After:** at **393px and 1280px** the collapsed `.wl-name`/`.wl-quote`/
  `.side-text` compute to `display:none`; the rail is 72px with zero horizontal
  overflow and the symbol centred (sym 41px in a 59px row).

## 3. Large blank strip at the top (the 175px topbar)
- **Before:** `.topbar` was **175px** tall at 393px — it wrapped to **5 rows**;
  `.topbar-spacer` (`flex:1; min-width:8px`) forced a whole extra row of its own.
- **Fix:** phone-only ordering makes two deliberate rows —
  `[hamburger · brand · ⇢ · theme · lang · refresh]` then `[symbol · price]`;
  tightened phone padding/row-gap.
- **After:** `.topbar` height = **99px** at 393px, nothing clipped.

## 4. Black mask popped in over the collapsing sidebar
- **Before (real bug):** `DrawerScrim()` returned `null` when closed, so the
  scrim appeared/disappeared instantly while the drawer animated (dark
  `rgba(0,0,0,.55)` flash / residue).
- **Fix:** on phones the scrim is **always mounted** and fades with the drawer
  (`opacity 0 → 1`, `0.18s`, `pointer-events` gated). It is *not* rendered at
  desktop widths, so the DOM is unchanged there.
- **After:** `.scrim` `transitionProperty="opacity"`, `duration=0.18s`;
  `opacity=1` open, `opacity=0` + `pointer-events:none` closed. Tap-outside and
  Escape still close.

## 5. General polish sweep
- All 7 screens (dashboard, chart, signals, watchlist, analysts, dividends,
  help) at 320/393/768/1280px: **zero page horizontal overflow, zero console
  errors**. One real defect found and fixed: the watchlist "manage" row could not
  fit its delete button at 393px (row `scrollWidth 375 > 329`) and pushed the
  button off-screen — the row now wraps and the button stays in view.
- Analysts/dividends tables scroll horizontally **by design** (`overflow-x:auto`
  wrapper) — not a defect.

## Files changed
- `src/styles.css` — `4a7efbdd90a8d41083d5d0933b696cd0db15a2dd5a86213e9f4f4b92c6a41fe0`
- `src/App.tsx` — `ef9fc28fa6aba5e676f0d36f7882f0348070590ddb83d6aeb74ab2deb6115b05`
- `src/components/TopBar.tsx` — `ce0a5f46eac57ecf3b0747964f31b3875c9ce6225cb3a3cce49c1290b75612cf`

## Verification
- `npx tsc --noEmit` → 0
- `npm run lint` → 0
- `npx vitest run` → 469 passed / 23 files
- `npm run build` → 0
- `verify:runtime` 178 · `evidence:phase3` 76 · `evidence:phase4` 88 ·
  `evidence:phase5` 58 (0 skipped) · `evidence:chart` 82 · `evidence:colour` 35
- Coordinator verifier `review-evidence/coordinator-ui/verify-ui.mjs` → 22/22
- **Mutation counter-proof:** breaking the four fixes in the built CSS made the
  verifier report **6 FAIL** (topbar 111px, collapse `none`/0s, rail text
  `display:block`, scrim `none`/0s), then restored → 22/22.
