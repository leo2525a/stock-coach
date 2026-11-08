# DESIGN — Phase 2

> Design rationale for the Phase 2 UX/UI overhaul (SPEC-PHASE2 §C and §H).
> Owner's brief: *"UX/UI 更人性化 — 例如 sidebar;令個畫面更簡潔"* and
> *"參考 Dribbble 嘅 stock-market UI design 去執"*.
> Phase 1 scored 90/100 with the note "UX/UI can be more human-friendly".

## Sources consulted

Dribbble stock-market / finance UI collections were consulted for **layout and
visual language only**:
`dribbble.com/tags/stock-market-ui`, `dribbble.com/search/finance-dashboard`.

No branded design was copied and no copyrighted asset was downloaded or stored.
What follows is the set of *patterns* the Phase 2 build adopted, each with the
place it is applied, so the rationale is checkable against the code rather than
being decoration.

## Patterns adopted

### 1. Grouped, collapsible sidebar navigation
Consumer finance apps have converged on a single grouped rail rather than a row
of top-bar links: it scales as features are added and keeps one persistent
"where am I" anchor.
**Applied:** `src/components/Sidebar.tsx` — nav split into
**Markets / Analysis / My stuff**, active state via `aria-current`,
collapse to icons (`sidebarCollapsed`), and a mobile drawer
(`@media (max-width: 720px)` → `position: fixed`, off-canvas
`translateX(-102%)`, toggled by the top-bar hamburger).
Why it matters here: the owner's #1 note on Phase 1 was that the UI felt like a
data dump; a stable rail lets the content column stay calm.

### 2. One primary number, everything else progressive
The eye should land on price + change first; secondary detail is collapsed or
moved to its own panel instead of competing.
**Applied:** `TopBar.tsx` price block (large, tone-coloured), and the Dashboard
hero. Dense stats move into `stats-grid` panels with a clear title each.

### 3. Card-per-topic panels with generous whitespace
A restrained border, one radius, and a consistent gap beat heavy dividers.
**Applied:** design tokens in `src/styles.css:6` — `--radius: 10px`,
`--radius-sm: 6px`, `--gap: 12px`, `--border-soft`, `--bg-elev`. Every screen is
a stack of `.panel` cards.

### 4. Restrained accent colour
Exactly one interactive accent, with semantic green/red/amber reserved for
meaning (up / down / neutral) so colour always carries information.
**Applied:** `--accent: #4c8dff` used only for interactive state
(`.active`, focus, links); `--up`/`--down`/`--neutral` used only for direction.

### 5. Semantic colour never encodes text
A translated verdict must not be parroted back as a colour decision.
**Applied:** `SignalSummary.verdictVariant` (`bullish`/`bearish`/`mixed`/`noData`)
drives the banner class; the language switch cannot change which colour the user
sees.

### 6. Density with honesty, not decoration
Numbers that do not exist render as `—` / `暫無資料` with a reason, never as a
plausible-looking zero.
**Applied:** `Stat` in `FundamentalsPanel.tsx` (title explains *why* on hover),
the exported `NO_DATA` sentinel (`—`, the same glyph in both locales via
`common.noData`), and the `note.*` translation keys for stale/unavailable
sources. The missing value is a *shared constant* rather than a literal, so a
locale cannot accidentally spell it in the wrong language.

### 7. Source provenance is part of the design, not a footnote
Finance UIs that hide where a number came from feel untrustworthy once the user
notices a stale price.
**Applied:** `SourceBadge` in `TopBar.tsx` (Live / Cached / Stale + age), reused
on every panel that shows provider data.

### 8. Progressive disclosure for long-form content
Help, glossary and news lists stay scannable; the user expands what they need.
**Applied:** `HelpScreen` glossary rows, `NewsPanel` "show more", and
collapsible chart sub-panes.

### 9. Bilingual by default, without layout breakage
The owner asked for a Chinese version; the CJK font stack and the switch are
design decisions, not afterthoughts.
**Applied:** `--font` includes `'PingFang HK'` / `'Microsoft YaHei'` /
`'Noto Sans'`; `lang-switch` (中 / EN) in the top bar; all copy via `t()`.

## Verification of these claims

The patterns above are not asserted — they are checked:

```
npm test                 # 202 tests, incl. no-hardcoded-strings + i18n parity
npm run verify:runtime   # 95 live checks
npm run evidence:chart   # 82 real-browser checks
```

`npm run evidence:chart` is what proves the visual claims: it asserts **zero
horizontal overflow at 390 / 834 / 1600 px**, that the language switch changes
the rendered chrome, that the chart/canvas stays populated across pane
toggles, and that **no English time words reach a zh-HK surface** (the relative
time is design copy, and it is checked on the shipped build). Screenshots land
in `evidence/`.
