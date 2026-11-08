import { useState } from 'react';
import { useStore } from '../store';
import { useT } from '../i18n';
import { LANGS, LANG_LABELS } from '../../shared/i18n';
import { humanAge } from '../../shared/format';

/**
 * Small, self-contained controls shared by the two homes the app has for them.
 *
 * Owner (38/100): the logo bar carried a pile of controls and, on a phone, it
 * pushed the numbers around. The fix is to render the *same* controls in the
 * sidebar drawer on narrow screens and keep the bar to a single row on desktop,
 * so there is one implementation of each control, not two drifting copies.
 *
 * This module owns no layout; each control is a bare widget the caller places.
 */

/** Day/night switch. The current mode is the aria-label *and* the data attribute. */
export function ThemeToggle() {
  const t = useT();
  const theme = useStore((s) => s.theme);
  const toggleTheme = useStore((s) => s.toggleTheme);
  return (
    <button
      type="button"
      className="icon-btn theme-toggle"
      data-testid="theme-toggle"
      data-theme-current={theme}
      aria-label={t(theme === 'dark' ? 'theme.dark' : 'theme.light')}
      aria-pressed={theme === 'light'}
      title={t('theme.toggleTitle')}
      onClick={toggleTheme}
    >
      <span aria-hidden="true">{theme === 'dark' ? '☾' : '☀'}</span>
    </button>
  );
}

/** Language switch: one button per shipped locale (中 / EN). */
export function LangSwitch() {
  const t = useT();
  const lang = useStore((s) => s.lang);
  const setLang = useStore((s) => s.setLang);
  return (
    <div className="lang-switch" role="group" aria-label={t('topbar.language')} data-testid="lang-switch">
      {LANGS.map((code) => (
        <button
          key={code}
          type="button"
          className={lang === code ? 'active' : ''}
          aria-pressed={lang === code}
          title={t('topbar.languageTitle')}
          data-lang={code}
          onClick={() => setLang(code)}
        >
          {LANG_LABELS[code]}
        </button>
      ))}
    </div>
  );
}

/**
 * Refresh-everything button. Owns its own busy flag so the two call sites do not
 * need to thread state through the layout.
 */
export function RefreshButton() {
  const t = useT();
  const refreshAll = useStore((s) => s.refreshAll);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      await refreshAll();
    } finally {
      setBusy(false);
    }
  };
  return (
    <button
      type="button"
      className="refresh-btn icon-btn-wide"
      data-testid="refresh-btn"
      onClick={() => void run()}
      disabled={busy}
      title={t('topbar.refreshTitle')}
    >
      {busy ? t('common.refreshing') : `⟳ ${t('common.refresh')}`}
    </button>
  );
}

/**
 * A small pill that explains where the numbers came from.
 *
 * Lived in TopBar until the phone layout moved the bar's contents; it is used
 * by three screens, so it belongs in this shared module.
 */
export function SourceBadge({
  source,
  stale,
  lastUpdated,
}: {
  source: string | undefined;
  stale: boolean;
  lastUpdated: number | null;
}) {
  const t = useT();
  if (!source) return null;
  const age =
    lastUpdated === null ? null : humanAge(Math.max(0, Math.floor(Date.now() / 1000) - lastUpdated), t);
  const label =
    source === 'live'
      ? t('src.live')
      : source === 'cache'
        ? t('src.cache')
        : source === 'stale-cache'
          ? t('src.stale')
          : source === 'unavailable'
            ? t('common.unknown')
            : source;
  const cls = source === 'live' ? 'badge-live' : source === 'cache' ? 'badge-cache' : 'badge-stale';
  // The visible text already says the age, so the `title` carries only the
  // explanation — otherwise a screen reader reads the age twice.
  const hint = age ? t('src.updatedHint') : source === 'stale-cache' ? t('src.staleTitle') : undefined;
  return (
    <span className={`badge ${cls}`} title={hint} data-testid="source-badge">
      {label}
      {age ? ` · ${age}` : ''}
      {stale ? ' ⚠' : ''}
    </span>
  );
}
