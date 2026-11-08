/**
 * Chart theming (Phase 5, owner: 「日夜 mode」).
 *
 * The three `lightweight-charts` canvases are drawn by JS, so they cannot read
 * CSS variables themselves. This module is the single bridge: it reads the
 * *live* computed tokens off `<html>` and hands the chart constructors a
 * palette. Both themes therefore stay in step with `styles.css` — a colour is
 * defined in exactly one place.
 *
 * `useChartTheme()` returns the resolved theme string so a chart can put it in
 * its build-effect dependency list; a day/night flip then rebuilds the canvas
 * with the new palette. Rebuilds are cheap and preserve the saved viewport.
 */
import { useMemo } from 'react';
import { useStore } from '../store';
import {
  DOWN_COLOR,
  DOWN_SOFT,
  SERIES_COLORS,
  UP_COLOR,
  UP_SOFT,
} from './data';

export interface ChartPalette {
  bg: string;
  grid: string;
  text: string;
  axis: string;
  accent: string;
  up: string;
  down: string;
  upSoft: string;
  downSoft: string;
  /** Analyst reference-line colours (target low/mean/high, price, estimate). */
  ref: {
    price: string;
    low: string;
    mean: string;
    high: string;
    estimate: string;
  };
  series: {
    sma20: string;
    sma50: string;
    sma200: string;
    ema12: string;
    ema26: string;
    bbUpper: string;
    bbMiddle: string;
    bbLower: string;
    rsi: string;
    macd: string;
    macdSignal: string;
  };
}

/** Read one custom property, trimmed; `fallback` when there is no DOM. */
function cssVar(name: string, fallback: string): string {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  } catch {
    return fallback;
  }
}

/**
 * The palette for the currently applied theme. Called at chart-build time (and
 * again on a theme flip, via the dependency in `useChartTheme`).
 */
export function chartPalette(): ChartPalette {
  return {
    bg: cssVar('--chart-bg', '#161b22'),
    grid: cssVar('--chart-grid', '#222833'),
    text: cssVar('--chart-text', '#9aa7b4'),
    axis: cssVar('--chart-axis', '#2a313c'),
    accent: cssVar('--accent', '#4c8dff'),
    up: cssVar('--up', UP_COLOR),
    down: cssVar('--down', DOWN_COLOR),
    upSoft: cssVar('--up-soft', UP_SOFT),
    downSoft: cssVar('--down-soft', DOWN_SOFT),
    ref: {
      price: cssVar('--ref-price', '#4c8dff'),
      low: cssVar('--ref-low', '#7d8590'),
      mean: cssVar('--ref-mean', '#26a69a'),
      high: cssVar('--ref-high', '#7d8590'),
      estimate: cssVar('--ref-estimate', '#f5c542'),
    },
    series: {
      sma20: cssVar('--sma20', SERIES_COLORS.sma20),
      sma50: cssVar('--sma50', SERIES_COLORS.sma50),
      sma200: cssVar('--sma200', SERIES_COLORS.sma200),
      ema12: cssVar('--ema12', SERIES_COLORS.ema12),
      ema26: cssVar('--ema26', SERIES_COLORS.ema26),
      bbUpper: cssVar('--bb', SERIES_COLORS.bbUpper),
      bbMiddle: cssVar('--bb-middle', SERIES_COLORS.bbMiddle),
      bbLower: cssVar('--bb', SERIES_COLORS.bbLower),
      rsi: cssVar('--rsi', SERIES_COLORS.rsi),
      macd: cssVar('--macd', SERIES_COLORS.macd),
      macdSignal: cssVar('--macd-signal', SERIES_COLORS.macdSignal),
    },
  };
}

/** The resolved theme ('dark' | 'light'); put it in a build effect's deps. */
export function useChartTheme(): string {
  return useStore((s) => s.theme);
}

/**
 * The analyst reference-line colours for the current theme. A hook (not a
 * constant) so a day/night flip re-reads the live tokens and the caller — which
 * passes these into `createPriceLine` — re-renders with the new values.
 */
export function useRefColors(): ChartPalette['ref'] {
  const theme = useChartTheme();
  return useMemo(() => chartPalette().ref, [theme]);
}
