# SPEC — Phase 3: Analyst Estimates, Financial Statements & UI Polish

> **Status: FROZEN 2026-11-06.** Owner brief: add analyst-estimates features
> (the six areas below) **and** polish the buttons / nav buttons with tasteful
> motion — "d button 可以再設計得靚啲… 加啲 animation… 唔好咁 odd" — while keeping
> the UI **簡潔, 唔好亂**.
>
> This is **additive** on top of Phase 1 (K-line + signals) and Phase 2
> (zh-HK i18n, sidebar, categorisation, profile/stats, news). **Do not regress**
> any Phase 1/2 behaviour. Phase 1/2 evidence stays untouched.
>
> **Read `RECON-PHASE3.md` first.** It is the binding data-source contract:
> it records, per feature, exactly what Yahoo returns and what it does **not**.
> Anything Yahoo does not carry ships as an honest `—` / "暫無資料" — never an
> invented number, never a fabricated history.

## §A — Data contract (binding, from RECON-PHASE3.md)

A.1 **New backend endpoints** (all cached; same honesty rules as Phase 2):

| Endpoint | Source | Content |
|---|---|---|
| `/api/statements/:sym?period=annual\|quarterly` | `query2 fundamentals-timeseries` (crumb-free) | income / balance / cashflow series with per-row `asOfDate`, `periodType`, `currency` |
| `/api/estimates/:sym` | `quoteSummary` `earningsTrend` + `calendarEvents` | current+next quarter and current+next FY estimates (EPS & revenue: avg/low/high/#analysts/growth), next earnings date |
| `/api/ratings/:sym` | `quoteSummary` `recommendationTrend` + `financialData` + `upgradeDowngradeHistory` | rating distribution by month bucket, `recommendationMean`, target low/mean/high, #analyst opinions, recent upgrades/downgrades |
| `/api/quotes/:sym` | `quoteSummary price` / chart meta | price, change%, volume, currency, exchange, marketState, sector/industry; **pre/post only when present** |

A.2 **Data that must NOT be fabricated** (RECON-PHASE3 §1 "NOT AVAILABLE"):
- Multi-year earnings matrix beyond 4 periods (0q/+1q/0y/+1y) → show the 4
  that exist; any additional year column is `—`.
- Historical analyst-estimate **revision** series and historical price-target
  series → **do not exist**. Do not draw a fake history. For "rolling NTM vs
  price" show only the **current** NTM estimate level plus real price history;
  label the estimate overlay as a current point, not a back-series.
- Pre/post-market price when `{}`/null → omit the row, never `0.00`.
- `annualGoodwill`, `annualOtherIntangibleAssets` (0 rows for AAPL) → `—`.

A.3 **Derived metrics must be computed, and the formula shown on hover.** Where
an input is missing, the metric is `—` (not `0`, not `NaN`).
Required: EV `= mcap + totalDebt − totalCash`; EV/Revenue, EV/EBITDA;
P/E, Forward P/E, P/B, P/S; ROIC ≈ `NOPAT / (totalDebt + equity − cash)`;
D/E, LT-Debt/Equity, Total-Debt/Capital, Liab/Assets; EBIT/Interest,
EBITDA/Interest; Total-Debt/EBITDA, Net-Debt/EBITDA, Debt/(EBITDA−Capex).
LTM = trailing four quarters, **labelled "LTM (computed)"** so a computed
figure is never passed off as a reported one.

A.4 **Currency switch** (USD default) via `query2` FX chart pairs
(`HKDUSD=X`, `EURUSD=X`, `USDCNY=X`, …). Convert **display only**, keep the
source currency in the payload, and show the rate + its timestamp. If the rate
is unavailable, fall back to the source currency and say so.

A.5 **CY vs FY**: label fiscal periods exactly as the provider reports them
(`asOfDate`). Do **not** silently relabel a fiscal year as a calendar year.
If a CY view is offered it must state the mapping used.

## §B — UI polish (buttons / nav) — the owner's explicit ask

B.1 Buttons and nav controls must not look "odd":
- One consistent button system: shared radii, padding scale, focus ring,
  disabled state, icon+label alignment. Primary / secondary / ghost / danger
  variants — no ad-hoc one-off button styles.
- Nav (sidebar) items: clear hover, active, and focus states; the active item
  is unmistakable. No layout shift on hover.

B.2 Motion — purposeful, subtle, and **respecting `prefers-reduced-motion`**:
- Micro-interactions on hover/press (e.g. ≤ 150 ms scale/translate/elevation).
- Smooth panel/tab and view transitions (e.g. 150–250 ms fade/slide).
- Animated number/count transitions where a value changes (short, ≤ 400 ms).
- Charts animate on data change (already present) — keep, don't double-animate.
- **Hard rule:** animation must never hurt legibility, cause jank, hide data,
  or block interaction. When `prefers-reduced-motion: reduce`, motion is off.

B.3 The added analyst UI is **large by nature** — the owner demands **簡潔唔好亂**:
- Group the new features into clear, collapsible sections / tabs; never dump
  every table on one screen.
- One primary idea per panel; progressive disclosure for depth.
- Respect the existing sidebar + Phase 2 layout language (DESIGN-PHASE2.md);
  extend, don't fork, the design system.

## §C — Feature areas (from the owner brief, scoped to reality)

C.1 **Company header & overview** — price / change% / volume (pre/post only if
present); market cap; **forward P/E**; next earnings date; sector & industry.
Quick actions: **My Alerts** (local, listed), **Watchlist** (already exists),
**My Notes** (local persistence), **Export** (download CSV/JSON of the visible
data). Alerts without a backend must be honest local reminders, not fake pushes.

C.2 **Financial statements & structure** — period switch **LTM / Q / Y**;
Income Statement, Balance Sheet, Cash Flow; then Multiples & EV, Profitability
& ROIC, and the full solvency/debt set in §A.3. Each figure states its period
and currency; missing line items show `—`.

C.3 **Actuals vs consensus** — historical actuals (`earningsHistory` +
statement history) vs consensus (`earningsTrend`) for **the periods that exist**;
CY/FY labelling per §A.5; currency switch per §A.4; export.

C.4 **Earnings matrix & upcoming reporting** — next-quarter forecast vs last
actual (Revenue, EBITDA, EBIT, EPS, EPS GAAP where available) with growth %.
The multi-year matrix shows the **4 real periods**; extra years are `—`.
Rolling NTM vs price per §A.2 (current NTM only; no invented history).

C.5 **Price target & ratings** — target low/mean/high + return potential % vs
current price + trailing 1y return; **historical target chart is limited to the
current band vs real price history** (no fabricated target series) across the
spans MTD/1M/QTD/3M/6M/YTD/1Y/3Y/5Y/10Y (spans apply to the price history only);
ratings distribution (Buy/Strong Buy/Hold/Sell/Strong Sell counts) with the
composite score and the month-by-month trend; recent upgrades/downgrades list.

C.6 **Estimates trend & breakdown** — trend visual for the available periods
(not FY27–30+); breakdown table with #analysts, low→high range bar, average,
YoY change %, EV multiple, price multiple — for the periods that exist.

## §D — Verification (build is NOT proof; independent checks are)

D.1 Unit/integration tests for every new formatter, derived metric, and cache
path, **including tests that assert an honest `—`/null when an input is absent**.

D.2 A browser/DOM-level check: the new sections render, animate, and are
readable; **zero horizontal overflow at 390 / 834 / 1600 px**; **zero console
errors**; `prefers-reduced-motion` honoured (motion disabled when set).

D.3 **Extend `verify:runtime`** with live checks: statements/estimates/ratings
return real data; a bad symbol returns honest empty; derived metrics equal an
independently recomputed value.

D.4 **All Phase 1/2 gates stay green**: build, tsc, lint, full test suite,
`evidence:chart`. No Phase 1/2 regression.

D.5 Blanket honesty rule (unchanged): every unavailable figure renders
`—` / `暫無資料`; no cookie/crumb ever reaches the client.

## §E — Out of scope / boundaries

- No publish, deploy, purchase, or external account. No paid data provider.
- Do not modify `projects/stock-analyzer` (read-only reference).
- Do not delete Phase 1/2 evidence.
- Native iOS/macOS wrappers remain Phase 4 (no Xcode/Rust on this host).

## §F — Acceptance criteria

1. Every feature in §C exists and renders, **or** is explicitly shown as
   unavailable with an honest `—` wherever Yahoo does not carry the data (§A.2).
2. Button/nav system is unified (§B.1) and motion is present, subtle, and
   reduced-motion-safe (§B.2); the new UI reads as 簡潔, not cluttered (§B.3).
3. Derived metrics are computed and cross-check against an independent recompute
   (§A.3, §D.3); missing inputs yield `—`, never a fabricated number.
4. i18n: all new copy exists in **both** zh-HK and en with identical key sets;
   the `no-hardcoded-strings` test covers the new files; no English leaks into
   a zh-HK session.
5. Gates per §D all green, reproduced independently by the coordinator **and**
   by `debug-reviewer` before this is called complete.
