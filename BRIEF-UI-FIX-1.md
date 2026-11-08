# BRIEF — UI fix round 1 (owner scored the UI 40/100)

Owner feedback (verbatim, Cantonese) and what I **measured** on the real build
(`http://127.0.0.1:8787`, production `dist`, Chrome via playwright-core). Every
number below is measured, not guessed. Fix the **root cause**, not the symptom.

Repo: `/Users/love21/.openclaw/workspace/debug-coder/projects/stock-app`
Write scope: `src/**`, `scripts/**`, `tests/**`, `package.json` (scripts only).
Never touch `node_modules`. **No commit.** Keep every existing gate green.

---

## 1. 「收埋 sidebar 個陣希望有 animation 慢慢收入去」

**Measured root cause:** `.sidebar` (desktop, `src/styles.css:415`) has **no
`transition`** at all. Collapsing flips `width: 264px → 62px` and
`flex: 0 0 264px → 62px` in one frame — it *jumps*. (Probe: desktop
`getComputedStyle('.sidebar').transition` → `"all"` i.e. default `0s`.)

**Fix:** a smooth collapse/expand.
- `.sidebar { transition: width .22s ease, flex-basis .22s ease; }` (desktop).
- Fade the inner content in step so labels don't pop:
  `.sidebar .side-text, .sidebar .wl-name, .sidebar .wl-quote, .sidebar .sidebar-label-text,
   .sidebar .side-group-label, .sidebar .group-by { transition: opacity .14s ease; }`
  and in `.collapsed` those get `opacity: 0` **plus** `display:none` (display:none
  is needed for layout; opacity gives the fade on the way in — coordinate so the
  rail does not visibly reflow mid-animation).
- Must still honour the global `@media (prefers-reduced-motion: reduce)` rule.
- **Assertion:** collapsed↔expanded width change must be animated
  (`transition-duration` on width ≥ 0.15s).

## 2. 「收埋 sidebar 個到顯示既 symbol 既 ui 要 fix 下 … 等佢唔好睇落咁其怪」

**Measured root cause (real bug):** in the `@media (max-width:720px)` block
(`src/styles.css:1122–1131`) the collapsed selectors are set to
`display: revert`:

```css
.sidebar.collapsed .side-text,
.sidebar.collapsed .wl-name,
.sidebar.collapsed .wl-quote,
.sidebar.collapsed .group-by,
.sidebar.collapsed .side-group-label { display: revert; }
```

`display: revert` reverts to the element's UA default (`inline`), so on phones
the **name and quote re-appear inside the 62px rail** and collide/overflow.
Measured in the collapsed rail: rail `width: 62px`, content area ≈49px,
`.wl-sym` "AAPL" is 31px wide while `.wl-name`/`.wl-quote` also render.

**Fix:**
- Collapsed hiding must be **one width-agnostic rule**: when `.collapsed`, hide
  `.side-text, .wl-name, .wl-quote, .side-group-label, .group-by, .sidebar-label-text`
  at **all** widths (delete the `display:revert` overrides).
- The rail must look deliberate, not clipped: keep `.wl-row`/`.side-item`
  centred, `.wl-sym` must not wrap (`white-space:nowrap`), no horizontal
  overflow, and the symbol must be visually centred with comfortable padding.
  Widen the rail slightly if needed (e.g. 62→68px) so a 4-char symbol + centring
  reads cleanly — but keep it a true rail.
- **Assertion:** at **both 393px and 1280px**, with `.collapsed`, the computed
  `display` of `.wl-name`, `.wl-quote`, `.side-text` is `none`, and the rail has
  **zero** horizontal overflow.

## 3. 「個 ui 上面個空白位係點解要預留咁大 可能要執執佢」

**Measured root cause:** at 393px the `.topbar` is **175px tall** — it wraps to
**5 rows**. Children: hamburger(44) · brand · `topbar-spacer`(163×**0**, y=32) ·
symbol-head · price-block(y=68) · theme-toggle(y=62) · lang-switch(y=114) ·
refresh(y=117). `.topbar-spacer` is `flex:1; min-width:8px` and, because the bar
is `flex-wrap:wrap`, it forces a whole extra row of its own.

**Fix:**
- On phones remove/neutralise `.topbar-spacer` (`display:none` ≤720px) so it
  stops burning a row.
- Tighten the bar on phones: smaller row-gap/padding, let symbol + price sit on
  one row; target **topbar height ≤ ~100px at 393px** with no clipped controls.
- **Assertion:** `.topbar` height at 393px ≤ 100px; no horizontal overflow.

## 4. 「收埋 sidebar 個陣做乜會有個黑色 mask 係上面 唔係直接消失 / 擺係側邊」

**Measured root cause (real bug):** the mobile drawer's scrim is
**conditionally rendered** — `DrawerScrim()` returns `null` when closed
(`src/App.tsx`). So on open it **pops in instantly** (dark `--scrim =
rgba(0,0,0,.55)` → rendered `rgb(238,241,244)` after the 1px blur + backdrop
blend) while the sidebar slides for 180ms, and on close it **vanishes instantly**
while the sidebar is still sliding out. Result: a jarring black flash / a mask
left over the collapse.

**Fix:** keep the scrim **mounted** and animate its `opacity` in sync with the
sidebar transform (same 0.18–0.22s, same easing), then `pointer-events:none`
when hidden. No flash on open, no residue on close. The drawer must still close
on scrim tap and on Escape (both already wired — keep working).
- **Assertion:** `.scrim` has a non-zero opacity `transition`, computed opacity
  is `1`-ish when open and `0` (and non-interactive) when closed.

## 5. 「全部入面 ui 你都冇執好 你要睇清楚」

General polish — after the four fixes, sweep **every screen**
(dashboard, chart, signals, watchlist, analysts, dividends, help) at
**320 / 393 / 768 / 1280** px and fix what is visibly wrong: clipped text,
unexpected wrapping, cramped padding, misaligned rows, inconsistent icon sizes,
overflow. Judge it as a designer would; the owner is judging the rendered pixels.

---

## Deliverables

1. Source fixes in `src/**`.
2. `scripts/evidence-ui-fix.mjs` (+ an `evidence:ui` npm script) that, against
   the **production build**, asserts the four items above numerically and writes
   screenshots (closed / open / collapsed) at 393px and 1280px to
   `review-evidence/ui-owner-40/after-*.png`. Zero console errors / zero page
   errors is part of pass.
3. Update `tests/**` if any test asserted the old behaviour.
4. Short `review-evidence/ui-owner-40/CHANGES.md`: each of the 5 points → what
   changed → the measured before/after number.

## Verification the author must run and paste

- `npx tsc --noEmit` → 0
- `npm run lint` → 0
- `npx vitest run` → all pass (state the count/files)
- `npm run build` → 0
- `npm run verify:runtime`, `evidence:phase3`, `evidence:phase4`, `evidence:phase5`
  → unchanged / all pass
- `node scripts/evidence-ui-fix.mjs` → all assertions pass
- hashes (`shasum -a 256`) of every file changed

## Stop condition

Stop when every gate above is green, the new evidence script passes, and you
have pasted the numbers + hashes. If something cannot be made to pass, say so
explicitly with the exact failing measurement — do not claim success.
