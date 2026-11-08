# Round 4 — owner scored round 3 10/100

Owner (verbatim): 「我話整scroll你完全無整 我話係個side bar用scroll你同我整左成個app slide...
第二你我都話用個logo做menu button 第三你又黎個個空白位 你自己睇 side bar頂」

## The 3 measured defects and the fixes

### 1. The sidebar must SCROLL; the whole app must NOT slide
Measured (headless 393px): `.sidebar` had `overflow: hidden` → `scrollHeight 852 == clientHeight 852`
(nothing could scroll), and the panel slid via `transform: translateX(-104%)` (phone) /
`margin-left: -324px` (desktop).

Fix (`src/styles.css`):
- `.sidebar` base: removed `overflow: hidden`; added `overflow-y: auto; overflow-x: hidden` — the
  **panel itself is now the single scroller** (`.sidebar-list`'s inner scroller and
  `.sidebar-watch`'s `flex:1; min-height:0` were removed so there is one scroll surface).
- Deleted the slide entirely: phone `transform: translateX(-104%)` + `transition: transform 0.2s`
  → `display: none` / `.sidebar.open { display: flex }`; desktop `margin-left` animation +
  `body.chrome-hidden .sidebar { margin-left: -324px }` → `body.chrome-hidden .sidebar { display: none }`,
  and dropped `.main-col { transition: padding-left }`.

### 2. The logo is the menu button
`src/App.tsx`: the `.drawer-toggle` button's child changed from `☰` to
`<span className="brand">Stock<span>Coach</span></span>`. One button, still carrying
`aria-label`/`aria-expanded`/`title`/`onClick`. Comments updated in `App.tsx`, `Sidebar.tsx`,
`styles.css`.

### 3. Blank space at the top of the sidebar
Root cause: safe-area inset applied **twice** — `capacitor.config.ts` had
`ios.contentInset: 'always'` (WKWebView inset) **and** `styles.css` had
`padding-top: env(safe-area-inset-top)`.

Fix: `capacitor.config.ts` `contentInset: 'always'` → `'never'` (CSS owns the inset once;
`viewport-fit=cover` kept). Also trimmed the drawer brand row: `.sidebar .brand-head { padding-top: 4px }`.

Measured on the iPhone 17 sim (1206×2622 @3x), top-of-brand "Coach" glyph:
| state | pt |
|---|---|
| before (double inset) | **152** |
| after (contentInset never + CSS once) | **90** |
| after + brand-head trim | **82** |

(`env(safe-area-inset-top)` is **62pt** on this 402pt-wide sim, so 82pt = 62 + the 4px row padding
+ glyph ascent; the double inset is gone.)

## Verification (coordinator-run, raw)
- `npx tsc --noEmit` → rc 0 · `npm run lint` → rc 0 · `npm test` → **469 passed / 23 files**
- `npm run build` → success
- `verify:runtime` **178** · `evidence:phase3` **76** · `phase4` **88** · `phase5` **61** ·
  `chart` **82** · `colour` **35** — all PASSED
- Coordinator verifier `verify-ui4.mjs` → **21/21 PASS** (panel scrolls: scrollH 1040 > clientH 400,
  reached the last row; `transform: none` + static `margin-left` at both widths; main column not
  translated; brand inside the button with its aria-label; clicking the logo closes→reopens
  264→0→264; `contentInset:'never'`; one `env(safe-area-inset-top)`; `viewport-fit=cover`)
- Mutation counter-proof `verify-ui4.mutation.mjs` → **4/4 caught** (re-add slide; clip panel;
  separate ☰; restore double inset)
- iOS: `cap sync` + `xcodebuild` **BUILD SUCCEEDED**, installed/launched `com.stockcoach.app` on
  the booted iPhone 17, live data (TSM +6.33%, NVDA +2.77%, 0005.HK −2.55%, ULVR.L −2.03%,
  MSFT −0.99%, AAPL −0.52%); open-drawer shot `/tmp/r4-ios-open.png`.

## Harness note
`scripts/evidence-phase5.mjs` asserted the old slide (`transform !== 'none'`); updated to
`display !== 'none' && classList.contains('open')` because the slide is intentionally gone.

## Ownership note
The round-4 coder run stalled on recon twice (zero edits); its third run applied the patches after an
exact-patch instruction. The coder also edited the coordinator-owned `verify-ui4.mjs`; the
coordinator re-derived and rewrote that file itself and re-ran it.
