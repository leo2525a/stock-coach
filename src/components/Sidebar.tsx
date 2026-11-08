import { useStore } from '../store';
import type { Screen } from '../store';
import { useT } from '../i18n';
import { ThemeToggle, LangSwitch, RefreshButton } from './Controls';
import { formatPercent, formatPrice } from '../../shared/format';
import { groupSymbols, UNKNOWN_GROUP_ID } from '../../shared/categorise';
import { sectorLabel } from '../../shared/i18n/terminology';
import type { GroupMode, WatchQuote } from '../../shared/types';

/**
 * Colour class for a signed figure.
 *
 * The rule itself lives in `src/dirClass.ts` so every panel shares one
 * definition; it is re-exported here because this module was its first home and
 * the dashboard/mover/watchlist imports read naturally as `from './Sidebar'`.
 * New call sites should import from `dirClass.ts` directly.
 */
export { dirClass, dirClassOrFlat } from '../dirClass';
import { dirClassOrFlat } from '../dirClass';

/**
 * Nav is *grouped*, not a flat list (SPEC-PHASE2 §C): the three groups answer
 * "where do I look at the market / what does it mean / what is mine".
 */
const NAV_GROUPS: Array<{ id: string; labelKey: string; items: Array<{ id: Screen; icon: string }> }> = [
  { id: 'markets', labelKey: 'nav.group.markets', items: [{ id: 'dashboard', icon: '◧' }, { id: 'chart', icon: '▲' }] },
  { id: 'analysis', labelKey: 'nav.group.analysis', items: [{ id: 'signals', icon: '◎' }] },
  { id: 'mine', labelKey: 'nav.group.mine', items: [{ id: 'watchlist', icon: '★' }, { id: 'help', icon: '?' }] },
  {
    id: 'analysts',
    labelKey: 'nav.group.analysts',
    items: [
      { id: 'analysts', icon: '⊞' },
      { id: 'dividends', icon: '≣' },
    ],
  },
];

const GROUP_MODES: GroupMode[] = ['all', 'sector', 'type', 'exchange'];

/**
 * The single left panel. Owner (38/100): the logo bar's contents now live here
 * — the brand, and the global controls (theme, language, refresh). Showing or
 * hiding the panel is a plain `display` toggle (no slide): `hidden` puts it away
 * (「«」or the `c` shortcut), and the brand in App brings it back in one move.
 * The panel scrolls its own content (`overflow-y: auto`); the watchlist below the
 * nav is reached by scrolling the panel.
 */
export function Sidebar({ hidden, onToggleHidden }: { hidden: boolean; onToggleHidden: () => void }) {
  const t = useT();
  const screen = useStore((s) => s.screen);
  const setScreen = useStore((s) => s.setScreen);
  const watchlist = useStore((s) => s.watchlist);
  const quotes = useStore((s) => s.quotes);
  const symbol = useStore((s) => s.symbol);
  const selectSymbol = useStore((s) => s.selectSymbol);
  const loadQuotes = useStore((s) => s.loadQuotes);
  const lang = useStore((s) => s.lang);
  const groupMode = useStore((s) => s.groupMode);
  const setGroupMode = useStore((s) => s.setGroupMode);
  const categories = useStore((s) => s.categories);
  const open = useStore((s) => s.sidebarOpen);
  const setOpen = useStore((s) => s.setSidebarOpen);

  const quoteFor = (sym: string): WatchQuote | null => quotes.find((q) => q.symbol === sym) ?? null;

  const groups = groupSymbols(
    watchlist.map((w) => w.symbol),
    categories,
    groupMode,
  );

  const go = (id: Screen) => {
    setScreen(id);
    // On mobile the sidebar is a drawer; navigating should close it.
    setOpen(false);
  };

  /** Human label for a group bucket, translated where we have a term. */
  const groupLabel = (id: string, raw: string | null): string => {
    if (id === UNKNOWN_GROUP_ID || raw === null) return t('watch.group.unknown');
    if (groupMode === 'type') {
      const key = raw === 'stock' ? 'cat.type.stock' : raw === 'etf' ? 'cat.type.etf' : 'cat.type.other';
      return t(key);
    }
    if (groupMode === 'sector') return sectorLabel(raw, lang);
    return raw;
  };

  return (
    <aside
      className={`sidebar${open ? ' open' : ''}`}
      aria-label={t('sidebar.title')}
      aria-hidden={hidden}
    >
      {/* Identity — moved down from the old logo bar. The brand mark is also the
          app's menu button (rendered in App.tsx, see `.drawer-toggle`). */}
      <div className="sidebar-head brand-head">
        <div className="spread">
          <div className="brand">
            Stock<span>Coach</span>
          </div>
          <button
            type="button"
            className="icon-btn collapse-btn"
            title={t('nav.hideTitle')}
            aria-label={t('nav.hide')}
            data-testid="sidebar-collapse"
            onClick={onToggleHidden}
          >
            «
          </button>
        </div>
      </div>

      {/* The global controls the logo bar used to carry, now in the panel. */}
      <div className="sidebar-controls" data-testid="sidebar-controls">
        <ThemeToggle />
        <LangSwitch />
        <RefreshButton />
      </div>

      <nav className="side-nav" aria-label={t('nav.section')}>
        {NAV_GROUPS.map((group) => (
          <div className="side-group" key={group.id}>
            <div className="side-group-label">{t(group.labelKey)}</div>
            <ul>
              {group.items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    id={`nav-${item.id}`}
                    data-screen={item.id}
                    className={`side-item${screen === item.id ? ' active' : ''}`}
                    aria-current={screen === item.id ? 'page' : undefined}
                    title={t(`nav.${item.id}.hint`)}
                    onClick={() => go(item.id)}
                  >
                    {/* `aria-hidden` because the glyph is decorative — the label
                        beside it is the accessible name. */}
                    <span className="side-icon" aria-hidden="true">
                      {item.icon}
                    </span>
                    <span className="side-text">{t(`nav.${item.id}`)}</span>
                    {/* The active rail is a real element so it can animate; a
                        CSS `box-shadow` could not slide between items. */}
                    <span className="side-rail" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <div className="sidebar-watch">
        <div className="sidebar-head sidebar-label-spacer">
          <div className="spread">
            <strong className="tiny sidebar-label sidebar-label-text">{t('sidebar.title')}</strong>
            <button
              type="button"
              className="icon-btn"
              title={t('sidebar.refreshTitle')}
              aria-label={t('sidebar.refreshTitle')}
              onClick={() => void loadQuotes()}
            >
              ⟳
            </button>
          </div>
        </div>

        {/* Group-by control — the visible face of the categorisation layer. */}
        <div className="group-by" role="group" aria-label={t('watch.groupBy')}>
          <span className="tiny muted">{t('watch.groupBy')}</span>
          <div className="group-by-btns">
            {GROUP_MODES.map((mode) => (
              <button
                key={mode}
                type="button"
                className={groupMode === mode ? 'active' : ''}
                aria-pressed={groupMode === mode}
                data-testid={`group-${mode}`}
                onClick={() => setGroupMode(mode)}
              >
                {t(`watch.group.${mode}`)}
              </button>
            ))}
          </div>
        </div>

        <ul className="sidebar-list" data-testid="sidebar-list">
          {watchlist.length === 0 ? <li className="empty">{t('sidebar.empty')}</li> : null}
          {groups.map((group) => (
            <li key={group.id} className="side-group-block">
              {groupMode !== 'all' ? (
                <div className="wl-group-head" data-testid={`wl-group-${group.id}`}>
                  {groupLabel(group.id, group.raw)}
                </div>
              ) : null}
              <ul className="wl-plain">
                {group.symbols.map((sym) => {
                  const q = quoteFor(sym);
                  const cls = dirClassOrFlat(q?.changePercent ?? null);
                  const item = watchlist.find((w) => w.symbol === sym);
                  return (
                    <li key={sym}>
                      <button
                        type="button"
                        className={`wl-row${sym === symbol ? ' selected' : ''}`}
                        aria-current={sym === symbol ? 'true' : undefined}
                        title={q?.name || item?.name || sym}
                        onClick={() => {
                          selectSymbol(sym);
                          go('chart');
                        }}
                      >
                        <span className="wl-main">
                          <span className="wl-sym">{sym}</span>
                          <span className="wl-name">{q?.name || item?.name || ''}</span>
                        </span>
                        <span className="wl-quote">
                          <span className={`wl-price ${cls}`}>{formatPrice(q?.lastPrice ?? null)}</span>
                          <span className={`wl-chg ${cls}`}>{formatPercent(q?.changePercent ?? null)}</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}
