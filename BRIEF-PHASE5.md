# BRIEF — Phase 5: UI/UX polish (nav removal, responsive comfort, day/night theme, app install)

Owner request (2026-11-07):
1. Remove the **top navigation bar**; keep navigation only in the **sidebar**.
2. Responsive mode: content is too cramped — make it breathe.
3. Add a **day/night (light/dark) theme** with a switch; not dark-only. Make it feel comfortable.
4. Be able to view it as an **app** (installable PWA).

## Scope (write ONLY inside projects/stock-app)

### A. Remove top nav bar
- `src/components/TopBar.tsx`: delete the `<nav className="nav">` block. Keep hamburger (drawer toggle), brand, symbol head, price block, lang switch, refresh.
- Ensure every screen remains reachable via `src/components/Sidebar.tsx` (it already lists dashboard/chart/signals/watchlist/analysts/dividends/help — confirm all 7 are present and grouped sensibly).
- Remove now-dead `.nav` CSS and the `nav.primary` i18n usage only if fully unused; otherwise keep keys.

### B. Responsive comfort
- ≤720px: increase `.main-col` padding (e.g. 12–16px), add vertical rhythm between panels, ensure ≥44px touch targets on primary controls, avoid cramped `.topbar` (allow wrap/space).
- Verify no horizontal scroll at 390px and 320px.
- Keep desktop layout unchanged in spirit.

### C. Day/night theme
- Add light theme tokens. Structure: `:root` = dark defaults; `[data-theme="light"]` overrides. Keep ALL existing token names (`--bg`, `--bg-elev`, `--text`, `--up`, `--down`, `--accent`, chart colours, etc.).
- Default = follow `prefers-color-scheme`; user toggle persists to localStorage; a `theme` state in `src/store.ts`.
- Toggle control: place in the **sidebar header** or topbar (small sun/moon icon button) with i18n `theme.light` / `theme.dark` / `theme.system`.
- Update `<meta name="theme-color">` (index.html) and manifest `theme_color`/`background_color` dynamically or via two media-scoped theme-color metas.
- Contrast: light theme must meet WCAG AA for text and for up/down (green/red) figures. Dark must stay as-is.

### D. App form (installable)
- Confirm manifest + standalone + icons are correct; extend `src/components/HelpScreen.tsx` with clear "Add to Home Screen / 加到主畫面" steps for iOS + macOS.
- Optional: a small install affordance when `beforeinstallprompt` is available.

## Hard constraints
- No commit, no publish. Do not touch `projects/stock-analyzer`.
- i18n parity: every new string added to BOTH locales (en + zh-HK). Parity is asserted somewhere — keep it green.
- **Do not regress** any gate: tsc 0, lint 0, tests, build 0, `verify:runtime`, `evidence:phase4`, `evidence:phase3`, `evidence:chart`, `evidence:colour` (35 checks — theming must not break it; extend it for light mode instead of weakening it).
- Add: new unit tests for theme resolution/persistence, and a `scripts/evidence-phase5.mjs` + `npm run evidence:phase5` that drives the real DOM (Playwright) to assert: no top nav present, sidebar nav reaches all screens, theme toggle flips `data-theme` + computed background changes, persisted across reload, no horizontal overflow at 390px/320px, light-mode contrast sampled, install affordance present.

## Report back
Exact file paths + shas, the full gate stack numbers, evidence:phase5 output, and any uncertainty. Stop when the gates are green on real execution paths.
