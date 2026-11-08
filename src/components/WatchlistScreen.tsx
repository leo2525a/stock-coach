import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { dirClassOrFlat } from './Sidebar';
import { useLang, translateApiError, useT } from '../i18n';
import * as api from '../api';
import { formatPercent, formatPrice, isValidSymbol, normalizeSymbol } from '../../shared/format';
import { groupSymbols, UNKNOWN_GROUP_ID } from '../../shared/categorise';
import { exchangeLabel, sectorLabel } from '../../shared/i18n/terminology';
import type { GroupMode, SymbolSearchResult } from '../../shared/types';

const GROUP_MODES: GroupMode[] = ['all', 'sector', 'type', 'exchange'];

export function WatchlistScreen() {
  const t = useT();
  const lang = useLang();
  const watchlist = useStore((s) => s.watchlist);
  const quotes = useStore((s) => s.quotes);
  const error = useStore((s) => s.watchlistError);
  const addSymbol = useStore((s) => s.addSymbol);
  const removeSymbol = useStore((s) => s.removeSymbol);
  const moveSymbol = useStore((s) => s.moveSymbol);
  const loadWatchlist = useStore((s) => s.loadWatchlist);
  const loadQuotes = useStore((s) => s.loadQuotes);
  const selectSymbol = useStore((s) => s.selectSymbol);
  const setScreen = useStore((s) => s.setScreen);
  const categories = useStore((s) => s.categories);
  const loadCategories = useStore((s) => s.loadCategories);
  const groupMode = useStore((s) => s.groupMode);
  const setGroupMode = useStore((s) => s.setGroupMode);

  const [input, setInput] = useState('');
  const [adding, setAdding] = useState(false);
  const [addMsg, setAddMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [results, setResults] = useState<SymbolSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Keep the prices in this screen fresh.
    void loadQuotes();
  }, [loadQuotes]);

  // The categorisation drives the grouping control in this screen.
  useEffect(() => {
    if (watchlist.length) void loadCategories();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchlist.map((w) => w.symbol).join(',')]);

  // Debounced symbol lookup, so typing does not hammer the provider.
  useEffect(() => {
    const q = input.trim();
    if (debounce.current) clearTimeout(debounce.current);
    if (q.length < 1 || !isValidSymbol(normalizeSymbol(q))) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    debounce.current = setTimeout(async () => {
      const res = await api.searchSymbols(q);
      setResults(res.ok ? res.data.slice(0, 8) : []);
      setSearching(false);
    }, 320);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [input]);

  const onAdd = async (symbolRaw: string, name?: string) => {
    const symbol = normalizeSymbol(symbolRaw);
    if (!isValidSymbol(symbol)) {
      setAddMsg({ kind: 'err', text: t('watch.invalid', { input: symbolRaw }) });
      return;
    }
    setAdding(true);
    setAddMsg(null);
    const res = await addSymbol(symbol, name);
    setAdding(false);
    if (res.ok) {
      setAddMsg({ kind: 'ok', text: t('watch.added', { symbol }) });
      setInput('');
      setResults([]);
    } else {
      setAddMsg({
        kind: 'err',
        text: translateApiError(t, res.code, { symbol }, res.error ?? t('watch.addFailed')),
      });
    }
  };

  const quoteFor = (sym: string) => quotes.find((q) => q.symbol === sym) ?? null;

  const groups = groupSymbols(
    watchlist.map((w) => w.symbol),
    categories,
    groupMode,
  );

  /** Translate a group bucket, falling back to the provider's own label. */
  const groupLabel = (id: string, raw: string | null): string => {
    if (id === UNKNOWN_GROUP_ID || raw === null) return t('watch.group.unknown');
    if (groupMode === 'type') {
      const key = raw === 'stock' ? 'cat.type.stock' : raw === 'etf' ? 'cat.type.etf' : 'cat.type.other';
      return t(key);
    }
    if (groupMode === 'sector') return sectorLabel(raw, lang);
    if (groupMode === 'exchange') return exchangeLabel(raw, lang);
    return raw;
  };

  return (
    <div className="stack" data-testid="watchlist-screen">
      <section className="panel">
        <h2 className="panel-title">{t('watch.addLabel')}</h2>
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            void onAdd(input);
          }}
        >
          <div style={{ flex: 1, minWidth: 220 }}>
            <input
              type="text"
              value={input}
              placeholder={t('watch.addPlaceholder')}
              aria-label={t('watch.addLabel')}
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => setInput(e.target.value)}
            />
          </div>
          <button type="submit" className="btn-primary" disabled={adding || !input.trim()}>
            {adding ? t('watch.checking') : t('watch.addBtn')}
          </button>
        </form>

        {addMsg ? (
          <p className={addMsg.kind === 'ok' ? 'tiny chg-up' : 'error-box'} style={{ marginTop: 8 }} data-testid="add-message">
            {addMsg.text}
          </p>
        ) : null}

        {searching ? (
          <p className="tiny muted" style={{ marginTop: 8 }}>
            {t('watch.searching')}
          </p>
        ) : null}
        {results.length > 0 ? (
          <ul className="search-results" data-testid="search-results">
            {results.map((r) => (
              <li key={r.symbol}>
                <button type="button" onClick={() => void onAdd(r.symbol, r.name)}>
                  <span>
                    <b>{r.symbol}</b> — {r.name}
                  </span>
                  <span className="sr-meta">
                    {r.exchange} {r.type ? `· ${r.type}` : ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {!searching && input.trim().length > 0 && results.length === 0 && isValidSymbol(normalizeSymbol(input)) ? (
          <p className="tiny muted" style={{ marginTop: 8 }}>
            {t('watch.noResults')}
          </p>
        ) : null}
      </section>

      <section className="panel">
        <div className="spread">
          <h2 className="panel-title" style={{ margin: 0 }}>
            {t('watch.listTitle', { count: watchlist.length })}
          </h2>
          <div className="row">
            <div className="group-by-btns" role="group" aria-label={t('watch.groupBy')}>
              {GROUP_MODES.map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={groupMode === mode ? 'active' : ''}
                  aria-pressed={groupMode === mode}
                  data-testid={`wl-group-${mode}`}
                  onClick={() => setGroupMode(mode)}
                >
                  {t(`watch.group.${mode}`)}
                </button>
              ))}
            </div>
            <button type="button" onClick={() => void loadWatchlist().then(() => loadQuotes())}>
              {t('watch.refreshPrices')}
            </button>
          </div>
        </div>

        {error ? (
          <div className="error-box" style={{ marginTop: 10 }}>
            {error}
          </div>
        ) : null}

        {watchlist.length === 0 ? (
          <p className="empty">{t('watch.empty')}</p>
        ) : (
          <div className="wl-manage" style={{ marginTop: 10 }} data-testid="watchlist-manage">
            {groups.map((group) => (
              <div className="wl-manage-group" key={group.id}>
                {groupMode !== 'all' ? (
                  <div className="wl-group-head" data-testid={`manage-group-${group.id}`}>
                    {groupLabel(group.id, group.raw)}
                    <span className="tiny muted"> · {t('watch.group.count', { count: group.symbols.length })}</span>
                  </div>
                ) : null}
                {group.symbols.map((sym) => {
                  const item = watchlist.find((w) => w.symbol === sym);
                  if (!item) return null;
                  const idx = watchlist.indexOf(item);
                  const q = quoteFor(sym);
                  const cls = dirClassOrFlat(q?.changePercent ?? null);
                  return (
                    <div className="wl-manage-row" key={sym}>
                      <span className="grow">
                        <b>{sym}</b> <span className="muted tiny">{q?.name || item.name || ''}</span>
                      </span>
                      <span className={`mono ${cls}`} style={{ minWidth: 92, textAlign: 'right' }}>
                        {formatPrice(q?.lastPrice ?? null, q?.currency)}
                      </span>
                      <span className={`mono ${cls}`} style={{ minWidth: 76, textAlign: 'right' }}>
                        {formatPercent(q?.changePercent ?? null)}
                      </span>
                      <button
                        type="button"
                        className="icon-btn"
                        title={t('watch.moveUp', { symbol: sym })}
                        aria-label={t('watch.moveUp', { symbol: sym })}
                        disabled={idx === 0}
                        onClick={() => void moveSymbol(sym, -1)}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="icon-btn"
                        title={t('watch.moveDown', { symbol: sym })}
                        aria-label={t('watch.moveDown', { symbol: sym })}
                        disabled={idx === watchlist.length - 1}
                        onClick={() => void moveSymbol(sym, 1)}
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        className="btn-primary"
                        onClick={() => {
                          selectSymbol(sym);
                          setScreen('chart');
                        }}
                      >
                        {t('watch.view')}
                      </button>
                      <button
                        type="button"
                        className="btn-danger"
                        title={t('watch.remove', { symbol: sym })}
                        aria-label={t('watch.remove', { symbol: sym })}
                        onClick={() => void removeSymbol(sym)}
                      >
                        {t('watch.remove', { symbol: sym })}
                      </button>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="panel">
        <h3 className="panel-title">{t('watch.whatIs')}</h3>
        <p className="panel-note" style={{ marginBottom: 0 }}>
          {t('watch.whatIs.body')}
        </p>
      </section>
    </div>
  );
}
