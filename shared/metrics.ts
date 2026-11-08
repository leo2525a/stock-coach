/**
 * Derived financial metrics (SPEC-PHASE3 §A.3).
 *
 * The rule that governs this whole file: **a metric is a computed fact, and a
 * computed fact must never masquerade as a reported one.** Two consequences:
 *
 * 1. Every function returns `number | null`. If any input is missing the answer
 *    is `null`, which the UI renders as `—`. It is never `0`, never `NaN`,
 *    never `Infinity` — a `0` P/E reads as a real valuation.
 * 2. Every metric carries its `formulaKey`, so the UI can show the arithmetic
 *    on hover. A number the user cannot trace is a number they cannot trust.
 *
 * Division by zero (a company with no debt, no interest, no revenue) is treated
 * as "not applicable" (`null`), not as infinity. A debt-free company has *no*
 * net-debt/EBITDA ratio; it does not have a ratio of ∞.
 */

import type { MetricInputs } from './statements';

/** A computed metric: the value plus everything needed to explain it. */
export interface Metric {
  /** Stable id, e.g. `ev`. Used for test ids and ordering. */
  id: string;
  /** Dictionary key for the label. */
  labelKey: string;
  /** `x` = multiple (13.2x), `pct` = percent (48.8%), `money` = compact cash. */
  kind: 'x' | 'pct' | 'money' | 'ratio';
  /** Dictionary key for the formula shown on hover. */
  formulaKey: string;
  /** The computed value, or null when an input is missing. */
  value: number | null;
}

/** All inputs finite and non-null, else null. */
function need(...values: Array<number | null | undefined>): number[] | null {
  const out: number[] = [];
  for (const v of values) {
    if (v === null || v === undefined || !Number.isFinite(v)) return null;
    out.push(v);
  }
  return out;
}

/** `a / b`, or null when `b` is 0/absent (a 0 denominator is "n/a", not ∞). */
function ratio(a: number | null, b: number | null): number | null {
  const v = need(a, b);
  if (!v) return null;
  const [x, y] = v;
  if (y === 0) return null;
  const r = x / y;
  return Number.isFinite(r) ? r : null;
}

/** `a - b`, or null if either is missing. */
function diff(a: number | null, b: number | null): number | null {
  const v = need(a, b);
  return v ? v[0] - v[1] : null;
}

/** `a + b`. */
function sum(a: number | null, b: number | null): number | null {
  const v = need(a, b);
  return v ? v[0] + v[1] : null;
}

/**
 * Market capitalisation, derived rather than read.
 *
 * The provider publishes a market cap, but for the *statement* currency it must
 * agree with the balance sheet we are showing; deriving it from the diluted
 * share count × price keeps every number in one currency and makes the source
 * of the figure explicit. Null when either input is absent.
 */
export function marketCap(shares: number | null, price: number | null): number | null {
  const v = need(shares, price);
  if (!v) return null;
  return v[0] * v[1];
}

/** Enterprise value = market cap + total debt − cash & equivalents. */
export function enterpriseValue(mcap: number | null, totalDebt: number | null, cash: number | null): number | null {
  const v = need(mcap, totalDebt, cash);
  if (!v) return null;
  return v[0] + v[1] - v[2];
}

/** Net debt = total debt − cash. Can legitimately be negative (net cash). */
export function netDebt(totalDebt: number | null, cash: number | null): number | null {
  return diff(totalDebt, cash);
}

/**
 * NOPAT = EBIT × (1 − effective tax rate).
 *
 * The effective rate is `taxProvision / pretaxIncome` — the company's own, not
 * a statutory guess. When the tax provision is missing but pretax income is
 * present, we still refuse to invent a rate: NOPAT becomes null and every ROIC
 * that depends on it becomes `—`.
 */
export function nopat(ebit: number | null, pretaxIncome: number | null, taxProvision: number | null): number | null {
  const v = need(ebit, pretaxIncome, taxProvision);
  if (!v) return null;
  const [e, pre, tax] = v;
  if (pre === 0) return null;
  const rate = tax / pre;
  return e * (1 - rate);
}

/**
 * Invested capital = total debt + equity − cash.
 *
 * The SPEC's own definition; kept literally so the hover formula and the number
 * can never drift apart.
 */
export function investedCapital(
  totalDebt: number | null,
  equity: number | null,
  cash: number | null,
): number | null {
  const v = need(totalDebt, equity, cash);
  if (!v) return null;
  return v[0] + v[1] - v[2];
}

/** ROIC = NOPAT / invested capital. Null for a non-positive capital base. */
export function roic(nopatValue: number | null, invested: number | null): number | null {
  const v = need(nopatValue, invested);
  if (!v) return null;
  if (v[1] <= 0) return null;
  return v[0] / v[1];
}

/** A brand-new, all-null metric set for a given input bundle. */
function metric(
  id: string,
  labelKey: string,
  kind: Metric['kind'],
  formulaKey: string,
  value: number | null,
): Metric {
  return { id, labelKey, kind, formulaKey, value };
}

/** Everything the multiples panel shows. */
export interface DerivedMetrics {
  /** The reported as-of date behind the statement half of the ratios. */
  asOf: string | null;
  /** Currency of the statement figures. */
  currency: string | null;
  /** Market cap input we actually used (price × shares). */
  marketCap: number | null;
  ev: number | null;
  netDebt: number | null;
  items: Metric[];
}

/**
 * Build every metric in one pass.
 *
 * `price` is the live market price; `mcapOverride` lets the caller prefer the
 * provider's own market cap (which is in the *listing* currency) when the
 * statement currency matches it — see `phase3-service.ts`.
 */
export function deriveMetrics(
  inputs: MetricInputs,
  price: number | null,
  mcapOverride: number | null = null,
): DerivedMetrics {
  const mcap = mcapOverride ?? marketCap(inputs.sharesOutstanding, price);
  const ev = enterpriseValue(mcap, inputs.totalDebt, inputs.cash);
  const nd = netDebt(inputs.totalDebt, inputs.cash);
  const ebitda = inputs.ebitda;
  const ebit = inputs.ebit;
  const revenue = inputs.revenue;
  const equity = inputs.stockholdersEquity;
  const totalDebt = inputs.totalDebt;
  const cash = inputs.cash;
  const capex = inputs.capitalExpenditure;

  const np = nopat(ebit, inputs.pretaxIncome, inputs.taxProvision);
  const invested = investedCapital(totalDebt, equity, cash);

  const items: Metric[] = [
    // --- multiples ------------------------------------------------------
    metric('pe', 'pf.mult.pe', 'x', 'pf.formula.pe', ratio(safeAbs(price), inputs.dilutedEps)),
    metric('pb', 'pf.mult.pb', 'x', 'pf.formula.pb', ratio(safeAbs(mcap), equity)),
    metric('ps', 'pf.mult.ps', 'x', 'pf.formula.ps', ratio(mcap, revenue)),
    metric('evRevenue', 'pf.mult.evRevenue', 'x', 'pf.formula.evRevenue', ratio(ev, revenue)),
    metric('evEbitda', 'pf.mult.evEbitda', 'x', 'pf.formula.evEbitda', ratio(ev, ebitda)),
    metric('evEbit', 'pf.mult.evEbit', 'x', 'pf.formula.evEbit', ratio(ev, ebit)),

    // --- profitability --------------------------------------------------
    metric('grossMargin', 'pf.prof.grossMargin', 'pct', 'pf.formula.grossMargin', ratio(inputs.grossProfit, revenue)),
    metric('operatingMargin', 'pf.prof.operatingMargin', 'pct', 'pf.formula.operatingMargin', ratio(inputs.operatingIncome, revenue)),
    metric('netMargin', 'pf.prof.netMargin', 'pct', 'pf.formula.netMargin', ratio(inputs.netIncome, revenue)),
    metric('ebitdaMargin', 'pf.prof.ebitdaMargin', 'pct', 'pf.formula.ebitdaMargin', ratio(ebitda, revenue)),
    metric('roe', 'pf.prof.roe', 'pct', 'pf.formula.roe', ratio(inputs.netIncome, equity)),
    metric('roa', 'pf.prof.roa', 'pct', 'pf.formula.roa', ratio(inputs.netIncome, inputs.totalAssets)),
    metric('roic', 'pf.prof.roic', 'pct', 'pf.formula.roic', roic(np, invested)),

    // --- solvency -------------------------------------------------------
    metric('debtToEquity', 'pf.solv.debtToEquity', 'ratio', 'pf.formula.debtToEquity', ratio(totalDebt, equity)),
    metric('ltDebtToEquity', 'pf.solv.ltDebtToEquity', 'ratio', 'pf.formula.ltDebtToEquity', ratio(inputs.longTermDebt, equity)),
    metric('debtToCapital', 'pf.solv.debtToCapital', 'pct', 'pf.formula.debtToCapital', ratio(totalDebt, sum(totalDebt, equity))),
    metric('liabToAssets', 'pf.solv.liabToAssets', 'pct', 'pf.formula.liabToAssets', ratio(inputs.totalLiabilities, inputs.totalAssets)),
    metric('currentRatio', 'pf.solv.currentRatio', 'ratio', 'pf.formula.currentRatio', ratio(inputs.currentAssets, inputs.currentLiabilities)),
    metric('ebitToInterest', 'pf.solv.ebitToInterest', 'x', 'pf.formula.ebitToInterest', ratio(ebit, inputs.interestExpense)),
    metric('ebitdaToInterest', 'pf.solv.ebitdaToInterest', 'x', 'pf.formula.ebitdaToInterest', ratio(ebitda, inputs.interestExpense)),
    metric('debtToEbitda', 'pf.solv.debtToEbitda', 'x', 'pf.formula.debtToEbitda', ratio(totalDebt, ebitda)),
    metric('netDebtToEbitda', 'pf.solv.netDebtToEbitda', 'x', 'pf.formula.netDebtToEbitda', ratio(nd, ebitda)),
    metric(
      'debtToEbitdaCapex',
      'pf.solv.debtToEbitdaCapex',
      'x',
      'pf.formula.debtToEbitdaCapex',
      // Capex is reported negative (an outflow); the formula wants the magnitude
      // because it is *subtracted* from EBITDA to reach free cash flow.
      ratio(totalDebt, diff(ebitda, safeAbs(capex))),
    ),
  ];

  return { asOf: inputs.asOf, currency: inputs.currency, marketCap: mcap, ev, netDebt: nd, items };
}

function safeAbs(v: number | null): number | null {
  if (v === null || !Number.isFinite(v)) return null;
  return Math.abs(v);
}

/** Format one metric for display. `null` → the caller's honest sentinel. */
export function formatMetricValue(metric: Metric, opts: {
  currency?: string;
  compact: (v: number | null) => string;
  num: (v: number | null, digits?: number) => string;
  noData: string;
}): string {
  const { value, kind } = metric;
  if (value === null || !Number.isFinite(value)) return opts.noData;
  switch (kind) {
    case 'x':
      return `${opts.num(value, 2)}x`;
    case 'pct':
      return `${opts.num(value * 100, 2)}%`;
    case 'money':
      return opts.currency ? `${opts.compact(value)} ${opts.currency}` : opts.compact(value);
    case 'ratio':
      return opts.num(value, 2);
    default:
      return opts.noData;
  }
}
