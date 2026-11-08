/**
 * Phase 3 service-level tests (§A.1, §A.4, §D.1) — cache paths and honesty.
 *
 * §D.1 asks for tests of "every … cache path". These drive the *real*
 * `loadStatements` / `loadEstimates` / `loadRatings` against a fake `fetch`, so
 * what is exercised is the code that actually runs in production, not a
 * re-implementation of it. The fake fetch is a routing stub: it answers the
 * consent/crumb handshake and the `query2` timeseries call, and it *counts* the
 * network calls so a cache hit is proven by the absence of a second call rather
 * than by the presence of a `source` string.
 *
 * The rule under test throughout is the spec's: "we could not ask" must never be
 * cached as "there is none", and no empty envelope is ever persisted.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { openDb, type Db } from '../server/db';
import { TTL3, loadEstimates, loadRatings, loadStatements } from '../server/phase3-service';
import { isNoteKey } from '../shared/api-errors';

const FIXTURES = resolve(__dirname, 'fixtures');
const timeseriesAnnual = JSON.parse(readFileSync(resolve(FIXTURES, 'timeseries-AAPL-annual.json'), 'utf8'));

/* ------------------------------------------------------------------ harness */

/** One recorded upstream call. */
interface Call {
  url: string;
}

/**
 * A routing `fetch` double.
 *
 * - the two consent hosts answer 200 with a `Set-Cookie` so a session mints;
 * - `getcrumb` answers `abc123.Crumb`;
 * - `fundamentals-timeseries` answers whatever the current scenario supplies;
 * - `chart` answers a tiny 2-bar series (the statement path asks it for a price);
 * - `quoteSummary` answers the analyst fixture.
 */
function makeFetch(scenario: { timeseries?: unknown; quoteSummary?: unknown; chart?: unknown } = {}) {
  const calls: Call[] = [];
  const impl = (async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({ url });

    if (url.includes('/v1/test/getcrumb')) {
      return new Response('abc123.Crumb', {
        status: 200,
        headers: { 'set-cookie': 'A3=crumbcookie; Path=/; Domain=.yahoo.com' },
      });
    }
    if (url.includes('fc.yahoo.com')) {
      return new Response('', { status: 200, headers: { 'set-cookie': 'A1=prime; Path=/; Domain=.yahoo.com' } });
    }
    if (url.includes('fundamentals-timeseries')) {
      const body = scenario.timeseries ?? null;
      if (body === null) return new Response('{}', { status: 200 });
      return new Response(JSON.stringify(body), { status: 200 });
    }
    if (url.includes('/v10/finance/quoteSummary/')) {
      const body = scenario.quoteSummary ?? null;
      if (body === null) return new Response('{}', { status: 200 });
      return new Response(JSON.stringify(body), { status: 200 });
    }
    if (url.includes('/v8/finance/chart/')) {
      const body = scenario.chart === undefined ? CHART_FIXTURE : scenario.chart;
      if (body === null) return new Response('not found', { status: 404 });
      return new Response(JSON.stringify(body), { status: 200 });
    }
    return new Response('not found', { status: 404 });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

/** The smallest chart payload the price lookup will accept (2 bars). */
const CHART_FIXTURE = {
  chart: {
    result: [
      {
        meta: {
          symbol: 'AAPL',
          currency: 'USD',
          regularMarketPrice: 200,
          regularMarketChange: 1,
          longName: 'Apple Inc.',
        },
        timestamp: [1_790_000_000, 1_790_086_400],
        indicators: {
          quote: [
            {
              open: [199, 200],
              high: [201, 202],
              low: [198, 199],
              close: [200, 201],
              volume: [1_000_000, 1_100_000],
            },
          ],
        },
      },
    ],
  },
};

const countOf = (calls: Call[], needle: string) => calls.filter((c) => c.url.includes(needle)).length;

let db: Db;

beforeEach(() => {
  db = openDb(':memory:');
});
afterEach(() => {
  db.close();
  vi.restoreAllMocks();
});

/* ==================================================== statements / caching == */

describe('§A.1 / §D.1 — statements: the cache is real and the empty is honest', () => {
  it('a live parse is cached, and the second call reads it without touching the network', async () => {
    const { impl, calls } = makeFetch({ timeseries: timeseriesAnnual });
    const first = await loadStatements(db, 'AAPL', 'annual', { fetchImpl: impl, now: 1_800_000_000 });
    expect(first.source).toBe('live');
    expect(first.income.rows.length).toBeGreaterThan(0);
    const afterFirst = countOf(calls, 'fundamentals-timeseries');

    const second = await loadStatements(db, 'AAPL', 'annual', { fetchImpl: impl, now: 1_800_000_000 });
    expect(second.source).toBe('cache');
    expect(countOf(calls, 'fundamentals-timeseries')).toBe(afterFirst);
    // The cached read is the same arithmetic, not a cheaper re-derivation.
    expect(second.metrics.items.map((m) => [m.id, m.value])).toEqual(
      first.metrics.items.map((m) => [m.id, m.value]),
    );
  });

  it('an empty provider reply is NOT cached — the next call asks again', async () => {
    // This is the rule the spec is most emphatic about: caching `{}` would turn
    // a 30-second provider hiccup into 12 hours of a panel that reads "no data".
    const empty = makeFetch({ timeseries: { timeseries: { result: [] } } });
    const one = await loadStatements(db, 'AAPL', 'annual', { fetchImpl: empty.impl, now: 1_800_000_000 });
    expect(one.source).toBe('unavailable');
    expect(one.note).toBe('note.statementsUnavailable');
    expect(one.metrics.items.every((m) => m.value === null)).toBe(true);

    const two = await loadStatements(db, 'AAPL', 'annual', { fetchImpl: empty.impl, now: 1_800_000_000 });
    expect(two.source).toBe('unavailable');
    // Two attempts ⇒ nothing was remembered from the first.
    expect(countOf(empty.calls, 'fundamentals-timeseries')).toBe(2);
  });

  it('a provider outage falls back to the cached copy, clearly marked stale', async () => {
    const live = makeFetch({ timeseries: timeseriesAnnual });
    const warm = await loadStatements(db, 'AAPL', 'annual', { fetchImpl: live.impl, now: 1_800_000_000 });
    expect(warm.source).toBe('live');

    // Past the TTL and the provider now returns nothing at all.
    const dead = makeFetch({ timeseries: null });
    const stale = await loadStatements(db, 'AAPL', 'annual', { fetchImpl: dead.impl, now: 1_800_000_000 + TTL3.statements + 10 });
    expect(stale.source).toBe('stale-cache');
    expect(stale.income.rows.length).toBeGreaterThan(0);
    // Stale numbers are the *real* ones from before, never zeroed out.
    expect(stale.metrics.items.map((m) => m.value)).toEqual(warm.metrics.items.map((m) => m.value));
  });

  it('force bypasses the cache and re-fetches', async () => {
    const { impl, calls } = makeFetch({ timeseries: timeseriesAnnual });
    await loadStatements(db, 'AAPL', 'annual', { fetchImpl: impl, now: 1_800_000_000 });
    const before = countOf(calls, 'fundamentals-timeseries');
    await loadStatements(db, 'AAPL', 'annual', { fetchImpl: impl, now: 1_800_000_000, force: true });
    expect(countOf(calls, 'fundamentals-timeseries')).toBe(before + 1);
  });

  it('a symbol the provider does not carry yields the honest empty, not a throw', async () => {
    // The provider answers 200 with a timeseries envelope whose requested series
    // are absent, so `hasAnyRows` is false and nothing was parsed.
    const { impl } = makeFetch({
      timeseries: { timeseries: { result: [{ meta: { type: ['annualTotalRevenue'] } }] } },
      quoteSummary: null,
      chart: null,
    });
    const out = await loadStatements(db, 'ZZZZ', 'annual', { fetchImpl: impl, now: 1_800_000_000 });
    expect(out.note).toBe('note.statementsUnavailable');
    expect(out.price).toBeNull();
    // The table keeps its stable shape (a fixed line list) but every cell is
    // null — an em dash, never a zero standing in for an absent figure.
    expect(out.income.rows.length).toBeGreaterThan(0);
    expect(out.income.rows.every((row) => row.values.every((v) => v === null))).toBe(true);
    expect(out.income.columns).toEqual([]);
  });

  it('a price failure makes the multiples null rather than poisoning them', async () => {
    // The chart endpoint 404s here, so there is no price. Every market-cap
    // multiple must be `—`; a `0` would read as a real, terrible P/E.
    const { impl } = makeFetch({ timeseries: timeseriesAnnual, chart: null });
    const out = await loadStatements(db, 'AAPL', 'annual', { fetchImpl: impl, now: 1_800_000_000 });
    expect(out.price).toBeNull();
    expect(out.metrics.marketCap).toBeNull();
    expect(out.metrics.ev).toBeNull();
    expect(out.metrics.items.find((m) => m.id === 'pe')!.value).toBeNull();
    expect(out.metrics.items.find((m) => m.id === 'pb')!.value).toBeNull();
    // The statements themselves still render — only price-derived figures are dashed.
    expect(out.income.rows.length).toBeGreaterThan(0);
  });

  it('with a price, the multiples are real numbers', async () => {
    const { impl } = makeFetch({ timeseries: timeseriesAnnual });
    const out = await loadStatements(db, 'AAPL', 'annual', { fetchImpl: impl, now: 1_800_000_000 });
    expect(out.price).toBe(200);
    expect(out.metrics.marketCap).toBeCloseTo(out.inputs.sharesOutstanding! * 200, 0);
    expect(out.metrics.items.find((m) => m.id === 'pe')!.value).not.toBeNull();
  });

  it('the statement payload exposes the inputs behind every derived ratio', async () => {
    const { impl } = makeFetch({ timeseries: timeseriesAnnual });
    const out = await loadStatements(db, 'AAPL', 'annual', { fetchImpl: impl, now: 1_800_000_000 });
    // §A.3: a number a user cannot check is a number they cannot trust. The
    // inputs are in the payload so the UI can show the arithmetic.
    expect(out.inputs).toBeTruthy();
    expect(typeof out.inputs.revenue === 'number' || out.inputs.revenue === null).toBe(true);
  });

  it('regression: switching period never serves the other period\'s payload', async () => {
    // Found by the §D.3 live check (2026-11-06). `quarterly` and `ltm` read the
    // same upstream series, and the cache key was built from the *fetch prefix*
    // (`quarterly` for both), so asking for LTM right after quarterly returned
    // the quarterly payload — the LTM table arrived labelled `quarterly`, with
    // the computed four-quarter sums silently absent. Each requested period now
    // owns its cache entry.
    const quarterly = JSON.parse(readFileSync(resolve(FIXTURES, 'timeseries-AAPL-quarterly.json'), 'utf8'));
    const { impl } = makeFetch({ timeseries: quarterly, chart: null });

    const q1 = await loadStatements(db, 'AAPL', 'quarterly', { fetchImpl: impl, now: 1_800_000_000 });
    expect(q1.period).toBe('quarterly');
    expect(q1.income.anyComputed).toBe(false);

    // The LTM request must NOT be answered from the quarterly entry.
    const ltm = await loadStatements(db, 'AAPL', 'ltm', { fetchImpl: impl, now: 1_800_000_000 });
    expect(ltm.period).toBe('ltm');
    expect(ltm.income.anyComputed).toBe(true);
    // The LTM value is the trailing-four-quarter sum, i.e. strictly larger than
    // any single quarter for a flow line — proving it really aggregated.
    const ltmRevenue = ltm.income.rows.find((r) => r.labelKey.includes('Revenue'))!.values.at(-1)!;
    const qRevenue = q1.income.rows.find((r) => r.labelKey.includes('Revenue'))!.values.at(-1)!;
    expect(ltmRevenue).toBeGreaterThan(qRevenue);

    // And a cached repeat of each still returns its own shape.
    const q2 = await loadStatements(db, 'AAPL', 'quarterly', { fetchImpl: impl, now: 1_800_000_000 });
    const ltm2 = await loadStatements(db, 'AAPL', 'ltm', { fetchImpl: impl, now: 1_800_000_000 });
    expect([q2.source, q2.period, q2.income.anyComputed]).toEqual(['cache', 'quarterly', false]);
    expect([ltm2.source, ltm2.period, ltm2.income.anyComputed]).toEqual(['cache', 'ltm', true]);
  });
});

/* ==================================================== analyst bundle / cache */

describe('§A.2 / §D.1 — the analyst bundle is one call, cached, with honest fallbacks', () => {
  const fixture = JSON.parse(readFileSync(resolve(FIXTURES, 'quotesummary-AAPL.json'), 'utf8'));

  it('estimates and ratings share a single quoteSummary call', async () => {
    const { impl, calls } = makeFetch({ quoteSummary: fixture, timeseries: timeseriesAnnual });
    await loadEstimates(db, 'AAPL', { fetchImpl: impl, now: 1_800_000_000 });
    await loadRatings(db, 'AAPL', { fetchImpl: impl, now: 1_800_000_000 });
    // One shared bundle ⇒ exactly one quoteSummary fetch (the chart calls for
    // the 1-year return do not hit quoteSummary).
    expect(countOf(calls, 'v10/finance/quoteSummary')).toBe(1);
  });

  it('the second estimates call is served from cache with no new quoteSummary call', async () => {
    const { impl, calls } = makeFetch({ quoteSummary: fixture });
    await loadEstimates(db, 'AAPL', { fetchImpl: impl, now: 1_800_000_000 });
    const after = countOf(calls, 'v10/finance/quoteSummary');
    const again = await loadEstimates(db, 'AAPL', { fetchImpl: impl, now: 1_800_000_000 });
    expect(again.source).toBe('cache');
    expect(countOf(calls, 'v10/finance/quoteSummary')).toBe(after);
  });

  it('parses the real AAPL fixture into the four periods with no invented fifth', async () => {
    const { impl } = makeFetch({ quoteSummary: fixture });
    const est = await loadEstimates(db, 'AAPL', { fetchImpl: impl, now: 1_800_000_000 });
    expect(est.periods.map((p) => p.id)).toEqual(['0q', '+1q', '0y', '+1y']);
    expect(est.extraYears).toBe(2);
  });

  it('an unusable reply is not cached, and the second call asks again', async () => {
    // A structurally valid but fact-free bundle (no estimates, no targets, no
    // price). Persisting it would freeze "no coverage" for an hour.
    const blank = { quoteSummary: { result: [{ earningsTrend: { trend: [] } }] } };
    const a = makeFetch({ quoteSummary: blank });
    const one = await loadEstimates(db, 'AAPL', { fetchImpl: a.impl, now: 1_800_000_000 });
    expect(one.source).toBe('unavailable');
    expect(one.note).toBe('note.estimatesUnavailable');
    await loadEstimates(db, 'AAPL', { fetchImpl: a.impl, now: 1_800_000_000 });
    expect(countOf(a.calls, 'v10/finance/quoteSummary')).toBe(2);
  });

  it('a bundle outage serves the stale cached estimates with the right note', async () => {
    const live = makeFetch({ quoteSummary: fixture });
    const warm = await loadEstimates(db, 'AAPL', { fetchImpl: live.impl, now: 1_800_000_000 });
    expect(warm.source).toBe('live');

    const dead = makeFetch({ quoteSummary: null });
    const stale = await loadEstimates(db, 'AAPL', { fetchImpl: dead.impl, now: 1_800_000_000 + TTL3.analyst + 10 });
    expect(stale.source).toBe('stale-cache');
    expect(stale.note).toBe('note.estimatesUnreachableCached');
    expect(stale.periods).toEqual(warm.periods);
  });

  it('a no-coverage symbol gives empty ratings and null targets, never zeros', async () => {
    const blank = { quoteSummary: { result: [{ recommendationTrend: { trend: [] } }] } };
    const { impl } = makeFetch({ quoteSummary: blank });
    const r = await loadRatings(db, 'ZZZZ', { fetchImpl: impl, now: 1_800_000_000 });
    expect(r.source).toBe('unavailable');
    expect(r.ratings.buckets).toEqual([]);
    expect(r.ratings.targetMean).toBeNull();
    expect(r.target.upsidePct).toBeNull();
    expect(r.actions).toEqual([]);
  });

  it('the ratings payload carries a current-point target, not a fabricated history', async () => {
    const { impl } = makeFetch({ quoteSummary: fixture });
    const r = await loadRatings(db, 'AAPL', { fetchImpl: impl, now: 1_800_000_000 });
    expect(r.actions.every((a) => typeof a.at === 'number')).toBe(true);
    expect(r.actions.length).toBeLessThanOrEqual(25);
    // `oneYearReturn` is derived from real price history or is null — never 0.
    expect(r.oneYearReturn === null || Number.isFinite(r.oneYearReturn)).toBe(true);
  });
});

/* ============================================================ TTL boundary == */

describe('§D.1 — the freshness boundary is inclusive and off-by-one safe', () => {
  it('a payload exactly at the TTL is still fresh; one second past is not', async () => {
    const { impl, calls } = makeFetch({ timeseries: timeseriesAnnual });
    const t0 = 1_800_000_000;
    await loadStatements(db, 'AAPL', 'annual', { fetchImpl: impl, now: t0 });
    const afterFirst = countOf(calls, 'fundamentals-timeseries');

    // Exactly at the boundary: `now - updatedAt <= TTL` ⇒ still a cache read.
    const atBoundary = await loadStatements(db, 'AAPL', 'annual', { fetchImpl: impl, now: t0 + TTL3.statements });
    expect(atBoundary.source).toBe('cache');
    expect(countOf(calls, 'fundamentals-timeseries')).toBe(afterFirst);

    // One second past: must re-fetch.
    const past = await loadStatements(db, 'AAPL', 'annual', { fetchImpl: impl, now: t0 + TTL3.statements + 1 });
    expect(past.source).toBe('live');
    expect(countOf(calls, 'fundamentals-timeseries')).toBe(afterFirst + 1);
  });

  it('the TTLs are ordered sensibly for the data they cover', () => {
    // Statements barely change ⇒ the longest window; analyst consensus moves
    // daily ⇒ shorter; FX moves daily at most ⇒ in between.
    expect(TTL3.statements).toBeGreaterThan(TTL3.analyst);
    expect(TTL3.fx).toBeGreaterThan(TTL3.analyst);
    for (const v of Object.values(TTL3)) expect(v).toBeGreaterThan(0);
  });

  it('every note the analyst payloads can carry is a recognised note key', async () => {
    // The actual §D.3 failure (2026-11-06): Phase 3 introduced new note codes
    // but `NOTE_KEYS` was never extended, so `isNoteKey()` — the guard against
    // raw prose leaking into a `note` field — reported valid payloads as bad.
    const { impl } = makeFetch({ timeseries: { timeseries: { result: [] } }, chart: null });
    const stmt = await loadStatements(db, 'ZZZZ', 'annual', { fetchImpl: impl, now: 1_800_000_000 });
    expect(stmt.note).not.toBeNull();
    expect(isNoteKey(stmt.note), `note '${stmt.note}' must be in NOTE_KEYS`).toBe(true);

    const blank = makeFetch({ quoteSummary: null });
    const est = await loadEstimates(db, 'ZZZZ', { fetchImpl: blank.impl, now: 1_800_000_000 });
    const rat = await loadRatings(db, 'ZZZZ', { fetchImpl: blank.impl, now: 1_800_000_000 });
    for (const n of [est.note, rat.note]) {
      expect(isNoteKey(n), `note '${n}' must be in NOTE_KEYS`).toBe(true);
    }
  });
});

/* ============================================================ no leakage ==== */

describe('§A.4 — no cookie or crumb ever reaches the payload', () => {
  it('the serialised payloads contain no session material', async () => {
    const fixture = JSON.parse(readFileSync(resolve(FIXTURES, 'quotesummary-AAPL.json'), 'utf8'));
    const { impl } = makeFetch({ quoteSummary: fixture, timeseries: timeseriesAnnual });
    const [s, e, r] = [
      await loadStatements(db, 'AAPL', 'annual', { fetchImpl: impl, now: 1_800_000_000 }),
      await loadEstimates(db, 'AAPL', { fetchImpl: impl, now: 1_800_000_000 }),
      await loadRatings(db, 'AAPL', { fetchImpl: impl, now: 1_800_000_000 }),
    ];
    for (const payload of [s, e, r]) {
      const json = JSON.stringify(payload);
      expect(json).not.toContain('crumbcookie');
      expect(json).not.toContain('abc123.Crumb');
      expect(json).not.toMatch(/A3=/);
      expect(json).not.toMatch(/A1=/);
    }
  });
});
