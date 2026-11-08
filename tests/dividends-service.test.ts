/**
 * Phase 4 dividends — service- and route-level tests (SPEC-PHASE4 §A.7, §D.1).
 *
 * These drive the *real* `loadDividends` / `loadDividendHistory` and the real
 * Express routes against a routing `fetch` double, so what is exercised is the
 * code that ships. The two rules under test are the ones that cost data if they
 * regress:
 *
 *   1. §A.7 — a `quoteSummary` answer with **no `quoteSummary` key at all** is
 *      UNAVAILABLE. It is retried with a forced session re-mint, and if it stays
 *      empty it is served as `null`s — never as `0`, and never cached.
 *   2. §A.1.1 — facts ride a session, history does not. With the crumb path
 *      hard-down, the two history graphs must still be drawn.
 *
 * The last test in the file is the §A.1.2 pin: the URL history requests must
 * never contain `range=max`, because that silently drops whole decades of
 * payments (KO: 169 events vs 258 with an explicit window).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import { openDb, type Db } from '../server/db';
import { createApp } from '../server/app';
import { isNoteKey } from '../shared/api-errors';

const DAY = 86400;
const NOW = 1_800_000_000; // fixed clock — never the wall clock
const at = (iso: string) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / 1000);

/* ------------------------------------------------------------------ fixtures */

/** Quarterly payments for a symbol, shaped as a chart `events.dividends` map. */
function chartEvents(symbol: string, years: number[], perQuarter: number, currency = 'USD'): unknown {
  const events: Record<string, { amount: number; date: number }> = {};
  let i = 0;
  for (const y of years) {
    for (const md of ['03-15', '06-15', '09-15', '12-15']) {
      events[String(i++)] = { amount: perQuarter, date: at(`${y}-${md}`) };
    }
  }
  return {
    chart: {
      result: [
        {
          meta: { symbol, currency, regularMarketPrice: 100, regularMarketChange: 0, longName: symbol },
          timestamp: [at('2024-01-31'), at('2025-01-31')],
          events: { dividends: events },
          indicators: { quote: [{ close: [99, 100], high: [101, 102], low: [98, 99], open: [98, 100], volume: [1, 1] }] },
        },
      ],
    },
  };
}

/** A usable `quoteSummary` answer carrying dividend facts. */
function goodSummary(symbol: string, currency = 'USD'): unknown {
  return {
    quoteSummary: {
      result: [
        {
          price: { currency, symbol },
          summaryDetail: {
            dividendRate: { raw: 1.0 },
            dividendYield: { raw: 0.01 },
            trailingAnnualDividendYield: { raw: 0.01 },
            trailingAnnualDividendRate: { raw: 1.0 },
            payoutRatio: { raw: 0.5 },
            fiveYearAvgDividendYield: { raw: 1.0 },
            exDividendDate: { raw: at('2026-12-01') },
          },
          defaultKeyStatistics: { lastDividendValue: { raw: 0.25 }, trailingEps: { raw: 2.0 } },
          calendarEvents: { dividendDate: { raw: at('2026-12-15') } },
        },
      ],
      error: null,
    },
  };
}

interface Scenario {
  /** `null` ⇒ the host 404s (a hard outage). */
  summary?: unknown;
  chartDivs?: unknown;
  timeseries?: unknown;
  /** Whenever true, the crumb host refuses to mint, as during an outage. */
  crumbDown?: boolean;
}

interface Call {
  url: string;
  viaCrumb: boolean;
}

/**
 * Routing `fetch` double. `viaCrumb` records *why* a request could be made, which
 * is how the "history survives a crumb outage" test works: the chart calls must
 * be attributable to a crumb-free path.
 */
function makeFetch(s: Scenario = {}) {
  const calls: Call[] = [];
  let summaryCalls = 0;
  const impl = (async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const isCrumb = url.includes('/v1/test/getcrumb');
    calls.push({ url, viaCrumb: isCrumb });

    if (url.includes('fc.yahoo.com')) {
      return new Response('', { status: 200, headers: { 'set-cookie': 'A1=prime; Path=/; Domain=.yahoo.com' } });
    }
    if (url.includes('/v1/test/getcrumb')) {
      if (s.crumbDown) return new Response('forbidden', { status: 403 });
      return new Response('abc123.Crumb', {
        status: 200,
        headers: { 'set-cookie': 'A3=crumbcookie; Path=/; Domain=.yahoo.com' },
      });
    }
    if (url.includes('/v10/finance/quoteSummary/')) {
      summaryCalls += 1;
      const body = s.summary === undefined ? goodSummary('TEST') : s.summary;
      if (body === null) return new Response('not found', { status: 404 });
      // `'empty'` models the §A.7 failure shape: HTTP 200, `{}`, no key at all.
      const text = body === 'empty' ? '{}' : JSON.stringify(body);
      return new Response(text, { status: 200 });
    }
    if (url.includes('fundamentals-timeseries')) {
      const body = s.timeseries ?? { timeseries: { result: [] } };
      return new Response(JSON.stringify(body), { status: 200 });
    }
    if (url.includes('/v8/finance/chart/')) {
      const body = s.chartDivs === undefined ? chartEvents('TEST', [2024, 2025], 0.25) : s.chartDivs;
      if (body === null) return new Response('not found', { status: 404 });
      return new Response(JSON.stringify(body), { status: 200 });
    }
    return new Response('not found', { status: 404 });
  }) as unknown as typeof fetch;
  return { impl, calls, summaryCallCount: () => summaryCalls };
}

const countWhere = (calls: Call[], pred: (u: string) => boolean) => calls.filter((c) => pred(c.url)).length;

let db: Db;

beforeEach(() => {
  db = openDb(':memory:');
});
afterEach(() => {
  db.close();
});

/* ================================================================ §A.7 rule */

describe('§A.7 — the empty envelope is unavailable, never zero', () => {
  it('retries the empty envelope with a forced re-mint, then serves honest nulls', async () => {
    const { impl, summaryCallCount } = makeFetch({ summary: 'empty', chartDivs: chartEvents('KO', [2024, 2025], 0.25) });
    const { loadDividends } = await import('../server/dividends-service');
    const out = await loadDividends(db, 'KO', { fetchImpl: impl, now: NOW });

    // Two attempts: the cold session returned `{}`, so a second one forces a new
    // session before giving up (probe1 `("d")` showed a no-crumb call is rejected
    // as *Invalid Crumb*, so re-minting — not dropping the crumb — is the fix).
    expect(summaryCallCount()).toBe(2);
    expect(out.source).toBe('unavailable');
    expect(isNoteKey(out.note!)).toBe(true);
    expect(out.facts.indicatedYield.value).toBeNull();
    expect(out.facts.payoutRatioLtm.value).toBeNull();
    expect(out.facts.annualRate.value).toBeNull();
    // The whole point: an unanswered question is never reported as "pays 0".
    for (const f of [out.facts.indicatedYield, out.facts.trailingYield, out.facts.payoutRatioLtm]) {
      expect(f.value).not.toBe(0);
    }
  });

  it('never caches an empty envelope — the next call asks the provider again', async () => {
    const { impl, summaryCallCount } = makeFetch({ summary: 'empty' });
    const { loadDividends } = await import('../server/dividends-service');
    await loadDividends(db, 'KO', { fetchImpl: impl, now: NOW });
    await loadDividends(db, 'KO', { fetchImpl: impl, now: NOW });
    // Two per call ⇒ nothing was remembered from the first. Caching `{}` would
    // turn a transient hiccup into six hours of "no dividend".
    expect(summaryCallCount()).toBe(4);
  });

  it('recovers from a transient empty envelope (the documented coin flip)', async () => {
    let n = 0;
    const base = makeFetch({ chartDivs: chartEvents('KO', [2024, 2025], 0.25) });
    const flaky = (async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes('/v10/finance/quoteSummary/')) {
        n += 1;
        // First call of the *first* request is the empty shape; after that, real.
        if (n <= 1) return new Response('{}', { status: 200 });
        return new Response(JSON.stringify(goodSummary('KO')), { status: 200 });
      }
      return base.impl(input as never);
    }) as unknown as typeof fetch;

    const { loadDividends } = await import('../server/dividends-service');
    const out = await loadDividends(db, 'KO', { fetchImpl: flaky, now: NOW });
    // The forced re-mint inside the same request already rescued it.
    expect(out.source).toBe('live');
    expect(out.facts.indicatedYield.value).toBeCloseTo(0.01, 10);
  });

  it('serves the last good facts as stale-cache when the provider later dies', async () => {
    const { loadDividends, TTL4 } = await import('../server/dividends-service');
    const live = makeFetch({ chartDivs: chartEvents('KO', [2024, 2025], 0.25) });
    const warm = await loadDividends(db, 'KO', { fetchImpl: live.impl, now: NOW });
    expect(warm.source).toBe('live');
    expect(warm.facts.indicatedYield.value).toBeCloseTo(0.01, 10);

    const dead = makeFetch({ summary: null, chartDivs: chartEvents('KO', [2024, 2025], 0.25) });
    const stale = await loadDividends(db, 'KO', { fetchImpl: dead.impl, now: NOW + TTL4.dividends + 10 });
    expect(stale.source).toBe('stale-cache');
    expect(stale.note).toBe('note.dividendStaleCached');
    // Stale facts are the *real* ones from before, never zeroed out.
    expect(stale.facts.indicatedYield.value).toBeCloseTo(0.01, 10);
  });

  it('a usable envelope that simply has no dividend fields is a non-payer, not an outage', async () => {
    const { impl } = makeFetch({
      summary: {
        quoteSummary: {
          result: [{ price: { currency: 'USD' }, summaryDetail: {}, defaultKeyStatistics: {} }],
          error: null,
        },
      },
      chartDivs: chartEvents('TSLA', [], 0),
    });
    const { loadDividends } = await import('../server/dividends-service');
    const out = await loadDividends(db, 'TSLA', { fetchImpl: impl, now: NOW });
    expect(out.source).toBe('live');
    expect(out.facts.currency.value).toBe('USD');
    expect(out.facts.indicatedYield.value).toBeNull();
    expect(out.facts.indicatedYield.source).toBe('absent');
  });

  it('a stopped payer (last payment in 2019) is flagged, not presented as live', async () => {
    const { impl } = makeFetch({ chartDivs: chartEvents('OLD', [2018, 2019], 0.2) });
    const { loadDividends } = await import('../server/dividends-service');
    // `now` is 2027 here, so the newest event is ~8 years stale. The chart still
    // returns every payment (a 60y ALL window), so `events.length > 0` is *not*
    // evidence of a current payer — which is exactly the distinction.
    const out = await loadDividends(db, 'OLD', { fetchImpl: impl, now: NOW });
    expect(out.note).toBe('note.dividendNoRecentPayment');
    expect(out.series.payments.length).toBe(8);
  });
});

/* ============================================= facts-outage must not blank §A.1.1 */

describe('§A.1.1 — a crumb outage never blanks the history graphs', () => {
  it('still returns every payment and the yield line when quoteSummary is unusable', async () => {
    // The crumb host 403s and the summary host 404s: the session half is dead.
    const { impl } = makeFetch({
      crumbDown: true,
      summary: null,
      chartDivs: chartEvents('KO', [2024, 2025], 0.25, 'USD'),
      timeseries: {
        timeseries: {
          result: [
            {
              meta: { type: ['trailingDividendYield'] },
              trailingDividendYield: [{ asOfDate: '2026-09-30', dataValue: 0.0233 }],
            },
          ],
        },
      },
    });
    const { loadDividendHistory } = await import('../server/dividends-service');
    const out = await loadDividendHistory(db, 'KO', '5y', { fetchImpl: impl, now: NOW });

    expect(out.payments.length).toBe(8);
    expect(out.payments[0].amount).toBeCloseTo(0.25, 10);
    expect(out.currency).toBe('USD');
    // The real yield point came through the crumb-free timeseries path.
    expect(out.yields.some((p) => p.source !== 'reconstructed')).toBe(true);
    // The history payload carries no facts block at all: the incomplete half of
    // the upstream simply does not exist here, which is the point.
    expect(Object.keys(out)).not.toContain('facts');
  });
});

/* ================================================== §A.1.2 / §A.4 the window */

describe('§A.1.2 — history windows are explicit and are never range=max', () => {
  it('never sends range=max, and does send an explicit period1/period2 pair', async () => {
    const { impl, calls } = makeFetch({ chartDivs: chartEvents('KO', [2024, 2025], 0.25) });
    const { loadDividendHistory } = await import('../server/dividends-service');
    await loadDividendHistory(db, 'KO', 'ALL', { fetchImpl: impl, now: NOW });

    const chartCalls = calls.filter((c) => c.url.includes('/v8/finance/chart/')).map((c) => c.url);
    expect(chartCalls.length).toBeGreaterThan(0);
    // No chart request anywhere on this path may use `range=max`.
    for (const url of chartCalls) expect(url).not.toContain('range=max');

    const divCalls = chartCalls.filter((u) => u.includes('events=div') && u.includes('period1='));
    expect(divCalls.length).toBeGreaterThan(0);
    for (const url of divCalls) {
      expect(url).toContain('period2=');
      expect(url).toContain('events=div');
    }
    // ALL reaches ~60y back, which is the depth an explicit window sustains.
    const all = divCalls.find((u) => u.includes(`period1=${NOW - 60 * 365 * DAY}`));
    expect(all, 'ALL must request the deep explicit window').toBeTruthy();
  });

  it('a 3y history asks for a 3y window, not for everything', async () => {
    const { impl, calls } = makeFetch({ chartDivs: chartEvents('KO', [2024, 2025], 0.25) });
    const { loadDividendHistory } = await import('../server/dividends-service');
    await loadDividendHistory(db, 'KO', '3y', { fetchImpl: impl, now: NOW });
    const urls = calls.filter((c) => c.url.includes('/v8/finance/chart/')).map((c) => c.url);
    expect(urls.some((u) => u.includes(`period1=${NOW - 3 * 365 * DAY}`))).toBe(true);
  });
});

/* ================================================================== routing */

describe('§A.6 — routes', () => {
  /**
   * Start the real Express app on an ephemeral port and point it at the double.
   *
   * `globalThis.fetch` is swapped because that is how the server resolves its
   * transport (`opts.fetchImpl ?? fetch`). The consequence is that the *client*
   * side of the test must use a captured real `fetch` — otherwise the request
   * itself goes to the double and every route answers 404.
   */
  async function withServer(
    s: Scenario,
    run: (
      client: (path: string) => Promise<{ status: number; body: Record<string, unknown> }>,
      calls: Call[],
    ) => Promise<void>,
  ) {
    const { impl, calls } = makeFetch(s);
    const realFetch = globalThis.fetch;
    globalThis.fetch = impl;
    const app: Express = createApp(db);
    const server = app.listen(0);
    await new Promise<void>((r) => server.once('listening', () => r()));
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    const base = `http://127.0.0.1:${port}`;
    const client = async (path: string) => {
      const res = await realFetch(new URL(path, base).toString());
      return { status: res.status, body: (await res.json()) as Record<string, unknown> };
    };
    try {
      await run(client, calls);
    } finally {
      globalThis.fetch = realFetch;
      await new Promise<void>((r) => server.close(() => r()));
    }
  }

  it('GET /api/dividends/:symbol returns the standard ok envelope', async () => {
    await withServer({ chartDivs: chartEvents('KO', [2024, 2025], 0.25) }, async (client) => {
      const { status, body } = await client('/api/dividends/KO');
      expect(status).toBe(200);
      expect(body.ok).toBe(true);
      const data = body.data as { symbol: string; series: { payments: unknown[] } };
      expect(data.symbol).toBe('KO');
      expect(data.series.payments.length).toBe(8);
    });
  });

  it('GET /api/dividends/:symbol/history honours ?span=', async () => {
    await withServer({ chartDivs: chartEvents('KO', [2024, 2025], 0.25) }, async (client) => {
      const { status, body } = await client('/api/dividends/KO/history?span=10y');
      expect(status).toBe(200);
      expect(body.ok).toBe(true);
      expect((body.data as { span: string }).span).toBe('10y');
    });
  });

  it('accepts the ALL span however the client cases it', async () => {
    // The canonical label is the uppercase sentinel, but a client asking `all`
    // must not be told the deepest span is invalid — that is how `?span=ALL`
    // came back 400 in the live run and silently skipped the yield assertions.
    await withServer({ chartDivs: chartEvents('KO', [2024, 2025], 0.25) }, async (client) => {
      for (const q of ['ALL', 'all', 'All']) {
        const { status, body } = await client(`/api/dividends/KO/history?span=${q}`);
        expect(status, `span=${q}`).toBe(200);
        expect((body.data as { span: string }).span).toBe('ALL');
      }
    });
  });

  it('accepts a lowercase standard span', async () => {
    await withServer({ chartDivs: chartEvents('KO', [2024, 2025], 0.25) }, async (client) => {
      const { status, body } = await client('/api/dividends/KO/history?span=3y');
      expect(status).toBe(200);
      expect((body.data as { span: string }).span).toBe('3y');
    });
  });

  it('refuses range=max on the history route instead of silently answering another span', async () => {
    await withServer({}, async (client) => {
      const { status, body } = await client('/api/dividends/KO/history?span=max');
      expect(status).toBe(400);
      expect(body.ok).toBe(false);
      expect(body.code).toBe('BAD_REQUEST');
    });
  });

  it('rejects a malformed symbol with a 400 and never calls upstream', async () => {
    await withServer({}, async (client, calls) => {
      const { status, body } = await client('/api/dividends/%25%25%25');
      expect(status).toBe(400);
      expect(body.ok).toBe(false);
      expect(body.code).toBe('BAD_SYMBOL');
      // A rejected symbol must not cost a provider round-trip.
      expect(countWhere(calls, (u) => u.includes('finance'))).toBe(0);
    });
  });

  it('an unknown-but-valid symbol yields an honest empty, not a 500', async () => {
    await withServer(
      { summary: null, chartDivs: { chart: { result: null, error: { code: 'Not Found' } } }, timeseries: null },
      async (client) => {
        const { status, body } = await client('/api/dividends/ZZZZ');
        expect(status).toBe(200);
        expect(body.ok).toBe(true);
        const data = body.data as { facts: { indicatedYield: { value: number | null } }; series: { payments: unknown[] } };
        expect(data.facts.indicatedYield.value).toBeNull();
        expect(data.series.payments).toEqual([]);
      },
    );
  });
});

/* =========================== §A.2 — the provider's literal zero is a dash ==== */

describe('§A.2 — a literal 0 from the provider is "pays none", not "pays 0%"', () => {
  it('serves nulls for TSLA, which returns dividendYield: 0 and no rate', async () => {
    const { impl } = makeFetch({
      // The exact live shape (probed 2026-11-07): real modules, zeroed fields.
      summary: {
        quoteSummary: {
          result: [
            {
              price: { currency: 'USD' },
              summaryDetail: {
                dividendYield: { raw: 0 },
                trailingAnnualDividendYield: { raw: 0 },
                payoutRatio: { raw: 0 },
              },
              defaultKeyStatistics: {},
            },
          ],
          error: null,
        },
      },
      chartDivs: chartEvents('TSLA', [], 0),
    });
    const { loadDividends } = await import('../server/dividends-service');
    const out = await loadDividends(db, 'TSLA', { fetchImpl: impl, now: NOW });
    expect(out.source).toBe('live');
    expect(out.facts.indicatedYield.value).toBeNull();
    expect(out.facts.trailingYield.value).toBeNull();
    expect(out.facts.payoutRatioLtm.value).toBeNull();
    expect(out.facts.forwardYield.value).toBeNull();
    expect(out.facts.indicatedYield.note).toBe('note.dividendNoDividend');
    expect(out.facts.indicatedYield.value).not.toBe(0);
    expect(out.series.payments).toEqual([]);
  });
});
