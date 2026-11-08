# SPEC — Stock App v1 (MVP)

> Owner: gateway-owner (profile `gateway-owner`). Coordinator: `debug-debug_lead` (Chief of Staff).
> Implementer: `debug-coder`. Reviewer: `debug-reviewer` (independent QA).
> Created: 2026-11-06. Status: **v1 spec, frozen for Phase 1 build.**

---

## 1. Product goal (in one line)

A stock app for **total beginners** that makes it obvious **why** a stock is going up or down,
and gives **rule-based indicator signals** (not guesses), with a **TradingView / Futu 牛牛-style dashboard**
featuring **multi-timeframe candlestick (K-line) charts**.

## 2. Platforms (same codebase)

| Platform | Delivery in v1 | Notes |
|---|---|---|
| Web (responsive, mobile-first) | **Required** | Runs in browser, installable as PWA |
| iOS | Required target | PWA installable now; native wrapper later |
| macOS | Required target | Responsive web + PWA installable now; native wrapper later |

**v1 = single responsive PWA that runs on all three.** Native wrappers (Capacitor for iOS,
Electron/Tauri for macOS) are **Phase 2**, because this machine has no Xcode and no Rust.
Do not block Phase 1 on native wrappers.

## 3. Success criteria for Phase 1 (what "done" means)

1. `npm run build` passes with **zero** TypeScript errors and zero build warnings.
2. `npm test` passes — all unit tests green (indicators, signals, formatting, data mapping).
3. `npm run lint` passes clean.
4. App runs locally and loads a real ticker (e.g. AAPL) with a real candlestick chart.
5. Every screen listed in §5 exists and is reachable.
6. **Zero console errors** on any shipped screen.
7. Independent review by `debug-reviewer` returns **no blocking findings**.

> The owner's bar: "100% good, zero bugs, verify before asking me for the next step."
> We meet it by **verification**, not by claiming. See §9.

## 4. Tech stack (locked for v1)

- **Frontend:** React 19 + TypeScript + Vite
- **Charts:** `lightweight-charts` (TradingView's own library — closest to the requested look)
- **State:** `zustand`
- **Styling:** plain CSS modules / CSS variables, **dark theme by default** (TradingView-like)
- **Backend (local):** Node + Express (dev-only) that proxies market data and caches to SQLite (`better-sqlite3`)
- **Indicators:** `technicalindicators` npm package (SMA/EMA/RSI/MACD/BB/ATR) — do NOT hand-roll unless a needed indicator is missing
- **Data source:** Yahoo Finance chart API (`query1.finance.yahoo.com/v8/finance/chart/<symbol>`) via backend proxy. Verified reachable (HTTP 200). No API key required.
- **Tests:** `vitest`
- **Lint:** `eslint` + `typescript-eslint`

No paid services. No API keys. Everything must run offline-capable after data is cached.

## 5. Required screens (each must fully work)

1. **Dashboard** — watchlist sidebar + primary candlestick chart + indicator panels.
   - Top bar: symbol, last price, change (abs + %), data timestamp, **stale badge** if data older than threshold.
   - Mover strip: today's top gainers / losers in the watchlist.
2. **Chart view** — the centerpiece:
   - Candlesticks with **timeframe switcher: 1D / 1W / 1M (compressed views)** and intervals **1m / 5m / 15m / 1H / 1D / 1W / 1M** where data allows.
   - Overlays: SMA(20/50/200), EMA(12/26), Bollinger Bands.
   - Sub-panes: Volume, RSI(14), MACD.
   - Toggle each indicator on/off. Legend shows current values.
   - Crosshair with OHLC readout. Zoom/pan. Responsive.
3. **Signals / Beginner explainer** — for the selected symbol:
   - A list of plain-language signal cards, each: **what it is**, **what it means**, **bullish / bearish / neutral**, **how strong**, and **why**.
   - Rule-based only (see §6). No AI guesses, no black box.
   - A short "How to read this" beginner coach-mark / help panel.
4. **Stock detail** — company name, key stats (last price, day range, 52w range, volume), and links to chart + signals.
5. **Watchlist management** — add / remove / reorder symbols; persisted in SQLite.

## 6. Indicator → signal rules (deterministic, beginner-friendly)

Each rule outputs: `id, label, meaning (plain language), state (bullish|bearish|neutral), strength (0-100), evidence`.

- **MA trend:** price vs SMA50/SMA200 → golden cross / death cross / above / below.
- **RSI(14):** <30 oversold, >70 overbought, else neutral; describe what that means for a beginner.
- **MACD:** bullish when MACD crosses above signal; bearish when below; include histogram direction.
- **Bollinger Bands:** price near upper band = stretched high; near lower = stretched low.
- **Volume:** current vs 20-day average → confirming / weak.
- **Compression/expansion** (a.k.a. squeeze): BB width percentile over lookback.

Every signal must be derived from data actually fetched — never hard-coded or faked.

## 7. Data handling rules

- All timestamps displayed in **Asia/Hong_Kong (HKT)** with an explicit label.
- If a fetch fails, the UI shows the **last cached data + a clear stale badge**; it must NOT show a blank chart or a generic error alone.
- Never display invented prices. If there is no data, say "no data" explicitly.
- Cache candles in SQLite keyed by `(symbol, interval)`.

## 8. Explicit non-goals (do NOT build in v1)

- Broker integration / real order placement
- Real-time streaming (delayed/EOD data is fine)
- AI stock picks / price prediction
- Options, futures, crypto
- Multi-user accounts, cloud sync, social features
- Paid data vendors

## 9. Definition of "verified" (the standard we are graded on)

For every claim, attach evidence:

1. **Build:** `npm run build` → paste last lines showing success.
2. **Tests:** `npm test` → paste pass count.
3. **Lint:** `npm run lint` → paste clean output.
4. **Runtime:** start the app, hit the real URL, confirm chart renders; capture status code + console-error count (must be 0).
5. **Data honesty:** show one real fetched symbol's actual values to prove live data path works.
6. Anything not tested must be listed under **"Unverified / assumptions"** — never silently implied.

A claim without a command + observed output is **not** verification.

## 10. Handoff contract (coder → coordinator)

Report back with:
- (a) artifact paths created/modified
- (b) exact commands run + observed results (build/test/lint/runtime)
- (c) screenshot or DOM/console evidence for the chart actually rendering
- (d) uncertainty / unverified items / blockers
- (e) what a beginner can now do end-to-end

## 11. Approval boundary

- Build, run, test, and write files inside `/Users/love21/.openclaw/workspace/debug-coder/projects/stock-app` — **allowed freely**.
- Publish, deploy, purchase, or leave the machine — **requires explicit owner approval first**.
- Do not delete or modify `projects/stock-analyzer` (the owner's earlier attempt); treat it as read-only reference.
