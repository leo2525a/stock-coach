/**
 * Failure codes → dictionary keys.
 *
 * Every `/api/*` failure carries a stable `code`. The `error` string is the
 * English diagnostic the server (or `src/api.ts`) produced, kept for logs and
 * for any code that has no translation yet. The UI must render `code` through
 * this table so a Chinese user never sees an English sentence in an error box.
 *
 * `params` are filled in client-side from the request the user made (symbol,
 * input), because the server does not know the user's language.
 */
import type { ApiErrorCode } from './types';

export interface ApiErrorCopy {
  key: string;
  /**
   * Which request field supplies `{symbol}` / `{input}`. Resolved by the caller
   * so the server never has to echo user input back as pre-formatted copy.
   */
  param: 'symbol' | 'input' | 'none';
}

export const API_ERROR_COPY: Record<ApiErrorCode, ApiErrorCopy> = {
  BAD_SYMBOL: { key: 'api.badSymbol', param: 'symbol' },
  NOT_FOUND: { key: 'api.notFound', param: 'symbol' },
  NOT_IN_WATCHLIST: { key: 'api.notInWatchlist', param: 'symbol' },
  BAD_REQUEST: { key: 'api.badRequest', param: 'none' },
  BAD_RESPONSE: { key: 'api.badResponse', param: 'none' },
  INTERNAL_ERROR: { key: 'api.internalError', param: 'none' },
  NETWORK: { key: 'common.networkError', param: 'none' },
  UPSTREAM_ERROR: { key: 'api.upstreamError', param: 'none' },
};

/**
 * Resolve a failure to a dictionary key plus the parameters to interpolate.
 *
 * Returns `null` for a code we do not know (a newer server, a proxy injecting
 * its own body): the caller then falls back to whatever English detail it has,
 * which is better than showing a raw `{placeholder}` to the user.
 */
export function apiErrorI18n(
  code: string | null | undefined,
  params: Partial<Record<'symbol' | 'input', string>> = {},
): { key: string; params: Record<string, string> } | null {
  if (!code) return null;
  const copy = API_ERROR_COPY[code as ApiErrorCode];
  if (!copy) return null;
  const filled: Record<string, string> = {};
  if (copy.param !== 'none') {
    const value = params[copy.param];
    if (value === undefined) return null;
    filled[copy.param] = value;
  }
  return { key: copy.key, params: filled };
}

/**
 * Note codes attached to `source: 'stale-cache' | 'unavailable'` payloads.
 * The server ships the code; the client renders it in the user's language.
 *
 * This list must cover **every** note a payload can carry, across all phases:
 * `isNoteKey()` is the guard that catches raw prose leaking into a `note` field
 * (the client does `t(note)` on it), so a code missing here turns a real
 * transport bug into a confusing "missing translation" instead. The Phase 3
 * analyst payloads were added on 2026-11-06, when the §D.3 live check reported
 * their (valid) notes as unrecognised.
 */
export const NOTE_KEYS = [
  // Phase 1 — market data.
  'note.marketLiveFetchFailed',
  // Phase 2 — news + fundamentals.
  'note.newsUnreachableCached',
  'note.newsUnreachableNone',
  'note.fundamentalsUnreachableCached',
  'note.fundamentalsUnavailable',
  // Phase 3 — statements, analyst bundle, header quote, FX.
  'note.statementsUnavailable',
  'note.estimatesUnreachableCached',
  'note.estimatesUnavailable',
  'note.ratingsUnreachableCached',
  'note.ratingsUnavailable',
  'note.quotesUnreachableCached',
  'note.fxUnavailable',
  // Phase 4 — dividends. `met` = the unit/derivation was checked and the value
  // is trustworthy; `calc` = a pure computation of other reported figures.
  'note.dividendStaleCached',
  'note.dividendNoDividend',
  'note.dividendNoRecentPayment',
  'note.dividendFactsUnavailable',
  'note.dividendForwardIsIndicated',
  'note.dividendIndicatedUnavailable',
  'note.dividendPayoutNormalised',
  'note.dividendPayoutUnitUnresolved',
  'note.dividendFiveYearPercentToFraction',
  'note.dividendFrequencyDerived',
  'note.dividendFrequencyArithmeticOnly',
  'note.dividendFrequencySpacingOnly',
  'note.dividendFrequencyDisagree',
  'note.dividendFrequencyUnknown',
  'note.dividendGrowthUnavailable',
  'note.dividendSpecialExcluded',
  'note.dividendShareholderFyEnd',
  'note.dividendShareholderIncomplete',
] as const;

export type NoteCode = (typeof NOTE_KEYS)[number];

/** True when `note` is one of our translation keys rather than raw prose. */
export function isNoteKey(note: string | null | undefined): note is NoteCode {
  return !!note && (NOTE_KEYS as readonly string[]).includes(note);
}

/** Note codes used by `shared/indicators.ts` for a half-warmed series. */
export const INDICATOR_NOTE_KEY = 'note.indicatorsUnavailable';
