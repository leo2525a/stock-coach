import { useState } from 'react';
import { useStore } from '../store';
import { useApiError, useT } from '../i18n';
import { formatHKT, humanAge } from '../../shared/format';

const NEWS_LIMIT = 6;

/**
 * News and updates for the selected symbol (SPEC-PHASE2 §F).
 *
 * Everything links to the publisher's original story: we show the provider's
 * headline, its publisher and its timestamp, and we never rewrite or
 * summarise a story ourselves. Stories the provider explicitly ties to this
 * symbol are marked "Mentions <SYMBOL>" so the user can tell a genuinely
 * company-specific item from a general market one.
 */
export function NewsPanel() {
  const t = useT();
  const symbol = useStore((s) => s.symbol);
  const news = useStore((s) => s.news);
  const load = useStore((s) => s.newsLoad);
  const loadNews = useStore((s) => s.loadNews);
  const errorText = useApiError(load.code, { symbol }, load.error ?? '');
  const [expanded, setExpanded] = useState(false);

  const items = news?.items ?? [];
  const shown = expanded ? items : items.slice(0, NEWS_LIMIT);

  const ageOf = (publishedAt: number | null): string | null => {
    if (publishedAt === null) return null;
    const seconds = Math.max(0, Math.floor(Date.now() / 1000) - publishedAt);
    return humanAge(seconds, t);
  };

  return (
    <section className="panel" data-testid="news-panel">
      <div className="spread">
        <h2 className="panel-title" style={{ margin: 0 }}>
          {t('dash.news.title', { symbol })}
        </h2>
        <div className="row">
          {news?.lastUpdated ? <span className="stamp">{t('dash.hero.asOf', { time: formatHKT(news.lastUpdated) })}</span> : null}
          <button type="button" className="tiny" onClick={() => void loadNews({ force: true })}>
            {t('common.refresh')}
          </button>
        </div>
      </div>

      {load.status === 'loading' && !news ? <p className="empty">{t('dash.news.loading')}</p> : null}

      {load.status === 'error' ? (
        <div className="error-box" style={{ marginTop: 8 }} data-testid="news-error">
          {t('dash.news.error', { symbol, error: errorText })}
        </div>
      ) : null}

      {news?.note ? <div className="warn-box">{t(news.note)}</div> : null}

      {news && items.length === 0 ? (
        <p className="empty" style={{ textAlign: 'left' }}>
          {t('dash.news.empty', { symbol })}
        </p>
      ) : null}

      {shown.length > 0 ? (
        <ul className="news-list" data-testid="news-list">
          {shown.map((item) => (
            <li className="news-item" key={item.id} data-testid={`news-${item.id}`}>
              <a className="news-title" href={item.link} target="_blank" rel="noopener noreferrer">
                {item.title}
              </a>
              <div className="news-meta">
                <span>{item.publisher || t('dash.news.publisherUnknown')}</span>
                {ageOf(item.publishedAt) ? <span>· {t('src.updated', { age: ageOf(item.publishedAt) ?? '' })}</span> : null}
                {item.mentionsSymbol ? (
                  <span className="badge badge-live" data-testid="news-relevant">
                    {t('dash.news.relevant', { symbol })}
                  </span>
                ) : item.relatedTickers.length > 0 ? (
                  <span className="badge badge-dim">{t('dash.news.related', { tickers: item.relatedTickers.join(', ') })}</span>
                ) : null}
                <a className="news-open" href={item.link} target="_blank" rel="noopener noreferrer">
                  {t('dash.news.open')}
                </a>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {items.length > NEWS_LIMIT ? (
        <button type="button" className="tiny" style={{ marginTop: 8 }} onClick={() => setExpanded((v) => !v)}>
          {expanded ? t('common.less') : `${t('common.more')} (${items.length - NEWS_LIMIT})`}
        </button>
      ) : null}

      <p className="tiny muted" style={{ marginTop: 10, marginBottom: 0 }}>
        {t('dash.news.sourceNote')}
      </p>
    </section>
  );
}
