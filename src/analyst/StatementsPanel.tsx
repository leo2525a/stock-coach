/**
 * §C.2 — financial statements, structure and the derived ratios.
 *
 * The three things this panel must not do, and how it avoids them:
 *
 *  - **Invent a column.** The period switch is LTM / quarterly / annual, and each
 *    column is one the provider actually reported. The LTM column says
 *    「LTM (computed)」 beside it, because it is our arithmetic, not the
 *    company's reported figure (§A.5).
 *  - **Turn a gap into a zero.** Every cell falls through to `—`, with
 *    `pf.stmt.lineNote` stating what a dash means.
 *  - **Bury the arithmetic.** Each ratio's formula is one hover away
 *    (`title`), keyed by `formulaKey`, so a number the user doubts is a number
 *    they can check against the table directly above it.
 */
import { useMemo } from 'react';
import { useT } from '../i18n';
import { useStore } from '../store';
import { DataTable, NoData, Section, Segmented, compactMoney, dirClass, useMoney, type Column } from '../analyst/ui';
import { formatCompact, formatNumber, formatPercent, formatPrice } from '../../shared/format';
import { formatMetricValue, type Metric } from '../../shared/metrics';
import type { StatementPeriod, StatementTable } from '../../shared/statements';

interface MetricGroup {
  id: string;
  titleKey: string;
  /** The metric ids that belong here, in display order. */
  ids: readonly string[];
}

/**
 * Which computed ratios belong to which sub-panel.
 *
 * Keyed by metric id (not by array position) so reordering the metric list in
 * `shared/metrics.ts` can never silently move a ratio into the wrong group — if
 * an id is missing here it simply is not shown, which is a visible bug rather
 * than a wrong label.
 */
const METRIC_GROUPS: readonly MetricGroup[] = [
  { id: 'mult', titleKey: 'pf.mult.title', ids: ['pe', 'pb', 'ps', 'evRevenue', 'evEbitda', 'evEbit'] },
  {
    id: 'prof',
    titleKey: 'pf.prof.title',
    ids: ['grossMargin', 'operatingMargin', 'netMargin', 'ebitdaMargin', 'roe', 'roa', 'roic'],
  },
  {
    id: 'solv',
    titleKey: 'pf.solv.title',
    ids: [
      'debtToEquity',
      'ltDebtToEquity',
      'debtToCapital',
      'liabToAssets',
      'currentRatio',
      'ebitToInterest',
      'ebitdaToInterest',
      'debtToEbitda',
      'netDebtToEbitda',
      'debtToEbitdaCapex',
    ],
  },
];

/**
 * The period-over-period change of a row, as a ratio: latest column vs the one
 * before it.
 *
 * `null` unless both columns carry a finite figure and the earlier one is a
 * usable base (non-zero). A `null` here means "no change can be computed" and
 * the UI prints the honest dash — never a fabricated 0%.
 */
function latestChange(values: readonly (number | null)[]): number | null {
  const n = values.length;
  if (n < 2) return null;
  const prev = values[n - 2];
  const last = values[n - 1];
  if (prev === null || last === null || !Number.isFinite(prev) || !Number.isFinite(last)) return null;
  if (prev === 0) return null;
  return (last - prev) / Math.abs(prev);
}

const PERIOD_ORDER: readonly StatementPeriod[] = ['ltm', 'quarterly', 'annual'];

export function StatementsSection({
  open,
  onToggle,
}: {
  open: boolean;
  onToggle: () => void;
}) {
  const t = useT();
  const statements = useStore((s) => s.statements);
  const load = useStore((s) => s.statementsLoad);
  const period = useStore((s) => s.statementsPeriod);
  const setPeriod = useStore((s) => s.setStatementsPeriod);
  const displayCurrency = useStore((s) => s.displayCurrency);
  const { toDisplay } = useMoney();

  const segments = useMemo(
    () =>
      PERIOD_ORDER.map((id) => ({
        id,
        label: t(`pf.period.${id}`),
        title: t(`pf.period.${id}Hint`),
      })),
    [t],
  );

  /**
   * The currency every statement figure is reported in.
   *
   * Taken from the table itself where it is stated, so a company reporting in
   * HKD is not silently converted into a dollars figure. `null` means the
   * provider did not say, and the figures then stay as reported.
   */
  const sourceCurrency = statements?.currency ?? statements?.income.currency ?? null;

  /** Whether the display-currency conversion actually applied. */
  const probe = toDisplay(1, sourceCurrency);
  const fellBack = probe.fellBack;

  const cell = (table: StatementTable) => (value: number | null, kind: string): React.ReactNode => {
    if (value === null || !Number.isFinite(value)) return null; // → the table renders the dash
    if (kind === 'number') return formatCompact(value);
    const c = toDisplay(value, table.currency ?? sourceCurrency);
    if (c.amount === null) return null;
    return kind === 'perShare' ? formatPrice(c.amount, c.currency) : compactMoney(c.amount, c.currency);
  };

  const tableFor = (titleKey: string, table: StatementTable, testId: string) => {
    const cols: Column[] = [
      { key: 'label', label: t('pf.stmt.title') },
      ...table.columns.map((c, i) => ({ key: `c${i}`, label: c, align: 'right' as const })),
      // One extra column: the change of the latest period against the one before
      // it, as a signed percentage. It is a *derived* figure, labelled as such
      // beneath the table (`pf.stmt.changeNote`), never presented as reported.
      { key: 'chg', label: t('pf.stmt.change'), align: 'right' as const },
    ];
    const rows = table.rows.map((row) => {
      const delta = latestChange(row.values);
      return [
        <span key="l" className={`pf-line${row.computed ? ' computed' : ''}`} title={row.computed ? t('pf.computedNote') : undefined}>
          {t(row.labelKey)}
        </span>,
        ...row.values.map((v) => {
          const node = cell(table)(v, row.kind);
          return node ?? <NoData reason={t('pf.stmt.missing')} />;
        }),
        delta === null ? (
          <NoData key="chg" reason={t('pf.stmt.changeNote')} />
        ) : (
          <span key="chg" className={dirClass(delta)}>
            {formatPercent(delta * 100)}
          </span>
        ),
      ];
    });
    return (
      <DataTable
        key={testId}
        testId={testId}
        dense
        columns={cols}
        rows={rows}
        caption={table.rows.length === 0 ? t('pf.stmt.empty') : undefined}
      />
    );
  };

  const metricValue = (m: Metric) =>
    formatMetricValue(m, {
      compact: formatCompact,
      num: (v, digits) => formatNumber(v, digits ?? 2),
      noData: t('common.noData'),
    });

  return (
    <Section
      id="statements"
      title={t('pf.tab.statements')}
      open={open}
      onToggle={onToggle}
      actions={
        <Segmented
          options={segments}
          value={period}
          onChange={(id) => setPeriod(id)}
          ariaLabel={t('pf.period.aria')}
          testId="pf-period"
          size="sm"
        />
      }
    >
      {!statements ? (
        // Exactly one state, never two at once: a thin provider bundle is
        // "nothing to show", a failed fetch is an error, and in-flight is
        // loading. Showing the error banner *and* the neutral placeholder
        // together just reads as clutter (簡潔, not 亂).
        load.status === 'error' ? (
          <p className="pf-empty" data-testid="pf-stmt-error">
            {t('pf.error.title')}
          </p>
        ) : load.status === 'loading' ? (
          <p className="pf-empty">{t('pf.section.loading')}</p>
        ) : (
          <p className="pf-empty" data-testid="pf-stmt-none">
            {t('pf.empty.panel')}
          </p>
        )
      ) : (
        <>
          <div className="pf-meta-row">
            <span className="pf-hint" data-testid="pf-stmt-period">
              {period === 'ltm' ? t('pf.computed') : t(`pf.period.${period}`)}
              {' · '}
              {t('pf.column.count', { count: statements.income.columns.length })}
            </span>
            {statements.metrics.asOf ? <span className="pf-hint">{t('pf.metric.asOf', { date: statements.metrics.asOf })}</span> : null}
            {sourceCurrency ? <span className="pf-hint">{t('pf.stmt.currencyPer', { currency: sourceCurrency })}</span> : null}
            {displayCurrency !== sourceCurrency ? (
              <span className="pf-hint" data-testid="pf-currency-fallback">
                {fellBack
                  ? t('pf.currency.fellBack', { to: displayCurrency, from: sourceCurrency ?? displayCurrency })
                  : t('pf.currency.rate', {
                      from: sourceCurrency ?? displayCurrency,
                      rate: formatNumber(probe.rate, 4),
                      to: displayCurrency,
                    })}
              </span>
            ) : null}
          </div>
          {period === 'ltm' ? <p className="pf-hint" data-testid="pf-computed-note">{t('pf.computedNote')}</p> : null}

          {tableFor('pf.stmt.income', statements.income, 'pf-stmt-income')}
          {tableFor('pf.stmt.balance', statements.balance, 'pf-stmt-balance')}
          {tableFor('pf.stmt.cashflow', statements.cashflow, 'pf-stmt-cashflow')}
          <p className="pf-hint" data-testid="pf-stmt-change-note">{t('pf.stmt.changeNote')}</p>
          <p className="pf-hint">{t('pf.stmt.lineNote')}</p>

          <div className="pf-metrics" data-testid="pf-metrics">
            <div className="pf-metric-summary">
              <MetricHead label={t('pf.metric.marketCap')} value={compactMoney(statements.metrics.marketCap, sourceCurrency)} />
              <MetricHead label={t('pf.metric.ev')} value={compactMoney(statements.metrics.ev, sourceCurrency)} />
              <MetricHead label={t('pf.metric.netDebt')} value={compactMoney(statements.metrics.netDebt, sourceCurrency)} />
            </div>
            {METRIC_GROUPS.map((group) => {
              const items = group.ids
                .map((id) => statements.metrics.items.find((m) => m.id === id))
                .filter((m): m is Metric => m !== undefined);
              if (items.length === 0) return null;
              return (
                <div className="pf-metric-group" key={group.id} data-testid={`pf-metrics-${group.id}`}>
                  <h4 className="pf-subtitle">{t(group.titleKey)}</h4>
                  <DataTable
                    dense
                    testId={`pf-table-${group.id}`}
                    columns={[
                      { key: 'k', label: t('pf.period.label') },
                      { key: 'v', label: t('pf.mult.title'), align: 'right' },
                    ]}
                    rows={items.map((m) => [
                      // The formula is the tooltip on *both* the label and the
                      // value, so hovering whichever one the eye landed on works.
                      <span key="k" title={`${t('pf.metric.formula')}: ${t(m.formulaKey)}`}>
                        {t(m.labelKey)}
                      </span>,
                      <span key="v" className="pf-metric-v" title={`${t('pf.metric.formula')}: ${t(m.formulaKey)}`}>
                        {metricValue(m)}
                      </span>,
                    ])}
                  />
                </div>
              );
            })}
            <p className="pf-hint">{t('pf.metric.note')}</p>
          </div>
        </>
      )}
    </Section>
  );
}

/** One of the three headline figures above the ratio tables. */
function MetricHead({ label, value }: { label: string; value: string }) {
  return (
    <div className="pf-metric-head">
      <span className="pf-stat-k">{label}</span>
      <span className="pf-stat-v">{value}</span>
    </div>
  );
}
