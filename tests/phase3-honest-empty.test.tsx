/**
 * @vitest-environment jsdom
 *
 * §D.1 / §D.5 — the honest-empty path.
 *
 * The browser-evidence run (`scripts/evidence-phase3.mjs`) accepts an honest
 * empty state in place of populated tables when the provider returns a thin
 * bundle. That acceptance is only defensible if the honest state actually
 * exists and is *distinct from a blank panel* — otherwise it becomes a hole a
 * regression could hide behind. This file pins that down deterministically:
 * with a `null` payload and no error, each panel must render its explicit
 * placeholder, and a real error must render the error copy instead.
 *
 * No network, no store actions needed: the panels read their payload straight
 * off the store, so the store is set directly.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { EstimatesPayload, RatingsFullPayload } from '../shared/types';
import { useStore } from '../src/store';
import { LangProvider } from '../src/i18n';
import { StatementsSection } from '../src/analyst/StatementsPanel';
import { EstimatesSection } from '../src/analyst/EstimatesPanel';
import { RatingsSection } from '../src/analyst/RatingsPanel';

vi.mock('../src/api', () => ({
  getStatements: vi.fn(async () => ({ ok: false, error: 'unused', code: 'TEST' })),
  getEstimates: vi.fn(async () => ({ ok: false, error: 'unused', code: 'TEST' })),
  getRatings: vi.fn(async () => ({ ok: false, error: 'unused', code: 'TEST' })),
  getQuotes: vi.fn(async () => ({ ok: false, error: 'unused', code: 'TEST' })),
  getFx: vi.fn(async () => ({ ok: false, error: 'unused', code: 'TEST' })),
  getHistory: vi.fn(async () => ({ ok: false, error: 'unused', code: 'TEST' })),
  getMarket: vi.fn(async () => ({ ok: false, error: 'unused', code: 'TEST' })),
}));

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
});

function mount(ui: React.ReactElement) {
  act(() => {
    root = createRoot(container);
    root.render(<LangProvider lang="en">{ui}</LangProvider>);
  });
}

/** Put the store in the state a thin/throttled provider run produces. */
function setEmpty(overrides: Record<string, unknown> = {}) {
  const ready = { status: 'ready' as const, error: null, code: null, requestId: 1 };
  act(() => {
    useStore.setState({
      statements: null,
      estimates: null,
      ratings: null,
      histories: {},
      // The statements panel tracks its own load slot; the estimates/ratings
      // panels share the analyst slot. Both are set for a realistic state.
      statementsLoad: ready,
      analystLoad: ready,
      ...overrides,
    });
  });
}

const noop = () => {};
const NO_OP_PROPS = { open: true, onToggle: noop };

/**
 * What the provider returns for a symbol it carries no analyst coverage for:
 * a well-formed payload whose every figure is empty. This is *not* the same as
 * `null` (which means "not loaded") — the empty state is a real, parsed answer.
 */
const EMPTY_ESTIMATES: EstimatesPayload = {
  symbol: 'ZZZZ',
  periods: [],
  extraYears: 2,
  calendar: {
    nextEarningsAt: null,
    nextEarningsLabel: null,
    isEstimate: false,
    epsAvg: null,
    epsLow: null,
    epsHigh: null,
    revenueAvg: null,
    revenueLow: null,
    revenueHigh: null,
  },
  history: [],
  matrix: [],
  forward: { eps: null, revenue: null, quarters: [], basis: null },
  ev: null,
  price: null,
  currency: null,
  source: 'live',
  lastUpdated: null,
  note: null,
};

const EMPTY_RATINGS: RatingsFullPayload = {
  symbol: 'ZZZZ',
  ratings: {
    buckets: [],
    recommendationMean: null,
    recommendationKey: null,
    numberOfAnalystOpinions: null,
    targetLow: null,
    targetMean: null,
    targetMedian: null,
    targetHigh: null,
    currentPrice: null,
  },
  target: { low: null, mean: null, median: null, high: null, upsidePct: null, analysts: null },
  actions: [],
  oneYearReturn: null,
  price: null,
  currency: null,
  source: 'live',
  lastUpdated: null,
  note: null,
};

/** The first `data-testid` present anywhere under the container. */
function testIds(): string[] {
  return Array.from(container.querySelectorAll('[data-testid]')).map(
    (el) => el.getAttribute('data-testid') ?? '',
  );
}

/* ==================================================================== tests */

describe('§D.5 — a thin provider bundle renders an explicit placeholder, never a blank panel', () => {
  it('§C.2 statements: no payload and no error shows a real placeholder', () => {
    setEmpty();
    mount(<StatementsSection {...NO_OP_PROPS} />);
    const ids = testIds();
    expect(ids).toContain('pf-stmt-none');
    // ...and it is *not* the error copy: an honest thin run is not an error.
    expect(ids).not.toContain('pf-stmt-error');
    // The held-open body must not be empty markup with no sentence in it.
    const text = (container.textContent ?? '').trim();
    expect(text.length).toBeGreaterThan(0);
  });

  it('§C.3/C.4 estimates: an empty (but parsed) payload shows the no-coverage placeholder', () => {
    setEmpty({ estimates: EMPTY_ESTIMATES });
    mount(<EstimatesSection {...NO_OP_PROPS} />);
    const ids = testIds();
    expect(ids).toContain('pf-est-none');
    const text = (container.textContent ?? '').trim();
    expect(text.length).toBeGreaterThan(0);
  });

  it('§C.3/C.4 estimates: a settled null payload is also an honest placeholder, not a blank', () => {
    // The provider returned nothing usable, so the store never set `estimates`.
    setEmpty({ estimates: null });
    mount(<EstimatesSection {...NO_OP_PROPS} />);
    const ids = testIds();
    expect(ids).toContain('pf-est-none');
    expect((container.textContent ?? '').trim().length).toBeGreaterThan(0);
  });

  it('§C.5 ratings: no buckets and no target shows the no-coverage placeholder', () => {
    setEmpty({ ratings: EMPTY_RATINGS });
    mount(<RatingsSection {...NO_OP_PROPS} />);
    const ids = testIds();
    expect(ids).toContain('pf-rat-none');
    const text = (container.textContent ?? '').trim();
    expect(text.length).toBeGreaterThan(0);
  });
});

describe('§D.5 — a real failure is shown as an error, not disguised as empty', () => {
  it('§C.2 statements: an error state shows the error copy, not the empty placeholder', () => {
    setEmpty({
      statementsLoad: { status: 'error', error: 'provider exploded', code: 'UPSTREAM', requestId: 2 },
    });
    mount(<StatementsSection {...NO_OP_PROPS} />);
    const ids = testIds();
    expect(ids).toContain('pf-stmt-error');
    expect(ids).not.toContain('pf-stmt-none');
  });

  it('§C.2 statements: a loading state shows a loading sentence, neither empty nor error', () => {
    setEmpty({
      statementsLoad: { status: 'loading', error: null, code: null, requestId: 3 },
    });
    mount(<StatementsSection {...NO_OP_PROPS} />);
    const ids = testIds();
    expect(ids).not.toContain('pf-stmt-none');
    expect(ids).not.toContain('pf-stmt-error');
    expect((container.textContent ?? '').trim().length).toBeGreaterThan(0);
  });
});
