# PHASE 3 — DATA-SOURCE RECON (live probes, 2026-11-06)

> Raw evidence: `tmp/recon-phase3/probe*.mts`, `tmp/recon-phase3/dump-AAPL.json`.
> Every line below is an observed HTTP response, not an assumption. Where Yahoo
> does **not** carry something the brief asked for, it is marked NOT AVAILABLE —
> the app must then show an honest `—` / "unavailable", never an invented number.

## 1. Analyst estimates, targets, ratings

Endpoint: `query1.finance.yahoo.com/v10/finance/quoteSummary/{SYM}?modules=…&crumb=…`
(cookie+crumb session, already implemented in `server/provider.ts`).

| Module | Observed | What we get |
|---|---|---|
| `financialData` | 200, 1623 B | `currentPrice`, `targetHighPrice 405`, `targetLowPrice 250`, `targetMeanPrice 333.28`, `targetMedianPrice 340`, `recommendationKey "buy"`, `recommendationMean 2.23`, `numberOfAnalystOpinions 38`, margins/ROE/debt ratios, `freeCashflow`, `totalCash`, `totalDebt`, `ebitda` |
| `recommendationTrend` | 200, 388 B | 4 monthly buckets: `0m SB6 B18 H13 S3 SS3`, `-1m …`, `-2m …`, `-3m …` |
| `upgradeDowngradeHistory` | 200, **184 965 B** | **980 entries** `{epochGradeDate, firm, fromGrade, toGrade, action}` (Bernstein, JPM, UBS, Argus, Barclays, …) |
| `earningsTrend` | 200, 5369 B | **only 4 periods**: `0q` (2026-09-30), `+1q` (2027-03-31), `0y`, `+1y` (2027-09-30). Each: EPS avg/low/high + #analysts + growth; Revenue avg/low/high + #analysts; `earningsCurrency` |
| `calendarEvents` | 200, 709 B | `earningsDate [{raw:1801170000, fmt:"2027-01-28"}]`, `earningsCallDate`, `earningsAverage/Low/High`, `revenueAverage/Low/High`, `isEarningsDateEstimate` |
| `earningsHistory` | 200, 1436 B | last 5 quarters: `epsActual`, `epsEstimate`, `surprisePercent` |

### NOT AVAILABLE (checked and rejected)
- **No multi-year estimate matrix.** `earningsTrend` stops at `+1y`. Probed
  `analystEstimates`, `earningsEstimates`, `estimate`, `estimates`,
  `forwardEstimates`, `analystEstimate`, `growthEstimates` → all MISSING.
  `sectorTrend` present but empty (`estimates: []`).
  **Consequence:** the brief's FY2027→FY2030+ earnings matrix and the
  "future multi-year FY revision trend" cannot be built. We ship the 4 periods
  Yahoo actually carries and label the rest honestly as unavailable.
- **No historical analyst-estimate revision series.** Nothing in any probed
  module returns time-stamped *forward* estimates. A far-future
  `fundamentals-timeseries` call returns only realised `12M` actuals
  (2025-09-30, 2026-09-30) — no forward rows.
  **Consequence:** "Historical Rolling NTM Estimate vs Stock Price" cannot be
  reconstructed historically. We can only show the **current** NTM estimate
  level and, going forward, an honest forward overlay — never a fabricated past.
- `epsTrend` / `epsRevisions` → `null`.

## 2. Financial statements

Endpoint: `query2.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/{SYM}?type=…&period1=…&period2=…`
**crumb-free**, plain UA. The **legacy** `quoteSummary` statement modules
(`incomeStatementHistory`, `balanceSheetHistory`, `cashflowStatementHistory`,
annual and quarterly) return **gutted** data — balance sheet all `null`,
only `totalRevenue`/`netIncome` survive. They are **unusable**; do not build on them.

`fundamentals-timeseries` returned (AAPL, 4 annual periods, values verified sane):

| Group | Series present | Sample (last) |
|---|---|---|
| Income | `annualTotalRevenue`, `annualCostOfRevenue`, `annualGrossProfit`, `annualOperatingIncome`, `annualEBIT`, `annualNetIncome`, `annualBasicEPS`, `annualDilutedEPS`, `annualResearchAndDevelopment`, `annualSellingGeneralAndAdministration`, `annualInterestExpense`, `annualPretaxIncome`, `annualTaxProvision` | Revenue 383.285B, EBIT 114.301B, NetIncome 96.995B, DilutedEPS 6.13 |
| Balance | `annualTotalAssets`, `annualTotalLiabilitiesNetMinorityInterest`, `annualStockholdersEquity`, `annualTotalDebt`, `annualLongTermDebt`, `annualCurrentAssets`, `annualCurrentLiabilities`, `annualCashAndCashEquivalents`, `annualInventory`, `annualNetDebt` | Assets 352.583B, Debt 111.088B, Equity 62.146B, NetDebt 81.123B |
| Cash flow | `annualOperatingCashFlow`, `annualCapitalExpenditure`, `annualInvestingCashFlow`, `annualFinancingCashFlow`, `annualFreeCashFlow`, `annualDepreciationAndAmortization`, `annualCashDividendsPaid` | OCF 110.543B, Capex −10.959B, FCF 99.584B, D&A 11.519B |
| Quarterly | `quarterlyTotalRevenue`, `quarterlyGrossProfit`, `quarterlyOperatingIncome`, `quarterlyEBITDA`, `quarterlyNetIncome`, `quarterlyTotalDebt`, `quarterlyCashAndCashEquivalents` | 5 periods |

- Not every requested line exists: `annualGoodwill` and
  `annualOtherIntangibleAssets` returned **0 rows** for AAPL → must render `—`.
- Works for non-US symbols: `0700.HK` returned matching `annualTotalRevenue` /
  `annualNetIncome` series with `asOfDate` per period.
- Each row carries its own `asOfDate`, `periodType` (`12M`/`3M`), and a
  `currencyCode` in `reportedValue`. Use the row's own date/currency; do not guess.

## 3. Price, pre/post market, FX

- `price` module: crumb-dependent and **intermittently empty** (AAPL returned an
  empty session on one probe; 0700.HK returned full data). `regularMarketPrice`,
  `regularMarketChangePercent`, `regularMarketVolume`, `marketState`,
  `currency`, `exchangeName`, `longName`, `quoteType` are present when it works.
- Chart meta (`/v8/finance/chart/{SYM}`) carries `regularMarketPrice`,
  `regularMarketVolume`, `fiftyTwoWeekHigh/Low`, `longName`, `currency` —
  **but not** `preMarketPrice`/`postMarketPrice` (observed `undefined`).
- Pre/post market: `marketState` reached `POSTPOST` yet `preMarketPrice` and
  `postMarketPrice` were **`{}`/`null`**. Pre/post price is therefore
  **not reliably available** → the header must show it only when present and
  otherwise omit it (never show a fake `0.00`).
- FX: `query2` chart for `HKDUSD=X`, `EURUSD=X`, `USDCNY=X` → all **200**
  (`0.1275`, `1.1179`, `6.6693`). Currency switching is feasible via USD cross-rates.

## 4. Feasibility verdict per brief item

| Brief item | Verdict |
|---|---|
| §1 header: price/change/volume, mcap, **forward P/E**, next earnings date, sector/industry | ✅ (forward P/E from `defaultKeyStatistics.forwardPE`) |
| §1 quick actions: alerts, watchlist, notes, export | ✅ (local/state; export = download) |
| §2 statements, LTM/Q/A switch, 3 statements | ✅ via timeseries (LTM = trailing 4 quarters, labelled as computed) |
| §2 multiples, EV, profitability, ROIC | ✅ computable from available inputs |
| §2 solvency: D/E, LT D/E, D/Capital, Liab/Assets, EBIT/Int, EBITDA/Int, Debt/EBITDA, NetDebt/EBITDA, Debt/(EBITDA−Capex) | ✅ all inputs present |
| §3 actuals vs consensus, CY/FY, export, currency | ⚠️ actuals full; consensus **current+next FY only**; CY/FY = label fiscal periods, no silent calendar mapping |
| §4 next-quarter forecast + growth | ✅ (`calendarEvents` + `earningsTrend`) |
| §4 earnings matrix multi-year | ⚠️ **only 4 periods available** — ship what exists, mark the rest `—` |
| §4 rolling NTM vs price | ❌ historical not available — show current NTM + honest forward only |
| §5 price target range, return potential, 1y return | ✅ |
| §5 historical price target, multi-span chart (MTD…10Y) | ⚠️ **no historical target series** → show current target band vs price, spans only over real price history |
| §5 analyst ratings distribution + score + trend | ✅ (score from `recommendationMean`, trend from `recommendationTrend`) |
| §6 estimates trend FY27–30+ | ❌ only 4 periods — honest partial |
| §6 breakdown: #analysts, low-high range, average, YoY chg, EV multiple, price multiple | ✅ for the periods that exist |
