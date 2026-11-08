import type { Interval } from './types';

/**
 * The one thing this module needs from the i18n layer.
 *
 * Type-only on purpose: `shared/format.ts` is imported by the backend, the
 * tests and the chart, and must not drag React (or a locale bundle) in.
 */
export type Formatter = (key: string, params?: Record<string, string | number>) => string;

/**
 * The translated "we have no number here" sentinel.
 *
 * Exported so a caller can *branch* on it (see `FundamentalsPanel`) instead of
 * re-spelling the literal — which is how `'no data'` used to leak into the UI
 * in a Chinese session.
 */
export const NO_DATA = '—';

/** Fallback formatter: the English dictionary. Used only when no translator is
 *  passed (a pure function under test, or a log line). */
const EN_AGE: Record<string, string> = {
  'age.now': 'just now',
  'age.min': '{n} min ago',
  'age.hour': '{n} h ago',
  'age.day': '{n} d ago',
  'age.unknown': 'unknown',
  'common.noData': NO_DATA,
};
const enFormat: Formatter = (key, params) => {
  const template = EN_AGE[key] ?? key;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (m, name: string) => (name in params ? String(params[name]) : m));
};
const tf = (t?: Formatter): Formatter => t ?? enFormat;

/**
 * Formatting helpers.
 *
 * Time policy (SPEC §7): **all displayed timestamps are Asia/Hong_Kong (HKT)**
 * and every human-readable time string carries an explicit "HKT" label so a
 * beginner never has to guess which clock they are reading.
 */

export const HKT_TIME_ZONE = 'Asia/Hong_Kong';
export const HKT_LABEL = 'HKT';

const hktDateTime = new Intl.DateTimeFormat('en-GB', {
  timeZone: HKT_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const hktDate = new Intl.DateTimeFormat('en-GB', {
  timeZone: HKT_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const hktTime = new Intl.DateTimeFormat('en-GB', {
  timeZone: HKT_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/**
 * Coerce to a usable epoch-seconds value, or null.
 *
 * Note the explicit `null`/`undefined` guard: `Number(null)` is `0`, which
 * would otherwise render as 1970-01-01 instead of "no data".
 */
function toEpochSeconds(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return n;
}

/** '2026-11-06 15:30 HKT' */
export function formatHKT(epochSeconds: number | null | undefined, t?: Formatter): string {
  const s = toEpochSeconds(epochSeconds);
  if (s === null) return tf(t)('common.noData');
  const d = new Date(s * 1000);
  if (Number.isNaN(d.getTime())) return tf(t)('common.noData');
  // en-GB gives '06/11/2026, 15:30'; normalise to ISO-ish ordering.
  const parts = hktDateTime.formatToParts(d);
  const get = (typ: string) => parts.find((p) => p.type === typ)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')} ${HKT_LABEL}`;
}

/** '2026-11-06 HKT' */
export function formatHKTDate(epochSeconds: number | null | undefined, t?: Formatter): string {
  const s = toEpochSeconds(epochSeconds);
  if (s === null) return tf(t)('common.noData');
  const d = new Date(s * 1000);
  if (Number.isNaN(d.getTime())) return tf(t)('common.noData');
  const p = hktDate.formatToParts(d);
  const get = (typ: string) => p.find((x) => x.type === typ)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')} ${HKT_LABEL}`;
}

/** '15:30 HKT' */
export function formatHKTClock(epochSeconds: number | null | undefined, t?: Formatter): string {
  const s = toEpochSeconds(epochSeconds);
  if (s === null) return tf(t)('common.noData');
  const d = new Date(s * 1000);
  if (Number.isNaN(d.getTime())) return tf(t)('common.noData');
  return `${hktTime.format(d)} ${HKT_LABEL}`;
}

/**
 * Axis labels for the chart. Daily/weekly/monthly bars show a date; intraday
 * bars show the clock time. Either way the value is rendered in HKT.
 */
export function formatHKTAxis(epochSeconds: number, interval: Interval): string {
  const d = new Date(epochSeconds * 1000);
  if (Number.isNaN(d.getTime())) return '';
  if (interval === '1d' || interval === '1w' || interval === '1mo') {
    const p = hktDate.formatToParts(d);
    const get = (t: string) => p.find((x) => x.type === t)?.value ?? '';
    return `${get('year')}-${get('month')}-${get('day')}`;
  }
  return hktTime.format(d);
}

/**
 * Human age, e.g. 'just now', '4 min ago', '3 h ago', '2 d ago'.
 *
 * Routed through the translator so a zh-HK session reads 「啱啱」/「7 分鐘前」.
 * The bucket — not just a suffix — is translated, because English puts the unit
 * in the middle ("7 min ago") while Chinese puts it in the word itself
 * (「7 分鐘前」); a shared "{age}前" template would produce gibberish.
 */
export function humanAge(seconds: number, t?: Formatter): string {
  const T = tf(t);
  if (!Number.isFinite(seconds)) return T('age.unknown');
  const s = Math.max(0, Math.round(seconds));
  if (s < 45) return T('age.now');
  if (s < 3600) return T('age.min', { n: Math.round(s / 60) });
  if (s < 86400) return T('age.hour', { n: Math.round(s / 3600) });
  return T('age.day', { n: Math.round(s / 86400) });
}

/**
 * Staleness threshold per interval, in seconds.
 *
 * These are deliberately generous: markets close, so daily data is still
 * "fresh" across a weekend. Exceeding the threshold raises the stale badge.
 */
export function staleThreshold(interval: Interval): number {
  switch (interval) {
    case '1m':
      return 60 * 30; // 30 min
    case '5m':
      return 60 * 60; // 1 h
    case '15m':
      return 60 * 3; // 3 h
    case '1h':
      return 60 * 12;
    case '1d':
      return 60 * 60 * 24 * 4; // long weekend / holiday
    case '1w':
      return 60 * 60 * 24 * 12;
    case '1mo':
      return 60 * 60 * 24 * 40;
    default:
      return 60 * 60 * 24 * 4;
  }
}

export interface Staleness {
  stale: boolean;
  ageSeconds: number;
  thresholdSeconds: number;
  label: string;
}

/** Evaluate whether a payload is stale, and describe it for a beginner. */
export function staleness(
  interval: Interval,
  lastUpdated: number | null,
  nowSeconds: number,
  t?: Formatter,
): Staleness {
  const thresholdSeconds = staleThreshold(interval);
  if (lastUpdated === null || !isFinite(lastUpdated)) {
    return { stale: true, ageSeconds: Infinity, thresholdSeconds, label: tf(t)('age.unknown') };
  }
  const ageSeconds = Math.max(0, nowSeconds - lastUpdated);
  return {
    stale: ageSeconds > thresholdSeconds,
    ageSeconds,
    thresholdSeconds,
    label: humanAge(ageSeconds, t),
  };
}

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

export function formatPrice(value: number | null | undefined, currency?: string, t?: Formatter): string {
  if (value === null || value === undefined || !isFinite(value)) return tf(t)('common.noData');
  const n = value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return currency ? `${n} ${currency}` : n;
}

export function formatSigned(value: number | null | undefined, digits = 2, t?: Formatter): string {
  if (value === null || value === undefined || !isFinite(value)) return tf(t)('common.noData');
  return `${value >= 0 ? '+' : ''}${value.toFixed(digits)}`;
}

export function formatPercent(value: number | null | undefined, digits = 2, t?: Formatter): string {
  if (value === null || value === undefined || !isFinite(value)) return tf(t)('common.noData');
  return `${value >= 0 ? '+' : ''}${value.toFixed(digits)}%`;
}

export function formatNumber(value: number | null | undefined, digits = 2, t?: Formatter): string {
  if (value === null || value === undefined || !isFinite(value)) return tf(t)('common.noData');
  return value.toLocaleString('en-US', { maximumFractionDigits: digits });
}

/** 74173346 -> '74.2M' */
export function formatCompact(value: number | null | undefined, t?: Formatter): string {
  if (value === null || value === undefined || !isFinite(value)) return tf(t)('common.noData');
  const abs = Math.abs(value);
  if (abs >= 1e12) return `${(value / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(value / 1e3).toFixed(2)}K`;
  return value.toFixed(0);
}

/** Format a candle's OHLC for the crosshair legend. */
export function formatOhlcLegend(
  o: number,
  h: number,
  l: number,
  c: number,
): { open: string; high: string; low: string; close: string; change: string } {
  const changePercent = o !== 0 ? ((c - o) / o) * 100 : 0;
  return {
    open: formatNumber(o),
    high: formatNumber(h),
    low: formatNumber(l),
    close: formatNumber(c),
    change: formatPercent(changePercent),
  };
}

/** Normalise a user-typed symbol: 'aapl ' -> 'AAPL', 'brk.b' -> 'BRK.B'. */
export function normalizeSymbol(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, '');
}

/** Loose plausibility check for a ticker before we hit the network. */
export function isValidSymbol(symbol: string): boolean {
  return /^[A-Z0-9][A-Z0-9.\-=^]{0,14}$/.test(symbol);
}
