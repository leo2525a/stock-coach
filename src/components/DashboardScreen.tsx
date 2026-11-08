import { useMemo, useState } from 'react';
import { useStore } from '../store';
import { MoverStrip } from './MoverStrip';
import { SignalCard } from './SignalCard';
import { SourceBadge } from './Controls';
import { ChartToolbar } from './ChartToolbar';
import { StockChart, type OverlayFlags } from '../chart/StockChart';
import { ProfilePanel } from './ProfilePanel';
import { CategoryPanel } from './CategoryPanel';
import { KeyStatsPanel, HealthPanel } from './FundamentalsPanel';
import { RangePanel } from './RangePanel';
import { NewsPanel } from './NewsPanel';
import { useApiError, useT } from '../i18n';
import { formatCompact, formatPercent, formatPrice } from '../../shared/format';
import { dirClassOrFlat } from './Sidebar';

const HERO_OVERLAYS: OverlayFlags = { sma20: false, sma50: true, sma200: true, ema: false, bb: false };
const PANE_KEY = 'stockcoach.dash.panes';
const PANE_DEFAULT = { volume: true, rsi: false, macd: false };

type Panes = typeof PANE_DEFAULT;

/** Dashboards panes persist like the chart's, so the layout is stable. */
function readPanes(): Panes {
  try {
    const raw = localStorage.getItem(PANE_KEY);
    return raw ? { ...PANE_DEFAULT, ...(JSON.parse(raw) as Partial<Panes>) } : PANE_DEFAULT;
  } catch {
    return PANE_DEFAULT;
  }
}

/**
 * The Dashboard answers the owner's brief in one scroll (SPEC-PHASE2 §E–§G):
 * what moved, the chart, the headline numbers, what this company *is*, how the
 * instrument is classified, how it is doing financially, where today sits in
 * its yearly range, and what the news says — every panel labelled with where
 * its numbers came from.
 *
 * Order is deliberate: glanceable market facts first, then the slower-moving
 * "about this company" material, then the news.
 */
export function DashboardScreen() {
  const t = useT();
  const market = useStore((s) => s.market);
  const marketLoad = useStore((s) => s.marketLoad);
  const signals = useStore((s) => s.signals);
  const symbol = useStore((s) => s.symbol);
  const marketError = useApiError(marketLoad.code, { symbol }, marketLoad.error ?? '');
  const setScreen = useStore((s) => s.setScreen);
  const view = useStore((s) => s.view);

  const [overlays, setOverlays] = useState<OverlayFlags>(HERO_OVERLAYS);
  const [panes, setPanes] = useState<Panes>(readPanes);

  const candles = market?.candles ?? [];
  const meta = market?.meta ?? null;
  const fitKey = useMemo(() => `${symbol}|${market?.interval ?? ''}|${view.range}`, [symbol, market?.interval, view.range]);

  const topSignals = (signals?.signals ?? []).slice(0, 3);

  const togglePane = (pane: keyof Panes) => {
    setPanes((p) => {
      const next = { ...p, [pane]: !p[pane] };
      try {
        localStorage.setItem(PANE_KEY, JSON.stringify(next));
      } catch {
        /* a preference is not worth crashing over */
      }
      return next;
    });
  };

  return (
    <div className="stack" data-testid="dashboard-screen">
      {/* ---------- movers strip ---------- */}
      <section className="panel">
        <h2 className="panel-title">{t('dash.movers.title')}</h2>
        <MoverStrip />
      </section>

      {/* ---------- hero: the chart ---------- */}
      <section className="panel">
        <div className="spread">
          <div className="symbol-head">
            <span className="sym">{symbol}</span>
            <span className="sym-name">{meta?.name ?? ''}</span>
          </div>
          <div className={`price-block ${dirClassOrFlat(meta?.changePercent ?? null)}`}>
            <span className="last">{formatPrice(meta?.lastPrice ?? candles.at(-1)?.close ?? null, meta?.currency)}</span>
            <span>
              {meta?.change !== null && meta?.change !== undefined
                ? `${meta.change >= 0 ? '+' : ''}${formatPrice(meta.change)}`
                : ''}
            </span>
            <span>{formatPercent(meta?.changePercent ?? null)}</span>
          </div>
          <SourceBadge
            source={market?.source}
            stale={market?.source === 'stale-cache'}
            lastUpdated={market?.lastUpdated ?? null}
          />
        </div>

        {marketLoad.status === 'error' ? (
          <div className="error-box" style={{ marginTop: 10 }} data-testid="dashboard-error">
            {t('dash.error', { symbol, error: marketError })}
          </div>
        ) : null}

        <div style={{ marginTop: 10 }}>
          <ChartToolbar
            overlays={overlays}
            onOverlaysChange={setOverlays}
            showVolume={panes.volume}
            showRsi={panes.rsi}
            showMacd={panes.macd}
            onTogglePane={togglePane}
          />
        </div>

        <div style={{ position: 'relative', marginTop: 10 }}>
          {candles.length === 0 && marketLoad.status !== 'loading' ? (
            <div className="empty">{t('dash.noPrice')}</div>
          ) : (
            <StockChart
              candles={candles}
              indicators={market?.indicators ?? null}
              interval={market?.interval ?? view.interval}
              meta={meta}
              overlays={overlays}
              showVolume={panes.volume}
              showRsi={panes.rsi}
              showMacd={panes.macd}
              fitKey={fitKey}
            />
          )}
          {marketLoad.status === 'loading' ? (
            <div className="chart-loading">{t('dash.downloading', { symbol })}</div>
          ) : null}
        </div>
      </section>

      {/* ---------- price facts + fundamentals ---------- */}
      <KeyStatsPanel />

      {/* ---------- 52-week range ---------- */}
      <RangePanel />

      {/* ---------- what this instrument is ---------- */}
      <div className="two-col">
        <ProfilePanel />
        <CategoryPanel />
      </div>

      {/* ---------- quality / analyst view ---------- */}
      <HealthPanel />

      {/* ---------- news & updates ---------- */}
      <NewsPanel />

      {/* ---------- signals preview ---------- */}
      <section className="panel">
        <div className="spread">
          <h2 className="panel-title" style={{ margin: 0 }}>
            {t('dash.signals.title')}
          </h2>
          <button type="button" onClick={() => setScreen('signals')}>
            {t('common.seeAllSignals')}
          </button>
        </div>
        {signals ? (
          <>
            <p className="panel-note" style={{ marginTop: 8 }}>
              {t('dash.signals.verdict', {
                verdict: t(`signals.verdict.${signals.summary.verdictVariant}`),
                score: signals.summary.score,
                count: signals.signals.length,
              })}
            </p>
            <div className="signal-grid" style={{ marginTop: 8 }}>
              {topSignals.map((s) => (
                <SignalCard key={s.id} signal={s} />
              ))}
            </div>
          </>
        ) : (
          <p className="empty">{t('dash.signals.loading')}</p>
        )}
      </section>

      {/* ---------- first-time help ---------- */}
      {market ? (
        <section className="help">
          <h3>{t('dash.help.title')}</h3>
          <ul>
            <li>{t('dash.help.tip1')}</li>
            <li>{t('dash.help.tip2')}</li>
            <li>{t('dash.help.tip3')}</li>
          </ul>
        </section>
      ) : null}

      {/* Bars caption lives next to the chart it describes. */}
      {candles.length ? (
        <p className="tiny muted" style={{ margin: 0 }}>
          {t('chart.bars', { count: formatCompact(candles.length), interval: market?.interval ?? '' })} · {view.range}
        </p>
      ) : null}
    </div>
  );
}
