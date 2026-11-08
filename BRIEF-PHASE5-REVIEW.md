# REVIEW BRIEF — Phase 5 (UI/UX) independent QA

Repo: `/Users/love21/.openclaw/workspace/debug-coder/projects/stock-app`
Write scope: **only** `review-evidence/qa-phase5/` (create it). Read anything; change nothing else. No commit / no publish.

## Objective
Independently verify — or falsify — the Phase 5 claims below, against the **real app**, not the source's self-description. You are the adversary: a green gate stack already exists (`tsc 0 · lint 0 · 468 tests/23 files · build 0 · verify:runtime 178 · evidence:chart 82 · colour 35 · phase3 76 · phase4 88 · evidence:phase5 53`). Your value is finding what those all-green gates *miss*.

## Owner's five claims (verify each in the rendered app)
1. **Sidebar-only nav** — the top bar carries no `<nav>`; all 7 screens (dashboard/chart/signals/watchlist/analysts/dividends/help) reachable from the sidebar *and*, on a phone, through the drawer.
2. **Responsive comfort** — no horizontal overflow at 320/390/768/1600px; content padding ≥12px; touch targets ≥40–44px.
3. **Light + day/night** — a sun/moon toggle switches dark⇄light; `system` follows the OS; an explicit choice does not; the choice persists; **the chart canvases repaint** (pixel-level).
4. **Overall comfort** — nothing cramped/overlapping at the small widths.
5. **App form** — manifest + service worker are served; installable.

## Files that changed (verify the final content — hashes are the fixed state)
- `src/theme.ts` (NEW), `src/chart/theme.ts` (NEW)
- `src/store.ts` (theme slice), `src/App.tsx`, `src/main.tsx`, `src/components/TopBar.tsx`, `index.html`, `src/styles.css`
- `src/chart/StockChart.tsx`, `src/dividend/DividendChart.tsx`, `src/analyst/PriceSeriesChart.tsx` (theme-aware palettes)
- `tests/theme.test.tsx` (NEW), `scripts/evidence-phase5.mjs` (NEW), `eslint.config.js`, `package.json`
- sha256: `src/styles.css c7917215b8a84229d31c9801869868aa6b2de4634cb19625ee193681368c88ef` · `src/App.tsx 32136252582ce4433f26736ab968d95de7758004824ca94d0b8b1804a86678a6` · `src/chart/theme.ts d3c1d560b368aa6f1f73ef6575c96cb174103ab7ea296e6e30bc302b1de2d0af`

## Two defects the lead found and fixed — try hard to break the fixes, and look for MORE
1. **Mobile hamburger hidden at all widths** — a late un-scoped `.drawer-toggle{display:none}` overrode the ≤720px rule. Fix = scope to `@media (min-width:721px)`. Check: is the drawer truly usable at 320px (open → navigate → close/scrim)? Any width where it disappears or the scrim misbehaves?
2. **Theme not painted on boot** — stored `light` + OS `dark` rendered light but left `<html data-theme>` dark. Fix = `applyTheme(theme)` on mount in `Shell`. Check: is there *any* boot/transition path where `<html data-theme>`, the components' colours, and the chart canvas disagree? (e.g. `system` + OS flip while open; rapid toggling; `theme-color` meta.)

## Specifically attack (adversarial, falsifiable)
- **Vacuous-check hunt.** Do the `evidence:phase5` assertions actually fail when the behaviour is broken? Reproduce at least one mutation yourself (e.g. make the light palette omit a chart token, or force the canvas to a constant colour) and confirm the harness FAILs. A check that cannot fail proves nothing.
- **Canvas honesty.** Does the chart *background* really change between themes (sample `getImageData`), and is the legend/candle colour still readable on white?
- **Token completeness.** Does `[data-theme='light']` override every token a canvas reads? Any dark value that leaks onto white (e.g. hard-coded colours left in components, `REF_COLORS` reference lines, `.ohlc-legend`)?
- **Locale parity.** Toggle the theme and the language (中/EN) together — any raw key, English leak in zh-HK, or layout break?
- Anything else that makes a real user's experience wrong.

## Commands
```bash
cd /Users/love21/.openclaw/workspace/debug-coder/projects/stock-app
npm run build && npm run evidence:phase5   # 53 checks; also evidence:chart/colour/phase3/phase4 for regressions
```
The harness bundles the Express server and drives the production build in headless Chrome; screenshots + `evidence/phase5/report.json`.

## Deliverable
Write `review-evidence/qa-phase5/QA-REPORT.md`:
- **Verdict**: PASS / FAIL.
- **Blocking findings**: each with file:line, the falsifiable reproduction you ran, and the observed vs expected.
- **Mutation results**: which mutation, which gate failed (or "did not fail" — that is a finding).
- **Non-blocking observations** (owner-decision items).
- **What you could not verify** + why.
Stop after the report: no fixes, no retries beyond one clarified attempt.
