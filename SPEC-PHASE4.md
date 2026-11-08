# SPEC — Phase 4: Dividends (Yield, Growth, Shareholder Yield, Graphs, Payout Schedule)

> **Status: FROZEN 2026-11-07.** Owner brief: add a **dividends** feature in **six
> areas** (§C), matching the beginner-first TradingView / Futu 牛牛 feel of
> Phases 1–3, while staying **簡潔, 唔好亂**.
>
> This is **additive** on top of Phase 1 (K-line + signals), Phase 2 (zh-HK i18n,
> sidebar, categorisation, profile/stats, news) and Phase 3 (analyst estimates,
> financial statements, button/nav redesign + motion). **Do not regress** any
> Phase 1/2/3 behaviour. Phase 1/2/3 evidence stays untouched.
>
> **Read `RECON-PHASE4.md` first — it is the binding data-source contract.** It
> records, per field, the exact observed HTTP response and whether Yahoo carries
> it. Every figure this spec asks for is either **Direct**, **Derived** (formula
> given), or **Absent** — and anything Absent ships as an honest `—`, never a
> fabricated number or a fabricated history. The recon's §0 headline corrections,
> §7 reliability rule, §8 unit traps and the §11 "NOT AVAILABLE" list are all
> **binding requirements**, not background.

## §A — Data contract (binding, from RECON-PHASE4.md)

A.1 **New backend endpoints** (all cached; same honesty rules as Phases 2–3;
never leak a cookie/crumb to the client):

| Endpoint | Source | Content |
|---|---|---|
| `/api/dividends/:sym` | `quoteSummary` (query1, cookie+crumb) **facts** + chart `events=div` + `fundamentals-timeseries` | the full `DividendFacts` + `DividendEvent[]` + `DividendGrowth` + `ShareholderYield` + `DividendSeries` block of §A.6 |
| `/api/dividends/:sym/history?span=1y\|3y\|5y\|10y\|20y\|ALL` | chart `/v8/finance/chart/{sym}?events=div&period1&period2` (crumb-free) + timeseries `trailingDividendYield` (crumb-free) | per-share payments + yield line for the requested span (§A.4) |

A.1.1 **Facts ride a session; history does not.** `quoteSummary` dividend facts
go through the **query1 cookie+crumb** path and are **intermittently empty**
(§A.7). Chart and timeseries history are **crumb-free** and immune. The endpoint
must never let a crumb outage blank the two history graphs (§A.7).

A.1.2 **No `range=max` for dividend history — ever.** `range=max` silently drops
whole years behind a plausible histogram (KO `max` returned 169 events with **0**
in the 2010s; `20y`/`30y` return a correct ~40/decade). Use explicit
**`period1`/`period2`** windows only (KO `period1=…` → 258 events, contiguous to
1962). Encode this as a hard rule with a test (§D.1).

A.2 **Data that must NOT be fabricated** (RECON-PHASE4 §11, verbatim contract):
- **Announced Date** — absent everywhere (every probed module/endpoint returns
  "Not Found"). Always `—`.
- **Record Date** — absent everywhere. Always `—`.
- **Payable Date** — only the **next** payment has it (`calendarEvents.dividendDate`);
  historical rows have the chart's single date only. Next-only; historical rows `—`.
- **Type / "regular cash dividend"** — no `type`/flag exists on `events.div`
  (keys are exactly `["amount","date"]`). Guessing would mislabel COST/CBRL/MAIN
  specials as regular. Always `—`.
- **True 20Y/ALL yield line** — `trailingDividendYield` exists only **monthly
  from 2015-04-30** (~140 rows); 10Y is partial, 20Y/ALL are **not available from
  the series**. Pre-2015 may be shown **only** as a labelled reconstruction
  (§A.4) — never as a published figure.
- **Frequency for irregular / disagreeing payers** — no direct field; derived,
  and withheld as `—` when the two methods disagree beyond tolerance (§A.3).
- **Per-share / DPS statement series** (`annualDividendsPerShare`,
  `annualCashDividendsPaidPerShare`, `annualPayoutRatio`, …) — all MISSING; only
  aggregate cash-flow items exist.
- **Gross debt-paydown as a shareholder-yield positive** — only **net**
  (payments − issuance) is honest (KO FY25 net is −13M, not +4.97B).
- **Any dividend figure when `quoteSummary` returns an empty envelope** — facts
  are session-dependent; fall back to chart/timeseries for history and show `—`
  for current facts (§A.7).
- **Dividend totals/growth without excluding specials** — specials make COST's
  5Y growth a fake **−16.88%** (§A.3).

A.3 **Derived metrics must be computed, and the formula shown on hover.** Where
an input is missing the metric is `—` (not `0`, not `NaN`):
- **Indicated yield** (fraction) = `summaryDetail.dividendYield`, or
  `summaryDetail.dividendRate ÷ price.regularMarketPrice` (reproduces it exactly).
- **Trailing LTM yield** (fraction) = `summaryDetail.trailingAnnualDividendYield`.
- **Forward yield** = indicated (Yahoo publishes **no** consensus-forward yield).
  **Label it "indicated", never "NTM consensus"** — mislabelling is dishonest.
- **Payout ratio (LTM)** = `summaryDetail.payoutRatio`, **unit-normalised**
  (§A.5); cross-check `trailingAnnualDividendRate ÷ defaultKeyStatistics.trailingEps`.
- **Payment frequency** = `round(dividendRate ÷ defaultKeyStatistics.lastDividendValue)`,
  cross-checked against the **median gap of chart `events.div`**. It is
  authoritative only when the two agree within tolerance; on disagreement (e.g.
  0005.HK `rate/last = 31.4` vs chart gap 4/yr) → `—`. Monthly payers that infer
  13/yr (MAIN) round to the nearest supported frequency, never "13". No
  `lastDividendValue` (TSLA, BRK-B) → `—`.
- **Consecutive annual increases** = count trailing strict increases in
  Σ `events.div.amount` per calendar year, **excluding the current partial year**.
- **Annualised growth 1Y/3Y/5Y/10Y** = `(Y_last / Y_last-N)^(1/N) − 1` on annual
  dividend totals from chart events; **exclude the current partial year**; detect
  single-event outliers ≫ the modal payment (a special) and **either exclude with
  a footnote or refuse the number** as `—` (§A.2).
- **Shareholder yield, decomposed** (§A.3.1), as of the last FY (and last FQ where
  quarterly inputs exist):
  - dividend part = `abs(annualCashDividendsPaid) / marketCap@FYend`
  - buyback part = `abs(annualRepurchaseOfCapitalStock) / marketCap@FYend`
  - debt-paydown part = `(|annualLongTermDebtPayments| − |annualLongTermDebtIssuance|) / marketCap@FYend`
    (**NET of issuance**, and **signed** — see the sign rule below).
  - total = sum of the three (with the debt leg's sign preserved).
  - **Signs**: dividend and buyback cash-flow items are reported negative (outflow)
    — normalise with `abs()` and document it; a −15.7B must never become a −454%
    yield. **The debt leg is the exception**: the provider reports payments
    *negative* and issuance *positive*, so the naive `abs(payments − issuance)`
    both overstates the magnitude ~380× (KO: 9.947B instead of 13M) **and flips
    the sign**. Compute the net with `|payments| − |issuance|`, then **keep that
    sign** — a net *increase* in debt is a **negative** shareholder-yield
    contribution, never a positive one. Pinned: KO FY25 = **−13M/mcap**; IBM FY25
    (net issuance 2.902B) = **−2.902B/mcap**, not +2.902B. Reporting debt issuance
    as a positive "paydown" is exactly the dishonesty RECON §4.2 warns about.
  - **Denominator honesty**: the numerator is an FY-end balance-sheet fact, so the
    denominator is **market cap at that FY-end** = `shares@FYend × close(nearest
    chart date to FY-end)`. Mixing in *today's* market cap silently changes the
    period and is wrong. Show the `asOf` date to the user.
  - **Sparse quarterly issuance** (`quarterlyLongTermDebtIssuance` returned only
    2 of 5 quarters for AAPL, both 0): if fewer than the four quarters needed for
    an LTM figure are returned, the **debt leg degrades to `—`**, never a partial
    sum.

A.3.1 All Phase-3-style **sourced<T>** discipline applies: every derived figure
carries `{ value, source: 'direct' | 'derived' | 'absent', note? }`, and the UI
distinguishes a **reported** figure from a **computed ("LTM (computed)")** one.

A.4 **Yield & payments history spans** — `1Y / 3Y / 5Y / 10Y / 20Y / ALL`:
- **Payments bar chart**: direct from chart `events.div[].amount` (already
  split-adjusted). Depth: 20y works; **~60y** is reachable via explicit
  `period1/period2` windows. Never `range=max` (§A.1.2).
- **Yield line chart**: prefer the **real** `trailingDividendYield` series where
  it exists (2015-04-30 → now). For spans reaching **before 2015**, the line may
  be shown **only** as a **reconstruction** — `yield(t) = Σ dividends(ex-date in
  t−12m..t] ÷ price(t)` using the chart's monthly close — and **must be labelled
  `"reconstructed (LTM dividends ÷ price at date)"`**, never presented as
  published. Accuracy: ≈ ±0.0001–0.0006 for quarterly payers, larger (≈0.002–0.006)
  for high-yield/frequent payers.
- `spansAvailable` must reflect reality: yields are 10Y-partial and 20Y/ALL
  unavailable **from the series** (reconstruction-only). Clamp, don't fake.

A.5 **Unit normalisation is mandatory** (same payload family, divergent units):

| Field | Unit | Rule |
|---|---|---|
| `summaryDetail.dividendYield` | fraction (0.0221) | as-is; render as % |
| `summaryDetail.trailingAnnualDividendYield` | fraction (0.02194) | as-is |
| `summaryDetail.fiveYearAvgDividendYield` | **percent** (2.83) | ÷100 before display |
| `summaryDetail.payoutRatio` | fraction **or percent** (AAPL 0.118 vs AGNC 72) | normalise; if unresolved → `—` |
| v7 `/v7/finance/quote.dividendYield` | **percent** (0.31) | ÷100 |
| timeseries `trailingDividendYield.dataValue` | fraction (0.0223) | as-is |
| LSE names (ULVR.L) | **GBp** vs GBP | take the amount's currency from **chart `meta.currency`** |

The `—`-rule applies to units too: when a unit cannot be resolved, render `—`
rather than a number off by 100×.

A.5.1 **Currency (foreign symbols)**: take the dividend amount's currency from
**chart `meta.currency`**, which equals `price.currency`, and **never** from the
statements. `0700.HK` pays HKD but reports CNY; `0005.HK` pays HKD but reports
USD; `ULVR.L` is quoted in **pence**.

A.6 **Proposed data shapes** (from RECON-PHASE4.md §10 — the builder may extend
but not weaken them):

```ts
type Sourced<T> = { value: T | null; source: 'direct' | 'derived' | 'absent'; note?: string };

interface DividendFacts {
  currency: Sourced<string>;
  indicatedYield: Sourced<number>;     // fraction; summaryDetail.dividendYield
  trailingYield: Sourced<number>;      // fraction; summaryDetail.trailingAnnualDividendYield
  forwardYield: Sourced<number>;       // derived: dividendRate / price  (label "indicated")
  payoutRatioLtm: Sourced<number>;     // fraction; summaryDetail.payoutRatio (unit-normalised)
  fiveYearAvgYield: Sourced<number>;   // percent -> fraction
  annualRate: Sourced<number>;         // summaryDetail.dividendRate
  lastDividendValue: Sourced<number>;  // defaultKeyStatistics.lastDividendValue
  nextExDate: Sourced<number>;         // summaryDetail/calendarEvents.exDividendDate
  nextPayDate: Sourced<number>;        // calendarEvents.dividendDate
  frequency: Sourced<FrequencyLabel>;  // derived; null when methods disagree
}

interface DividendEvent {
  exDate: number;             // chart events.div.date  (the ONLY historical date)
  amount: number;             // chart events.div.amount (already split-adjusted)
  currency: string;           // chart meta.currency
  announcedDate: null;        // ABSENT
  recordDate: null;           // ABSENT
  payableDate: number | null; // only the NEXT event, from calendarEvents
  adjAmount: number;          // == amount (no separate field)
  frequency: FrequencyLabel | null;
  type: null;                 // ABSENT — never guess "regular"
}

interface DividendSeries {
  yields:  { date: number; value: number; source: 'yahoo:trailingDividendYield' | 'reconstructed' }[];
  payments: { date: number; amount: number }[];
  spansAvailable: ('1y'|'3y'|'5y'|'10y'|'20y'|'ALL')[]; // yields 10y partial, 20y/ALL n/a from series
}

interface DividendGrowth {
  consecutiveAnnualIncreases: Sourced<number>; // derived, specials excluded/flagged
  growth1y: Sourced<number>; growth3y: Sourced<number>;
  growth5y: Sourced<number>; growth10y: Sourced<number>;
}

interface ShareholderYield {          // as of last FY (or last FQ where quarterly inputs exist)
  total: Sourced<number>;
  dividendPart: Sourced<number>;
  buybackPart: Sourced<number>;
  debtPaydownPart: Sourced<number>;   // NET of issuance
  asOf: string;                        // the FY/FQ date — shown to the user
}
```

A.7 **Reliability rule for the facts layer** (RECON-PHASE4 §7 — binding):
Because `quoteSummary` dividend facts ride the cookie+crumb session that
intermittently returns an **empty envelope** (no `quoteSummary` key at all):
- treat "`quoteSummary` key absent" and "module absent" as **unavailable**, never
  as "0 dividend";
- **retry with a forced re-mint** (`fetchProviderJson(path, { forceNewSession: true })`)
  before giving up (a no-crumb call is rejected as *Invalid Crumb*, so a re-mint
  is the correct recovery);
- fall back to the **crumb-free chart + timeseries** for the *history* views so a
  crumb outage cannot blank the two graphs (the Phase-3 precedent).

A.8 **Schedule reconciliation rule (the §C.5 row set must be coherent)**:
The schedule is a *set of payments*, so it must never contain two rows for the
same payment. Chart `events.div[].date` and `calendarEvents` dates come from two
independent sources that disagree at day granularity (the chart event is stamped
13:30Z, the calendar date 00:00Z of the **same** day), so appending the upcoming
row on top of the historical rows duplicates it. Therefore:
- **De-dup by calendar day**, not by raw timestamp: if the upcoming row's
  Ex-Date falls on the same *day* as an existing row, merge/drop rather than
  append (one payment = one row).
- **Monotonicity**: for a given row, Payable Date must never be earlier than its
  own Ex-Date. Two independently-sourced calendar dates are paired, so validate
  the pair; when the pair is impossible, show the offending cell as `—` rather
  than a date that cannot be true.
- **One unit per column**: every row in the §C.5 Amount column (and §C.1 "Last
  Dividend") is in the span's **chart `meta.currency`** unit. If the derived
  upcoming amount comes from a differently-scaled field (e.g. a provider pence
  vs pound, or a fractional-HKD field), reconcile it to the series unit or show
  `—`; never place a 100×-scaled or differently-denominated figure in the column.
- **No positional year runs**: `consecutiveIncreases` must walk contiguous
  calendar years only; a gap in the year set breaks the streak (a 17-year
  suspension is not one increase). The growth horizon label must reflect the
  *actual* number of years available, not the requested one.

## §B — UI (six areas, 簡潔唔好亂)

B.1 The dividend feature is **large by nature** — group it into clear,
collapsible sections / tabs (one primary idea per panel, progressive disclosure);
never dump every table on one screen. Extend the existing sidebar + design system
(`DESIGN-PHASE2.md`) and the Phase-3 button/nav/motion language — **extend, don't
fork**. One consistent button system, no ad-hoc one-off styles.

B.2 Reuse the Phase-3 motion rules unchanged: purposeful, subtle, ≤ 400 ms,
**`prefers-reduced-motion: reduce` disables all motion**, and animation must never
hurt legibility, hide data, or block interaction.

B.3 **Direction is readable at a glance** (Phase-4 brief §A): colour up/down
figures via the existing `.chg-up / .chg-down / .chg-flat` + `dirClass` helper.
Colour **directional change** figures only — **never** colour a non-directional
level (a yield, a payout ratio, a price level). Keep the sign in the text so
colour is never the only signal (accessibility).

## §C — Feature areas (the owner's six, scoped to reality)

C.1 **Dividend Yield & Frequency** — Indicated yield; Trailing LTM yield;
Forward yield (labelled **indicated**, not "NTM consensus"); Payout Ratio (LTM,
unit-normalised); Payment Frequency (derived, `—` on disagreement); Five-year
average yield (unit-normalised). Each figure carries its source/`—`.

C.2 **Dividend Growth** — Consecutive annual increases; annualised growth
1Y/3Y/5Y/10Y; all derived from chart `events.div` annual totals with the §A.3
partial-year and special-dividend rules; the derivation basis is shown on hover.

C.3 **Shareholder Yield** — Total + decomposition (dividend / buyback /
debt-paydown), as of the last FY (and last FQ where quarterly inputs exist), per
§A.3.1. Net debt-paydown; FY-end market-cap denominator; `asOf` shown; honest `—`
when the LTM debt leg is under-populated.

C.4 **Dividend Yield & Payments Graph** — spans **1Y/3Y/5Y/10Y/20Y/ALL**; a
per-share **payments bar chart** (direct, up to ~60y via `period1/period2`) and a
**yield line chart** (real series from 2015-04; pre-2015 reconstruction-only and
labelled). Spans clamp to what exists; no `range=max`; no fabricated history.

C.5 **Dividend Payout Schedule** — spans as above; columns **Announced / Ex-Date /
Record Date / Payable Date / Currency / Amount / Adj. Amount / Frequency / Type**.
Per §A.2: Ex-Date ✅ (chart date), Currency ✅ (chart `meta.currency`), Amount ✅
(split-adjusted), Adj. Amount = Amount (no separate field — label honestly),
Frequency = derived, **Announced / Record / Type = permanent `—`**, Payable =
**next-only**. Ship Ex-Date + Amount + Currency honestly and render the rest `—`.

C.6 **Consistency & export** — currency display per §A.5.1; every table states
its period (`asOf`) and currency; missing line items show `—`; the visible data is
exportable (CSV/JSON) with the same honesty rules; no cookie/crumb ever reaches
the client.

## §D — Verification (build is NOT proof; independent checks are)

D.1 Unit/integration tests for every new formatter, derived metric, unit
normaliser, and cache path — **including tests that assert an honest `—`/null when
an input is absent**, and a **`range=max` refusal** pin (assert the history path
uses explicit `period1/period2`). Include a special-dividend outlier pin (COST
2023) and a partial-current-year pin.

D.2 A browser/DOM-level check: the new sections render, animate, and are readable;
**zero horizontal overflow at 390 / 834 / 1600 px**; **zero console errors**;
`prefers-reduced-motion` honoured (motion disabled when set); directional colour
applied only to change figures (§B.3).

D.3 **Extend `verify:runtime`** with live checks: `/api/dividends/:sym` returns a
real facts block for a known payer (KO/AAPL) and an **honest empty (all `—`)** for
a non-payer (TSLA/BRK-B); a derived metric equals an independently recomputed
value; the history endpoint returns contiguous payments and a yield series whose
first row is 2015-04; a forced empty-envelope fact path falls back without
blanking the history graphs.

D.4 **All Phase 1/2/3 gates stay green**: `tsc` 0, `lint` 0, full test suite,
`build` 0, `verify:runtime`, `evidence:phase3`, `evidence:chart`. No Phase 1/2/3
regression.

D.5 **Blanket honesty rule (unchanged)**: every unavailable figure renders
`—` / `暫無資料`; no cookie/crumb reaches the client body or headers.

## §E — Out of scope / boundaries

- **This task's only deliverable is `SPEC-PHASE4.md`** — no product code is
  written here.
- No publish, deploy, purchase, or external account. No paid data provider.
- Do not modify `projects/stock-analyzer` (read-only reference).
- Do not delete Phase 1/2/3 evidence.
- Native iOS/macOS wrappers remain out of scope for this host (no Xcode/Rust).

## §F — Acceptance criteria

1. Every one of the six §C areas exists and renders, **or** is explicitly shown
   as unavailable with an honest `—` wherever Yahoo does not carry the data (§A.2).
2. Derived figures are computed and cross against an independent recompute (§A.3,
   §D.3); missing inputs yield `—`, never a fabricated number; **Announced /
   Record / Type are always `—`**, Payable is next-only (§A.2, §C.5).
3. Units are normalised and documented (§A.5); currency is taken from chart
   `meta.currency`, never the statements (§A.5.1); no 100× errors.
4. The facts layer follows the retry-with-re-mint rule and never lets a crumb
   outage blank the history graphs (§A.7).
5. i18n: all new copy exists in **both** zh-HK and en with identical key sets; the
   `no-hardcoded-strings` test covers the new files; no English leaks into a zh-HK
   session.
6. Gates per §D all green, reproduced independently by the coordinator **and** by
   `debug-reviewer` before this is called complete.
