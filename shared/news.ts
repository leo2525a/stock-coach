import type { NewsItem, NewsPayload } from './types';

/**
 * Pure mapping layer for the Yahoo Finance news search (SPEC-PHASE2 §F).
 *
 * Design rules, all enforced by tests:
 *  - Only stories the provider actually published are returned. There is no
 *    title generator here and no placeholder copy.
 *  - A story without a **real http(s) link** is dropped: a headline you cannot
 *    open is not a story.
 *  - `mentionsSymbol` records the provider's own relevance claim
 *    (`relatedTickers` contains the symbol). We surface it and sort on it —
 *    we do not silently pretend every result is about the symbol.
 */

interface YahooNewsItem {
  uuid?: unknown;
  title?: unknown;
  publisher?: unknown;
  link?: unknown;
  providerPublishTime?: unknown;
  relatedTickers?: unknown;
}

interface YahooNewsRoot {
  news?: YahooNewsItem[] | null;
}

const asString = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s ? s : null;
};

const asEpochSeconds = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  if (!Number.isFinite(n) || n <= 0) return null;
  // Providers occasionally hand back milliseconds; normalise defensively.
  return Math.floor(n > 1e12 ? n / 1000 : n);
};

/** Only absolute http(s) URLs are usable as a source link. */
export function isHttpUrl(url: string | null): url is string {
  if (!url) return false;
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

export function parseNewsItems(json: unknown, symbol: string): NewsItem[] {
  const root = json as YahooNewsRoot;
  const raw = Array.isArray(root?.news) ? root.news : [];
  const wanted = symbol.trim().toUpperCase();

  const items: NewsItem[] = [];
  for (const n of raw) {
    const title = asString(n?.title);
    const link = asString(n?.link);
    if (!title || !isHttpUrl(link)) continue;
    const related = Array.isArray(n?.relatedTickers)
      ? n.relatedTickers.map((t) => String(t).toUpperCase()).filter(Boolean)
      : [];
    items.push({
      id: asString(n?.uuid) ?? link,
      title,
      // The provider is occasionally missing a publisher; say so honestly
      // rather than attributing the story to nobody.
      publisher: asString(n?.publisher) ?? '',
      link,
      publishedAt: asEpochSeconds(n?.providerPublishTime),
      relatedTickers: related,
      mentionsSymbol: related.includes(wanted),
    });
  }

  /**
   * Sort: relevant stories first, then newest first. Ties on timestamp keep a
   * stable order so the same payload always renders the same way.
   */
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      if (a.item.mentionsSymbol !== b.item.mentionsSymbol) return a.item.mentionsSymbol ? -1 : 1;
      const ta = a.item.publishedAt ?? 0;
      const tb = b.item.publishedAt ?? 0;
      if (ta !== tb) return tb - ta;
      return a.index - b.index;
    })
    .map(({ item }) => item);
}

export function parseNewsPayload(
  json: unknown,
  symbol: string,
  extras: { source: string; lastUpdated: number | null; note?: string | null; limit?: number },
): NewsPayload {
  const items = parseNewsItems(json, symbol);
  return {
    symbol,
    items: extras.limit ? items.slice(0, extras.limit) : items,
    source: extras.source,
    lastUpdated: extras.lastUpdated,
    note: extras.note ?? null,
  };
}

/** News search URL for a symbol (the endpoint the coordinator verified). */
export function yahooNewsSearchUrl(symbol: string, newsCount = 10, quotesCount = 3): string {
  const params = new URLSearchParams({
    q: symbol,
    quotesCount: String(quotesCount),
    newsCount: String(newsCount),
  });
  return `https://query1.finance.yahoo.com/v1/finance/search?${params.toString()}`;
}
