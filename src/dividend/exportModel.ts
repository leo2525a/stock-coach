/**
 * What is on the dividend screen → exportable tables (§C.6).
 *
 * Pure: it takes the already-loaded payload plus a formatting kit and returns
 * `ExportTable[]`. No store, no DOM, no translator of its own — "what you see is
 * what you export" is then a property the tests can check rather than a claim.
 *
 * Three rules carried over from Phase 3's export model:
 *   - A missing figure exports as the same dash the screen shows, never as an
 *     empty cell (an empty CSV cell reads as zero when imported).
 *   - **Annulled columns stay annulled.** Announced / Record / Type export as `—`
 *     because that is what the screen shows and what upstream actually carries —
 *     an export that invented them would be worse than the screen, not better.
 *   - The exported document carries its `asOf` and its currency, because a
 *     dividend table without a date is a number with no meaning (§C.6).
 */
import type { Translator } from '../../shared/i18n';
import type { DividendHistoryPayload, DividendPayload, FrequencyLabel } from '../../shared/dividends';
import type { ExportTable } from '../analyst/export';
import { DASH, formatAmount, formatCount, formatSignedPercent, formatYield, frequencyKey } from './format';

export interface DividendFormat {
  /** A per-share amount with its currency, or the dash. */
  amount: (value: number | null, currency: string | null) => string;
  /** A fraction as an unsigned percentage (`0.0221` → `2.21%`). */
  pct: (value: number | null) => string;
  /** A fraction as a *signed* percentage (`0.043` → `+4.30%`). */
  signedPct: (value: number | null) => string;
  /** A plain count, or the dash. */
  count: (value: number | null) => string;
  /** A UNIX-seconds stamp as an HKT date, or the dash. */
  date: (at: number | null) => string;
}

/** The default kit, so a caller (and the tests) can build tables without React. */
export const plainFormat: DividendFormat = {
  amount: (v, c) => formatAmount(v, c),
  pct: (v) => formatYield(v),
  signedPct: (v) => formatSignedPercent(v),
  count: (v) => formatCount(v),
  date: (at) => (at === null ? DASH : new Date(at * 1000).toISOString().slice(0, 10)),
};

/** `sourced.value` or the dash — the export twin of `sourcedText`. */
function v<T>(s: { value: T | null } | null | undefined): T | null {
  return s?.value ?? null;
}

/** A frequency through the dictionary, or the dash. Never a guessed label. */
export function frequencyText(t: Translator, freq: FrequencyLabel | null): string {
  const key = frequencyKey(freq);
  return key ? t(key) : DASH;
}

/**
 * Build every table the dividend export can contain.
 *
 * `history` is optional: the fact/growth/shareholder tables are span-independent,
 * so exporting while the graphs are still loading must still produce them.
 */
export function buildDividendTables(
  t: Translator,
  payload: DividendPayload | null,
  history: DividendHistoryPayload | null,
  f: DividendFormat = plainFormat,
): ExportTable[] {
  const tables: ExportTable[] = [];
  if (!payload) return tables;

  const currency = v(payload.facts.currency) ?? history?.currency ?? null;

  /* ---- §C.1 yield & frequency ---- */
  const facts = payload.facts;
  tables.push({
    title: t('div.s1.title'),
    columns: [t('div.col.figure'), t('div.col.value'), t('div.col.basis')],
    rows: [
      [t('div.f.currency'), currency ?? DASH, ''],
      [t('div.f.indicated'), f.pct(v(facts.indicatedYield)), t('div.basis.direct')],
      [t('div.f.trailing'), f.pct(v(facts.trailingYield)), t('div.basis.direct')],
      [
        `${t('div.f.forward')} (${t('div.tag.indicated')})`,
        f.pct(v(facts.forwardYield)),
        t('div.basis.derived'),
      ],
      [t('div.f.payout'), f.pct(v(facts.payoutRatioLtm)), t('div.basis.normalised')],
      [t('div.f.fiveYearAvg'), f.pct(v(facts.fiveYearAvgYield)), t('div.basis.normalised')],
      [t('div.f.annualRate'), f.amount(v(facts.annualRate), currency), t('div.basis.direct')],
      [t('div.f.lastDividend'), f.amount(v(facts.lastDividendValue), currency), t('div.basis.direct')],
      [t('div.f.nextEx'), f.date(v(facts.nextExDate)), t('div.basis.direct')],
      [t('div.f.nextPay'), f.date(v(facts.nextPayDate)), t('div.basis.direct')],
      [
        t('div.f.frequency'),
        frequencyText(t, v(facts.frequency)),
        v(facts.frequency) === null ? t('div.basis.withheld') : t('div.basis.derived'),
      ],
    ],
  });

  /* ---- §C.2 growth (directional) ---- */
  const g = payload.growth;
  tables.push({
    title: t('div.s2.title'),
    columns: [t('div.col.figure'), t('div.col.value'), t('div.col.basis')],
    rows: [
      [t('div.f.streak'), f.count(v(g.consecutiveAnnualIncreases)), t('div.basis.derived')],
      [t('div.g.1y'), f.signedPct(v(g.growth1y)), t('div.basis.derived')],
      [t('div.g.3y'), f.signedPct(v(g.growth3y)), t('div.basis.derived')],
      [t('div.g.5y'), f.signedPct(v(g.growth5y)), t('div.basis.derived')],
      [t('div.g.10y'), f.signedPct(v(g.growth10y)), t('div.basis.derived')],
    ],
  });

  /* ---- §C.3 shareholder yield ---- */
  const s = payload.shareholder;
  tables.push({
    title: t('div.s3.title'),
    columns: [t('div.col.figure'), t('div.col.value'), t('div.col.basis')],
    rows: [
      [t('div.f.shTotal'), f.pct(v(s.total)), t('div.basis.derived')],
      [t('div.f.shDividend'), f.pct(v(s.dividendPart)), t('div.basis.derived')],
      [t('div.f.shBuyback'), f.pct(v(s.buybackPart)), t('div.basis.derived')],
      [t('div.f.shDebt'), f.pct(v(s.debtPaydownPart)), t('div.basis.derived')],
      [t('div.col.asOf'), s.asOf || DASH, ''],
    ],
  });

  /* ---- §C.4 payments & yields (when a history span is loaded) ---- */
  if (history) {
    tables.push({
      title: `${t('div.s4.title')} — ${t('div.span.label')} ${history.span}`,
      columns: [t('div.col.date'), t('div.col.payment'), t('div.col.yield')],
      // The two series are interleaved by date so a reader can line a payment up
      // with the yield it produced, and a row with only one half stays honest
      // about which half it has.
      rows: mergeSeries(history, currency, f),
    });
  }

  /* ---- §C.5 payout schedule ---- */
  const rows = history?.rows ?? payload.events;
  tables.push({
    title: t('div.s5.title'),
    columns: [
      t('div.col.announced'),
      t('div.col.exDate'),
      t('div.col.record'),
      t('div.col.payable'),
      t('div.col.currency'),
      t('div.col.amount'),
      t('div.col.adjAmount'),
      t('div.col.frequency'),
      t('div.col.type'),
    ],
    // The four permanently-absent columns are emitted as dashes *here too*, so
    // an export cannot quietly start carrying an announced date the screen does
    // not have (§C.5, §F.2).
    rows: rows.map((r) => [
      DASH,
      f.date(r.exDate),
      DASH,
      f.date(r.payableDate),
      r.currency || DASH,
      f.amount(r.amount, r.currency),
      f.amount(r.adjAmount, r.currency),
      frequencyText(t, r.frequency),
      DASH,
    ]),
  });

  return tables;
}

/** Interleave payments and yield points onto one dated row set. */
function mergeSeries(
  history: DividendHistoryPayload,
  currency: string | null,
  f: DividendFormat,
): string[][] {
  const byDay = new Map<number, { payment: number | null; yield: number | null }>();
  const key = (at: number) => Math.floor(at / 86400);
  for (const p of history.payments) {
    const k = key(p.date);
    const cur = byDay.get(k) ?? { payment: null, yield: null };
    cur.payment = (cur.payment ?? 0) + p.amount;
    byDay.set(k, cur);
  }
  for (const y of history.yields) {
    const k = key(y.date);
    const cur = byDay.get(k) ?? { payment: null, yield: null };
    cur.yield = y.value;
    byDay.set(k, cur);
  }
  return [...byDay.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([k, v2]) => [
      f.date(k * 86400),
      v2.payment === null ? DASH : f.amount(v2.payment, currency),
      v2.yield === null ? DASH : f.pct(v2.yield),
    ]);
}
