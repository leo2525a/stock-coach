/**
 * Phase 2 mapping tests (SPEC-PHASE2 §A.2, §D, §E, §F).
 *
 * The three Phase 2 features all share one risk: taking a provider payload that
 * is *missing something* and turning it into a number that looks real. So the
 * tests here are mostly about absence —
 *
 *   - an empty `{}` from Yahoo means "no value", and must become `null`
 *     (never `0`, because a dividend yield of 0 and an unknown yield are
 *     different facts);
 *   - a news story without a real http(s) link is not a story and is dropped;
 *   - a symbol the provider does not classify lands in "Unknown", it is never
 *     guessed into a plausible sector.
 *
 * Fixtures are captured-shape literals, not live calls: the network is not a
 * test oracle, and these run in CI with no internet.
 */
import { describe, expect, it } from 'vitest';
import {
  isCrumbError,
  parseFundamentals,
  parseHealthStats,
  parseKeyStats,
  parseProfile,
  rangePosition,
  rawNumber,
  trimSummary,
} from '../shared/fundamentals';
import { isHttpUrl, parseNewsItems, parseNewsPayload, yahooNewsSearchUrl } from '../shared/news';
import {
  assetTypeFrom,
  classifyFromSearchHit,
  classifySymbol,
  exchangeBucket,
  groupKeyFor,
  groupSymbols,
  mergeCategory,
  UNKNOWN_GROUP_ID,
} from '../shared/categorise';
import type { SymbolCategory } from '../shared/types';
import {
  COUNTRIES_ZH,
  countryLabel,
  EXCHANGES_ZH,
  exchangeLabel,
  INDUSTRIES_ZH,
  industryLabel,
  quoteTypeLabel,
  RECOMMENDATION_ZH,
  SECTORS_ZH,
  sectorLabel,
} from '../shared/i18n/terminology';

/* ------------------------------------------------------------ fixtures ---- */

/** A quoteSummary answer shaped exactly like the live one (raw/fmt wrappers). */
const QUOTE_SUMMARY = {
  quoteSummary: {
    result: [
      {
        price: {
          marketCap: { raw: 5_001_541_320_704, fmt: '5.00T' },
          regularMarketDayHigh: { raw: 348.2 },
          regularMarketDayLow: { raw: 341.1 },
          regularMarketVolume: { raw: 42_258_960 },
          currency: 'USD',
          quoteType: 'EQUITY',
        },
        summaryDetail: {
          trailingPE: { raw: 38.326283 },
          forwardPE: { raw: 32.321957 },
          dividendYield: { raw: 0.0031 },
          beta: { raw: 1.089 },
          previousClose: { raw: 350.59 },
          fiftyTwoWeekHigh: { raw: 355.38 },
          fiftyTwoWeekLow: { raw: 243.42 },
          averageVolume: { raw: 42_258_960 },
        },
        defaultKeyStatistics: {
          priceToBook: { raw: 51.2 },
          trailingEps: { raw: 8.98 },
          forwardEps: { raw: 10.65 },
        },
        financialData: {
          profitMargins: { raw: 0.276 },
          operatingMargins: { raw: 0.348 },
          returnOnEquity: { raw: 1.4226 },
          returnOnAssets: { raw: 0.31 },
          revenueGrowth: { raw: 0.117 },
          recommendationKey: 'buy',
          recommendationMean: { raw: 1.9 },
          numberOfAnalystOpinions: { raw: 39 },
          targetMeanPrice: { raw: 333.28052 },
          targetHighPrice: { raw: 400 },
          targetLowPrice: { raw: 250 },
        },
        assetProfile: {
          sector: 'Technology',
          industry: 'Consumer Electronics',
          country: 'United States',
          website: 'https://www.apple.com',
          fullTimeEmployees: { raw: 164_000 },
          longBusinessSummary: 'Apple Inc. designs, manufactures and markets smartphones.',
        },
      },
    ],
    error: null,
  },
};

/** The same call, but for an instrument where Yahoo publishes almost nothing. */
const QUOTE_SUMMARY_EMPTY = {
  quoteSummary: {
    result: [
      {
        price: { quoteType: 'ETF', currency: 'USD' },
        summaryDetail: { trailingPE: {}, forwardPE: {}, dividendYield: {}, beta: {} },
        defaultKeyStatistics: {},
        financialData: {},
        assetProfile: {},
      },
    ],
    error: null,
  },
};

const SEARCH_NEWS = {
  news: [
    {
      uuid: 'aaa-1',
      title: 'Apple ships a new chip',
      publisher: 'Reuters',
      link: 'https://example.com/a',
      providerPublishTime: 1_793_900_000,
      relatedTickers: ['AAPL', 'TSM'],
    },
    {
      uuid: 'aaa-2',
      title: 'Something unrelated',
      publisher: 'Blog',
      link: 'https://example.com/b',
      providerPublishTime: 1_793_950_000,
      relatedTickers: ['ZZZZ'],
    },
    // No link at all — must be dropped, not rendered unopenable.
    { uuid: 'aaa-3', title: 'Headline with no link', publisher: 'X', providerPublishTime: 1_793_960_000 },
    // A non-http scheme is not an openable source either.
    { uuid: 'aaa-4', title: 'Javascript URL', link: 'javascript:alert(1)', relatedTickers: [] },
    // Title only — dropped.
    { uuid: 'aaa-5', link: 'https://example.com/c' },
  ],
};

const SEARCH_QUOTES = {
  quotes: [
    {
      symbol: 'AAPL',
      name: 'Apple Inc.',
      type: 'Equity',
      quoteType: 'EQUITY',
      sector: 'Technology',
      industry: 'Consumer Electronics',
      exchDisp: 'NASDAQ',
      exchange: 'NMS',
    },
    { symbol: 'SPY', name: 'SPDR S&P 500 ETF Trust', type: 'ETF', quoteType: 'ETF', exchDisp: 'NYSE Arca', exchange: 'PCX' },
    { symbol: '0700.HK', name: 'Tencent Holdings', type: 'Equity', quoteType: 'EQUITY', exchDisp: 'HKSE', exchange: 'HKG' },
  ],
};

/* ------------------------------------------------------- rawNumber/values -- */

describe('fundamentals — reading Yahoo’s number wrappers', () => {
  it('unwraps { raw } objects, plain numbers and numeric strings', () => {
    expect(rawNumber({ raw: 5 })).toBe(5);
    expect(rawNumber(5)).toBe(5);
    expect(rawNumber('5.5')).toBe(5.5);
    expect(rawNumber({ raw: { raw: 7 } })).toBe(7);
  });

  it('treats every non-value shape as null, never as 0', () => {
    for (const v of [{}, null, undefined, NaN, Infinity, 'abc', true, []]) {
      expect(rawNumber(v), String(v)).toBeNull();
    }
  });

  it('an empty module is a null stat, not a zero one', () => {
    // Yahoo answers `{}` for a field that does not apply (an ETF has no P/E).
    const stats = parseKeyStats(QUOTE_SUMMARY_EMPTY);
    expect(stats).toBeNull();
  });

  it('never invents a value for a missing field', () => {
    const stats = parseKeyStats(QUOTE_SUMMARY);
    expect(stats).not.toBeNull();
    expect(stats!.marketCap).toBe(5_001_541_320_704);
    expect(stats!.trailingPE).toBeCloseTo(38.326283, 6);
    expect(stats!.dividendYield).toBeCloseTo(0.0031, 6);
    expect(stats!.beta).toBeCloseTo(1.089, 6);
  });
});

describe('fundamentals — profile, health, payload', () => {
  it('reads a real company profile', () => {
    const p = parseProfile(QUOTE_SUMMARY);
    expect(p).not.toBeNull();
    expect(p!.sector).toBe('Technology');
    expect(p!.industry).toBe('Consumer Electronics');
    expect(p!.country).toBe('United States');
    expect(p!.fullTimeEmployees).toBe(164_000);
    expect(p!.summary).toContain('Apple Inc.');
  });

  it('an empty assetProfile is null, not an object full of nulls', () => {
    expect(parseProfile(QUOTE_SUMMARY_EMPTY)).toBeNull();
    expect(parseHealthStats(QUOTE_SUMMARY_EMPTY)).toBeNull();
  });

  it('carries the analyst view verbatim (it is the provider’s opinion)', () => {
    const h = parseHealthStats(QUOTE_SUMMARY);
    expect(h).not.toBeNull();
    expect(h!.recommendationKey).toBe('buy');
    expect(h!.targetMeanPrice).toBeCloseTo(333.28052, 4);
    expect(h!.numberOfAnalystOpinions).toBe(39);
    expect(h!.profitMargins).toBeCloseTo(0.276, 6);
  });

  it('builds a full payload and labels its provenance', () => {
    const payload = parseFundamentals(QUOTE_SUMMARY, 'AAPL', {
      source: 'live',
      lastUpdated: 1_700_000_000,
    });
    expect(payload.symbol).toBe('AAPL');
    expect(payload.quoteType).toBe('EQUITY');
    expect(payload.currency).toBe('USD');
    expect(payload.source).toBe('live');
    expect(payload.lastUpdated).toBe(1_700_000_000);
    expect(payload.note).toBeNull();
    expect(payload.profile).not.toBeNull();
    expect(payload.keyStats).not.toBeNull();
    expect(payload.health).not.toBeNull();
  });

  it('a payload built from an empty answer has no data and says nothing false', () => {
    const payload = parseFundamentals(QUOTE_SUMMARY_EMPTY, 'SPY', {
      source: 'live',
      lastUpdated: 1_700_000_000,
    });
    expect(payload.profile).toBeNull();
    expect(payload.keyStats).toBeNull();
    expect(payload.health).toBeNull();
    // Even with no metrics, the type the provider *did* give is kept.
    expect(payload.quoteType).toBe('ETF');
  });

  it('detects the provider’s "you are not authenticated" envelope', () => {
    expect(isCrumbError({ quoteSummary: { error: { code: 'Unauthorized', description: 'Invalid Crumb' } } })).toBe(true);
    expect(isCrumbError(QUOTE_SUMMARY)).toBe(false);
    expect(isCrumbError(null)).toBe(false);
  });

  it('truncates a long business summary on a sentence boundary', () => {
    const long = `${'A sentence here. '.repeat(60)}Final.`;
    const out = trimSummary(long, 120)!;
    expect(out.length).toBeLessThanOrEqual(124);
    expect(out.endsWith('…')).toBe(true);
    expect(out).not.toMatch(/undefined/);
    expect(trimSummary('Short.')) .toBe('Short.');
    expect(trimSummary(null)).toBeNull();
  });

  it('places the price inside the 52-week range, clamped, and refuses nonsense', () => {
    expect(rangePosition(250, 200, 300)).toBeCloseTo(0.5, 6);
    expect(rangePosition(100, 200, 300)).toBe(0); // below the low — clamped
    expect(rangePosition(400, 200, 300)).toBe(1); // above the high — clamped
    expect(rangePosition(null, 200, 300)).toBeNull();
    expect(rangePosition(250, null, 300)).toBeNull();
    expect(rangePosition(250, 300, 300)).toBeNull(); // degenerate range
    expect(rangePosition(250, 300, 200)).toBeNull(); // inverted range
  });
});

/* ------------------------------------------------------------- news ------- */

describe('news — only real, openable stories survive', () => {
  it('maps a real story with publisher, time and link', () => {
    const items = parseNewsItems(SEARCH_NEWS, 'AAPL');
    const first = items.find((i) => i.id === 'aaa-1')!;
    expect(first.title).toBe('Apple ships a new chip');
    expect(first.publisher).toBe('Reuters');
    expect(first.link).toBe('https://example.com/a');
    expect(first.publishedAt).toBe(1_793_900_000);
    expect(first.mentionsSymbol).toBe(true);
  });

  it('drops a story with no title, no link, or a non-http link', () => {
    const ids = parseNewsItems(SEARCH_NEWS, 'AAPL').map((i) => i.id);
    expect(ids).toEqual(['aaa-1', 'aaa-2']);
    expect(ids).not.toContain('aaa-3');
    expect(ids).not.toContain('aaa-4');
    expect(ids).not.toContain('aaa-5');
  });

  it('sorts relevant stories first, then newest first', () => {
    const items = parseNewsItems(SEARCH_NEWS, 'AAPL');
    expect(items.map((i) => i.id)).toEqual(['aaa-1', 'aaa-2']);
    expect(items[0].mentionsSymbol).toBe(true);
    expect(items[1].mentionsSymbol).toBe(false);
  });

  it('records relevance from the provider’s own relatedTickers', () => {
    const items = parseNewsItems(SEARCH_NEWS, 'AAPL');
    expect(items.find((i) => i.id === 'aaa-1')!.relatedTickers).toEqual(['AAPL', 'TSM']);
    expect(items.find((i) => i.id === 'aaa-1')!.mentionsSymbol).toBe(true);
    // Ask for a symbol the story does not list: the same story is not "relevant".
    const other = parseNewsItems(SEARCH_NEWS, 'MSFT');
    expect(other.find((i) => i.id === 'aaa-1')!.mentionsSymbol).toBe(false);
  });

  it('handles an empty / malformed payload without inventing headlines', () => {
    expect(parseNewsItems({}, 'AAPL')).toEqual([]);
    expect(parseNewsItems({ news: null }, 'AAPL')).toEqual([]);
    expect(parseNewsItems(null, 'AAPL')).toEqual([]);
    expect(parseNewsItems({ news: 'nope' }, 'AAPL')).toEqual([]);
  });

  it('normalises millisecond publish times to seconds', () => {
    const items = parseNewsItems(
      { news: [{ title: 'T', link: 'https://e.com/x', providerPublishTime: 1_793_900_000_000 }] },
      'AAPL',
    );
    expect(items[0].publishedAt).toBe(1_793_900_000);
  });

  it('caps the payload at the requested limit', () => {
    const payload = parseNewsPayload(SEARCH_NEWS, 'AAPL', { source: 'live', lastUpdated: 1, limit: 1 });
    expect(payload.items).toHaveLength(1);
    expect(payload.source).toBe('live');
    expect(payload.symbol).toBe('AAPL');
  });

  it('recognises only absolute http(s) urls as a source link', () => {
    expect(isHttpUrl('https://example.com/a')).toBe(true);
    expect(isHttpUrl('http://example.com')).toBe(true);
    expect(isHttpUrl('javascript:alert(1)')).toBe(false);
    expect(isHttpUrl('/relative')).toBe(false);
    expect(isHttpUrl('')).toBe(false);
    expect(isHttpUrl(null)).toBe(false);
  });

  it('builds the documented search url', () => {
    const url = new URL(yahooNewsSearchUrl('AAPL'));
    expect(url.host).toBe('query1.finance.yahoo.com');
    expect(url.pathname).toBe('/v1/finance/search');
    expect(url.searchParams.get('q')).toBe('AAPL');
    expect(Number(url.searchParams.get('newsCount'))).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------ categorisation ---- */

describe('categorisation — real metadata or an honest Unknown', () => {
  it('maps quote types, with everything unrecognised as "other"', () => {
    expect(assetTypeFrom('EQUITY')).toBe('stock');
    expect(assetTypeFrom('equity')).toBe('stock');
    expect(assetTypeFrom('ETF')).toBe('etf');
    expect(assetTypeFrom('MUTUALFUND')).toBe('other');
    expect(assetTypeFrom(null)).toBe('other');
    expect(assetTypeFrom('')).toBe('other');
  });

  it('buckets the exchange spellings both endpoints use', () => {
    expect(exchangeBucket('NASDAQ')).toBe('NASDAQ');
    expect(exchangeBucket('NasdaqGS')).toBe('NASDAQ');
    expect(exchangeBucket('NMS')).toBe('NASDAQ');
    expect(exchangeBucket('NYSE')).toBe('NYSE');
    expect(exchangeBucket('NYSE Arca')).toBe('NYSE Arca');
    expect(exchangeBucket('PCX')).toBe('NYSE Arca');
    expect(exchangeBucket('HKSE')).toBe('HKEX');
    expect(exchangeBucket('HKG')).toBe('HKEX');
    // An unrecognised venue degrades to what the provider actually said.
    expect(exchangeBucket('Some New Exchange')).toBe('Some New Exchange');
    expect(exchangeBucket(null)).toBeNull();
  });

  it('classifies a symbol from search metadata', () => {
    const aapl = classifyFromSearchHit(SEARCH_QUOTES.quotes[0]);
    expect(aapl).not.toBeNull();
    expect(aapl!.type).toBe('stock');
    expect(aapl!.sector).toBe('Technology');
    expect(aapl!.exchange).toBe('NASDAQ');
    expect(aapl!.exchangeCode).toBe('NMS');
  });

  it('never guesses a sector it was not given', () => {
    const unknown = classifySymbol({ symbol: 'zzzz' });
    expect(unknown.symbol).toBe('ZZZZ');
    expect(unknown.type).toBe('other');
    expect(unknown.sector).toBeNull();
    expect(unknown.exchange).toBeNull();
  });

  it('a richer record wins when merging', () => {
    const thin = classifySymbol({ symbol: 'AAPL', quoteType: 'EQUITY' });
    const rich = classifySymbol({ symbol: 'AAPL', quoteType: 'EQUITY', sector: 'Technology', exchange: 'NASDAQ' });
    const merged = mergeCategory(rich, thin);
    expect(merged.sector).toBe('Technology');
    expect(merged.exchange).toBe('NASDAQ');
    const merged2 = mergeCategory(thin, rich);
    expect(merged2.sector).toBe('Technology');
    expect(mergeCategory(undefined, rich)).toEqual(rich);
  });

  it('reads the right field for each grouping mode', () => {
    const cat: SymbolCategory = classifySymbol({
      symbol: 'AAPL',
      quoteType: 'EQUITY',
      sector: 'Technology',
      exchange: 'NASDAQ',
    });
    expect(groupKeyFor(cat, 'sector')).toBe('Technology');
    expect(groupKeyFor(cat, 'type')).toBe('stock');
    expect(groupKeyFor(cat, 'exchange')).toBe('NASDAQ');
    expect(groupKeyFor(cat, 'all')).toBeNull();
    expect(groupKeyFor(undefined, 'sector')).toBeNull();
  });

  it('"all" is one unlabelled bucket that preserves order', () => {
    const groups = groupSymbols(['B', 'A', 'C'], {}, 'all');
    expect(groups).toHaveLength(1);
    expect(groups[0].raw).toBeNull();
    expect(groups[0].symbols).toEqual(['B', 'A', 'C']);
    expect(groupSymbols([], {}, 'all')).toEqual([]);
  });

  it('partitions the list exactly once, in first-appearance order', () => {
    const cats: Record<string, SymbolCategory> = {
      AAPL: classifySymbol({ symbol: 'AAPL', quoteType: 'EQUITY', sector: 'Technology' }),
      MSFT: classifySymbol({ symbol: 'MSFT', quoteType: 'EQUITY', sector: 'Technology' }),
      XOM: classifySymbol({ symbol: 'XOM', quoteType: 'EQUITY', sector: 'Energy' }),
    };
    const groups = groupSymbols(['AAPL', 'XOM', 'MSFT'], cats, 'sector');
    expect(groups.map((g) => g.raw)).toEqual(['Technology', 'Energy']);
    expect(groups[0].symbols).toEqual(['AAPL', 'MSFT']);
    expect(groups[1].symbols).toEqual(['XOM']);
    expect(groups.reduce((n, g) => n + g.symbols.length, 0)).toBe(3);
  });

  it('puts unclassified symbols in the Unknown bucket, always last', () => {
    const cats: Record<string, SymbolCategory> = {
      AAPL: classifySymbol({ symbol: 'AAPL', quoteType: 'EQUITY', sector: 'Technology' }),
    };
    const groups = groupSymbols(['ZZZZ', 'AAPL'], cats, 'sector');
    expect(groups.at(-1)!.id).toBe(UNKNOWN_GROUP_ID);
    expect(groups.at(-1)!.symbols).toEqual(['ZZZZ']);
    expect(groups.at(-1)!.raw).toBeNull();
  });

  it('groups by type so every row lands somewhere (type is never unknown)', () => {
    const groups = groupSymbols(['AAPL', 'SPY', 'QQQ'], {}, 'type');
    expect(groups).toHaveLength(1);
    expect(groups[0].id).not.toBe(UNKNOWN_GROUP_ID);
    expect(groups[0].raw).toBe('other');
    expect(groups[0].symbols).toEqual(['AAPL', 'SPY', 'QQQ']);
  });

  it('classifies the real captured search hits for AAPL and an ETF', () => {
    const spy = classifyFromSearchHit(SEARCH_QUOTES.quotes[1]);
    expect(spy!.type).toBe('etf');
    expect(spy!.exchange).toBe('NYSE Arca');
    const hk = classifyFromSearchHit(SEARCH_QUOTES.quotes[2]);
    expect(hk!.exchange).toBe('HKEX');
    expect(hk!.symbol).toBe('0700.HK');
  });

  it('rejects a search hit without a symbol', () => {
    expect(classifyFromSearchHit({ symbol: '' } as never)).toBeNull();
  });
});

describe('bilingual terminology — provider terms never leak English into zh-HK', () => {
  it('translates the sector/industry/exchange/country the provider returns', () => {
    // Yahoo returns these in English even for HK listings. A Chinese UI printing
    // "Communication Services" beside 分區 chips is the half-English feel
    // SPEC-PHASE2 §B exists to prevent.
    expect(sectorLabel('Technology', 'zh-HK')).toBe('資訊科技');
    expect(industryLabel('Internet Content & Information', 'zh-HK')).toBe('互聯網內容與資訊');
    expect(exchangeLabel('HKEX', 'zh-HK')).toBe('香港交易所');
    expect(exchangeLabel('NYSE Arca', 'zh-HK')).toBe('紐約證券交易所（Arca）');
    expect(countryLabel('United States', 'zh-HK')).toBe('美國');
    expect(quoteTypeLabel('ETF', 'zh-HK')).toBe('交易所買賣基金 (ETF)');
  });

  it('leaves the term untouched in English', () => {
    expect(sectorLabel('Technology', 'en')).toBe('Technology');
    expect(countryLabel('United States', 'en')).toBe('United States');
  });

  it('degrades to the provider string rather than inventing a translation', () => {
    // An unlisted venue/sector must NOT be guessed at.
    expect(exchangeLabel('Some New Venue', 'zh-HK')).toBe('Some New Venue');
    expect(countryLabel('Ruritania', 'zh-HK')).toBe('Ruritania');
    expect(sectorLabel(null, 'zh-HK')).toBe('');
    expect(countryLabel(undefined, 'en')).toBe('');
  });

  it('has a real Chinese label for every term it claims to translate', () => {
    // Guards against a table entry accidentally left in English, which would
    // render identically to "untranslated" and slip through review.
    const han = /[\u3400-\u9fff]/;
    for (const table of [SECTORS_ZH, INDUSTRIES_ZH, EXCHANGES_ZH, COUNTRIES_ZH, RECOMMENDATION_ZH]) {
      for (const [key, value] of Object.entries(table)) {
        expect(han.test(value), `${key} → ${value} is not Chinese`).toBe(true);
      }
    }
  });
});
