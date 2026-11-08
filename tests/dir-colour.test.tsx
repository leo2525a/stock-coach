/**
 * @vitest-environment jsdom
 *
 * Directional colour (owner request, 2026-11-07): a figure that goes **up** or
 * **down** must be colour-differentiated, and a figure with *no* value must not
 * be coloured at all.
 *
 * Two layers are asserted, because the defect this guards against lives in the
 * second one:
 *
 *   1. the pure rule (`dirClass`) — sign in, class out;
 *   2. the rendered panels — the class actually lands on the number the user
 *      reads, *and* a level (price, P/E, margin) is never coloured.
 *
 * A real-browser version of (2) — against the built bundle, checking computed
 * colour rather than a class name — lives in `scripts/evidence-colour.mjs`;
 * jsdom alone has missed real UI defects in this project before.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { dirClass, dirClassOrFlat } from '../src/dirClass';
import { useStore } from '../src/store';

vi.mock('../src/api', () => {
  const notOk = async () => ({ ok: false, error: 'unused in tests', code: 'TEST' });
  return {
    getHealth: notOk,
    getMarket: notOk,
    getSignals: notOk,
    getWatchlist: async () => ({ ok: true, data: [] }),
    getWatchQuotes: async () => ({ ok: true, data: [] }),
    getNews: notOk,
    getFundamentals: notOk,
    getCategories: async () => ({ ok: true, data: {} }),
    getStatements: notOk,
    getEstimates: notOk,
    getRatings: notOk,
    getQuotes: notOk,
    getFx: notOk,
    searchSymbols: async () => ({ ok: true, data: [] }),
    addToWatchlist: notOk,
    removeFromWatchlist: notOk,
    reorderWatchlist: notOk,
  };
});

// The band / NTM charts pull in lightweight-charts; these tests only care about
// the coloured figures beside them, so the chart is a no-op double.
vi.mock('lightweight-charts', () => {
  class Series {
    setData() {}
    applyOptions() {}
    priceScale() {
      return { applyOptions() {}, width: () => 60 };
    }
    setMarkers() {}
  }
  return {
    createChart: () => ({
      addSeries: () => new Series(),
      panes: () => [{ setHeight() {} }],
      timeScale: () => ({ fitContent() {}, subscribeVisibleLogicalRangeChange() {} }),
      applyOptions() {},
      remove() {},
      resize() {},
    }),
    LineSeries: { __t: 'line' },
    CandlestickSeries: { __t: 'candle' },
    HistogramSeries: { __t: 'hist' },
    AreaSeries: { __t: 'area' },
    LineStyle: { Dashed: 2 },
  };
});

if (!('ResizeObserver' in globalThis)) {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;
}
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root | null = null;

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container.remove();
  vi.restoreAllMocks();
});

function mount(ui: React.ReactElement) {
  act(() => {
    root = createRoot(container);
    root.render(ui);
  });
}

/** Every element that carries any of the three direction classes. */
function coloured(rootEl: ParentNode = container): HTMLElement[] {
  return [
    ...rootEl.querySelectorAll<HTMLElement>('.chg-up, .chg-down, .chg-flat'),
  ];
}

/** The one number-bearing element inside a table cell / fact value. */
function figureOf(el: Element | null | undefined): HTMLElement | null {
  if (!el) return null;
  return el.querySelector<HTMLElement>('.chg-up, .chg-down, .chg-flat') ?? (el as HTMLElement);
}

function setStore(patch: Record<string, unknown>) {
  act(() => {
    useStore.setState(patch as never);
  });
}

const FX = { perUsd: { USD: 1, HKD: 7.8 }, asOf: null, unavailable: false };
const BASE = { symbol: 'AAPL', displayCurrency: 'USD', fx: FX };

/* =========================================================== 1. the rule === */

describe('dirClass — one rule for sign → colour', () => {
  it('maps a positive, negative and zero value onto the existing classes', () => {
    expect(dirClass(1)).toBe('chg-up');
    expect(dirClass(0.0001)).toBe('chg-up');
    expect(dirClass(-1)).toBe('chg-down');
    expect(dirClass(-0.0001)).toBe('chg-down');
    expect(dirClass(0)).toBe('chg-flat');
  });

  it('returns NO class for null / undefined / non-finite — a dash is not a direction', () => {
    expect(dirClass(null)).toBe('');
    expect(dirClass(undefined)).toBe('');
    expect(dirClass(Number.NaN)).toBe('');
    expect(dirClass(Number.POSITIVE_INFINITY)).toBe('');
  });

  it('dirClassOrFlat is the same rule with a quiet fallback for a missing value', () => {
    expect(dirClassOrFlat(2)).toBe('chg-up');
    expect(dirClassOrFlat(-2)).toBe('chg-down');
    expect(dirClassOrFlat(null)).toBe('chg-flat');
  });

  it('only ever returns the existing tokens, never a new palette', () => {
    const seen = new Set<string>();
    for (const v of [3, 0, -3, null, undefined, NaN]) seen.add(dirClass(v));
    expect([...seen].sort()).toEqual(['', 'chg-down', 'chg-flat', 'chg-up']);
  });
});

/* ==================================================== 2. the real panels === */

/**
 * The statement tables (income / balance / cashflow) with a known rise, a known
 * fall, and a row whose change cannot be computed (a `null` base).
 */
function statementPayload() {
  const table = (rows: unknown[]) => ({
    columns: ['2025-12-31', '2026-09-30'],
    currency: 'USD',
    periodType: '3M',
    anyComputed: false,
    period: 'quarterly',
    rows,
  });
  const income = table([
    { labelKey: 'pf.income.totalRevenue', kind: 'money', values: [100, 120], computed: false },
    { labelKey: 'pf.income.netIncome', kind: 'money', values: [100, 80], computed: false },
    { labelKey: 'pf.income.ebitda', kind: 'money', values: [100, null], computed: false },
  ]);
  return {
    symbol: 'AAPL',
    period: 'quarterly',
    currency: 'USD',
    periodType: '3M',
    income,
    balance: table([{ labelKey: 'pf.balance.totalAssets', kind: 'money', values: [100, 130], computed: false }]),
    cashflow: table([{ labelKey: 'pf.cash.freeCashFlow', kind: 'money', values: [100, 70], computed: false }]),
    metrics: { asOf: '2026-09-30', currency: 'USD', marketCap: null, ev: null, netDebt: null, items: [] },
    inputs: {},
    price: null,
    source: 'test',
    lastUpdated: null,
    note: null,
  };
}

/** The last visible cell (the derived Change column) of every statement row. */
function changeCells(): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>('table tbody tr td:last-child')];
}

describe('StatementsPanel — the period-over-period Change column is coloured by sign', () => {
  beforeEach(() => {
    setStore({
      ...BASE,
      statements: statementPayload(),
      statementsPeriod: 'quarterly',
      statementsLoad: { status: 'ready', error: null, code: null, requestId: 1 },
    });
  });

  it('a rise is chg-up and a fall is chg-down', async () => {
    const { StatementsSection } = await import('../src/analyst/StatementsPanel');
    mount(<StatementsSection open onToggle={() => {}} />);

    const figures = coloured().map((n) => ({ cls: n.className, text: n.textContent }));
    const up = figures.find((f) => f.cls === 'chg-up');
    const down = figures.find((f) => f.cls === 'chg-down');
    // Revenue 100 → 120 is +20.00%; net income 100 → 80 is −20.00%.
    expect(up?.text, 'a rise of +20.00% must be green').toBe('+20.00%');
    expect(down?.text, 'a fall of -20.00% must be red').toBe('-20.00%');
  });

  it('a change that cannot be computed renders an uncoloured dash, not a fabricated 0%', async () => {
    const { StatementsSection } = await import('../src/analyst/StatementsPanel');
    mount(<StatementsSection open onToggle={() => {}} />);

    const withNullBase = changeCells().filter((c) => (c.textContent ?? '').trim() === '—');
    expect(withNullBase.length, 'the null-base row must show a dash').toBeGreaterThan(0);
    for (const c of withNullBase) {
      expect(coloured(c), 'a dash must carry NO direction class').toEqual([]);
    }
  });

  it('says the Change column is our own arithmetic, not a reported figure', async () => {
    const { StatementsSection } = await import('../src/analyst/StatementsPanel');
    mount(<StatementsSection open onToggle={() => {}} />);
    expect(container.querySelector('[data-testid="pf-stmt-change-note"]')).not.toBeNull();
  });
});

/* --------------------------------------------------------------- estimates */

describe('EstimatesPanel — growth, surprise and matrix change are coloured by sign', () => {
  beforeEach(() => {
    const side = (growth: number | null) => ({
      avg: 1,
      low: 0.5,
      high: 1.5,
      yearAgo: 0.9,
      analysts: 20,
      growth,
      currency: 'USD',
    });
    setStore({
      ...BASE,
      estimates: {
        symbol: 'AAPL',
        periods: [
          { id: '0q', endDate: '2027-03-31', eps: side(0.123), revenue: side(0.05) },
          { id: '1q', endDate: '2027-06-30', eps: side(-0.07), revenue: side(-0.02) },
        ],
        extraYears: 0,
        calendar: {
          nextEarningsLabel: null,
          isEstimate: false,
          epsAvg: null,
          epsLow: null,
          epsHigh: null,
          revenueAvg: null,
        },
        history: [
          { quarterAt: null, quarterLabel: 'Q1', period: null, epsActual: 1.2, epsEstimate: 1, epsDifference: 0.2, surprisePercent: 0.2, currency: 'USD' },
          { quarterAt: null, quarterLabel: 'Q2', period: null, epsActual: 0.8, epsEstimate: 1, epsDifference: -0.2, surprisePercent: -0.2, currency: 'USD' },
          // Consensus 1 met exactly: the difference is 0 (flat) and the
          // percentage surprise is undefined (zero base) → a dash.
          { quarterAt: null, quarterLabel: 'Q3', period: null, epsActual: 1, epsEstimate: 1, epsDifference: 0, surprisePercent: null, currency: 'USD' },
        ],
        matrix: [
          { labelKey: 'pf.matrix.revenue', kind: 'money', actual: 100, forecast: 110, growth: 0.1, noEstimateUpstream: false, basis: 'quarter', asOf: '2026-09-30' },
          { labelKey: 'pf.matrix.eps', kind: 'perShare', actual: 100, forecast: 90, growth: -0.1, noEstimateUpstream: false, basis: 'quarter', asOf: '2026-09-30' },
        ],
        forward: { eps: null, revenue: null, quarters: [], basis: null },
        ev: null,
        price: null,
        currency: 'USD',
        source: 'test',
        lastUpdated: null,
        note: null,
      },
      analystLoad: { status: 'ready', error: null, code: null, requestId: 1 },
    });
  });

  it('colours the year-on-year growth cell by its sign', async () => {
    const { EstimatesSection } = await import('../src/analyst/EstimatesPanel');
    mount(<EstimatesSection open onToggle={() => {}} />);
    const trend = container.querySelector('[data-testid="pf-est-trend"]')!;
    const texts = coloured(trend).map((n) => `${n.className}:${n.textContent}`);
    expect(texts).toContain('chg-up:+12.30%');
    expect(texts).toContain('chg-down:-7.00%');
  });

  it('colours the earnings difference and surprise, and leaves a null surprise uncoloured', async () => {
    const { EstimatesSection } = await import('../src/analyst/EstimatesPanel');
    mount(<EstimatesSection open onToggle={() => {}} />);
    const hist = container.querySelector('[data-testid="pf-est-history"]')!;
    const rows = [...hist.querySelectorAll('tbody tr')];
    const surpriseCell = (r: Element) => r.querySelector('td:last-child') as HTMLElement;

    expect(figureOf(surpriseCell(rows[0]))?.className, 'Q1 beat → chg-up').toBe('chg-up');
    expect(figureOf(surpriseCell(rows[1]))?.className, 'Q2 miss → chg-down').toBe('chg-down');
    // Q3 met consensus: the percentage surprise has a zero base → dash, no colour.
    expect((surpriseCell(rows[2]).textContent ?? '').trim()).toBe('—');
    expect(coloured(surpriseCell(rows[2])), 'a zero base must not be coloured').toEqual([]);
  });

  it('colours the §C.4 matrix Change column by sign', async () => {
    const { EstimatesSection } = await import('../src/analyst/EstimatesPanel');
    mount(<EstimatesSection open onToggle={() => {}} />);
    const matrix = container.querySelector('[data-testid="pf-est-matrix"]')!;
    const cells = [...matrix.querySelectorAll('tbody tr')].map((r) => r.querySelector('td:last-child'));
    expect(figureOf(cells[0])?.className, 'forecast above actual → chg-up').toBe('chg-up');
    expect(figureOf(cells[1])?.className, 'forecast below actual → chg-down').toBe('chg-down');
  });
});

/* ----------------------------------------------------------------- ratings */

describe('RatingsPanel — upside and 1-year return are coloured; price levels are not', () => {
  beforeEach(() => {
    setStore({
      ...BASE,
      ratings: {
        symbol: 'AAPL',
        ratings: { buckets: [], recommendationMean: 2, recommendationKey: 'buy', numberOfAnalystOpinions: 20 },
        target: { low: 100, mean: 150, high: 200, median: 150, analysts: 20, upsidePct: 0.25 },
        actions: [],
        oneYearReturn: -0.1,
        price: 120,
        currency: 'USD',
        source: 'test',
        lastUpdated: null,
        note: null,
      },
      analystLoad: { status: 'ready', error: null, code: null, requestId: 1 },
    });
  });

  it('colours the directional facts and leaves the price levels monochrome', async () => {
    const { RatingsSection } = await import('../src/analyst/RatingsPanel');
    mount(<RatingsSection open onToggle={() => {}} />);

    const facts = container.querySelector('[data-testid="pf-band-facts"]')!;
    const dds = [...facts.querySelectorAll<HTMLElement>('dd')];
    const ddFor = (text: string) => dds.find((d) => (d.textContent ?? '').trim() === text);

    expect(ddFor('+25.00%')?.className, 'upside of +25% → chg-up').toBe('chg-up');
    expect(ddFor('-10.00%')?.className, '1-year return of -10% → chg-down').toBe('chg-down');
    expect(figureOf(ddFor('150.00 USD')), 'a target-price level must not be coloured').not.toBeNull();
    expect(coloured(ddFor('150.00 USD')), 'a target-price level must NOT be coloured').toEqual([]);
    expect(ddFor('150.00 USD')?.className, 'a target-price level keeps the plain class').toBe('');
  });
});

/* ----------------------------------------------------------- fundamentals */

describe('HealthPanel — revenue growth is coloured; margins are not', () => {
  it('colours the growth row only', async () => {
    setStore({
      ...BASE,
      fundamentals: {
        symbol: 'AAPL',
        profile: null,
        keyStats: null,
        health: {
          profitMargins: 0.2,
          operatingMargins: 0.25,
          returnOnEquity: 0.3,
          returnOnAssets: 0.1,
          revenueGrowth: -0.05,
          recommendationKey: null,
          recommendationMean: null,
          numberOfAnalystOpinions: null,
          targetMeanPrice: null,
          targetHighPrice: null,
          targetLowPrice: null,
        },
        quoteType: null,
        currency: 'USD',
        source: 'test',
        lastUpdated: null,
        note: null,
      },
      fundamentalsLoad: { status: 'ready', error: null, code: null, requestId: 1 },
    });
    const { HealthPanel } = await import('../src/components/FundamentalsPanel');
    mount(<HealthPanel />);

    const grid = container.querySelector('[data-testid="health-grid"]')!;
    const values = [...grid.querySelectorAll<HTMLElement>('.stat .v')];
    const tinted = values.filter((v) => /\bchg-(up|down|flat)\b/.test(v.className));
    expect(tinted.length, 'exactly one directional figure (revenue growth) is coloured').toBe(1);
    expect(tinted[0].className).toBe('v chg-down');
    expect(tinted[0].textContent).toBe('-5.00%');
    // Margins and returns are *levels*: present, but with no direction class.
    const levels = values.filter((v) => (v.textContent ?? '').includes('%') && v !== tinted[0]);
    expect(levels.length).toBeGreaterThanOrEqual(4);
    for (const v of levels) expect(v.className).not.toMatch(/chg-(up|down|flat)/);
  });
});
