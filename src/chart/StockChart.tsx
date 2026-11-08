import {
  CandlestickSeries,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type Time,
} from 'lightweight-charts';
import { useEffect, useMemo, useRef } from 'react';
import type { Candle, IndicatorSeries, Interval, SymbolMeta } from '../../shared/types';
import { formatCompact, formatHKTAxis, formatHKTClock } from '../../shared/format';
import { useT } from '../i18n';
import {
  bandData,
  candleData,
  legendFor,
  lineData,
  macdHistogramData,
  macdLineData,
  precisionFor,
  toChartTime,
  volumeData,
} from './data';
import { chartPalette, useChartTheme } from './theme';

export interface OverlayFlags {
  sma20: boolean;
  sma50: boolean;
  sma200: boolean;
  ema: boolean;
  bb: boolean;
}

export interface StockChartProps {
  candles: Candle[];
  indicators: IndicatorSeries | null;
  interval: Interval;
  meta: SymbolMeta | null;
  overlays: OverlayFlags;
  showVolume: boolean;
  showRsi: boolean;
  showMacd: boolean;
  /** Set when the parent wants the chart to re-fit (e.g. after a fresh load). */
  fitKey?: string;
}

interface Built {
  chart: IChartApi;
  candle: ISeriesApi<'Candlestick'>;
  overlays: Record<string, ISeriesApi<'Line'>>;
  volume: ISeriesApi<'Histogram'> | null;
  rsi: ISeriesApi<'Line'> | null;
  macdHist: ISeriesApi<'Histogram'> | null;
  macdLine: ISeriesApi<'Line'> | null;
  macdSignal: ISeriesApi<'Line'> | null;
}

export function StockChart({
  candles,
  indicators,
  interval,
  meta,
  overlays,
  showVolume,
  showRsi,
  showMacd,
  fitKey,
}: StockChartProps) {
  const t = useT();
  const theme = useChartTheme();
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const legendRef = useRef<HTMLDivElement | null>(null);
  const builtRef = useRef<Built | null>(null);
  /** Survives a rebuild so toggling an indicator does not reset the zoom. */
  const rangeRef = useRef<{ from: number; to: number } | null>(null);
  /** Set by the build effect; lets the data effect repaint the resting legend. */
  const paintLegendRef = useRef<((candleDataPoint: Candle | null) => void) | null>(null);

  const precision = precisionFor(meta?.lastPrice ?? candles.at(-1)?.close ?? null);

  // The pane layout is baked in at construction time, so only these flags force a
  // rebuild; plain data changes go through setData below.
  const structureKey = `${interval}|${showVolume ? 'v' : '-'}${showRsi ? 'r' : '-'}${showMacd ? 'm' : '-'}`;

  const overlayKey = useMemo(
    () =>
      `sma20:${overlays.sma20 ? 1 : 0},sma50:${overlays.sma50 ? 1 : 0},sma200:${overlays.sma200 ? 1 : 0},ema:${
        overlays.ema ? 1 : 0
      },bb:${overlays.bb ? 1 : 0}`,
    [overlays],
  );

  /* ---------------- build / rebuild ---------------- */
  useEffect(() => {
    const host = canvasRef.current;
    if (!host) return;

    // Phase 5: the palette is read live so the canvas follows the day/night
    // theme; `theme` is in the dep list below, so a flip rebuilds it.
    const pal = chartPalette();

    const chart = createChart(host, {
      autoSize: true,
      layout: {
        background: { color: pal.bg },
        textColor: pal.text,
        fontSize: 11,
        fontFamily:
          "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace",
        panes: { separatorColor: pal.axis, separatorHoverColor: pal.accent },
      },
      grid: { vertLines: { color: pal.grid }, horzLines: { color: pal.grid } },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { labelBackgroundColor: pal.accent, color: pal.axis, style: LineStyle.Dashed },
        horzLine: { labelBackgroundColor: pal.accent, color: pal.axis, style: LineStyle.Dashed },
      },
      rightPriceScale: { borderColor: pal.axis, scaleMargins: { top: 0.08, bottom: 0.08 } },
      timeScale: {
        borderColor: pal.axis,
        timeVisible: !(interval === '1d' || interval === '1w' || interval === '1mo'),
        secondsVisible: false,
        rightOffset: 2,
        barSpacing: 7,
        minBarSpacing: 0.5,
      },
      localization: {
        // Axis + crosshair labels always render in Hong Kong time (SPEC §7).
        timeFormatter: (t: Time) => {
          const seconds = typeof t === 'number' ? t : Date.parse(`${String(t)}T00:00:00Z`) / 1000;
          if (!Number.isFinite(seconds)) return '';
          return interval === '1d' || interval === '1w' || interval === '1mo'
            ? `${formatHKTAxis(seconds, interval)} HKT`
            : `${formatHKTClock(seconds)}`;
        },
      },
    });

    // --- panes: 0 main, then volume / RSI / MACD as requested ---
    let paneIndex = 1;
    const volumePane = showVolume ? paneIndex++ : null;
    const rsiPane = showRsi ? paneIndex++ : null;
    const macdPane = showMacd ? paneIndex++ : null;

    const candle = chart.addSeries(CandlestickSeries, {
      upColor: pal.up,
      downColor: pal.down,
      borderUpColor: pal.up,
      borderDownColor: pal.down,
      wickUpColor: pal.up,
      wickDownColor: pal.down,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    const overlaySeries: Record<string, ISeriesApi<'Line'>> = {};
    const addOverlay = (key: string, color: string, width = 2, style = LineStyle.Solid) => {
      overlaySeries[key] = chart.addSeries(LineSeries, {
        color,
        lineWidth: width as 1 | 2 | 3 | 4,
        lineStyle: style,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
        priceFormat: { type: 'price', precision, minMove: 1 / 10 ** precision },
      });
    };
    addOverlay('sma20', pal.series.sma20);
    addOverlay('sma50', pal.series.sma50);
    addOverlay('sma200', pal.series.sma200);
    addOverlay('ema12', pal.series.ema12, 1);
    addOverlay('ema26', pal.series.ema26, 1);
    addOverlay('bbUpper', pal.series.bbUpper, 1, LineStyle.Dotted);
    addOverlay('bbMiddle', pal.series.bbMiddle, 1);
    addOverlay('bbLower', pal.series.bbLower, 1, LineStyle.Dotted);

    const volume = volumePane === null
      ? null
      : chart.addSeries(
          HistogramSeries,
          { priceLineVisible: false, lastValueVisible: false, priceFormat: { type: 'volume' } },
          volumePane,
        );
    const rsi = rsiPane === null
      ? null
      : chart.addSeries(
          LineSeries,
          {
            color: pal.series.rsi,
            lineWidth: 2,
            priceLineVisible: false,
            lastValueVisible: true,
            priceFormat: { type: 'price', precision: 1, minMove: 0.1 },
            autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 100 } }),
          },
          rsiPane,
        );
    const macdHist = macdPane === null
      ? null
      : chart.addSeries(
          HistogramSeries,
          { priceLineVisible: false, lastValueVisible: false, priceFormat: { type: 'price', precision, minMove: 1 / 10 ** precision } },
          macdPane,
        );
    const macdLine = macdPane === null
      ? null
      : chart.addSeries(
          LineSeries,
          { color: pal.series.macd, lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false },
          macdPane,
        );
    const macdSignal = macdPane === null
      ? null
      : chart.addSeries(
          LineSeries,
          { color: pal.series.macdSignal, lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false },
          macdPane,
        );

    builtRef.current = {
      chart,
      candle,
      overlays: overlaySeries,
      volume,
      rsi,
      macdHist,
      macdLine,
      macdSignal,
    };

    /* ---- crosshair legend ---- */
    const paintLegend=(candleDataPoint: Candle | null) => {
      const el = legendRef.current;
      if (!el) return;
      const rows = legendFor(candleDataPoint, precision);
      if (!rows.length) {
        el.textContent = '';
        el.style.display = 'none';
        return;
      }
      el.style.display = 'flex';
      el.textContent = '';
      for (const row of rows) {
        const span = document.createElement('span');
        const k = document.createElement('span');
        k.className = 'k';
        k.textContent = `${row.key} `;
        const v = document.createElement('b');
        v.textContent = row.value;
        if (row.key === 'Δ') {
          v.style.color = row.value.startsWith('-') ? pal.down : pal.up;
        }
        span.append(k, v);
        el.append(span);
      }
    };

    const onMove = (param: Parameters<Parameters<IChartApi['subscribeCrosshairMove']>[0]>[0]) => {
      let hit: Candle | null = null;
      if (param.time) {
        const seq = param.seriesData.get(candle);
        if (seq && 'open' in seq) {
          const d = seq as { open: number; high: number; low: number; close: number };
          const vol = volume ? (param.seriesData.get(volume) as { value?: number } | undefined) : undefined;
          hit = { time: 0, open: d.open, high: d.high, low: d.low, close: d.close, volume: vol?.value ?? 0 };
        }
      }
      paintLegend(hit);
    };
    chart.subscribeCrosshairMove(onMove);
    paintLegendRef.current = paintLegend;

    const onLeave = () => paintLegend(survivingTail(candles));
    host.addEventListener('mouseleave', onLeave);

    /* ---- pane sizing ---- */
    const applyHeights = () => {
      const el = wrapRef.current;
      const panes = chart.panes();
      if (!el || panes.length === 0) return;
      const total = Math.max(220, el.clientHeight);
      const extras = panes.length - 1;
      const extraH = Math.round(total * 0.14);
      const mainH = Math.max(160, total - extraH * extras);
      panes[0].setHeight(mainH);
      for (let i = 1; i < panes.length; i += 1) panes[i].setHeight(extraH);
    };
    applyHeights();

    const ro = new ResizeObserver(() => applyHeights());
    if (wrapRef.current) ro.observe(wrapRef.current);

    return () => {
      ro.disconnect();
      host.removeEventListener('mouseleave', onLeave);
      chart.remove();
      builtRef.current = null;
    };
    // `candles` is intentionally omitted: it is pushed in via setData below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [structureKey, precision, theme]);

  /* ---------------- push data ---------------- */
  useEffect(() => {
    const built = builtRef.current;
    if (!built) return;
    const { chart, candle, overlays: ov } = built;

    if (!candles.length) {
      candle.setData([]);
      Object.values(ov).forEach((s) => s.setData([]));
      built.volume?.setData([]);
      built.rsi?.setData([]);
      built.macdHist?.setData([]);
      built.macdLine?.setData([]);
      built.macdSignal?.setData([]);
      paintLegendRef.current?.(null);
      return;
    }

    candle.setData(candleData(candles, interval));
    built.volume?.setData(volumeData(candles, interval));

    const ind = indicators;
    const set = (key: string, data: ReturnType<typeof lineData>) => ov[key]?.setData(data);

    set('sma20', overlays.sma20 && ind ? lineData(ind.sma20, interval) : []);
    set('sma50', overlays.sma50 && ind ? lineData(ind.sma50, interval) : []);
    set('sma200', overlays.sma200 && ind ? lineData(ind.sma200, interval) : []);
    set('ema12', overlays.ema && ind ? lineData(ind.ema12, interval) : []);
    set('ema26', overlays.ema && ind ? lineData(ind.ema26, interval) : []);
    set('bbUpper', overlays.bb && ind ? bandData(ind.bb, 'upper', interval) : []);
    set('bbMiddle', overlays.bb && ind ? bandData(ind.bb, 'middle', interval) : []);
    set('bbLower', overlays.bb && ind ? bandData(ind.bb, 'lower', interval) : []);

    built.rsi?.setData(ind ? lineData(ind.rsi14, interval) : []);
    built.macdHist?.setData(ind ? macdHistogramData(ind.macd, interval) : []);
    built.macdLine?.setData(ind ? macdLineData(ind.macd, 'macd', interval) : []);
    built.macdSignal?.setData(ind ? macdLineData(ind.macd, 'signal', interval) : []);

    // Resting state: show the latest candle's OHLC, like TradingView, so the
    // legend is useful before the user has hovered anything.
    paintLegendRef.current?.(survivingTail(candles));

    // Restore the previous viewport after a rebuild, otherwise fit the data.
    const saved = rangeRef.current;
    if (saved) {
      chart.timeScale().setVisibleLogicalRange({ from: saved.from, to: saved.to });
    } else {
      chart.timeScale().fitContent();
    }
    // `structureKey` MUST be here. Toggling a sub-pane rebuilds the chart with
    // fresh, empty series; without this dep the push effect would not re-run and
    // the chart would stay blank until something else changed. (Regression guard
    // in tests/stockchart.test.tsx and the pane-toggle checks in
    // scripts/evidence-chart.mjs.)
  }, [candles, indicators, interval, overlays, overlayKey, structureKey]);

  /* ---------------- remember the viewport ---------------- */
  useEffect(() => {
    const built = builtRef.current;
    if (!built) return;
    const ts = built.chart.timeScale();
    const onRange = (r: { from: number; to: number } | null) => {
      if (r && Number.isFinite(r.from) && Number.isFinite(r.to)) rangeRef.current = { from: r.from, to: r.to };
    };
    ts.subscribeVisibleLogicalRangeChange(onRange);
    return () => ts.unsubscribeVisibleLogicalRangeChange(onRange);
  }, [structureKey]);

  /* ---------------- reset viewport when the symbol/window changes ---------------- */
  useEffect(() => {
    // Deliberately keyed on fitKey only: the ref must be cleared when the user
    // switches symbol or window, not on every data refresh.
    rangeRef.current = null;
  }, [fitKey]);

  const lastPrice = meta?.lastPrice ?? candles.at(-1)?.close ?? null;

  return (
    <div className="chart-wrap" ref={wrapRef} data-testid="chart-wrap" data-bar-count={candles.length}>
      <div className="ohlc-legend" ref={legendRef} data-testid="ohlc-legend" />
      <div className="chart-canvas" ref={canvasRef} data-testid="chart-canvas" />
      {lastPrice !== null && candles.length > 0 ? (
        <div className="chart-attr" title={t('chart.attribution')}>
          {t('chart.barsLast', {
            count: formatCompact(candles.length),
            price: lastPrice.toFixed(precision),
          })}
        </div>
      ) : null}
    </div>
  );
}

/** Last candle, used to restore the legend after the pointer leaves. */
function survivingTail(candles: Candle[]): Candle | null {
  return candles.length ? candles[candles.length - 1] : null;
}

export { toChartTime };
