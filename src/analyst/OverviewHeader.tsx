/**
 * §C.1 — the company header and the quick actions.
 *
 * Two deliberate design choices, both about §B.3「簡潔唔好亂」:
 *
 *  1. The header is a **CSS grid of label/value pairs**, not a wall of badges.
 *     Twelve facts in a readable grid beat twelve pills competing for the eye.
 *  2. `preMarket` / `postMarket` are *omitted entirely* when the provider has not
 *     published them (§D.5) — showing "0.00" for an after-hours print that does
 *     not exist would be a fabricated number.
 */
import { useEffect, useMemo, useState } from 'react';
import { useLang, useT, useApiError } from '../i18n';
import { useStore, selectFx } from '../store';
import { NoData, dirClass, usePrefersReducedMotion } from '../analyst/ui';
import { formatCompact, formatHKT, formatNumber, formatPercent, formatPrice } from '../../shared/format';
import { sectorLabel, industryLabel, exchangeLabel } from '../../shared/i18n/terminology';
import { DISPLAY_CURRENCIES } from '../../shared/fx';
import type { QuoteOverview } from '../../shared/types';

/** The market-state word for the provider's enum, or the raw enum if unknown. */
function stateKey(state: string | null): string | null {
  if (!state) return null;
  const s = state.toUpperCase();
  if (s === 'REGULAR') return 'pf.head.state.regular';
  if (s === 'PRE' || s === 'PREPRE') return 'pf.head.state.pre';
  if (s === 'POST' || s === 'POSTPOST') return 'pf.head.state.post';
  if (s === 'CLOSED' || s === 'CLOSE') return 'pf.head.state.closed';
  return null;
}

export function OverviewHeader({
  quote,
  onExport,
}: {
  quote: QuoteOverview | null;
  onExport: (kind: 'csv' | 'json') => void;
}) {
  const t = useT();
  const lang = useLang();
  const overviewErr = useStore((s) => s.analystLoad);
  const reason = useApiError(overviewErr.code, { symbol: useStore((s) => s.symbol) }, overviewErr.error ?? '');

  if (!quote) {
    return (
      <div className="pf-overview pf-overview-empty" data-testid="pf-overview">
        <p className="pf-empty">{overviewErr.status === 'error' ? reason || t('pf.error.title') : t('pf.section.loading')}</p>
      </div>
    );
  }

  // One rule for the sign → colour (src/dirClass.ts). `null` renders no colour
  // at all, so a missing change never reads as "flat".
  const changeCls = dirClass(quote.changePercent);
  const state = stateKey(quote.marketState);

  return (
    <div className="pf-overview" data-testid="pf-overview">
      <div className="pf-overview-id">
        <h2 className="pf-company">{quote.name ?? quote.symbol}</h2>
        <div className="pf-overview-tags">
          {quote.sector ? <span className="pf-tag" data-testid="pf-sector">{sectorLabel(quote.sector, lang)}</span> : null}
          {quote.industry ? <span className="pf-tag soft">{industryLabel(quote.industry, lang)}</span> : null}
          {quote.exchange ? <span className="pf-tag soft">{exchangeLabel(quote.exchange, lang)}</span> : null}
          {state ? <span className="pf-tag state" data-testid="pf-state">{t(state)}</span> : null}
        </div>
      </div>

      <div className="pf-overview-price">
        <span className={`pf-price ${changeCls}`} data-testid="pf-price">
          {formatPrice(quote.price, quote.currency ?? undefined)}
        </span>
        {/* The change and the change% share the price's tone, and a missing
            change renders no colour rather than a misleading neutral. */}
        <span className={changeCls}>
          {quote.change === null ? '' : `${quote.change >= 0 ? '+' : ''}${formatNumber(quote.change, 2)}`}
        </span>
        <span className={changeCls}>{quote.changePercent === null ? '' : formatPercent(quote.changePercent)}</span>
      </div>

      {/* Twelve facts, one grid. Every cell can say `—`. */}
      <dl className="pf-facts" data-testid="pf-facts">
        <Fact k={t('pf.head.prevClose')} v={formatPrice(quote.previousClose)} />
        <Fact k={t('pf.head.dayHigh')} v={formatPrice(quote.dayHigh)} />
        <Fact k={t('pf.head.dayLow')} v={formatPrice(quote.dayLow)} />
        <Fact
          k={t('pf.head.w52')}
          v={
            quote.fiftyTwoWeekLow === null || quote.fiftyTwoWeekHigh === null
              ? <NoData />
              : `${formatPrice(quote.fiftyTwoWeekLow)} – ${formatPrice(quote.fiftyTwoWeekHigh)}`
          }
        />
        <Fact k={t('pf.head.volume')} v={formatCompact(quote.volume)} />
        <Fact k={t('pf.head.marketCap')} v={formatCompact(quote.marketCap)} />
        <Fact k={t('pf.head.trailingPE')} v={formatNumber(quote.trailingPE, 2)} />
        <Fact k={t('pf.head.forwardPE')} v={formatNumber(quote.forwardPE, 2)} />
        <Fact k={t('pf.head.nextEarnings')} v={<NextEarnings />} />
        {/*
          Pre/post rows exist only when the provider published a print. The
          `title` explains the absence, so an empty header is never a mystery.
        */}
        {quote.preMarket !== null ? <Fact k={t('pf.head.preMarket')} v={formatPrice(quote.preMarket)} /> : null}
        {quote.postMarket !== null ? <Fact k={t('pf.head.postMarket')} v={formatPrice(quote.postMarket)} /> : null}
      </dl>
      <p className="pf-hint">{t('pf.head.note')}</p>

      <QuickActions onExport={onExport} />
    </div>
  );
}

/** One label/value cell. */
function Fact({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="pf-fact">
      <dt>{k}</dt>
      <dd>{v}</dd>
    </div>
  );
}

/** The next earnings date, which lives on the estimates payload, not the quote. */
function NextEarnings() {
  const t = useT();
  const calendar = useStore((s) => s.estimates?.calendar ?? null);
  if (!calendar) return <NoData />;
  if (calendar.nextEarningsLabel === null) return <>{t('pf.head.nextEarningsNone')}</>;
  return (
    <span title={calendar.isEstimate ? t('pf.est.calendar.estimated') : t('pf.est.calendar.confirmed')}>
      {calendar.nextEarningsLabel}
      {calendar.isEstimate ? '*' : ''}
    </span>
  );
}

/* --------------------------------------------------------------- actions -- */

/**
 * Watchlist toggle, a local price reminder, a local note, and export (§C.1).
 *
 * The reminder and the note are `localStorage`-only and the UI *says so* —
 * "a note to yourself, not a notification". Presenting them as anything else
 * would be the sort of small lie that erodes every other number on the page.
 */
function QuickActions({ onExport }: { onExport: (kind: 'csv' | 'json') => void }) {
  const t = useT();
  const symbol = useStore((s) => s.symbol);
  const watchlist = useStore((s) => s.watchlist);
  const addSymbol = useStore((s) => s.addSymbol);
  const removeSymbol = useStore((s) => s.removeSymbol);
  const quoteOverview = useStore((s) => s.quoteOverview);
  const notes = useStore((s) => s.notes);
  const setNote = useStore((s) => s.setNote);
  const alerts = useStore((s) => s.alerts);
  const setAlert = useStore((s) => s.setAlert);
  const displayCurrency = useStore((s) => s.displayCurrency);
  const setDisplayCurrency = useStore((s) => s.setDisplayCurrency);
  const loadFx = useStore((s) => s.loadFx);
  const fx = useStore(selectFx);

  const onWatchlist = watchlist.some((w) => w.symbol === symbol);
  const [noteDraft, setNoteDraft] = useState(notes[symbol] ?? '');
  const [alertDraft, setAlertDraft] = useState(alerts[symbol] !== undefined ? String(alerts[symbol]) : '');
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  // Pull the rate table as soon as the panel is on screen so the currency
  // figures are real by the time the user changes the switch.
  useEffect(() => {
    void loadFx([displayCurrency]);
  }, [loadFx, displayCurrency]);

  // A symbol switch replaces the drafts; the previous symbol's note must not
  // linger in the box.
  useEffect(() => {
    setNoteDraft(notes[symbol] ?? '');
    setAlertDraft(alerts[symbol] !== undefined ? String(alerts[symbol]) : '');
    setSaved(false);
  }, [symbol, notes, alerts]);

  const currentAlert = alerts[symbol] ?? null;
  const alertNumber = useMemo(() => {
    const n = Number(alertDraft);
    return Number.isFinite(n) && n > 0 ? n : null;
  }, [alertDraft]);

  const doWatch = async () => {
    setBusy(true);
    try {
      if (onWatchlist) await removeSymbol(symbol);
      else await addSymbol(symbol, quoteOverview?.name ?? undefined);
    } finally {
      setBusy(false);
    }
  };

  const saveNote = () => {
    setNote(symbol, noteDraft);
    setSaved(true);
  };

  const rateNote = fx === null ? null : fx.unavailable ? t('pf.currency.rateUnknown') : null;

  return (
    <div className="pf-actions" data-testid="pf-actions">
      <div className="pf-action-row">
        <button
          type="button"
          className={`pf-act-btn${onWatchlist ? ' on' : ''}`}
          disabled={busy}
          data-testid="pf-watch"
          title={onWatchlist ? t('pf.act.watch.remove') : t('pf.act.watch.add')}
          onClick={() => void doWatch()}
        >
          <span aria-hidden="true">{onWatchlist ? '★' : '☆'}</span>
          {onWatchlist ? t('pf.act.watch.added') : t('pf.act.watch.add')}
        </button>
        <button type="button" className="pf-act-btn" data-testid="pf-export-csv" onClick={() => onExport('csv')}>
          {t('pf.act.export.csv')}
        </button>
        <button type="button" className="pf-act-btn" data-testid="pf-export-json" onClick={() => onExport('json')}>
          {t('pf.act.export.json')}
        </button>
      </div>

      <div className="pf-action-row cols">
        <label className="pf-field">
          <span>{t('pf.act.alerts')}</span>
          <span className="pf-inline">
            <input
              type="text"
              inputMode="decimal"
              value={alertDraft}
              placeholder={t('pf.act.alerts.placeholder')}
              onChange={(e) => setAlertDraft(e.target.value)}
              aria-label={t('pf.act.alerts')}
            />
            <MaybeNumberText value={alertNumber} currency={quoteOverview?.currency ?? null} />
          </span>
        </label>
        <div className="pf-action-btns">
          <button type="button" onClick={() => setAlert(symbol, alertNumber)} disabled={alertNumber === null && currentAlert === null}>
            {t('pf.act.alerts.set')}
          </button>
          <button
            type="button"
            onClick={() => {
              setAlert(symbol, null);
              setAlertDraft('');
            }}
            disabled={currentAlert === null}
          >
            {t('pf.act.alerts.clear')}
          </button>
        </div>
      </div>
      <p className="pf-hint" data-testid="pf-alert-current">
        {currentAlert === null ? t('pf.act.alerts.none') : t('pf.act.alerts.current', { price: formatPrice(currentAlert, quoteOverview?.currency ?? undefined) })}
        {' · '}
        {t('pf.act.alerts.local')}
      </p>

      <div className="pf-action-row cols">
        <label className="pf-field grow">
          <span>{t('pf.act.notes')}</span>
          <textarea
            value={noteDraft}
            placeholder={t('pf.act.notes.placeholder', { symbol })}
            aria-label={t('pf.act.notes')}
            rows={2}
            onChange={(e) => {
              setNoteDraft(e.target.value);
              setSaved(false);
            }}
          />
        </label>
      </div>
      <div className="pf-action-row">
        <button type="button" className="pf-act-btn primary" data-testid="pf-note-save" onClick={saveNote}>
          {t('pf.act.notes.save')}
        </button>
        {saved ? <span className="pf-ok" data-testid="pf-note-saved">{t('pf.act.notes.saved')}</span> : null}
        <span className="pf-hint">{t('pf.act.notes.local')}</span>
      </div>

      <div className="pf-action-row">
        <label className="pf-inline" data-testid="pf-currency">
          <span className="pf-hint">{t('pf.currency.switch')}</span>
          <CurrencySwitch value={displayCurrency} onChange={setDisplayCurrency} label={t('pf.currency.switch')} />
        </label>
        <span className="pf-hint" data-testid="pf-currency-note">
          {/* The conversion is display-only, and the rate's provenance is shown
              rather than assumed. */}
          {quoteOverview?.currency ? t('pf.currency.source', { currency: quoteOverview.currency }) : ''}
          {rateNote ? ` · ${rateNote}` : ''}
          {fx && fx.asOf !== null && !fx.unavailable ? ` · ${t('pf.currency.rateAt', { time: formatHKT(fx.asOf) })}` : ''}
        </span>
        <span className="pf-hint">{t('pf.currency.note')}</span>
      </div>
    </div>
  );
}

/** A tiny number echo beside the reminder input, so a typo is visible. */
function MaybeNumberText({ value, currency }: { value: number | null; currency: string | null }) {
  if (value === null) return null;
  return <span className="pf-hint">{formatPrice(value, currency ?? undefined)}</span>;
}

/**
 * The currency chips, animated as a single "thumb" would be on iOS.
 *
 * The thumb is a *real* moving element rather than a CSS transition on each
 * chip, so the motion reads as one control. It is disabled under
 * `prefers-reduced-motion` (see `styles.css`), and this component does not
 * animate on mount.
 */
function CurrencySwitch({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (code: string) => void;
  label: string;
}) {
  const reduced = usePrefersReducedMotion();
  const options = useMemo(() => (DISPLAY_CURRENCIES as readonly string[]).slice(), []);
  const index = Math.max(0, options.indexOf(value));
  return (
    <span className="pf-currency" role="radiogroup" aria-label={label} data-testid="pf-currency-switch">
      {!reduced ? (
        <span
          className="pf-currency-thumb"
          aria-hidden="true"
          style={{ transform: `translateX(${index * 100}%)`, width: `${100 / options.length}%` }}
        />
      ) : null}
      {options.map((code) => (
        <button
          key={code}
          type="button"
          role="radio"
          aria-checked={value === code}
          className={value === code ? 'active' : ''}
          data-currency={code}
          onClick={() => onChange(code)}
        >
          {code}
        </button>
      ))}
    </span>
  );
}
