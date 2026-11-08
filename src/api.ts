import type {
  ApiResult,
  CategoryMap,
  EstimatesPayload,
  FundamentalsPayload,
  FxPayload,
  MarketData,
  NewsPayload,
  QuoteOverview,
  RatingsFullPayload,
  SignalsPayload,
  StatementsPayload,
  StatementPeriod,
  SymbolSearchResult,
  WatchQuote,
  WatchlistItem,
} from '../shared/types';
import type { DividendHistoryPayload, DividendPayload, DividendSpan } from '../shared/dividends';

/**
 * Thin typed client over the Express backend.
 *
 * Every call returns the `ApiResult` envelope and never throws for a handled
 * upstream failure, so the UI can always tell "no data" apart from a crash.
 */

/**
 * The API base.
 *
 * On the web the app and API are same-origin, so a relative `/api` is correct.
 * Inside the native (Capacitor) iOS shell the page origin is
 * `capacitor://localhost`, where a relative `/api` resolves to nothing — the
 * app would silently show "no data" for every screen. Native builds therefore
 * need an absolute base, injected at build time via `VITE_API_BASE` (see
 * docs/NATIVE-IOS.md); it falls back to the relative path for web/local dev.
 */
const BASE = import.meta.env.VITE_API_BASE || '/api';

async function request<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: {
        Accept: 'application/json',
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...init,
    });
    const text = await res.text();
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      return {
        ok: false,
        error: `Server returned a non-JSON response (HTTP ${res.status}).`,
        code: 'BAD_RESPONSE',
      };
    }
    if (json && typeof json === 'object' && 'ok' in json) return json as ApiResult<T>;
    return { ok: false, error: `Unexpected response shape (HTTP ${res.status}).`, code: 'BAD_RESPONSE' };
  } catch (err) {
    return {
      ok: false,
      // The message is surfaced to the user through an error banner, so it is
      // translated at the render site, never here. `code` is the contract.
      error: err instanceof Error ? err.message : '',
      code: 'NETWORK',
    };
  }
}

export function getHealth() {
  return request<{ status: string; time: number; service: string }>('/health');
}

export function getMarket(
  symbol: string,
  opts: { range?: string; interval?: string; force?: boolean } = {},
): Promise<ApiResult<MarketData>> {
  const q = new URLSearchParams();
  if (opts.range) q.set('range', opts.range);
  if (opts.interval) q.set('interval', opts.interval);
  if (opts.force) q.set('force', '1');
  const qs = q.toString();
  return request<MarketData>(`/market/${encodeURIComponent(symbol)}${qs ? `?${qs}` : ''}`);
}

export function getSignals(symbol: string): Promise<ApiResult<SignalsPayload>> {
  return request<SignalsPayload>(`/signals/${encodeURIComponent(symbol)}`);
}

export function getWatchlist(): Promise<ApiResult<WatchlistItem[]>> {
  return request<WatchlistItem[]>('/watchlist');
}

export function getWatchQuotes(): Promise<ApiResult<WatchQuote[]>> {
  return request<WatchQuote[]>('/watchlist/quotes');
}

export function addToWatchlist(symbol: string, name?: string): Promise<ApiResult<WatchlistItem>> {
  return request<WatchlistItem>('/watchlist', {
    method: 'POST',
    body: JSON.stringify({ symbol, name }),
  });
}

export function removeFromWatchlist(
  symbol: string,
): Promise<ApiResult<{ symbol: string; removed: boolean }>> {
  return request(`/watchlist/${encodeURIComponent(symbol)}`, { method: 'DELETE' });
}

export function reorderWatchlist(symbols: string[]): Promise<ApiResult<WatchlistItem[]>> {
  return request<WatchlistItem[]>('/watchlist/reorder', {
    method: 'POST',
    body: JSON.stringify({ symbols }),
  });
}

export function searchSymbols(q: string): Promise<ApiResult<SymbolSearchResult[]>> {
  return request<SymbolSearchResult[]>(`/search?q=${encodeURIComponent(q)}`);
}

/* ------------------------- Phase 2 (SPEC-PHASE2) ------------------------- */

export function getNews(symbol: string, force = false): Promise<ApiResult<NewsPayload>> {
  return request<NewsPayload>(`/news/${encodeURIComponent(symbol)}${force ? '?force=1' : ''}`);
}

export function getFundamentals(symbol: string, force = false): Promise<ApiResult<FundamentalsPayload>> {
  return request<FundamentalsPayload>(`/fundamentals/${encodeURIComponent(symbol)}${force ? '?force=1' : ''}`);
}

/** Classification for a set of symbols. The backend defaults to the watchlist. */
export function getCategories(symbols: string[], force = false): Promise<ApiResult<CategoryMap>> {
  const q = new URLSearchParams();
  if (symbols.length) q.set('symbols', symbols.join(','));
  if (force) q.set('force', '1');
  const qs = q.toString();
  return request<CategoryMap>(`/categories${qs ? `?${qs}` : ''}`);
}

/* ------------------------- Phase 3 (SPEC-PHASE3) ------------------------- */

/** Income / balance / cash-flow series for one period (`annual` | `quarterly` | `ltm`). */
export function getStatements(
  symbol: string,
  period: StatementPeriod,
  force = false,
): Promise<ApiResult<StatementsPayload>> {
  const q = new URLSearchParams({ period });
  if (force) q.set('force', '1');
  return request<StatementsPayload>(`/statements/${encodeURIComponent(symbol)}?${q.toString()}`);
}

/** Current + next quarter / FY consensus and the next earnings date. */
export function getEstimates(symbol: string, force = false): Promise<ApiResult<EstimatesPayload>> {
  return request<EstimatesPayload>(`/estimates/${encodeURIComponent(symbol)}${force ? '?force=1' : ''}`);
}

/** Rating distribution, price targets, recent upgrades/downgrades. */
export function getRatings(symbol: string, force = false): Promise<ApiResult<RatingsFullPayload>> {
  return request<RatingsFullPayload>(`/ratings/${encodeURIComponent(symbol)}${force ? '?force=1' : ''}`);
}

/** The §C.1 header facts, including the pre/post rows only when published. */
export function getQuotes(symbol: string, force = false): Promise<ApiResult<QuoteOverview>> {
  return request<QuoteOverview>(`/quotes/${encodeURIComponent(symbol)}${force ? '?force=1' : ''}`);
}

/* ------------------------- Phase 4 (SPEC-PHASE4) ------------------------- */

/** The §C.1–§C.3 dividend facts, growth and shareholder decomposition. */
export function getDividends(symbol: string, force = false): Promise<ApiResult<DividendPayload>> {
  return request<DividendPayload>(`/dividends/${encodeURIComponent(symbol)}${force ? '?force=1' : ''}`);
}

/**
 * The §C.4/§C.5 series for one span.
 *
 * The span is always an explicit label from `DIVIDEND_SPANS` — never a provider
 * `range` token, so `range=max` (which silently drops whole decades) cannot be
 * reached from the UI (§A.1.2).
 */
export function getDividendHistory(
  symbol: string,
  span: DividendSpan,
  force = false,
): Promise<ApiResult<DividendHistoryPayload>> {
  const q = new URLSearchParams({ span });
  if (force) q.set('force', '1');
  return request<DividendHistoryPayload>(`/dividends/${encodeURIComponent(symbol)}/history?${q.toString()}`);
}

/** USD cross-rates for the display-currency switch. */
export function getFx(to: string[] = [], force = false): Promise<ApiResult<FxPayload>> {
  const q = new URLSearchParams();
  if (to.length) q.set('to', to.join(','));
  if (force) q.set('force', '1');
  const qs = q.toString();
  return request<FxPayload>(`/fx${qs ? `?${qs}` : ''}`);
}
