/**
 * Phase 3 provider-backed services (SPEC-PHASE3 §A).
 *
 * Same shape as `phase2-service.ts`: call the provider → map with a *pure*
 * function from `shared/` → cache the mapped result → serve the last good copy
 * clearly labelled `stale-cache` when the network fails. This file owns only the
 * I/O, the cache and the clock; every arithmetic decision lives in `shared/` and
 * is unit-tested there.
 *
 * Two upstreams are in play, and the difference matters:
 *
 * - **`fundamentals-timeseries` on `query2`** — crumb-free, and the *only*
 *   usable source for the three statements (RECON-PHASE3 §2: the legacy
 *   `quoteSummary` statement modules return gutted data).
 * - **`quoteSummary` on `query1`** — crumb-authenticated (Phase 2's session
 *   manager), for estimates / ratings / the header quote block.
 *
 * One asset bundle, three features. `earningsTrend`, `recommendationTrend`,
 * `upgradeDowngradeHistory`, `calendarEvents`, `earningsHistory`, `financialData`
 * and `price` all arrive in a single `quoteSummary` call, so estimates, ratings
 * and the header share one cache entry and one upstream request. Splitting them
 * would triple the call count for no gain — and, worse, let the three panels
 * disagree about the same symbol.
 */
import type {
  EstimatesPayload,
  FxPayload,
  MetricInputs,
  QuoteOverview,
  RatingsFullPayload,
  StatementsPayload,
  StatementPeriod,
} from '../shared/types';
import {
  ALL_LINE_NAMES,
  buildStatements,
  metricInputsFor,
  parseTimeseries,
  prefixFor,
  type TimeseriesBlocks,
} from '../shared/statements';
import { deriveMetrics } from '../shared/metrics';
import {
  buildForecastMatrix,
  forwardLevel,
  growthBetween,
  parseCalendar,
  parseEarningsHistory,
  parseEarningsTrend,
  parseRatings,
  type MatrixRow,
  parseUpgrades,
  periodMatrix,
  priceTargetView,
} from '../shared/estimates';
import { DISPLAY_CURRENCIES, FX_SYMBOLS, usdPerUnit } from '../shared/fx';
import { getKv, setKv, type Db } from './db';
import { analystSummaryPath, fetchProviderJson, fetchQuery2Json, timeseriesPath } from './provider';
import { loadSeries } from './market-service';

/** Freshness windows, in seconds. */
export const TTL3 = {
  /** Statements change a few times a year; a long TTL is honest and cheap. */
  statements: 12 * 3600,
  /** The analyst bundle (estimates + ratings + header quote). */
  analyst: 3600,
  /** USD cross-rates move daily at most. */
  fx: 6 * 3600,
} as const;

/** How many recent firm actions the ratings payload carries. */
const ACTION_LIMIT = 25;

/** How many further-year columns the estimates matrix renders as `—`. */
const EXTRA_YEAR_COLUMNS = 2;

export interface Service3Opts {
  force?: boolean;
  now?: number;
  fetchImpl?: typeof fetch;
}

const DAY = 86400;

function nowOf(opts: Service3Opts): number {
  return opts.now ?? Math.floor(Date.now() / 1000);
}

/**
 * The `period1`/`period2` window for the statement fetch.
 *
 * LTM needs four quarters *plus* the look-back for its first column (up to seven
 * quarters), so it shares the quarterly window. Annual only ever shows four
 * fiscal years, but the window is generous enough to survive a company with a
 * shifted fiscal calendar.
 */
function windowFor(period: StatementPeriod, now: number): { period1: number; period2: number } {
  const years = period === 'annual' ? 6 : 3;
  return { period1: now - years * 366 * DAY, period2: now + DAY };
}

/**
 * Load one statement set (income / balance / cash flow) for a period.
 *
 * `ltm` reads the **quarterly** series and aggregates it (see
 * `shared/statements.ts`): Yahoo's own `trailing` rows exist but are sparse —
 * AAPL carries only two TTM points with a gap — so a computed four-quarter sum
 * is both more available and more explainable. It is labelled "LTM (computed)"
 * in the UI, never passed off as reported.
 */
export async function loadStatements(
  db: Db,
  rawSymbol: string,
  period: StatementPeriod = 'annual',
  opts: Service3Opts = {},
): Promise<StatementsPayload> {
  const symbol = rawSymbol.trim().toUpperCase();
  const now = nowOf(opts);
  const prefix = prefixFor(period);
  // The key carries the **requested period**, not just its fetch prefix.
  // `quarterly` and `ltm` read the same upstream series but assemble into
  // different payloads (LTM sums four quarters), so one shared entry made the
  // second request serve the first request's shape — the LTM table arriving
  // labelled `quarterly` (found by the §D.3 live check, 2026-11-06).
  const key = `statements:${symbol}:${period}`;
  const cached = getKv<StatementsPayload>(db, key);
  const fresh = cached !== null && now - cached.updatedAt <= TTL3.statements;

  if (!opts.force && fresh && cached) {
    return relabel(cached.payload, cached.updatedAt, 'cache');
  }

  const types = ALL_LINE_NAMES.map((n) => `${prefix}${n}`);
  const win = windowFor(period, now);
  const json = await fetchQuery2Json(timeseriesPath(symbol, types, win.period1, win.period2), {
    fetchImpl: opts.fetchImpl,
  });

  if (json) {
    const parsed = parseTimeseries(json);
    if (hasAnyRows(parsed)) {
      const payload = await buildPayload(db, symbol, period, parsed, now, opts);
      // Only cache a parse that actually produced rows: caching an empty envelope
      // turns a transient hiccup into twelve hours of "no data" (the same rule
      // `loadFundamentals` applies).
      setKv(db, key, payload, now);
      return payload;
    }
  }

  if (cached) {
    return relabel(cached.payload, cached.updatedAt, 'stale-cache');
  }
  return emptyStatements(symbol, period);
}

/** True when at least one requested series came back with a row. */
function hasAnyRows(blocks: TimeseriesBlocks): boolean {
  return Object.values(blocks.blocks).some((rows) => rows.length > 0);
}

/**
 * Build a payload from freshly-parsed blocks.
 *
 * The price used for the multiples comes from the chart endpoint (crumb-free and
 * more reliable than the intermittently-empty `price` module, RECON-PHASE3 §3).
 * A failure there is not fatal: every market-cap-derived metric simply becomes
 * `—`, which is the honest outcome — better a dash than a stale price silently
 * multiplied into a P/E.
 */
async function buildPayload(
  db: Db,
  symbol: string,
  period: StatementPeriod,
  blocks: TimeseriesBlocks,
  now: number,
  opts: Service3Opts,
): Promise<StatementsPayload> {
  const price = await loadPrice(db, symbol, opts);
  return assemble(symbol, period, blocks, price, now, 'live', null);
}

/** Re-label a cached payload with the provenance of *this* read. */
function relabel(
  payload: StatementsPayload,
  updatedAt: number,
  source: string,
): StatementsPayload {
  return { ...payload, source, lastUpdated: payload.lastUpdated ?? updatedAt };
}

/** The table + metric assembly, shared by the live and cached paths. */
function assemble(
  symbol: string,
  period: StatementPeriod,
  blocks: TimeseriesBlocks,
  price: number | null,
  now: number,
  source: string,
  note: string | null,
): StatementsPayload {
  const set = buildStatements(blocks, period);
  const inputs: MetricInputs = metricInputsFor(blocks, set);
  const metrics = deriveMetrics(inputs, price);
  return {
    symbol,
    period,
    currency: set.income.currency ?? set.balance.currency ?? set.cashflow.currency ?? null,
    periodType: set.income.periodType ?? set.balance.periodType ?? set.cashflow.periodType ?? null,
    income: set.income,
    balance: set.balance,
    cashflow: set.cashflow,
    metrics,
    inputs,
    price,
    source,
    lastUpdated: now,
    note,
  };
}

function emptyStatements(symbol: string, period: StatementPeriod): StatementsPayload {
  return assemble(symbol, period, { blocks: {}, status: 0 }, null, Date.now() / 1000, 'unavailable', 'note.statementsUnavailable');
}

/** Latest traded price, or null. Never throws. */
async function loadPrice(db: Db, symbol: string, opts: Service3Opts): Promise<number | null> {
  try {
    const series = await loadSeries(db, symbol, { range: '5d', interval: '1d', fetchImpl: opts.fetchImpl });
    const last = series.meta.lastPrice ?? series.candles.at(-1)?.close ?? null;
    return last !== null && Number.isFinite(last) ? last : null;
  } catch {
    return null;
  }
}

/* ---------------------------------------------------------------- analyst --- */

/** The three feature payloads that share one `quoteSummary` call. */
export interface AnalystBundle {
  estimates: Omit<EstimatesPayload, 'symbol' | 'source' | 'lastUpdated' | 'note'>;
  ratings: Omit<RatingsFullPayload, 'symbol' | 'source' | 'lastUpdated' | 'note'>;
  quote: Omit<QuoteOverview, 'symbol' | 'source' | 'lastUpdated' | 'note'>;
}

interface CachedBundle {
  bundle: AnalystBundle;
}

/**
 * Fetch (or reuse) the analyst bundle.
 *
 * Returns `null` when neither the network nor the cache can supply it, so each
 * caller can produce its own honest empty payload with the right note key.
 */
async function loadAnalystBundle(
  db: Db,
  symbol: string,
  opts: Service3Opts,
): Promise<{ bundle: AnalystBundle; source: string; lastUpdated: number | null } | null> {
  const now = nowOf(opts);
  const key = `analyst:${symbol}`;
  const cached = getKv<CachedBundle>(db, key);
  const fresh = cached !== null && now - cached.updatedAt <= TTL3.analyst;

  if (!opts.force && fresh && cached) {
    return { bundle: cached.payload.bundle, source: 'cache', lastUpdated: cached.updatedAt };
  }

  const res = await fetchProviderJson(analystSummaryPath(symbol), { fetchImpl: opts.fetchImpl });
  if (res) {
    const bundle = mapAnalystBundle(res.json, db, symbol, now, opts);
    if (isUsableBundle(bundle)) {
      setKv(db, key, { bundle } satisfies CachedBundle, now);
      return { bundle, source: 'live', lastUpdated: now };
    }
  }

  if (cached) {
    return { bundle: cached.payload.bundle, source: 'stale-cache', lastUpdated: cached.updatedAt };
  }
  return null;
}

/** Does this bundle carry anything a user could act on? */
function isUsableBundle(bundle: AnalystBundle): boolean {
  const e = bundle.estimates;
  const r = bundle.ratings;
  return (
    e.periods.some((p) => p.eps.avg !== null || p.revenue.avg !== null) ||
    e.calendar.nextEarningsAt !== null ||
    e.history.length > 0 ||
    r.ratings.buckets.length > 0 ||
    r.ratings.targetMean !== null ||
    r.price !== null
  );
}

/**
 * Map one `quoteSummary` answer into the three payload fragments.
 *
 * Blocking on the price history here would make the estimates panel wait on a
 * chart fetch for a figure it does not need, so the pure mapping is done first
 * and the derived (price-dependent) values are filled in by the callers.
 */
function mapAnalystBundle(
  json: unknown,
  db: Db,
  symbol: string,
  now: number,
  opts: Service3Opts,
): AnalystBundle {
  const periods = parseEarningsTrend(json);
  const calendar = parseCalendar(json);
  const history = parseEarningsHistory(json);
  const ratings = parseRatings(json);
  const price = ratings.currentPrice ?? readPrice(json);

  const currency =
    periods.find((p) => p.eps.currency)?.eps.currency ??
    periods.find((p) => p.revenue.currency)?.revenue.currency ??
    readString(json, 'financialData', 'financialCurrency') ??
    readString(json, 'price', 'currency');

  const pm = periodMatrix(periods, EXTRA_YEAR_COLUMNS);
  const target = priceTargetView(ratings, price);
  const forward = forwardLevel(periods);

  // The matrix is assembled by `loadEstimates`, which guarantees the quarterly
  // statements are present first (deterministic, independent of tab order).
  // Nothing here may guess a base — an annual figure is not a quarter.
  const matrix: MatrixRow[] = [];

  const quoteType = readString(json, 'price', 'quoteType') ?? readRootString(json, 'quoteType');
  const marketState = readString(json, 'price', 'marketState');
  const exchange = readString(json, 'price', 'exchangeName') ?? readString(json, 'price', 'fullExchangeName');
  const name = readString(json, 'price', 'longName') ?? readString(json, 'price', 'shortName');
  const sector = readString(json, 'assetProfile', 'sector') ?? readString(json, 'assetProfile', 'sectorDisp');
  const industry = readString(json, 'assetProfile', 'industry') ?? readString(json, 'assetProfile', 'industryDisp');

  const bundle: AnalystBundle = {
    estimates: {
      periods,
      extraYears: pm.extraYears,
      calendar,
      history,
      matrix,
      forward,
      /** EV for the estimate rows' EV multiple; derived from the *latest*
       *  cached statements, so it is the same EV the statements panel shows. */
      ev: evFor(db, symbol),
      price,
      currency,
    },
    ratings: {
      ratings,
      target,
      actions: parseUpgrades(json, ACTION_LIMIT),
      oneYearReturn: null, // filled by `loadRatings` from real price history
      price,
      currency,
    },
    quote: {
      name,
      price,
      change: readNumber(json, 'price', 'regularMarketChange'),
      changePercent: readNumber(json, 'price', 'regularMarketChangePercent'),
      volume: readNumber(json, 'price', 'regularMarketVolume'),
      currency: readString(json, 'price', 'currency'),
      exchange,
      marketState,
      previousClose:
        readNumber(json, 'summaryDetail', 'previousClose') ?? readNumber(json, 'price', 'regularMarketPreviousClose'),
      dayHigh:
        readNumber(json, 'price', 'regularMarketDayHigh') ?? readNumber(json, 'summaryDetail', 'dayHigh'),
      dayLow: readNumber(json, 'price', 'regularMarketDayLow') ?? readNumber(json, 'summaryDetail', 'dayLow'),
      fiftyTwoWeekHigh:
        readNumber(json, 'summaryDetail', 'fiftyTwoWeekHigh') ?? readNumber(json, 'price', 'fiftyTwoWeekHigh'),
      fiftyTwoWeekLow:
        readNumber(json, 'summaryDetail', 'fiftyTwoWeekLow') ?? readNumber(json, 'price', 'fiftyTwoWeekLow'),
      // Pre/post are only ever populated when the provider actually published
      // them (RECON-PHASE3 §3: usually `{}`/null) — the UI omits the row otherwise.
      preMarket: readNumber(json, 'price', 'preMarketPrice'),
      postMarket: readNumber(json, 'price', 'postMarketPrice'),
      marketCap: readNumber(json, 'price', 'marketCap') ?? readNumber(json, 'summaryDetail', 'marketCap'),
      trailingPE: readNumber(json, 'summaryDetail', 'trailingPE'),
      forwardPE:
        readNumber(json, 'summaryDetail', 'forwardPE') ?? readNumber(json, 'defaultKeyStatistics', 'forwardPE'),
      sector,
      industry,
      quoteType,
    },
  };
  void now;
  void opts;
  return bundle;
}

/**
 * The quarterly statements payload, fetched if it is not already cached.
 *
 * The matrix needs the latest reported quarter whether or not the user has
 * opened the Statements panel, so the honest and deterministic thing is to go
 * and get it rather than show a different answer depending on navigation order.
 * A failure simply yields `null` — the actual column then shows `—`.
 */
async function ensureQuarterlyStatements(
  db: Db,
  symbol: string,
  opts: Service3Opts,
): Promise<StatementsPayload | null> {
  const now = nowOf(opts);
  const cached = getKv<StatementsPayload>(db, `statements:${symbol}:quarterly`);
  if (cached && now - cached.updatedAt <= TTL3.statements) return cached.payload;
  const fresh = await loadStatements(db, symbol, 'quarterly', opts);
  return fresh.income.rows.length > 0 || fresh.inputs.revenue !== null ? fresh : cached?.payload ?? null;
}

/** The four matrix metrics, read verbatim from one statements payload. */
function rowValues(
  p: StatementsPayload | null,
): { revenue: number | null; ebitda: number | null; ebit: number | null; dilutedEps: number | null } {
  if (!p) return { revenue: null, ebitda: null, ebit: null, dilutedEps: null };
  return {
    revenue: p.inputs.revenue,
    ebitda: p.inputs.ebitda,
    ebit: p.inputs.ebit,
    dilutedEps: p.inputs.dilutedEps,
  };
}

/**
 * The **latest reported quarter** from a quarterly statements payload.
 *
 * Currently that is the newest column (`inputs` is already the latest). The
 * helper returns the quarter label so the result is explicit and so a future
 * change can pin which quarter the base is without touching the caller.
 */
function latestQuarterRow(p: StatementsPayload | null): { label: string; cells: StatementsPayload } | null {
  if (!p) return null;
  const latest = p.income.columns[p.income.columns.length - 1] ?? null;
  return { label: latest ?? 'unknown', cells: p };
}

/**
 * The enterprise value the statements panel computed, read straight from the
 * cache it wrote.
 *
 * Returning it here (rather than recomputing) is deliberate: the estimate
 * table's EV multiple and the statements panel's EV must be the same number, and
 * the only way to guarantee that is to read the one the statements endpoint
 * already derived. `null` on a cache miss — the multiple then shows `—`.
 */
function evFor(db: Db, symbol: string): number | null {
  for (const period of ['ltm', 'quarterly', 'annual'] as const) {
    const hit = getKv<StatementsPayload>(db, `statements:${symbol}:${period}`);
    if (hit && hit.payload.metrics.ev !== null) return hit.payload.metrics.ev;
  }
  return null;
}

/** `GET /api/estimates/:sym` */
export async function loadEstimates(db: Db, rawSymbol: string, opts: Service3Opts = {}): Promise<EstimatesPayload> {
  const symbol = rawSymbol.trim().toUpperCase();
  const hit = await loadAnalystBundle(db, symbol, opts);
  if (hit) {
    // The matrix is assembled HERE, not in `mapAnalystBundle`, and the quarterly
    // statements are guaranteed present first. That is what makes the result
    // independent of which statement tab the user opened first: PATH A (annual
    // cached only) fetches the quarter now, PATH B (quarter already cached) reads
    // it, and both end up with the same quarter against the same forecast.
    const quarter = await ensureQuarterlyStatements(db, symbol, opts);
    const matrix = buildForecastMatrix({
      forecast: hit.bundle.estimates.periods.find((p) => p.id === '0q') ?? hit.bundle.estimates.periods[0] ?? null,
      actual: rowValues(quarter),
      asOf: quarter ? latestQuarterRow(quarter)?.label ?? null : null,
    });
    return {
      symbol,
      ...hit.bundle.estimates,
      matrix,
      source: hit.source,
      lastUpdated: hit.lastUpdated,
      note: hit.source === 'stale-cache' ? 'note.estimatesUnreachableCached' : null,
    };
  }
  return {
    symbol,
    periods: [],
    extraYears: 0,
    calendar: {
      nextEarningsAt: null,
      nextEarningsLabel: null,
      isEstimate: false,
      epsAvg: null,
      epsLow: null,
      epsHigh: null,
      revenueAvg: null,
      revenueLow: null,
      revenueHigh: null,
    },
    history: [],
    matrix: [],
    forward: { eps: null, revenue: null, quarters: [], basis: null },
    ev: null,
    price: null,
    currency: null,
    source: 'unavailable',
    lastUpdated: null,
    note: 'note.estimatesUnavailable',
  };
}

/** `GET /api/ratings/:sym` */
export async function loadRatings(db: Db, rawSymbol: string, opts: Service3Opts = {}): Promise<RatingsFullPayload> {
  const symbol = rawSymbol.trim().toUpperCase();
  const hit = await loadAnalystBundle(db, symbol, opts);

  // The trailing-1-year return needs real price history (there is no analyst
  // series to take it from). It is a separate, crumb-free fetch and a failure
  // only costs that one row — never the whole panel.
  const oneYearReturn = await loadOneYearReturn(db, symbol, opts);

  if (hit) {
    return {
      symbol,
      ...hit.bundle.ratings,
      oneYearReturn,
      source: hit.source,
      lastUpdated: hit.lastUpdated,
      note: hit.source === 'stale-cache' ? 'note.ratingsUnreachableCached' : null,
    };
  }
  return {
    symbol,
    ratings: {
      buckets: [],
      recommendationMean: null,
      recommendationKey: null,
      numberOfAnalystOpinions: null,
      targetLow: null,
      targetMean: null,
      targetMedian: null,
      targetHigh: null,
      currentPrice: null,
    },
    target: { low: null, mean: null, median: null, high: null, upsidePct: null, analysts: null },
    actions: [],
    oneYearReturn,
    price: null,
    currency: null,
    source: 'unavailable',
    lastUpdated: null,
    note: 'note.ratingsUnavailable',
  };
}

/**
 * `GET /api/quotes/:sym` — the §C.1 header facts.
 *
 * Falls back to the chart meta for anything the analyst bundle could not supply,
 * because the `price` module is the least reliable part of `quoteSummary`
 * (RECON-PHASE3 §3: intermittently empty). The chart endpoint is crumb-free and
 * carries the price band the header actually shows.
 */
export async function loadQuoteOverview(
  db: Db,
  rawSymbol: string,
  opts: Service3Opts = {},
): Promise<QuoteOverview> {
  const symbol = rawSymbol.trim().toUpperCase();
  const hit = await loadAnalystBundle(db, symbol, opts);
  const base = hit?.bundle.quote ?? emptyQuote();

  // Chart meta is the tie-breaker for the live price band when the bundle is
  // thin. Both sources are real; we prefer whichever actually carries a number.
  let chartMeta: { price: number | null; volume: number | null; name: string | null; currency: string | null; exchange: string | null; high: number | null; low: number | null } | null = null;
  try {
    const series = await loadSeries(db, symbol, { range: '5d', interval: '1d', fetchImpl: opts.fetchImpl });
    chartMeta = {
      price: series.meta.lastPrice,
      volume: series.meta.volume,
      name: series.meta.name || null,
      currency: series.meta.currency || null,
      exchange: series.meta.exchange || null,
      high: series.meta.fiftyTwoWeekHigh,
      low: series.meta.fiftyTwoWeekLow,
    };
  } catch {
    chartMeta = null;
  }

  const merged: QuoteOverview = {
    symbol,
    name: base.name ?? chartMeta?.name ?? null,
    price: base.price ?? chartMeta?.price ?? null,
    change: base.change,
    changePercent: base.changePercent,
    volume: base.volume ?? chartMeta?.volume ?? null,
    currency: base.currency ?? chartMeta?.currency ?? null,
    exchange: base.exchange ?? chartMeta?.exchange ?? null,
    marketState: base.marketState,
    previousClose: base.previousClose,
    dayHigh: base.dayHigh,
    dayLow: base.dayLow,
    fiftyTwoWeekHigh: base.fiftyTwoWeekHigh ?? chartMeta?.high ?? null,
    fiftyTwoWeekLow: base.fiftyTwoWeekLow ?? chartMeta?.low ?? null,
    preMarket: base.preMarket,
    postMarket: base.postMarket,
    marketCap: base.marketCap,
    trailingPE: base.trailingPE,
    forwardPE: base.forwardPE,
    sector: base.sector,
    industry: base.industry,
    quoteType: base.quoteType,
    source: hit?.source ?? 'live',
    lastUpdated: hit?.lastUpdated ?? null,
    note: hit?.source === 'stale-cache' ? 'note.quotesUnreachableCached' : null,
  };
  return merged;
}

function emptyQuote(): AnalystBundle['quote'] {
  return {
    name: null,
    price: null,
    change: null,
    changePercent: null,
    volume: null,
    currency: null,
    exchange: null,
    marketState: null,
    previousClose: null,
    dayHigh: null,
    dayLow: null,
    fiftyTwoWeekHigh: null,
    fiftyTwoWeekLow: null,
    preMarket: null,
    postMarket: null,
    marketCap: null,
    trailingPE: null,
    forwardPE: null,
    sector: null,
    industry: null,
    quoteType: null,
  };
}

/**
 * Trailing 1-year price return from real history, or null.
 *
 * `loadSeries` promises "a caller asking for range X gets range X", but its
 * windowing has one escape hatch: `windowCandles` returns the input series
 * **unfiltered** when NOTHING falls inside the window (`windowCandles` keeps
 * the shared chart paths working, so it must not become an error). For a symbol
 * whose newest cached bar is already older than `now - 1y` — an extended halt
 * or a delisting — that means `series.candles[0]` is a *decade*-old close and
 * the difference spans the whole stored history. Presented as the "trailing
 * 1-year return" that is a wrong number even on a `stale-cache` row, so this
 * call site re-windows for itself rather than trusting the series.
 *
 * Requiring at least two in-window points keeps the arithmetic honest: fewer
 * than two and there is no 1-year change to report, so we return `null` and the
 * row renders its existing `—` instead of an invented figure. The fix lives
 * HERE, not in `windowCandles`, so the chart paths keep serving honest (if
 * wide) stale data instead of turning a soft degradation into an error.
 */
async function loadOneYearReturn(db: Db, symbol: string, opts: Service3Opts): Promise<number | null> {
  try {
    // Pass the effective `now` down so `loadSeries` windows with the SAME clock
    // this function filters against; a mismatch would let the series window and
    // the cutoff disagree about where "one year ago" is.
    const now = nowOf(opts);
    const series = await loadSeries(db, symbol, { range: '1y', interval: '1d', now, fetchImpl: opts.fetchImpl });
    const cutoff = now - 365 * DAY;
    const inWindow = series.candles.filter((c) => c.time >= cutoff);
    if (inWindow.length < 2) return null;
    return growthBetween(inWindow[0].close, inWindow.at(-1)!.close);
  } catch {
    return null;
  }
}

/* --------------------------------------------------------------------- fx --- */

/**
 * `GET /api/fx?to=HKD,EUR` — USD cross-rates for the display switch (§A.4).
 *
 * Every rate is fetched from `query2`'s chart endpoint (crumb-free). A pair we
 * cannot fetch is simply **absent** from `perUsd`, and `shared/fx.ts` then falls
 * back to the source currency and says so — it never invents a rate.
 */
export async function loadFx(db: Db, targets: readonly string[] = [], opts: Service3Opts = {}): Promise<FxPayload> {
  const now = nowOf(opts);
  const wanted = [...new Set(targets.map((c) => c.trim().toUpperCase()))].filter(
    (c) => c && c !== 'USD' && (DISPLAY_CURRENCIES as readonly string[]).includes(c),
  );

  const perUsd: Record<string, number> = { USD: 1 };
  let asOf: number | null = null;
  let anyFetched = false;

  for (const code of wanted) {
    const pair = FX_SYMBOLS[code];
    if (!pair) continue;
    const key = `fx:${pair}`;
    const cached = getKv<{ quote: number; at: number }>(db, key);
    const fresh = cached !== null && now - cached.updatedAt <= TTL3.fx;
    if (!opts.force && fresh && cached) {
      const rate = usdPerUnit(code, cached.payload.quote);
      if (rate !== null) {
        perUsd[code] = rate;
        asOf = Math.max(asOf ?? 0, cached.payload.at);
        anyFetched = true;
      }
      continue;
    }
    const json = await fetchQuery2Json(
      `/v8/finance/chart/${encodeURIComponent(pair)}?range=1d&interval=1d`,
      { fetchImpl: opts.fetchImpl },
    );
    const quote = readChartPrice(json);
    if (quote !== null) {
      const rate = usdPerUnit(code, quote);
      if (rate !== null) {
        perUsd[code] = rate;
        setKv(db, key, { quote, at: now }, now);
        asOf = Math.max(asOf ?? 0, now);
        anyFetched = true;
        continue;
      }
    }
    // Rate not retrievable: serve the last one we had, if any.
    if (cached) {
      const rate = usdPerUnit(code, cached.payload.quote);
      if (rate !== null) {
        perUsd[code] = rate;
        asOf = Math.max(asOf ?? 0, cached.payload.at);
        anyFetched = true;
      }
    }
  }

  return {
    perUsd,
    asOf,
    unavailable: !anyFetched && wanted.length > 0,
    source: anyFetched ? 'live' : wanted.length === 0 ? 'live' : 'unavailable',
    lastUpdated: anyFetched ? now : null,
    note: !anyFetched && wanted.length > 0 ? 'note.fxUnavailable' : null,
  };
}

function readChartPrice(json: unknown): number | null {
  const r = (json as { chart?: { result?: Array<{ meta?: Record<string, unknown> }> } })?.chart?.result?.[0];
  const meta = r?.meta;
  if (!meta) return null;
  const v = meta.regularMarketPrice;
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/* ------------------------------------------------------------ json helpers -- */

function moduleOf(json: unknown, name: string): Record<string, unknown> | null {
  const r = (json as { quoteSummary?: { result?: Array<Record<string, unknown>> | null } })?.quoteSummary?.result?.[0];
  const m = r?.[name];
  return m && typeof m === 'object' ? (m as Record<string, unknown>) : null;
}

function readNumber(json: unknown, mod: string, key: string): number | null {
  const v = moduleOf(json, mod)?.[key];
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (v && typeof v === 'object') {
    const raw = (v as { raw?: unknown }).raw;
    return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
  }
  return null;
}

function readString(json: unknown, mod: string, key: string): string | null {
  const v = moduleOf(json, mod)?.[key];
  if (typeof v === 'string') {
    const s = v.trim();
    return s ? s : null;
  }
  return null;
}

/** Read a string on `quoteSummary.result[0]` itself (outside any named module). */
function readRootString(json: unknown, key: string): string | null {
  const r = (json as { quoteSummary?: { result?: Array<Record<string, unknown>> | null } })?.quoteSummary?.result?.[0];
  const v = r?.[key];
  if (typeof v === 'string') {
    const s = v.trim();
    return s ? s : null;
  }
  return null;
}

function readPrice(json: unknown): number | null {
  const v = readNumber(json, 'price', 'regularMarketPrice');
  return v ?? readNumber(json, 'financialData', 'currentPrice');
}
