# R5 — split the stylesheet into modules

Owner (60/100): 「如果係context太長 你將個apps斬件 唔好一段寫哂成個apps, 分開唔同file去call唔同function」

## What changed

`src/styles.css` was a single **2,700-line** file — one 70 KB write. It is now a
**19-line entry point** that only wires up modules, and the rules live in
`src/styles/`:

| File | Lines | Concern |
|---|---|---|
| `tokens.css` | 256 | `:root` tokens, light theme, base resets |
| `layout.css` | 222 | shell layout, headline row, badges, panels |
| `sidebar.css` | 164 | watchlist rail, mover strip |
| `chart.css` | 376 | chart block, signal cards, summary banner, stats |
| `help.css` | 207 | help/coach marks, watchlist manager, misc |
| `responsive.css` | 138 | shell breakpoints |
| `nav.css` | 253 | grouped nav, group-by, language switch, dashboard, range bar, news |
| `systems.css` | 200 | button system, chip rows, screen scaffold |
| `analyst.css` | 646 | recap, overview header, facts, sections, tables, bars, currency, statements |
| `phase3.css` | 259 | Phase-3 refinements and final responsive passes |

Largest module is 646 lines (was 2,700). `@import` order **is** the cascade
order — tokens first, responsive passes last.

## Behaviour-neutral — proved, not asserted

- **Built CSS is byte-identical** to the monolith build:
  `md5 a0e8674cb4993f6af3dd1aa470b706d5` for both, 37,307 bytes.
  Build the monolith, build the split, compare checksums — same.
- Braces balance per module and in total: **405 `{` / 405 `}`**, matching the original.
- No residual `@import` in the bundle (Vite inlines it).

## Tests had to learn the new shape

Two test files parsed `src/styles.css` as **raw text**, so a split looked like
deleted rules: 12 assertions failed (`theme.test.tsx`, `phase3-ui.test.tsx`).

Fixed by adding `tests/css-source.ts` → `readStylesheet()`, which resolves the
`@import` graph depth-first in source order and returns one string. The
assertions themselves were **not** weakened.

**Mutation check:** deleting `--chart-grid` from `tokens.css` still fails
"the dark :root carries every chart token". The tests still bite.

The same blinded read hit the coordinator verifier: `verify-ui4.mjs` first came
back **19 passed / 2 failed** because it also read the entry file raw
(`safe-area-inset-top` reported `0 use(s)`). Fixed to walk `@import` from
`src/styles/`. The app was never wrong — the instrument was.

## Gates (all green)

| Gate | Result |
|---|---|
| `tsc --noEmit` | 0 |
| `lint` | clean |
| `vitest` | **469 passed / 23 files** |
| `build` | 0 |
| `verify:runtime` | 178 |
| `evidence:phase3` | 76 |
| `evidence:phase4` | 88 |
| `evidence:phase5` | 61 |
| `evidence:chart` | 82 |
| `evidence:colour` | 35 |
| `verify-ui4` | 21/21 |
| `verify-ui4.mutation` | 4/4 caught |

Every evidence count is identical to the round-4 baseline — nothing moved.

## Not done (deliberately)

No rule was rewritten, reordered, or "cleaned up". This is a pure move so the
byte-identical proof holds. Source TS/TSX was left alone: the largest file is
`shared/dividends.ts` at 1,165 lines, and splitting it would need its own
verification pass.