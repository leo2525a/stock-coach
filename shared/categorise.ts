import type { AssetType, CategoryGroup, GroupMode, SymbolCategory, SymbolSearchResult } from './types';

/**
 * Categorisation layer (SPEC-PHASE2 §D).
 *
 * Everything here is a *pure function of provider metadata*. The rule the whole
 * module exists to enforce: whenever the provider does not tell us the type,
 * sector or exchange, the answer is `null` and the UI renders the translated
 * "unknown" bucket — never a plausible-looking guess. A wrong sector is worse
 * than a missing one, because the user has no way to tell them apart.
 */

/** Quote types we can honestly place in the Stock / ETF buckets. */
const TYPE_BY_QUOTE_TYPE: Record<string, AssetType> = {
  EQUITY: 'stock',
  ETF: 'etf',
};

const asString = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s ? s : null;
};

/**
 * Canonical exchange buckets. Yahoo's own labels are inconsistent across
 * endpoints (`exchDisp: 'NASDAQ'` from search, `exchangeName: 'NasdaqGS'` from
 * the chart endpoint), so both spellings map to one bucket.
 */
const EXCHANGE_BUCKETS: Array<{ id: string; match: RegExp }> = [
  { id: 'NASDAQ', match: /nasdaq|^nms$|^ngm$|^ncm$/i },
  { id: 'NYSE Arca', match: /arca|^pcx$/i },
  { id: 'NYSE', match: /^nyse$|^nyq$/i },
  { id: 'HKEX', match: /hong kong|^hkse$|^hkex$|^hkg$/i },
  { id: 'LSE', match: /london|^lse$|^lon$/i },
  { id: 'TSE', match: /tokyo|^tse$|^tyo$|^jpx$/i },
  { id: 'SSE', match: /^sse$/i },
  { id: 'SZSE', match: /^szse$/i },
  { id: 'TSX', match: /toronto|^tsx$|^tse-c$|^tsxv$/i },
  { id: 'ASX', match: /australian|^asx$/i },
  { id: 'XETRA', match: /xetra|german|frankfurt|^ger$/i },
  { id: 'SIX', match: /swiss|^six$|^swx$/i },
];

/**
 * Bucket a provider exchange label. Returns the canonical id, or the provider's
 * own trimmed label when we do not recognise it — degrading to "what the
 * provider said" is honest; inventing a bucket is not.
 */
export function exchangeBucket(label: string | null | undefined): string | null {
  const s = asString(label);
  if (!s) return null;
  for (const bucket of EXCHANGE_BUCKETS) {
    if (bucket.match.test(s)) return bucket.id;
  }
  return s;
}

/** Map a raw `quoteType` to one of our buckets. Unknown types are 'other'. */
export function assetTypeFrom(quoteType: string | null | undefined): AssetType {
  const q = asString(quoteType);
  if (!q) return 'other';
  return TYPE_BY_QUOTE_TYPE[q.toUpperCase()] ?? 'other';
}

export interface ClassifyInput {
  symbol: string;
  quoteType?: string | null;
  sector?: string | null;
  industry?: string | null;
  exchange?: string | null;
  exchangeCode?: string | null;
  country?: string | null;
  currency?: string | null;
}

/** Build a `SymbolCategory` from whatever real metadata we hold. */
export function classifySymbol(input: ClassifyInput): SymbolCategory {
  const quoteType = asString(input.quoteType);
  const exchangeRaw = asString(input.exchange) ?? asString(input.exchangeCode);
  return {
    symbol: input.symbol.trim().toUpperCase(),
    type: assetTypeFrom(quoteType),
    quoteType,
    sector: asString(input.sector),
    industry: asString(input.industry),
    exchange: exchangeBucket(exchangeRaw),
    exchangeCode: asString(input.exchangeCode) ?? asString(input.exchange),
    country: asString(input.country),
    currency: asString(input.currency),
  };
}

/**
 * Build a category from one Yahoo **search** hit.
 *
 * Search is the only endpoint that gives us type + sector + exchange in a single
 * request, which is why the categoriser is fed from there.
 */
export function classifyFromSearchHit(hit: SymbolSearchResult): SymbolCategory | null {
  const symbol = asString(hit.symbol);
  if (!symbol) return null;
  return classifySymbol({
    symbol,
    quoteType: hit.quoteType ?? hit.type,
    sector: hit.sector ?? null,
    industry: hit.industry ?? null,
    exchange: hit.exchange ?? null,
  });
}

/**
 * A symbol's classification is *stable* while the market is open, so a merged
 * map prefers the richer of two records: a record that knows the sector beats
 * one that doesn't, and a known type beats 'other'.
 */
export function mergeCategory(a: SymbolCategory | undefined, b: SymbolCategory): SymbolCategory {
  if (!a) return b;
  return {
    symbol: b.symbol || a.symbol,
    type: b.type !== 'other' ? b.type : a.type,
    quoteType: b.quoteType ?? a.quoteType,
    sector: b.sector ?? a.sector,
    industry: b.industry ?? a.industry,
    exchange: b.exchange ?? a.exchange,
    exchangeCode: b.exchangeCode ?? a.exchangeCode,
    country: b.country ?? a.country,
    currency: b.currency ?? a.currency,
  };
}

/** Which raw field a grouping mode reads. */
export function groupKeyFor(category: SymbolCategory | undefined, mode: GroupMode): string | null {
  if (!category) {
    // No record at all. 'type' still has an honest answer — every instrument is
    // at least "other" — so it never lands in the Unknown bucket. Sector and
    // exchange genuinely can be unknown, so they do.
    return mode === 'type' ? 'other' : null;
  }
  switch (mode) {
    case 'sector':
      return category.sector;
    case 'type':
      // Types are always known (falling back to 'other'), so never null here.
      return category.type;
    case 'exchange':
      return category.exchange;
    case 'all':
    default:
      return null;
  }
}

/** Group id used for missing/unknown values. */
export const UNKNOWN_GROUP_ID = '__unknown__';

/**
 * Group an ordered list of symbols by the chosen dimension.
 *
 * Contract:
 *  - Input order is preserved *within* each group.
 *  - Group order follows first appearance, so the user's own watchlist order
 *    decides which sector shows first — not an arbitrary sort.
 *  - Symbols whose category is missing or unknown land in the `__unknown__`
 *    group, which always sorts last (it is the least useful bucket).
 */
export function groupSymbols(
  symbolOrder: readonly string[],
  categories: Record<string, SymbolCategory | undefined>,
  mode: GroupMode,
): CategoryGroup[] {
  if (mode === 'all') {
    return symbolOrder.length ? [{ id: 'all', raw: null, symbols: [...symbolOrder] }] : [];
  }

  const groups = new Map<string, CategoryGroup>();
  for (const symbol of symbolOrder) {
    const category = categories[symbol];
    const raw = groupKeyFor(category, mode);
    const id = raw === null || raw === undefined || raw === '' ? UNKNOWN_GROUP_ID : `${mode}:${raw}`;
    const existing = groups.get(id);
    if (existing) existing.symbols.push(symbol);
    else groups.set(id, { id, raw: raw ?? null, symbols: [symbol] });
  }

  const list = [...groups.values()];
  const unknown = list.filter((g) => g.id === UNKNOWN_GROUP_ID);
  const known = list.filter((g) => g.id !== UNKNOWN_GROUP_ID);
  return [...known, ...unknown];
}
