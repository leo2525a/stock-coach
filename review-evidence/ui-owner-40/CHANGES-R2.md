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

## Round-2 hashes (sha256)

```
src/styles.css                  11e1dd64d316aa082f1f46eaa52b3693e7db539ec061eea7d4c5540b87797b0d
src/App.tsx                     e1d515847323ba20ef9a30b9d48d055e21b4b862a1bed50dccbe803cf2a21b1c
src/components/Sidebar.tsx      8f4e1f43f580b5f3869ae32f208aaadfd8c8d9be21d7914d4f29d1fc7db15dad
src/components/TopBar.tsx       d3d1de0c02b89a933fef6c549b4f6f318d4ab2ef9aea6cd0d3cda8a4d4c73210
src/components/Controls.tsx     feeed028d31338b5cc2b763881620120759f1f74f8f4b2a5c4768e79553c4d2d
src/components/ChartToolbar.tsx 261132a56c7fedeeb4d8d31acf9d5cd67672d7a31bef332293a8989bfb0c2dc2
src/store.ts                    b556f3ca20afafaabb314e397dda8e7ed241f779f5c8ef3e88b3a28c197da729
```

## iOS

The native shell was re-synced and rebuilt against the round-2 build
(`VITE_API_BASE=http://127.0.0.1:8787/api npm run native:sync && npm run ios:build`
→ BUILD SUCCEEDED). `dist/` was then rebuilt back to relative URLs for the web.

## Follow-up

The `build/**` Xcode derived-data output was added to the eslint ignore list and
`.gitignore`: `eslint .` was picking up the copied web bundle inside
`build/ios/.../App.app/public` and reporting ~2.6k false errors.
