import { create } from 'zustand';
import type {
  CategoryMap,
  Candle,
  EstimatesPayload,
  FundamentalsPayload,
  GroupMode,
  IndicatorSeries,
  Interval,
  MarketData,
  NewsPayload,
  QuoteOverview,
  RatingsFullPayload,
  SignalsPayload,
  StatementsPayload,
  StatementPeriod,
  SymbolMeta,
  WatchlistItem,
  WatchQuote,
} from '../shared/types';
import { AUTO_INTERVAL_FOR_RANGE, RANGE_INFO } from '../shared/types';
import type { DividendHistoryPayload, DividendPayload, DividendSpan } from '../shared/dividends';
import { DIVIDEND_SPANS } from '../shared/dividends';
import { normalizeSymbol } from '../shared/format';
import { DEFAULT_LANG, normalizeLang, type Lang } from '../shared/i18n';
import {
  applyTheme,
  persistThemeMode,
  readStoredThemeMode,
  resolveTheme,
  systemPrefersDark,
  type ResolvedTheme,
  type ThemeMode,
} from './theme';
import { DEFAULT_DISPLAY_CURRENCY, type FxTable } from '../shared/fx';
import * as api from './api';

/** The five SPEC §5 screens, plus the Phase 3 analyst workspace and Phase 4 dividends. */
export type Screen = 'dashboard' | 'chart' | 'signals' | 'watchlist' | 'analysts' | 'dividends' | 'help';

export interface ChartView {
  range: string;
  interval: Interval;
  /** When true the interval follows the range button instead of the user's pick. */
  autoInterval: boolean;
}

export interface LoadState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  /** Stable failure code; the UI prefers this over the English `error`. */
  code: string | null;
  /** Bumped on every request so stale responses can be discarded. */
  requestId: number;
}

interface AppState {
  screen: Screen;
  symbol: string;
  view: ChartView;

  market: MarketData | null;
  marketLoad: LoadState;

  signals: SignalsPayload | null;
  signalsLoad: LoadState;

  watchlist: WatchlistItem[];
  quotes: WatchQuote[];
  watchlistError: string | null;

  /** Phase 2: interface language, persisted to localStorage. */
  lang: Lang;
  /** Phase 2: watchlist grouping dimension, persisted. */
  groupMode: GroupMode;
  /** Mobile drawer visibility (below 1181px). The desktop "put away" state is
   * local UI state in the shell, not persisted. */
  sidebarOpen: boolean;

  /* ---------- Phase 5 ---------- */

  /** The user's day/night choice (`system` = follow the OS), persisted. */
  themeMode: ThemeMode;
  /** What is actually painted — always `dark` or `light`, never `system`. */
  theme: ResolvedTheme;

  news: NewsPayload | null;
  newsLoad: LoadState;
  fundamentals: FundamentalsPayload | null;
  fundamentalsLoad: LoadState;
  categories: CategoryMap;
  categoriesLoad: LoadState;

  /* ---------- Phase 3 ---------- */

  /** Which statement column set the financials view is showing. */
  statementsPeriod: StatementPeriod;
  statements: StatementsPayload | null;
  statementsLoad: LoadState;

  estimates: EstimatesPayload | null;
  ratings: RatingsFullPayload | null;
  quoteOverview: QuoteOverview | null;
  /** The analyst bundle (estimates + ratings + header) shares one request. */
  analystLoad: LoadState;

  /* ---------- Phase 4 ---------- */

  /** The §C.1–§C.3 facts, growth and shareholder decomposition for the symbol. */
  dividends: DividendPayload | null;
  dividendsLoad: LoadState;
  /** The span the §C.4/§C.5 history is currently showing. */
  dividendSpan: DividendSpan;
  /** History payloads keyed by `${symbol}|${span}`; the facts are span-independent. */
  dividendHistory: Record<string, DividendHistoryPayload>;
  dividendHistoryLoad: LoadState;

  /** USD cross-rates, fetched on demand for the display-currency switch. */
  fx: FxTable | null;
  /** Real price history keyed by `${symbol}|${range}`, for the §C.5 band chart. */
  histories: Record<string, Candle[]>;
  /** The currency the user chose to read figures in. USD by default (§A.4). */
  displayCurrency: string;
  /** Local-only notes, keyed by symbol (§C.1). Never leaves this device. */
  notes: Record<string, string>;
  /** Local-only price reminders, keyed by symbol (§C.1). */
  alerts: Record<string, number>;

  setScreen: (screen: Screen) => void;
  selectSymbol: (symbol: string) => void;
  setRange: (range: string) => void;
  setInterval: (interval: Interval) => void;
  setAutoInterval: (auto: boolean) => void;
  setLang: (lang: Lang) => void;
  setGroupMode: (mode: GroupMode) => void;
  setSidebarOpen: (open: boolean) => void;
  /** Choose a theme mode; `system` re-arms the OS listener. */
  setThemeMode: (mode: ThemeMode) => void;
  /** Flip between dark and light (the sun/moon button). */
  toggleTheme: () => void;
  /** Re-resolve `system` against a changed OS preference. */
  syncSystemTheme: () => void;

  loadMarket: (opts?: { force?: boolean }) => Promise<void>;
  loadSignals: (opts?: { force?: boolean }) => Promise<void>;
  loadWatchlist: () => Promise<void>;
  loadQuotes: () => Promise<void>;
  loadNews: (opts?: { force?: boolean }) => Promise<void>;
  loadFundamentals: (opts?: { force?: boolean }) => Promise<void>;
  loadCategories: (opts?: { force?: boolean }) => Promise<void>;
  setStatementsPeriod: (period: StatementPeriod) => void;
  loadStatements: (opts?: { force?: boolean; period?: StatementPeriod }) => Promise<void>;
  loadAnalyst: (opts?: { force?: boolean }) => Promise<void>;
  /** The dividend facts/growth/shareholder block (§C.1–§C.3). */
  loadDividends: (opts?: { force?: boolean }) => Promise<void>;
  /**
   * The payments + yield series for one span (§C.4/§C.5).
   *
   * Split from `loadDividends` on purpose: the fact block is a session-bound
   * `quoteSummary` call that can go empty (§A.7), while the history is
   * crumb-free — so a crumb outage must never blank the graphs, and switching
   * span must never re-fetch the facts.
   */
  loadDividendHistory: (span: DividendSpan, opts?: { force?: boolean }) => Promise<void>;
  setDividendSpan: (span: DividendSpan) => void;
  loadFx: (codes?: string[]) => Promise<void>;
  /**
   * Pull a price window for the span charts.
   *
   * Deliberately separate from `loadMarket`: the analyst band needs a *fixed*
   * span (e.g. 6 months) that must not change when the user retunes the main
   * chart, and it must not clobber the chart's candles either.
   */
  loadHistory: (range: string, interval: Interval) => Promise<void>;
  setDisplayCurrency: (code: string) => void;
  setNote: (symbol: string, text: string) => void;
  setAlert: (symbol: string, price: number | null) => void;
  addSymbol: (symbol: string, name?: string) => Promise<{ ok: boolean; error?: string; code?: string }>;
  removeSymbol: (symbol: string) => Promise<void>;
  moveSymbol: (symbol: string, delta: number) => Promise<void>;
  refreshAll: () => Promise<void>;
}

const DEFAULT_RANGE = '1y';
const DEFAULT_INTERVAL: Interval = '1d';

/* ------------------------------------------------------------------
   Persisted UI preferences.

   Every read is defensive: localStorage is user-writable and can hold
   anything, so a bad value degrades to the default instead of throwing on
   boot and leaving a blank page.
   ------------------------------------------------------------------ */

const LANG_KEY = 'stockcoach.lang';
const GROUP_KEY = 'stockcoach.groupBy';
const CURRENCY_KEY = 'stockcoach.displayCurrency';
const NOTES_KEY = 'stockcoach.notes';
const ALERTS_KEY = 'stockcoach.alerts';

function readPersistedCurrency(): string {
  try {
    const raw = localStorage.getItem(CURRENCY_KEY);
    return raw && /^[A-Z]{3}$/.test(raw) ? raw : DEFAULT_DISPLAY_CURRENCY;
  } catch {
    return DEFAULT_DISPLAY_CURRENCY;
  }
}

/**
 * Local notes and alerts.
 *
 * These are deliberately `localStorage`-only and the UI says so: there is no
 * backend for them in Phase 3, and a "reminder" that pretends to be a push
 * notification would be a lie (§C.1). Only string→string / string→number
 * entries are accepted, so a corrupted key degrades to empty.
 */
function readNotes(): Record<string, string> {
  try {
    const raw = localStorage.getItem(NOTES_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== 'object') return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'string' && v) out[normalizeSymbol(k)] = v;
    }
    return out;
  } catch {
    return {};
  }
}

function readAlerts(): Record<string, number> {
  try {
    const raw = localStorage.getItem(ALERTS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== 'object') return {};
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'number' && Number.isFinite(v) && v > 0) out[normalizeSymbol(k)] = v;
    }
    return out;
  } catch {
    return {};
  }
}

function readPersistedLang(): Lang {
  try {
    return normalizeLang(localStorage.getItem(LANG_KEY));
  } catch {
    return DEFAULT_LANG;
  }
}

function readPersistedGroup(): GroupMode {
  const allowed: GroupMode[] = ['all', 'sector', 'type', 'exchange'];
  try {
    const raw = localStorage.getItem(GROUP_KEY) as GroupMode | null;
    return raw && allowed.includes(raw) ? raw : 'all';
  } catch {
    return 'all';
  }
}


function persist(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode / quota — a preference is not worth crashing over */
  }
}

export const useStore = create<AppState>((set, get) => ({
  screen: 'dashboard',
  symbol: 'AAPL',
  view: { range: DEFAULT_RANGE, interval: DEFAULT_INTERVAL, autoInterval: true },

  market: null,
  marketLoad: { status: 'idle', error: null, code: null, requestId: 0 },

  signals: null,
  signalsLoad: { status: 'idle', error: null, code: null, requestId: 0 },

  watchlist: [],
  quotes: [],
  watchlistError: null,

  lang: readPersistedLang(),
  groupMode: readPersistedGroup(),
  sidebarOpen: false,

  themeMode: readStoredThemeMode(),
  theme: resolveTheme(readStoredThemeMode(), systemPrefersDark()),

  news: null,
  newsLoad: { status: 'idle', error: null, code: null, requestId: 0 },
  fundamentals: null,
  fundamentalsLoad: { status: 'idle', error: null, code: null, requestId: 0 },
  categories: {},
  categoriesLoad: { status: 'idle', error: null, code: null, requestId: 0 },

  statementsPeriod: 'ltm',
  statements: null,
  statementsLoad: { status: 'idle', error: null, code: null, requestId: 0 },
  estimates: null,
  ratings: null,
  quoteOverview: null,
  analystLoad: { status: 'idle', error: null, code: null, requestId: 0 },
  fx: null,
  histories: {},
  dividends: null,
  dividendsLoad: { status: 'idle', error: null, code: null, requestId: 0 },
  dividendSpan: '5y',
  dividendHistory: {},
  dividendHistoryLoad: { status: 'idle', error: null, code: null, requestId: 0 },
  displayCurrency: readPersistedCurrency(),
  notes: readNotes(),
  alerts: readAlerts(),

  setScreen: (screen) => set({ screen }),

  setLang: (lang) => {
    persist(LANG_KEY, lang);
    // The document language drives CJK font selection and the screen reader.
    try {
      document.documentElement.lang = lang;
    } catch {
      /* non-DOM (tests) */
    }
    set({ lang });
  },

  setGroupMode: (groupMode) => {
    persist(GROUP_KEY, groupMode);
    set({ groupMode });
  },

  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),

  setThemeMode: (themeMode) => {
    persistThemeMode(themeMode);
    const theme = resolveTheme(themeMode, systemPrefersDark());
    applyTheme(theme);
    set({ themeMode, theme });
  },

  toggleTheme: () => {
    const theme: ResolvedTheme = get().theme === 'dark' ? 'light' : 'dark';
    persistThemeMode(theme);
    applyTheme(theme);
    set({ themeMode: theme, theme });
  },

  syncSystemTheme: () => {
    // Only a `system` user follows the OS; an explicit choice stays put.
    if (get().themeMode !== 'system') return;
    const theme = resolveTheme('system', systemPrefersDark());
    applyTheme(theme);
    set({ theme });
  },

  selectSymbol: (raw) => {
    const symbol = normalizeSymbol(raw);
    if (!symbol || symbol === get().symbol) return;
    set({
      symbol,
      market: null,
      signals: null,
      news: null,
      fundamentals: null,
      statements: null,
      estimates: null,
      ratings: null,
      quoteOverview: null,
    });
    void get().loadMarket();
    void get().loadSignals();
    void get().loadNews();
    void get().loadFundamentals().then(() => {
      // A symbol's classification and its company profile come from two different
      // endpoints, and country only exists on the profile. Re-pull the categories
      // once the profile has landed so the two panels cannot disagree about the
      // same symbol; the server fills the gap from the profile it just cached.
      void get().loadCategories();
    });
    // Phase 3/4 material is only fetched when its screen is open, so switching
    // symbol on the dashboard does not pay for requests nobody is looking at.
    if (get().screen === 'analysts') {
      void get().loadStatements();
      void get().loadAnalyst();
    }
    if (get().screen === 'dividends') {
      void get().loadDividends();
      void get().loadDividendHistory(get().dividendSpan);
    }
  },

  setRange: (range) => {
    const { view } = get();
    const info = RANGE_INFO.find((r) => r.id === range);
    if (!info) return;
    const interval = view.autoInterval ? info.interval : view.interval;
    set({ view: { ...view, range: info.range, interval } });
    void get().loadMarket();
  },

  setInterval: (interval) => {
    const { view } = get();
    set({ view: { ...view, interval, autoInterval: false } });
    void get().loadMarket();
  },

  setAutoInterval: (autoInterval) => {
    const { view } = get();
    if (autoInterval) {
      const info = RANGE_INFO.find((r) => r.range === view.range || r.id === view.range);
      const interval = info?.interval ?? AUTO_INTERVAL_FOR_RANGE[view.range] ?? view.interval;
      set({ view: { ...view, autoInterval, interval } });
      void get().loadMarket();
      return;
    }
    set({ view: { ...view, autoInterval } });
  },

  loadMarket: async ({ force = false } = {}) => {
    const { symbol, view, marketLoad } = get();
    const requestId = marketLoad.requestId + 1;
    set({ marketLoad: { status: 'loading', error: null, code: null, requestId } });
    const res = await api.getMarket(symbol, { range: view.range, interval: view.interval, force });
    // Discard a response that lost the race against a newer request.
    if (get().marketLoad.requestId !== requestId) return;
    if (res.ok) {
      set({ market: res.data, marketLoad: { status: 'ready', error: null, code: null, requestId } });
    } else {
      set({ marketLoad: { status: 'error', error: res.error, code: res.code ?? null, requestId } });
    }
  },

  loadSignals: async ({ force = false } = {}) => {
    const { symbol, signalsLoad } = get();
    const requestId = signalsLoad.requestId + 1;
    set({ signalsLoad: { status: 'loading', error: null, code: null, requestId } });
    if (force) {
      // Refresh the underlying daily history first so scoring is not stale.
      await api.getMarket(symbol, { range: 'max', interval: '1d', force: true });
    }
    const res = await api.getSignals(symbol);
    if (get().signalsLoad.requestId !== requestId) return;
    if (res.ok) {
      set({ signals: res.data, signalsLoad: { status: 'ready', error: null, code: null, requestId } });
    } else {
      set({ signalsLoad: { status: 'error', error: res.error, code: res.code ?? null, requestId } });
    }
  },

  loadWatchlist: async () => {
    const res = await api.getWatchlist();
    if (res.ok) set({ watchlist: res.data, watchlistError: null });
    else set({ watchlistError: res.error });
  },

  loadQuotes: async () => {
    const res = await api.getWatchQuotes();
    if (res.ok) set({ quotes: res.data });
  },

  loadNews: async ({ force = false } = {}) => {
    const { symbol, newsLoad } = get();
    const requestId = newsLoad.requestId + 1;
    set({ newsLoad: { status: 'loading', error: null, code: null, requestId } });
    const res = await api.getNews(symbol, force);
    if (get().newsLoad.requestId !== requestId) return;
    if (res.ok) set({ news: res.data, newsLoad: { status: 'ready', error: null, code: null, requestId } });
    else set({ newsLoad: { status: 'error', error: res.error, code: res.code ?? null, requestId } });
  },

  loadFundamentals: async ({ force = false } = {}) => {
    const { symbol, fundamentalsLoad } = get();
    const requestId = fundamentalsLoad.requestId + 1;
    set({ fundamentalsLoad: { status: 'loading', error: null, code: null, requestId } });
    const res = await api.getFundamentals(symbol, force);
    if (get().fundamentalsLoad.requestId !== requestId) return;
    if (res.ok) set({ fundamentals: res.data, fundamentalsLoad: { status: 'ready', error: null, code: null, requestId } });
    else set({ fundamentalsLoad: { status: 'error', error: res.error, code: res.code ?? null, requestId } });
  },

  loadCategories: async ({ force = false } = {}) => {
    const { watchlist, categoriesLoad } = get();
    const requestId = categoriesLoad.requestId + 1;
    const symbols = watchlist.map((w) => w.symbol).concat(get().symbol);
    if (symbols.length === 0) {
      set({ categoriesLoad: { status: 'ready', error: null, code: null, requestId } });
      return;
    }
    set({ categoriesLoad: { status: 'loading', error: null, code: null, requestId } });
    const res = await api.getCategories(symbols, force);
    if (get().categoriesLoad.requestId !== requestId) return;
    if (res.ok) {
      // Merge: a category we already know must not be erased by a thinner response.
      set({ categories: { ...get().categories, ...res.data }, categoriesLoad: { status: 'ready', error: null, code: null, requestId } });
    } else {
      set({ categoriesLoad: { status: 'error', error: res.error, code: res.code ?? null, requestId } });
    }
  },

  /* ---------------------------- Phase 3 ---------------------------- */

  setStatementsPeriod: (period) => {
    if (get().statementsPeriod === period) return;
    set({ statementsPeriod: period });
    void get().loadStatements({ period });
  },

  /**
   * The three statements for one period.
   *
   * Cached client-side per period *and* race-guarded with a request id: the
   * period buttons are fast to click, and a slow `annual` answer must never
   * overwrite the `ltm` table the user is now looking at.
   */
  loadStatements: async ({ force = false, period } = {}) => {
    const state = get();
    const want = period ?? state.statementsPeriod;
    const requestId = state.statementsLoad.requestId + 1;
    set({ statementsLoad: { status: 'loading', error: null, code: null, requestId } });
    const res = await api.getStatements(state.symbol, want, force);
    if (get().statementsLoad.requestId !== requestId) return;
    if (res.ok) {
      set({ statements: res.data, statementsLoad: { status: 'ready', error: null, code: null, requestId } });
    } else {
      set({ statementsLoad: { status: 'error', error: res.error, code: res.code ?? null, requestId } });
    }
  },

  /**
   * The analyst bundle: estimates, ratings and the §C.1 header facts.
   *
   * Three endpoints, one store slice, one request id — they describe the same
   * symbol and must always be from the same moment. The FX table is pulled too
   * because the ratings band is drawn in the display currency.
   */
  loadAnalyst: async ({ force = false } = {}) => {
    const { symbol, analystLoad } = get();
    const requestId = analystLoad.requestId + 1;
    set({ analystLoad: { status: 'loading', error: null, code: null, requestId } });
    const [estimates, ratings, quote] = await Promise.all([
      api.getEstimates(symbol, force),
      api.getRatings(symbol, force),
      api.getQuotes(symbol, force),
    ]);
    if (get().analystLoad.requestId !== requestId) return;
    if (!estimates.ok && !ratings.ok && !quote.ok) {
      set({
        analystLoad: {
          status: 'error',
          error: estimates.error || ratings.error || quote.error,
          code: estimates.code ?? ratings.code ?? quote.code ?? null,
          requestId,
        },
      });
      return;
    }
    set({
      estimates: estimates.ok ? estimates.data : get().estimates,
      ratings: ratings.ok ? ratings.data : get().ratings,
      quoteOverview: quote.ok ? quote.data : get().quoteOverview,
      analystLoad: { status: 'ready', error: null, code: null, requestId },
    });
    void get().loadFx([get().displayCurrency]);
  },

  /* ---------------------------- Phase 4 ---------------------------- */

  /**
   * The dividend fact block (§C.1–§C.3).
   *
   * One request id guards the symbol switch; a failure is stored as an error so
   * the section can say so rather than render an empty panel that looks like
   * "this company pays nothing" (§D.5).
   */
  loadDividends: async ({ force = false } = {}) => {
    const { symbol, dividendsLoad } = get();
    const requestId = dividendsLoad.requestId + 1;
    set({ dividendsLoad: { status: 'loading', error: null, code: null, requestId } });
    const res = await api.getDividends(symbol, force);
    if (get().dividendsLoad.requestId !== requestId) return;
    if (res.ok) {
      set({ dividends: res.data, dividendsLoad: { status: 'ready', error: null, code: null, requestId } });
    } else {
      set({ dividendsLoad: { status: 'error', error: res.error, code: res.code ?? null, requestId } });
    }
  },

  setDividendSpan: (span) => {
    if (get().dividendSpan === span) return;
    set({ dividendSpan: span });
    void get().loadDividendHistory(span);
  },

  /**
   * The payments + yield series for one span.
   *
   * Cached per `${symbol}|${span}` and race-guarded: the span chips are fast to
   * click, and a slow `ALL` answer must never overwrite the `1Y` chart the user
   * is now looking at.
   */
  loadDividendHistory: async (span, { force = false } = {}) => {
    const { symbol, dividendHistoryLoad } = get();
    if (!DIVIDEND_SPANS.includes(span)) return;
    const key = `${symbol}|${span}`;
    if (!force && get().dividendHistory[key]) {
      set({ dividendHistoryLoad: { status: 'ready', error: null, code: null, requestId: dividendHistoryLoad.requestId } });
      return;
    }
    const requestId = dividendHistoryLoad.requestId + 1;
    set({ dividendHistoryLoad: { status: 'loading', error: null, code: null, requestId } });
    const res = await api.getDividendHistory(symbol, span, force);
    // A symbol/span switch mid-flight must not write another request's payload
    // under this key.
    if (get().dividendHistoryLoad.requestId !== requestId) return;
    if (res.ok) {
      set({
        dividendHistory: { ...get().dividendHistory, [key]: res.data },
        dividendHistoryLoad: { status: 'ready', error: null, code: null, requestId },
      });
    } else {
      set({ dividendHistoryLoad: { status: 'error', error: res.error, code: res.code ?? null, requestId } });
    }
  },

  /** USD cross-rates. Fetched on demand; a failure degrades to source currency. */
  loadFx: async (codes = []) => {
    const targets = codes.length ? codes : [get().displayCurrency];
    const res = await api.getFx(targets);
    if (res.ok) {
      set({ fx: { perUsd: res.data.perUsd, asOf: res.data.asOf, unavailable: res.data.unavailable } });
    } else {
      // Deliberately do NOT clear a previously-good table: the last real rate is
      // more useful than none, and `convert()` reports the rate's age.
      set({ fx: get().fx ?? { perUsd: {}, asOf: null, unavailable: true } });
    }
  },

  setDisplayCurrency: (code) => {
    const upper = code.toUpperCase();
    persist(CURRENCY_KEY, upper);
    set({ displayCurrency: upper });
    void get().loadFx([upper]);
  },

  loadHistory: async (range, interval) => {
    const { symbol } = get();
    const key = `${symbol}|${range}|${interval}`;
    if (get().histories[key]) return;
    const res = await api.getMarket(symbol, { range, interval });
    // A symbol switch mid-flight must not write another symbol's history under
    // this key, so re-check the symbol against the one that is current now.
    if (!res.ok || get().symbol !== symbol) return;
    set({ histories: { ...get().histories, [key]: res.data.candles } });
  },

  setNote: (symbol, text) => {
    const key = normalizeSymbol(symbol);
    const notes = { ...get().notes };
    if (text.trim()) notes[key] = text;
    else delete notes[key];
    persist(NOTES_KEY, JSON.stringify(notes));
    set({ notes });
  },

  setAlert: (symbol, price) => {
    const key = normalizeSymbol(symbol);
    const alerts = { ...get().alerts };
    if (price !== null && Number.isFinite(price) && price > 0) alerts[key] = price;
    else delete alerts[key];
    persist(ALERTS_KEY, JSON.stringify(alerts));
    set({ alerts });
  },

  addSymbol: async (raw, name) => {
    const symbol = normalizeSymbol(raw);
    const res = await api.addToWatchlist(symbol, name);
    if (!res.ok) {
      set({ watchlistError: res.error ?? null });
      return { ok: false, error: res.error, code: res.code };
    }
    await get().loadWatchlist();
    void get().loadQuotes();
    return { ok: true };
  },

  removeSymbol: async (symbol) => {
    const res = await api.removeFromWatchlist(symbol);
    if (!res.ok) set({ watchlistError: res.error });
    await get().loadWatchlist();
    void get().loadQuotes();
  },

  /** Move a row up/down and persist the new order. */
  moveSymbol: async (symbol, delta) => {
    const items = [...get().watchlist];
    const i = items.findIndex((x) => x.symbol === symbol);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= items.length) return;
    [items[i], items[j]] = [items[j], items[i]];
    // Optimistic update, then reconcile with the server's answer.
    set({ watchlist: items.map((x, idx) => ({ ...x, position: idx })) });
    const res = await api.reorderWatchlist(items.map((x) => x.symbol));
    if (res.ok) set({ watchlist: res.data });
    else {
      set({ watchlistError: res.error });
      await get().loadWatchlist();
    }
  },

  refreshAll: async () => {
    await Promise.all([
      get().loadMarket({ force: true }),
      get().loadWatchlist(),
      get().loadQuotes(),
      get().loadNews({ force: true }),
      get().loadFundamentals({ force: true }),
      get().loadCategories({ force: true }),
    ]);
    await get().loadSignals({ force: true });
    // Phase 3 material only if its screen is open — a dashboard refresh should
    // not trigger four extra upstream calls for panels nobody is looking at.
    if (get().screen === 'analysts') {
      await Promise.all([get().loadStatements({ force: true }), get().loadAnalyst({ force: true })]);
    }
    if (get().screen === 'dividends') {
      await Promise.all([
        get().loadDividends({ force: true }),
        get().loadDividendHistory(get().dividendSpan, { force: true }),
      ]);
    }
  },
}));

/* ------------------------------------------------------------------
   Selectors — keep components dumb and derived values in one place.
   ------------------------------------------------------------------ */

export const selectCandles = (s: AppState): Candle[] => s.market?.candles ?? [];
export const selectIndicators = (s: AppState): IndicatorSeries | null => s.market?.indicators ?? null;
export const selectMeta = (s: AppState): SymbolMeta | null => s.signals?.meta ?? s.market?.meta ?? null;
export const selectQuoteFor = (symbol: string) => (s: AppState) => s.quotes.find((q) => q.symbol === symbol) ?? null;

/** The §C.1 header facts, preferring the dedicated quote payload over the chart meta. */
export const selectOverview = (s: AppState): QuoteOverview | null => s.quoteOverview;

/**
 * The FX table in the shape `shared/fx.ts` expects.
 *
 * Returning a *fresh* object every call would re-render every consumer on each
 * store write, so the slice is returned as-is; `null` (never fetched) is the
 * one case the converter treats as "no rates at all".
 */
export const selectFx = (s: AppState): FxTable | null => s.fx;

/** A cached price window, or null when it has not been fetched yet. */
export const selectHistory = (symbol: string, range: string, interval: Interval) => (s: AppState): Candle[] | null =>
  s.histories[`${symbol}|${range}|${interval}`] ?? null;

/** Exported for the categorisation tests and for components that need the shape. */
export type { AppState };

/** Watch quotes sorted best-to-worst, for the "movers" strip. */
export function selectMovers(s: AppState): WatchQuote[] {
  return [...s.quotes]
    .filter((q) => q.changePercent !== null)
    .sort((a, b) => (b.changePercent ?? 0) - (a.changePercent ?? 0));
}
