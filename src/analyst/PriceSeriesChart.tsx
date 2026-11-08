/**
 * A minimal price line for the analyst panels (§C.5 band, §C.6 estimate level).
 *
 * Deliberately *not* `StockChart`: that component is a full trading workspace
 * (candles, indicator panes, crosshair legend) and reusing it here would both
 * cost far more than these panels need and drag chart-toolbar semantics into
 * places they do not belong.
 *
 * The honesty rule this file enforces: the only *series* is real price history.
 * The target band and the estimate level are horizontal **price lines**, which
 * is exactly what they are — current levels, not historical series.
 */
import {
  LineSeries,
  LineStyle,
  createChart,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts';
import { useEffect, useRef } from 'react';
import type { Candle } from '../../shared/types';
import { toChartTime } from '../chart/data';
import { chartPalette, useChartTheme } from '../chart/theme';

export interface PriceLine {
  value: number | null;
  color: string;
  /** Short label drawn on the axis, e.g. a target mean. */
  title: string;
  dashed?: boolean;
}

export interface PriceSeriesChartProps {
  candles: readonly Candle[];
  height?: number;
  /** Horizontal reference levels (target band, estimate level). */
  lines?: readonly PriceLine[];
  testId?: string;
}

export function PriceSeriesChart({ candles, height = 150, lines = [], testId }: PriceSeriesChartProps) {
  const theme = useChartTheme();
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const linesRef = useRef<IPriceLine[]>([]);

  // One chart for the component's life; data and reference levels are updated
  // in place so changing the span never rebuilds (and never re-animates) it.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    // Phase 5: follow the day/night theme.
    const pal = chartPalette();
    const chart = createChart(el, {
      height,
      layout: { background: { color: pal.bg }, textColor: pal.text, fontSize: 10, attributionLogo: false },
      grid: { vertLines: { color: pal.grid }, horzLines: { color: pal.grid } },
      rightPriceScale: { borderColor: pal.axis },
      timeScale: { borderColor: pal.axis, fixLeftEdge: true, fixRightEdge: true },
      handleScroll: false,
      handleScale: false,
      crosshair: { horzLine: { visible: false }, vertLine: { visible: false } },
    });
    seriesRef.current = chart.addSeries(LineSeries, {
      color: pal.accent,
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    chartRef.current = chart;
    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      linesRef.current = [];
    };
  }, [height, theme]);

  useEffect(() => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    if (!chart || !series) return;
    const interval = candles.length > 260 ? '1w' : '1d';
    const data = candles
      .filter((c) => Number.isFinite(c.close))
      .map((c) => ({ time: toChartTime(c.time, interval) as UTCTimestamp, value: c.close }));
    series.setData(data);
    if (data.length > 1) chart.timeScale().fitContent();
  }, [candles]);

  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    for (const l of linesRef.current) {
      try {
        series.removePriceLine(l);
      } catch {
        /* already gone */
      }
    }
    linesRef.current = [];
    for (const l of lines) {
      if (l.value === null || !Number.isFinite(l.value)) continue;
      linesRef.current.push(
        series.createPriceLine({
          price: l.value,
          color: l.color,
          lineWidth: 1,
          lineStyle: l.dashed ? LineStyle.Dashed : LineStyle.Solid,
          axisLabelVisible: true,
          title: l.title,
        }),
      );
    }
  }, [lines]);

  return <div className="pf-chart" ref={wrapRef} data-testid={testId} style={{ height }} />;
}
