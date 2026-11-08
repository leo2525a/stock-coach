import { useStore } from '../store';
import { useLang, useT } from '../i18n';
import { countryLabel, exchangeLabel, quoteTypeLabel, sectorLabel, industryLabel } from '../../shared/i18n/terminology';

/**
 * How the instrument is classified (SPEC-PHASE2 §C).
 *
 * This is the visible face of the categorisation layer: the same data that
 * groups the watchlist, shown for the selected symbol. When the provider does
 * not publish a field we print the "Unknown" bucket — we never infer a sector
 * from the ticker.
 */
export function CategoryPanel() {
  const t = useT();
  const lang = useLang();
  const symbol = useStore((s) => s.symbol);
  const categories = useStore((s) => s.categories);
  const categoriesLoad = useStore((s) => s.categoriesLoad);

  const category = categories[symbol] ?? null;

  const rows: Array<{ k: string; v: string }> = [
    { k: t('dash.cat.type'), v: category ? t(`cat.type.${category.type}`) : t('cat.unknown') },
    {
      k: t('dash.cat.sector'),
      v: category?.sector ? sectorLabel(category.sector, lang) : t('cat.unknown'),
    },
    {
      k: t('dash.cat.industry'),
      v: category?.industry ? industryLabel(category.industry, lang) : t('cat.unknown'),
    },
    {
      k: t('dash.cat.exchange'),
      v: category?.exchange ? exchangeLabel(category.exchange, lang) : t('cat.unknown'),
    },
    { k: t('dash.cat.country'), v: category?.country ? countryLabel(category.country, lang) : t('cat.unknown') },
  ];

  return (
    <section className="panel" data-testid="category-panel">
      <div className="spread">
        <h2 className="panel-title" style={{ margin: 0 }}>
          {t('dash.cat.title')}
        </h2>
        {category?.quoteType ? (
          <span className="badge badge-dim" title={category.quoteType}>
            {quoteTypeLabel(category.quoteType, lang)}
          </span>
        ) : null}
      </div>

      {categoriesLoad.status === 'loading' && !category ? (
        <p className="empty">{t('common.loadingSection')}</p>
      ) : (
        <>
          <dl className="kv" style={{ marginTop: 6 }} data-testid="category-rows">
            {rows.map((row) => (
              <div className="kv-row" key={row.k}>
                <dt>{row.k}</dt>
                <dd>{row.v}</dd>
              </div>
            ))}
          </dl>
          <p className="tiny muted" style={{ marginTop: 10, marginBottom: 0 }}>
            {t('dash.cat.note')}
          </p>
        </>
      )}
    </section>
  );
}
