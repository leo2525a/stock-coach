import { useEffect, useState } from 'react';
import { useStore } from './store';
import { LangProvider, useT } from './i18n';
import { applyTheme } from './theme';
import { Sidebar } from './components/Sidebar';
import { DashboardScreen } from './components/DashboardScreen';
import { ChartScreen } from './components/ChartScreen';
import { SignalsScreen } from './components/SignalsScreen';
import { WatchlistScreen } from './components/WatchlistScreen';
import { HelpScreen } from './components/HelpScreen';
import { AnalystsScreen } from './analyst/AnalystsScreen';
import { DividendsScreen } from './dividend/DividendsScreen';
import * as api from './api';

/**
 * Owner (38/100) asked for three things, all structural:
 *
 *  1. "唔想要 logo 條 bar … button 全部擺哂入 sidebar" — the logo bar is gone.
 *     Brand, and the global controls, now live at the top of the sidebar; the
 *     headline symbol + price live on a compact chart row. There is nothing
 *     pinned across the top of the screen any more.
 *  2. "當收埋 sidebar 個陣直接收埋" — collapsing the sidebar (「«」, or the `c`
 *     shortcut, or the floating handle) takes the whole panel away in one move;
 *     a floating handle stays reachable to bring it straight back. No second
 *     press needed to "get back to the tab you were reading".
 *  3. "呢堆制好唔掂 … 加 slide animation" — the collapse now slides the panel
 *     off-canvas (`margin-left`), so the content reflows smoothly instead of the
 *     panel merely narrowing.
 *
 * `hideChrome` = "the sidebar is put away". It is separate from the mobile
 * `sidebarOpen` flag so the phone drawer and the desktop rail never fight.
 */

/** Shown when the API has never answered, so the user is not staring at a blank page. */
function BackendDown({ onRetry }: { onRetry: () => void }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const retry = async () => {
    setBusy(true);
    try {
      onRetry();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="main-col">
      <section className="error-box" data-testid="backend-down">
        <b>{t('app.backendDown.title')}</b>
        <p style={{ margin: '6px 0 0' }}>{t('app.backendDown.body', { server: 'npm run server', dev: 'npm run dev' })}</p>
        <button type="button" style={{ marginTop: 10 }} disabled={busy} onClick={() => void retry()}>
          {t('app.retry')}
        </button>
      </section>
    </div>
  );
}

/**
 * Keeps `<html lang>` in sync with the selected locale and applies the global
 * language to everything below — including the theme switching the storage keys
 * that Phase 1 wrote.
 */
function Shell() {
  const t = useT();
  const screen = useStore((s) => s.screen);
  const symbol = useStore((s) => s.symbol);
  const lang = useStore((s) => s.lang);
  const theme = useStore((s) => s.theme);
  const sidebarOpen = useStore((s) => s.sidebarOpen);
  const setSidebarOpen = useStore((s) => s.setSidebarOpen);
  const loadMarket = useStore((s) => s.loadMarket);
  const loadSignals = useStore((s) => s.loadSignals);
  const loadWatchlist = useStore((s) => s.loadWatchlist);
  const loadQuotes = useStore((s) => s.loadQuotes);
  const loadCategories = useStore((s) => s.loadCategories);
  const loadNews = useStore((s) => s.loadNews);
  const loadFundamentals = useStore((s) => s.loadFundamentals);
  const [apiUp, setApiUp] = useState<boolean | null>(null);
  // Owner (50/100): 「想主頁個 menu button 係用最隱密既方式 … 一禁先打開 顯示埋 logo」
  // — the panel starts put away on the main page; a discreet corner button opens
  // it (revealing the logo). Previously it started showing at desktop.
  const [hideChrome, setHideChrome] = useState(true);

  const bootstrap = async () => {
    const health = await api.getHealth();
    setApiUp(health.ok);
    if (!health.ok) return;
    await Promise.all([loadWatchlist(), loadQuotes()]);
    await Promise.all([loadMarket(), loadSignals(), loadNews(), loadFundamentals()]);
    await loadCategories();
  };

  useEffect(() => {
    try {
      document.documentElement.lang = lang;
      document.title = t('app.title');
    } catch {
      /* non-DOM */
    }
  }, [lang, t]);

  // Paint the resolved theme on mount and on every change. The store's
  // setThemeMode/toggleTheme already call applyTheme, but a *fresh boot* would
  // otherwise leave `<html data-theme>` at whatever the boot script guessed.
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // Paint the "chrome hidden" state one frame ahead of the slide so the FAB and
  // the main column's reclaimed width animate in step with the sidebar. The
  // class also drops the sidebar out of the accessibility tree while it is put
  // away (`visibility: hidden`, applied after the slide).
  useEffect(() => {
    const root = document.body;
    root.classList.toggle('chrome-hidden', hideChrome);
    return () => root.classList.remove('chrome-hidden');
  }, [hideChrome]);

  // Owner (50/100): the sidebar's own control must actually do something at
  // every width. On a desktop rail it puts the panel away in one move; inside
  // the mobile drawer the same control closes the drawer (previously it flipped
  // the desktop-only `chrome-hidden` flag, so on a phone it looked dead).
  const putSidebarAway = () => {
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 1180px)').matches) {
      setSidebarOpen(false);
    } else {
      setHideChrome(true);
    }
  };

  // Escape closes the mobile drawer. The scrim already closes it on a tap
  // outside; this is the keyboard affordance (found missing by the Phase-5 QA).
  useEffect(() => {
    if (!sidebarOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSidebarOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sidebarOpen, setSidebarOpen]);

  // Desktop keyboard shortcut: `c` puts the sidebar away / brings it back, to
  // match the owner's "直接收埋" request. Ignored while typing so it never eats
  // a character in a search box.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      const typing =
        el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
      if (typing) return;
      if (e.key === 'c' || e.key === 'C') {
        if (window.matchMedia('(min-width: 1181px)').matches) {
          e.preventDefault();
          setHideChrome((v) => !v);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    void bootstrap();
    // Intended once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When the sidebar selection changes, pull that symbol's Phase 1 data.
  useEffect(() => {
    if (apiUp) void loadMarket();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, apiUp]);

  if (apiUp === false) {
    return (
      <div className="app">
        <div className="app-body">
          <BackendDown onRetry={() => void bootstrap()} />
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      {/* The scrim fades in/out in step with the mobile drawer; it is
          display:none at desktop widths (see styles.css) so it cannot overlap
          content there. */}
      <DrawerScrim />
      {/* The only control on the main page: a discreet corner button that opens
          the sidebar (which carries the logo). It is the single entry at every
          width — the old floating 「»」 handle is gone, and there is no bar. */}
      <button
        type="button"
        className="icon-btn drawer-toggle"
        aria-label={hideChrome || !sidebarOpen ? t('nav.show') : t('nav.hide')}
        aria-expanded={!hideChrome || sidebarOpen}
        title={t('nav.showTitle')}
        onClick={() => (window.matchMedia('(max-width: 1180px)').matches ? setSidebarOpen(!sidebarOpen) : setHideChrome((v) => !v))}
      >
        ☰
      </button>
      <div className="app-body">
        <Sidebar hidden={hideChrome} onToggleHidden={putSidebarAway} />
        <main className="main-col">
          {screen === 'dashboard' ? <DashboardScreen /> : null}
          {screen === 'chart' ? <ChartScreen /> : null}
          {screen === 'signals' ? <SignalsScreen /> : null}
          {screen === 'watchlist' ? <WatchlistScreen /> : null}
          {screen === 'analysts' ? <AnalystsScreen /> : null}
          {screen === 'dividends' ? <DividendsScreen /> : null}
          {screen === 'help' ? <HelpScreen /> : null}
        </main>
      </div>
    </div>
  );
}

function DrawerScrim() {
  const t = useT();
  const open = useStore((s) => s.sidebarOpen);
  const setOpen = useStore((s) => s.setSidebarOpen);
  // The scrim belongs to the overlay drawer only. Below 1181px the sidebar is a
  // drawer at *every* width now (not just ≤720px), so the scrim is live there
  // too; at desktop widths it is never mounted. Keeping it out of the desktop
  // DOM (rather than merely display:none) matters: the chart evidence gate
  // treats "a scrim node exists" as "the drawer is open".
  const [isDrawerWidth, setIsDrawerWidth] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 1180px)').matches,
  );
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1180px)');
    const onChange = () => setIsDrawerWidth(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  if (!isDrawerWidth) return null;
  // Always mounted below the breakpoint so it can fade in/out in step with the
  // drawer slide (owner 40/100: mounting it only while open made it pop in).
  return (
    <button
      type="button"
      className={`scrim${open ? ' open' : ''}`}
      data-testid="drawer-scrim"
      aria-label={t('common.close')}
      aria-hidden={!open}
      tabIndex={open ? 0 : -1}
      onClick={() => setOpen(false)}
    />
  );
}

export default function App() {
  const lang = useStore((s) => s.lang);
  return (
    <LangProvider lang={lang}>
      <Shell />
    </LangProvider>
  );
}
