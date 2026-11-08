import type { CompanyProfile, FundamentalsPayload, HealthStats, KeyStats } from './types';

/**
 * Pure mapping layer for Yahoo's `quoteSummary` endpoint (SPEC-PHASE2 §E).
 *
 * The endpoint answers with `{ raw, fmt, longFmt }` wrapper objects for every
 * numeric field, and answers with an **empty object `{}`** when a field simply
 * does not apply (an ETF has no trailing P/E; a trust has no beta). Both shapes
 * mean "no value", and the honest rendering of "no value" is `null` — never `0`,
 * because a dividend yield of `0` is a real, different fact from "unknown".
 *
 * Kept pure so it can be unit-tested against captured fixtures.
 */

/** `{ raw: 1 }`, `1`, `null`, `{}`, `'1.2'` → number | null. Never throws. */
export function rawNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  if (typeof value === 'object') {
    return rawNumber((value as { raw?: unknown }).raw);
  }
  return null;
}

/** As `rawNumber`, but a value of `0` also becomes null (for "unset" markers). */
function nonZero(value: unknown): number | null {
  const n = rawNumber(value);
  return n === null || n === 0 ? null : n;
}

function rawString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const s = value.trim();
  return s ? s : null;
}

interface QuoteSummaryModule {
  [key: string]: unknown;
}

interface QuoteSummaryResult {
  price?: QuoteSummaryModule;
  summaryDetail?: QuoteSummaryModule;
  defaultKeyStatistics?: QuoteSummaryModule;
  financialData?: QuoteSummaryModule;
  assetProfile?: QuoteSummaryModule;
}

interface QuoteSummaryRoot {
  quoteSummary?: {
    result?: QuoteSummaryResult[] | null;
    error?: { code?: string; description?: string } | null;
  };
}

/** Did Yahoo answer with its "you are not authenticated" envelope? */
export function isCrumbError(json: unknown): boolean {
  const err = (json as QuoteSummaryRoot)?.quoteSummary?.error;
  if (!err) return false;
  const code = String(err.code ?? '');
  const desc = String(err.description ?? '');
  return /unauthor/i.test(code) || /crumb/i.test(desc);
}

/** First result block, or null. */
function firstResult(json: unknown): QuoteSummaryResult | null {
  return (json as QuoteSummaryRoot)?.quoteSummary?.result?.[0] ?? null;
}

/**
 * The provider's business-summary paragraph, truncated to a single readable
 * line. We cap at a sentence-ish boundary instead of hard-cutting mid-word, and
 * are explicit that we truncated.
 */
export function trimSummary(text: string | null, maxChars = 420): string | null {
  if (!text) return null;
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= maxChars) return clean;
  const cut = clean.slice(0, maxChars);
  const lastStop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('; '));
  if (lastStop > maxChars * 0.5) return `${cut.slice(0, lastStop + 1)} …`;
  const lastSpace = cut.lastIndexOf(' ');
  return `${cut.slice(0, lastSpace > 0 ? lastSpace : maxChars)} …`;
}

export function parseProfile(json: unknown): CompanyProfile | null {
  const p = firstResult(json)?.assetProfile;
  if (!p) return null;
  const summary = trimSummary(rawString(p.longBusinessSummary));
  const profile: CompanyProfile = {
    sector: rawString(p.sectorDisp) ?? rawString(p.sector),
    industry: rawString(p.industryDisp) ?? rawString(p.industry),
    country: rawString(p.country),
    website: rawString(p.website),
    fullTimeEmployees: nonZero(p.fullTimeEmployees),
    summary,
  };
  const empty =
    !profile.sector && !profile.industry && !profile.country && !profile.website && !profile.summary;
  return empty ? null : profile;
}

export function parseKeyStats(json: unknown): KeyStats | null {
  const r = firstResult(json);
  if (!r) return null;
  const price = r.price ?? {};
  const sd = r.summaryDetail ?? {};
  const ks = r.defaultKeyStatistics ?? {};
  const stats: KeyStats = {
    marketCap: nonZero(price.marketCap) ?? nonZero(sd.marketCap),
    trailingPE: nonZero(sd.trailingPE),
    forwardPE: nonZero(sd.forwardPE) ?? nonZero(ks.forwardPE),
    dividendYield: rawNumber(sd.dividendYield) || nonZero(sd.trailingAnnualDividendYield),
    beta: nonZero(sd.beta) ?? nonZero(ks.beta),
    priceToBook: nonZero(ks.priceToBook),
    trailingEps: rawNumber(ks.trailingEps),
    forwardEps: nonZero(ks.forwardEps),
    dayHigh: nonZero(price.regularMarketDayHigh) ?? nonZero(sd.dayHigh),
    dayLow: nonZero(price.regularMarketDayLow) ?? nonZero(sd.dayLow),
    previousClose: nonZero(sd.previousClose),
    fiftyTwoWeekHigh: nonZero(sd.fiftyTwoWeekHigh),
    fiftyTwoWeekLow: nonZero(sd.fiftyTwoWeekLow),
    volume: nonZero(price.regularMarketVolume),
    averageVolume: nonZero(sd.averageVolume),
  };
  const anyValue = Object.values(stats).some((v) => v !== null);
  return anyValue ? stats : null;
}

export function parseHealthStats(json: unknown): HealthStats | null {
  const f = firstResult(json)?.financialData;
  if (!f) return null;
  const health: HealthStats = {
    profitMargins: rawNumber(f.profitMargins),
    operatingMargins: rawNumber(f.operatingMargins),
    returnOnEquity: rawNumber(f.returnOnEquity),
    returnOnAssets: rawNumber(f.returnOnAssets),
    revenueGrowth: rawNumber(f.revenueGrowth),
    recommendationKey: rawString(f.recommendationKey),
    recommendationMean: nonZero(f.recommendationMean),
    numberOfAnalystOpinions: nonZero(f.numberOfAnalystOpinions),
    targetMeanPrice: nonZero(f.targetMeanPrice),
    targetHighPrice: nonZero(f.targetHighPrice),
    targetLowPrice: nonZero(f.targetLowPrice),
  };
  const anyValue = Object.values(health).some((v) => v !== null);
  return anyValue ? health : null;
}

/**
 * Full fundamentals payload. `source` is decided by the caller (it owns the
 * cache); this function only maps.
 */
export function parseFundamentals(
  json: unknown,
  symbol: string,
  extras: { source: string; lastUpdated: number | null; note?: string | null; quoteType?: string | null; currency?: string | null },
): FundamentalsPayload {
  const r = firstResult(json);
  const price = r?.price ?? {};
  return {
    symbol,
    profile: parseProfile(json),
    keyStats: parseKeyStats(json),
    health: parseHealthStats(json),
    quoteType: extras.quoteType ?? rawString(price.quoteType),
    currency: extras.currency ?? rawString(price.currency),
    source: extras.source,
    lastUpdated: extras.lastUpdated,
    note: extras.note ?? null,
  };
}

/**
 * Is there anything here worth caching?
 *
 * A provider reply can parse successfully and still carry no usable facts — an
 * ETF with no sector, a symbol Yahoo does not cover, a cold cookie/crumb
 * session. `loadFundamentals` deliberately refuses to persist such an envelope
 * (caching it would turn a transient hiccup into hours of "no data"), so this
 * predicate is the single definition of "cacheable". It lives here, shared,
 * because the verifier must reason about the same rule the service applies —
 * a harness with its own copy could drift from the code it is testing.
 */
export function isUsableFundamentals(payload: FundamentalsPayload): boolean {
  return payload.profile !== null || payload.keyStats !== null || payload.health !== null;
}

/** Where the last price sits inside the 52-week range, 0..1 (null if unknown). */
export function rangePosition(
  price: number | null | undefined,
  low: number | null | undefined,
  high: number | null | undefined,
): number | null {
  if (price === null || price === undefined || !Number.isFinite(price)) return null;
  if (low === null || low === undefined || high === null || high === undefined) return null;
  if (!Number.isFinite(low) || !Number.isFinite(high) || high <= low) return null;
  return Math.max(0, Math.min(1, (price - low) / (high - low)));
}
