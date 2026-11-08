import { useStore } from '../store';
import { useT } from '../i18n';
import type { Screen } from '../store';

/** Glossary entries, in the order a beginner meets them. */
const GLOSSARY_TERMS = [
  'symbol',
  'candle',
  'ohlc',
  'volume',
  'interval',
  'trend',
  'support',
  'bullish',
  'snapshot',
  'sector',
  'exchange',
] as const;

const INDICATOR_TERMS = ['sma', 'ema', 'rsi', 'macd', 'bb', 'atr', 'cross', 'squeeze', 'strength'] as const;

const SCREEN_IDS: Array<{ id: Screen; key: string }> = [
  { id: 'dashboard', key: 'help.screens.dashboard' },
  { id: 'chart', key: 'help.screens.chart' },
  { id: 'signals', key: 'help.screens.signals' },
  { id: 'watchlist', key: 'help.screens.watchlist' },
  { id: 'help', key: 'help.screens.help' },
];

/**
 * The Help screen: what to do first, what each screen is for, a beginner
 * glossary, what the indicators mean, and — importantly — the limits of the
 * data and a plain statement that this is not advice.
 *
 * All content comes from the dictionary, so the whole page translates.
 */
export function HelpScreen() {
  const t = useT();
  const setScreen = useStore((s) => s.setScreen);
  const symbol = useStore((s) => s.symbol);

  return (
    <div className="stack" data-testid="help-screen">
      <section className="help">
        <h3>{t('help.readFirst.title')}</h3>
        <p className="tiny" style={{ margin: 0 }}>
          {t('help.readFirst.body')}
        </p>
      </section>

      <section className="panel">
        <h2 className="panel-title">{t('help.fiveMin.title')}</h2>
        <ol className="help-list" style={{ margin: 0, paddingLeft: 18 }}>
          <li>{t('help.fiveMin.1', { symbol })}</li>
          <li>{t('help.fiveMin.2')}</li>
          <li>{t('help.fiveMin.3')}</li>
          <li>{t('help.fiveMin.4')}</li>
          <li>{t('help.fiveMin.5')}</li>
        </ol>
      </section>

      <section className="panel">
        <h2 className="panel-title">{t('help.screens.title')}</h2>
        <dl className="glossary">
          {SCREEN_IDS.map((s) => (
            <div key={s.id} className="glossary-row">
              <dt>{t(`nav.${s.id}`)}</dt>
              <dd>{t(s.key)}</dd>
            </div>
          ))}
        </dl>
        <div className="row" style={{ marginTop: 10 }}>
          <button type="button" onClick={() => setScreen('chart')}>
            {t('common.openChart')}
          </button>
          <button type="button" onClick={() => setScreen('signals')}>
            {t('common.seeAllSignals')}
          </button>
        </div>
      </section>

      <section className="panel">
        <h2 className="panel-title">{t('help.glossary.title')}</h2>
        <dl className="glossary" data-testid="glossary">
          {GLOSSARY_TERMS.map((term) => (
            <div key={term} className="glossary-row">
              <dt>{t(`glossary.${term}.term`)}</dt>
              <dd>{t(`glossary.${term}.plain`)}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="panel">
        <h2 className="panel-title">{t('help.indicators.title')}</h2>
        <dl className="glossary">
          {INDICATOR_TERMS.map((term) => (
            <div key={term} className="glossary-row">
              <dt>{t(`ind.${term}.term`)}</dt>
              <dd>{t(`ind.${term}.plain`)}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="panel">
        <h2 className="panel-title">{t('help.data.title')}</h2>
        <ul className="help" style={{ background: 'transparent', border: 0, padding: 0 }}>
          <li>{t('help.data.1')}</li>
          <li>{t('help.data.2')}</li>
          <li>{t('help.data.3')}</li>
          <li>{t('help.data.4')}</li>
          <li>{t('help.data.5')}</li>
        </ul>
      </section>

      <section className="panel">
        <h2 className="panel-title">{t('help.language.title')}</h2>
        <p className="panel-note" style={{ marginBottom: 0 }}>
          {t('help.language.body')}
        </p>
      </section>

      <section className="panel">
        <h2 className="panel-title">{t('help.install.title')}</h2>
        <ul className="help" style={{ background: 'transparent', border: 0, padding: 0 }}>
          <li>{t('help.install.1')}</li>
          <li>{t('help.install.2')}</li>
          <li>{t('help.install.3')}</li>
        </ul>
      </section>

      <section className="panel">
        <h3 className="panel-title">{t('help.notAdvice.title')}</h3>
        <p className="panel-note" style={{ marginBottom: 0 }}>
          {t('help.notAdvice.body')}
        </p>
      </section>
    </div>
  );
}
