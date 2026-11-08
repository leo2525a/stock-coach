import type { Interval } from './types';

/**
 * Display-only currency conversion (SPEC-PHASE3 §A.4).
 *
 * The rule the spec sets is narrow and this file obeys it literally:
 *
 * - The **source currency never leaves the payload**. Every converted number is
 *   a *second view* of the same fact, rendered beside the original.
 * - The **rate and its timestamp are shown** whenever a conversion is in play,
 *   so the user can see the arithmetic and its age.
 * - When a rate is unavailable the display **falls back to the source
 *   currency** and says so — it never silently converts at a stale or assumed
 *   rate, and never converts a rate it does not have.
 *
 * Yahoo's FX pairs are quoted `XXXUSD=X`: `HKDUSD=X` = USD per 1 HKD,
 * `EURUSD=X` = USD per 1 EUR. That is why converting *to* USD multiplies, and
 * converting *from* USD divides. Getting this backwards would produce a
 * plausible-looking but wrong number — the worst possible failure — so both
 * directions are spelled out and unit-tested.
 */

/** A rate table: `code → USD per 1 unit of code`. */
export interface FxTable {
  /** USD per 1 unit, e.g. `{USD: 1, HKD: 0.1275, EUR: 1.1178, CNY: 0.1499}`. */
  perUsd: Record<string, number>;
  /** UNIX seconds of the freshest rate in the table, or null. */
  asOf: number | null;
  /** True when no rate could be fetched at all. */
  unavailable: boolean;
}

/** The currencies the app offers as a display target. USD is the default. */
export const DISPLAY_CURRENCIES = ['USD', 'HKD', 'CNY', 'EUR', 'GBP', 'JPY'] as const;
export type DisplayCurrency = (typeof DISPLAY_CURRENCIES)[number];

/** The default display currency (SPEC-PHASE3 §A.4). */
export const DEFAULT_DISPLAY_CURRENCY: string = 'USD';

/** Yahoo FX pair symbols for `USD → X`. Built once, pure data. */
export const FX_SYMBOLS: Record<string, string> = {
  HKD: 'USDHKD=X', // 1 USD in HKD (7.84)
  CNY: 'USDCNY=X', // 1 USD in CNY (6.67)
  EUR: 'EURUSD=X', // 1 EUR in USD (1.12)
  GBP: 'GBPUSD=X', // 1 GBP in USD (1.34)
  JPY: 'JPYUSD=X', // 1 JPY in USD (0.0063)
};

/**
 * Convert a USD-per-unit quote (the `XXXUSD=X` convention) into
 * "USD per 1 unit of `code`".
 *
 * USD is the pivot and is always 1. A quote ≤ 0 is rejected: a zero rate would
 * make every converted figure 0.
 */
export function usdPerUnit(code: string, quote: number | null): number | null {
  if (code === 'USD') return 1;
  if (quote === null || !Number.isFinite(quote) || quote <= 0) return null;
  if (code === 'HKD' || code === 'CNY' || code === 'JPY') {
    // `USDHKD=X` is *HKD per USD*, so invert it to get USD per HKD.
    return 1 / quote;
  }
  // `EURUSD=X` / `GBPUSD=X` are already USD per unit.
  return quote;
}

/** One converted amount, with everything needed to explain and date it. */
export interface Conversion {
  /** The number to display. Equals `amount` when no conversion applied. */
  amount: number | null;
  /** The currency `amount` is expressed in. */
  currency: string;
  /** The original currency; differs from `currency` only when converted. */
  sourceCurrency: string;
  /** The rate used (target per 1 source), or null when none was applied. */
  rate: number | null;
  /** UNIX seconds of the rate, or null. */
  rateAt: number | null;
  /** True when we wanted to convert but had to fall back to the source. */
  fellBack: boolean;
}

/**
 * Convert `amount` from `from` to `to` using the table.
 *
 * Every degenerate case is an explicit branch:
 * - same currency → unchanged, no rate.
 * - unknown currency, missing rate, or zero rate → **fall back**, `fellBack`.
 * - non-finite / null amount → null, and the caller prints `—`.
 */
export function convert(
  amount: number | null,
  from: string | null,
  to: string,
  table: FxTable | null,
): Conversion {
  const source = (from ?? '').toUpperCase();
  const target = to.toUpperCase();
  const base: Conversion = {
    amount: amount === null || !Number.isFinite(amount) ? null : amount,
    currency: source || target,
    sourceCurrency: source || target,
    rate: null,
    rateAt: null,
    fellBack: false,
  };
  if (amount === null || !Number.isFinite(amount)) return { ...base, currency: target, fellBack: false };
  if (!source || source === target) return { ...base, currency: target };

  const fromPerUsd = table && !table.unavailable ? table.perUsd[source] : undefined;
  const toPerUsd = table && !table.unavailable ? table.perUsd[target] : undefined;
  if (fromPerUsd === undefined || toPerUsd === undefined || fromPerUsd <= 0 || toPerUsd <= 0) {
    // Honest fallback: show the figure in the currency we actually have.
    return { ...base, currency: source, fellBack: true };
  }
  // USD-per-source ÷ USD-per-target = target per source.
  const rate = fromPerUsd / toPerUsd;
  if (!Number.isFinite(rate) || rate <= 0) return { ...base, currency: source, fellBack: true };
  return {
    amount: amount * rate,
    currency: target,
    sourceCurrency: source,
    rate,
    rateAt: table?.asOf ?? null,
    fellBack: false,
  };
}

/**
 * The rate table Yahoo can actually be asked for, given the currencies in play.
 *
 * Returned as `code → FX pair symbol` so the caller fetches exactly what it
 * needs and nothing more.
 */
export function fxSymbolsFor(codes: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const code of codes) {
    const upper = code.toUpperCase();
    if (FX_SYMBOLS[upper]) out[upper] = FX_SYMBOLS[upper];
  }
  return out;
}

/** Range span codes for the price-target chart (§C.5), real price history only. */
export const SPANS = ['mtd', '1m', 'qtd', '3m', '6m', 'ytd', '1y', '3y', '5y', '10y'] as const;
export type Span = (typeof SPANS)[number];

/** Interval Yahoo serves for each span — long spans need coarser bars. */
export const SPAN_INTERVAL: Record<Span, Interval> = {
  mtd: '1d',
  '1m': '1d',
  qtd: '1d',
  '3m': '1d',
  '6m': '1d',
  ytd: '1d',
  '1y': '1d',
  '3y': '1w',
  '5y': '1w',
  '10y': '1mo',
};

const DAY = 86400;

/**
 * Start of the window for a span, as UNIX seconds, given "now".
 *
 * Calendar-relative spans (MTD/QTD/YTD) use the real boundary rather than an
 * approximation: "month to date" that actually starts mid-previous-month would
 * be a quiet lie about what the user is looking at.
 */
export function spanStart(span: Span, now: number): number {
  const d = new Date(now * 1000);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  switch (span) {
    case 'mtd':
      return Math.floor(Date.UTC(y, m, 1) / 1000);
    case 'qtd':
      return Math.floor(Date.UTC(y, Math.floor(m / 3) * 3, 1) / 1000);
    case 'ytd':
      return Math.floor(Date.UTC(y, 0, 1) / 1000);
    case '1m':
      return now - 30 * DAY;
    case '3m':
      return now - 91 * DAY;
    case '6m':
      return now - 182 * DAY;
    case '1y':
      return now - 365 * DAY;
    case '3y':
      return now - 3 * 365 * DAY;
    case '5y':
      return now - 5 * 365 * DAY;
    case '10y':
      return now - 10 * 365 * DAY;
    default:
      return now - 365 * DAY;
  }
}

/** Yahoo `range` string for a span (used by the chart endpoint). */
export function spanRange(span: Span): string {
  switch (span) {
    case 'mtd':
      return '1mo';
    case '1m':
      return '1mo';
    case 'qtd':
      return '3mo';
    case '3m':
      return '3mo';
    case '6m':
      return '6mo';
    case 'ytd':
      return '1y';
    case '1y':
      return '1y';
    case '3y':
      return '3y';
    case '5y':
      return '5y';
    case '10y':
      return '10y';
    default:
      return '1y';
  }
}
