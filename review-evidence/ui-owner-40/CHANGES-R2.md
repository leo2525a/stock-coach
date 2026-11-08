# UI round 2 — owner feedback (38/100)

Owner's asks (paraphrased):

1. **The logo bar has to go.** Every button that sat on it should move into the
   sidebar.
2. **Collapsing the sidebar should put it away in one move.** No extra tap to
   get back to the tab you were on.
3. **The buttons are a mess** — find a way to make them less chaotic; a slide
   animation is welcome.
4. If context gets too large, split things into separate components to call.
5. Then push to GitHub.

## What changed

| File | Change |
| --- | --- |
| `src/components/Controls.tsx` | **new** — shared controls (`ThemeToggle`, language switch, refresh) extracted so `App`/`Sidebar` can call one component instead of repeating markup. |
| `src/App.tsx` | `TopBar` import/render removed entirely. Added `hideChrome` (desktop-only, session-only), a floating corner handle, and the `c` shortcut. Scrim is always mounted and fades below 1181px. Drawer breakpoint moved 720px → 1180px. |
| `src/components/Sidebar.tsx` | Now hosts the brand (`.sidebar-head`) and the global controls (`.sidebar-controls`) at its top. |
| `src/components/TopBar.tsx` | Reduced to a headline row (symbol + price), mounted only on the chart screen. Kept the `topbar-symbol` / `topbar-price` test ids. |
| `src/components/ChartToolbar.tsx` | Hairline `<span class="toolbar-sep">` separators removed; each concern is now one `.toolbar-group` capsule. |
| `src/styles.css` | Deleted `.topbar`; desktop rail slides out via `margin-left` with a delayed `visibility`; removed the old `.collapsed` / `min-width:721px` block; restored drawer flex; `.drawer-toggle` / `.handle` are ≥40px; `.sidebar-controls` controls are 40px; toolbar groups became rounded capsules with a transition. |
| `src/store.ts` | Removed `sidebarCollapsed`, `SIDEBAR_KEY`, `readPersistedCollapsed`, `setSidebarCollapsed` — desktop collapse is no longer persisted. |
| `shared/i18n/{en,zh-HK}.ts` | Added `nav.hide` / `hideTitle` / `show` / `showTitle`. |
| `tests/theme.test.tsx`, `tests/stale-badge.test.tsx` | Updated for the moved controls. |
| `scripts/evidence-phase3.mjs`, `evidence-phase4.mjs`*, `evidence-chart.mjs`, `evidence-phase5.mjs` | Updated to the sidebar-only navigation: nav via the drawer-aware `clickNav`, headline assertions on the chart screen, touch-target rule on `.sidebar-controls` / `.drawer-toggle` / `.handle`, drawer threshold ≤1180px, `topBarCount === 0`. |

\* phase4 needed no change; listed for completeness of the harness set touched.

## Verification (coordinator, on the production build @ `127.0.0.1:8787`)

| Gate | Result |
| --- | --- |
| `npx tsc --noEmit` | 0 errors |
| `npm run lint` | clean (0 warnings) |
| `npm test` | 469 passed / 23 files |
| `npm run build` | 0; dist uses relative URLs ("relative OK") |
| `npm run verify:runtime` | PASSED — 178 checks |
| `npm run evidence:phase3` | PASSED — 76 checks, 0 skipped |
| `npm run evidence:phase4` | PASSED — 88 checks, 0 skipped |
| `npm run evidence:phase5` | PASSED — 60 checks, 0 skipped |
| `npm run evidence:chart` | PASSED — 82 checks |
| `npm run evidence:colour` | PASSED — 35 checks |
| `verify-ui2.mjs` | **21 pass / 0 fail** |
| `verify-ui2.mutation.mjs` | **4/4 mutations caught** |

The coordinator verifier measures the *rendered* result: the logo bar is gone,
the sidebar carries brand + controls, one click hides the panel and a corner
handle restores it, the panel has a `margin-left` slide transition, the toolbar
is 5 rounded capsules with no separators, the headline row is not sticky, and
there is no horizontal overflow at 320/393/768/1280 with zero console errors.

The mutation counter-proof rewrites the built CSS to (a) disable the hidden
rule, (b) remove the transition, (c) square the toolbar pills, (d) pin the
headline row — and asserts each break makes the verifier fail. 4/4 caught, so
the pass is non-vacuous.

Screenshots: `review-evidence/coordinator-ui/round2/` (desktop shown/hidden,
chart toolbar, four widths). Raw results: `round2/verify-report.json`.
