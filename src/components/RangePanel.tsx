import { useStore } from '../store';
import { useT } from '../i18n';
import { formatPrice } from '../../shared/format';

/**
 * Where today's price sits inside the 52-week range.
 *
 * This is the one panel that draws a picture rather than a table: a bar with
 * the low at 0% and the high at 100%, and a marker at the current price. It is
 * the fastest way to answer "is this expensive or cheap versus its own year?".
 *
 * If the provider did not supply *both* ends we say so and draw nothing —
 * half a range would imply a position we cannot actually compute.
 */
export function RangePanel() {
  const t = useT();
  const market = useStore((s) => s.market);
  const fundamentals = useStore((s) => s.fundamentals);

  const meta = market?.meta ?? null;
  const stats = fundamentals?.keyStats ?? null;
  const currency = fundamentals?.currency ?? meta?.currency;

  const low = meta?.fiftyTwoWeekLow ?? stats?.fiftyTwoWeekLow ?? null;
  const high = meta?.fiftyTwoWeekHigh ?? stats?.fiftyTwoWeekHigh ?? null;
  const now = meta?.lastPrice ?? market?.candles.at(-1)?.close ?? null;

  const known = low !== null && high !== null && high > low;
  const pct = known && now !== null ? Math.max(0, Math.min(100, ((now - low) / (high - low)) * 100)) : null;

  return (
    <section className="panel" data-testid="range-panel">
      <h2 className="panel-title">{t('dash.range.title')}</h2>

      {!known || pct === null ? (
        <p className="empty" style={{ textAlign: 'left' }}>
          {t('dash.range.unknown')}
        </p>
      ) : (
        <>
          <div className="range-bar" data-testid="range-bar">
            <div className="range-fill" style={{ width: `${pct}%` }} />
            <div className="range-marker" style={{ left: `${pct}%` }} data-testid="range-marker" />
          </div>
          <div className="range-ends">
            <span>
              {t('dash.range.low')} <b>{formatPrice(low, currency)}</b>
            </span>
            <span>
              {t('dash.range.now')} <b>{formatPrice(now, currency)}</b>
            </span>
            <span>
              {t('dash.range.high')} <b>{formatPrice(high, currency)}</b>
            </span>
          </div>
          <p className="tiny muted" style={{ marginTop: 8, marginBottom: 0 }}>
            {t('dash.range.position', { value: pct.toFixed(1) })}
          </p>
        </>
      )}
    </section>
  );
}
