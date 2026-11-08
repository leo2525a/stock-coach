import { useStore } from '../store';
import { useT } from '../i18n';
import { formatPercent, formatPrice } from '../../shared/format';
import { dirClassOrFlat } from '../dirClass';
import type { SymbolMeta } from '../../shared/types';

// `SourceBadge` used to live here; it is now in `Controls.tsx` alongside the
// other shared widgets. Re-exported so existing `from './TopBar'` imports keep
// working without a sweep.
export { SourceBadge } from './Controls';

/**
 * The headline row: which symbol is selected and its live number.
 *
 * Owner (38/100): this used to be a full-width `header.topbar` carrying the
 * brand and every global control. That bar is gone — the brand and controls
 * moved into the sidebar, and this is now a slim row at the top of the main
 * column, so nothing is pinned across the whole screen.
 */
export function TopBar() {
  const t = useT();
  const symbol = useStore((s) => s.symbol);
  const meta = useStore((s) => s.signals?.meta ?? s.market?.meta ?? null);
  const quote = useStore((s) => s.quotes.find((q) => q.symbol === s.symbol) ?? null);
  const marketSource = useStore((s) => s.market?.source ?? null);

  // N1: the badge must warn wherever a stale number is shown, not only on the
  // chart. Track which source actually supplies the headline price.
  const staleSeries = marketSource === 'stale-cache';

  const effective: SymbolMeta | null = meta;
  const last = effective?.lastPrice ?? quote?.lastPrice ?? null;
  const change = effective?.change ?? quote?.change ?? null;
  const changePercent = effective?.changePercent ?? quote?.changePercent ?? null;

  const quoteIsCurrent = quote !== null && !quote.stale;
  const fromStaleSeries = last !== null && (effective !== null ? staleSeries : !quoteIsCurrent);

  const dir = dirClassOrFlat(changePercent);

  return (
    <div className="head-row">
      <div className="symbol-head" data-testid="topbar-symbol">
        <span className="sym">{symbol}</span>
        <span className="sym-name hidden-mobile">{effective?.name ?? ''}</span>
      </div>

      <div className={`price-block${fromStaleSeries ? ' is-stale' : ''}`} data-testid="topbar-price">
        <span className={`last ${dir}`}>{formatPrice(last, effective?.currency)}</span>
        {change !== null ? (
          <span className={dir}>
            {change >= 0 ? '+' : ''}
            {formatPrice(change)}
          </span>
        ) : null}
        {changePercent !== null ? <span className={dir}>{formatPercent(changePercent)}</span> : null}
        {fromStaleSeries ? (
          <span className="badge badge-stale" data-testid="topbar-stale" title={t('topbar.staleTitle')}>
            {t('topbar.stale')}
          </span>
        ) : null}
      </div>
    </div>
  );
}
