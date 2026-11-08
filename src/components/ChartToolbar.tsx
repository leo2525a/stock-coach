import { useState } from 'react';
import { RefreshCw } from './icons';
import { INTERVAL_INFO, RANGE_INFO } from '../../shared/types';
import { useStore } from '../store';
import { useT } from '../i18n';
import type { OverlayFlags } from '../chart/StockChart';
import { availableOverlays } from '../chart/data';

export interface ChartToolbarProps {
  overlays: OverlayFlags;
  onOverlaysChange: (next: OverlayFlags) => void;
  showVolume: boolean;
  showRsi: boolean;
  showMacd: boolean;
  onTogglePane: (pane: 'volume' | 'rsi' | 'macd') => void;
}

/**
 * Range / interval / overlay / pane controls.
 *
 * Range and interval codes stay in their conventional Latin form (1D, 1W, 5m…)
 * because that is what every trading app prints and users scan for shape, not
 * words. Only the *labels* around them are translated.
 *
 * At phone width the four families are shown one at a time and named by a tab
 * row above them. Owner (round 7): 「圖表個一頁得返時段禁」 — the row used to be
 * 1434px wide inside a 358px viewport with only a fade on the edge, so interval,
 * indicators and sub-panes were invisible. Tabs make every family visible; the
 * panel below shows the selected one in full, with no horizontal scrolling.
 */
const TOOLBAR_TABS = [
  { id: 'range', key: 'chart.rangeGroup' },
  { id: 'interval', key: 'chart.intervalGroup' },
  { id: 'overlays', key: 'chart.overlayGroup' },
  { id: 'panes', key: 'chart.paneGroup' },
] as const;

type ToolbarGroup = (typeof TOOLBAR_TABS)[number]['id'];
export function ChartToolbar({
  overlays,
  onOverlaysChange,
  showVolume,
  showRsi,
  showMacd,
  onTogglePane,
}: ChartToolbarProps) {
  const t = useT();
  const view = useStore((s) => s.view);
  const setRange = useStore((s) => s.setRange);
  const setInterval = useStore((s) => s.setInterval);
  const setAutoInterval = useStore((s) => s.setAutoInterval);
  const indicators = useStore((s) => s.market?.indicators ?? null);
  const loadMarket = useStore((s) => s.loadMarket);
  const [group, setGroup] = useState<ToolbarGroup>('range');

  const avail = availableOverlays(indicators);

  const overlayBtn = (key: keyof OverlayFlags, label: string, enabled: boolean) => (
    <button
      key={key}
      type="button"
      data-overlay={key}
      className={overlays[key] ? 'active' : ''}
      aria-pressed={overlays[key]}
      disabled={!enabled}
      title={enabled ? t('chart.toggleOverlay', { label }) : t('chart.needsHistory', { label })}
      onClick={() => onOverlaysChange({ ...overlays, [key]: !overlays[key] })}
    >
      {label}
    </button>
  );

  return (
    <div className="chart-toolbar-wrap" data-testid="chart-toolbar-wrap">
      {/* Phone layout: the four control families are named as tabs, so the user
          can SEE that interval, indicators and sub-panes exist. Previously the
          row was 4x the screen width behind an invisible horizontal scroll and
          the owner reported 「得返時段禁」 — fade hints are not an affordance. */}
      <div className="toolbar-tabs" role="tablist" aria-label={t('chart.controls')}>
        {TOOLBAR_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            data-tab={tab.id}
            aria-selected={group === tab.id}
            aria-controls="chart-toolbar"
            className={group === tab.id ? 'active' : ''}
            onClick={() => setGroup(tab.id)}
          >
            {t(tab.key)}
          </button>
        ))}
      </div>
      <div className="chart-toolbar" id="chart-toolbar" data-testid="chart-toolbar">
      <div className="toolbar-group" data-group="range" data-active={group === 'range'} role="group" aria-label={t('chart.rangeGroup')}>
        <span className="lbl">{t('chart.range')}</span>
        {RANGE_INFO.map((r) => (
          <button
            key={r.id}
            type="button"
            data-range={r.id}
            className={`tf-btn${view.range === r.id ? ' active' : ''}`}
            aria-pressed={view.range === r.id}
            onClick={() => setRange(r.id)}
          >
            {r.label}
          </button>
        ))}
      </div>

      <div className="toolbar-group" data-group="interval" data-active={group === 'interval'} role="group" aria-label={t('chart.intervalGroup')}>
        <span className="lbl">{t('chart.interval')}</span>
        <button
          type="button"
          data-action="auto-interval"
          className={view.autoInterval ? 'active' : ''}
          aria-pressed={view.autoInterval}
          title={t('chart.autoTitle')}
          onClick={() => setAutoInterval(!view.autoInterval)}
        >
          {t('chart.auto')}
        </button>
        {INTERVAL_INFO.map((i) => (
          <button
            key={i.id}
            type="button"
            data-interval={i.id}
            className={`tf-btn${!view.autoInterval && view.interval === i.id ? ' active' : ''}`}
            aria-pressed={!view.autoInterval && view.interval === i.id}
            // Every button is a bare code (`1D`, `1M`); the hint explains, in the
            // user's language, what that granularity actually means.
            title={t(i.hintKey)}
            onClick={() => setInterval(i.id)}
          >
            {i.label}
          </button>
        ))}
      </div>

      <div className="toolbar-group" data-group="overlays" data-active={group === 'overlays'} role="group" aria-label={t('chart.overlayGroup')}>
        <span className="lbl">{t('chart.overlays')}</span>
        {overlayBtn('sma20', 'SMA 20', avail.sma20)}
        {overlayBtn('sma50', 'SMA 50', avail.sma50)}
        {overlayBtn('sma200', 'SMA 200', avail.sma200)}
        {overlayBtn('ema', 'EMA 12/26', avail.ema)}
        {overlayBtn('bb', 'Bollinger', avail.bb)}
      </div>

      <div className="toolbar-group" data-group="panes" data-active={group === 'panes'} role="group" aria-label={t('chart.paneGroup')}>
        <span className="lbl">{t('chart.panes')}</span>
        <button
          type="button"
          data-pane="volume"
          className={showVolume ? 'active' : ''}
          aria-pressed={showVolume}
          onClick={() => onTogglePane('volume')}
        >
          {t('chart.volume')}
        </button>
        <button
          type="button"
          data-pane="rsi"
          className={showRsi ? 'active' : ''}
          aria-pressed={showRsi}
          onClick={() => onTogglePane('rsi')}
        >
          {t('chart.rsi')}
        </button>
        <button
          type="button"
          data-pane="macd"
          className={showMacd ? 'active' : ''}
          aria-pressed={showMacd}
          onClick={() => onTogglePane('macd')}
        >
          {t('chart.macd')}
        </button>
      </div>

      <div className="toolbar-group" data-group="refresh">
        <button
          type="button"
          data-action="refresh"
          title={t('chart.refreshTitle')}
          onClick={() => void loadMarket({ force: true })}
        >
          <RefreshCw size={14} strokeWidth={2} aria-hidden="true" /> {t('common.refresh')}
        </button>
      </div>
      </div>
    </div>
  );
}
