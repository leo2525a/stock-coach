/**
 * Shared type contract between the Express backend and the React frontend.
 *
 * These types are the single source of truth for the wire format of the API and
 * for the pure functions (indicators, signals, formatting) that both sides use.
 */

/** A timeframe the user can request. Data availability depends on Yahoo Finance. */
export type Interval = '1m' | '5m' | '15m' | '1h' | '1d' | '1w' | '1mo';

/** Every interval we support, in ascending order of granularity. */
export const INTERVALS: readonly Interval[] = ['1m', '5m', '15m', '1h', '1d', '1w', '1mo'];

/**
 * Interval metadata: the short code the user scans for, and the dictionary key
 * for its plain-language description (used as the button `title`). The code
 * stays Latin (`1D`, `1m`) because that is the universal trading vocabulary;
 * the description is a key so it renders as Chinese by default.
 */
export interface IntervalInfo {
  id: Interval;
  label: string;
  /** Dictionary key for the plain-language description, not the copy itself. */
  hintKey: string;
}

export const INTERVAL_INFO: readonly IntervalInfo[] = [
  { id: '1m', label: '1m', hintKey: 'chart.intervalHint.1m' },
  { id: '5m', label: '5m', hintKey: 'chart.intervalHint.5m' },
  { id: '15m', label: '15m', hintKey: 'chart.intervalHint.15m' },
  { id: '1h', label: '1H', hintKey: 'chart.intervalHint.1h' },
  { id: '1d', label: '1D', hintKey: 'chart.intervalHint.1d' },
  { id: '1w', label: '1W', hintKey: 'chart.intervalHint.1w' },
  { id: '1mo', label: '1M', hintKey: 'chart.intervalHint.1mo' },
];

/** A single OHLCV candle. `time` is a UNIX timestamp in **seconds** (UTC). */
export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** A single point on an indicator line. `time` is UTC seconds. */
export interface LinePoint {
  time: number;
  value: number;
}

/** Bollinger band triple, aligned 1:1 with the tail of the candle array. */
export interface BandPoint {
  time: number;
  upper: number;
  middle: number;
  lower: number;
}

/** MACD triple, aligned 1:1 with the tail of the candle array. */
export interface MacdPoint {
  time: number;
  macd: number;
  signal: number;
  histogram: number;
}

/**
 * All computed indicator series for one (symbol, interval) pair.
 *
 * Every line is **tail-aligned** to the candle array: `values[i]` corresponds to
 * `candles[candles.length - values.length + i]`. This is deliberate — the
 * libraries return shorter arrays and aligning by tail keeps the x-axis honest.
 * Use `alignIndex` to look up candles, or just render with `time` directly.
 */
export interface IndicatorSeries {
  sma20: LinePoint[];
  sma50: LinePoint[];
  sma200: LinePoint[];
  ema12: LinePoint[];
  ema26: LinePoint[];
  bb: BandPoint[];
  rsi14: LinePoint[];
  macd: MacdPoint[];
}

/** Metadata for a symbol, sourced from Yahoo Finance chart meta. */
export interface SymbolMeta {
  symbol: string;
  name: string;
  currency: string;
  exchange: string;
  exchangeTimezone: string;
  lastPrice: number | null;
  previousClose: number | null;
  change: number | null;
  changePercent: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
  volume: number | null;
  /** Market time from the provider, UNIX seconds UTC. */
  marketTime: number | null;
}

/** Where a payload's bytes came from. Never fake this — the UI trusts it. */
export type DataSource = 'live' | 'cache' | 'stale-cache';

/** A full market-data payload: candles + indicators + provenance. */
export interface MarketData {
  symbol: string;
  interval: Interval;
  candles: Candle[];
  indicators: IndicatorSeries;
  meta: SymbolMeta;
  source: DataSource;
  /** UNIX seconds (UTC) when the backend last successfully pulled from Yahoo. */
  lastUpdated: number | null;
  /** UNIX seconds (UTC) at which the backend handled this request. */
  fetchedAt: number;
  /**
   * Translation key for the note shown when `source !== 'live'`. The UI renders
   * `t(note)`, so this is a key like `note.marketLiveFetchFailed`, never prose.
   */
  note: string | null;
  /** English detail for logs only; never rendered. */
  noteText?: string | null;
  /** Number of candles returned. */
  count: number;
}

/** Named candle ranges for time range buttons. */
export interface RangeInfo {
  id: string;
  label: string;
  range: string;
  interval: Interval;
}

export const RANGE_INFO: readonly RangeInfo[] = [
  { id: '1d', label: '1D', range: '1d', interval: '5m' },
  { id: '5d', label: '5D', range: '5d', interval: '15m' },
  { id: '1mo', label: '1M', range: '1mo', interval: '1h' },
  { id: '3mo', label: '3M', range: '3mo', interval: '1d' },
  { id: '6mo', label: '6M', range: '6mo', interval: '1d' },
  { id: '1y', label: '1Y', range: '1y', interval: '1d' },
  { id: '5y', label: '5Y', range: '5y', interval: '1w' },
  { id: 'max', label: 'MAX', range: 'max', interval: '1mo' },
];

/** Auto interval used when the user picks a range button while in Auto mode. */
export const AUTO_INTERVAL_FOR_RANGE: Record<string, Interval> = {
  '1d': '5m',
  '5d': '15m',
  '1mo': '1h',
  '3mo': '1d',
  '6mo': '1d',
  '1y': '1d',
  '5y': '1w',
  max: '1mo',
};

/** A resolved data window: the range string plus the effective interval. */
export interface ResolvedView {
  range: string;
  interval: Interval;
  /** The symbol's own trading timezone, e.g. 'America/New_York'. */
  timezone: string;
}

/** A watchlist entry as persisted in SQLite. */
export interface WatchlistItem {
  symbol: string;
  name: string | null;
  position: number;
  addedAt: number;
}

/**
 * Failure codes the API can return. The UI translates `code` (see
 * `shared/api-errors.ts`); `error` is the English diagnostic for logs.
 */
export type ApiErrorCode =
  | 'BAD_SYMBOL'
  | 'NOT_FOUND'
  | 'NOT_IN_WATCHLIST'
  | 'BAD_REQUEST'
  | 'BAD_RESPONSE'
  | 'INTERNAL_ERROR'
  | 'NETWORK'
  | 'UPSTREAM_ERROR';

/** Server response envelope. `ok:false` always carries a reason. */
export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: ApiErrorCode | string };

/** One row of the watchlist price strip. */
export interface WatchQuote {
  symbol: string;
  name: string;
  lastPrice: number | null;
  change: number | null;
  changePercent: number | null;
  currency: string;
  /** 'live' | 'cache' | 'stale-cache' | 'unavailable' */
  source: string;
  stale: boolean;
  lastUpdated: number | null;
}

/** A search hit from the symbol lookup. */
export interface SymbolSearchResult {
  symbol: string;
  name: string;
  exchange: string;
  type: string;
  /** Raw Yahoo `quoteType` (EQUITY / ETF / …), used by the categoriser. */
  quoteType?: string;
  sector?: string | null;
  industry?: string | null;
}

// ---------------------------------------------------------------------------
// Phase 2 — categorisation (SPEC-PHASE2 §D)
// ---------------------------------------------------------------------------

/** The two buckets a beginner actually needs; everything else is "other". */
export type AssetType = 'stock' | 'etf' | 'other';

/**
 * A symbol's classification, derived only from real provider metadata.
 *
 * Every field is optional by design: Yahoo genuinely does not publish a sector
 * for an ETF, and the honest answer there is "unknown", never a guess.
 */
export interface SymbolCategory {
  symbol: string;
  type: AssetType;
  /** Provider `quoteType` verbatim (EQUITY, ETF, …) — kept for tooltips. */
  quoteType: string | null;
  sector: string | null;
  industry: string | null;
  /** Human exchange label, e.g. 'NASDAQ' or 'HKEX'. */
  exchange: string | null;
  /** Raw exchange code, e.g. 'NMS' / 'HKG'. */
  exchangeCode: string | null;
  /**
   * Country of the listing's issuer, when the provider tells us. The search
   * endpoint does **not** return it, so this stays null there and the UI shows
   * the honest Unknown bucket; the dashboard fills it from `assetProfile`.
   */
  country: string | null;
  /** Set when `country` came from the company profile rather than search. */
  countryFromProfile?: boolean;
  currency: string | null;
}

/** Symbol → classification, as returned by `GET /api/categories`. */
export type CategoryMap = Record<string, SymbolCategory>;

/** How the watchlist groups its rows (SPEC-PHASE2 §D). */
export type GroupMode = 'all' | 'sector' | 'type' | 'exchange';

/** One rendered group of watchlist rows. */
export interface CategoryGroup {
  /** Stable id for React keys — never translated. */
  id: string;
  /** Raw provider value, or null for the "unknown" bucket. */
  raw: string | null;
  symbols: string[];
}

// ---------------------------------------------------------------------------
// Phase 2 — fundamentals & company profile (SPEC-PHASE2 §E)
// ---------------------------------------------------------------------------

/** Company profile block, sourced from `quoteSummary.assetProfile`. */
export interface CompanyProfile {
  sector: string | null;
  industry: string | null;
  country: string | null;
  website: string | null;
  fullTimeEmployees: number | null;
  /** Provider's own one-paragraph business description. */
  summary: string | null;
}

/** Balance-sheet / valuation numbers, all nullable — never invented. */
export interface KeyStats {
  marketCap: number | null;
  trailingPE: number | null;
  forwardPE: number | null;
  /** Fraction, e.g. 0.0031 = 0.31%. */
  dividendYield: number | null;
  beta: number | null;
  priceToBook: number | null;
  trailingEps: number | null;
  forwardEps: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  previousClose: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
  volume: number | null;
  averageVolume: number | null;
}

/**
 * Quality / analyst blocks.
 *
 * The analyst numbers are the *provider's* opinion aggregate; the UI must label
 * them as opinion, never as advice (SPEC-PHASE2 §E).
 */
export interface HealthStats {
  profitMargins: number | null;
  operatingMargins: number | null;
  returnOnEquity: number | null;
  returnOnAssets: number | null;
  revenueGrowth: number | null;
  recommendationKey: string | null;
  recommendationMean: number | null;
  numberOfAnalystOpinions: number | null;
  targetMeanPrice: number | null;
  targetHighPrice: number | null;
  targetLowPrice: number | null;
}

/** Where a fundamentals payload came from. Same honesty rule as MarketData. */
export interface FundamentalsPayload {
  symbol: string;
  profile: CompanyProfile | null;
  keyStats: KeyStats | null;
  health: HealthStats | null;
  /** Provider `quoteType` for this symbol (EQUITY / ETF / …). */
  quoteType: string | null;
  currency: string | null;
  /** 'live' | 'cache' | 'stale-cache' | 'unavailable'. */
  source: string;
  lastUpdated: number | null;
  note: string | null;
}

// ---------------------------------------------------------------------------
// Phase 2 — news (SPEC-PHASE2 §F)
// ---------------------------------------------------------------------------

/** One story from the provider. `link` is always a real provider URL. */
export interface NewsItem {
  id: string;
  title: string;
  publisher: string;
  link: string;
  /** Provider publish time, UNIX seconds UTC. */
  publishedAt: number | null;
  /** Provider-supplied tickers this story references. */
  relatedTickers: string[];
  /**
   * True when the story explicitly lists the requested symbol in
   * `relatedTickers` — the provider's own relevance claim.
   */
  mentionsSymbol: boolean;
}

export interface NewsPayload {
  symbol: string;
  items: NewsItem[];
  source: string;
  lastUpdated: number | null;
  note: string | null;
}

/** Aggregate score across all rule-based signals. */
export interface SignalSummary {
  bullish: number;
  bearish: number;
  neutral: number;
  /** 0-100, 50 = perfectly balanced. */
  score: number;
  /** English verdict — kept because it is part of the Phase 1 wire contract. */
  verdict: string;
  /**
   * Phase 2: the verdict as a stable enum, so the UI can render a translated
   * sentence instead of the engine's English prose.
   */
  verdictVariant: 'bullish' | 'bearish' | 'mixed' | 'noData';
}

/**
 * The /api/signals response body.
 *
 * NOTE: structurally identical to `Signal` in shared/signals.ts; the shape is
 * duplicated as a plain interface here so the wire contract stays readable in
 * one place (and so shared/types.ts does not have to import from signals.ts).
 */
export interface SignalPayloadItem {
  id: string;
  label: string;
  what: string;
  meaning: string;
  watch: string;
  state: 'bullish' | 'bearish' | 'neutral';
  strength: number;
  evidence: string[];
  /**
   * Phase 2 (SPEC-PHASE2 §B): the *variant* of the rule that fired, e.g.
   * `golden` / `death` / `above`, so the UI can pick a translated string
   * instead of rendering the engine's English prose.
   */
  variant: string;
  /**
   * Phase 2: the same evidence lines as `evidence`, but as translation keys +
   * interpolation params. `evidenceI18n[i]` always describes `evidence[i]`, so
   * the two can never drift. `lists` holds sub-lists that are themselves
   * translated keys (e.g. the names of the trend checks that passed).
   */
  evidenceI18n: Array<{
    key: string;
    params: Record<string, string | number>;
    lists?: Record<string, string[]>;
  }>;
  /**
   * Phase 2: scalar facts (ratio, percentB, …) the UI needs for its own
   * translated sentences.
   */
  facts: Record<string, string | number>;
}

export interface SignalsPayload {
  symbol: string;
  interval: Interval;
  range: string;
  signals: SignalPayloadItem[];
  summary: SignalSummary;
  meta: SymbolMeta;
  source: DataSource | string;
  lastUpdated: number | null;
  note: string | null;
  candleCount: number;
}

// ---------------------------------------------------------------------------
// Phase 3 — statements, estimates, ratings, quotes (SPEC-PHASE3 §A)
//
// Every payload carries the same provenance trio the Phase 2 payloads do
// (`source` / `lastUpdated` / `note`), because the UI must be able to say where
// a number came from and whether it is fresh — for a *balance sheet* just as
// much as for a price.
// ---------------------------------------------------------------------------

export type {
  StatementPeriod,
  StatementRow,
  StatementTable,
  StatementSet,
  MetricInputs,
  ReportedPoint,
  Series,
} from './statements';
export type { DerivedMetrics, Metric } from './metrics';
export type {
  EstimatePeriod,
  EstimateSide,
  EstimatePeriodId,
  EarningsCalendar,
  ActualQuarter,
  RatingBucket,
  RatingAction,
  RatingsPayload,
  PriceTargetView,
  MatrixRow,
  PeriodMatrix,
  ForwardLevel,
  ForwardBasis,
} from './estimates';
export type { FxTable, Conversion } from './fx';

import type { StatementPeriod, StatementTable, MetricInputs } from './statements';
import type { DerivedMetrics } from './metrics';
import type {
  EstimatePeriod,
  EarningsCalendar,
  ActualQuarter,
  RatingsPayload,
  PriceTargetView,
  RatingAction,
  MatrixRow,
  ForwardLevel,
} from './estimates';

/** `GET /api/statements/:sym?period=…` */
export interface StatementsPayload {
  symbol: string;
  period: StatementPeriod;
  currency: string | null;
  /** Provider `periodType` the tables were read from ('12M' | '3M'). */
  periodType: string | null;
  income: StatementTable;
  balance: StatementTable;
  cashflow: StatementTable;
  /** The derived ratios, plus the inputs they came from (for the verifier). */
  metrics: DerivedMetrics;
  /** The raw latest-column inputs — exposed so §D.3 can recompute independently. */
  inputs: MetricInputs;
  /** The price the market-cap multiples were computed against. */
  price: number | null;
  source: string;
  lastUpdated: number | null;
  note: string | null;
}

/** `GET /api/estimates/:sym` */
export interface EstimatesPayload {
  symbol: string;
  /** The four periods Yahoo actually carries, in canonical order. */
  periods: EstimatePeriod[];
  /** Further-year columns the UI renders as `—` (there is no data upstream). */
  extraYears: number;
  calendar: EarningsCalendar;
  /** Last reported quarters (actual vs estimate). */
  history: ActualQuarter[];
  /** Next-period forecast vs last actual, per metric. */
  matrix: MatrixRow[];
  /**
   * The single forward estimate level plotted against the price (§C.4).
   *
   * Not a rolling twelve-month figure: see `forwardLevel()` in
   * `shared/estimates.ts` for why the quarters in between cannot be obtained
   * honestly.
   */
  forward: ForwardLevel;
  /**
   * Enterprise value, shared with the statements panel, for the EV multiple.
   * Null when the statements have not been loaded yet.
   */
  ev: number | null;
  /** Current price, for the estimate-level comparison (§C.4). */
  price: number | null;
  currency: string | null;
  source: string;
  lastUpdated: number | null;
  note: string | null;
}

/** `GET /api/ratings/:sym` */
export interface RatingsFullPayload {
  symbol: string;
  ratings: RatingsPayload;
  target: PriceTargetView;
  /** Recent firm actions, newest first, capped server-side. */
  actions: RatingAction[];
  /** Trailing 1-year price return, for §C.5. Null when history is too short. */
  oneYearReturn: number | null;
  price: number | null;
  currency: string | null;
  source: string;
  lastUpdated: number | null;
  note: string | null;
}

/**
 * `GET /api/quotes/:sym` — the §C.1 header facts.
 *
 * `preMarket` / `postMarket` are only ever non-null when the provider actually
 * published them; the UI omits the row when they are null (never `0.00`).
 */
export interface QuoteOverview {
  symbol: string;
  name: string | null;
  price: number | null;
  change: number | null;
  changePercent: number | null;
  volume: number | null;
  currency: string | null;
  exchange: string | null;
  marketState: string | null;
  previousClose: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
  preMarket: number | null;
  postMarket: number | null;
  marketCap: number | null;
  trailingPE: number | null;
  forwardPE: number | null;
  sector: string | null;
  industry: string | null;
  quoteType: string | null;
  source: string;
  lastUpdated: number | null;
  note: string | null;
}

/** `GET /api/fx?to=HKD` — USD cross-rates for the display switch (§A.4). */
export interface FxPayload {
  /** `code → USD per 1 unit`; always contains `USD: 1`. */
  perUsd: Record<string, number>;
  asOf: number | null;
  unavailable: boolean;
  source: string;
  lastUpdated: number | null;
  note: string | null;
}

/**
 * Phase 4 dividend payloads, re-exported so the client imports one module.
 *
 * The *shapes* are defined beside the pure mapping layer that produces them
 * (`shared/dividends.ts`, closed and verified); nothing here redefines them.
 */
export type { DividendPayload, DividendHistoryPayload, DividendSpan } from './dividends';
