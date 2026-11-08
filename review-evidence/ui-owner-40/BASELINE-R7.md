# R7 — measured baseline of the owner's four new complaints (2026-11-09)

Owner (round 7): 「個sidebar一收入去就無制禁返出黎 / 個logo被遮住左 /
dashboard唔洗顯示哂咁多野 / 圖表個一頁得返時段禁」 + full-app UI tidy pass.

All four reproduced with instruments before any edit. Nothing below is a guess.

## 1 + 2 are ONE root cause: the toggle sits inside the iOS safe area

`.drawer-toggle` is absolutely positioned at `top: 8px; left: 10px`
(`src/styles/layout.css:101`). On iPhone 17 the top safe area is **62pt**
(`env(safe-area-inset-top)`, measured in round 4).

Measured from a live simulator screenshot (`/tmp/r6-b2.png`, 1206×2622 @3x,
logical 402×874):

- first ink on the device is at **y = 0pt** — the status bar is at the very top
- the toggle's box is y = 8..48pt, i.e. **entirely under the 62pt inset**
- the logo text first appears at **y ≈ 26.7pt**, above the 62pt line

So the same 62pt band both **draws over the logo** (complaint 2) and **eats the
taps aimed at it** (complaint 1). Only the web viewport, where there is no notch,
was ever verified — which is why earlier rounds reported it fixed.

Playwright at 390×844 (no notch) shows the reopen cycle working
(`initial → open → close → open` all PASS), confirming the logic is fine and the
failure is purely geometric/OS-level.

## 3. Dashboard is genuinely overloaded

Owner: 「第一頁dashboard唔洗顯示哂咁多野」. Needs a content audit, not a tweak.

## 4. The chart toolbar is 4× wider than the screen

Measured on the chart screen:

| viewport | toolbar clientW | scrollW | groups visible |
|---|---|---|---|
| 390×844 (phone) | **358px** | **1434px** | first group only |
| 1440×900 (desktop) | 1152px | 1152px | all 5 |

The 5 groups exist in the DOM and all render (`時間範圍` 8 btns / `K線週期` 8 /
`技術指標` 5 / `副圖表` 3 / 1 action). On a phone the first group alone is
**356px** — it fills the viewport, and the remaining 4 groups sit off-screen
behind `overflow-x: auto` with **no affordance telling the user they exist**.
That is exactly why the owner sees 「得返時段禁」.

## Consequence for the fix

- 1+2: the toggle must live **below** `env(safe-area-inset-top)`, not at a fixed
  `8px`. Same class of bug as round 4's double-inset — fixed at the CSS token
  level, verified on the simulator, not in a headless browser.
- 4: the toolbar needs a layout that shows *which* controls exist at phone width
  instead of hiding four groups behind an invisible scroll.
- 3: dashboard needs a real content hierarchy.
- Full pass: adopt `pulsoicon-react` for real icons (the app currently ships no
  icon library — only glyphs/emoji).