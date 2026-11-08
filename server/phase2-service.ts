/**
 * Phase 2 provider-backed services (SPEC-PHASE2 §D, §E, §F).
 *
 * Three features, one shape: call the provider, map it with a *pure* function
 * from `shared/`, cache the mapped result, and — when the network is down —
 * serve the last good copy clearly labelled `stale-cache`. The mapping lives in
 * `shared/` so it is unit-testable without a network; this file owns only the
 * I/O, the cache and the clock.
 *
 * The one rule that runs through all of it: a failed call never becomes
 * fabricated content. It becomes an empty list, a null field, or a note.
 */
import type {
  CategoryMap,
  FundamentalsPayload,
  NewsPayload,
  SymbolCategory,
} from '../shared/types';
import { parseFundamentals, isUsableFundamentals } from '../shared/fundamentals';
import { parseNewsPayload } from '../shared/news';
import { classifySymbol, mergeCategory } from '../shared/categorise';
import { getKv, setKv, type Db } from './db';
import {
  fetchProviderJson,
  fetchWithRetry,
  quoteSummaryPath,
  searchPath,
} from './provider';
import { YAHOO_USER_AGENT } from './market-service';

/** How long each payload may be reused before we go back to the provider. */
export const TTL = {
  fundamentals: 6 * 3600,
  news: 15 * 60,
  categories: 7 * 24 * 3600,
} as const;

const NEWS_LIMIT = 12;

export interface ServiceOpts {
  force?: boolean;
  now?: number;
  fetchImpl?: typeof fetch;
}

/* ------------------------------------------------------------------ news --- */

interface YahooSearchJson {
  news?: unknown;
  quotes?: Array<Record<string, unknown>>;
}

/** Public (no crumb) search call — the endpoint the coordinator verified. */
async function fetchSearchJson(
  query: string,
  newsCount: number,
  quotesCount: number,
  fetchImpl: typeof fetch,
): Promise<unknown | null> {
  const res = await fetchWithRetry(
    `https://query1.finance.yahoo.com${searchPath(query, newsCount, quotesCount)}`,
    { headers: { 'User-Agent': YAHOO_USER_AGENT, Accept: 'application/json' } },
    fetchImpl,
  );
  if (!res) return null;
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Latest headlines for a symbol.
 *
 * The provider's news search returns stories *related* to the query, not
 * necessarily *about* it, and it says which tickers each story references. We
 * pass that through (`mentionsSymbol`) and sort relevant-first, so the UI can
 * be honest about how tight the match is.
 */
export async function loadNews(db: Db, rawSymbol: string, opts: ServiceOpts = {}): Promise<NewsPayload> {
  const symbol = rawSymbol.trim().toUpperCase();
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const fetchImpl = opts.fetchImpl ?? fetch;
  const key = `news:${symbol}`;

  const cached = getKv<NewsPayload>(db, key);
  const fresh = cached !== null && now - cached.updatedAt <= TTL.news;

  if (!opts.force && fresh && cached) {
    return { ...cached.payload, source: 'cache', lastUpdated: cached.updatedAt };
  }

  const json = await fetchSearchJson(symbol, NEWS_LIMIT, 3, fetchImpl);
  if (json) {
    const payload = parseNewsPayload(json, symbol, {
      source: 'live',
      lastUpdated: now,
      note: null,
      limit: NEWS_LIMIT,
    });
    setKv(db, key, payload, now);
    return payload;
  }

  if (cached) {
    return {
      ...cached.payload,
      source: 'stale-cache',
      lastUpdated: cached.updatedAt,
      note: 'note.newsUnreachableCached',
    };
  }
  return {
    symbol,
    items: [],
    source: 'unavailable',
    lastUpdated: null,
    note: 'note.newsUnreachableNone',
  };
}

/* ---------------------------------------------------------- fundamentals --- */

/**
 * Company profile, key statistics and analyst aggregates.
 *
 * Uses the crumb-authenticated `quoteSummary` endpoint. When it is unavailable
 * (no crumb, provider down) we serve the last good snapshot marked `stale-cache`
 * rather than an empty panel the user would misread as "this company has no
 * market cap".
 */
export async function loadFundamentals(
  db: Db,
  rawSymbol: string,
  opts: ServiceOpts = {},
): Promise<FundamentalsPayload> {
  const symbol = rawSymbol.trim().toUpperCase();
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const key = `fundamentals:${symbol}`;
  const cached = getKv<FundamentalsPayload>(db, key);
  const fresh = cached !== null && now - cached.updatedAt <= TTL.fundamentals;

  if (!opts.force && fresh && cached) {
    return { ...cached.payload, source: 'cache', lastUpdated: cached.updatedAt };
  }

  const res = await fetchProviderJson(quoteSummaryPath(symbol), { fetchImpl: opts.fetchImpl });
  if (res) {
    const payload = parseFundamentals(res.json, symbol, {
      source: 'live',
      lastUpdated: now,
      note: null,
    });
    // Only cache a call that actually produced something; caching an empty
    // envelope would turn a transient provider hiccup into six hours of "no data".
    // (See `isUsableFundamentals` — the verifier reasons about the same rule.)
    if (isUsableFundamentals(payload)) setKv(db, key, payload, now);
    return payload;
  }

  if (cached) {
    return {
      ...cached.payload,
      source: 'stale-cache',
      lastUpdated: cached.updatedAt,
      note: 'note.fundamentalsUnreachableCached',
    };
  }
  return {
    symbol,
    profile: null,
    keyStats: null,
    health: null,
    quoteType: null,
    currency: null,
    source: 'unavailable',
    lastUpdated: null,
    note: 'note.fundamentalsUnavailable',
  };
}

/* -------------------------------------------------------- classification --- */

/**
 * Classify a set of symbols from the provider's search metadata.
 *
 * Cached per symbol and merged (a richer record wins), because the search
 * endpoint is the only one that returns type + sector + exchange together and
 * it is too chatty to call for every render.
 */
export async function loadCategories(
  db: Db,
  rawSymbols: readonly string[],
  opts: ServiceOpts = {},
): Promise<CategoryMap> {
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const fetchImpl = opts.fetchImpl ?? fetch;
  const symbols = [...new Set(rawSymbols.map((s) => s.trim().toUpperCase()).filter(Boolean))];
  const out: CategoryMap = {};

  const missing: string[] = [];
  for (const symbol of symbols) {
    const key = `category:${symbol}`;
    const cached = getKv<SymbolCategory>(db, key);
    const fresh = cached !== null && now - cached.updatedAt <= TTL.categories;
    if (!opts.force && fresh && cached) out[symbol] = cached.payload;
    else missing.push(symbol);
  }

  // Bounded concurrency: enough to be quick, small enough not to look like a
  // scraper to the provider.
  const CONCURRENCY = 4;
  for (let i = 0; i < missing.length; i += CONCURRENCY) {
    const chunk = missing.slice(i, i + CONCURRENCY);
    const settled = await Promise.all(
      chunk.map(async (symbol) => {
        const json = (await fetchSearchJson(symbol, 0, 5, fetchImpl)) as YahooSearchJson | null;
        const hit = json?.quotes?.find((q) => String(q.symbol).toUpperCase() === symbol) ?? json?.quotes?.[0];
        if (!hit) return { symbol, category: null as SymbolCategory | null };
        const category = classifySymbol({
          symbol,
          quoteType: str(hit.quoteType) ?? str(hit.typeDisp),
          sector: str(hit.sector) ?? str(hit.sectorDisp),
          industry: str(hit.industry) ?? str(hit.industryDisp),
          exchange: str(hit.exchDisp) ?? str(hit.exchange),
          exchangeCode: str(hit.exchange),
        });
        return { symbol, category };
      }),
    );
    for (const { symbol, category } of settled) {
      const key = `category:${symbol}`;
      const cached = getKv<SymbolCategory>(db, key);
      if (category) {
        const merged = cached?.payload ? mergeCategory(cached.payload, category) : category;
        out[symbol] = merged;
        setKv(db, key, merged, now);
      } else if (cached?.payload) {
        // Provider gave us nothing new; keep the last classification we knew.
        out[symbol] = cached.payload;
      } else {
        // Honestly "we do not know" — the UI renders the Unknown bucket.
        out[symbol] = classifySymbol({ symbol });
      }
    }
  }

  // Country is the one field Yahoo's *search* endpoint never returns, so the
  // categorisation map would otherwise report it as Unknown even while the
  // dashboard's profile panel shows "United States" for the same symbol — an
  // inconsistency the user can see. The company profile we already cached for
  // that symbol is a real source for it, so fill it in from there.
  for (const symbol of Object.keys(out)) {
    const category = out[symbol];
    if (!category || category.country) continue;
    const profile = getKv<FundamentalsPayload>(db, `fundamentals:${symbol}`);
    const country = profile?.payload.profile?.country ?? null;
    if (country) {
      out[symbol] = { ...category, country, countryFromProfile: true };
      setKv(db, `category:${symbol}`, out[symbol], now);
    }
  }

  return out;
}

function str(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s ? s : null;
}
