/**
 * Turns whatever is on the analyst screen into exportable tables (§C.1).
 *
 * Pure: it takes already-loaded payloads plus a small formatting kit and returns
 * `ExportTable[]`. No store, no DOM, no translator lookup of its own — which is
 * what makes "what you see is what you export" testable rather than a claim.
 *
 * Two rules carried over from the rest of Phase 3:
 *   - A missing value exports as the same dash the screen shows, never as an
 *     empty cell (an empty CSV cell reads as zero when imported).
 *   - The reason a line is blank travels with it as a note row, so a reader of
 *     the file knows a dash means "not published", not "we forgot".
 */
import type { Translator } from '../../shared/i18n';
import type { StatementsPayload, EstimatesPayload, RatingsFullPayload, QuoteOverview } from '../../shared/types';
import { formatMetricValue } from '../../shared/metrics';
import type { Metric } from '../../shared/metrics';
import type { EstimateSide } from '../../shared/estimates';
import type { ExportTable } from './export';

export interface ExportFormat {
  /** A statement figure in the display currency. */
  money: (value: number | null, currency: string | null) => string;
  /** A plain number, `digits` decimals. */
  num: (value: number | null, digits?: number) => string;
  /** A fraction rendered as a signed percentage (0.123 → `+12.30%`). */
  pct: (value: number | null) => string;
  /** A compact count/volume. */
  compact: (value: number | null) => string;
  /** A UNIX-seconds stamp as a readable HKT date, or the dash. */
  date: (at: number | null) => string;
}

const dash = (t: Translator) => t('common.noData');

/** One metric, its formula and its value — the traceable form of a ratio. */
function metricRow(t: Translator, m: Metric, f: ExportFormat): string[] {
  return [t(m.labelKey), formatMetricValue(m, { compact: f.compact, num: f.num, noData: dash(t) }), t(m.formulaKey)];
}

/**
 * Estimate side rows, flat: average, low, high, a year ago, analysts, growth.
 *
 * Used by both the trend table and the per-period breakdown, so the two cannot
 * disagree about which estimate figure is which.
 */
function sideRows(t: Translator, label: string, side: EstimateSide, f: ExportFormat): string[][] {
  const none = t('pf.est.noEstimate');
  return [
    [label, t('pf.est.avg'), side.avg === null ? none : f.num(side.avg, 2)],
    [label, t('pf.est.low'), side.low === null ? none : f.num(side.low, 2)],
    [label, t('pf.est.high'), side.high === null ? none : f.num(side.high, 2)],
    [label, t('pf.est.yearAgo'), side.yearAgo === null ? none : f.num(side.yearAgo, 2)],
    [label, t('pf.est.analysts'), side.analysts === null ? none : f.num(side.analysts, 0)],
    [label, t('pf.est.growth'), side.growth === null ? none : f.pct(side.growth)],
  ];
}

/**
 * Build every table the export can contain.
 *
 * A section with no data is **omitted**, not exported empty — an empty table in
 * a CSV reads as "we measured nothing", which is not what happened.
 */
export function buildExportTables(args: {
  t: Translator;
  symbol: string;
  quote: QuoteOverview | null;
  statements: StatementsPayload | null;
  estimates: EstimatesPayload | null;
  ratings: RatingsFullPayload | null;
  format: ExportFormat;
  /** The header the ratings/summary table carries. */
  headers: { metric: string; value: string };
}): ExportTable[] {
  const { t, symbol, quote, statements, estimates, ratings, format: f, headers } = args;
  const tables: ExportTable[] = [];

  if (quote) {
    tables.push({
      title: t('pf.head.title'),
      columns: [headers.metric, headers.value],
      rows: [
        [t('pf.head.name'), quote.name ?? dash(t)],
        [t('pf.head.exchange'), quote.exchange ?? dash(t)],
        [t('pf.head.marketState'), quote.marketState ?? dash(t)],
        [t('pf.head.sector'), quote.sector ?? dash(t)],
        [t('pf.head.industry'), quote.industry ?? dash(t)],
        [t('pf.asOf', { date: f.date(quote.lastUpdated) }), quote.marketState ?? dash(t)],
        [t('pf.head.prevClose'), f.num(quote.previousClose, 2)],
        [t('pf.head.dayHigh'), f.num(quote.dayHigh, 2)],
        [t('pf.head.dayLow'), f.num(quote.dayLow, 2)],
        [t('pf.head.w52'), `${f.num(quote.fiftyTwoWeekLow, 2)} – ${f.num(quote.fiftyTwoWeekHigh, 2)}`],
        [t('pf.head.volume'), f.compact(quote.volume)],
        [t('pf.head.marketCap'), f.compact(quote.marketCap)],
        [t('pf.head.trailingPE'), f.num(quote.trailingPE, 2)],
        [t('pf.head.forwardPE'), f.num(quote.forwardPE, 2)],
        // Omitted when unpublished, exactly as on screen — never exported as 0.
        ...(quote.preMarket === null ? [] : [[t('pf.head.preMarket'), f.num(quote.preMarket, 2)]]),
        ...(quote.postMarket === null ? [] : [[t('pf.head.postMarket'), f.num(quote.postMarket, 2)]]),
      ],
    });
  }

  if (statements) {
    const per = statements.currency ?? '';
    for (const [key, table] of [
      ['pf.stmt.income', statements.income],
      ['pf.stmt.balance', statements.balance],
      ['pf.stmt.cashflow', statements.cashflow],
    ] as const) {
      if (table.rows.length === 0 || table.columns.length === 0) continue;
      tables.push({
        title: t(key),
        columns: [t('pf.period.label'), ...table.columns],
        rows: [
          ...table.rows.map((row) => [
            t(row.labelKey),
            ...row.values.map((v) => f.money(v, per || null)),
          ]),
          // The dash explanation travels with the file.
          [t('pf.stmt.lineNote'), ...table.columns.map(() => '')],
        ],
      });
    }

    if (statements.metrics.items.length > 0) {
      tables.push({
        title: t('pf.recap.metrics'),
        columns: [headers.metric, headers.value, t('pf.metric.formula')],
        rows: statements.metrics.items.map((m) => metricRow(t, m, f)),
      });
    }
  }

  if (estimates) {
    tables.push({
      title: t('pf.est.trend'),
      columns: [
        t('pf.est.period'),
        t('pf.est.side.eps'),
        t('pf.est.side.revenue'),
        t('pf.est.analysts'),
      ],
      rows: [
        ...estimates.periods.map((p) => [
          `${t(`pf.est.period.${p.id}`)}${p.endDate ? ` (${p.endDate})` : ''}`,
          p.eps.avg === null ? t('pf.est.noEstimate') : f.num(p.eps.avg, 2),
          p.revenue.avg === null ? t('pf.est.noEstimate') : f.compact(p.revenue.avg),
          f.num(p.eps.analysts, 0),
        ]),
        // The full breakdown, one small block per period.
        ...estimates.periods.flatMap((p) => [
          ...sideRows(t, `${t('pf.est.side.eps')} · ${t(`pf.est.period.${p.id}`)}`, p.eps, f),
          ...sideRows(t, `${t('pf.est.side.revenue')} · ${t(`pf.est.period.${p.id}`)}`, p.revenue, f),
        ]),
      ],
    });

    if (estimates.history.length > 0) {
      tables.push({
        title: t('pf.est.history.title'),
        columns: [
          t('pf.est.history.period'),
          t('pf.est.history.actual'),
          t('pf.est.history.estimate'),
          t('pf.est.history.diff'),
          t('pf.est.history.surprise'),
        ],
        rows: estimates.history.map((q) => [
          q.quarterLabel ?? dash(t),
          f.num(q.epsActual, 2),
          f.num(q.epsEstimate, 2),
          f.num(q.epsDifference, 2),
          q.surprisePercent === null ? dash(t) : f.pct(q.surprisePercent),
        ]),
      });
    }

    tables.push({
      title: t('pf.est.matrix.title'),
      columns: [t('pf.est.matrix.metric'), t('pf.est.matrix.actual'), t('pf.est.matrix.forecast'), t('pf.est.matrix.growth')],
      rows: estimates.matrix.map((r) => [
        t(r.labelKey),
        f.money(r.actual, estimates.currency),
        r.noEstimateUpstream ? t('pf.est.matrix.notCarried') : f.money(r.forecast, estimates.currency),
        f.pct(r.growth),
      ]),
    });
  }

  if (ratings) {
    tables.push({
      title: t('pf.rat.band.title'),
      columns: [headers.metric, headers.value],
      rows: [
        [t('pf.rat.score'), f.num(ratings.ratings.recommendationMean, 2)],
        [t('pf.rat.analysts'), f.num(ratings.ratings.numberOfAnalystOpinions, 0)],
        [t('pf.rat.low'), f.num(ratings.target.low, 2)],
        [t('pf.rat.mean'), f.num(ratings.target.mean, 2)],
        [t('pf.rat.median'), f.num(ratings.target.median, 2)],
        [t('pf.rat.high'), f.num(ratings.target.high, 2)],
        [t('pf.rat.currentPrice'), f.num(ratings.price, 2)],
        [t('pf.rat.upside'), f.pct(ratings.target.upsidePct)],
        [t('pf.rat.oneYear'), f.pct(ratings.oneYearReturn)],
      ],
    });

    const buckets = ratings.ratings.buckets;
    if (buckets.length > 0) {
      tables.push({
        title: t('pf.rat.distribution'),
        columns: [t('pf.rat.bucket'), t('pf.rat.strongBuy'), t('pf.rat.buy'), t('pf.rat.hold'), t('pf.rat.sell'), t('pf.rat.strongSell')],
        rows: buckets.map((b) => [
          b.period,
          f.num(b.strongBuy, 0),
          f.num(b.buy, 0),
          f.num(b.hold, 0),
          f.num(b.sell, 0),
          f.num(b.strongSell, 0),
        ]),
      });
    }

    if (ratings.actions.length > 0) {
      tables.push({
        title: t('pf.rat.actions'),
        columns: [
          t('pf.rat.date'),
          t('pf.rat.firm'),
          t('pf.rat.from'),
          t('pf.rat.to'),
          t('pf.rat.action'),
          t('pf.rat.currentTarget'),
        ],
        rows: ratings.actions.map((a) => [
          a.dateLabel ?? dash(t),
          a.firm ?? dash(t),
          a.fromGrade ?? dash(t),
          a.toGrade ?? dash(t),
          a.action ?? dash(t),
          a.currentPriceTarget === null ? dash(t) : f.num(a.currentPriceTarget, 2),
        ]),
      });
    }
  }

  // The symbol is always somewhere in the file, so a folder of exports is
  // unambiguous.
  if (tables.length > 0) {
    tables.unshift({
      title: t('pf.title'),
      columns: [headers.metric, headers.value],
      rows: [[t('pf.head.name'), symbol]],
    });
  }

  return tables;
}
