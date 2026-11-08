import { describe, expect, it } from 'vitest';
import {
  isUsableFundamentals,
  parseFundamentals,
  parseHealthStats,
  parseKeyStats,
  parseProfile,
} from '../shared/fundamentals';
import type { FundamentalsPayload } from '../shared/types';

/* --------------------------------------------------- cacheability rule ---- */

/**
 * `loadFundamentals` refuses to persist a reply that carries no usable facts
 * (a transient provider hiccup, a cold crumb session). `isUsableFundamentals`
 * is that rule, and `scripts/verify-runtime.ts` reasons about it too — so it
 * must be a deliberate, tested property rather than an inline guess.
 */

/** A reply with real facts in every section. */
const RICH = {
  quoteSummary: {
    result: [
      {
        price: { marketCap: { raw: 5_001_541_320_704 }, quoteType: 'EQUITY', currency: 'USD' },
        summaryDetail: { trailingPE: { raw: 38.326283 }, fiftyTwoWeekLow: { raw: 243.42 }, fiftyTwoWeekHigh: { raw: 355.38 } },
        defaultKeyStatistics: { priceToBook: { raw: 51.2 }, trailingEps: { raw: 8.98 } },
        financialData: { profitMargins: { raw: 0.276 }, returnOnEquity: { raw: 1.4226 } },
        assetProfile: {
          sector: 'Technology',
          industry: 'Consumer Electronics',
          country: 'United States',
          longBusinessSummary: 'Apple Inc. designs, manufactures and markets smartphones and personal computers.',
        },
      },
    ],
    error: null,
  },
};

/** A reply that is structurally valid but says almost nothing (an ETF). */
const THIN = {
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

const SHELL: FundamentalsPayload = {
  symbol: 'AAPL',
  profile: null,
  keyStats: null,
  health: null,
  quoteType: null,
  currency: null,
  source: 'unavailable',
  lastUpdated: null,
  note: 'note.fundamentalsUnavailable',
};

describe('fundamentals cacheability', () => {
  it('an envelope with no facts at all is not cacheable', () => {
    expect(isUsableFundamentals(SHELL)).toBe(false);
  });

  it('any one usable section makes it cacheable', () => {
    expect(isUsableFundamentals({ ...SHELL, profile: parseProfile(RICH) })).toBe(true);
    expect(isUsableFundamentals({ ...SHELL, keyStats: parseKeyStats(RICH) })).toBe(true);
    expect(isUsableFundamentals({ ...SHELL, health: parseHealthStats(RICH) })).toBe(true);
  });

  it('a structurally valid but fact-free reply is NOT cacheable', () => {
    // An ETF whose every section parsed to `null`. Caching this would turn a
    // transient provider hiccup into six hours of a panel that reads "no data",
    // so the service deliberately re-asks instead of persisting emptiness.
    // The cost is one extra upstream call for a genuinely thin instrument; the
    // benefit is that "we could not ask" never masquerades as "there is none".
    const parsed = parseFundamentals(THIN, 'SPY', { source: 'live', lastUpdated: 1_793_900_000 });
    expect(parsed.profile).toBeNull();
    expect(parsed.keyStats).toBeNull();
    expect(isUsableFundamentals(parsed)).toBe(false);
  });

  it('a thin reply is cacheable as soon as it carries one real fact', () => {
    // Same ETF, but the provider does publish a market cap: now there is
    // something worth remembering, and a second call must read the cache.
    const thinWithCap = {
      quoteSummary: {
        result: [{ price: { marketCap: { raw: 12_345_678 }, quoteType: 'ETF' }, assetProfile: {} }],
        error: null,
      },
    };
    const parsed = parseFundamentals(thinWithCap, 'SPY', { source: 'live', lastUpdated: 1_793_900_000 });
    expect(isUsableFundamentals(parsed)).toBe(true);
  });

  it('a wholly unrecognised reply is not cacheable', () => {
    // e.g. an HTML error page or an unexpected envelope shape.
    const parsed = parseFundamentals({ error: 'nope' }, 'AAPL', {
      source: 'live',
      lastUpdated: 1_793_900_000,
    });
    expect(isUsableFundamentals(parsed)).toBe(false);
  });
});
