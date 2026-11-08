import { useStore } from '../store';
import { useLang, useT } from '../i18n';
import { recommendationLabel } from '../../shared/i18n/terminology';
import { formatCompact, formatNumber, formatPrice } from '../../shared/format';
import { formatHKT } from '../../shared/format';
import { dirClass } from '../dirClass';
import type { KeyStats } from '../../shared/types';

/** A stat row that is either a real number or an honest "not published". */
function Stat({ label, value, dirValue }: { label: string; value: string | null; dirValue?: number | null }) {
  const t = useT();
  // `dirValue` is the *raw* number behind the text, so the colour is decided by
  // the same rule as everywhere else; without it the row is left uncoloured.
  const cls = dirValue === undefined ? '' : dirClass(dirValue);
  return (
    <div className="stat">
      <span className="k">{label}</span>
      {value !== null ? (
        <span className={`v${cls ? ` ${cls}` : ''}`}>{value}</span>
      ) : (
        <span className="v muted" title={t('dash.stats.notPublished', { label })}>
          {t('common.noData')}
        </span>
      )}
    </div>
  );
}

/** The fraction → percent, with the provider's own convention (0.0031 = 0.31%). */
const asPercent = (v: number | null): string | null => (v === null ? null : `${(v * 100).toFixed(2)}%`);

/**
 * Key numbers for the selected symbol.
 *
 * Price-derived figures (day high/low, previous close, 52-week ends, volume)
 * come from the live quote so they are correct even for instruments whose
 * fundamentals the provider does not publish. Valuation ratios come from
 * `quoteSummary`; when a ratio is absent we print "—", never 0.
 */
export function KeyStatsPanel() {
  const t = useT();
  const market = useStore((s) => s.market);
  const fundamentals = useStore((s) => s.fundamentals);
  const load = useStore((s) => s.fundamentalsLoad);
  const symbol = useStore((s) => s.symbol);

  const meta = market?.meta ?? null;
  const lastCandle = market?.candles.at(-1) ?? null;
  const stats: KeyStats | null = fundamentals?.keyStats ?? null;
  const currency = fundamentals?.currency ?? meta?.currency;

  // Live quote values win for price-like fields; the fundamentals block fills
  // the valuation ratios the quote endpoint does not carry.
  const rows: Array<{ k: string; v: string | null }> = [
    { k: t('dash.stats.open'), v: formatPrice(lastCandle?.open ?? meta?.lastPrice ?? null, currency) },
    { k: t('dash.stats.dayHigh'), v: formatPrice(meta?.dayHigh ?? stats?.dayHigh ?? null, currency) },
    { k: t('dash.stats.dayLow'), v: formatPrice(meta?.dayLow ?? stats?.dayLow ?? null, currency) },
    { k: t('dash.stats.prevClose'), v: formatPrice(meta?.previousClose ?? stats?.previousClose ?? null, currency) },
    { k: t('dash.stats.w52High'), v: formatPrice(meta?.fiftyTwoWeekHigh ?? stats?.fiftyTwoWeekHigh ?? null, currency) },
    { k: t('dash.stats.w52Low'), v: formatPrice(meta?.fiftyTwoWeekLow ?? stats?.fiftyTwoWeekLow ?? null, currency) },
    { k: t('dash.stats.volume'), v: formatCompact(meta?.volume ?? stats?.volume ?? null) },
    { k: t('dash.stats.marketCap'), v: stats?.marketCap !== null && stats?.marketCap !== undefined ? formatCompact(stats.marketCap) : null },
    { k: t('dash.stats.trailingPE'), v: stats?.trailingPE !== null && stats?.trailingPE !== undefined ? formatNumber(stats.trailingPE, 2) : null },
    { k: t('dash.stats.forwardPE'), v: stats?.forwardPE !== null && stats?.forwardPE !== undefined ? stats.forwardPE.toFixed(2) : null },
    { k: t('dash.stats.dividendYield'), v: asPercent(stats?.dividendYield ?? null) },
    { k: t('dash.stats.beta'), v: stats?.beta !== null && stats?.beta !== undefined ? stats.beta.toFixed(2) : null },
    { k: t('dash.stats.priceToBook'), v: stats?.priceToBook !== null && stats?.priceToBook !== undefined ? stats.priceToBook.toFixed(2) : null },
    { k: t('dash.stats.trailingEps'), v: stats?.trailingEps !== null && stats?.trailingEps !== undefined ? stats.trailingEps.toFixed(2) : null },
    { k: t('dash.stats.avgVolume'), v: formatCompact(stats?.averageVolume ?? null) },
  ];

  const showNoFundamentals = load.status === 'ready' && fundamentals !== null && stats === null;

  return (
    <section className="panel" data-testid="key-stats-panel">
      <div className="spread">
        <h2 className="panel-title" style={{ margin: 0 }}>
          {t('dash.stats.title', { symbol })}
        </h2>
        <span className="stamp">{t('dash.hero.asOf', { time: formatHKT(market?.lastUpdated ?? null) })}</span>
      </div>

      <div className="stats-grid" style={{ marginTop: 10 }} data-testid="stats-grid">
        {rows.map((row) => (
          <Stat key={row.k} label={row.k} value={row.v} />
        ))}
      </div>

      {load.status === 'loading' && !fundamentals ? <p className="tiny muted">{t('dash.stats.loading')}</p> : null}
      {showNoFundamentals ? <p className="warn-box" style={{ marginTop: 10 }}>{t('dash.stats.none')}</p> : null}
      {fundamentals?.note ? <p className="tiny muted">{t(fundamentals.note)}</p> : null}
    </section>
  );
}

/**
 * Quality + analyst view.
 *
 * Split out from `KeyStatsPanel` because these are *opinions and ratios*, and
 * the panel says so — the analyst block must never read as our advice
 * (SPEC-PHASE2 §E).
 */
export function HealthPanel() {
  const t = useT();
  const lang = useLang();
  const health = useStore((s) => s.fundamentals?.health ?? null);
  const load = useStore((s) => s.fundamentalsLoad);
  const currency = useStore((s) => s.fundamentals?.currency ?? s.market?.meta?.currency ?? undefined);

  const hasAnything =
    health !== null &&
    Object.values(health).some((v) => v !== null && v !== undefined);

  if (load.status === 'loading' && !hasAnything) {
    return (
      <section className="panel" data-testid="health-panel">
        <h2 className="panel-title">{t('dash.health.title')}</h2>
        <p className="empty">{t('dash.stats.loading')}</p>
      </section>
    );
  }

  if (!hasAnything) {
    return (
      <section className="panel" data-testid="health-panel">
        <h2 className="panel-title">{t('dash.health.title')}</h2>
        <p className="empty" style={{ textAlign: 'left' }}>
          {t('dash.stats.none')}
        </p>
      </section>
    );
  }

  // Only the growth figure is directional; the margin/return levels are plain
  // ratios and keep the default tone, so colour still *means* something.
  const rows: Array<{ k: string; v: string | null; dirValue?: number | null }> = [
    { k: t('dash.health.profitMargins'), v: asPercent(health.profitMargins) },
    { k: t('dash.health.operatingMargins'), v: asPercent(health.operatingMargins) },
    { k: t('dash.health.returnOnEquity'), v: asPercent(health.returnOnEquity) },
    { k: t('dash.health.returnOnAssets'), v: asPercent(health.returnOnAssets) },
    { k: t('dash.health.revenueGrowth'), v: asPercent(health.revenueGrowth), dirValue: health.revenueGrowth },
    { k: t('dash.health.recommendation'), v: recommendationLabel(health.recommendationKey, lang) },
    { k: t('dash.health.targetMean'), v: health.targetMeanPrice !== null ? formatPrice(health.targetMeanPrice, currency) : null },
    {
      k: t('dash.health.targetRange'),
      v:
        health.targetLowPrice !== null && health.targetHighPrice !== null
          ? `${formatPrice(health.targetLowPrice)} – ${formatPrice(health.targetHighPrice)}`
          : null,
    },
    { k: t('dash.health.analysts'), v: health.numberOfAnalystOpinions !== null ? String(health.numberOfAnalystOpinions) : null },
  ];

  return (
    <section className="panel" data-testid="health-panel">
      <h2 className="panel-title">{t('dash.health.title')}</h2>
      <div className="stats-grid" data-testid="health-grid">
        {rows.map((row) => (
          <Stat key={row.k} label={row.k} value={row.v} dirValue={row.dirValue} />
        ))}
      </div>
      <p className="tiny muted" style={{ marginBottom: 0 }}>
        {t('dash.health.opinionNote')}
      </p>
    </section>
  );
}
