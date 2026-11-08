# Round 3 — owner feedback 50/100

Owner brief (2026-11-08, `gateway-owner`):

1. Xcode live walkthrough (teaching)
2. **Bug** — 「個 button 冇作用」 (a button does nothing)
3. **Bug** — 「上面埋 button 堆埋一堆咁好唔好睇」 → tidy it, **"可以用 scroll 既方法"**
4. 「將類似既 function 擺埋一齊係一個 category」
5. The main-page menu button must be the **most discreet** entry: one tap opens it, and it **shows the logo**
6. Score raised 38 → **50/100**, still work to do

## What was actually broken (measured, not guessed)

### B1 — the 「«」 button inside the phone drawer did nothing

`[data-testid="sidebar-collapse"]` called the desktop-only "hide the chrome"
toggle. At ≤1180px the sidebar is an off-canvas drawer, so flipping
`body.chrome-hidden` did not close anything: the drawer stayed open and the
panel was left in a contradictory state.

- Probe: `probe-collapse.mjs` — after opening the drawer at 393 px and tapping
  「«」, `.sidebar` still had `open`, body gained `chrome-hidden`, and the entry
  button stayed hidden. A dead-looking control.
- Fix: `App.tsx` gained `putSidebarAway()` — at ≤1180 px it closes the drawer;
  at desktop it puts the rail away. `Sidebar` now receives
  `onToggleHidden={putSidebarAway}`.

### B2 — orphan CSS: `.symbol-head` had lost its selector

While deleting `.topbar` in round 2 the `.symbol-head { … }` opening selector
was removed, leaving its declarations attached to the previous rule. The chart
headline row therefore had **no** flex layout. Present since the first commit
(`7fd583d`).

- Fix: restored `.symbol-head { display:flex; align-items:baseline; gap:10px; flex-wrap:wrap; }`.

### B3 — the chart toolbar was a heap on a phone

At 393 px: **4 rows, 175 px tall, 25 buttons, 5 groups** (owner: 「堆埋一堆」).

- Fix: the toolbar is a single row that scrolls horizontally
  (`flex-wrap:nowrap; overflow-x:auto; overscroll-behavior-x:contain;
  scroll-snap-type:x proximity`, trailing edge fade). At ≥1181 px there is room,
  so it wraps rather than hiding controls behind a fade.

### B4 — the menu entry

- The old floating 「»」 handle is gone (one entry, not two).
- `hideChrome` now defaults to **true**: the page opens with the panel away, and
  the single discreet ☰ (ghost, `opacity:.55`, 40×40, `z-index:60`) is the only
  way in at every width.
- It steps aside while the drawer is open (`.app:has(.sidebar.open) .drawer-toggle`)
  so it never sits on the brand row.
- Opening it reveals the sidebar **with the logo**.

## Changes

| File | Change |
| --- | --- |
| `src/App.tsx` | `putSidebarAway()`; `hideChrome` default `true`; floating handle removed; single ghost ☰ |
| `src/styles.css` | `.symbol-head` restored; toolbar single-row scroll (+ desktop wrap); `.drawer-toggle` ghost/always-visible; `.handle` rules deleted; drawer-open rule |
| `scripts/evidence-phase3/4/5.mjs`, `evidence-chart.mjs`, `evidence-colour.mjs` | `openSidebar()` helper — `isVisible()` cannot see that a translated-out panel is away, and controls inside it (theme, language, watchlist) must be opened first |
| `review-evidence/coordinator-ui/verify-ui3.mjs` | NEW — 41 independent checks on the production build |
| `review-evidence/coordinator-ui/verify-ui3.mutation.mjs` | NEW — 10 mutants, 10 caught |

The harness change is not cosmetic: with the panel away by default, the old
`clickNav` clicked a control that was off-canvas, so phase 3/4/5 and the chart
and colour gates failed with `Element is outside of the viewport`. That was the
harness being wrong about the new UI, not the UI being broken.

## Gates (this build)

| Gate | Result |
| --- | --- |
| `tsc --noEmit` | 0 |
| `eslint .` | clean |
| `vitest run` | 469 passed / 23 files |
| `npm run build` | 0 |
| `npm run verify:runtime` | 178 |
| `evidence:phase3` | 76 |
| `evidence:phase4` | 88 |
| `evidence:phase5` | 61 |
| `evidence:chart` | 82 |
| `evidence:colour` | 35 |
| `verify-ui3` (coordinator) | **41 pass / 0 fail** |
| `verify-ui3.mutation` | **10/10 caught** |

## Hashes (round 3)

```
src/App.tsx           6e36aa7acf9dd6b98d8ccc1589ac41902c30e432c69de4fffcd4269b635eab64
src/styles.css        1d32422367fd61ea11752cacc65d6d2bf3cb494ce4058c9fc67382c8b2834cad
```

## Mutations (10/10 caught)

1. put-away panel not pushed off-canvas → FAIL
2. slide transition removed (both declarations) → FAIL
3. menu entry becomes a solid bar → FAIL
4. entry stays on top while the drawer is open → FAIL
5. phone toolbar wraps into rows → FAIL
6. toolbar hides overflow instead of scrolling it → FAIL
7. scroll snapping removed → FAIL
8. capsules squeezed so functions split across rows → FAIL
9. corner entry no longer opens the drawer on a phone → FAIL
10. corner entry loses its accessible label → FAIL
