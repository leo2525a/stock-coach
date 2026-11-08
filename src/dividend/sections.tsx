/**
 * The six §C sections of the dividend screen.
 *
 * Each section is a pure function of the payload the store already holds: no
 * panel derives a number of its own, so every figure on screen has exactly one
 * home in `shared/dividends.ts` and can be cross-checked against the server.
 *
 * The three habits that matter (§B.3, §D.5), applied here without exception:
 *
 *  - A figure goes through `sourcedText`, so an absent one is the em dash with
 *    its reason on hover — never `null`, `NaN` or a fabricated `0`.
 *  - `dirClass` is applied **only** to the growth and delta figures, which
 *    genuinely have a direction. A yield, a payout ratio and a price are levels
 *    and stay uncoloured, so blue/red never implies a trend that is not there.
 *  - The schedule's Announced / Record / Type columns are permanently `—`,
 *    because upstream does not carry them. The table says so in words rather
 *    than leaving four mysterious empty columns.
 */
import type { ReactNode } from 'react';
import { useT } from '../i18n';
import { dirClass } from '../dirClass';
import { isNoteKey } from '../../shared/api-errors';
import type {
  DividendFacts,
  DividendHistoryPayload,
  DividendPayload,
  DividendScheduleRow,
  DividendSeries,
  FrequencyLabel,
  ShareholderYield,
  Sourced,
} from '../../shared/dividends';
import { DIVIDEND_SPANS, SPAN_DAYS } from '../../shared/dividends';
import { formatHKTDate } from '../../shared/format';
import { DataTable, Section, Segmented, Stat, cx } from '../analyst/ui';
import { DividendChart } from './DividendChart';
import {
  DASH,
  formatAmount,
  formatCount,
  formatSignedPercent,
  formatYield,
  frequencyKey,
  sourcedText,
  spanLabel,
  type SourcedText,
} from './format';
import type { Translator } from '../../shared/i18n';

/* ----------------------------------------------------------------- shared -- */

/**
 * The user-facing reason a figure is a dash.
 *
 * The payload ships a *code*, never prose; `isNoteKey` is the guard that keeps
 * a raw English sentence from being rendered as if it were a translation. When
 * there is no code the honest fallback says "not published" rather than
 * inventing a cause.
 */
export function reasonText(t: Translator, note: string | null | undefined): string {
  if (note && isNoteKey(note)) return t(note);
  return t('div.reason.notPublished');
}

/** The "computed" marker for a `source: 'derived'` figure. */
function Computed({ on, testId }: { on: boolean; testId?: string }) {
  const t = useT();
  if (!on) return null;
  return (
    <span className="div-tag" data-testid={testId}>
      {t('div.tag.computed')}
    </span>
  );
}

/**
 * One value cell.
 *
 * The cell carries its own tooltip, so the *reason* travels with the dash
 * wherever it is rendered instead of relying on a panel-level footnote the user
 * may have scrolled past.
 */
function Cell({ st, testId }: { st: SourcedText; testId?: string }) {
  const t = useT();
  return (
    <span className={cx('div-val', st.absent ? 'div-val-absent' : null)} title={reasonText(t, st.note)} data-testid={testId}>
      {st.text}
      <Computed on={st.computed} testId={testId ? `${testId}-computed` : undefined} />
    </span>
  );
}

/** A row of the three-column "figure / value / basis" tables. */
function figureRow(t: Translator, label: string, note: string | null | undefined, value: ReactNode, basis: string): ReactNode[] {
  return [
    <span key="k" className="div-figure" title={note ? reasonText(t, note) : undefined}>
      {label}
    </span>,
    value,
    <span key="b" className="div-basis">
      {basis}
    </span>,
  ];
}

/** Make a `Sourced<number>` into a cell through one of the number formatters. */
function numCell(
  t: Translator,
  s: Sourced<number> | null | undefined,
  format: (v: number) => string,
  testId: string,
): ReactNode {
  const st = sourcedText<number>(s, format);
  return <Cell st={st} testId={testId} />;
}

/* ------------------------------------------------------- §C.1 yield & freq -- */

export function FactsSection({
  open,
  onToggle,
  facts,
  currency,
}: {
  open: boolean;
  onToggle: () => void;
  facts: DividendFacts;
  currency: string | null;
}) {
  const t = useT();
  const derivedBasis = t('div.basis.derived');
  const directBasis = t('div.basis.direct');

  const cols = [
    { key: 'k', label: t('div.col.figure') },
    { key: 'v', label: t('div.col.value'), align: 'right' as const },
    { key: 'b', label: t('div.col.basis') },
  ];

  return (
    <Section id="c1" title={t('div.s1.title')} subtitle={t('div.s1.sub')} open={open} onToggle={onToggle} testId="div-section-c1">
      <DataTable
        columns={cols}
        testId="div-facts"
        caption={`${t('div.col.period')}: ${formatHKTDate(Date.now() / 1000)} · ${currency ?? DASH}`}
        rows={[
          // The currency is the chart's own, not the statements' (§A.5.1) — it is
          // what every per-share figure below is denominated in.
          figureRow(
            t,
            t('div.f.currency'),
            null,
            <span className="div-val" data-testid="div-f-currency">
              {currency ?? DASH}
            </span>,
            t('div.basis.direct'),
          ),
          figureRow(
            t,
            t('div.f.indicated'),
            facts.indicatedYield.note,
            numCell(t, facts.indicatedYield, formatYield, 'div-f-indicated'),
            directBasis,
          ),
          figureRow(
            t,
            t('div.f.trailing'),
            facts.trailingYield.note,
            numCell(t, facts.trailingYield, formatYield, 'div-f-trailing'),
            directBasis,
          ),
          figureRow(
            t,
            // Labelled *indicated*, never "NTM consensus" — it is the annualised
            // indicated rate, which is a different claim (§C.1).
            `${t('div.f.forward')} (${t('div.tag.indicated')})`,
            facts.forwardYield.note,
            numCell(t, facts.forwardYield, formatYield, 'div-f-forward'),
            derivedBasis,
          ),
          figureRow(
            t,
            t('div.f.payout'),
            facts.payoutRatioLtm.note,
            numCell(t, facts.payoutRatioLtm, formatYield, 'div-f-payout'),
            t('div.basis.normalised'),
          ),
          figureRow(
            t,
            t('div.f.fiveYearAvg'),
            facts.fiveYearAvgYield.note,
            numCell(t, facts.fiveYearAvgYield, formatYield, 'div-f-5y'),
            t('div.basis.normalised'),
          ),
          figureRow(
            t,
            t('div.f.annualRate'),
            facts.annualRate.note,
            numCell(t, facts.annualRate, (v) => formatAmount(v, currency), 'div-f-rate'),
            directBasis,
          ),
          figureRow(
            t,
            t('div.f.lastDividend'),
            facts.lastDividendValue.note,
            numCell(t, facts.lastDividendValue, (v) => formatAmount(v, currency), 'div-f-last'),
            directBasis,
          ),
          figureRow(
            t,
            t('div.f.nextEx'),
            facts.nextExDate.note,
            numCell(t, facts.nextExDate, (v) => formatHKTDate(v), 'div-f-nextex'),
            directBasis,
          ),
          figureRow(
            t,
            t('div.f.nextPay'),
            facts.nextPayDate.note,
            numCell(t, facts.nextPayDate, (v) => formatHKTDate(v), 'div-f-nextpay'),
            directBasis,
          ),
          figureRow(
            t,
            t('div.f.frequency'),
            facts.frequency.note,
            <FrequencyValue freq={facts.frequency} />,
            facts.frequency.value === null ? t('div.basis.withheld') : derivedBasis,
          ),
        ]}
      />
      <p className="pf-hint" data-testid="div-s1-note">
        {t('div.s1.note')}
      </p>
    </Section>
  );
}

/** The derived frequency, or the dash when the two methods disagreed (§A.3). */
function FrequencyValue({ freq }: { freq: Sourced<FrequencyLabel> }) {
  const t = useT();
  const st = sourcedText<FrequencyLabel>(freq, (f) => {
    const key = frequencyKey(f);
    return key ? t(key) : DASH;
  });
  return <Cell st={st} testId="div-f-frequency" />;
}

/* -------------------------------------------------------------- §C.2 growth -- */

export function GrowthSection({
  open,
  onToggle,
  growth,
}: {
  open: boolean;
  onToggle: () => void;
  growth: DividendPayload['growth'];
}) {
  const t = useT();

  /**
   * A growth rate is one of the few *directional* figures on this screen, so it
   * gets a colour class — and the sign stays in the text, because colour alone
   * is not a signal a screen reader or a colour-blind reader can use (§B.3).
   */
  const growthCell = (s: Sourced<number>, testId: string) => {
    const st = sourcedText<number>(s, formatSignedPercent);
    return (
      <span
        className={cx('div-val', st.absent ? 'div-val-absent' : dirClass(s.value))}
        title={reasonText(t, s.note)}
        data-testid={testId}
      >
        {st.text}
      </span>
    );
  };

  return (
    <Section id="c2" title={t('div.s2.title')} subtitle={t('div.s2.sub')} open={open} onToggle={onToggle} testId="div-section-c2">
      <div className="pf-facts" data-testid="div-growth-stats">
        <Stat
          label={t('div.f.streak')}
          value={<Cell st={sourcedText<number>(growth.consecutiveAnnualIncreases, formatCount)} testId="div-g-streak" />}
          reason={reasonText(t, growth.consecutiveAnnualIncreases.note)}
          testId="div-stat-streak"
        />
        {(
          [
            ['1y', 'div-g-1y'],
            ['3y', 'div-g-3y'],
            ['5y', 'div-g-5y'],
            ['10y', 'div-g-10y'],
          ] as const
        ).map(([id, testId]) => (
          <Stat key={id} label={t(`div.g.${id}`)} value={growthCell(growth[`growth${id}`], testId)} testId={`div-stat-${id}`} />
        ))}
      </div>
      <p className="pf-hint" data-testid="div-s2-note">
        {t('div.s2.note')}
      </p>
      <p className="pf-hint" data-testid="div-s2-special">
        {t('div.s2.special')}
      </p>
    </Section>
  );
}

/* ------------------------------------------------- §C.3 shareholder yield -- */

export function ShareholderSection({
  open,
  onToggle,
  shareholder,
  currency,
}: {
  open: boolean;
  onToggle: () => void;
  shareholder: ShareholderYield;
  currency: string | null;
}) {
  const t = useT();
  const cols = [
    { key: 'k', label: t('div.col.figure') },
    { key: 'v', label: t('div.col.value'), align: 'right' as const },
    { key: 'b', label: t('div.col.basis') },
  ];

  return (
    <Section id="c3" title={t('div.s3.title')} subtitle={t('div.s3.sub')} open={open} onToggle={onToggle} testId="div-section-c3">
      <DataTable
        columns={cols}
        testId="div-shareholder"
        caption={`${t('div.col.asOf')}: ${shareholder.asOf || DASH} · ${currency ?? DASH}`}
        rows={[
          figureRow(
            t,
            t('div.f.shTotal'),
            shareholder.total.note,
            numCell(t, shareholder.total, formatYield, 'div-sh-total'),
            t('div.basis.derived'),
          ),
          figureRow(
            t,
            t('div.f.shDividend'),
            shareholder.dividendPart.note,
            numCell(t, shareholder.dividendPart, formatYield, 'div-sh-dividend'),
            t('div.basis.derived'),
          ),
          figureRow(
            t,
            t('div.f.shBuyback'),
            shareholder.buybackPart.note,
            numCell(t, shareholder.buybackPart, formatYield, 'div-sh-buyback'),
            t('div.basis.derived'),
          ),
          // The debt leg keeps its *sign*: a net debt increase is a negative
          // contribution and must not be shown as a positive "paydown" (§A.3.1).
          figureRow(
            t,
            t('div.f.shDebt'),
            shareholder.debtPaydownPart.note,
            numCell(t, shareholder.debtPaydownPart, formatYield, 'div-sh-debt'),
            t('div.basis.derived'),
          ),
        ]}
      />
      <p className="pf-hint" data-testid="div-s3-note">
        {t('div.s3.note')}
      </p>
    </Section>
  );
}

/* --------------------------------------------------------- §C.4 the graph -- */

/** The one span control, shared by the graph and the schedule. */
export function SpanControl({
  span,
  onChange,
  testId,
}: {
  span: string;
  onChange: (s: (typeof DIVIDEND_SPANS)[number]) => void;
  /** Distinct per section: a single shared test id would appear twice in the DOM. */
  testId: string;
}) {
  const t = useT();
  return (
    <Segmented
      options={DIVIDEND_SPANS.map((s) => ({ id: s, label: spanLabel(s) }))}
      value={span as (typeof DIVIDEND_SPANS)[number]}
      onChange={onChange}
      ariaLabel={t('div.span.aria')}
      testId={testId}
      size="sm"
    />
  );
}

/**
 * §C.4 — the payments/yield plot and §C.5 — the payout schedule.
 */

export function GraphSection({
  open,
  onToggle,
  history,
  span,
  loading,
  error,
  onSpan,
}: {
  open: boolean;
  onToggle: () => void;
  history: DividendHistoryPayload | null;
  span: string;
  loading: boolean;
  error: boolean;
  onSpan: (s: (typeof DIVIDEND_SPANS)[number]) => void;
}) {
  const t = useT();
  // The caption states the window in months because "5Y" is a chip label, not a
  // measurement — and `ALL` genuinely has no month count to state, so it gets
  // its own sentence rather than a fake number.
  const days = history && history.span !== 'ALL' ? SPAN_DAYS[history.span] : null;
  const windowNote = history
    ? history.span === 'ALL'
      ? t('div.span.allNote')
      : t('div.span.yearsNote', { months: Math.round((days ?? 0) / 30) })
    : null;

  return (
    <Section
      id="c4"
      title={t('div.s4.title')}
      subtitle={t('div.s4.sub')}
      open={open}
      onToggle={onToggle}
      testId="div-section-c4"
      actions={<SpanControl span={span} onChange={onSpan} testId="div-span-c4" />}
    >
      {error && !history ? (
        <p className="pf-empty" data-testid="div-c4-error">
          {t('div.error.title')}
        </p>
      ) : loading && !history ? (
        <p className="pf-empty">{t('pf.section.loading')}</p>
      ) : (
        <>
          <DividendChart
            history={history}
            emptyLabel={t('div.s4.empty')}
            testId="div-chart"
          />
          <div className="pf-legend" data-testid="div-legend">
            <span className="div-legend-bar">{t('div.s4.payments')}</span>
            <span className="div-legend-line">{t('div.s4.yield')}</span>
          </div>
          {history ? (
            <p className="pf-hint" data-testid="div-c4-caption">
              {/* The yield line genuinely starts later than the bars, and the
                  caption says which points were rebuilt rather than implying the
                  provider published them (§C.4). */}
              {history.reconstructed
                ? t('div.s4.reconstructed', { span: spanLabel(history.span) })
                : t('div.s4.live', { span: spanLabel(history.span) })}
              {windowNote ? ` · ${windowNote}` : ''}
            </p>
          ) : null}
        </>
      )}
    </Section>
  );
}

/* ------------------------------------------------------ §C.5 the schedule -- */

export function ScheduleSection({
  open,
  onToggle,
  history,
  span,
  loading,
  onSpan,
}: {
  open: boolean;
  onToggle: () => void;
  history: DividendHistoryPayload | null;
  span: string;
  loading: boolean;
  onSpan: (s: (typeof DIVIDEND_SPANS)[number]) => void;
}) {
  const t = useT();
  const cols = [
    { key: 'announced', label: t('div.col.announced') },
    { key: 'ex', label: t('div.col.exDate') },
    { key: 'record', label: t('div.col.record') },
    { key: 'payable', label: t('div.col.payable') },
    { key: 'ccy', label: t('div.col.currency') },
    { key: 'amount', label: t('div.col.amount'), align: 'right' as const },
    { key: 'adj', label: t('div.col.adjAmount'), align: 'right' as const },
    { key: 'freq', label: t('div.col.frequency') },
    { key: 'type', label: t('div.col.type') },
  ];

  // Newest first: the recent payments are what a reader came for, and the long
  // tail behaves as a scroll rather than as a wall of 1960s amounts.
  const rows = [...(history?.rows ?? [])].sort((a, b) => b.exDate - a.exDate);

  return (
    <Section
      id="c5"
      title={t('div.s5.title')}
      subtitle={t('div.s5.sub')}
      open={open}
      onToggle={onToggle}
      testId="div-section-c5"
      actions={<SpanControl span={span} onChange={onSpan} testId="div-span-c5" />}
    >
      {loading && !history ? (
        <p className="pf-empty">{t('pf.section.loading')}</p>
      ) : (
        <>
          <DataTable columns={cols} rows={rows.map((r) => scheduleRow(t, r))} testId="div-schedule" dense />
          <p className="pf-hint" data-testid="div-s5-absent">
            {t('div.s5.absent')}
          </p>
          <p className="pf-hint" data-testid="div-s5-adj">
            {t('div.s5.adj')}
          </p>
          <p className="pf-hint" data-testid="div-s5-payable">
            {t('div.s5.payable')}
          </p>
        </>
      )}
    </Section>
  );
}

/**
 * One schedule row.
 *
 * The four columns upstream does not carry — Announced, Record, Type and every
 * Payable except the next one — are rendered from the payload's own `null`
 * fields. Nothing here can invent them: the types in `shared/dividends.ts` are
 * literally `null`, so a future edit that tried would not compile.
 */
function scheduleRow(t: Translator, r: DividendScheduleRow): ReactNode[] {
  return [
    <span key="a" className="div-val-absent" title={t('div.s5.absent')} data-testid="div-row-announced">
      {DASH}
    </span>,
    <span key="e" className="div-val">
      {formatHKTDate(r.exDate)}
    </span>,
    <span key="r" className="div-val-absent" title={t('div.s5.absent')} data-testid="div-row-record">
      {DASH}
    </span>,
    <span key="p" className={cx('div-val', r.payableDate === null ? 'div-val-absent' : null)}>
      {r.payableDate === null ? DASH : formatHKTDate(r.payableDate)}
    </span>,
    <span key="c" className="div-val">
      {r.currency || DASH}
    </span>,
    <span key="m" className="div-val">
      {formatAmount(r.amount, null)}
    </span>,
    <span key="j" className="div-val" title={t('div.s5.adj')}>
      {formatAmount(r.adjAmount, null)}
    </span>,
    <span key="f" className="div-val">
      {r.frequency === null ? DASH : t(frequencyKey(r.frequency) ?? 'div.reason.notPublished')}
    </span>,
    <span key="t" className="div-val-absent" title={t('div.s5.absent')} data-testid="div-row-type">
      {DASH}
    </span>,
  ];
}

/* ---------------------------------------------------- §C.6 consistency ----- */

export function ConsistencySection({
  open,
  onToggle,
  payload,
  history,
  series,
  onExport,
  flash,
}: {
  open: boolean;
  onToggle: () => void;
  payload: DividendPayload;
  history: DividendHistoryPayload | null;
  series: DividendSeries;
  onExport: (kind: 'csv' | 'json') => void;
  flash: string | null;
}) {
  const t = useT();
  const currency = payload.facts.currency.value ?? history?.currency ?? null;

  return (
    <Section
      id="c6"
      title={t('div.s6.title')}
      subtitle={t('div.s6.sub')}
      open={open}
      onToggle={onToggle}
      testId="div-section-c6"
      actions={
        <>
          <button type="button" className="pf-act-btn" data-testid="div-export-csv" onClick={() => onExport('csv')}>
            {t('pf.act.export.csv')}
          </button>
          <button type="button" className="pf-act-btn" data-testid="div-export-json" onClick={() => onExport('json')}>
            {t('pf.act.export.json')}
          </button>
        </>
      }
    >
      <div className="pf-facts" data-testid="div-consistency">
        <Stat label={t('div.f.currency')} value={currency ?? DASH} testId="div-c6-currency" />
        <Stat
          label={t('div.col.asOf')}
          value={payload.lastUpdated === null ? DASH : formatHKTDate(payload.lastUpdated)}
          reason={t('div.reason.notPublished')}
          testId="div-c6-asof"
        />
        <Stat
          label={t('div.c6.span')}
          value={history ? spanLabel(history.span) : DASH}
          reason={t('div.s4.sub')}
          testId="div-c6-span"
        />
        <Stat
          label={t('div.c6.payments')}
          value={history === null ? DASH : formatCount(history.payments.length)}
          reason={t('div.s4.sub')}
          testId="div-c6-payments"
        />
        <Stat
          label={t('div.c6.yieldPoints')}
          value={history === null ? DASH : formatCount(history.yields.length)}
          reason={t('div.s4.sub')}
          testId="div-c6-yieldpoints"
        />
        <Stat
          label={t('div.c6.reconstructed')}
          value={history === null ? DASH : history.reconstructed ? t('div.c6.yes') : t('div.c6.no')}
          reason={t('div.s4.sub')}
          testId="div-c6-reconstructed"
        />
        <Stat label={t('div.c6.spansTitle')} value={series.spansAvailable.map(spanLabel).join(' · ')} testId="div-c6-spans" />
      </div>

      <p className="pf-hint" data-testid="div-s6-currency">
        {t('div.s6.currency')}
      </p>
      <p className="pf-hint" data-testid="div-s6-absent">
        {t('div.s6.absent')}
      </p>
      <p className="pf-hint" data-testid="div-s6-export">
        {t('div.s6.export')}
      </p>
      {flash !== null ? (
        <span className="pf-ok" data-testid="div-export-flash">
          {flash}
        </span>
      ) : null}
    </Section>
  );
}
