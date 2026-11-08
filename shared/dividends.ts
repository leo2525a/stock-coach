/**
 * Pure mapping/derivation layer for Phase 4 dividends (SPEC-PHASE4 §A).
 *
 * Everything here is pure — no network, no clock, no database — so every rule in
 * the spec is unit-testable against captured payloads. The I/O lives in
 * `server/dividends-service.ts`; every arithmetic and honesty decision lives
 * here.
 *
 * The rules this file exists to enforce, each one learned from a *live* probe
 * (`RECON-PHASE4.md`), not from documentation:
 *
 * 1. **A missing number is `null`, never `0`.** `quoteSummary` intermittently
 *    returns an envelope with no `quoteSummary` key at all; a zero would read as
 *    "this company pays no dividend", which is a different and false statement
 *    (§A.7, §11).
 * 2. **Units are normalised explicitly.** `summaryDetail.dividendYield` is a
 *    *fraction* (0.0221) while `fiveYearAvgDividendYield` is a *percent* (2.83)
 *    and `payoutRatio` is sometimes one and sometimes the other (AAPL 0.118 vs
 *    AGNC 72). When the unit cannot be resolved the value is `null` → `—`, never
 *    a number off by 100× (§A.5).
 * 3. **Payment frequency is derived twice and withheld on disagreement.** The
 *    arithmetic (`round(rate / lastDividendValue)`) and the chart-event spacing
 *    each break for a different class of payer (specials, splits, non-synchronous
 *    HK payers). Agreement is the only licence to publish (§A.3).
 * 4. **Growth excludes the current partial year and flags specials.** COST's
 *    2023 $10 special turns a 5Y growth of ~+9% into a fake −16.88%; the outlier
 *    is detected and excluded *with a note*, never silently averaged in (§A.2).
 * 5. **Absent data is a shape, not an error.** Announced/Record/Type are always
 *    `null`; Payable is next-payment-only; the pre-2015 yield line is
 *    `reconstructed` and labelled as such (§A.2, §A.4).
 */

/* ============================================================ provenance ==== */

/** Where a figure came from, so the UI can label reported vs computed (§A.3.1). */
export type Sourced<T> = {
  value: T | null;
  source: 'direct' | 'derived' | 'absent';
  note?: string;
};

export function absent<T>(note?: string): Sourced<T> {
  return note ? { value: null, source: 'absent', note } : { value: null, source: 'absent' };
}

export function direct<T>(value: T | null, note?: string): Sourced<T> {
  if (value === null || value === undefined) return absent<T>(note);
  return note ? { value, source: 'direct', note } : { value, source: 'direct' };
}

export function derived<T>(value: T | null, note?: string): Sourced<T> {
  if (value === null || value === undefined) return absent<T>(note);
  return note ? { value, source: 'derived', note } : { value, source: 'derived' };
}

/* ================================================================ numbers ==== */

/** `{ raw: n }` | `n` | `'1.5'` | `''` → number | null. Never 0-for-missing. */
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

function str(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const s = value.trim();
  return s ? s : null;
}

/** Container for `quoteSummary.result[0]`, or null when the envelope is empty. */
export function summaryResult(json: unknown): Record<string, unknown> | null {
  const r = (json as { quoteSummary?: { result?: Array<Record<string, unknown>> | null } } | null)
    ?.quoteSummary?.result?.[0];
  return r && typeof r === 'object' ? r : null;
}

/**
 * Did the provider answer with a *usable* `quoteSummary` envelope?
 *
 * The §A.7 failure mode is a root object with **no `quoteSummary` key at all**
 * (not a null `result`). Both map to "unavailable" here, and the caller retries
 * with a forced re-mint before giving up. This is deliberately a *shape* test,
 * not a "does it contain dividend numbers" test: an honest non-payer (TSLA)
 * carries modules and is usable; a hiccup carries nothing.
 */
export function hasQuoteSummary(json: unknown): boolean {
  const q = (json as { quoteSummary?: unknown } | null)?.quoteSummary;
  if (!q || typeof q !== 'object') return false;
  const result = (q as { result?: unknown }).result;
  return Array.isArray(result) && result.length > 0 && typeof result[0] === 'object' && result[0] !== null;
}

function mod(json: unknown, name: string): Record<string, unknown> | null {
  const r = summaryResult(json);
  const m = r?.[name];
  return m && typeof m === 'object' ? (m as Record<string, unknown>) : null;
}

function read(json: unknown, moduleName: string, key: string): unknown {
  return mod(json, moduleName)?.[key] ?? null;
}

/* ================================================================= units ===== */

/**
 * A value the provider publishes as *either* a fraction or a percent.
 *
 * `payoutRatio` is the documented offender: AAPL reports 0.118 (a fraction) and
 * AGNC reports 72 (a percent). The tie-breaker is arithmetic reality — a payout
 * ratio above 1 is possible (a company paying out more than it earns) but above
 * 2 is far more likely to be a percentage, and above 100 can *only* be one.
 *
 * Returns null when neither reading is defensible, so the caller renders `—`
 * rather than a figure that is wrong by a factor of 100.
 */
export function normalizeRatio(value: number | null, reference?: number | null): number | null {
  if (value === null || !Number.isFinite(value)) return null;

  // The provider publishes this field as a fraction for some issuers (AAPL
  // 0.118, KO 0.6195, O 2.2199) and as a percent for others (AGNC 72), and the
  // two readings overlap once the fraction exceeds 1 — O's *fraction* 2.2199
  // would read as a 2.2% payout, a 100× error. The provider's own identity
  // `payoutRatio = trailingAnnualDividendRate / trailingEps` gives the fraction
  // form independently (RECON §4.1, reproduced exactly by probe16), so prefer
  // that to settle the scale, and refuse when it cannot.
  if (reference !== undefined && reference !== null && Number.isFinite(reference) && reference > 0) {
    const asFraction = Math.abs(value - reference) / reference <= 0.25;
    const asPercent = Math.abs(value / 100 - reference) / reference <= 0.25;
    if (asFraction && !asPercent) return value;
    if (asPercent && !asFraction) return value / 100;
    return null; // the cross-check cannot settle it: withhold rather than guess
  }

  if (value <= 2) return value; // already a fraction (0.118, 0.6195)
  if (value <= 1000) return value / 100; // a percent (72 → 0.72)
  return null; // neither reading is credible
}

/**
 * Percent → fraction, for the fields the provider documents as percentages.
 *
 * `fiveYearAvgDividendYield` is a percent (KO 2.83) and a *sibling* field
 * (`dividendYield`) is a fraction (0.0221) — reading the wrong one is a 100×
 * error, so the conversion is a named function rather than an inline `/100`.
 */
export function percentToFraction(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  return value / 100;
}

/* ============================================================== frequency ==== */

export const FREQUENCY_LABELS = [
  'annual',
  'semi-annual',
  'quarterly',
  'monthly',
  'biweekly',
  'weekly',
  'semi-monthly',
] as const;

export type FrequencyLabel = (typeof FREQUENCY_LABELS)[number];

/** Payments per year for each supported label (the canonical round-trip). */
export const PAYMENTS_PER_YEAR: Record<FrequencyLabel, number> = {
  annual: 1,
  'semi-annual': 2,
  quarterly: 4,
  monthly: 12,
  'semi-monthly': 24,
  biweekly: 26,
  weekly: 52,
};

/** The supported frequencies, nearest-first, used to snap an inferred count. */
export function frequencyFromPerYear(perYear: number | null): FrequencyLabel | null {
  if (perYear === null || !Number.isFinite(perYear) || perYear <= 0) return null;
  let best: FrequencyLabel | null = null;
  let bestErr = Infinity;
  for (const label of FREQUENCY_LABELS) {
    const err = Math.abs(PAYMENTS_PER_YEAR[label] - perYear);
    if (err < bestErr) {
      bestErr = err;
      best = label;
    }
  }
  // A monthly payer that infers 13/yr (MAIN) snaps to `monthly` (err 1) rather
  // than fabricating a "13/yr" frequency that does not exist.
  return bestErr <= 1.25 ? best : null;
}

export interface FrequencyDerivation {
  frequency: Sourced<FrequencyLabel>;
  /** The two independent readings, kept for the hover explanation and tests. */
  arithmeticPerYear: number | null;
  gapPerYear: number | null;
}

/** Median of a numeric list, or null when empty. */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Median gap between consecutive chart dividend dates, in days.
 *
 * Only gaps inside a plausible payment window are considered: a 20-year history
 * contains gaps of *years* (a suspension) and a same-day pair (a special paid
 * alongside the regular), and both would drag a median away from the true
 * cadence. Filtering to 5–200 days keeps the estimate about the normal cycle.
 */
export function medianGapDays(dates: readonly number[]): number | null {
  if (dates.length < 3) return null;
  const sorted = [...dates].sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i += 1) {
    const days = (sorted[i] - sorted[i - 1]) / 86400;
    if (days >= 5 && days <= 200) gaps.push(days);
  }
  return median(gaps);
}

/**
 * Derive the payment frequency from two independent methods, and publish it only
 * when they agree (§A.3, RECON §2).
 *
 * - **Arithmetic**: `round(dividendRate ÷ lastDividendValue)` — exact for a
 *   stable regular payer, meaningless without a `lastDividendValue` (TSLA/BRK-B).
 * - **Spacing**: `365 ÷ median(days between chart events)` — independent of the
 *   facts session, so it survives a crumb outage, but it is fooled by specials.
 *
 * A non-synchronous payer (0005.HK: arithmetic 31.4/yr, chart spacing 4/yr) is
 * precisely the case the spec says must render `—`. Disagreement is *not* a
 * failure to hide: it is reported in the note so the UI can explain the dash.
 */
export function deriveFrequency(
  annualRate: number | null,
  lastDividendValue: number | null,
  eventDates: readonly number[],
): FrequencyDerivation {
  const arithmeticRatio =
    annualRate !== null && lastDividendValue !== null && lastDividendValue > 0
      ? annualRate / lastDividendValue
      : null;
  const arithmeticPerYear = arithmeticRatio === null ? null : Math.round(arithmeticRatio);

  const gap = medianGapDays(eventDates);
  const gapPerYear = gap === null || gap === 0 ? null : Math.round(365 / gap);

  const a = frequencyFromPerYear(arithmeticPerYear);
  const b = frequencyFromPerYear(gapPerYear);
  const arithmeticAvailable = arithmeticRatio !== null;

  if (!arithmeticAvailable) {
    // No rate/last-value pair at all, so the spacing reading stands alone. It
    // must be labelled as such: the *reason* is a missing field, not agreement.
    if (b === null) {
      return { frequency: absent('note.dividendFrequencyUnknown'), arithmeticPerYear, gapPerYear };
    }
    return { frequency: derived(b, 'note.dividendFrequencySpacingOnly'), arithmeticPerYear, gapPerYear };
  }

  if (a === null) {
    // A ratio *was* computable but matches no real cadence — the premise of the
    // arithmetic method is broken for this symbol (0005.HK: 31.4, which is a
    // currency mismatch between `dividendRate` and the chart amount, not a
    // 31-a-year payer). Saying "no last-dividend value was published" here would
    // be false, so the disagreement is reported for what it is.
    return {
      frequency: absent(
        b === null ? 'note.dividendFrequencyUnknown' : 'note.dividendFrequencyDisagree',
      ),
      arithmeticPerYear,
      gapPerYear,
    };
  }
  if (b === null) {
    // Only the arithmetic reading exists (e.g. a short/sparse chart window).
    return { frequency: derived(a, 'note.dividendFrequencyArithmeticOnly'), arithmeticPerYear, gapPerYear };
  }
  if (a === b) {
    return { frequency: derived(a, 'note.dividendFrequencyDerived'), arithmeticPerYear, gapPerYear };
  }
  // Two credible methods that disagree: publish nothing rather than pick a side.
  return { frequency: absent('note.dividendFrequencyDisagree'), arithmeticPerYear, gapPerYear };
}

/* ================================================================= events ==== */

/** A dividend event as the chart endpoint publishes it (keys: amount, date). */
export interface RawDividendEvent {
  /** UNIX seconds — the chart's single date, which *is* the ex/pay date. */
  date: number;
  /** Per-share amount, already split-adjusted by the provider. */
  amount: number;
}

/**
 * Extract the chart's `events.dividends` map into a sorted list.
 *
 * The provider ships this as an object keyed by an opaque id, not an array; a
 * malformed entry is dropped rather than turned into a `0` payment (a zero
 * dividend would be a fabricated fact).
 */
export function parseDividendEvents(json: unknown): RawDividendEvent[] {
  const divs = (json as {
    chart?: { result?: Array<{ events?: { dividends?: Record<string, unknown> } }> | null };
  } | null)?.chart?.result?.[0]?.events?.dividends;
  if (!divs || typeof divs !== 'object') return [];
  const out: RawDividendEvent[] = [];
  for (const raw of Object.values(divs)) {
    const e = raw as { date?: unknown; amount?: unknown } | null;
    const date = num(e?.date);
    const amount = num(e?.amount);
    if (date === null || amount === null || amount <= 0) continue;
    out.push({ date, amount });
  }
  return out.sort((a, b) => a.date - b.date);
}

/** The chart `meta.currency` — the *only* honest currency for a dividend (§A.5.1). */
export function chartCurrency(json: unknown): string | null {
  const meta = (json as { chart?: { result?: Array<{ meta?: Record<string, unknown> }> | null } } | null)
    ?.chart?.result?.[0]?.meta;
  return str(meta?.currency);
}

/** Monthly closes from the chart, oldest→newest (used for reconstruction). */
export function chartCloses(json: unknown): Array<{ date: number; close: number }> {
  const r = (json as {
    chart?: {
      result?: Array<{ timestamp?: unknown; indicators?: { quote?: Array<{ close?: unknown }> } }> | null;
    };
  } | null)?.chart?.result?.[0];
  const ts = r?.timestamp;
  const close = r?.indicators?.quote?.[0]?.close;
  if (!Array.isArray(ts) || !Array.isArray(close)) return [];
  const out: Array<{ date: number; close: number }> = [];
  for (let i = 0; i < ts.length; i += 1) {
    const t = num(ts[i]);
    const c = num(close[i]);
    if (t === null || c === null || c <= 0) continue;
    out.push({ date: t, close: c });
  }
  return out.sort((a, b) => a.date - b.date);
}

/* ================================================================== facts ==== */

export interface DividendFacts {
  currency: Sourced<string>;
  /** Fraction (0.0221). `summaryDetail.dividendYield`. */
  indicatedYield: Sourced<number>;
  /** Fraction. `summaryDetail.trailingAnnualDividendYield`. */
  trailingYield: Sourced<number>;
  /** Derived `dividendRate ÷ price`; label it **indicated**, never "NTM". */
  forwardYield: Sourced<number>;
  /** Fraction after unit normalisation. `summaryDetail.payoutRatio`. */
  payoutRatioLtm: Sourced<number>;
  /** Percent ÷ 100. `summaryDetail.fiveYearAvgDividendYield`. */
  fiveYearAvgYield: Sourced<number>;
  /** `summaryDetail.dividendRate` — the annualised indicated rate. */
  annualRate: Sourced<number>;
  /** `defaultKeyStatistics.lastDividendValue`. */
  lastDividendValue: Sourced<number>;
  /** Epoch seconds of the *next* ex-date. */
  nextExDate: Sourced<number>;
  /** Epoch seconds of the *next* payment (`calendarEvents.dividendDate`). */
  nextPayDate: Sourced<number>;
  /** Derived; `null` when the two derivation methods disagree (§A.3). */
  frequency: Sourced<FrequencyLabel>;
}

/**
 * Map the dividend half of a `quoteSummary` answer into facts.
 *
 * `price` comes in as an argument because the `price` module is the least
 * reliable part of the envelope (RECON-PHASE3 §3) and the caller may have a
 * better one from the crumb-free chart. When it is missing, `forwardYield` is
 * `absent` — the other facts are unaffected.
 *
 * When the envelope is empty this returns an all-`absent` fact block: a caller
 * inspecting `currency.source` can tell "we could not ask" from "this company
 * pays nothing", which is the distinction §A.7 is entirely about.
 */
/**
 * §A.8 — the payable date must be strictly after its own ex-date.
 *
 * Both dates come from different provider fields and can disagree (AAPL: ex
 * 2026-11-12, pay 2026-08-13). Resolved once, here, so every consumer — the §C.6
 * facts table, the recap strip and the export — sees the same validated value.
 */
function reconciledNextPayDate(
  emptyEnvelope: boolean,
  exDate: number | null,
  payDate: number | null,
): Sourced<number> {
  if (emptyEnvelope) return absent('note.dividendFactsUnavailable');
  if (payDate === null) return direct<number>(null);
  if (exDate === null || dayOf(payDate) <= dayOf(exDate)) {
    return absent('note.dividendPayableBeforeEx');
  }
  return direct(payDate);
}

export function parseDividendFacts(
  json: unknown,
  price: number | null,
  eventDates: readonly number[],
): DividendFacts {
  const emptyEnvelope = !hasQuoteSummary(json);

  const currency = str(read(json, 'price', 'currency')) ?? str(read(json, 'summaryDetail', 'currency'));
  const indicatedYield = num(read(json, 'summaryDetail', 'dividendYield'));
  const trailingYield = num(read(json, 'summaryDetail', 'trailingAnnualDividendYield'));
  const annualRate = num(read(json, 'summaryDetail', 'dividendRate'));
  const payoutRaw = num(read(json, 'summaryDetail', 'payoutRatio'));
  const trailingRate = num(read(json, 'summaryDetail', 'trailingAnnualDividendRate'));
  const trailingEps = num(read(json, 'defaultKeyStatistics', 'trailingEps'));
  // The fraction-form cross-check for `payoutRatio` (see `normalizeRatio`).
  const payoutReference =
    trailingRate !== null && trailingEps !== null && trailingEps !== 0 ? trailingRate / trailingEps : null;
  const fiveYearAvgPercent = num(read(json, 'summaryDetail', 'fiveYearAvgDividendYield'));
  const lastDividendValue = num(read(json, 'defaultKeyStatistics', 'lastDividendValue'));
  const nextExDate =
    num(read(json, 'summaryDetail', 'exDividendDate')) ?? num(read(json, 'calendarEvents', 'exDividendDate'));
  const nextPayDate = num(read(json, 'calendarEvents', 'dividendDate'));
  // §A.5.1 / §A.8: `summaryDetail.dividendRate` arrives in the price's *major*
  // unit (GBP) while the chart/quotes are in its *minor* unit (GBp) for LSE
  // names — the same 100x hazard already reconciled for `lastDividendValue`.
  // The discriminator is the provider's *own* yield identity, like-for-like:
  // `annualRate ÷ price` must reproduce `dividendYield` when the rate is in the
  // quote's unit. It does for HKD/USD names; for LSE it is off by exactly 100
  // (1.56 ÷ 4930 = 0.00032 vs 0.0311), so the rate is reconciled ×100 or withheld.
  // `summaryDetail.currency` cannot be used for this — it reports "GBp" while the
  // rate itself is GBP (see RECON-PHASE4 §11).
  const hasYieldRef = indicatedYield !== null && indicatedYield > 0 && price !== null && price > 0;
  const annualReconciled = hasYieldRef
    ? reconcileScale(annualRate, [indicatedYield * price])
    : annualRate; // no like-for-like reference: trust the provider's figure. Latent
                  // limit (QA F2): an LSE name with `dividendYield` absent would
                  // then show a 100x-off rate — unreachable on every sampled
                  // live LSE symbol (all carry both fields).

  // Prefer the provider's own indicated yield, but only when it is *positive*.
  // A non-payer (TSLA, BRK-B) gets a literal `dividendYield: 0` and
  // `trailingAnnualDividendYield: 0` with no `dividendRate` at all — the zero is
  // the provider's way of saying "there is none", not a measured 0% yield. Shown
  // as `0%`, a non-payer would read as a payer with a terrible yield, which is
  // exactly the misreading SPEC §A.2/§A.5 says must render `—`.
  const positive = (v: number | null): number | null => (v !== null && v > 0 ? v : null);
  const indicated = positive(indicatedYield);
  const forwardYield =
    indicated !== null
      ? indicated
      : annualReconciled !== null && annualReconciled > 0 && price !== null && price > 0
        ? annualReconciled / price
        : null;

  const freq = deriveFrequency(annualRate, lastDividendValue, eventDates);
  const payoutNorm = payoutRaw === null ? null : normalizeRatio(payoutRaw, payoutReference);

  return {
    currency: emptyEnvelope ? absent('note.dividendFactsUnavailable') : direct(currency),
    indicatedYield:
      emptyEnvelope || indicated === null
        ? absent(emptyEnvelope ? 'note.dividendFactsUnavailable' : 'note.dividendNoDividend')
        : direct(indicated),
    trailingYield:
      emptyEnvelope || positive(trailingYield) === null
        ? absent(emptyEnvelope ? 'note.dividendFactsUnavailable' : 'note.dividendNoDividend')
        : direct(trailingYield),
    forwardYield:
      emptyEnvelope || forwardYield === null
        ? absent(emptyEnvelope ? 'note.dividendFactsUnavailable' : 'note.dividendIndicatedUnavailable')
        : derived(forwardYield, 'note.dividendForwardIsIndicated'),
    payoutRatioLtm:
      emptyEnvelope || payoutNorm === null || payoutNorm <= 0
        ? absent(emptyEnvelope ? 'note.dividendFactsUnavailable' : 'note.dividendNoDividend')
        : direct(payoutNorm, 'note.dividendPayoutNormalised'),
    fiveYearAvgYield:
      emptyEnvelope || fiveYearAvgPercent === null
        ? absent(emptyEnvelope ? 'note.dividendFactsUnavailable' : undefined)
        : direct(percentToFraction(fiveYearAvgPercent), 'note.dividendFiveYearPercentToFraction'),
    annualRate: emptyEnvelope
      ? absent('note.dividendFactsUnavailable')
      : annualRate === null
        ? direct<number>(null)
        : annualReconciled === null
          ? absent('note.dividendAmountScaleUnreconciled')
          : direct(
              annualReconciled,
              annualReconciled !== annualRate ? 'note.dividendAmountScaleUnreconciled' : undefined,
            ),
    lastDividendValue: emptyEnvelope ? absent('note.dividendFactsUnavailable') : direct(lastDividendValue),
    nextExDate: emptyEnvelope ? absent('note.dividendFactsUnavailable') : direct(nextExDate),
    // §A.8 monotonicity at the FACTS level, not only in the schedule path: the
    // ex-date and payable date are independent provider fields, so a payable
    // date on or before its own ex-date is impossible. Withhold it here too, so
    // §C.6 (and the export) render `—` and never disagree with §C.5.
    nextPayDate: reconciledNextPayDate(emptyEnvelope, nextExDate, nextPayDate),
    frequency: freq.frequency,
  };
}

/* ================================================================= growth ==== */

export interface DividendGrowth {
  consecutiveAnnualIncreases: Sourced<number>;
  growth1y: Sourced<number>;
  growth3y: Sourced<number>;
  growth5y: Sourced<number>;
  growth10y: Sourced<number>;
}

/** Annual dividend totals per calendar year of the ex-date. */
export function yearlyTotals(events: readonly RawDividendEvent[]): Map<number, number> {
  const out = new Map<number, number>();
  for (const e of events) {
    const year = new Date(e.date * 1000).getUTCFullYear();
    out.set(year, (out.get(year) ?? 0) + e.amount);
  }
  return out;
}

/**
 * Is this payment a special dividend rather than a regular one?
 *
 * There is no `type` flag anywhere upstream (RECON §11), so the only honest
 * detection is arithmetic: a payment many times the modal payment of its own
 * year, in a year whose total then sticks out against its neighbours. COST's
 * 2023 $10 special against a ~$1 quarterly regular is the canonical case — and
 * the one that turns 5Y growth from ≈ +9% into a fake −16.88%.
 *
 * Deliberately conservative: a *single* event ≥ `multiple` × the modal event of
 * the same year, where that year's total is itself ≥ `yearMultiple` × the median
 * of the other years. Both conditions must hold, so an ordinary annual increase
 * is never mistaken for a special.
 */
export function isOutlierYear(
  year: number,
  totals: Map<number, number>,
  amounts: readonly number[],
  multiple = 3,
  yearMultiple = 1.8,
): boolean {
  if (amounts.length === 0) return false;
  const sorted = [...amounts].sort((a, b) => a - b);
  const modal = sorted[Math.floor(sorted.length / 2)];
  if (modal <= 0) return false;
  const biggest = sorted[sorted.length - 1];
  if (biggest < multiple * modal) return false;

  const others = [...totals.keys()].filter((y) => y !== year).map((y) => totals.get(y)!);
  const otherMedian = median(others);
  const total = totals.get(year)!;
  return otherMedian !== null && otherMedian > 0 && total >= yearMultiple * otherMedian;
}

export interface AnnualSeries {
  /** Full years only — the current, partial year is excluded for growth (§A.3). */
  fullYears: number[];
  /** Calendar years in which a special was detected and excluded. */
  excludedYears: number[];
  /** Totals used for growth (specials removed), keyed by year. */
  totals: Map<number, number>;
}

/**
 * Build the annual totals used for growth, excluding the partial current year
 * and any year dominated by a detected special payment.
 */
export function annualSeries(events: readonly RawDividendEvent[], currentYear: number): AnnualSeries {
  const raw = yearlyTotals(events);
  const byYear = new Map<number, number[]>();
  for (const e of events) {
    const y = new Date(e.date * 1000).getUTCFullYear();
    byYear.set(y, [...(byYear.get(y) ?? []), e.amount]);
  }
  const totals = new Map<number, number>();
  const excludedYears: number[] = [];
  for (const [year, total] of raw) {
    if (year >= currentYear) continue; // partial year — never counted
    const amounts = byYear.get(year) ?? [];
    const special = amounts.length > 1 ? [...amounts].sort((a, b) => b - a)[0] : null;
    const regular = special !== null && isOutlierYear(year, raw, amounts) ? special : 0;
    if (regular > 0) excludedYears.push(year);
    totals.set(year, total - regular);
  }
  const fullYears = [...totals.keys()].sort((a, b) => a - b);
  return { fullYears, excludedYears, totals };
}

/**
 * Annualised growth `(Y_last / Y_last-N)^(1/N) − 1` over whole years.
 *
 * Returns `null` when the history does not reach back N years — a shorter window
 * is not a smaller growth figure, it is an unavailable one.
 */
/**
 * Annualised growth `(Y_last / Y_last-N)^(1/N) − 1` over whole years.
 *
 * Returns `null` when the history does not reach back N years — a shorter window
 * is not a smaller growth figure, it is an unavailable one. The base year is
 * selected by *calendar* year (`fullYears.at(-1) - N`), not by positional index
 * (§A.8): a gap in the year set must not let a shorter window masquerade as the
 * requested horizon.
 */
export function growthOver(series: AnnualSeries, years: number): number | null {
  const full = series.fullYears;
  if (full.length < 2) return null;
  const lastYear = full[full.length - 1];
  const baseYear = lastYear - years;
  if (!series.totals.has(baseYear)) return null;
  const last = series.totals.get(lastYear)!;
  const base = series.totals.get(baseYear)!;
  if (!(base > 0) || !(last > 0)) return null;
  const g = (last / base) ** (1 / years) - 1;
  return Number.isFinite(g) ? g : null;
}

/** Trailing count of strict year-over-year increases in the annual totals. */
export function consecutiveIncreases(series: AnnualSeries): number | null {
  const full = series.fullYears;
  if (full.length < 2) return null;
  let streak = 0;
  for (let i = full.length - 1; i > 0; i -= 1) {
    // Contiguous calendar years only (§A.8): a gap means the two totals are
    // not neighbours, so a 17-year suspension must break the streak rather
    // than be counted as one more increase.
    if (full[i] !== full[i - 1] + 1) break;
    const now = series.totals.get(full[i])!;
    const prev = series.totals.get(full[i - 1])!;
    if (now > prev) streak += 1;
    else break;
  }
  return streak;
}

/** Build the whole §A.6 growth block from chart events. */
export function deriveGrowth(events: readonly RawDividendEvent[], currentYear: number): DividendGrowth {
  const series = annualSeries(events, currentYear);
  const note =
    series.excludedYears.length > 0 ? 'note.dividendSpecialExcluded' : undefined;
  const streak = consecutiveIncreases(series);
  return {
    consecutiveAnnualIncreases:
      streak === null ? absent('note.dividendGrowthUnavailable') : derived(streak, note),
    growth1y: growthOver(series, 1) === null ? absent('note.dividendGrowthUnavailable') : derived(growthOver(series, 1)!, note),
    growth3y: growthOver(series, 3) === null ? absent('note.dividendGrowthUnavailable') : derived(growthOver(series, 3)!, note),
    growth5y: growthOver(series, 5) === null ? absent('note.dividendGrowthUnavailable') : derived(growthOver(series, 5)!, note),
    growth10y: growthOver(series, 10) === null ? absent('note.dividendGrowthUnavailable') : derived(growthOver(series, 10)!, note),
  };
}

/* ================================================================== spans ==== */

export const DIVIDEND_SPANS = ['1y', '3y', '5y', '10y', '20y', 'ALL'] as const;
export type DividendSpan = (typeof DIVIDEND_SPANS)[number];

export const SPAN_DAYS: Record<Exclude<DividendSpan, 'ALL'>, number> = {
  '1y': 365,
  '3y': 3 * 365,
  '5y': 5 * 365,
  '10y': 10 * 365,
  '20y': 20 * 365,
};

export function isDividendSpan(value: string): value is DividendSpan {
  return (DIVIDEND_SPANS as readonly string[]).includes(value);
}

/**
 * The `period1`/`period2` window for a span.
 *
 * **Never `range=max`** (§A.1.2): Yahoo's `max` silently drops whole years of
 * dividend events behind a plausible-looking histogram (KO `max` returned 169
 * events with *zero* in the 2010s). Explicit windows returned 258 contiguous
 * events back to 1962 for the same symbol.
 */
export function spanWindow(span: DividendSpan, now: number): { period1: number; period2: number } {
  if (span === 'ALL') {
    // ~60 years: the deepest window the provider sustains, and deeper than any
    // dividend history that exists in practice (KO/IBM reach 1962–1967).
    return { period1: now - 60 * 365 * 86400, period2: now + 86400 };
  }
  return { period1: now - SPAN_DAYS[span] * 86400, period2: now + 86400 };
}

/* ============================================================== schedule ==== */

/** One row of the payout schedule (§C.5), with the honest dashes baked in. */
export interface DividendScheduleRow {
  exDate: number;
  /** ABSENT upstream — always null. */
  announcedDate: null;
  /** ABSENT upstream — always null. */
  recordDate: null;
  /** Only ever set on the *next* payment, from `calendarEvents.dividendDate`. */
  payableDate: number | null;
  currency: string;
  amount: number;
  /** The chart amount is already split-adjusted; there is no second field. */
  adjAmount: number;
  frequency: FrequencyLabel | null;
  /** ABSENT upstream — guessing "regular" would mislabel COST/CBRL specials. */
  type: null;
}

/** Whole-day bucket (UTC), the only granularity two sources agree on (§A.8). */
export function dayOf(seconds: number): number {
  return Math.floor(seconds / 86400);
}

/**
 * The one upcoming payment, already reconciled (§A.8).
 *
 * `payDate` has been validated to be on or after `exDate`; when the provider's
 * pair is impossible it is `null` and the cell renders `—` rather than a date
 * that cannot be true. `amount` is already in the span's chart unit.
 */
export interface UpcomingPayment {
  exDate: number;
  amount: number;
  payDate: number | null;
}

/**
 * Reconcile a provider figure to the unit its own series is published in.
 *
 * The chart (`meta.currency`, e.g. GBp) and the facts session (GBP) can
 * disagree by a factor of 100, and some fields are fractional for no stated
 * reason (0005.HK). A ratio is accepted only when the result lands within 2x of
 * the series' recent median; a pence/pound (100x) or a fractional-figure (7.8x)
 * mismatch stays rejected and renders `—`. Never invent a scale.
 */
export function reconcileScale(amount: number | null, recent: readonly number[]): number | null {
  if (amount === null) return null;
  const positives = recent.filter((a) => Number.isFinite(a) && a > 0);
  const mid = positives.length > 0 ? median(positives) : null;
  if (mid === null || mid <= 0) return amount;
  const ratio = amount / mid;
  for (const factor of [1, 100, 0.01]) {
    const scaled = ratio / factor;
    if (scaled >= 0.5 && scaled <= 2) return amount / factor;
  }
  return null;
}


/**
 * The upcoming payment as a schedule element, or null when it cannot be shown
 * honestly. `exDate` and `payDate` are independently sourced, so the payable
 * date is validated against the ex-date (§A.8). `amount` is reconciled to the
 * series unit (the recent chart amounts) or withheld when the scale is unknown.
 */
export function upcomingPayment(facts: DividendFacts, recentAmounts: readonly number[]): UpcomingPayment | null {
  const exDate = facts.nextExDate.value;
  const amount = reconcileScale(facts.lastDividendValue.value, recentAmounts);
  if (exDate === null || amount === null || amount <= 0) return null;
  const raw = facts.nextPayDate.value;
  const payDate = raw !== null && dayOf(raw) > dayOf(exDate) ? raw : null;
  return { exDate, amount, payDate };
}

/**
 * Build the schedule rows for a span.
 *
 * The schedule is a *set of payments* (§A.8): the upcoming payment is merged
 * into an existing row when it falls on the same **calendar day** as a chart
 * event (the chart is stamped 13:30Z, the calendar 00:00Z of the same day), so
 * one payment is exactly one row. Only a genuinely-new upcoming payment is
 * appended. History rows carry `payableDate = null` → `—`.
 */
export function buildSchedule(
  events: readonly RawDividendEvent[],
  currency: string | null,
  frequency: FrequencyLabel | null,
  upcoming: UpcomingPayment | null = null,
): DividendScheduleRow[] {
  const row = (date: number, amount: number, payableDate: number | null): DividendScheduleRow => ({
    exDate: date,
    announcedDate: null,
    recordDate: null,
    payableDate,
    currency: currency ?? '—',
    amount,
    adjAmount: amount,
    frequency,
    type: null,
  });
  const rows = events.map((e) => row(e.date, e.amount, null));
  if (upcoming === null) return rows;
  const upDay = dayOf(upcoming.exDate);
  const existing = rows.find((r) => dayOf(r.exDate) === upDay);
  if (existing) {
    // One payment, one row: stamp the payable date onto the chart row rather
    // than appending a duplicate. The chart's own amount wins — it is the unit
    // the rest of the column is in.
    if (existing.payableDate === null) existing.payableDate = upcoming.payDate;
    return rows;
  }
  rows.push(row(upcoming.exDate, upcoming.amount, upcoming.payDate));
  return rows;
}

/* ================================================================ series ==== */

export interface YieldPoint {
  date: number;
  value: number;
  source: 'yahoo:trailingDividendYield' | 'reconstructed';
}

export interface DividendSeries {
  yields: YieldPoint[];
  payments: Array<{ date: number; amount: number }>;
  /** Honest capability list: 20y/ALL yields exist only by reconstruction. */
  spansAvailable: DividendSpan[];
  /** True when the yield line contains reconstructed (pre-2015) points. */
  reconstructed: boolean;
}

/** Parse the crumb-free `trailingDividendYield` timeseries (monthly, 2015-04→). */
export function parseTrailingYield(json: unknown): YieldPoint[] {
  const results = (json as { timeseries?: { result?: unknown[] } } | null)?.timeseries?.result;
  if (!Array.isArray(results)) return [];
  const out: YieldPoint[] = [];
  for (const block of results) {
    const b = block as { meta?: { type?: unknown[] } } & Record<string, unknown>;
    if (b.meta?.type?.[0] !== 'trailingDividendYield') continue;
    const rows = b['trailingDividendYield'];
    if (!Array.isArray(rows)) continue;
    for (const raw of rows) {
      const r = raw as { asOfDate?: unknown; dataValue?: unknown } | null;
      const asOf = str(r?.asOfDate);
      const value = num(r?.dataValue);
      if (asOf === null || value === null) continue;
      const date = Math.floor(Date.parse(`${asOf}T00:00:00Z`) / 1000);
      if (!Number.isFinite(date)) continue;
      out.push({ date, value, source: 'yahoo:trailingDividendYield' });
    }
  }
  return out.sort((a, b) => a.date - b.date);
}

/** The earliest date the provider's real yield series covers. */
export const YIELD_SERIES_START = Math.floor(Date.parse('2015-04-30T00:00:00Z') / 1000);

/**
 * Reconstruct a monthly LTM yield line (§A.4).
 *
 * `yield(t) = Σ dividends(ex-date in (t−12m, t]) ÷ price(t)`, using the chart's
 * monthly close. This is the *only* honest way to draw a line before 2015-04 and
 * every point it produces carries `source: 'reconstructed'` so the UI can label
 * it. Accuracy is ≈ ±0.0001–0.0006 for a quarterly payer and worse for
 * high-yield/frequent payers (recon measured up to ~0.006 for `O`), which is
 * exactly why it is never presented as a published figure.
 */
export function reconstructYields(
  events: readonly RawDividendEvent[],
  closes: ReadonlyArray<{ date: number; close: number }>,
): YieldPoint[] {
  const out: YieldPoint[] = [];
  for (const point of closes) {
    const from = point.date - 365 * 86400;
    const sum = events
      .filter((e) => e.date > from && e.date <= point.date)
      .reduce((acc, e) => acc + e.amount, 0);
    if (sum <= 0) continue;
    out.push({ date: point.date, value: sum / point.close, source: 'reconstructed' });
  }
  return out;
}

/**
 * Which spans the series can honestly serve.
 *
 * Payments go back as far as the chart does, so `ALL` is always available for
 * them; the **yield line** starts 2015-04, so `20y`/`ALL` remain listed (the
 * graph is drawable by reconstruction) and the UI labels them `reconstructed`.
 */
export function spansAvailable(): DividendSpan[] {
  return [...DIVIDEND_SPANS];
}

/* ====================================================== shareholder yield ==== */

export interface ShareholderYield {
  total: Sourced<number>;
  dividendPart: Sourced<number>;
  buybackPart: Sourced<number>;
  debtPaydownPart: Sourced<number>;
  asOf: string;
}

export interface ShareholderInputs {
  /** Cash-flow items, exactly as reported (negative = outflow). */
  dividendsPaid: number | null;
  repurchaseOfStock: number | null;
  longTermDebtPayments: number | null;
  longTermDebtIssuance: number | null;
  /** Shares at the FY-end the numerators belong to. */
  sharesAtFyEnd: number | null;
  /** Close nearest the FY-end, from the crumb-free chart. */
  priceAtFyEnd: number | null;
  asOf: string;
}

/**
 * Decompose shareholder yield (§A.3.1) — with three honesty rules baked in:
 *
 * 1. **Signs.** Cash-flow items are reported negative (outflow). A −15.7B must
 *    never become a −454% yield, so every numerator is `abs()`.
 * 2. **Net debt.** `abs(payments − issuance)`: KO FY25 paid 4.967B and issued
 *    4.980B, so the honest figure is a 13M *increase*, not a 4.97B "paydown".
 * 3. **FY-end denominator.** The numerators are FY-end balance-sheet facts, so
 *    the divisor is market cap at that FY-end (`shares@FYend × close@FYend`).
 *    Using today's market cap would silently change the period.
 */
export function deriveShareholderYield(inp: ShareholderInputs): ShareholderYield {
  const mcap =
    inp.sharesAtFyEnd !== null && inp.priceAtFyEnd !== null && inp.sharesAtFyEnd > 0 && inp.priceAtFyEnd > 0
      ? inp.sharesAtFyEnd * inp.priceAtFyEnd
      : null;
  const note = 'note.dividendShareholderFyEnd';

  // Dividend and buyback cash-flow items are outflows reported negative, so the
  // magnitude is what matters: `abs()` and document it, or a −15.7B becomes a
  // −454% yield.
  const part = (value: number | null): Sourced<number> => {
    if (mcap === null || value === null) return absent('note.dividendShareholderIncomplete');
    return derived(Math.abs(value) / mcap, note);
  };

  // The debt leg is the exception: its *sign* is the finding. Net issuance is a
  // negative shareholder-yield contribution, so the net must not be `abs()`-ed
  // (doing so reported KO's 13M net *increase* as a positive ~0.004% yield).
  // A net of exactly 0 stays 0.
  const signedPart = (value: number | null): Sourced<number> => {
    if (mcap === null || value === null) return absent('note.dividendShareholderIncomplete');
    return derived(value / mcap, note);
  };

  const dividendPart = part(inp.dividendsPaid);
  const buybackPart = part(inp.repurchaseOfStock);
  // The legs carry opposite provider signs: payments are the outflow (negative)
  // and issuance is a cash *inflow* (positive) — probed live 2026-11-07, KO
  // pay −4.967B / issue +4.980B, IBM −5.489B / +8.391B, O −2.234B / +3.299B. The
  // gross payout figure therefore has to be taken as `|payments| − |issuance|`;
  // subtracting the raw values would have reported KO's net *increase* of 13M as
  // a 9.947B "paydown", i.e. the exact dishonesty RECON §4.2 warns about.
  const debtNet =
    inp.longTermDebtPayments === null || inp.longTermDebtIssuance === null
      ? null
      : Math.abs(inp.longTermDebtPayments) - Math.abs(inp.longTermDebtIssuance);
  const debtPaydownPart = signedPart(debtNet);

  const total: Sourced<number> =
    dividendPart.value === null || buybackPart.value === null || debtPaydownPart.value === null
      ? absent<number>('note.dividendShareholderIncomplete')
      : derived(dividendPart.value + buybackPart.value + debtPaydownPart.value, note);

  return { total, dividendPart, buybackPart, debtPaydownPart, asOf: inp.asOf };
}

/* ============================================================== assembly ==== */

/**
 * The upcoming payment as a schedule row, or null.
 *
 * The chart only ever carries *past* ex-dates, so the one row that can honestly
 * show a Payable Date is the upcoming one, and only when the provider published
 * both the next ex-date and the announced per-share amount. When either is
 * missing this returns null and the table simply ends at the last paid event —
 * a row with an invented amount would be exactly the fabrication §C.5 forbids.
 */
/**
 * §C.1/§A.8 — a "last dividend" in a different unit is worse than none.
 *
 * `lastDividendValue` comes from the facts session (e.g. GBP) while the chart
 * series is in `meta.currency` (GBp) or fractional (0005.HK). Reconcile it to
 * the series' recent amounts; when the scale cannot be resolved, withhold it
 * rather than print a 100x-wrong figure in §C.1 or the export.
 */
export function reconcileLastDividend(facts: DividendFacts, recent: readonly number[]): DividendFacts {
  const s = facts.lastDividendValue;
  if (s.value === null || s.source !== 'direct') return facts;
  const reconciled = reconcileScale(s.value, recent);
  if (reconciled === null) {
    return { ...facts, lastDividendValue: absent('note.dividendAmountScaleUnreconciled') };
  }
  if (reconciled === s.value) return facts;
  return { ...facts, lastDividendValue: { ...s, value: reconciled, note: 'note.dividendAmountScaleUnreconciled' } };
}

/**
 * The upcoming payment as a schedule row, or null.
 *
 * Kept as a thin view over `upcomingPayment` so a caller holding only the
 * reconciled element can still render the row shape. The chart only ever
 * carries *past* ex-dates, so the one row that can honestly show a Payable
 * Date is the upcoming one.
 */
export function upcomingRow(facts: DividendFacts, frequency: FrequencyLabel | null, recentAmounts: readonly number[] = []): DividendScheduleRow | null {
  const up = upcomingPayment(facts, recentAmounts);
  if (up === null) return null;
  return {
    exDate: up.exDate,
    announcedDate: null,
    recordDate: null,
    payableDate: up.payDate,
    currency: facts.currency.value ?? '—',
    amount: up.amount,
    adjAmount: up.amount,
    frequency,
    type: null,
  };
}

export interface DividendPayload {
  symbol: string;
  price: number | null;
  facts: DividendFacts;
  /** Schedule rows, oldest → newest (the upcoming payment last when known). */
  events: DividendScheduleRow[];
  growth: DividendGrowth;
  shareholder: ShareholderYield;
  series: DividendSeries;
  source: string;
  lastUpdated: number | null;
  note: string | null;
}

export interface DividendHistoryPayload {
  symbol: string;
  span: DividendSpan;
  currency: string | null;
  price: number | null;
  payments: Array<{ date: number; amount: number }>;
  yields: YieldPoint[];
  rows: DividendScheduleRow[];
  /** True when the yield line includes pre-2015 reconstructed points. */
  reconstructed: boolean;
  spansAvailable: DividendSpan[];
  source: string;
  lastUpdated: number | null;
  note: string | null;
}

export interface AssembleInput {
  symbol: string;
  now: number;
  price: number | null;
  /** The `quoteSummary` envelope (facts), or null when the call failed. */
  factsJson: unknown;
  /** The crumb-free chart payload for the span window (history + currency). */
  chartJson: unknown;
  /** The crumb-free `trailingDividendYield` timeseries, or null. */
  yieldJson: unknown;
  /** The annual cash-flow/share series for the shareholder decomposition. */
  shareholder: ShareholderInputs;
  source: string;
  lastUpdated: number | null;
  note: string | null;
}

/** Current UTC calendar year for the supplied clock. */
export function yearOf(now: number): number {
  return new Date(now * 1000).getUTCFullYear();
}

function seriesOf(events: readonly RawDividendEvent[], yields: YieldPoint[]): DividendSeries {
  return {
    yields,
    payments: events.map((e) => ({ date: e.date, amount: e.amount })),
    spansAvailable: spansAvailable(),
    reconstructed: yields.some((y) => y.source === 'reconstructed'),
  };
}

/**
 * Assemble the full `/api/dividends/:sym` payload from the three upstream
 * answers. Pure: the service does the fetching and the caching, everything
 * arithmetic and every honesty decision happens here and is unit-tested.
 */
export function assembleDividends(inp: AssembleInput): DividendPayload {
  const events = parseDividendEvents(inp.chartJson);
  const currency = chartCurrency(inp.chartJson) ?? (str(read(inp.factsJson, 'price', 'currency')) ?? null);
  const facts = parseDividendFacts(inp.factsJson, inp.price, events.map((e) => e.date));
  const growth = deriveGrowth(events, yearOf(inp.now));
  const yields = yieldLine(events, inp.chartJson, inp.yieldJson);

  const recent = events.slice(-8).map((e) => e.amount);
  const rows = buildSchedule(events, currency, facts.frequency.value, upcomingPayment(facts, recent));

  return {
    symbol: inp.symbol,
    price: inp.price,
    facts: reconcileLastDividend(facts, recent),
    events: rows,
    growth,
    shareholder: deriveShareholderYield(inp.shareholder),
    series: seriesOf(events, yields),
    source: inp.source,
    lastUpdated: inp.lastUpdated,
    note: inp.note,
  };
}

/**
 * The yield line: the provider's real monthly series where it exists, extended
 * backwards by reconstruction (and labelled) when the span reaches before
 * 2015-04. Real points always win; a reconstruction never overwrites one.
 */
export function yieldLine(
  events: readonly RawDividendEvent[],
  chartJson: unknown,
  yieldJson: unknown,
): YieldPoint[] {
  const real = parseTrailingYield(yieldJson);
  const first = real.length > 0 ? real[0].date : null;
  const reconstructed = reconstructYields(events, chartCloses(chartJson)).filter(
    (p) => first === null || p.date < first,
  );
  return [...reconstructed, ...real].sort((a, b) => a.date - b.date);
}

/** Assemble the `/api/dividends/:sym/history` payload for one span. */
export function assembleHistory(
  inp: Omit<AssembleInput, 'shareholder'> & { span: DividendSpan },
): DividendHistoryPayload {
  const events = parseDividendEvents(inp.chartJson);
  const currency = chartCurrency(inp.chartJson);
  const recent = events.slice(-8).map((e) => e.amount);
  const facts = parseDividendFacts(inp.factsJson, inp.price, events.map((e) => e.date));
  const yields = yieldLine(events, inp.chartJson, inp.yieldJson);
  const rows = buildSchedule(events, currency, facts.frequency.value, upcomingPayment(facts, recent));

  return {
    symbol: inp.symbol,
    span: inp.span,
    currency,
    price: inp.price,
    payments: events.map((e) => ({ date: e.date, amount: e.amount })),
    yields,
    rows,
    reconstructed: yields.some((y) => y.source === 'reconstructed'),
    spansAvailable: spansAvailable(),
    source: inp.source,
    lastUpdated: inp.lastUpdated,
    note: inp.note,
  };
}
