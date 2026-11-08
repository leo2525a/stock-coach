import { useStore } from '../store';
import { SignalCard } from './SignalCard';
import { SourceBadge } from './Controls';
import { useApiError, useT } from '../i18n';
import { formatHKT, formatCompact } from '../../shared/format';

/**
 * The verdict banner + every rule, each explained in the current language.
 *
 * The colours come from `summary.verdictVariant` (a stable enum) rather than
 * from parsing the English `verdict` sentence, so translating the app can never
 * accidentally change which colour the user sees.
 */
export function SignalsScreen() {
  const t = useT();
  const signals = useStore((s) => s.signals);
  const load = useStore((s) => s.signalsLoad);
  const symbol = useStore((s) => s.symbol);
  const loadSignals = useStore((s) => s.loadSignals);
  const errorText = useApiError(load.code, { symbol }, load.error ?? '');
  const screen = useStore((s) => s.screen);
  const setScreen = useStore((s) => s.setScreen);

  if (load.status === 'loading' && !signals) {
    return <p className="empty">{t('signals.loading', { symbol })}</p>;
  }

  if (load.status === 'error') {
    return (
      <div className="error-box" data-testid="signals-error">
        {t('signals.error', { symbol, error: errorText })}
        <div className="row" style={{ marginTop: 8 }}>
          <button type="button" onClick={() => void loadSignals()}>
            {t('common.tryAgain')}
          </button>
        </div>
      </div>
    );
  }

  if (!signals) {
    return <p className="empty">{t('signals.empty')}</p>;
  }

  const { summary } = signals;
  const tone = summary.verdictVariant === 'bullish' ? 'bullish' : summary.verdictVariant === 'bearish' ? 'bearish' : 'neutral';

  return (
    <div className="stack" data-testid="signals-screen">
      <section className={`summary-banner ${tone}`} data-testid="summary-banner">
        <div>
          <div className="summary-verdict" data-testid="summary-verdict">
            {t('signals.score', { verdict: t(`signals.verdict.${summary.verdictVariant}`), score: summary.score })}
          </div>
          <div className="tiny muted">{t(`signals.sentence.${summary.verdictVariant}`)}</div>
        </div>
        <div className="summary-tally">
          <span>
            <i className="tally-dot bullish" />
            {t('signals.tally.bullish', { count: summary.bullish })}
          </span>
          <span>
            <i className="tally-dot bearish" />
            {t('signals.tally.bearish', { count: summary.bearish })}
          </span>
          <span>
            <i className="tally-dot neutral" />
            {t('signals.tally.neutral', { count: summary.neutral })}
          </span>
        </div>
        <div className="topbar-spacer" />
        <SourceBadge source={signals.source} stale={signals.source === 'stale-cache'} lastUpdated={signals.lastUpdated} />
        <span className="stamp">
          {t('signals.scored', { count: formatCompact(signals.candleCount), time: formatHKT(signals.lastUpdated) })}
        </span>
        <button type="button" onClick={() => void loadSignals({ force: true })}>
          {t('signals.rescore')}
        </button>
      </section>

      {signals.note ? <div className="warn-box">{t(signals.note)}</div> : null}

      <div className="row">
        <span className="tiny muted">
          {t('signals.scoredOn', {
            symbol: signals.symbol,
            range: signals.range,
            interval: signals.interval,
          })}
        </span>
        <button type="button" className="tiny" onClick={() => setScreen('chart')} disabled={screen === 'chart'}>
          {t('signals.openChart')}
        </button>
      </div>

      <div className="signal-grid">
        {signals.signals.map((s) => (
          <SignalCard key={s.id} signal={s} />
        ))}
      </div>

      <div className="panel">
        <h3 className="panel-title">{t('signals.howto.title')}</h3>
        <ul className="help" style={{ background: 'transparent', border: 0, padding: 0 }}>
          <li>{t('signals.howto.state')}</li>
          <li>{t('signals.howto.strength')}</li>
          <li>{t('signals.disclaimer')}</li>
        </ul>
      </div>
    </div>
  );
}
