/**
 * The Phase 3 analyst workspace — one screen, four collapsible sections.
 *
 * §B.3「簡潔唔好亂」is the organising constraint. The screen has exactly three
 * layers: a one-line recap (the "what do I need to know?" strip), the company
 * header with its quick actions, and then four sections the user opens as they
 * go deeper. Collapsed sections are *unmounted*, so a first paint costs one
 * header and nothing else.
 *
 * Everything the screen shows comes from the Phase 3 payloads in the store. It
 * holds no derived numbers of its own — a figure that only exists here could not
 * be tested, and the point of the `shared/` mappers is that every number has one
 * home.
 */
import { useCallback, useEffect, useState } from 'react';
import { useT } from '../i18n';
import { useStore } from '../store';
import { OverviewHeader } from './OverviewHeader';
import { StatementsSection } from './StatementsPanel';
import { EstimatesSection } from './EstimatesPanel';
import { RatingsSection } from './RatingsPanel';
import {
  DEFAULT_SECTIONS,
  downloadText,
  exportFilename,
  exportJson,
  persistSections,
  readSections,
  tablesToCsv,
  type SectionId,
} from './export';
import { buildExportTables } from './exportModel';
import { cx, useMoney, usePrefersReducedMotion } from './ui';
import { formatCompact, formatNumber, formatPercent, formatPrice } from '../../shared/format';

/** How long the export courtesy message stays on screen. */
const FLASH_MS = 2200;

export function AnalystsScreen() {
  const t = useT();
  const symbol = useStore((s) => s.symbol);
  const loadAnalyst = useStore((s) => s.loadAnalyst);
  const analystLoad = useStore((s) => s.analystLoad);
  const loadStatements = useStore((s) => s.loadStatements);
  const statementsPeriod = useStore((s) => s.statementsPeriod);
  const [sections, setSections] = useState<Record<SectionId, boolean>>(DEFAULT_SECTIONS);
  const [flash, setFlash] = useState<string | null>(null);

  // Restore the open/closed layout once, on mount.
  useEffect(() => {
    setSections(readSections());
  }, []);

  // Fetch on entry and whenever the symbol changes while this screen is up. The
  // store's `selectSymbol` also covers a symbol switch made from the sidebar;
  // this covers arriving here directly with a symbol already selected.
  useEffect(() => {
    void loadAnalyst();
    void loadStatements({ period: statementsPeriod });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol]);

  const toggle = useCallback((id: SectionId) => {
    setSections((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      persistSections(next);
      return next;
    });
  }, []);

  /** Everything the export can contain, formatted exactly as the screen is. */
  const buildTables = useCallback(() => {
    const s = useStore.getState();
    return buildExportTables({
      t,
      symbol: s.symbol,
      quote: s.quoteOverview,
      statements: s.statements,
      estimates: s.estimates,
      ratings: s.ratings,
      headers: { metric: t('pf.period.label'), value: t('pf.mult.title') },
      format: {
        money: (v, currency) => (v === null ? t('common.noData') : formatCompact(v) + (currency ? ` ${currency}` : '')),
        num: (v, digits) => formatNumber(v, digits ?? 2),
        pct: (v) => (v === null ? t('common.noData') : formatPercent(v * 100)),
        compact: formatCompact,
        date: (at) => (at === null ? t('common.noData') : new Date(at * 1000).toISOString().slice(0, 10)),
      },
    });
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
      const payload =
        kind === 'csv'
          ? tablesToCsv(tables)
          : exportJson(
              symbol,
              {
                tables,
                quote: s.quoteOverview,
                statements: s.statements,
                estimates: s.estimates,
                ratings: s.ratings,
              },
              now,
              t('pf.export.note'),
            );
      downloadText(
        exportFilename(symbol, 'analysts', kind, now),
        payload,
        kind === 'csv' ? 'text/csv' : 'application/json',
      );
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
    <div className="pf-screen" data-testid="analysts-screen">
      <header className="pf-head">
        <div>
          <h1 className="pf-title">{t('pf.title')}</h1>
          <p className="pf-hint">{t('pf.subtitle', { symbol })}</p>
        </div>
        <div className="pf-head-right">
          <span className={cx('pf-load', `pf-load-${analystLoad.status}`)} data-testid="pf-load-state">
            {analystLoad.status === 'loading'
              ? t('pf.section.loading')
              : analystLoad.status === 'error'
                ? t('pf.error.title')
                : ''}
          </span>
          {flash !== null ? <span className="pf-ok" data-testid="pf-export-flash">{flash}</span> : null}
        </div>
      </header>

      <Recap onExport={onExport} />

      <OverviewHeader quote={useStore((s) => s.quoteOverview)} onExport={onExport} />

      <div className="pf-sections">
        <StatementsSection open={sections.statements} onToggle={() => toggle('statements')} />
        <EstimatesSection open={sections.estimates} onToggle={() => toggle('estimates')} />
        <RatingsSection open={sections.ratings} onToggle={() => toggle('ratings')} />
      </div>
    </div>
  );
}

/**
 * The recap strip: the handful of numbers that answer "is this interesting?".
 *
 * Every cell degrades to `—` independently — a missing target does not blank the
 * rating, and a missing rating does not blank the next earnings date. The strip
 * is the one place the whole screen summarises itself, and it is deliberately
 * cheap: no chart, no table, just the headline consensus.
 */
function Recap({ onExport }: { onExport: (kind: 'csv' | 'json') => void }) {
  const t = useT();
  const estimates = useStore((s) => s.estimates);
  const ratings = useStore((s) => s.ratings);
  const forwardPE = useStore((s) => s.quoteOverview?.forwardPE ?? null);
  const { toDisplay } = useMoney();
  const reduced = usePrefersReducedMotion();
  const [revealed, setRevealed] = useState(false);

  // A single, short fade-in when the recap first has data (§B.2). Not a
  // per-number animation, and skipped entirely under reduced motion.
  useEffect(() => {
    if (reduced || revealed) return;
    if (!estimates && !ratings) return;
    setRevealed(true);
  }, [reduced, revealed, estimates, ratings]);

  const target = ratings?.target ?? null;
  const cur = ratings?.currency ?? estimates?.currency ?? null;
  const nextQ = estimates?.periods.find((p) => p.id === '0q') ?? null;
  const epsNextQ = nextQ?.eps.avg ?? null;
  const revNextQ = nextQ?.revenue.avg ?? null;

  const dash = t('common.noData');
  const num = (v: number | null, digits = 2) => (v === null ? dash : formatNumber(v, digits));

  const cell = (label: string, value: React.ReactNode, testId: string) => (
    <div className="pf-recap-cell" key={testId} data-testid={testId}>
      <span className="pf-stat-k">{label}</span>
      <span className="pf-stat-v">{value}</span>
    </div>
  );

  return (
    <section className={`pf-recap${revealed ? ' on' : ''}`} data-testid="pf-recap" aria-label={t('pf.recap.title')}>
      {cell(t('pf.recap.rating'), num(ratings?.ratings.recommendationMean ?? null), 'pf-recap-rating')}
      {cell(
        t('pf.recap.target'),
        target === null || target.mean === null
          ? dash
          : formatPrice(toDisplay(target.mean, cur).amount, toDisplay(target.mean, cur).currency),
        'pf-recap-target',
      )}
      {cell(
        t('pf.recap.upside'),
        target === null || target.upsidePct === null ? dash : formatPercent(target.upsidePct * 100),
        'pf-recap-upside',
      )}
      {cell(t('pf.recap.epsNextQ'), num(epsNextQ), 'pf-recap-eps')}
      {cell(t('pf.recap.revenueNextQ'), revNextQ === null ? dash : formatCompact(revNextQ), 'pf-recap-revenue')}
      {cell(t('pf.recap.forwardPE'), num(forwardPE), 'pf-recap-fwdpe')}
      {cell(
        t('pf.recap.nextEarnings'),
        estimates?.calendar.nextEarningsLabel ?? t('pf.head.nextEarningsNone'),
        'pf-recap-next-earnings',
      )}
      <div className="pf-recap-actions">
        <button type="button" className="pf-act-btn" data-testid="pf-recap-export-csv" onClick={() => onExport('csv')}>
          {t('pf.act.export.csv')}
        </button>
        <button type="button" className="pf-act-btn" data-testid="pf-recap-export-json" onClick={() => onExport('json')}>
          {t('pf.act.export.json')}
        </button>
      </div>
    </section>
  );
}
