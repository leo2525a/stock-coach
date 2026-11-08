# BRIEF — UI fix round 1 (TIGHT; keep the diff small)

Repo: `/Users/love21/.openclaw/workspace/debug-coder/projects/stock-app`
Write scope: `src/**`, `tests/**`, `package.json` **scripts only**. Do NOT touch
`node_modules`, do NOT commit, do NOT write an evidence script (the coordinator
owns verification). The API server is already running on `:8787` — leave it.

Make **exactly** these changes. Numbers are measured; do not re-investigate.

## E1 — desktop collapse must animate
`.sidebar` (top-level, near line 415) currently has **no** transition.
Add: `transition: width 0.22s ease, flex-basis 0.22s ease;`
Also add an opacity fade for the parts that disappear:
`.sidebar .side-text, .sidebar .wl-name, .sidebar .wl-quote, .sidebar .sidebar-label-text,
 .sidebar .side-group-label, .sidebar .group-by { transition: opacity 0.14s ease; }`
and in `.sidebar.collapsed` keep `display:none` for those (layout) — the fade is a
bonus; `display:none` must still win.

## E2 — collapsed rail must not show names/quotes (real bug)
In the `@media (max-width:720px)` block (~lines 1118–1131) DELETE these
`display: revert;` overrides entirely (they re-show `.wl-name`, `.wl-quote`,
`.side-text`, `.group-by`, `.side-group-label` inside the 62px rail):
```css
.sidebar.collapsed .sidebar-label-text,
.sidebar.collapsed .sidebar-label,
.sidebar.collapsed .wl-name,
.sidebar.collapsed .wl-quote,
.sidebar.collapsed .side-text,
.sidebar.collapsed .group-by,
.sidebar.collapsed .side-group-label { display: revert; }
```
Collapsed hiding must be a **single width-agnostic rule** that already exists at
the top level (`.sidebar.collapsed .wl-name { display:none }` etc.). Also widen the
rail so a symbol reads cleanly: change top-level `.sidebar.collapsed { width:62px;
flex:0 0 62px }` → `width:72px; flex:0 0 72px`. Ensure `.wl-sym` is
`white-space:nowrap` and `.wl-row`/`.side-item` stay centred with no overflow.

## E3 — phone topbar is 175px tall (blank space)
At ≤720px the `.topbar-spacer` (`flex:1; min-width:8px`) forces a whole extra row.
Add inside `@media (max-width:720px)`:
```css
.topbar-spacer { display: none; }
```
Tighten the phone bar: `row-gap: 6px; padding: 8px 12px;` and let
`.symbol-head` + `.price-block` share a row where they fit. **Target: `.topbar`
height ≤ 100px at 393px width, nothing clipped.**

## E4 — scrim pops in / lingers (real bug)
`DrawerScrim()` in `src/App.tsx` returns `null` when closed, so the scrim
appears/disappears instantly while the drawer animates. Change it so the scrim is
**always rendered** and its visibility is driven by a class/attribute:
- Render the `<button className={"scrim" + (open ? " open" : "")} …>` unconditionally.
- CSS: `.scrim { opacity: 0; pointer-events: none; transition: opacity 0.18s ease; }`
  and `.scrim.open { opacity: 1; pointer-events: auto; }` (keep the phone-only
  `display:block`/position/z-index and the `@media(min-width:721px){display:none}`
  rules working — the scrim must still be absent on desktop).
- Keep working: tap-outside closes, `Escape` closes, `data-testid="drawer-scrim"`.

## E5 — polish
After E1–E4, sweep dashboard / chart / signals / watchlist / analysts / dividends /
help at 320 / 393 / 768 / 1280 px and fix anything visibly wrong (clipped or
wrapped text, cramped rows, misaligned icons). Keep it minimal and safe.

## Verify and paste (numbers, not adjectives)
- `npx tsc --noEmit` → 0
- `npm run lint` → 0
- `npx vitest run` → count + files (update any test that asserted the old
  `display:revert` / scrim-null behaviour)
- `npm run build` → 0
- `npm run verify:runtime` && `evidence:phase3` && `evidence:phase4` && `evidence:phase5` → all pass
- `shasum -a 256` of each file changed

Stop when those are green and paste the output. If one cannot pass, paste the
exact failing line — do not claim success you did not measure. Keep the diff
small; do not refactor unrelated code.
