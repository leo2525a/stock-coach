/**
 * The honest rendering of a Phase 4 dividend payload (§B.3, §D.5).
 *
 * Four rules, in one place so no panel can forget one:
 *
 *  1. **`Sourced<T>` honesty.** A figure is rendered from its `value` only. When
 *     `value === null` (or `source === 'absent'`) it renders the em dash — never
 *     `null`, `NaN`, `undefined`, `0`. When `source === 'derived'` the figure is
 *     our arithmetic and the caller labels it "computed".
 *  2. **Levels are never coloured.** A yield, a payout ratio or a price is a
 *     level: it has no direction, so it gets no `chg-up`/`chg-down`. Only figures
 *     that *change* (the §C.2 growth rates, the payment-over-payment deltas) get
 *     `dirClass`, and the sign stays in the text so colour is never the only
 *     signal (§B.3, accessibility).
 *  3. **A reason travels with the dash.** Where the payload supplied a note code
 *     (`note.dividendNoDividend`, `note.dividendPayoutUnitUnresolved`, …) it
 *     becomes the tooltip, so a dash reads as "not published" rather than as a
 *     figure someone forgot to wire up.
 *  4. **Yields are fractions.** `shared/dividends.ts` normalises everything to a
 *     fraction; the UI multiplies by 100 exactly once, here.
 *
 * Pure — no React, no store, no DOM — so "the dash is honest" is unit-testable
 * without a browser.
 */
import { FREQUENCY_LABELS, type FrequencyLabel, type Sourced } from '../../shared/dividends';

/** The honest placeholder for a figure we do not have. */
export const DASH = '—';

/* ------------------------------------------------------------------ sourced -- */

export interface SourcedText {
  /** What to render: the formatted value, or the dash. */
  text: string;
  /** `source === 'derived'` — our arithmetic, and the UI must say so. */
  computed: boolean;
  /** Nothing to show: a dash, not a zero. */
  absent: boolean;
  /** The dictionary key explaining the absence, when the payload supplied one. */
  note: string | null;
}

/**
 * Render a `Sourced<T>` through a formatter.
 *
 * The `value === null` check is deliberately *first* and separate from the
 * `source` check: a payload that somehow carried `value: null` with
 * `source: 'direct'` must still render a dash, because rendering `String(null)`
 * would put the word "null" on screen.
 */
export function sourcedText<T>(
  s: Sourced<T> | null | undefined,
  format: (value: T) => string,
  dash: string = DASH,
): SourcedText {
  if (!s || s.value === null || s.value === undefined || s.source === 'absent') {
    return { text: dash, computed: false, absent: true, note: s?.note ?? null };
  }
  return { text: format(s.value), computed: s.source === 'derived', absent: false, note: s.note ?? null };
}

/* ------------------------------------------------------------------ numbers -- */

/** A fraction as an unsigned percentage (`0.0221` → `2.21%`). */
export function formatYield(fraction: number | null, digits = 2, dash: string = DASH): string {
  if (fraction === null || !Number.isFinite(fraction)) return dash;
  return `${(fraction * 100).toFixed(digits)}%`;
}

/**
 * A fraction as a **signed** percentage (`0.043` → `+4.30%`).
 *
 * Only for figures that genuinely have a direction (growth rates, deltas). The
 * sign is in the text so the colour class is a secondary cue, never the only one.
 */
export function formatSignedPercent(fraction: number | null, digits = 2, dash: string = DASH): string {
  if (fraction === null || !Number.isFinite(fraction)) return dash;
  const v = fraction * 100;
  return `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(digits)}%`;
}

/** A plain count, or the dash. */
export function formatCount(value: number | null, dash: string = DASH): string {
  if (value === null || !Number.isFinite(value)) return dash;
  return String(Math.round(value));
}

/** A per-share money amount with its currency, or the dash. */
export function formatAmount(value: number | null, currency: string | null, dash: string = DASH): string {
  if (value === null || !Number.isFinite(value)) return dash;
  const n = value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  return currency ? `${n} ${currency}` : n;
}

/* ---------------------------------------------------------------- frequency -- */

/**
 * The dictionary key for a derived payment frequency.
 *
 * `null` — the two derivation methods disagreed, or there was nothing to
 * derive from — renders the dash, exactly as §C.1 requires. No frequency is ever
 * guessed in the UI.
 */
export function frequencyKey(freq: FrequencyLabel | null): string | null {
  if (freq === null || !(FREQUENCY_LABELS as readonly string[]).includes(freq)) return null;
  return `div.freq.${freq}`;
}

/* -------------------------------------------------------------------- spans -- */

export const SPAN_LABEL: Record<string, string> = {
  '1y': '1Y',
  '3y': '3Y',
  '5y': '5Y',
  '10y': '10Y',
  '20y': '20Y',
  ALL: 'ALL',
};

/** The short chip label for a span (`1y` → `1Y`). Tickers/horizons, not prose. */
export function spanLabel(span: string): string {
  return SPAN_LABEL[span] ?? span.toUpperCase();
}
