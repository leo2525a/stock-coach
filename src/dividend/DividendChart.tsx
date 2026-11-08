/**
 * §C.4 — the dividend graph: per-share **payments** as bars, **yield** as a line.
 *
 * Two series, one time axis, because the two answer different questions and
 * forcing them onto one scale would be the classic dual-axis lie. The bars are
 * the chart's own `events.div` amounts (split-adjusted, as published); the line
 * is the `trailingDividendYield` series, which starts 2015-04 — so when the
 * span reaches further back the line simply begins later, and the caption says
 * which points were reconstructed rather than implying the provider published
 * them (§A.2, §C.4).
 *
 * The graph draws **only** what the payload contains. An empty series renders
 * the honest-empty state instead of an empty grid, and a missing yield line
 * leaves the bars alone rather than blanking both.
 */
import {
  ColorType,
  HistogramSeries,
  LineSeries,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts';
import { useEffect, useRef } from 'react';
import type { DividendHistoryPayload } from '../../shared/dividends';
import { chartPalette, useChartTheme } from '../chart/theme';

export interface DividendChartProps {
  history: DividendHistoryPayload | null;
  height?: number;
  /** Shown when there is nothing to draw — the caller supplies the wording. */
  emptyLabel: string;
  testId?: string;
}

export function DividendChart({ history, height = 200, emptyLabel, testId }: DividendChartProps) {
  const theme = useChartTheme();
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const barRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const lineRef = useRef<ISeriesApi<'Line'> | null>(null);

  // One chart per mount; the span switch swaps the data in place rather than
  // rebuilding (and re-animating) the canvas.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    // Phase 5: read the live palette so the canvas follows the day/night theme.
    const pal = chartPalette();
    const chart = createChart(el, {
      height,
      layout: {
        background: { type: ColorType.Solid, color: pal.bg },
        textColor: pal.text,
        fontSize: 10,
        attributionLogo: false,
      },
      grid: { vertLines: { color: pal.grid }, horzLines: { color: pal.grid } },
      rightPriceScale: { borderColor: pal.axis },
      timeScale: { borderColor: pal.axis, fixLeftEdge: true, fixRightEdge: true },
      handleScroll: false,
      handleScale: false,
      crosshair: { horzLine: { visible: false }, vertLine: { visible: false } },
    });
    // Both series share *one* price scale on purpose. A second, hidden axis for
    // the yield line is the classic dual-axis trick — it makes any two series
    // look correlated. Sharing the axis keeps the magnitudes honest, and the
    // caption tells the reader the two series are measured differently.
    barRef.current = chart.addSeries(HistogramSeries, {
      color: pal.accent,
      priceLineVisible: false,
      lastValueVisible: false,
      base: 0,
    });
    lineRef.current = chart.addSeries(LineSeries, {
      color: pal.accent,
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    chartRef.current = chart;
    return () => {
      chart.remove();
      chartRef.current = null;
      barRef.current = null;
      lineRef.current = null;
    };
  }, [height, theme]);

  useEffect(() => {
    const chart = chartRef.current;
    const bars = barRef.current;
    const line = lineRef.current;
    if (!chart || !bars || !line) return;

    // Bars and points are bucketed to whole UTC days so two payments on the same
    // date cannot collide on the time axis.
    const day = (epochSeconds: number): UTCTimestamp =>
      (Math.floor(epochSeconds / 86400) * 86400) as UTCTimestamp;
    const payments = (history?.payments ?? [])
      .filter((p) => Number.isFinite(p.date) && Number.isFinite(p.amount))
      .map((p) => ({ time: day(p.date), value: p.amount }))
      .sort((a, b) => (a.time as number) - (b.time as number));
    const yields = (history?.yields ?? [])
      .filter((p) => Number.isFinite(p.date) && Number.isFinite(p.value))
      .map((p) => ({ time: day(p.date), value: p.value }))
      .sort((a, b) => (a.time as number) - (b.time as number));

    bars.setData(payments);
    line.setData(yields);
    if (payments.length > 1 || yields.length > 1) chart.timeScale().fitContent();
  }, [history]);

  const hasData = (history?.payments.length ?? 0) > 0 || (history?.yields.length ?? 0) > 0;

  return (
    <div className="div-chart-wrap" data-testid={testId}>
      {/*
        The canvas is created once and kept; when the span has no data at all we
        hide the plot rather than unmounting the chart, because unmount/remount
        on every span click would flash the whole panel.
      */}
      <div
        ref={wrapRef}
        className={`pf-chart${hasData ? '' : ' div-chart-empty'}`}
        hidden={!hasData}
        data-testid={testId ? `${testId}-canvas` : undefined}
      />
      {!hasData ? (
        <p className="pf-empty" data-testid={testId ? `${testId}-empty` : undefined}>
          {emptyLabel}
        </p>
      ) : null}
    </div>
  );
}
