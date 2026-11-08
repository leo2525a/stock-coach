import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store';
import { ChartToolbar } from './ChartToolbar';
import { SourceBadge } from './Controls';
import { TopBar } from './TopBar';
import { useApiError, useT } from '../i18n';
import { StockChart, type OverlayFlags } from '../chart/StockChart';
import { formatCompact, formatHKT, formatPrice } from '../../shared/format';

const OVERLAY_KEY = 'stockcoach.overlays';
const PANE_KEY = 'stockcoach.panes';

const DEFAULT_OVERLAYS: OverlayFlags = { sma20: false, sma50: true, sma200: true, ema: false, bb: false };
const DEFAULT_PANES = { volume: true, rsi: false, macd: false };

function readStored<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<T>;
    // Merge so a newly added flag gets its default instead of `undefined`.
    return { ...fallback, ...parsed };
  } catch {
    return fallback;
  }
}

export function ChartScreen() {
  const t = useT();
  const market = useStore((s) => s.market);
  const load = useStore((s) => s.marketLoad);
  const symbol = useStore((s) => s.symbol);
  const view = useStore((s) => s.view);
  const loadMarket = useStore((s) => s.loadMarket);
  const errorText = useApiError(load.code, { symbol }, load.error ?? '');

  const [overlays, setOverlays] = useState<OverlayFlags>(() => readStored(OVERLAY_KEY, DEFAULT_OVERLAYS));
  const [panes, setPanes] = useState(() => readStored(PANE_KEY, DEFAULT_PANES));

  // Persist so the chart looks the same when the user comes back.
  useEffect(() => {
    localStorage.setItem(OVERLAY_KEY, JSON.stringify(overlays));
  }, [overlays]);
  useEffect(() => {
    localStorage.setItem(PANE_KEY, JSON.stringify(panes));
  }, [panes]);

  const candles = market?.candles ?? [];
  const indicators = market?.indicators ?? null;
  const meta = market?.meta ?? null;

  // Re-fit the viewport only when the symbol or window changes, not on a mere
  // refresh — otherwise a user's zoom is yanked away every few seconds.
  const fitKey = useMemo(() => `${symbol}|${market?.interval ?? ''}|${view.range}`, [symbol, market?.interval, view.range]);

  const loading = load.status === 'loading';

  return (
    <div className="stack" data-testid="chart-screen">
      <TopBar />
      <div className="panel" data-testid="chart-hero">
        <div className="symbol-head">
          <span className="sym">{symbol}</span>
          <span className="sym-name">{meta?.name ?? ''}</span>
          {meta ? (
            <span className="badge badge-dim">
              {meta.exchange} · {meta.currency}
            </span>
          ) : null}
          <SourceBadge source={market?.source} stale={market?.source === 'stale-cache'} lastUpdated={market?.lastUpdated ?? null} />
        </div>
        <span className="stamp">
          {candles.length ? t('chart.bars', { count: formatCompact(candles.length) }) : t('common.noData')} ·{' '}
          {t('dash.hero.asOf', { time: formatHKT(market?.lastUpdated ?? null) })}
          {meta ? ` · ${t('chart.prevClose', { value: formatPrice(meta.previousClose, meta.currency) })}` : ''}
        </span>
      </div>

      <ChartToolbar
        overlays={overlays}
        onOverlaysChange={setOverlays}
        showVolume={panes.volume}
        showRsi={panes.rsi}
        showMacd={panes.macd}
        onTogglePane={(pane) => setPanes((p) => ({ ...p, [pane]: !p[pane] }))}
      />

      {load.status === 'error' ? (
        <div className="error-box" data-testid="market-error">
          {t('chart.error', { symbol, error: errorText })}
          <div className="row" style={{ marginTop: 8 }}>
            <button type="button" onClick={() => void loadMarket()}>
              {t('common.tryAgain')}
            </button>
            <button type="button" onClick={() => void loadMarket({ force: true })}>
              {t('common.forceRedownload')}
            </button>
          </div>
        </div>
      ) : null}

      <div style={{ position: 'relative' }}>
        {candles.length === 0 && !loading ? (
          <div className="panel empty">{t('chart.noData')}</div>
        ) : (
          <StockChart
            candles={candles}
            indicators={indicators}
            interval={market?.interval ?? view.interval}
            meta={meta}
            overlays={overlays}
            showVolume={panes.volume}
            showRsi={panes.rsi}
            showMacd={panes.macd}
            fitKey={fitKey}
          />
        )}
        {loading ? (
          <div className="chart-loading" data-testid="chart-loading">
            {t('chart.downloading', { symbol, range: view.range })}
          </div>
        ) : null}
      </div>

      <div className="panel">
        <h3 className="panel-title">{t('chart.reading.title')}</h3>
        <ul className="help" style={{ background: 'transparent', border: 0, padding: 0 }}>
          <li>{t('chart.reading.candle', { interval: view.interval })}</li>
          <li>{t('chart.reading.zoom')}</li>
          <li>{t('chart.reading.times')}</li>
        </ul>
      </div>
    </div>
  );
}
