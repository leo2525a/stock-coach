/**
 * §C.3 / §C.4 / §C.6 — actuals vs consensus, the forecast matrix, the forward
 * level against price, and the estimate trend/breakdown.
 *
 * The honesty rules here are load-bearing, so they are stated where they bind:
 *
 *  - **Four periods exist upstream.** Further years are rendered as honest
 *    dashes with `pf.est.extraYearsNote` explaining why — not interpolated, not
 *    extrapolated (§A.5).
 *  - **The forward level is a level, not a series.** `forwardLevel()` sums the
 *    two published quarters (or falls back to the fiscal year) and the panel
 *    says which; the chart draws it as one horizontal point against the *real*
 *    price line. There is no invented past (§C.4).
 *  - **EBITDA / EBIT forecasts do not exist upstream**, so those matrix rows say
 *    so in words rather than showing a blank that reads as zero.
 */
import { useEffect, useState } from 'react';
import { useT } from '../i18n';
import { useStore, selectHistory } from '../store';
import { DataTable, NoData, RangeBar, Section, Segmented, compactMoney, dirClass, useMoney, type Column } from '../analyst/ui';
import { PriceSeriesChart } from './PriceSeriesChart';
import { useRefColors } from '../chart/theme';
import { AnimatedNumber } from '../analyst/ui';
import { formatNumber, formatPercent, formatPrice } from '../../shared/format';
import { evMultiple, priceMultiple, type EstimatePeriod, type EstimateSide } from '../../shared/estimates';
import { spanRange, SPANS, SPAN_INTERVAL, type Span } from '../../shared/fx';

/** The spans §C.5 asks for, applied to the *price history* only. */
const SPAN_LABELS: Record<Span, string> = {
  mtd: 'MTD',
  '1m': '1M',
  qtd: 'QTD',
  '3m': '3M',
  '6m': '6M',
  ytd: 'YTD',
  '1y': '1Y',
  '3y': '3Y',
  '5y': '5Y',
  '10y': '10Y',
};

export function EstimatesSection({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const t = useT();
  const estimates = useStore((s) => s.estimates);
  const load = useStore((s) => s.analystLoad);

  return (
    <Section
      id="estimates"
      title={t('pf.tab.estimates')}
      open={open}
      onToggle={onToggle}
    >
      {!estimates ? (
        <p className="pf-empty">
          {load.status === 'loading' ? (
            t('pf.section.loading')
          ) : (
            // Settled with no payload at all: the same honest "nothing to show"
            // as the parsed-but-empty case below, so it carries the same hook.
            <span data-testid="pf-est-none">{t('pf.empty.panel')}</span>
          )}
        </p>
      ) : estimates.periods.length === 0 ? (
        <p className="pf-empty" data-testid="pf-est-none">{t('pf.rat.none')}</p>
      ) : (
        <>
          <TrendTable periods={estimates.periods} extraYears={estimates.extraYears} currency={estimates.currency} ev={estimates.ev} />
          <CalendarBlock />
          <HistoryTable />
          <MatrixBlock currency={estimates.currency} />
          <ForwardLevelBlock />
        </>
      )}
    </Section>
  );
}

/* --------------------------------------------------------------- trend --- */

/** §C.6 — the four real periods, then honest further-year placeholders. */
function TrendTable({
  periods,
  extraYears,
  currency,
  ev,
}: {
  periods: readonly EstimatePeriod[];
  extraYears: number;
  currency: string | null;
  ev: number | null;
}) {
  const t = useT();
  const price = useStore((s) => s.estimates?.price ?? null);
  const { toDisplay } = useMoney();

  const cols: Column[] = [
    { key: 'period', label: t('pf.est.period') },
    { key: 'end', label: t('pf.est.endDate') },
    { key: 'eps', label: t('pf.est.eps'), align: 'right' },
    { key: 'epsRange', label: t('pf.est.range'), align: 'right' },
    { key: 'rev', label: t('pf.est.revenue'), align: 'right' },
    { key: 'analysts', label: t('pf.est.analysts'), align: 'right' },
    { key: 'yoy', label: t('pf.est.growth'), align: 'right' },
    { key: 'pe', label: t('pf.est.priceMultiple'), align: 'right' },
    { key: 'ev', label: t('pf.est.evMultiple'), align: 'right' },
  ];

  /** One EPS cell: the average plus its own low→high bar. */
  const epsCell = (side: EstimateSide) => {
    if (side.avg === null && side.low === null && side.high === null) return <NoData reason={t('pf.est.noEstimate')} />;
    return <AnimatedNumber value={side.avg} format={(v) => formatNumber(v, 2)} />;
  };

  const rows: React.ReactNode[][] = periods.map((p) => {
    const rev = p.revenue.avg === null ? null : toDisplay(p.revenue.avg, currency).amount;
    const pe = priceMultiple(price, p.eps.avg);
    const evm = evMultiple(ev, rev);
    return [
      <span key="p" title={t('pf.est.period.' + p.id)}>{t(`pf.est.period.${p.id}`)}</span>,
      p.endDate ?? <NoData />,
      epsCell(p.eps),
      <span key="r" className="pf-range-cell">
        <RangeBar
          low={p.eps.low}
          high={p.eps.high}
          mark={p.eps.avg}
          format={(v) => formatNumber(v, 2)}
          testId={`pf-eps-range-${p.id}`}
        />
        {p.eps.low !== null || p.eps.high !== null ? (
          <span className="pf-range-nums">
            {formatNumber(p.eps.low, 2)} – {formatNumber(p.eps.high, 2)}
          </span>
        ) : null}
      </span>,
      rev === null ? <NoData reason={t('pf.est.noEstimate')} /> : <AnimatedNumber value={rev} format={(v) => compactMoney(v, currency)} />,
      p.eps.analysts === null && p.revenue.analysts === null ? (
        <NoData reason={t('pf.est.noEstimate')} />
      ) : (
        <AnimatedNumber value={p.eps.analysts ?? p.revenue.analysts} format={(v) => formatNumber(v, 0)} />
      ),
      p.eps.growth === null ? (
        <NoData key="yoy" reason={t('pf.est.noEstimate')} />
      ) : (
        // A growth figure is directional: green for growth, red for a fall.
        <span key="yoy" className={dirClass(p.eps.growth)}>
          {formatPercent(p.eps.growth * 100)}
        </span>
      ),
      pe === null ? <NoData reason={t('pf.est.noEstimate')} /> : `${formatNumber(pe, 2)}x`,
      evm === null ? <NoData reason={t('pf.est.noEstimate')} /> : `${formatNumber(evm, 2)}x`,
    ];
  });

  // The years the provider does not carry. A generic column header, never a
  // fabricated FY label.
  for (let i = 0; i < extraYears; i += 1) {
    rows.push([
      <span key="p" className="pf-muted" title={t('pf.est.period.fyPlusHint')}>
        {t('pf.est.period.fyPlus', { n: i + 2 })}
      </span>,
      <NoData key="e" reason={t('pf.est.period.fyPlusHint')} />,
      <NoData key="a" reason={t('pf.est.period.fyPlusHint')} />,
      <NoData key="r" reason={t('pf.est.period.fyPlusHint')} />,
      <NoData key="v" reason={t('pf.est.period.fyPlusHint')} />,
      <NoData key="n" reason={t('pf.est.period.fyPlusHint')} />,
      <NoData key="g" reason={t('pf.est.period.fyPlusHint')} />,
      <NoData key="pe" reason={t('pf.est.period.fyPlusHint')} />,
      <NoData key="ev" reason={t('pf.est.period.fyPlusHint')} />,
    ]);
  }

  return (
    <>
      <h4 className="pf-subtitle">{t('pf.est.breakdown')}</h4>
      <DataTable columns={cols} rows={rows} testId="pf-est-trend" dense />
      {extraYears > 0 ? (
        <p className="pf-hint" data-testid="pf-est-extra-years">
          {t('pf.est.extraYears')}: {t('pf.est.extraYearsNote')}
        </p>
      ) : null}
    </>
  );
}

/* ------------------------------------------------------------ calendar --- */

/** §C.4 — the next earnings date, marked estimated or confirmed. */
function CalendarBlock() {
  const t = useT();
  const cal = useStore((s) => s.estimates?.calendar ?? null);
  if (!cal) return null;
  const hasAny = cal.nextEarningsLabel !== null || cal.epsAvg !== null || cal.revenueAvg !== null;
  if (!hasAny) {
    return (
      <>
        <h4 className="pf-subtitle">{t('pf.est.calendar.title')}</h4>
        <p className="pf-hint" data-testid="pf-calendar-none">{t('pf.est.calendar.none')}</p>
      </>
    );
  }
  return (
    <div className="pf-calendar" data-testid="pf-calendar">
      <h4 className="pf-subtitle">{t('pf.est.calendar.title')}</h4>
      <div className="pf-facts">
        <div className="pf-fact">
          <dt>{t('pf.est.calendar.title')}</dt>
          <dd>
            {cal.nextEarningsLabel ?? <NoData />}
            {cal.nextEarningsLabel ? (
              <span className="pf-tag soft">
                {cal.isEstimate ? t('pf.est.calendar.estimated') : t('pf.est.calendar.confirmed')}
              </span>
            ) : null}
          </dd>
        </div>
        <div className="pf-fact">
          <dt>{t('pf.est.calendar.epsAvg')}</dt>
          <dd>
            {cal.epsAvg === null ? (
              <NoData reason={t('pf.est.noEstimate')} />
            ) : (
              <>
                <AnimatedNumber value={cal.epsAvg} format={(v) => formatNumber(v, 2)} />
                {cal.epsLow !== null && cal.epsHigh !== null ? (
                  <span className="pf-hint"> · {formatNumber(cal.epsLow, 2)} – {formatNumber(cal.epsHigh, 2)}</span>
                ) : null}
              </>
            )}
          </dd>
        </div>
        <div className="pf-fact">
          <dt>{t('pf.est.calendar.revenueAvg')}</dt>
          <dd>
            {cal.revenueAvg === null ? (
              <NoData reason={t('pf.est.noEstimate')} />
            ) : (
              <AnimatedNumber value={cal.revenueAvg} format={(v) => compactMoney(v, null)} />
            )}
          </dd>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- history --- */

/** §C.3 — reported quarters vs the consensus that preceded them. */
function HistoryTable() {
  const t = useT();
  const history = useStore((s) => s.estimates?.history ?? []);
  if (history.length === 0) {
    return (
      <>
        <h4 className="pf-subtitle">{t('pf.est.history.title')}</h4>
        <p className="pf-hint" data-testid="pf-history-none">{t('pf.est.history.none')}</p>
      </>
    );
  }
  const cols: Column[] = [
    { key: 'q', label: t('pf.est.history.period') },
    { key: 'a', label: t('pf.est.history.actual'), align: 'right' },
    { key: 'e', label: t('pf.est.history.estimate'), align: 'right' },
    { key: 'd', label: t('pf.est.history.diff'), align: 'right' },
    { key: 's', label: t('pf.est.history.surprise'), align: 'right' },
  ];
  const rows = history.map((q) => [
    q.quarterLabel ?? <NoData />,
    <AnimatedNumber key="a" value={q.epsActual} format={(v) => formatNumber(v, 2)} />,
    q.epsEstimate === null ? <NoData key="e" /> : formatNumber(q.epsEstimate, 2),
    q.epsDifference === null ? (
      <NoData key="d" />
    ) : (
      <span key="d" className={dirClass(q.epsDifference)}>
        {q.epsDifference >= 0 ? '+' : ''}
        {formatNumber(q.epsDifference, 2)}
      </span>
    ),
    // A surprise against a consensus of zero is undefined, which the mapper
    // already reports as null.
    q.surprisePercent === null ? (
      <NoData key="s" reason={t('pf.est.noEstimate')} />
    ) : (
      <span key="s" className={dirClass(q.surprisePercent)}>
        {formatPercent(q.surprisePercent * 100)}
      </span>
    ),
  ]);
  return (
    <>
      <h4 className="pf-subtitle">{t('pf.est.history.title')}</h4>
      <DataTable columns={cols} rows={rows} testId="pf-est-history" dense />
    </>
  );
}

/* -------------------------------------------------------------- matrix --- */

/** §C.4 — next-period forecast vs last reported, with growth. */
function MatrixBlock({ currency }: { currency: string | null }) {
  const t = useT();
  const matrix = useStore((s) => s.estimates?.matrix ?? []);
  const { toDisplay } = useMoney();
  if (matrix.length === 0) return null;
  // Every row carries the same basis, so the first one states it for the table.
  const asOf = matrix[0]?.basis === 'quarter' ? (matrix[0].asOf ?? null) : null;
  const cols: Column[] = [
    { key: 'm', label: t('pf.est.matrix.metric') },
    { key: 'a', label: t('pf.est.matrix.actual'), align: 'right' },
    { key: 'f', label: t('pf.est.matrix.forecast'), align: 'right' },
    { key: 'g', label: t('pf.est.matrix.growth'), align: 'right' },
  ];
  const rows = matrix.map((r) => {
    const cell = (v: number | null) =>
      v === null ? null : r.kind === 'perShare' ? formatNumber(v, 2) : compactMoney(toDisplay(v, currency).amount, toDisplay(v, currency).currency);
    return [
      <span key="m" title={r.noEstimateUpstream ? t('pf.est.matrix.notCarried') : undefined}>
        {t(r.labelKey)}
      </span>,
      cell(r.actual) ?? <NoData key="a" />,
      // "No consensus upstream" is said in words. A dash beside a populated
      // actual row would read as "the estimate is zero".
      r.noEstimateUpstream ? (
        <span key="f" className="pf-muted" title={t('pf.est.matrix.notCarried')}>
          {t('pf.est.matrix.notCarried')}
        </span>
      ) : (
        cell(r.forecast) ?? <NoData key="f" reason={t('pf.est.noEstimate')} />
      ),
      r.growth === null ? (
        <NoData key="g" reason={r.noEstimateUpstream ? t('pf.est.matrix.notCarried') : t('pf.est.noEstimate')} />
      ) : (
        <span key="g" className={dirClass(r.growth)}>
          {formatPercent(r.growth * 100)}
        </span>
      ),
    ];
  });
  return (
    <>
      <h4 className="pf-subtitle">{t('pf.est.matrix.title')}</h4>
      {asOf !== null && (
        <p className="pf-note" data-testid="pf-est-matrix-asof">
          {t('pf.est.matrix.asOf', { asOf })} · {t('pf.est.matrix.basisNote')}
        </p>
      )}
      <DataTable columns={cols} rows={rows} testId="pf-est-matrix" dense />
    </>
  );
}

/* -------------------------------------------------------- forward level --- */

/**
 * §C.4 — the current forward estimate level against the real price history.
 *
 * The price line is *actual history*; the estimate is drawn as a single
 * horizontal level, because no historical estimate series exists upstream. The
 * note under the chart says exactly that, so the chart cannot be misread as a
 * "forecast line that tracked the price".
 */
function ForwardLevelBlock() {
  const t = useT();
  const symbol = useStore((s) => s.symbol);
  const estimates = useStore((s) => s.estimates);
  const forward = estimates?.forward ?? { eps: null, revenue: null, quarters: [], basis: null };
  const [span, setSpan] = useState<Span>('6m');
  const interval = SPAN_INTERVAL[span];
  const history = useStore(selectHistory(symbol, spanRange(span), interval));
  const loadHistory = useStore((s) => s.loadHistory);

  useEffect(() => {
    void loadHistory(spanRange(span), interval);
  }, [loadHistory, span, interval, symbol]);

  const display = useMoney();
  const price = estimates?.price ?? null;

  const epsLevel = forward.eps === null ? null : display.toDisplay(forward.eps, estimates?.currency ?? null).amount;
  const revLevel = forward.revenue === null ? null : display.toDisplay(forward.revenue, estimates?.currency ?? null).amount;

  const refColors = useRefColors();
  const lines = price === null ? [] : [{ value: price, color: refColors.price, title: t('pf.est.ntm.price') }];

  return (
    <div className="pf-ntm" data-testid="pf-ntm">
      <h4 className="pf-subtitle">{t('pf.est.ntm.title')}</h4>
      <div className="pf-meta-row">
        <Segmented
          options={SPANS.map((s) => ({ id: s, label: SPAN_LABELS[s] }))}
          value={span}
          onChange={setSpan}
          ariaLabel={t('pf.rat.band.span')}
          testId="pf-ntm-span"
          size="sm"
        />
      </div>
      {history === null ? (
        <p className="pf-hint">{t('pf.rat.band.noHistory')}</p>
      ) : (
        <PriceSeriesChart candles={history} lines={lines} testId="pf-ntm-chart" />
      )}
      <div className="pf-facts">
        <div className="pf-fact">
          <dt>{t('pf.est.ntm.level')}</dt>
          <dd data-testid="pf-ntm-level">
            {forward.eps === null ? (
              <NoData reason={t('pf.est.ntm.noEstimate')} />
            ) : (
              <>
                <AnimatedNumber value={epsLevel} format={(v) => formatPrice(v, display.display)} />
                <span className="pf-hint">
                  {' · '}
                  {forward.basis === 'quarters'
                    ? forward.quarters.map((q) => t(`pf.est.period.${q}`)).join(' + ')
                    : t('pf.est.period.0y')}
                </span>
              </>
            )}
          </dd>
        </div>
        <div className="pf-fact">
          <dt>{t('pf.est.ntm.price')}</dt>
          <dd>{formatPrice(price, estimates?.currency ?? undefined)}</dd>
        </div>
        {revLevel !== null && forward.basis === 'quarters' ? (
          <div className="pf-fact">
            <dt>{t('pf.est.side.revenue')}</dt>
            <dd>{compactMoney(revLevel, display.display)}</dd>
          </div>
        ) : null}
      </div>
      <p className="pf-hint" data-testid="pf-ntm-note">{t('pf.est.ntm.note')}</p>
    </div>
  );
}
