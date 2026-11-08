import { useStore } from '../store';
import { dirClassOrFlat } from './Sidebar';
import { useT } from '../i18n';
import { formatPercent, formatPrice } from '../../shared/format';
import { useRevealSymbol } from './useRevealSymbol';

const MOVER_LIMIT = 6;

/** A grid of the watchlist's biggest movers — the Futu/牛牛-style glance strip. */
export function MoverStrip() {
  const t = useT();
  const quotes = useStore((s) => s.quotes);
  const symbol = useStore((s) => s.symbol);
  const revealSymbol = useRevealSymbol();

  const sorted = [...quotes]
    .filter((q) => q.changePercent !== null && Number.isFinite(q.changePercent))
    .sort((a, b) => Math.abs(b.changePercent ?? 0) - Math.abs(a.changePercent ?? 0))
    .slice(0, MOVER_LIMIT);

  if (sorted.length === 0) {
    return <p className="empty">{t('dash.movers.empty')}</p>;
  }

  return (
    <div className="movers" data-testid="mover-strip">
      {sorted.map((q) => {
        const pct = q.changePercent ?? null;
        const cls = dirClassOrFlat(pct);
        const tone = pct === null ? 'flat' : pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat';
        const isCurrent = q.symbol === symbol;
        return (
          // N2: the tile itself is NOT a button. Clicking a mover must not slide
          // the headline ticker/price away from the chart the user is looking at
          // — that made the strip and the hero disagree. Selecting a different
          // symbol is an explicit action on the small "chart ↗" control.
          <div
            key={q.symbol}
            className={`mover ${tone}${isCurrent ? ' selected' : ''}`}
            data-testid={`mover-${q.symbol}`}
            data-symbol={q.symbol}
            title={q.name}
          >
            <span className="m-sym">{q.symbol}</span>
            <span className={cls}>{formatPercent(pct)}</span>
            <span className="tiny muted">{formatPrice(q.lastPrice, q.currency)}</span>
            {q.stale ? (
              <span className="badge badge-stale m-stale" data-testid={`mover-stale-${q.symbol}`} title={t('src.staleTitle')}>
                {t('topbar.stale')}
              </span>
            ) : null}
            {isCurrent ? (
              <span className="m-current tiny muted" aria-hidden="true">
                {t('mover.onChart')}
              </span>
            ) : (
              <button
                type="button"
                className="m-open"
                title={t('mover.openTitle', { symbol: q.symbol })}
                aria-label={t('mover.openLabel', { symbol: q.symbol })}
                onClick={() => revealSymbol(q.symbol)}
              >
                {t('mover.openLabel', { symbol: q.symbol })}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
