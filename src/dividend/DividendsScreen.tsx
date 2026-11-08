/**
 * The Phase 4 dividend workspace — one screen, six collapsible sections (§C).
 *
 * §B.1「簡潔唔好亂」is the organising constraint, exactly as in the analyst
 * workspace: a one-line recap of the headline figures, then the six areas the
 * user opens as they go deeper. Collapsed sections are *unmounted*, so arriving
 * here costs one header and the recap, nothing else.
 *
 * The screen holds **no derived numbers of its own**. Every figure comes from the
 * `shared/dividends.ts` payload already in the store, or from the pure helpers in
 * `src/dividend/`, which is what lets the honesty rules be tested without a
 * browser (§D.1).
 *
 * Two fetch paths, deliberately separate (§A.7):
 *   - the **facts** are one session-bound `quoteSummary` call that can go empty;
 *   - the **history** (payments + yields) is crumb-free.
 * A crumb outage therefore blanks the top three sections and *cannot* blank the
 * graphs — which is the failure mode §A.7 is entirely about.
 */
import { useCallback, useEffect, useState } from 'react';
import { useT } from '../i18n';
import { useStore } from '../store';
import { downloadText, exportFilename, exportJson, tablesToCsv } from '../analyst/export';
import { buildDividendTables } from './exportModel';
import {
  ConsistencySection,
  FactsSection,
  GraphSection,
  GrowthSection,
  ScheduleSection,
  ShareholderSection,
} from './sections';
import {
  DEFAULT_DIVIDEND_SECTIONS,
  persistDividendSections,
  readDividendSections,
  type DividendSectionId,
} from './sections-state';
import { formatCount, formatSignedPercent, formatYield, frequencyKey, sourcedText } from './format';
import { formatHKTDate } from '../../shared/format';
import type { DividendSpan, Sourced } from '../../shared/dividends';
import { dirClass } from '../dirClass';
import { cx } from '../analyst/ui';

/** How long the export courtesy message stays on screen. */
const FLASH_MS = 2200;

export function DividendsScreen() {
  const t = useT();
  const symbol = useStore((s) => s.symbol);
  const payload = useStore((s) => s.dividends);
  const load = useStore((s) => s.dividendsLoad);
  const loadDividends = useStore((s) => s.loadDividends);
  const historyLoad = useStore((s) => s.dividendHistoryLoad);
  const span = useStore((s) => s.dividendSpan);
  const setSpan = useStore((s) => s.setDividendSpan);
  const loadHistory = useStore((s) => s.loadDividendHistory);
  const history = useStore((s) => s.dividendHistory[`${s.symbol}|${s.dividendSpan}`] ?? null);
  const [sections, setSections] = useState<Record<DividendSectionId, boolean>>(DEFAULT_DIVIDEND_SECTIONS);
  const [flash, setFlash] = useState<string | null>(null);

  // Restore the open/closed layout once, on mount.
  useEffect(() => {
    setSections(readDividendSections());
  }, []);

  // Fetch on entry and whenever the symbol changes while this screen is up. The
  // two calls are independent, so a facts failure leaves the graphs alone.
  useEffect(() => {
    void loadDividends();
    void loadHistory(span);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol]);

  const toggle = useCallback((id: DividendSectionId) => {
    setSections((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      persistDividendSections(next);
      return next;
    });
  }, []);

  const onSpan = useCallback(
    (next: DividendSpan) => {
      setSpan(next);
    },
    [setSpan],
  );

  /** Everything the export can contain, formatted exactly as the screen shows. */
  const buildTables = useCallback(() => {
    const s = useStore.getState();
    const h = s.dividendHistory[`${s.symbol}|${s.dividendSpan}`] ?? null;
    return buildDividendTables(t, s.dividends, h);
  }, [t]);

  const onExport = useCallback(
    (kind: 'csv' | 'json') => {
      const tables = buildTables();
      if (tables.length === 0) {
        setFlash(t('pf.act.export.none'));
        return;
      }
      const now = Math.floor(Date.now() / 1000);
      const s = useStore.getState();
      const h = s.dividendHistory[`${s.symbol}|${s.dividendSpan}`] ?? null;
      const payloadBody =
        kind === 'csv'
          ? tablesToCsv(tables)
          : exportJson(symbol, { tables, dividends: s.dividends, history: h }, now, t('div.export.note'));
      downloadText(exportFilename(symbol, 'dividends', kind, now), payloadBody, kind === 'csv' ? 'text/csv' : 'application/json');
      setFlash(t('pf.act.export'));
    },
    [buildTables, symbol, t],
  );

  // The flash is a courtesy, not a notification: it clears itself and the file
  // download is the real signal.
  useEffect(() => {
    if (flash === null) return;
    const id = setTimeout(() => setFlash(null), FLASH_MS);
    return () => clearTimeout(id);
  }, [flash]);

  return (
    <div className="pf-screen div-screen" data-testid="dividends-screen" data-symbol={symbol}>
      <header className="pf-head">
        <div>
          <h1 className="pf-title">{t('div.title')}</h1>
          <p className="pf-hint">{t('div.subtitle', { symbol })}</p>
        </div>
        <div className="pf-head-right">
          <span className={cx('pf-load', `pf-load-${load.status}`)} data-testid="div-load-state">
            {load.status === 'loading' ? t('pf.section.loading') : load.status === 'error' ? t('div.error.title') : ''}
          </span>
          {flash !== null ? (
            <span className="pf-ok" data-testid="div-export-flash-top">
              {flash}
            </span>
          ) : null}
        </div>
      </header>

      <Recap />

      {payload === null ? (
        // Exactly one state, never two at once: a failed facts fetch is an error,
        // in-flight is loading, and a payload with no dividend is neither — it is
        // a real answer that the sections below render as an honest all-dash
        // block (§A.7, §D.5).
        load.status === 'error' ? (
          <p className="pf-empty" data-testid="div-error">
            {t('div.error.title')}
          </p>
        ) : (
          <p className="pf-empty" data-testid="div-loading">
            {load.status === 'loading' ? t('pf.section.loading') : t('div.empty')}
          </p>
        )
      ) : (
        <div className="pf-sections">
          <FactsSection open={sections.c1} onToggle={() => toggle('c1')} facts={payload.facts} currency={payload.facts.currency.value ?? null} />
          <GrowthSection open={sections.c2} onToggle={() => toggle('c2')} growth={payload.growth} />
          <ShareholderSection
            open={sections.c3}
            onToggle={() => toggle('c3')}
            shareholder={payload.shareholder}
            currency={payload.facts.currency.value ?? null}
          />
          <GraphSection
            open={sections.c4}
            onToggle={() => toggle('c4')}
            history={history}
            span={span}
            loading={historyLoad.status === 'loading'}
            error={historyLoad.status === 'error'}
            onSpan={onSpan}
          />
          <ScheduleSection
            open={sections.c5}
            onToggle={() => toggle('c5')}
            history={history}
            span={span}
            loading={historyLoad.status === 'loading'}
            onSpan={onSpan}
          />
          <ConsistencySection
            open={sections.c6}
            onToggle={() => toggle('c6')}
            payload={payload}
            history={history}
            series={payload.series}
            onExport={onExport}
            flash={flash}
          />
          {/*
            §A.7 in one line: when the fact block is a stale snapshot or could not
            be fetched at all, the screen says so *above* the graphs, which
            continue to render from the crumb-free history.
          */}
          {payload.note ? (
            <p className="pf-hint" data-testid="div-source-note">
              {t(payload.note)}
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}

/**
 * The recap strip: the handful of numbers that answer "does this pay me?".
 *
 * Every cell degrades to `—` independently, and none of them is coloured: a
 * yield is a *level*, and colouring a level would imply a direction it does not
 * have (§B.3). The one exception is the 1Y growth figure, which genuinely has a
 * direction and is labelled as a change.
 */
function Recap() {
  const t = useT();
  const payload = useStore((s) => s.dividends);
  const history = useStore((s) => s.dividendHistory[`${s.symbol}|${s.dividendSpan}`] ?? null);
  const [revealed, setRevealed] = useState(false);

  // One short fade-in when the recap first has data (§B.2); the stylesheet's
  // reduced-motion block neutralises it for a user who asked for no motion.
  useEffect(() => {
    if (revealed) return;
    if (!payload && !history) return;
    setRevealed(true);
  }, [revealed, payload, history]);

  const dash = t('common.noData');
  const facts = payload?.facts ?? null;
  const currency = facts?.currency.value ?? history?.currency ?? null;

  const cell = (label: string, value: React.ReactNode, testId: string, cls?: string) => (
    <div className="pf-recap-cell" key={testId} data-testid={testId}>
      <span className="pf-stat-k">{label}</span>
      <span className={cx('pf-stat-v', cls)}>{value}</span>
    </div>
  );

  const yieldCell = (s: Sourced<number> | undefined, testId: string, label: string) => {
    const st = sourcedText<number>(s, formatYield);
    return cell(label, st.text === dash ? dash : st.text, testId, st.absent ? 'div-val-absent' : undefined);
  };

  const growth = payload?.growth.growth1y ?? null;
  const growthSt = sourcedText<number>(growth, formatSignedPercent);

  // The next ex-date is a date, so it goes through the same HKT formatter the
  // facts table uses rather than a raw ISO string.
  const nextEx = sourcedText<number>(facts?.nextExDate, (v) => formatHKTDate(v));

  return (
    <section className={`pf-recap${revealed ? ' on' : ''}`} data-testid="div-recap" aria-label={t('div.recap.title')}>
      {yieldCell(facts?.indicatedYield, 'div-recap-indicated', t('div.f.indicated'))}
      {yieldCell(facts?.trailingYield, 'div-recap-trailing', t('div.f.trailing'))}
      {yieldCell(facts?.forwardYield, 'div-recap-forward', t('div.f.forward'))}
      {yieldCell(facts?.payoutRatioLtm, 'div-recap-payout', t('div.f.payout'))}
      {/* A change figure: the sign is in the text *and* the colour, so colour is
          never the only signal. */}
      {cell(
        t('div.g.1y'),
        growthSt.text === dash ? dash : growthSt.text,
        'div-recap-growth',
        growthSt.absent ? 'div-val-absent' : dirClass(growth?.value ?? null),
      )}
      {cell(
        t('div.f.frequency'),
        // A null frequency means the two derivation methods disagreed (§A.3), so
        // it renders the dash rather than a guessed label.
        payload === null || payload.facts.frequency.value === null
          ? dash
          : t(frequencyKey(payload.facts.frequency.value) ?? 'div.reason.notPublished'),
        'div-recap-frequency',
      )}
      {cell(
        t('div.f.nextEx'),
        nextEx.text,
        'div-recap-nextex',
        nextEx.absent ? 'div-val-absent' : undefined,
      )}
      {cell(
        t('div.c6.payments'),
        history === null ? dash : formatCount(history.payments.length),
        'div-recap-payments',
      )}
      {currency ? cell(t('div.f.currency'), currency, 'div-recap-currency') : null}
    </section>
  );
}
