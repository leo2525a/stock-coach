/**
 * @vitest-environment jsdom
 *
 * Component-level regression tests for the chart.
 *
 * These exist because the Phase 1 suite was 100% unit-level and therefore
 * completely missed a real blocking bug: toggling a sub-pane (Volume / RSI /
 * MACD) rebuilt the chart with fresh, empty series, and because the data-push
 * effect did not depend on the pane structure, the new series were never given
 * data — the chart went blank and never recovered.
 *
 * `lightweight-charts` is mocked with a small recording double. That is the
 * right level here: the defect lived in *React effect wiring*, and a mock lets
 * us assert the thing that actually broke — "after the rebuild, did the new
 * series receive the candles?" — without needing a real canvas.
 *
 * A real-browser canvas check lives in scripts/evidence-chart.mjs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useState } from 'react';
import type { Candle } from '../shared/types';
import { computeIndicators } from '../shared/indicators';
import { ChartToolbar } from '../src/components/ChartToolbar';
import { StockChart, type OverlayFlags } from '../src/chart/StockChart';

/* ------------------------------------------------------------------ mock */

interface FakeSeries {
  kind: string;
  paneIndex: number;
  data: unknown[];
}

interface FakeChart {
  series: FakeSeries[];
  removed: boolean;
  host: HTMLElement;
}

const charts: FakeChart[] = [];

vi.mock('lightweight-charts', () => {
  const token = (name: string) => ({ __seriesType: name });

  class SeriesDouble implements FakeSeries {
    kind: string;
    paneIndex: number;
    data: unknown[] = [];
    constructor(kind: string, paneIndex: number) {
      this.kind = kind;
      this.paneIndex = paneIndex;
    }
    setData(data: unknown[]) {
      this.data = data;
    }
    applyOptions() {}
    priceScale() {
      return { applyOptions() {}, width: () => 60 };
    }
    setMarkers() {}
  }

  const createChart = (host: HTMLElement) => {
    const chart: FakeChart & Record<string, unknown> = {
      series: [],
      removed: false,
      host,
      addSeries(kind: { __seriesType: string }, _opts?: unknown, paneIndex = 0) {
        const s = new SeriesDouble(kind.__seriesType, paneIndex);
        chart.series.push(s as unknown as FakeSeries);
        return s;
      },
      panes() {
        const max = chart.series.reduce((m, s) => Math.max(m, s.paneIndex), 0);
        return Array.from({ length: max + 1 }, () => ({ setHeight() {} }));
      },
      timeScale: () => ({
        fitContent() {},
        setVisibleLogicalRange() {},
        subscribeVisibleLogicalRangeChange() {},
        unsubscribeVisibleLogicalRangeChange() {},
      }),
      subscribeCrosshairMove() {},
      unsubscribeCrosshairMove() {},
      applyOptions() {},
      remove() {
        chart.removed = true;
      },
    };
    charts.push(chart);
    return chart;
  };

  return {
    createChart,
    CandlestickSeries: token('candlestick'),
    LineSeries: token('line'),
    HistogramSeries: token('histogram'),
    AreaSeries: token('area'),
    BaselineSeries: token('baseline'),
    createSeriesMarkers: () => ({ setMarkers() {} }),
    LineStyle: { Solid: 0, Dotted: 1, Dashed: 2 },
    CrosshairMode: { Normal: 0, Magnet: 1 },
    ColorType: { Solid: 'solid' },
    PriceScaleMode: { Normal: 0 },
    TickMarkType: { Year: 0 },
  };
});

/* ------------------------------------------------------------------ data */

const N_BARS = 260;

/** Deterministic candles long enough that every indicator has values. */
function makeCandles(n = N_BARS): Candle[] {
  const out: Candle[] = [];
  let price = 100;
  for (let i = 0; i < n; i += 1) {
    const wave = Math.sin(i / 9) * 0.012 + Math.sin(i / 31) * 0.02;
    price *= 1 + wave * 0.35 + 0.0009;
    const close = Number(price.toFixed(4));
    const open = i === 0 ? close : out[i - 1].close;
    out.push({
      time: 1_600_000_000 + i * 86400,
      open,
      high: Math.max(open, close) * 1.01,
      low: Math.min(open, close) * 0.99,
      close,
      volume: 1_000_000 + i * 17,
    });
  }
  return out;
}

const CANDLES = makeCandles();
const INDICATORS = computeIndicators(CANDLES);

/** The candle series is always the first series the component creates. */
const candleSeries = (c: FakeChart) => c.series.find((s) => s.kind === 'candlestick') ?? null;
const rsiSeries = (c: FakeChart) => c.series.find((s) => s.kind === 'line' && s.paneIndex > 0) ?? null;
const histogramSeries = (c: FakeChart) => c.series.filter((s) => s.kind === 'histogram');
const lastChart = () => charts[charts.length - 1];

/* ------------------------------------------------------- mount harnesses */

const NO_OVERLAYS: OverlayFlags = { sma20: false, sma50: false, sma200: false, ema: false, bb: false };

let container: HTMLDivElement;
let root: Root | null = null;

// jsdom does not implement ResizeObserver; the chart uses one to re-size panes.
if (!('ResizeObserver' in globalThis)) {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;
}

// React needs this flag to treat our act() calls as a proper test environment.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  charts.length = 0;
  container = document.createElement('div');
  document.body.append(container);
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container.remove();
});

/**
 * Mirrors how ChartScreen owns pane state, so the toolbar→chart wiring is
 * exercised the same way the real app wires it.
 */
function Harness() {
  const [panes, setPanes] = useState({ volume: false, rsi: false, macd: false });
  return (
    <>
      <ChartToolbar
        overlays={NO_OVERLAYS}
        onOverlaysChange={() => {}}
        showVolume={panes.volume}
        showRsi={panes.rsi}
        showMacd={panes.macd}
        onTogglePane={(pane) => setPanes((p) => ({ ...p, [pane]: !p[pane] }))}
      />
      <StockChart
        candles={CANDLES}
        indicators={INDICATORS}
        interval="1d"
        meta={null}
        overlays={NO_OVERLAYS}
        showVolume={panes.volume}
        showRsi={panes.rsi}
        showMacd={panes.macd}
        fitKey="TEST|1d|1y"
      />
    </>
  );
}

function mount(ui: React.ReactElement) {
  act(() => {
    root = createRoot(container);
    root.render(ui);
  });
}

/**
 * Click a sub-pane toggle button.
 *
 * Selected by `data-pane`, not by its visible label: since Phase 2 the labels
 * are translated (Volume / 成交量), so matching on text would make these tests
 * locale-dependent. `data-pane` is a stable hook the UI deliberately exposes.
 */
function clickPane(label: 'Volume' | 'RSI' | 'MACD') {
  const id = label.toLowerCase();
  const btn = container.querySelector(`.chart-toolbar button[data-pane="${id}"]`);
  if (!btn) throw new Error(`no pane button with data-pane="${id}"`);
  act(() => {
    (btn as HTMLButtonElement).click();
  });
}

/** The pane button element, for state assertions. */
function paneButton(label: 'Volume' | 'RSI' | 'MACD'): HTMLButtonElement {
  const btn = container.querySelector(`.chart-toolbar button[data-pane="${label.toLowerCase()}"]`);
  if (!btn) throw new Error(`no pane button with data-pane="${label.toLowerCase()}"`);
  return btn as HTMLButtonElement;
}

/* ------------------------------------------------------------------ tests */

describe('StockChart — sub-pane toggles keep the chart populated (B1 regression)', () => {
  it('draws the candles on first mount', () => {
    mount(<Harness />);
    expect(charts).toHaveLength(1);
    expect(candleSeries(lastChart())?.data.length).toBe(CANDLES.length);
  });

  it('re-pushes the candles after toggling each sub-pane on', () => {
    mount(<Harness />);

    for (const [label, seriesKind] of [
      ['Volume', 'histogram'],
      ['RSI', 'line'],
      ['MACD', 'histogram'],
    ] as const) {
      clickPane(label);

      // A pane toggle necessarily rebuilds the chart (panes cannot be added to a
      // live chart), so the newest chart instance is the one that must be filled.
      const chart = lastChart();
      expect(candleSeries(chart), `${label}: rebuild created a candle series`).not.toBeNull();
      expect(
        candleSeries(chart)?.data.length,
        `${label}: the rebuilt chart must receive the candles, not stay blank`,
      ).toBe(CANDLES.length);

      // And the requested indicator series must have real points on it.
      const populated = chart.series.filter((s) => s.kind === seriesKind && s.paneIndex > 0);
      expect(populated.length, `${label}: a ${seriesKind} series exists in a sub-pane`).toBeGreaterThan(0);
      expect(
        populated.some((s) => s.data.length > 0),
        `${label}: the sub-pane series received data`,
      ).toBe(true);
    }
  });

  it('re-pushes the candles after toggling the panes back off', () => {
    mount(<Harness />);
    for (const label of ['Volume', 'RSI', 'MACD'] as const) clickPane(label);
    for (const label of ['Volume', 'RSI', 'MACD'] as const) clickPane(label);

    const chart = lastChart();
    expect(candleSeries(chart)?.data.length).toBe(CANDLES.length);
    expect(chart.series.some((s) => s.paneIndex > 0)).toBe(false);
  });

  it('never leaves a chart instance with an empty candle series', () => {
    mount(<Harness />);
    clickPane('RSI');
    clickPane('MACD');
    clickPane('Volume');
    clickPane('RSI');

    const blank = charts.filter((c) => !c.removed && (candleSeries(c)?.data.length ?? 0) === 0);
    expect(blank, 'every live chart instance must show candles').toHaveLength(0);
  });

  it('keeps the RSI pane series bound to the RSI values, not the candles', () => {
    mount(<Harness />);
    clickPane('RSI');
    const rsi = rsiSeries(lastChart());
    expect(rsi?.data.length).toBe(INDICATORS.rsi14.length);
  });

  it('gives the MACD pane both a histogram and the two lines', () => {
    mount(<Harness />);
    clickPane('MACD');
    const chart = lastChart();
    expect(histogramSeries(chart).length).toBeGreaterThanOrEqual(1);
    expect(chart.series.filter((s) => s.kind === 'line' && s.paneIndex > 0).length).toBeGreaterThanOrEqual(2);
  });

  it('toggling one pane off leaves the others intact and the chart populated', () => {
    mount(<Harness />);
    clickPane('Volume');
    clickPane('RSI');
    const withBoth = candleSeries(lastChart())?.data.length;
    expect(withBoth).toBe(CANDLES.length);

    clickPane('Volume'); // turn Volume back off, RSI stays on
    const chart = lastChart();
    expect(candleSeries(chart)?.data.length).toBe(CANDLES.length);
    expect(chart.series.some((s) => s.paneIndex > 0)).toBe(true);
  });
});

describe('ChartToolbar — pane buttons are real, stateful controls', () => {
  it('reflects and flips aria-pressed for each sub-pane', () => {
    mount(<Harness />);

    expect(paneButton('Volume').getAttribute('aria-pressed')).toBe('false');
    clickPane('Volume');
    expect(paneButton('Volume').getAttribute('aria-pressed')).toBe('true');
    clickPane('Volume');
    expect(paneButton('Volume').getAttribute('aria-pressed')).toBe('false');
  });
});
