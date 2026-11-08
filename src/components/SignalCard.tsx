import { useT } from '../i18n';
import type { SignalPayloadItem } from '../../shared/types';

/** Human word for a signal's state. Kept exported — the tests use it. */
export function stateWord(state: SignalPayloadItem['state']): string {
  if (state === 'bullish') return 'Bullish';
  if (state === 'bearish') return 'Bearish';
  return 'Neutral';
}

/**
 * One signal, explained the way a beginner needs it:
 * what it is → what it means right now → what to watch → the raw numbers.
 *
 * Every string here comes from a signal's i18n payload, so switching the
 * language re-renders the whole card without the underlying analysis changing.
 */
export function SignalCard({ signal }: { signal: SignalPayloadItem }) {
  const t = useT();
  const evidence = signal.evidenceI18n ?? [];
  // The engine publishes the rule id + which branch fired; the dictionary maps
  // that pair onto a title and a meaning sentence in the active language.
  const titleKey = `sig.${signal.id}.title.${signal.variant}`;
  const meaningKey = `sig.${signal.id}.meaning.${signal.variant}`;

  return (
    <article className={`signal-card ${signal.state}`} data-testid={`signal-${signal.id}`}>
      <div className="signal-head">
        <h3 className="signal-label">{t(titleKey)}</h3>
        <span className={`state-pill ${signal.state}`}>{t(`signal.state.${signal.state}`)}</span>
      </div>

      <div className="strength" title={t('signal.strengthTitle')}>
        <div className="strength-bar">
          <div className={`strength-fill ${signal.state}`} style={{ width: `${Math.max(0, Math.min(100, signal.strength))}%` }} />
        </div>
        <span className="strength-num">{t('signal.strength', { value: Math.round(signal.strength) })}</span>
      </div>

      <div>
        <span className="field-label">{t('signal.whatThisIs')}</span>
        <p className="signal-what">{t(`sig.${signal.id}.what`)}</p>
      </div>

      <div>
        <span className="field-label">{t('signal.whatItMeans')}</span>
        <p className="signal-meaning">{t(meaningKey)}</p>
      </div>

      <div>
        <span className="field-label">{t('signal.whatToWatch')}</span>
        <p className="signal-watch">{t(`sig.${signal.id}.watch`)}</p>
      </div>

      {evidence.length > 0 ? (
        <details className="evidence-toggle">
          <summary>{t('signal.evidence', { count: evidence.length })}</summary>
          <ul className="evidence">
            {evidence.map((line, i) => (
              <li key={i}>{t(line.key, line.params)}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </article>
  );
}
