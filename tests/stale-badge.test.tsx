/**
 * @vitest-environment jsdom
 *
 * N1 regression: a stale series must be *labelled* everywhere its numbers are
 * shown, not only on the chart. The badge is driven purely by store state, so
 * this test sets that state directly — deterministic, no network.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { SymbolMeta, WatchQuote } from '../shared/types';
import { useStore } from '../src/store';
import { TopBar } from '../src/components/TopBar';
import { MoverStrip } from '../src/components/MoverStrip';

vi.mock('../src/api', () => ({
  getHealth: vi.fn(async () => ({ ok: true, data: { status: 'ok', time: 0, service: 'test' } })),
  getMarket: vi.fn(async () => ({ ok: false, error: 'unused', code: 'TEST' })),
  getSignals: vi.fn(async () => ({ ok: false, error: 'unused', code: 'TEST' })),
  getWatchlist: vi.fn(async () => ({ ok: true, data: [] })),
  getWatchQuotes: vi.fn(async () => ({ ok: true, data: [] })),
  // Phase 2 endpoints the store now calls on selection.
  getNews: vi.fn(async () => ({ ok: true, data: { symbol: 'AAPL', items: [], source: 'cache', lastUpdated: null, note: null } })),
  getFundamentals: vi.fn(async () => ({
    ok: true,
    data: { symbol: 'AAPL', profile: null, keyStats: null, health: null, quoteType: null, currency: null, source: 'cache', lastUpdated: null, note: null },
  })),
  getCategories: vi.fn(async () => ({ ok: true, data: {} })),
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

const META: SymbolMeta = {
  symbol: 'AAPL',
  name: 'Apple Inc.',
  currency: 'USD',
  exchange: 'NasdaqGS',
  exchangeTimezone: 'America/New_York',
  lastPrice: 344.17,
  previousClose: 350.59,
  change: -6.42,
  changePercent: -1.83,
  dayHigh: 355,
  dayLow: 342,
  fiftyTwoWeekHigh: 400,
  fiftyTwoWeekLow: 200,
  volume: 50_000_000,
  marketTime: 1_790_000_000,
};

const QUOTES: WatchQuote[] = [
  { symbol: 'AAPL', name: 'Apple Inc.', lastPrice: 344.17, change: -6.42, changePercent: -1.83, currency: 'USD', source: 'stale-cache', stale: true, lastUpdated: 1_790_000_000 },
  { symbol: 'SPY', name: 'SPDR S&P 500', lastPrice: 512.3, change: 3.1, changePercent: 0.61, currency: 'USD', source: 'live', stale: false, lastUpdated: 1_790_000_000 },
];

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
  useStore.setState({ market: null, quotes: [] });
});

function mount(ui: React.ReactElement) {
  act(() => {
    root = createRoot(container);
    root.render(ui);
  });
}

/** Put the store into a "stale series" state without touching the network. */
function setStaleMarket() {
  act(() => {
    useStore.setState({
      symbol: 'AAPL',
      market: {
        symbol: 'AAPL',
        interval: '1d',
        candles: [],
        indicators: { sma20: [], sma50: [], sma200: [], ema12: [], ema26: [], bb: [], rsi14: [], macd: [] },
        meta: META,
        source: 'stale-cache',
        lastUpdated: 1_790_000_000,
        fetchedAt: 1_790_000_000,
        note: 'Provider unreachable; showing stored history.',
        count: 0,
      },
    });
  });
}

function setLiveMarket() {
  act(() => {
    useStore.setState({
      symbol: 'AAPL',
      market: {
        symbol: 'AAPL',
        interval: '1d',
        candles: [],
        indicators: { sma20: [], sma50: [], sma200: [], ema12: [], ema26: [], bb: [], rsi14: [], macd: [] },
        meta: META,
        source: 'live',
        lastUpdated: 1_790_000_000,
        fetchedAt: 1_790_000_000,
        note: null,
        count: 0,
      },
    });
  });
}

const staleInTopBar = () => container.querySelector('[data-testid="topbar-stale"]') !== null;

describe('N1 — stale data is labelled wherever it is shown', () => {
  it('the TopBar price block carries a stale badge when the series is stale', () => {
    setStaleMarket();
    mount(<TopBar />);
    expect(container.querySelector('[data-testid="topbar-price"]')).not.toBeNull();
    expect(staleInTopBar(), 'a stale series must be labelled on the headline price').toBe(true);
  });

  it('the TopBar shows no stale badge when the series is live', () => {
    setLiveMarket();
    mount(<TopBar />);
    expect(staleInTopBar()).toBe(false);
  });

  it('a stale mover tile carries its own stale badge', () => {
    act(() => useStore.setState({ symbol: 'AAPL', quotes: QUOTES }));
    mount(<MoverStrip />);
    expect(container.querySelector('[data-testid="mover-stale-AAPL"]'), 'stale tile is labelled').not.toBeNull();
    expect(container.querySelector('[data-testid="mover-stale-SPY"]'), 'live tile is not labelled stale').toBeNull();
  });

  it('every stale quote on the strip is labelled, and none of the live ones are', () => {
    act(() =>
      useStore.setState({
        symbol: 'AAPL',
        quotes: [
          ...QUOTES,
          { symbol: 'MSFT', name: 'Microsoft', lastPrice: 500, change: -2, changePercent: -0.4, currency: 'USD', source: 'stale-cache', stale: true, lastUpdated: 1 },
        ],
      }),
    );
    mount(<MoverStrip />);
    const tiles = [...container.querySelectorAll('.mover')];
    expect(tiles).toHaveLength(3);
    for (const tile of tiles) {
      const sym = tile.getAttribute('data-symbol') ?? '';
      const hasBadge = tile.querySelector('.m-stale') !== null;
      const expected = sym === 'AAPL' || sym === 'MSFT';
      expect(hasBadge, `${sym} stale badge should be ${expected}`).toBe(expected);
    }
  });
});

describe('N2 — the mover strip cannot steal the headline symbol', () => {
  it('the selected tile exposes no "open" control, and a tile is not itself a button', () => {
    act(() => useStore.setState({ symbol: 'AAPL', quotes: QUOTES }));
    mount(<MoverStrip />);
    const current = container.querySelector('[data-testid="mover-AAPL"]');
    const other = container.querySelector('[data-testid="mover-SPY"]');
    expect(current?.querySelector('.m-open')).toBeNull();
    expect(other?.querySelector('.m-open')).not.toBeNull();
    expect(container.querySelector('.mover button:not(.m-open)')).toBeNull();
  });

  it('clicking a tile body does not change the headline symbol', () => {
    act(() => useStore.setState({ symbol: 'AAPL', quotes: QUOTES }));
    mount(<MoverStrip />);
    const tile = container.querySelector('[data-testid="mover-SPY"] .m-sym') as HTMLElement;
    act(() => tile.click());
    expect(useStore.getState().symbol).toBe('AAPL');
  });

  it('the explicit control switches and lands on the chart screen', () => {
    act(() => useStore.setState({ symbol: 'AAPL', quotes: QUOTES, screen: 'dashboard' }));
    mount(<MoverStrip />);
    const open = container.querySelector('[data-testid="mover-SPY"] .m-open') as HTMLButtonElement;
    act(() => open.click());
    expect(useStore.getState().symbol).toBe('SPY');
    expect(useStore.getState().screen).toBe('chart');
  });
});
