# SPEC — Stock App v1, PHASE 2

> Owner: gateway-owner. Coordinator: `debug-debug_lead`. Implementer: `debug-coder`. Reviewer: `debug-reviewer`.
> Base: Phase 1 (QA-PASSED). This spec is **additive** — do not regress Phase 1 behaviour.
> Created 2026-11-06. Status: **frozen for Phase 2 build.**

Owner's Phase 2 brief (verbatim intent):
1. UX/UI 更人性化 — 例如 sidebar;令個畫面更簡潔
2. **要有中文版** (Chinese version)
3. 做好**分類**準備 (categorisation)
4. Dashboard 想多啲關於該隻股票嘅資訊
5. 提供一啲會影響該隻股票嘅**新聞/動態**
6. 參考 Dribbble 嘅 stock-market UI design 去執

Owner's score for Phase 1: 90/100 (UX/UI can be more human-friendly).

---

## A. Success criteria (Phase 2)

Every Phase 1 gate still passes, PLUS:
1. `npm run build` exit 0, zero errors/warnings.
2. `npm test` passes — all Phase 1 tests still green AND new tests for: i18n, news mapping, fundamentals mapping, categorisation.
3. `npm run lint` clean.
4. `npm run verify:runtime` passes, extended with new endpoints.
5. `npm run evidence:chart` passes (pane-toggle checks retained) and now also covers the new Dashboard panels + language switch.
6. **Language:** the app ships **繁體中文 (zh-HK) as the DEFAULT** and English (en) as a switchable option. A visible language toggle switches instantly with no reload artefacts. **No hard-coded user-facing strings** left outside the translation layer — verify by grep + a test.
7. **Independent QA by `debug-reviewer` returns PASS.**

## B. Internationalisation (i18n)

- Lightweight in-repo i18n (no heavy dependency unless justified): a `zh-HK` dictionary + `en` dictionary, a `t(key)` accessor, and a `lang` value in the store persisted to `localStorage`.
- Default `zh-HK`. Toggle in the top bar (e.g. 中 / EN).
- Translate **every** user-facing string: nav, buttons, labels, signal cards, glossary, help, error/stale messages, table headers, tooltips, empty states.
- Signal "meaning/what/watch" text must exist in both languages (author real Chinese, not machine-garbled).
- Number/date formatting: keep prices/percentages locale-appropriate; timestamps stay HKT and are labelled.
- A test must assert zh-HK and en dictionaries have the **same key set** (no missing translations).

## C. UX / UI overhaul (human-friendly, cleaner)

Goal: cleaner, calmer, more like a polished consumer finance app (Dribbble-grade), not a data dump.

- **Collapsible left sidebar**: grouped nav (Markets / Analysis / My stuff), active state, and a watchlist section. Collapses to icons on narrow screens; on mobile it becomes a drawer. Must not cause horizontal overflow at 390 / 834 / 1600px.
- **Visual hierarchy**: reduce clutter; consistent spacing scale, type scale, and a restrained accent colour; clear card boundaries; generous whitespace; skeleton/loading states instead of layout jumps.
- **Information density with clarity**: primary number (price + change) prominent; secondary detail progressive (collapsed/expandable), not all at once.
- Keep the dark theme; ensure contrast is readable.
- Every existing interactive control keeps working (chart toggles, timeframes, watchlist, mover strip, help).

## D. Categorisation ("做好分類準備")

Prepare a categorisation layer that is visible and extensible:
- Classify symbols by **type** (Stock / ETF), **sector** (e.g. Technology, Financials, Energy…), and **exchange/market** (e.g. NASDAQ, NYSE, HKEX).
- Watchlist can be **grouped** by these categories (at minimum: group-by-sector view, plus an "All" view). Grouping state persists.
- Expose the same classification on the stock detail / dashboard so the user can see "what kind of stock is this".
- The categorisation must be driven by real fetched metadata (Yahoo search quotes give `sector`, `industry`, `exchDisp`, `quoteType`), with a sane "Unknown" bucket — never invented.

## E. Dashboard: more about the stock

Add a company/profile panel and supporting panels for the selected symbol:
- **Company profile:** name, exchange, sector, industry, and (when available) a one-line business summary.
- **Key stats:** market cap, trailing P/E, forward P/E, dividend yield, beta, 52-week high/low, day range, volume, avg volume.
- **Health/edge stats:** profit margin, return on equity, revenue growth, analyst recommendation + mean target price (label clearly as analyst opinion, not advice).
- **Position in range:** a 52-week range visual (low — current — high).
- **Categorisation chips:** type / sector / industry.

## F. News & updates that affect the stock (NEW)

- New backend endpoint: `GET /api/news/:symbol` → latest relevant headlines from **Yahoo Finance news search** (verified working, returns real stories with publisher + timestamp + link).
- Show on the Dashboard a **News** panel: headline, publisher, relative time (HKT), and a link that opens the source. Newest first.
- Mark relevance: the endpoint returns `relatedTickers`; prefer stories that actually mention the symbol.
- Cache with a short TTL; show an honest empty/error state ("no recent news") — never fabricate headlines.
- Each news item must be real fetched data with a real URL; no placeholder text.

## G. Data sources (verified up-front by the coordinator — use these)

| Need | Source | Status |
|---|---|---|
| Candles | `query1.finance.yahoo.com/v8/finance/chart/<sym>` | ✅ 200, Phase 1 |
| Symbol search + type/sector/exchange | `query1.finance.yahoo.com/v1/finance/search?q=…` | ✅ 200 (`sector`, `industry`, `exchDisp`, `quoteType`) |
| News | same search endpoint with `newsCount` (returns `news[]` with `title`, `publisher`, `link`, `providerPublishTime`, `relatedTickers`) | ✅ 200 |
| Company profile + fundamentals | `query1.finance.yahoo.com/v10/finance/quoteSummary/<sym>` | ✅ **requires cookie + crumb** (see note) |
| Company name / 52w / day range / volume | `v8/finance/chart/<sym>` `meta` | ✅ 200 |

**Cookie+crumb note (important):** `quoteSummary` returns `{"code":"Unauthorized","description":"Invalid Crumb"}` without a session. The working sequence is: `GET https://fc.yahoo.com/` with a cookie jar → `GET https://query1.finance.yahoo.com/v1/test/getcrumb` (with the cookie) → call `quoteSummary` with `&crumb=<crumb>` and the cookie. The backend must manage this server-side (refresh the crumb on 401 and retry once). Verified working: returned marketCap 5.00T, trailingPE 38.93, forwardPE 32.32, dividendYield 0.31%, beta 1.09, profitMargins 27.60%, returnOnEquity 142.26%, revenueGrowth 11.70%, recommendationKey buy, targetMeanPrice 333.28.
**Do NOT** use any endpoint that returns `User is unable to access this feature` (the v7 quote endpoint is blocked). Do not invent numbers when a field is missing — show "—" / "暫無資料".

## H. Design reference (Dribbble)

- Consult Dribbble stock-market / finance UI designs for layout and visual language (dribbble.com reachable, HTTP 202).
- Extract *patterns* (spacing, cards, typography, colour restraint, nav structure) — do NOT copy a specific branded design pixel-for-pixel, and do not scrape/store copyrighted assets.
- Save a short `DESIGN-PHASE2.md` in the project noting the 5–8 patterns adopted and where they are applied. This is design rationale, not decoration.

## I. Non-goals for Phase 2

- Native iOS/macOS wrappers (still Phase 2+; no Xcode on this machine).
- Real-time streaming, broker integration, AI predictions.
- Accounts/multi-user.
- Paid data or paid design assets.

## J. Verification contract (unchanged in spirit from Phase 1)

For every claim: run it and paste observed output.
- build / test / lint / verify:runtime / evidence:chart — all green, with counts.
- Show a real news item fetched for a real symbol (paste the actual headline + publisher + link).
- Show real fundamentals for a real symbol (paste actual numbers).
- Show the language toggle actually switching strings (before/after in both directions).
- Confirm zero console errors, no horizontal overflow at the three widths.
- Anything untested goes under **"Unverified"** — never implied.

## K. Boundaries

- Work only inside `/Users/love21/.openclaw/workspace/debug-coder/projects/stock-app`.
- No publishing, deploying, purchasing, or leaving the machine.
- Do not touch `projects/stock-analyzer` (owner's earlier attempt) — read-only reference.
- Do not regress Phase 1: its evidence and tests must still pass.
