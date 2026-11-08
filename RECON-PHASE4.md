# PHASE 4 — DIVIDEND FEATURE DATA-SOURCE RECON (live probes, 2026-11-06)

> Read-only reconnaissance against the **real** upstream through the app's own
> provider layer. No raw `curl` (Yahoo 429s the shell) — every call below went
> through `server/provider.ts` (`fetchProviderJson` = cookie+crumb `query1`,
> `fetchQuery2Json` = crumb-free `query2`).
>
> Raw evidence: `review-evidence/recon-phase4/probe*.mts` + `review-evidence/recon-phase4/out/`
> (probe logs, `qs-analyst-AAPL.json`, `div-*-max.json`, `ts-AAPL.json`, `ts-yieldraw-AAPL.json`, `v7-quote-AAPL.json`).
> Every line below is an observed HTTP response. Where Yahoo carries **nothing**
> the field is marked **NOT AVAILABLE** and must render an honest `—`.

## 0. Headline corrections to the brief's priors (verify-don't-trust)

Two of the brief's starting assumptions were **wrong**, and both matter:

1. **The dividend fields in `quoteSummary` are NOT null.** The brief reported
   `summaryDetail`/`defaultKeyStatistics`/`financialData` dividend fields "ALL
   null" and `calendarEvents` empty. Re-probed: those fields are **present and
   correct** through the cookie+crumb `query1` path
   (`fetchProviderJson(analystSummaryPath('AAPL'))`). The earlier nulls were a
   **stale / partial auth session**, not an upstream gap.
   - `("a")` in probe1 returned a root with **no `quoteSummary` key at all**
     (`top-level keys=[]`) — note, absent, not null-valued.
   - `("b")` the identical `query1` quoteSummary call, moments later, returned
     all 10 modules incl. `summaryDetail.dividendRate={"raw":1.08,"fmt":"1.08"}`.
   - The failure is **intermittent and session-scoped**: probe8 saw 8/8 successes
     on both the Phase-2 and analyst module lists; probe11 hit it live (one empty
     envelope, then success on retry); probe15 hit it 4× in a row on a **cold**
     session. See §7 for the reliability rule this forces.

2. **`quote2` quoteSummary does not exist.** A crumb-free `query2` `v10/quoteSummary`
   call returns `{"finance":{}}` (probe1 `("c")`). `quoteSummary` is a
   **`query1`, cookie+crumb-only** endpoint. A **no-crumb** `query1` call returns
   `{"finance":{"result":null,"error":{"code":"Unauthorized","description":"Invalid Crumb"}}}`
   (HTTP 401, probe1 `("d")`). So dividend *facts* inherit Session's reliability,
   while dividend *history* (chart, timeseries) is crumb-free and does not.

---

## 1. Field-availability matrix

Legend — **Direct** = a value Yahoo returns verbatim; **Derived** = computed from
cited inputs (formula given); **Absent** = no upstream anywhere we probed; the
Honest fallback column is what the UI must show when the value is missing.

| Field | Area | Kind | Exact upstream path / formula | Evidence ref | Honest fallback |
|---|---|---|---|---|---|
| Indicated Yield (forward 12m) | 1 | **Direct** | `quoteSummary.summaryDetail.dividendRate` ÷ price, or `summaryDetail.dividendYield` (fraction) | probe11 §3, probe14(b) | `—` |
| Trailing LTM Yield | 1 | **Direct** | `summaryDetail.trailingAnnualDividendYield` (fraction) | probe11 §3 | `—` |
| Forward NTM Yield | 1 | **Derived** | `summaryDetail.dividendRate` ÷ `price.regularMarketPrice` (== indicated yield; **not** analyst NTM) | probe11 §3, probe14(b) | `—` |
| Payout Ratio (LTM) | 1 | **Direct** | `summaryDetail.payoutRatio` (fraction… **see units caveat §8**) | probe16 | `—` |
| Payment Frequency | 1 | **Derived** | `round(summaryDetail.dividendRate ÷ defaultKeyStatistics.lastDividendValue)`; cross-check median gap of chart `events.div` | probe12 | `—` |
| Consecutive annual increases | 2 | **Derived** | Σ chart `events.div.amount` per calendar year, count trailing strict increases (exclude current partial year) | probe13(A) | `—` / "n/a" |
| Annualised growth 1Y/3Y/5Y/10Y | 2 | **Derived** | `(Y_last / Y_last-N)^(1/N) − 1` on annual dividend totals from chart events | probe13(A) | `—` |
| Shareholder yield — total | 3 | **Derived** | `(divPaid + buyback + LTdebtPay − 0) / marketCap@FYend` (signs normalised, §8) | probe13(B) | `—` |
| Shareholder yield — dividend part | 3 | **Derived** | `annualCashDividendsPaid / marketCap@FYend` | probe13(B) | `—` |
| Shareholder yield — buyback part | 3 | **Derived** | `annualRepurchaseOfCapitalStock / marketCap@FYend` | probe13(B) | `—` |
| Shareholder yield — debt-paydown part | 3 | **Derived** | `(LTdebtPayments − LTdebtIssuance) / marketCap@FYend` (**net**; gross pay-down overstates — see §4) | probe13(B), probe14(a) | `—` |
| Yield line chart (multi-span) | 4 | **Direct (partial)** | timeseries `trailingDividendYield` — **monthly, 2015-04→now only (~139 rows)** | probe5, probe11 §2 | span clamp |
| Dividend per-share bar chart | 4 | **Direct** | chart `events.div[].amount` (split-adjusted, §3) | probe11 §1 | `—` if no events |
| Dividend amount (per payment) | 5 | **Direct** | chart `events.div[].amount` | probe11 §1 | `—` |
| Adjusted amount | 5 | **Direct** | same chart amount (already split-adjusted — no separate adj. field) | probe7, §3 | `—` |
| Currency (per payment) | 5 | **Direct** | chart `meta.currency` (== quote currency) | probe7(d) | `—` |
| Frequency (per row) | 5 | **Derived** | per-symbol derived frequency (§1 row 5) | probe12 | `—` |
| Type ("regular cash dividend") | 5 | **Absent** | not in chart `events.div` (keys `[amount,date]` only); not in quoteSummary | probe3(b), probe11 §1 | `—` |
| Ex-Date (per historical event) | 5 | **Direct** | **the chart event `date` IS the ex/pay date** (verified: `lastDividendDate` == last chart event date) | probe16, probe7(c) | `—` |
| Next Ex-Date (upcoming) | 5 | **Direct** | `summaryDetail.exDividendDate` / `calendarEvents.exDividendDate` | probe11 §3 | `—` |
| Next Payable Date (upcoming) | 5 | **Direct** | `calendarEvents.dividendDate` | probe11 §3 | `—` |
| Announced Date (per historical event) | 5 | **Absent** | no module/endpoint carries it | probe3(b), probe11 §5 | `—` |
| Record Date (per historical event) | 5 | **Absent** | no module/endpoint carries it | probe3(b), probe11 §5 | `—` |
| Payable Date (per historical event) | 5 | **Absent** | chart gives ONE date; quoteSummary gives only *upcoming* pay date | probe11 §5, probe7(c) | `—` |
| Special vs regular indicator | 5 | **Absent** | no `type`/flag on any event | probe3(b), probe6(a) | `—` |
| Per-share dividend series (annual/quarterly) | 4/5 | **Absent** | `annualDividendsPerShare`, `annualCashDividendsPaidPerShare`, … all MISSING | probe3(a) | derive |
| Price history (for yield reconstruction) | 4 | **Direct** | chart `/v8/finance/chart/{SYM}` closes | probe7(b) | `—` |
| Five-year average yield | 1 | **Direct (unit trap)** | `summaryDetail.fiveYearAvgDividendYield` (percent, not fraction) | probe14(b) | `—` |

**Raw-payload spot check for the direct fields** (probe11 §3, KO, cookie+crumb):
```
summaryDetail: dividendRate={"raw":2.12} dividendYield={"raw":0.0221,"fmt":"2.21%"}
               exDividendDate={"raw":1796083200,"fmt":"2026-12-01"} payoutRatio={"raw":0.6195}
               fiveYearAvgDividendYield={"raw":2.83} trailingAnnualDividendRate={"raw":2.1}
               trailingAnnualDividendYield={"raw":0.021936696} currency="USD"
defaultKeyStatistics: lastDividendValue={"raw":0.53} lastDividendDate={"raw":1789430400,"fmt":"2026-09-15"}
calendarEvents: exDividendDate={"raw":1796083200} dividendDate={"raw":1797292800,"fmt":"2026-12-15"}
```
**And the raw reason "next pay date" is the only pay date we get** — the chart
event object has exactly two keys (probe11 §1, KO `range=20y`):
```
keys(event)=["amount","date"]   events count=80
last3=[{"amount":0.53,"date":1773408600},{"amount":0.53,"date":1781530200},{"amount":0.53,"date":1789479000}]
```

---

## 2. Area 1 — Yield & Frequency

- **Indicated Yield** — direct: `summaryDetail.dividendYield` (0.0221 for KO,
  = 2.21%). `dividendRate` (2.12) is the annualised indicated rate; `rate/price`
  reproduces it exactly (probe12: AAPL 1.08, KO 2.12, O 3.26).
- **Trailing LTM Yield** — direct: `summaryDetail.trailingAnnualDividendYield`
  (fraction). Distinct from indicated only when the last increase hasn't cycled
  through 4 payments yet.
- **Forward NTM Yield** — Yahoo does **not** publish a consensus-forward dividend
  yield. Only "indicated" (current rate annualised). Label it **indicated**, not
  "NTM consensus" — otherwise it is misleading.
- **Payout Ratio (LTM)** — direct `summaryDetail.payoutRatio`. Two traps: (a) it
  can be **negative** for loss-makers and **>1 / huge** numerically (AGNC `72` is
  a *percentage*, AAPL/O are *fractions*; see §8); (b) cross-check
  `trailingAnnualDividendRate / defaultKeyStatistics.trailingEps` reproduces it
  (probe16: AAPL 0.118, KO 0.6195, O 2.2199).
- **Frequency** *is derivable but is nowhere provided*. Two independent methods,
  both verified (probe12): `rate / lastDividendValue` agrees with the median
  chart-event gap on **20/23** symbols tested; it is authoritative when the two
  disagree. **Failure modes**:
  - **Special dividends** break both: COST's annual total jumps to 18.96 in 2023
    because of a special (probe13(A)); the per-event spacing then looks irregular.
  - **Split adjustments** make old `lastDividendValue`-style ratios meaningless.
  - **Non-synchronous payers** (0005.HK: `rate/last = 31.4`, chart gap 4/yr —
    quarterly *interim* plus a separate final that isn't captured as the "last"
    single value) → **do not derive**; show `—` when the two methods disagree
    by more than a tolerance.
  - **Monthly payers with 13 payments/yr** (MAIN: chart infers 13/yr): round to
    the nearest supported frequency, never fabricate "13".
  - Non-payer / no `lastDividendValue` (TSLA, BRK-B) → `—`.

## 3. Area 2 — Dividend Growth

Fully **derived** from chart `events.div` annual totals (probe13(A)):
- Consecutive annual increases: AAPL **13y**, KO **23y**, MSFT **20y**, TGT **29y**.
- Annualised growth from `(Y_last/Y_last-N)^(1/N)−1`:
  AAPL 1Y 4.04% / 3Y 4.22% / 5Y 4.99% / 10Y 7.33%; KO 1Y 5.15% / 10Y 4.45%.
- **CRITICAL correctness rules**:
  1. **Exclude the current partial year** from totals/streaks, else the last
     "increase" is just an incomplete year.
  2. **Special dividends corrupt totals** — COST's 2023 total is 18.96 (a $10
     special), producing a *negative* 5Y (−16.88%) and 10Y (−2.56%) growth that
     is an artifact, not reality. Detect outliers (a single event ≫ the modal
     payment) and either exclude with a footnote or refuse the derived number.
  3. Amounts are **split-adjusted** (see §5) and share-split-invariant, so
     growth is comparable across a split boundary — but the *reported per-share
     bar values will retroactively change* when a split occurs.

## 4. Area 3 — Shareholder Yield (decomposed)

Inputs exist **annually** and **quarterly** (crumb-free `query2`
`fundamentals-timeseries`, probe13(B) / probe14(a)):

```
AAPL FY2026-09-30: annualCashDividendsPaid=-15721000000
                   annualRepurchaseOfCapitalStock=-86390000000
                   annualLongTermDebtPayments=-12396000000
                   annualLongTermDebtIssuance=0
                   annualOrdinarySharesNumber=14532259000
```
Formula per component, as of last FY:
- dividend yield = `annualCashDividendsPaid / marketCap@FYend`
- buyback yield  = `annualRepurchaseOfCapitalStock / marketCap@FYend`
- debt-paydown   = `(annualLongTermDebtPayments − annualLongTermDebtIssuance) / marketCap@FYend`
- total = sum of the three.

Honesty notes:
1. **Signs**: all cash-flow items are reported **negative** (outflow). Normalise
   with `abs()` and *document* it; do not let a −15.7B become a −454% yield.
2. **"Debt paydown" must be NET of issuance.** KO FY2025 paid 4.967B but issued
   4.980B → net **−13M** (a tiny *increase*), not a +4.97B "paydown". Computing
   gross pay-down as a shareholder-yield positive would be dishonest.
3. **Denominator honesty**: the components are FY-end balance-sheet facts, so the
   denominator must be **market cap at that FY-end** = `price(FYend) ×
   shares@FYend` — obtainable by multiplying this timeseries' shares row by the
   chart close nearest the FY-end date. Mixing in *today's* market cap silently
   changes the period and is wrong.
4. Quarterly (LTM) inputs **are** available (probe14(a)) so a true "as of last FQ"
   total is possible — **but `quarterlyLongTermDebtIssuance` is sparse** (AAPL
   returned only 2 of 5 quarters, both 0). If only 4 quarters are required and
   fewer are returned, the LTM net-debt leg must degrade to `—`, not to a
   partial sum.

## 5. Area 4 — Yield & payments graphs (multi-span)

- **Payments bar chart** — direct from chart `events.div[].amount`. Depth is the
  good news (probe9/probe10): **20y works** (KO 80 events, O 239, AAPL 57), and
  **period1/period2-based windows go back ~60y** (KO 200 → 1967; IBM 237 → 1967).
  `range=max` is **unreliable** — see the warning below.
- **Yield line chart** — a **real historical yield series exists**:
  timeseries `trailingDividendYield` (type `trailingDividendYield`, rows
  `{asOfDate, dataValue}`), **monthly, from 2015-04-30 to now (~139–142 rows)**
  (probe5, probe11 §2):
  ```
  KO: first={"asOfDate":"2015-04-30","dataValue":0.0307}
      last ={"asOfDate":"2026-10-30","dataValue":0.0223}   n=141, median gap 31d
  ```
  This is **better than reconstruction** and should be preferred where it
  exists. **But it only starts in 2015**, so **10Y is partial and 20Y/ALL are
  not available from this series**.
- **Reconstruction** (probe7(b)) — `yield(t) = Σ dividends(ex-date in t−12m..t] ÷
  price(t)` matches the real series closely when you use the **same price the
  real series used**. With the chart's *monthly close* (not the last close
  before the ex-date), error is ≈ ±0.0001–0.0006 and larger (≈0.002–0.006) for
  high-yield/frequent payers (O: Δ +0.0022…+0.006). Verdict: reconstruction is a
  **fallback for pre-2015 spans**, accurate for quarterly payers, and must be
  labelled *"reconstructed (LTM dividends ÷ price at date)"* — never presented
  as a published figure.

### `range=max` is NOT safe — the single worst trap found (probe9)
`range=max` silently drops whole years of dividend events behind a plausible-looking
decade histogram. KO `range=max` returned **169 events but 0 in the 2010s**
(2000s=18, 2010s=**0**, 2020s=1), while `20y`/`25y`/`30y` all return a correct
40-per-decade series; the gap and `interval=1d/1wk` make no difference:
```
KO  max/1mo  n=169 maxGap=8223d perDecade={"1960s":31,"1970s":39,"1980s":40,"1990s":40,"2000s":18,"2020s":1}
KO  30y/1mo  n=121 maxGap=106d perDecade={"1990s":13,"2000s":41,"2010s":40,"2020s":27}
```
**Rule: never use `range=max` for dividends.** Use explicit `period1`/`period2`
(probe10) which returned complete, contiguous series (KO 258 events → 1962).

## 6. Area 5 — Payout schedule & detail table

Per-event the upstream gives **exactly one date** (`chart.events.div.date`), and
it is the **ex-date/pay-date** verified by agreement with
`defaultKeyStatistics.lastDividendDate` (probe16: MSFT/KO/O all match to the day).
Historical rows therefore look like:

| Column | Status | Source |
|---|---|---|
| Announced Date | **`—`** | nothing anywhere (probe11 §5) |
| Ex-Date | ✅ | chart `events.div.date` (historical); `summaryDetail.exDividendDate` (next) |
| Record Date | **`—`** | nothing anywhere |
| Payable Date | ⚠️ **next only** | `calendarEvents.dividendDate` (upcoming); **not** on historical rows |
| Currency | ✅ | chart `meta.currency` |
| Amount | ✅ | chart `events.div.amount` (split-adjusted) |
| Adj. Amount | ✅ = Amount | **no separate field**; chart amount already adjusted (§5/§3) — label the column honestly or show the same value |
| Frequency | ⚠️ derived | §1/probe12 — withheld when methods disagree |
| Type (regular cash) | **`—`** | no `type`/flag on any event (probe3(b)); COST/CBRL specials would be mislabelled "regular" if guessed, so show `—` |

**Probed-and-rejected for the date columns** (probe3(b)): `dividends`,
`dividend`, `calendarEventsHistory`, `history`, `chart`, `capitalGains`,
`fundProfile`, `fundPerformance`, `topHoldings`, `esgScores`, `tradeSummary`,
`bulk` → all `{"code":"Not Found","description":"No fundamentals …"}`. The full
key-set dump of every working module contains **no** `recordDate`, `announcedDate`
or `payableDate` key (probe11 §5 → no output).

## 7. Reliability rule for the facts layer (from §0)

Because `quoteSummary` dividend *facts* ride the cookie+crumb session that
intermittently returns an **empty envelope** (no `quoteSummary` key), the
dividend facts feature must:
- treat "`quoteSummary` key absent" and "module absent" as **unavailable**, never
  as "0 dividend";
- **retry with a forced re-mint** (`fetchProviderJson(path, { forceNewSession: true })`)
  before giving up (probe1 `("d")` shows a no-crumb call is rejected as
  *Invalid Crumb*, so a re-mint is the correct recovery);
- fall back to the **crumb-free chart + timeseries** for the *history* views so a
  crumb outage cannot blank the two graphs (the Phase-3 precedent).

## 8. Unit inconsistencies (must be normalised explicitly)

Observed in the same payload family (probe14(b), probe16):

| Field | Unit | Evidence |
|---|---|---|
| `summaryDetail.dividendYield` | **fraction** (0.0221) | KO |
| `summaryDetail.trailingAnnualDividendYield` | **fraction** (0.02194) | KO |
| `summaryDetail.fiveYearAvgDividendYield` | **percent** (2.83) | KO/AAPL 0.47 |
| `summaryDetail.payoutRatio` | **fraction** *or* **percent** | AAPL 0.118 vs AGNC **72** |
| v7 `/v7/finance/quote.dividendYield` | **percent** (0.31 for AAPL) | probe1(e) |
| timeseries `trailingDividendYield.dataValue` | **fraction** (0.0223) | probe11 §2 |
| `ULVR.L` (GBp): `dividendRate` **1.56** vs chart div **39.82** | GBP £ vs GBp pence | probe7(d) |

The `—`-rule applies to units too: when a unit cannot be resolved, render `—`
rather than a number that is off by 100×.

## 9. Foreign symbols & currency

Dividend amounts are quoted in the **trading/quote currency**, and chart
`meta.currency` == `price.currency` (probe7(d)): 0700.HK → HKD, ULVR.L → **GBp**,
NESN.SW → CHF, RY.TO → CAD, ENEL.MI → EUR. Two mismatch risks:
1. **Pence quoting**: LSE names return amounts in **pence** (ULVR.L last 39.82 in
   the chart, vs `dividendRate` 1.56 in the *pound* figure) — mixing them is a
   100× error.
2. **Financial-statement currency ≠ dividend currency**: 0700.HK pays in HKD but
   reports in **CNY**; 0005.HK pays in HKD but reports in **USD**. `financialData.financialCurrency`
   and `(rt.price).currency` diverge — always take the amount's currency from the
   **chart `meta.currency`**, never from the statements.

## 10. Proposed data contract (for the builder)

```ts
type Sourced<T> = { value: T | null; source: 'direct' | 'derived' | 'absent'; note?: string };

interface DividendFacts {
  currency: Sourced<string>;
  indicatedYield: Sourced<number>;        // fraction; summaryDetail.dividendYield
  trailingYield: Sourced<number>;         // fraction; summaryDetail.trailingAnnualDividendYield
  forwardYield: Sourced<number>;          // derived: dividendRate / price   (label "indicated")
  payoutRatioLtm: Sourced<number>;        // fraction; summaryDetail.payoutRatio (unit-normalised)
  fiveYearAvgYield: Sourced<number>;      // percent -> normalise to fraction
  annualRate: Sourced<number>;            // summaryDetail.dividendRate
  lastDividendValue: Sourced<number>;     // defaultKeyStatistics.lastDividendValue
  nextExDate: Sourced<number>;            // epoch; summaryDetail/calendarEvents.exDividendDate
  nextPayDate: Sourced<number>;           // epoch; calendarEvents.dividendDate
  frequency: Sourced<FrequencyLabel>;     // derived; null when methods disagree
}

interface DividendEvent {
  exDate: number;                 // chart events.div.date  (the ONLY historical date)
  amount: number;                 // chart events.div.amount (already split-adjusted)
  currency: string;               // chart meta.currency
  announcedDate: null;            // ABSENT
  recordDate: null;               // ABSENT
  payableDate: number | null;     // only the NEXT event, from calendarEvents
  adjAmount: number;              // == amount (no separate field)
  frequency: FrequencyLabel | null;
  type: null;                     // ABSENT — never guess "regular"
}

interface DividendSeries {
  yields:  { date: number; value: number; source: 'yahoo:trailingDividendYield' | 'reconstructed' }[];
  payments: { date: number; amount: number }[];   // chart events.div
  spansAvailable: ('1y'|'3y'|'5y'|'10y'|'20y'|'ALL')[]; // yields: 10y partial, 20y/ALL n/a from series
}

interface DividendGrowth {
  consecutiveAnnualIncreases: Sourced<number>;  // derived, specials excluded/flagged
  growth1y: Sourced<number>; growth3y: Sourced<number>;
  growth5y: Sourced<number>; growth10y: Sourced<number>;
}

interface ShareholderYield {                    // as of last FY (or last FQ where quarterly inputs exist)
  total: Sourced<number>;
  dividendPart: Sourced<number>;
  buybackPart: Sourced<number>;
  debtPaydownPart: Sourced<number>;             // NET of issuance
  asOf: string;                                  // the FY/FQ date — shown to the user
}
```

## 11. Explicit "NOT AVAILABLE — honest `—`" list (and WHY)

| Renders `—` | Why (proven) |
|---|---|
| **Announced Date** (any dividend) | No module/endpoint carries it; every probed candidate returns "Not Found" (probe3(b), probe11 §5). |
| **Record Date** (any dividend) | Same — absent everywhere. |
| **Payable Date** (historical rows) | Only the chart's one date exists per event; `calendarEvents.dividendDate` covers the **next** payment only (probe7(c), probe16). |
| **Type / "regular cash dividend"** | No `type`/flag on `events.div` (keys are `amount`,`date` only). Guessing would mislabel COST/CBRL/MAIN specials as regular (probe6(a)). |
| **True 20Y/ALL yield line** | `trailingDividendYield` starts 2015-04 only (~139 rows); pre-2015 is reconstruction-only and must be labelled (probe5, probe7(b)). |
| **Frequency for irregular / disagreeing payers** | Derivation (rate÷lastDiv) and gap-inference disagree for 0005.HK etc.; no direct field exists (probe12). |
| **Per-share / DPS statement series** | `annualDividendsPerShare`, `…CashDividendsPaidPerShare`, `annualPayoutRatio` → all MISSING (probe3(a)); only aggregate cash-flow items exist. |
| **Gross debt-paydown as a shareholder-yield positive** | Only **net** (payments − issuance) is honest; KO FY25 net is −13M, not +4.97B (probe13(B)). |
| **Any dividend figure when `quoteSummary` returns an empty envelope** | Facts layer is session-dependent; must fall back to chart/timeseries for history and show `—` for current facts (probe1, probe8, probe11, probe15). |
| **Dividend totals/growth without excluding specials** | Specials make COST's 5Y growth a fake −16.88% (probe13(A)). |

## 12. Feasibility verdict per owner area

| Area | Verdict |
|---|---|
| 1 — Yield & Frequency | ✅ **Deliverable**: indicated + trailing yield direct; payout direct (unit-normalised); frequency **derived** with honest `—` on disagreement. "Forward NTM" = indicated (label correctly). |
| 2 — Dividend Growth | ✅ **Deliverable (derived)**; must exclude partial current year, and flag/exclude specials or refuse to compute. |
| 3 — Shareholder Yield | ✅ **Deliverable (derived, net debt-paydown)**; needs FY-end market cap; net-of-issuance rule; sparse quarterly issuance → honest `—` on the debt leg. |
| 4 — Yield & Payments Graph | ⚠️ **Partially**: payments bar full (20y+, ~60y via period window); **yield line only 2015→now**, 10Y partial, 20Y/ALL need labelled reconstruction. |
| 5 — Payout Schedule & Detail | ⚠️ **Partially**: Ex-Date/Currency/Amount/Adj-Amount ✅; **Announced/Record = permanent `—`; Payable = next-only; Type = `—`; Frequency derived**. |

## 13. Single most important honesty caveat

**The historical payout table can only ever be one-date-per-payment.** Yahoo
exposes *upcoming* ex/record/pay dates only for the **next** dividend
(`calendarEvents.dividendDate`), and never exposes announced, record, or payable
dates for past payments. Any schedule UI that shows more than one populated date
per past row would be **fabricated**. Ship Ex-Date (the chart date) + Amount +
Currency honestly, and render **Announced / Record / Payable / Type as `—`** per
row — the same rule the owner set ("never fabricate a number") applies to dates.
