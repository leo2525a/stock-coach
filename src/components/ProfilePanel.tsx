import { useStore } from '../store';
import { useApiError, useLang, useT } from '../i18n';
import { countryLabel, sectorLabel, industryLabel } from '../../shared/i18n/terminology';
import { formatHKT } from '../../shared/format';

/**
 * The company profile: what this business actually does, in the provider's own
 * words (never our paraphrase), plus the identifying facts.
 *
 * ETFs and many non-US listings have no profile — the panel says so plainly
 * rather than rendering an empty shell.
 */
export function ProfilePanel() {
  const t = useT();
  const lang = useLang();
  const symbol = useStore((s) => s.symbol);
  const payload = useStore((s) => s.fundamentals);
  const load = useStore((s) => s.fundamentalsLoad);
  const errorText = useApiError(load.code, { symbol }, load.error ?? '');
  const profile = payload?.profile ?? null;

  return (
    <section className="panel" data-testid="profile-panel">
      <div className="spread">
        <h2 className="panel-title" style={{ margin: 0 }}>
          {t('dash.profile.title', { symbol })}
        </h2>
        <span className="stamp">{t('dash.hero.asOf', { time: formatHKT(payload?.lastUpdated ?? null) })}</span>
      </div>

      {load.status === 'loading' && !payload ? (
        <p className="empty">{t('dash.profile.loading')}</p>
      ) : !profile ? (
        <p className="empty" style={{ textAlign: 'left' }}>
          {load.status === 'error' && errorText ? errorText : t('dash.profile.noSummary')}
        </p>
      ) : (
        <>
          <dl className="kv">
            {profile.sector ? (
              <div className="kv-row">
                <dt>{t('dash.profile.sector')}</dt>
                <dd>{sectorLabel(profile.sector, lang)}</dd>
              </div>
            ) : null}
            {profile.industry ? (
              <div className="kv-row">
                <dt>{t('dash.profile.industry')}</dt>
                <dd>{industryLabel(profile.industry, lang)}</dd>
              </div>
            ) : null}
            {profile.country ? (
              <div className="kv-row">
                <dt>{t('dash.profile.country')}</dt>
                <dd>{countryLabel(profile.country, lang)}</dd>
              </div>
            ) : null}
            {profile.fullTimeEmployees !== null ? (
              <div className="kv-row">
                <dt>{t('dash.profile.employees')}</dt>
                <dd>{profile.fullTimeEmployees.toLocaleString('en-US')}</dd>
              </div>
            ) : null}
            {profile.website ? (
              <div className="kv-row">
                <dt>{t('dash.profile.website')}</dt>
                <dd>
                  <a href={profile.website} target="_blank" rel="noopener noreferrer">
                    {t('dash.profile.websiteLink')}
                  </a>
                </dd>
              </div>
            ) : null}
          </dl>

          {profile.summary ? (
            <p className="panel-note" style={{ marginTop: 10, marginBottom: 0 }} data-testid="profile-summary">
              {profile.summary}
            </p>
          ) : (
            <p className="tiny muted" style={{ marginTop: 10, marginBottom: 0 }}>
              {t('dash.profile.noSummary')}
            </p>
          )}
        </>
      )}
    </section>
  );
}
