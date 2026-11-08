/**
 * Phase 4 dividends service (SPEC-PHASE4 §A) — the I/O half.
 *
 * Same shape as `phase2-service.ts` / `phase3-service.ts`: call the provider →
 * assemble with the *pure* helpers in `shared/dividends.ts` → cache the mapped
 * payload → serve the last good copy (labelled `stale-cache`) when the network
 * fails. This file owns the fetching, the cache and the clock; every arithmetic
 * and honesty decision lives in `shared/` and is unit-tested there.
 *
 * The one structural rule (SPEC §A.1.1): **facts ride a session, history does
 * not.** `quoteSummary` dividend facts go through the cookie+crumb path and are
 * intermittently empty (§A.7), so they are fetched, retried with a forced
 * re-mint, and cached on their own. The chart (`events=div`) and the
 * `trailingDividendYield` timeseries are crumb-free, so a crumb outage can never
 * blank the two history graphs.
 */
import { getKv, setKv, type Db } from './db';
import { analystSummaryPath, fetchProviderJson, fetchQuery2Json, timeseriesPath } from './provider';
import {
  assembleDividends,
  assembleHistory,
  hasQuoteSummary,
  isDividendSpan,
  parseDividendEvents,
  spanWindow,
  type AssembleInput,
  type DividendHistoryPayload,
  type DividendPayload,
  type DividendSpan,
  type ShareholderInputs,
} from '../shared/dividends';
import { loadSeries } from './market-service';

/**
 * Freshness window, in seconds. Dividends change a handful of times a year.
 *
 * There is deliberately **no** history TTL: the crumb-free chart and timeseries
 * calls are cheap and are re-read on every request, so a stale window on them
 * could only ever serve older graphs than the provider already has. The facts
 * envelope is the half that needs a cache, because it is the half that goes
 * empty (§A.7).
 */
export const TTL4 = {
  dividends: 6 * 3600,
} as const;

const DAY = 86400;

/** The annual cash-flow / share series the shareholder-yield leg needs. */
export const SHAREHOLDER_SERIES = [
  'annualCashDividendsPaid',
  'annualRepurchaseOfCapitalStock',
  'annualLongTermDebtPayments',
  'annualLongTermDebtIssuance',
  'annualOrdinarySharesNumber',
] as const;

export interface Service4Opts {
  force?: boolean;
  now?: number;
  fetchImpl?: typeof fetch;
}

function nowOf(opts: Service4Opts): number {
  return opts.now ?? Math.floor(Date.now() / 1000);
}

/**
 * The chart window a span needs.
 *
 * The facts payload wants the deepest history we can honestly show, and the
 * *history* endpoint wants exactly its span. Both go through `spanWindow`, which
 * never emits `range=max` (§A.1.2).
 */
function chartPathFor(symbol: string, span: DividendSpan, now: number): string {
  const { period1, period2 } = spanWindow(span, now);
  const params = new URLSearchParams({
    period1: String(period1),
    period2: String(period2),
    interval: '1mo',
    events: 'div',
  });
  return `/v8/finance/chart/${encodeURIComponent(symbol)}?${params.toString()}`;
}

/**
 * Load `summaryDetail` / `defaultKeyStatistics` / `calendarEvents` facts.
 *
 * Returns `null` when the provider could not be reached *or* answered with an
 * empty envelope, so the caller can distinguish "we could not ask" from "this
 * company pays nothing" — the distinction §A.7 exists for.
 *
 * The two-round retry order matters. A **cold** session (no cookie yet) often
 * returns the empty envelope, so when the first answer carries no `quoteSummary`
 * at all the second attempt forces a fresh re-mint. A no-crumb call is rejected
 * as *Invalid Crumb* (probe1 `("d")`), so re-minting is the correct recovery
 * rather than dropping the crumb.
 */
async function fetchFactsJson(symbol: string, opts: Service4Opts): Promise<unknown | null> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  let last: unknown = null;
  for (const forceNewSession of [false, true]) {
    const res = await fetchProviderJson(analystSummaryPath(symbol), { fetchImpl, forceNewSession });
    if (!res) return null;
    if (hasQuoteSummary(res.json)) return res.json;
    last = res.json;
  }
  return last;
}

/**
 * Fetch (or reuse) the facts envelope.
 *
 * The cache is keyed by symbol and stores the **raw envelope**, not the mapped
 * facts: the mapping also needs the chart's event dates (a crumb-free source
 * that is fetched anyway) and the price, so caching the mapped block would
 * freeze the frequency cross-check to whatever gave the first answer.
 */
async function loadFactsEnvelope(
  db: Db,
  symbol: string,
  opts: Service4Opts,
): Promise<{ json: unknown | null; source: string }> {
  const now = nowOf(opts);
  const key = `dividends:facts:${symbol}`;
  const cached = getKv<{ envelope: unknown }>(db, key);
  const fresh = cached !== null && now - cached.updatedAt <= TTL4.dividends;

  if (!opts.force && fresh && cached) return { json: cached.payload.envelope, source: 'cache' };

  const json = await fetchFactsJson(symbol, opts);
  if (hasQuoteSummary(json)) {
    // Only a genuinely usable envelope is persisted: caching an empty one turns
    // a transient hiccup into six hours of "no dividend" (the rule Phase 2 and
    // Phase 3 both apply).
    setKv(db, key, { envelope: json }, now);
    return { json, source: 'live' };
  }

  if (cached) return { json: cached.payload.envelope, source: 'stale-cache' };
  return { json, source: 'unavailable' };
}

/**
 * Trading days between two instants — the honest denominator for "paid within
 * 365 trading days".
 *
 * Calendar arithmetic per year is table-driven (holiday calendars are not
 * published upstream), with the 1/7 weekend share removed; the error is under
 * half a day a year, which is far tighter than the 55-day tolerance the
 * coverage rule needs. Known holidays plus leap days are ignored deliberately:
 * including a partial holiday table would make the figure *look* precise while
 * staying just as approximate.
 */
export function tradingDaysBetween(fromSec: number, toSec: number): number {
  if (toSec <= fromSec) return 0;
  let total = 0;
  const fromYear = new Date(fromSec * 1000).getUTCFullYear();
  const toYear = new Date(toSec * 1000).getUTCFullYear();
  for (let y = fromYear; y <= toYear; y += 1) {
    const yearStart = Date.UTC(y, 0, 1) / 1000;
    const yearEnd = Date.UTC(y + 1, 0, 1) / 1000;
    const s = Math.max(fromSec, yearStart);
    const e = Math.min(toSec, yearEnd);
    if (e <= s) continue;
    const days = (e - s) / DAY;
    const weeks = Math.floor(days / 7);
    const rem = days - weeks * 7;
    let weekdays = weeks * 5;
    const startDow = new Date(s * 1000).getUTCDay();
    for (let i = 0; i < Math.floor(rem); i += 1) {
      const dow = (startDow + i) % 7;
      if (dow !== 0 && dow !== 6) weekdays += 1;
    }
    total += weekdays;
  }
  return total;
}

/**
 * Has this symbol paid anything inside the last twelve months?
 *
 * `events.length > 0` is **not** an answer to that question: a 60-year `ALL`
 * window returns the last real payment for a company that stopped paying in
 * 2019. The honest test is whether the newest event is within ~365 trading days
 * of now; otherwise the "current" yield figures are describing a dividend that
 * no longer exists, and the payload says so with a note rather than presenting
 * them as live.
 */
export function isRecentPayer(events: readonly { date: number }[], now: number): boolean {
  const last = events.reduce((m, e) => (e.date > m ? e.date : m), 0);
  if (last === 0) return false;
  return tradingDaysBetween(last, now) <= 365;
}

/** The closest chart close to an ISO date, from the crumb-free daily chart. */
async function loadPriceNear(
  db: Db,
  symbol: string,
  isoDate: string,
  now: number,
  opts: Service4Opts,
): Promise<number | null> {
  const target = Math.floor(Date.parse(`${isoDate}T00:00:00Z`) / 1000);
  if (!Number.isFinite(target)) return null;
  try {
    const series = await loadSeries(db, symbol, { range: '10y', interval: '1d', now, fetchImpl: opts.fetchImpl });
    let best: { d: number; close: number } | null = null;
    for (const c of series.candles) {
      const d = Math.abs(c.time - target);
      if (best === null || d < best.d) best = { d, close: c.close };
    }
    return best?.close ?? null;
  } catch {
    return null;
  }
}

/**
 * The shareholder-yield inputs, as of the last reported FY.
 *
 * The quarterly (LTM) leg is deliberately **not** used: `quarterlyLongTermDebtIssuance`
 * came back with only 2 of 5 quarters for AAPL (RECON §4.4), so an LTM
 * net-debt figure would be a partial sum. The FY-end figure is complete, and
 * `asOf` names it.
 */
async function loadShareholderInputs(
  db: Db,
  symbol: string,
  now: number,
  opts: Service4Opts,
): Promise<ShareholderInputs> {
  const json = await fetchQuery2Json(
    timeseriesPath(symbol, [...SHAREHOLDER_SERIES], now - 6 * 365 * DAY, now + DAY),
    { fetchImpl: opts.fetchImpl },
  );
  const rows = latestOf(json, 'annualCashDividendsPaid');
  const asOf = rows?.asOf ?? '';
  return {
    dividendsPaid: rows?.value ?? null,
    repurchaseOfStock: latestOf(json, 'annualRepurchaseOfCapitalStock')?.value ?? null,
    longTermDebtPayments: latestOf(json, 'annualLongTermDebtPayments')?.value ?? null,
    longTermDebtIssuance: latestOf(json, 'annualLongTermDebtIssuance')?.value ?? null,
    sharesAtFyEnd: latestOf(json, 'annualOrdinarySharesNumber')?.value ?? null,
    priceAtFyEnd: asOf ? await loadPriceNear(db, symbol, asOf, now, opts) : null,
    asOf,
  };
}

/** Newest row of one timeseries block, or null. */
function latestOf(json: unknown, typeName: string): { asOf: string; value: number } | null {
  const results = (json as { timeseries?: { result?: unknown[] } } | null)?.timeseries?.result;
  if (!Array.isArray(results)) return null;
  for (const block of results) {
    const b = block as { meta?: { type?: unknown[] } } & Record<string, unknown>;
    if (b.meta?.type?.[0] !== typeName) continue;
    const list = b[typeName];
    if (!Array.isArray(list)) continue;
    let best: { asOf: string; value: number } | null = null;
    for (const raw of list) {
      const r = raw as { asOfDate?: unknown; reportedValue?: unknown } | null;
      const asOf = typeof r?.asOfDate === 'string' ? r.asOfDate : null;
      const value = readReported(r?.reportedValue);
      if (asOf === null || value === null) continue;
      if (best === null || asOf > best.asOf) best = { asOf, value };
    }
    return best;
  }
  return null;
}

function readReported(value: unknown): number | null {
  const v = (value as { raw?: unknown } | null)?.raw ?? value;
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Latest traded price from the crumb-free chart, or null. Never throws. */
async function loadPrice(db: Db, symbol: string, now: number, opts: Service4Opts): Promise<number | null> {
  try {
    const series = await loadSeries(db, symbol, { range: '5d', interval: '1d', now, fetchImpl: opts.fetchImpl });
    const last = series.meta.lastPrice ?? series.candles.at(-1)?.close ?? null;
    return last !== null && Number.isFinite(last) ? last : null;
  } catch {
    return null;
  }
}

/** `GET /api/dividends/:sym` */
export async function loadDividends(db: Db, rawSymbol: string, opts: Service4Opts = {}): Promise<DividendPayload> {
  const symbol = rawSymbol.trim().toUpperCase();
  const now = nowOf(opts);
  return assembleDividends(await buildInput(db, symbol, 'ALL', now, opts, true));
}

/** `GET /api/dividends/:sym/history?span=…` */
export async function loadDividendHistory(
  db: Db,
  rawSymbol: string,
  rawSpan: string,
  opts: Service4Opts = {},
): Promise<DividendHistoryPayload> {
  const symbol = rawSymbol.trim().toUpperCase();
  const now = nowOf(opts);
  const span: DividendSpan = isDividendSpan(rawSpan) ? rawSpan : '5y';
  const input = await buildInput(db, symbol, span, now, opts, false);
  return assembleHistory({ ...input, span });
}

/**
 * Fetch everything the assemblers need. One code path for both endpoints, so a
 * fact fetched for the history graph is the same fact the facts block shows.
 */
async function buildInput(
  db: Db,
  symbol: string,
  span: DividendSpan,
  now: number,
  opts: Service4Opts,
  withShareholder: boolean,
): Promise<Omit<AssembleInput, 'shareholder'> & { shareholder: ShareholderInputs }> {
  const [facts, chartJson, yieldJson, price] = await Promise.all([
    loadFactsEnvelope(db, symbol, opts),
    fetchQuery2Json(chartPathFor(symbol, span, now), { fetchImpl: opts.fetchImpl }),
    fetchQuery2Json(
      timeseriesPath(symbol, ['trailingDividendYield'], 0, now + DAY),
      { fetchImpl: opts.fetchImpl },
    ),
    loadPrice(db, symbol, now, opts),
  ]);

  const events = parseDividendEvents(chartJson);
  const recent = isRecentPayer(events, now);

  const shareholder = withShareholder
    ? await loadShareholderInputs(db, symbol, now, opts)
    : { dividendsPaid: null, repurchaseOfStock: null, longTermDebtPayments: null, longTermDebtIssuance: null, sharesAtFyEnd: null, priceAtFyEnd: null, asOf: '' };

  const note =
    facts.source === 'stale-cache'
      ? 'note.dividendStaleCached'
      : facts.source === 'unavailable'
        ? 'note.dividendFactsUnavailable'
        : recent
          ? null
          : 'note.dividendNoRecentPayment';

  return {
    symbol,
    now,
    price,
    factsJson: facts.json,
    chartJson,
    yieldJson,
    shareholder,
    source: facts.source,
    lastUpdated: facts.source === 'live' ? now : null,
    note,
  };
}

/** Everything the service exports for the verifier to reason about. */
export type { DividendPayload, DividendHistoryPayload };
