/**
 * §C.4 matrix basis — the regression pin for the "annual stands in for a
 * quarterly actual" bug found by independent verification on 2026-11-06.
 *
 * The defect: `readCachedActuals` read the *annual* payload into a slot named
 * `ltm`, and `buildForecastMatrix` did `actual.revenue ?? ltm.revenue`. So the
 * row compared a full-year figure (478.8B) against a single-quarter forecast
 * (155.6B) and printed a fabricated **−67.5%** change — and the EPS row fell
 * back to the annual 8.98 against a 2.90 forecast (**−67.7%**). The result also
 * depended on which statement tab the user opened first, i.e. on cache order.
 *
 * These tests drive the real `loadStatements`/`loadEstimates` so they exercise
 * the production path, and they pin three things:
 *   1. the actual is the LATEST QUARTER, never the annual figure;
 *   2. the result is IDENTICAL whether only-annual or only-quarterly is cached;
 *   3. growth is computed from comparable (quarter vs quarter) bases.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { openDb, type Db } from '../server/db';
import { loadEstimates, loadStatements } from '../server/phase3-service';
import { growthBetween } from '../shared/estimates';

const FIXTURES = resolve(__dirname, 'fixtures');
const tsQuarterly = JSON.parse(readFileSync(resolve(FIXTURES, 'timeseries-AAPL-quarterly.json'), 'utf8'));
const tsAnnual = JSON.parse(readFileSync(resolve(FIXTURES, 'timeseries-AAPL-annual.json'), 'utf8'));
const quoteSummary = JSON.parse(readFileSync(resolve(FIXTURES, 'quotesummary-AAPL.json'), 'utf8'));

const CHART_FIXTURE = {
  chart: {
    result: [
      {
        meta: { symbol: 'AAPL', currency: 'USD', regularMarketPrice: 200, longName: 'Apple Inc.' },
        timestamp: [1_790_000_000, 1_790_086_400],
        indicators: {
          quote: [{ open: [199, 200], high: [201, 202], low: [198, 199], close: [200, 201], volume: [1e6, 1.1e6] }],
        },
      },
    ],
  },
};

function makeFetch(scenario: { timeseries?: unknown }) {
  const impl = (async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes('/v1/test/getcrumb')) {
      return new Response('abc123.Crumb', { status: 200, headers: { 'set-cookie': 'A3=c; Path=/' } });
    }
    if (url.includes('fc.yahoo.com')) {
      return new Response('', { status: 200, headers: { 'set-cookie': 'A1=p; Path=/' } });
    }
    if (url.includes('fundamentals-timeseries')) {
      // The provider returns different series for a quarterly vs annual request;
      // the fake must too, or the "fetch the quarter" path would silently get the
      // annual body and the test would be measuring nothing.
      const quarterly = url.includes('quarterly');
      const body = quarterly ? tsQuarterly : scenario.timeseries ?? null;
      return new Response(JSON.stringify(body), { status: 200 });
    }
    if (url.includes('/v10/finance/quoteSummary/')) {
      return new Response(JSON.stringify(quoteSummary), { status: 200 });
    }
    if (url.includes('/v8/finance/chart/')) {
      return new Response(JSON.stringify(CHART_FIXTURE), { status: 200 });
    }
    return new Response('not found', { status: 404 });
  }) as unknown as typeof fetch;
  return impl;
}

let db: Db;
beforeEach(() => {
  db = openDb(':memory:');
});
afterEach(() => {
  db.close();
  vi.restoreAllMocks();
});

/** The quarterly / annual revenue and EPS the fixtures actually carry. */
function figureOf(payload: { inputs: { revenue: number | null; dilutedEps: number | null } }) {
  return { revenue: payload.inputs.revenue, eps: payload.inputs.dilutedEps };
}

const FORE = 1_800_000_000;

describe('§C.4 — the matrix compares like-for-like (quarter vs quarter)', () => {
  it('with only the ANNUAL statements cached, the annual figure is NOT used — the quarter is fetched', async () => {
    const impl = makeFetch({ timeseries: tsAnnual });
    const annual = await loadStatements(db, 'AAPL', 'annual', { fetchImpl: impl, now: FORE });
    const annualFig = figureOf(annual);
    expect(annualFig.revenue).not.toBeNull();

    const est = await loadEstimates(db, 'AAPL', { fetchImpl: impl, now: FORE });
    const revenueRow = est.matrix.find((r) => r.labelKey === 'pf.matrix.revenue');
    expect(revenueRow).toBeDefined();
    // The whole bug: the annual number standing in for a quarter. The annual
    // figure (a full year) must never appear as the period actual.
    expect(revenueRow?.actual).not.toBe(annualFig.revenue);
    expect(revenueRow?.actual).not.toBeNull();
    // It IS the real latest quarter — the same one a quarterly-first visit sees.
    const quarterly = await loadStatements(db, 'AAPL', 'quarterly', { fetchImpl: impl, now: FORE });
    expect(revenueRow?.actual).toBe(quarterly.inputs.revenue);
    expect(revenueRow?.growth).toBe(growthBetween(quarterly.inputs.revenue, revenueRow?.forecast ?? null));
  });

  it('with only the QUARTERLY statements cached, the actual is the latest reported quarter', async () => {
    const impl = makeFetch({ timeseries: tsQuarterly });
    const quarterly = await loadStatements(db, 'AAPL', 'quarterly', { fetchImpl: impl, now: FORE });
    const qFig = figureOf(quarterly);

    const est = await loadEstimates(db, 'AAPL', { fetchImpl: impl, now: FORE });
    const revenueRow = est.matrix.find((r) => r.labelKey === 'pf.matrix.revenue');
    expect(revenueRow?.actual).toBe(qFig.revenue);
    expect(revenueRow?.basis).toBe('quarter');
    expect(revenueRow?.asOf).toBe(quarterly.income.columns[quarterly.income.columns.length - 1]);
  });

  it('PATH A (annual first) and PATH B (quarterly first) produce an IDENTICAL matrix', async () => {
    // PATH A: user opens the annual tab, then the analysts screen.
    const dbA = openDb(':memory:');
    await loadStatements(dbA, 'AAPL', 'annual', { fetchImpl: makeFetch({ timeseries: tsAnnual }), now: FORE });
    // PATH B: user opens the quarterly tab, then the analysts screen.
    const dbB = openDb(':memory:');
    await loadStatements(dbB, 'AAPL', 'quarterly', { fetchImpl: makeFetch({ timeseries: tsQuarterly }), now: FORE });

    const a = await loadEstimates(dbA, 'AAPL', { fetchImpl: makeFetch({ timeseries: tsAnnual }), now: FORE });
    const b = await loadEstimates(dbB, 'AAPL', { fetchImpl: makeFetch({ timeseries: tsQuarterly }), now: FORE });
    dbA.close();
    dbB.close();

    const pick = (m: typeof a.matrix) =>
      m.map((r) => ({ k: r.labelKey, actual: r.actual, forecast: r.forecast, growth: r.growth, basis: r.basis }));
    // The named defect: these two used to differ (−67.5% vs +35.9%).
    expect(pick(a.matrix)).toEqual(pick(b.matrix));
  });

  it('growth is computed from the quarter vs quarter basis, not from a mix', async () => {
    const impl = makeFetch({ timeseries: tsQuarterly });
    const quarterly = await loadStatements(db, 'AAPL', 'quarterly', { fetchImpl: impl, now: FORE });
    const qRevenue = quarterly.inputs.revenue;
    const est = await loadEstimates(db, 'AAPL', { fetchImpl: impl, now: FORE });
    const revenueRow = est.matrix.find((r) => r.labelKey === 'pf.matrix.revenue');
    expect(revenueRow?.growth).toBe(growthBetween(qRevenue, revenueRow?.forecast ?? null));
  });
});
