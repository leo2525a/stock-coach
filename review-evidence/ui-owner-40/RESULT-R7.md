# Round 7 — owner's four UI complaints, fixed and measured

Owner ask: sidebar could be collapsed but never reopened; the logo was covered;
the dashboard showed too much on the first page; the chart screen was left with
only the time-range controls; walk the whole app UI for cleanliness and ease of
use. Also: look at https://github.com/CityPulso/PulsoIcon for usable UI.

Verifier: `review-evidence/coordinator-ui/verify-r7.mjs` — 16 checks.
Calibrated against the pre-fix build first (see "calibration"), then re-run.

## 1 + 2 — the logo was covered and the menu button could not be tapped

One root cause: `.drawer-toggle` sat at `position:absolute; top:8px; left:10px`
while the iPhone 17 top safe area is **62pt** (`env(safe-area-inset-top)`). The
whole 8..48pt band of the button, and the first ~27pt of the logo text, were
under the notch.

Fix: the inset is now declared once as a token and consumed three times.

| | before | after |
|---|---|---|
| `--safe-top` declarations | 0 (raw `env()` inline) | 1 (`tokens.css:16`) |
| raw `env(safe-area-inset-top` | 3 | 1 |
| `var(--safe-top)` consumers | 0 | 3 |
| toggle `top` with 62pt inset | 8pt (failed) | **70pt** (pass) |
| `.main-col` `top` with 62pt inset | 0pt (failed) | **62pt** (pass) |
| toggle `top` with no inset | 8pt | 8pt (unchanged) |

The token exists because headless Chromium reports `env()` as 0 at every device
profile; without it the fix could not be tested at all.

Reopen works: open → close → open again from the same control, measured.

## 3 — the dashboard was 6 screens long

First screen is now: key stats → signals preview → **one collapsed disclosure**.
The folded section holds the range panel, profile + category, health, and news.

- before: **6.07 screens** (390×844), nothing collapsed
- after: **2.94 screens**, `dash-more` collapsed by default
- expanding restores **6.01 screens** — nothing was deleted
- each panel present exactly once (no duplication to fake the shorter page)

## 4 — the chart screen showed only the time-range controls

The phone toolbar was `overflow-x:auto` with `scrollWidth 1434` vs
`clientWidth 358`: four of the five control families were off-screen with no
scroll affordance.

Fix: at phone width the toolbar shows four named tabs; at `min-width:1181px` the
tabs disappear and every group is inline as before.

| family | controls | overflow |
|---|---|---|
| 時間範圍 | 8 | 0px |
| K線週期 | 8 | 0px |
| 技術指標 | 5 | 0px |
| 副圖表 | 3 | 0px |

## 5 — whole-app pass

- **Icons**: the app had no icon library, only geometric characters
  (`◧ ▲ ◎ ★ ? ⊞ ≣`). Importing `pulsoicon-react` cost **+54 kB gzip**, so its
  static geometry was extracted instead (path/circle/rect only, motion hints
  stripped) into `src/components/icons/index.tsx`. Bundle: **195.3 kB gzip vs
  193.8 kB baseline, +1.5 kB**. All 7 nav icons now render real `<svg>`;
  `pulsoicon-react` is not a dependency (package.json and package-lock.json are
  byte-identical to baseline).
- **Touch targets**: nav rows were **36px** tall (7px padding + 12.5px text),
  under the 44px minimum — picking a screen was a precision tap. Now 44px under
  `@media (pointer: coarse)`. All 15 rows verified.

## Calibration — proof the verifier can fail

Run against the pre-fix `dist/`, the same suite fails exactly where the owner
complained:

```
FAIL  the menu button is below the iOS top safe area   [8pt >= 62pt]
FAIL  the page content starts below the safe area      [0pt >= 62pt]
FAIL  the dashboard is at most 3.2 screens long        [6.07 screens]
FAIL  the reference material starts collapsed          [collapsed=false]
FAIL  expanding restores the full page depth           [6.07 -> 6.07]
FAIL  the chart names every control family             [0 tabs]
```

A verifier that passes on both trees would prove nothing.

## Gates

tsc clean · eslint clean · vitest 469/469 (23 files) · build ok ·
evidence phase3 76 / phase4 88 / phase5 61 / colour 35 (= baseline) ·
`dist/` free of hard-coded `127.0.0.1:8787` · verify-ui4 21/21 ·
verify-r7 16/16.

## Not verified

Real-device WKWebView. The simulator GUI would not open this round
(`open -a Simulator` → app not found; framebuffer stuck on a stale frame), so
the 62pt result comes from injecting the real inset at the real viewport, not
from a device screenshot. It is the one link in the chain still open.
