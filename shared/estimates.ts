/**
 * Pure mapping layer for analyst estimates, the earnings calendar, actuals and
 * ratings (SPEC-PHASE3 §A.1, §A.2, §C.3–§C.6).
 *
 * Everything here comes from the crumb-authenticated `quoteSummary` modules
 * recon-verified in `RECON-PHASE3.md` and captured into
 * `tests/fixtures/quotesummary-AAPL.json`:
 *
 * | Module | What it really carries |
 * |---|---|
 * | `earningsTrend` | **4 periods only** — `0q` `+1q` `0y` `+1y`. EPS & revenue avg/low/high, #analysts, growth, `yearAgoEps`/`yearAgoRevenue` |
 * | `earningsHistory` | last 5 quarters of actual vs estimate EPS, surprise % |
 * | `calendarEvents` | `earningsDate`, `isEarningsDateEstimate`, consensus EPS/revenue for the upcoming report |
 * | `recommendationTrend` | 4 monthly buckets of strongBuy/buy/hold/sell/strongSell |
 * | `financialData` | target low/mean/median/high, `recommendationMean`, `recommendationKey`, #analyst opinions |
 * | `upgradeDowngradeHistory` | ~980 dated firm actions with `fromGrade`→`toGrade` and price-target changes |
 *
 * The honesty rules this file enforces (SPEC-PHASE3 §A.2):
 *
 * - **Four periods, never more.** There is no multi-year estimate matrix
 *   upstream. `earningsTrend` stops at `+1y`; every other estimate module Yahoo
 *   exposes is empty. We ship the four real periods and label anything further
 *   as unavailable — no synthesised year columns.
 * - **No historical target / estimate-revision series exists.** Nothing here
 *   produces a back-series. The target band is a *current* snapshot; the price
 *   history it is drawn against is separate, real, and labelled as such.
 * - Every missing number is `null` → the UI prints `—`.
 *
 * Pure: no network, no clock. Fully unit-testable from the fixtures.
 */

/** `{ raw: n }` | `n` | `''` → number | null. Never throws, never 0-for-missing. */
export function num(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    if (value.trim() === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  if (typeof value === 'object') return num((value as { raw?: unknown }).raw);
  return null;
}

/** A trimmed non-empty string, or null. */
export function str(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const s = value.trim();
  return s ? s : null;
}

/** Container for `quoteSummary.result[0]`. */
type Module = Record<string, unknown>;
function result(json: unknown): Module | null {
  return (json as { quoteSummary?: { result?: Module[] | null } })?.quoteSummary?.result?.[0] ?? null;
}
function module(json: unknown, name: string): Module | null {
  const r = result(json);
  const m = r?.[name];
  return m && typeof m === 'object' ? (m as Module) : null;
}
function arr(value: unknown): Module[] {
  return Array.isArray(value) ? (value.filter((x) => x && typeof x === 'object') as Module[]) : [];
}
function pick(m: Module | null, key: string): unknown {
  return m ? m[key] : null;
}

/* =============================================================== estimates */

/**
 * The four estimate periods Yahoo carries, in reading order.
 *
 * `id` is the provider's own token (`0q`, `+1q`, `0y`, `+1y`). It is kept
 * verbatim — it is a *label*, so the UI can render "current quarter / next
 * quarter / current FY / next FY" while the underlying token stays traceable.
 */
export const ESTIMATE_PERIODS = ['0q', '+1q', '0y', '+1y'] as const;
export type EstimatePeriodId = (typeof ESTIMATE_PERIODS)[number];

/** One side (EPS or revenue) of one estimate period. */
export interface EstimateSide {
  avg: number | null;
  low: number | null;
  high: number | null;
  /** The same period a year earlier, as reported by the provider. */
  yearAgo: number | null;
  analysts: number | null;
  /** Provider growth fraction (0.0822 = 8.22%), or null. */
  growth: number | null;
  currency: string | null;
}

export interface EstimatePeriod {
  id: EstimatePeriodId;
  /** Provider `endDate`, verbatim ('2027-03-31'). Never a guessed date. */
  endDate: string | null;
  eps: EstimateSide;
  revenue: EstimateSide;
}

function side(raw: unknown, opts: { yearAgoKey: string; currencyKey: string }): EstimateSide {
  const block: Module | null = raw && typeof raw === 'object' ? (raw as Module) : null;
  return {
    avg: num(pick(block, 'avg')),
    low: num(pick(block, 'low')),
    high: num(pick(block, 'high')),
    yearAgo: num(pick(block, opts.yearAgoKey)),
    analysts: num(pick(block, 'numberOfAnalysts')),
    growth: num(pick(block, 'growth')),
    currency: str(pick(block, opts.currencyKey)),
  };
}

/** True when this side carries nothing a user could act on. */
function sideEmpty(s: EstimateSide): boolean {
  return s.avg === null && s.low === null && s.high === null && s.analysts === null;
}

/**
 * Parse `earningsTrend` into the four periods, in canonical order.
 *
 * A period the provider omits is still returned, with null sides, so the table
 * shows a stable shape and an honest `—` instead of a silently missing row.
 */
export function parseEarningsTrend(json: unknown): EstimatePeriod[] {
  const trend = arr(pick(module(json, 'earningsTrend'), 'trend'));
  const byId = new Map<string, Module>();
  for (const t of trend) {
    const id = str(t.period);
    if (id) byId.set(id, t);
  }
  return ESTIMATE_PERIODS.map((id) => {
    const block = byId.get(id) ?? null;
    return {
      id,
      endDate: str(pick(block, 'endDate')),
      eps: side(pick(block, 'earningsEstimate'), { yearAgoKey: 'yearAgoEps', currencyKey: 'earningsCurrency' }),
      revenue: side(pick(block, 'revenueEstimate'), { yearAgoKey: 'yearAgoRevenue', currencyKey: 'revenueCurrency' }),
    };
  });
}

/* ================================================================ calendar */

export interface EarningsCalendar {
  /** UNIX seconds of the next (possibly estimated) report, or null. */
  nextEarningsAt: number | null;
  /** Provider's own `fmt` date string, e.g. '2027-01-28'. */
  nextEarningsLabel: string | null;
  /** True when the provider flags the date as an estimate, not confirmed. */
  isEstimate: boolean;
  /** Consensus for the upcoming report, when published. */
  epsAvg: number | null;
  epsLow: number | null;
  epsHigh: number | null;
  revenueAvg: number | null;
  revenueLow: number | null;
  revenueHigh: number | null;
}

/**
 * Parse `calendarEvents`.
 *
 * `earningsDate[0].raw` is the epoch; `fmt` is the provider's own date label.
 * Both are kept so the UI can show the date without re-deriving a timezone.
 */
export function parseCalendar(json: unknown): EarningsCalendar {
  const cal = module(json, 'calendarEvents');
  const earnings = pick(cal, 'earnings') as Module | null;
  const dates = arr(pick(earnings, 'earningsDate'));
  const first = dates[0] ?? null;
  return {
    nextEarningsAt: num(pick(first, 'raw')),
    nextEarningsLabel: str(pick(first, 'fmt')),
    isEstimate: pick(earnings, 'isEarningsDateEstimate') === true,
    epsAvg: num(pick(earnings, 'earningsAverage')),
    epsLow: num(pick(earnings, 'earningsLow')),
    epsHigh: num(pick(earnings, 'earningsHigh')),
    revenueAvg: num(pick(earnings, 'revenueAverage')),
    revenueLow: num(pick(earnings, 'revenueLow')),
    revenueHigh: num(pick(earnings, 'revenueHigh')),
  };
}

/* ============================================================== actuals */

/** One historical quarter: what was reported vs what was expected. */
export interface ActualQuarter {
  /** Provider `quarter` epoch (start of the quarter), UNIX seconds. */
  quarterAt: number | null;
  /** Provider `quarter` as a date label, derived from the epoch (UTC). */
  quarterLabel: string | null;
  period: string | null;
  epsActual: number | null;
  epsEstimate: number | null;
  epsDifference: number | null;
  surprisePercent: number | null;
  currency: string | null;
}

/**
 * Parse `earningsHistory`.
 *
 * Order is normalised oldest→newest so a table and a chart agree; the provider
 * returns them newest-first with a duplicated `-4q` label, which is why the
 * epoch (not the label) is what we sort on.
 */
export function parseEarningsHistory(json: unknown): ActualQuarter[] {
  const history = arr(pick(module(json, 'earningsHistory'), 'history'));
  const out: ActualQuarter[] = history.map((h) => {
    const at = num(pick(h, 'quarter'));
    return {
      quarterAt: at,
      quarterLabel: at === null ? null : new Date(at * 1000).toISOString().slice(0, 10),
      period: str(h.period),
      epsActual: num(pick(h, 'epsActual')),
      epsEstimate: num(pick(h, 'epsEstimate')),
      epsDifference: num(pick(h, 'epsDifference')),
      surprisePercent: num(pick(h, 'surprisePercent')),
      currency: str(h.currency),
    };
  });
  out.sort((a, b) => (a.quarterAt ?? 0) - (b.quarterAt ?? 0));
  return out;
}

/* ================================================================ ratings */

export interface RatingBucket {
  /** Provider period token: `0m` (current), `-1m`, `-2m`, `-3m`. */
  period: string;
  strongBuy: number | null;
  buy: number | null;
  hold: number | null;
  sell: number | null;
  strongSell: number | null;
}

export interface RatingsPayload {
  /** Distribution buckets, oldest→newest is not defined; provider order kept. */
  buckets: RatingBucket[];
  /** Weighted mean recommendation (1 = strong buy … 5 = strong sell). */
  recommendationMean: number | null;
  /** Provider's own verdict word (`buy`, `hold`, …) — an enum, not prose. */
  recommendationKey: string | null;
  numberOfAnalystOpinions: number | null;
  targetLow: number | null;
  targetMean: number | null;
  targetMedian: number | null;
  targetHigh: number | null;
  /** Live price the target is compared against, when the provider supplies it. */
  currentPrice: number | null;
}

/** Parse `recommendationTrend` + `financialData` into one ratings block. */
export function parseRatings(json: unknown): RatingsPayload {
  const buckets: RatingBucket[] = arr(pick(module(json, 'recommendationTrend'), 'trend')).map((b) => ({
    period: str(b.period) ?? '',
    strongBuy: num(b.strongBuy),
    buy: num(b.buy),
    hold: num(b.hold),
    sell: num(b.sell),
    strongSell: num(b.strongSell),
  }));
  const fd = module(json, 'financialData');
  return {
    buckets,
    recommendationMean: num(pick(fd, 'recommendationMean')),
    recommendationKey: str(pick(fd, 'recommendationKey')),
    numberOfAnalystOpinions: num(pick(fd, 'numberOfAnalystOpinions')),
    targetLow: num(pick(fd, 'targetLowPrice')),
    targetMean: num(pick(fd, 'targetMeanPrice')),
    targetMedian: num(pick(fd, 'targetMedianPrice')),
    targetHigh: num(pick(fd, 'targetHighPrice')),
    currentPrice: num(pick(fd, 'currentPrice')),
  };
}

/** One analyst action from `upgradeDowngradeHistory`. */
export interface RatingAction {
  at: number | null;
  dateLabel: string | null;
  firm: string | null;
  fromGrade: string | null;
  toGrade: string | null;
  action: string | null;
  priceTargetAction: string | null;
  currentPriceTarget: number | null;
  priorPriceTarget: number | null;
}

/**
 * Parse `upgradeDowngradeHistory`, newest first and capped.
 *
 * The raw module carries ~980 rows for a mega-cap — the largest single payload
 * in the whole API. The UI shows a short recent list, so the cap belongs here
 * (one place, testable) rather than in the component.
 */
export function parseUpgrades(json: unknown, limit = 25): RatingAction[] {
  const history = arr(pick(module(json, 'upgradeDowngradeHistory'), 'history'));
  const out = history
    .map((h) => {
      const at = num(h.epochGradeDate);
      return {
        at,
        dateLabel: at === null ? null : new Date(at * 1000).toISOString().slice(0, 10),
        firm: str(h.firm),
        fromGrade: str(h.fromGrade),
        toGrade: str(h.toGrade),
        action: str(h.action),
        priceTargetAction: str(h.priceTargetAction),
        currentPriceTarget: num(h.currentPriceTarget),
        priorPriceTarget: num(h.priorPriceTarget),
      };
    })
    .filter((a) => a.at !== null && (a.firm !== null || a.toGrade !== null))
    .sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
  return limit > 0 ? out.slice(0, limit) : out;
}

/* ============================================================ price target */

export interface PriceTargetView {
  low: number | null;
  mean: number | null;
  median: number | null;
  high: number | null;
  /** Percentage upside of the mean target vs the current price, or null. */
  upsidePct: number | null;
  analysts: number | null;
}

/**
 * Target band plus the upside it implies.
 *
 * Upside needs *both* the target and the live price; either one missing gives
 * null rather than a percentage computed against an assumed price.
 */
export function priceTargetView(
  ratings: RatingsPayload,
  price: number | null,
): PriceTargetView {
  const p = ratings.currentPrice ?? price;
  const upside =
    ratings.targetMean !== null && p !== null && p > 0
      ? (ratings.targetMean - p) / p
      : null;
  return {
    low: ratings.targetLow,
    mean: ratings.targetMean,
    median: ratings.targetMedian,
    high: ratings.targetHigh,
    upsidePct: upside,
    analysts: ratings.numberOfAnalystOpinions,
  };
}

/* ======================================================== earnings matrix */

export type MatrixCellKind = 'money' | 'perShare';

/** One metric row of the "forecast vs last actual" matrix. */
export interface MatrixRow {
  /** Dictionary key for the row label. */
  labelKey: string;
  kind: MatrixCellKind;
  /** Last reported actual for this metric, or null. */
  actual: number | null;
  /** Provider consensus for the upcoming period, or null. */
  forecast: number | null;
  /** `(forecast − actual)/|actual|`, or null. */
  growth: number | null;
  /** True when the provider simply does not publish an estimate for this row. */
  noEstimateUpstream: boolean;
  /**
   * The period basis of BOTH `actual` and `forecast`. Always `quarter` for the
   * §C.4 matrix: a quarterly forecast must only ever be compared against a
   * quarterly actual. Carried on the row so the UI (and the harness) can state
   * and check the basis instead of assuming it.
   */
  basis: 'quarter';
  /** Date label of the quarter the actual came from (e.g. `2026-09-30`). */
  asOf: string | null;
}

/**
 * Growth between an actual and a forecast.
 *
 * Both sides must exist and the base must be non-zero: a growth rate against a
 * zero base is undefined, and printing `Infinity%` or `0%` would both be lies.
 */
export function growthBetween(actual: number | null, forecast: number | null): number | null {
  if (actual === null || forecast === null) return null;
  if (actual === 0 || !Number.isFinite(actual) || !Number.isFinite(forecast)) return null;
  const g = (forecast - actual) / Math.abs(actual);
  return Number.isFinite(g) ? g : null;
}

/**
 * Build the §C.4 matrix: **next-period forecast vs last actual**, for the
 * metrics Yahoo actually carries.
 *
 * Yahoo's estimate block covers **EPS and revenue only**. EBITDA and EBIT
 * forecasts do **not** exist upstream — those rows are emitted with
 * `noEstimateUpstream: true` so the UI renders the actual plus an honest `—`,
 * with the reason stated, instead of an invented estimate.
 */
export function buildForecastMatrix(args: {
  forecast: EstimatePeriod | null;
  /**
   * The latest **reported quarter's** figures. The caller must pass quarterly
   * actuals or nulls — never an annual / trailing-twelve-month figure, which is
   * a different period and would turn the growth column into a fabricated
   * change (§C.4).
   */
  actual: { revenue: number | null; ebitda: number | null; ebit: number | null; dilutedEps: number | null };
  /** Date label of the quarter the actuals came from, or null when unknown. */
  asOf?: string | null;
}): MatrixRow[] {
  const { forecast, actual } = args;
  const asOf = args.asOf ?? null;

  const epsForecast = forecast?.eps.avg ?? null;
  const revenueForecast = forecast?.revenue.avg ?? null;

  const rows: MatrixRow[] = [
    {
      labelKey: 'pf.matrix.revenue',
      kind: 'money',
      actual: actual.revenue,
      forecast: revenueForecast,
      growth: growthBetween(actual.revenue, revenueForecast),
      noEstimateUpstream: revenueForecast === null,
      basis: 'quarter',
      asOf,
    },
    {
      labelKey: 'pf.matrix.ebitda',
      kind: 'money',
      actual: actual.ebitda,
      forecast: null,
      growth: null,
      // Not carried by Yahoo's estimate block for any symbol — not a gap in our
      // request, a gap upstream. Said plainly rather than rendered as a blank.
      noEstimateUpstream: true,
      basis: 'quarter',
      asOf,
    },
    {
      labelKey: 'pf.matrix.ebit',
      kind: 'money',
      actual: actual.ebit,
      forecast: null,
      growth: null,
      noEstimateUpstream: true,
      basis: 'quarter',
      asOf,
    },
    {
      labelKey: 'pf.matrix.eps',
      kind: 'perShare',
      actual: actual.dilutedEps,
      forecast: epsForecast,
      growth: growthBetween(actual.dilutedEps, epsForecast),
      noEstimateUpstream: epsForecast === null,
      basis: 'quarter',
      asOf,
    },
  ];
  return rows;
}

/**
 * The four real estimate periods as a matrix, plus honest placeholders for the
 * years the provider does not carry.
 *
 * `extraYears` is deliberately a *count of generic columns* headed FY+2/FY+3 by
 * the UI: inventing a date for a period the provider never sent would violate
 * §A.5 (never silently relabel / fabricate a fiscal period).
 */
export interface PeriodMatrix {
  periods: EstimatePeriod[];
  /** How many further-year columns to render as `—`. */
  extraYears: number;
}

export function periodMatrix(periods: EstimatePeriod[], extraYears = 2): PeriodMatrix {
  return { periods: periods.filter((p) => !sideEmpty(p.eps) || !sideEmpty(p.revenue)), extraYears };
}

/* ============================================================ forward level */

/**
 * How a forward level was arrived at — the UI states it, so the number is
 * never mistaken for a figure the provider published itself.
 *
 *  - `quarters` — the sum of the published quarterly consensus.
 *  - `fy` — a published fiscal-year consensus, used when the quarters are absent.
 */
export type ForwardBasis = 'quarters' | 'fy';

export interface ForwardLevel {
  eps: number | null;
  revenue: number | null;
  /** The periods the sum was taken from, in order (`['0q', '+1q']`). */
  quarters: EstimatePeriodId[];
  basis: ForwardBasis | null;
}

/**
 * The single forward **level** to plot against the price (§C.4).
 *
 * This is deliberately *not* called a rolling NTM. Yahoo publishes two quarters
 * (`0q`, `+1q`) and two fiscal years (`0y`, `+1y`); a genuine twelve-month
 * forward sum would need the two quarters in between, which are not published,
 * and could only be obtained by subtracting a quarter from a fiscal year — an
 * inference, not a reported figure. So we publish:
 *
 *  - the sum of the two quarterly consensus figures, labelled as exactly that,
 *    when both exist; otherwise
 *  - the current fiscal-year consensus, labelled as a fiscal year.
 *
 * Never a partial sum: one published quarter out of two returns `null`, because
 * a half-year figure presented as a forward level would be badly misleading.
 */
export function forwardLevel(periods: readonly EstimatePeriod[]): ForwardLevel {
  const byId = new Map(periods.map((p) => [p.id, p]));
  const q0 = byId.get('0q') ?? null;
  const q1 = byId.get('+1q') ?? null;
  if (q0?.eps.avg !== null && q0?.eps.avg !== undefined && q1?.eps.avg !== null && q1?.eps.avg !== undefined) {
    const revenueOk = q0.revenue.avg !== null && q1.revenue.avg !== null;
    return {
      eps: q0.eps.avg + q1.eps.avg,
      revenue: revenueOk ? (q0.revenue.avg ?? 0) + (q1.revenue.avg ?? 0) : null,
      quarters: ['0q', '+1q'],
      basis: 'quarters',
    };
  }
  const fy = byId.get('0y') ?? null;
  if (fy && (fy.eps.avg !== null || fy.revenue.avg !== null)) {
    return { eps: fy.eps.avg, revenue: fy.revenue.avg, quarters: [], basis: 'fy' };
  }
  return { eps: null, revenue: null, quarters: [], basis: null };
}

/**
 * A price multiple: `price ÷ per-share estimate`, or `EV ÷ revenue`, or null.
 *
 * A non-positive denominator gives `null` rather than a negative or infinite
 * multiple — a loss-making consensus has no P/E, and quoting one would be worse
 * than quoting nothing.
 */
export function priceMultiple(price: number | null, perShare: number | null): number | null {
  if (price === null || perShare === null || !Number.isFinite(price) || !Number.isFinite(perShare)) return null;
  if (perShare <= 0 || price <= 0) return null;
  const v = price / perShare;
  return Number.isFinite(v) ? v : null;
}

/** `EV ÷ revenue estimate`, or null (same guards as `priceMultiple`). */
export function evMultiple(ev: number | null, revenue: number | null): number | null {
  if (ev === null || revenue === null || !Number.isFinite(ev) || !Number.isFinite(revenue)) return null;
  if (revenue <= 0) return null;
  const v = ev / revenue;
  return Number.isFinite(v) ? v : null;
}
