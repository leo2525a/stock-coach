/**
 * Phase 4 dividends — pure-helper tests (SPEC-PHASE4 §D.1).
 *
 * The spec is unusually specific about what must be *falsifiable* here, and each
 * of these describes a real upstream trap found by RECON-PHASE4:
 *
 *   - `summaryDetail.dividendYield` is a fraction and `fiveYearAvgDividendYield`
 *     is a percent — reading the wrong one is a 100× error (§A.5);
 *   - `payoutRatio` arrives as a fraction (AAPL 0.118) *or* a percent (AGNC 72);
 *   - frequency is derived twice and must be withheld when the two disagree
 *     (0005.HK: arithmetic 31.4/yr vs chart spacing 4/yr);
 *   - COST's 2023 $10 special makes 5Y growth a fake −16.88% unless the outlier
 *     is detected and excluded;
 *   - the current calendar year is always partial and must never be counted;
 *   - `range=max` silently drops whole years of dividend events, so the history
 *     window is built from explicit `period1`/`period2`;
 *   - an empty `quoteSummary` envelope is "unavailable", never "pays 0".
 */
import { describe, expect, it } from 'vitest';
import {
  annualSeries,
  absent,
  assembleDividends,
  assembleHistory,
  buildSchedule,
  consecutiveIncreases,
  deriveFrequency,
  deriveGrowth,
  deriveShareholderYield,
  direct,
  frequencyFromPerYear,
  growthOver,
  hasQuoteSummary,
  isDividendSpan,
  isOutlierYear,
  median,
  medianGapDays,
  normalizeRatio,
  parseDividendEvents,
  parseDividendFacts,
  parseTrailingYield,
  percentToFraction,
  reconstructYields,
  spanWindow,
  upcomingRow,
  yieldLine,
  yearlyTotals,
  type RawDividendEvent,
} from '../shared/dividends';
import { NOTE_KEYS } from '../shared/api-errors';

const DAY = 86400;
const at = (iso: string) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / 1000);

/* ------------------------------------------------------------- harness ---- */

/** A chart payload carrying dividend events, monthly closes and a currency. */
function chart(
  events: Array<{ date: string; amount: number }>,
  closes: Array<{ date: string; close: number }> = [],
  currency = 'USD',
): unknown {
  return {
    chart: {
      result: [
        {
          meta: { currency, symbol: 'TEST', regularMarketPrice: closes.at(-1)?.close ?? 100 },
          timestamp: closes.map((c) => at(c.date)),
          events: {
            dividends: Object.fromEntries(
              events.map((e, i) => [String(i), { amount: e.amount, date: at(e.date) }]),
            ),
          },
          indicators: { quote: [{ close: closes.map((c) => c.close) }] },
        },
      ],
    },
  };
}

/** A `quoteSummary` payload with the dividend-relevant modules. */
function quoteSummary(modules: Record<string, unknown> = {}): unknown {
  return { quoteSummary: { result: [{ price: { currency: 'USD' }, ...modules }], error: null } };
}

/** Four years of quarterly payments at a given annual total. */
function quarters(year: number, perQuarter: number): Array<{ date: string; amount: number }> {
  return ['03-15', '06-15', '09-15', '12-15'].map((md) => ({
    date: `${year}-${md}`,
    amount: perQuarter,
  }));
}

/* -------------------------------------------------------------- numbers --- */

describe('§A.5 — unit normalisation', () => {
  it('leaves a fraction alone and converts a percent', () => {
    expect(normalizeRatio(0.118)).toBeCloseTo(0.118, 10);
    expect(normalizeRatio(0.6195)).toBeCloseTo(0.6195, 10);
    // AGNC really does publish 72 for a ~72% payout ratio.
    expect(normalizeRatio(72)).toBeCloseTo(0.72, 10);
  });

  it('refuses a payout ratio that is credible under neither reading', () => {
    // 5000 cannot be a fraction and would be a 5000% payout as a percent.
    expect(normalizeRatio(5000)).toBeNull();
    expect(normalizeRatio(null)).toBeNull();
    expect(normalizeRatio(Number.NaN)).toBeNull();
  });

  it('converts the five-year average yield from percent to fraction', () => {
    expect(percentToFraction(2.83)).toBeCloseTo(0.0283, 10);
    expect(percentToFraction(null)).toBeNull();
  });

  it('keeps a genuine >100% payout as a fraction rather than dividing it', () => {
    // O's payout ratio is 2.2199 — a legitimately above-100% *fraction*, and the
    // plain thresholds would read it as a 2.22% payout (a 100× error). The
    // provider's own rate÷EPS identity (O: 3.26 / 1.4687) settles the scale.
    const reference = 3.26 / 1.4687;
    expect(reference).toBeCloseTo(2.2199, 3);
    expect(normalizeRatio(2.2199, reference)).toBeCloseTo(2.2199, 6);
    // The identical value *as a percent* (221.99) must instead be divided.
    expect(normalizeRatio(221.99, reference)).toBeCloseTo(2.2199, 6);
  });

  it('uses the rate÷EPS identity to settle AGNC and AAPL too', () => {
    // AGNC publishes the percent form (72) and a rate/EPS of 0.72.
    expect(normalizeRatio(72, 0.72)).toBeCloseTo(0.72, 10);
    // AAPL publishes the fraction (0.118) and a rate/EPS of 0.118.
    expect(normalizeRatio(0.118, 0.118)).toBeCloseTo(0.118, 10);
  });

  it('withholds rather than guesses when the identity cannot settle the scale', () => {
    // 1.5 matches neither reading of the identity (0.5): it is 200% off as a
    // fraction and 97% off as a percent, so the scale stays unsettled and no
    // payout ratio is published. (The two readings can never *both* match for a
    // positive value, since that needs value ≈ value/100.)
    expect(normalizeRatio(1.5, 0.5)).toBeNull();
    // Without an identity the plain thresholds still apply.
    expect(normalizeRatio(0.5, null)).toBeCloseTo(0.5, 10);
    expect(normalizeRatio(0.5)).toBeCloseTo(0.5, 10);
  });
});

/* ------------------------------------------------------------ frequency --- */

describe('§A.3 — payment frequency is derived twice', () => {
  it('agrees for a stable quarterly payer, and says both methods agreed', () => {
    const events = [2022, 2023, 2024, 2025].flatMap((y) => quarters(y, 0.25));
    const r = deriveFrequency(1.0, 0.25, events.map((e) => at(e.date)));
    expect(r.frequency.value).toBe('quarterly');
    expect(r.frequency.source).toBe('derived');
    expect(r.frequency.note).toBe('note.dividendFrequencyDerived');
    expect(r.arithmeticPerYear).toBe(4);
    expect(r.gapPerYear).toBe(4);
  });

  it('withholds the frequency when the two methods disagree (0005.HK)', () => {
    // rate/last = 31.4 -> 31/yr, while the chart shows four payments a year.
    const events = [2023, 2024, 2025].flatMap((y) => quarters(y, 0.1));
    const r = deriveFrequency(3.14, 0.1, events.map((e) => at(e.date)));
    expect(r.frequency.value).toBeNull();
    expect(r.frequency.source).toBe('absent');
    expect(r.frequency.note).toBe('note.dividendFrequencyDisagree');
  });

  it('withholds entirely when there is no lastDividendValue and too few events', () => {
    const r = deriveFrequency(2.0, null, []);
    expect(r.frequency.value).toBeNull();
    expect(r.frequency.note).toBe('note.dividendFrequencyUnknown');
    expect(r.arithmeticPerYear).toBeNull();
  });

  it('treats a zero lastDividendValue as no last-dividend value at all', () => {
    // Guarding only on `!== null` would divide by zero and publish `Infinity/yr`.
    const r = deriveFrequency(2.0, 0, []);
    expect(r.arithmeticPerYear).toBeNull();
    expect(r.frequency.note).toBe('note.dividendFrequencyUnknown');
  });

  it('reports a spacing-only frequency, not "unknown", when only the chart exists', () => {
    const events = [2023, 2024, 2025].flatMap((y) => quarters(y, 0.1));
    const r = deriveFrequency(null, null, events.map((e) => at(e.date)));
    expect(r.frequency.value).toBe('quarterly');
    expect(r.frequency.note).toBe('note.dividendFrequencySpacingOnly');
    expect(r.arithmeticPerYear).toBeNull();
  });

  it('never claims "spacing only" when the arithmetic reading was computable but absurd', () => {
    // 0005.HK: rate/last = 31.4 matches no cadence, so the two methods disagree.
    const events = [2024, 2025].flatMap((y) => quarters(y, 0.1));
    const r = deriveFrequency(3.14, 0.1, events.map((e) => at(e.date)));
    expect(r.frequency.value).toBeNull();
    expect(r.frequency.note).toBe('note.dividendFrequencyDisagree');
    expect(r.arithmeticPerYear).toBe(31);
  });

  it('snaps an inferred 13 payments a year to monthly rather than inventing a 13/yr label', () => {
    expect(frequencyFromPerYear(13)).toBe('monthly');
    expect(frequencyFromPerYear(12)).toBe('monthly');
    expect(frequencyFromPerYear(0)).toBeNull();
    expect(frequencyFromPerYear(null)).toBeNull();
  });

  it('falls back to the arithmetic reading alone when the chart window is too short', () => {
    const r = deriveFrequency(1.0, 0.25, [at('2026-01-01'), at('2026-04-01')]);
    expect(r.frequency.value).toBe('quarterly');
    expect(r.frequency.note).toBe('note.dividendFrequencyArithmeticOnly');
  });

  it('ignores gaps that cannot be a normal payment cycle', () => {
    // A 20-year suspension and a same-day special must not move the median.
    const dates = [at('2000-01-01'), at('2020-01-01'), at('2020-04-01'), at('2020-07-01'), at('2020-10-01')];
    expect(medianGapDays(dates)).toBeCloseTo(91, 0);
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});

/* --------------------------------------------------------------- events --- */

describe('§A.2 — event parsing and the honest dashes', () => {
  it('parses, sorts and drops malformed events instead of zeroing them', () => {
    const json = {
      chart: {
        result: [
          {
            meta: { currency: 'HKD' },
            events: {
              dividends: {
                b: { amount: 1.5, date: 200 },
                a: { amount: 1, date: 100 },
                bad: { amount: 0, date: 300 },
                worse: { amount: 'x', date: 400 },
              },
            },
          },
        ],
      },
    };
    const events = parseDividendEvents(json);
    expect(events).toEqual([
      { date: 100, amount: 1 },
      { date: 200, amount: 1.5 },
    ]);
  });

  it('always renders announced / record / type as null, and payable next-only', () => {
    // §A.8 — the payable date is passed as a reconciled upcoming payment on a
    // *different* day, so this historical row keeps its `—` and is not merged.
    const rows = buildSchedule(
      [{ date: at('2026-06-15'), amount: 0.25 }],
      'USD',
      'quarterly',
      { exDate: at('2026-09-15'), amount: 0.25, payDate: at('2026-09-30') },
    );
    expect(rows[0].announcedDate).toBeNull();
    expect(rows[0].recordDate).toBeNull();
    expect(rows[0].type).toBeNull();
    // The payable date belongs to the NEXT payment, not to this historical row.
    expect(rows[0].payableDate).toBeNull();
    expect(rows[0].adjAmount).toBe(rows[0].amount);
  });

  it('labels the upcoming payment with its payable date and announced amount', () => {
    const facts = parseDividendFacts(
      quoteSummary({
        summaryDetail: { dividendRate: { raw: 1 }, exDividendDate: { raw: at('2026-12-01') } },
        defaultKeyStatistics: { lastDividendValue: { raw: 0.25 } },
        calendarEvents: { dividendDate: { raw: at('2026-12-15') } },
      }),
      25,
      [],
    );
    const row = upcomingRow(facts, 'quarterly');
    expect(row).not.toBeNull();
    expect(row!.exDate).toBe(at('2026-12-01'));
    expect(row!.payableDate).toBe(at('2026-12-15'));
  });

  it('invents no upcoming row when the amount or the date is missing', () => {
    const noAmount = parseDividendFacts(quoteSummary({ summaryDetail: { exDividendDate: { raw: 1 } } }), 1, []);
    expect(upcomingRow(noAmount, null)).toBeNull();
  });
});

/* ---------------------------------------------------------------- facts --- */

describe('§A.7 — an empty envelope is unavailable, never zero', () => {
  it('detects the "no quoteSummary key at all" failure shape', () => {
    expect(hasQuoteSummary({})).toBe(false);
    expect(hasQuoteSummary({ quoteSummary: { result: [] } })).toBe(false);
    expect(hasQuoteSummary(quoteSummary({}))).toBe(true);
  });

  it('maps every fact to absent — not 0 — when the envelope is empty', () => {
    const facts = parseDividendFacts({ finance: {} }, 100, []);
    for (const field of [
      facts.currency,
      facts.indicatedYield,
      facts.trailingYield,
      facts.forwardYield,
      facts.payoutRatioLtm,
      facts.fiveYearAvgYield,
      facts.annualRate,
      facts.lastDividendValue,
      facts.nextExDate,
      facts.nextPayDate,
    ] as const) {
      expect(field.value).toBeNull();
      expect(field.source).toBe('absent');
      expect(field.value).not.toBe(0);
    }
    expect(facts.frequency.value).toBeNull();
  });

  it('distinguishes a non-payer (real modules, no dividend fields) from an outage', () => {
    const facts = parseDividendFacts(quoteSummary({ summaryDetail: {}, defaultKeyStatistics: {} }), 200, []);
    // The envelope was usable, so the currency is a *direct* fact and the yields
    // are simply absent — the shape a TSLA/BRK-B row must have.
    expect(facts.currency.source).toBe('direct');
    expect(facts.indicatedYield.source).toBe('absent');
    expect(facts.indicatedYield.value).toBeNull();
  });

  it('renders the provider’s literal 0 for a non-payer as —, not as 0%', () => {
    // Live probe 2026-11-07: TSLA and BRK-B return `dividendYield: 0`,
    // `trailingAnnualDividendYield: 0`, `payoutRatio: 0` and no `dividendRate`.
    // The zero means "there is none"; a 0% yield would read as a paying company.
    const facts = parseDividendFacts(
      quoteSummary({
        summaryDetail: { dividendYield: { raw: 0 }, trailingAnnualDividendYield: { raw: 0 }, payoutRatio: { raw: 0 } },
        defaultKeyStatistics: {}
      }),
      300,
      [],
    );
    expect(facts.indicatedYield.value).toBeNull();
    expect(facts.trailingYield.value).toBeNull();
    expect(facts.payoutRatioLtm.value).toBeNull();
    expect(facts.indicatedYield.note).toBe('note.dividendNoDividend');
    expect(facts.forwardYield.value).toBeNull();
    // The frequency is still derived from a real zero rate as "unknown".
    expect(facts.frequency.value).toBeNull();
  });

  it('never turns a zero rate into a 0% forward yield', () => {
    const facts = parseDividendFacts(quoteSummary({ summaryDetail: { dividendRate: { raw: 0 } } }), 300, []);
    expect(facts.forwardYield.value).toBeNull();
  });

  it('takes units from the right fields for a paying symbol (KO)', () => {
    const facts = parseDividendFacts(
      quoteSummary({
        summaryDetail: {
          dividendRate: { raw: 2.12 },
          dividendYield: { raw: 0.0221 },
          trailingAnnualDividendYield: { raw: 0.021936696 },
          trailingAnnualDividendRate: { raw: 2.12 },
          payoutRatio: { raw: 0.6195 },
          fiveYearAvgDividendYield: { raw: 2.83 },
        },
        defaultKeyStatistics: { lastDividendValue: { raw: 0.53 }, trailingEps: { raw: 3.4226 } },
      }),
      95.9,
      [],
    );
    expect(facts.indicatedYield.value).toBeCloseTo(0.0221, 10);
    expect(facts.trailingYield.value).toBeCloseTo(0.021936696, 12);
    // 2.83 is a *percent*; showing it as 2.83 would be a 100× error.
    expect(facts.fiveYearAvgYield.value).toBeCloseTo(0.0283, 10);
    expect(facts.payoutRatioLtm.value).toBeCloseTo(0.6195, 10);
    expect(facts.forwardYield.note).toBe('note.dividendForwardIsIndicated');
  });

  it('normalises AGNC’s percent-form payout via the rate÷EPS identity', () => {
    const facts = parseDividendFacts(
      quoteSummary({
        summaryDetail: { payoutRatio: { raw: 72 }, trailingAnnualDividendRate: { raw: 1.44 } },
        defaultKeyStatistics: { trailingEps: { raw: 2.0 } },
      }),
      20,
      [],
    );
    expect(facts.payoutRatioLtm.value).toBeCloseTo(0.72, 10);
  });

  it('derives the forward yield from rate ÷ price when the provider omits it', () => {
    const facts = parseDividendFacts(quoteSummary({ summaryDetail: { dividendRate: { raw: 2.12 } } }), 100, []);
    expect(facts.forwardYield.value).toBeCloseTo(0.0212, 10);
    expect(facts.forwardYield.source).toBe('derived');
  });

  it('publishes no forward yield when neither the rate nor the price exists', () => {
    const facts = parseDividendFacts(quoteSummary({ summaryDetail: {} }), null, []);
    expect(facts.forwardYield.value).toBeNull();
    expect(facts.forwardYield.note).toBe('note.dividendIndicatedUnavailable');
  });

  /* §A.5.1 / §A.8 — N1: `dividendRate` is GBP while LSE quotes are GBp. ---- */
  it('reconciles a GBP annual rate onto the GBp series for an LSE name (N1)', () => {
    // Live 2026-11-07: ULVR.L `summaryDetail.dividendRate` = 1.56 (GBP) while the
    // chart/quotes are GBp. The provider's own identity (`dividendYield × price`
    // = 0.0311 × 4930 = 153.4) is the like-for-like reference; the raw rate is
    // 1/100 of it, so it is reconciled ×100 to 156 GBp, fixing both §C.1 and the
    // derived forward yield.
    const facts = parseDividendFacts(
      quoteSummary({ summaryDetail: { dividendRate: { raw: 1.56 }, dividendYield: { raw: 0.0311 }, currency: 'GBp' } }),
      4930,
      [],
    );
    expect(facts.annualRate.value).toBeCloseTo(156, 6);
    expect(facts.annualRate.source).toBe('direct');
    expect(facts.annualRate.note).toBe('note.dividendAmountScaleUnreconciled');
  });

  it('reconciles an LSE rate whose series is inflated by a special (HSBA, N1)', () => {
    // The yield identity is the reference, not the series — so a one-off special
    // in the payment history no longer forces a false `—`.
    // HSBA.L live: 0.3 (GBP) vs 0.0227 × 1304.6 = 29.6 (GBp) ⇒ ×100 ⇒ 30.
    const facts = parseDividendFacts(
      quoteSummary({ summaryDetail: { dividendRate: { raw: 0.3 }, dividendYield: { raw: 0.0227 }, currency: 'GBp' } }),
      1304.6,
      [],
    );
    expect(facts.annualRate.value).toBeCloseTo(30, 6);
    expect(facts.annualRate.note).toBe('note.dividendAmountScaleUnreconciled');
  });

  it('leaves a same-unit annual rate untouched — no false `—` (R1 regression)', () => {
    // 0005.HK live: `dividendRate` 3.14, `dividendYield` 0.0228, price 137.5.
    // 3.14 ÷ 137.5 = 0.0228 reproduces the yield exactly, so the rate is already
    // in the quote's unit and must be shown as-is. A reconciliation that compared
    // it to the payment series (ratio 0.47) wrongly withheld the correct figure.
    // NB: the reconciliation keys off `price × dividendYield`, not the currency
    // label, so this pins the same-unit arithmetic regardless of currency.
    const facts = parseDividendFacts(
      quoteSummary({ summaryDetail: { dividendRate: { raw: 3.14 }, dividendYield: { raw: 0.0228 }, currency: 'HKD' } }),
      137.5,
      [],
    );
    expect(facts.annualRate.value).toBeCloseTo(3.14, 10);
    expect(facts.annualRate.note).toBeUndefined();
  });

  it('leaves a same-unit (USD) annual rate untouched — no false positive (N1)', () => {
    const facts = parseDividendFacts(
      quoteSummary({ summaryDetail: { dividendRate: { raw: 2.12 }, dividendYield: { raw: 0.0222 } } }),
      95.67,
      [],
    );
    expect(facts.annualRate.value).toBeCloseTo(2.12, 10);
    expect(facts.annualRate.note).toBeUndefined();
  });

  it('trusts the raw annual rate when there is no like-for-like reference (no yield)', () => {
    // With no `dividendYield` there is no way to detect a unit mismatch, so the
    // honest choice is to show the provider figure rather than invent a scale
    // (and to keep deriving the forward yield from it).
    const facts = parseDividendFacts(quoteSummary({ summaryDetail: { dividendRate: { raw: 1.56 } } }), 4930, []);
    expect(facts.annualRate.value).toBeCloseTo(1.56, 10);
    expect(facts.annualRate.note).toBeUndefined();
    expect(facts.forwardYield.value).toBeCloseTo(1.56 / 4930, 10);
  });

});

/* --------------------------------------------------------------- growth --- */

describe('§A.3 — growth excludes the partial year and flags specials', () => {
  it('counts a clean increasing payer and never counts the partial current year', () => {
    const events: RawDividendEvent[] = [
      ...[1.0, 1.1, 1.2, 1.3].flatMap((a, i) =>
        quarters(2022 + i, a / 4).map((e) => ({ date: at(e.date), amount: e.amount })),
      ),
      // A single payment in the current (partial) year must not become a year.
      { date: at('2026-03-15'), amount: 0.3 },
    ];
    const series = annualSeries(events, 2026);
    expect(series.fullYears).toEqual([2022, 2023, 2024, 2025]);
    expect(consecutiveIncreases(series)).toBe(3);
    expect(growthOver(series, 1)).toBeCloseTo(1.3 / 1.2 - 1, 10);
  });

  it('detects the COST 2023 special and refuses to let it fake a −16.88% 5Y growth', () => {
    // 2023 = 4 × 1.0 regular + a 15.0 special = 18.96-like total.
    const events: RawDividendEvent[] = [];
    for (const [year, perQuarter] of [
      [2020, 0.85],
      [2021, 0.9],
      [2022, 0.95],
      [2023, 1.0],
      [2024, 1.05],
      [2025, 1.1],
    ] as const) {
      for (const e of quarters(year, perQuarter)) events.push({ date: at(e.date), amount: e.amount });
      if (year === 2023) events.push({ date: at('2023-12-20'), amount: 15.0 });
    }
    const totals = yearlyTotals(events);
    expect(totals.get(2023)).toBeCloseTo(19.0, 6);
    expect(isOutlierYear(2023, totals, [1, 1, 1, 1, 15])).toBe(true);
    expect(isOutlierYear(2025, totals, [1.1, 1.1, 1.1, 1.1])).toBe(false);

    const series = annualSeries(events, 2026);
    expect(series.excludedYears).toEqual([2023]);
    // With the special removed the 5Y growth is a sane ~+5%, not a fake −16.88%.
    const g5 = growthOver(series, 5)!;
    expect(g5).toBeGreaterThan(0);
    expect(g5).toBeLessThan(0.2);
  });

  it('reports growth as absent — not as a number — when history is too short', () => {
    const events = quarters(2025, 0.25).map((e) => ({ date: at(e.date), amount: e.amount }));
    const g = deriveGrowth(events, 2026);
    expect(g.growth5y.value).toBeNull();
    expect(g.growth5y.source).toBe('absent');
    expect(g.growth5y.note).toBe('note.dividendGrowthUnavailable');
  });

  it('carries the special-excluded note into the growth block', () => {
    const events: RawDividendEvent[] = [];
    for (const [year, perQuarter] of [
      [2021, 0.9],
      [2022, 0.95],
      [2023, 1.0],
      [2024, 1.05],
      [2025, 1.1],
    ] as const) {
      for (const e of quarters(year, perQuarter)) events.push({ date: at(e.date), amount: e.amount });
      if (year === 2023) events.push({ date: at('2023-12-20'), amount: 12.0 });
    }
    expect(deriveGrowth(events, 2026).growth3y.note).toBe('note.dividendSpecialExcluded');
  });
});

/* ---------------------------------------------------------------- spans --- */

describe('§A.1.2 / §A.4 — explicit windows, never range=max', () => {
  it('builds a period window and never emits range=max', () => {
    const now = at('2026-09-01');
    const w = spanWindow('5y', now);
    expect(w.period1).toBe(now - 5 * 365 * DAY);
    expect(w.period2).toBeGreaterThanOrEqual(now);
    expect(JSON.stringify(w)).not.toContain('max');
  });

  it('gives ALL the deepest window the provider sustains', () => {
    const now = at('2026-09-01');
    const w = spanWindow('ALL', now);
    expect(now - w.period1).toBe(60 * 365 * DAY);
  });

  it('only accepts the six documented spans', () => {
    expect(isDividendSpan('10y')).toBe(true);
    expect(isDividendSpan('ALL')).toBe(true);
    expect(isDividendSpan('max')).toBe(false);
    expect(isDividendSpan('2y')).toBe(false);
  });
});

/* --------------------------------------------------------------- series --- */

describe('§A.4 — yield line: real where it exists, reconstructed (and labelled) before', () => {
  it('parses the provider trailing series and keeps it fraction-valued', () => {
    const json = {
      timeseries: {
        result: [
          {
            meta: { type: ['trailingDividendYield'] },
            trailingDividendYield: [
              { asOfDate: '2026-09-30', dataValue: 0.0223 },
              { asOfDate: '2015-04-30', dataValue: 0.0307 },
            ],
          },
        ],
      },
    };
    const points = parseTrailingYield(json);
    expect(points.map((p) => p.date)).toEqual([at('2015-04-30'), at('2026-09-30')]);
    expect(points[0].source).toBe('yahoo:trailingDividendYield');
    expect(points[0].value).toBeCloseTo(0.0307, 6);
  });

  it('reconstructs LTM-dividends-÷-price and labels every point as reconstructed', () => {
    const events: RawDividendEvent[] = [
      { date: at('2014-03-15'), amount: 1 },
      { date: at('2014-06-15'), amount: 1 },
      { date: at('2014-09-15'), amount: 1 },
      { date: at('2014-12-15'), amount: 1 },
    ];
    const points = reconstructYields(events, [{ date: at('2014-12-31'), close: 100 }]);
    expect(points).toHaveLength(1);
    expect(points[0].value).toBeCloseTo(0.04, 10);
    expect(points[0].source).toBe('reconstructed');
  });

  it('never lets a reconstruction overwrite a real point', () => {
    const events: RawDividendEvent[] = [{ date: at('2016-06-15'), amount: 2 }];
    const chartJson = chart([], [{ date: '2016-06-30', close: 50 }]);
    const yieldJson = {
      timeseries: {
        result: [
          {
            meta: { type: ['trailingDividendYield'] },
            trailingDividendYield: [{ asOfDate: '2016-06-30', dataValue: 0.04 }],
          },
        ],
      },
    };
    const line = yieldLine(events, chartJson, yieldJson);
    const sameDay = line.filter((p) => p.date === at('2016-06-30'));
    expect(sameDay).toHaveLength(1);
    expect(sameDay[0].source).toBe('yahoo:trailingDividendYield');
  });
});

/* ---------------------------------------------------------- shareholder --- */

describe('§A.3.1 — shareholder yield: net debt, FY-end denominator, abs()', () => {
  it('uses net-of-issuance debt and an FY-end market cap (AAPL)', () => {
    const sy = deriveShareholderYield({
      dividendsPaid: -15_721_000_000,
      repurchaseOfStock: -86_390_000_000,
      longTermDebtPayments: -12_396_000_000,
      longTermDebtIssuance: 0,
      sharesAtFyEnd: 14_532_259_000,
      priceAtFyEnd: 254.63,
      asOf: '2026-09-30',
    });
    const mcap = 14_532_259_000 * 254.63;
    expect(sy.dividendPart.value).toBeCloseTo(15_721_000_000 / mcap, 12);
    expect(sy.buybackPart.value).toBeCloseTo(86_390_000_000 / mcap, 12);
    expect(sy.debtPaydownPart.value).toBeCloseTo(12_396_000_000 / mcap, 12);
    expect(sy.total.value).toBeCloseTo(
      (15_721_000_000 + 86_390_000_000 + 12_396_000_000) / mcap,
      12,
    );
    expect(sy.asOf).toBe('2026-09-30');
  });

  it('reports KO FY25 net debt as a NEGATIVE 13M contribution, not +13M', () => {
    const sy = deriveShareholderYield({
      dividendsPaid: -8_779_000_000,
      repurchaseOfStock: -746_000_000,
      longTermDebtPayments: -4_967_000_000,
      longTermDebtIssuance: 4_980_000_000,
      sharesAtFyEnd: 4_301_608_845,
      priceAtFyEnd: 70,
      asOf: '2025-12-31',
    });
    const mcap = 4_301_608_845 * 70;
    // |−4.967B| − |+4.980B| = −13M. The net is a small *increase* in debt, so the
    // leg must be **negative**: issuance is not a shareholder return. The naive
    // `payments − issuance` on raw provider signs would have said −9.947B (380×
    // the magnitude), a gross paydown would have said +4.967B, and `abs()`-ing the
    // net would have flipped the sign to +13M — all three wrong.
    expect(sy.debtPaydownPart.value).toBeCloseTo(-13_000_000 / mcap, 12);
    expect(sy.debtPaydownPart.value).toBeLessThan(0);
    // The total sums the three with the debt sign intact.
    expect(sy.total.value).toBeCloseTo((8_779_000_000 + 746_000_000 - 13_000_000) / mcap, 12);
  });

  it('reports IBM FY25 net issuance as a NEGATIVE 2.902B contribution', () => {
    // IBM FY25: −5.489B paid, +8.391B issued → a net *increase* of 2.902B. The leg
    // must therefore subtract 2.902B, not add it.
    const ibm = deriveShareholderYield({
      dividendsPaid: -6_000_000_000,
      repurchaseOfStock: -1_000_000_000,
      longTermDebtPayments: -5_489_000_000,
      longTermDebtIssuance: 8_391_000_000,
      sharesAtFyEnd: 1_000_000_000,
      priceAtFyEnd: 100,
      asOf: '2025-12-31',
    });
    expect(ibm.debtPaydownPart.value).toBeCloseTo(-2_902_000_000 / 100_000_000_000, 12);
    expect(ibm.debtPaydownPart.value).toBeLessThan(0);
    expect(ibm.total.value).toBeCloseTo((6_000_000_000 + 1_000_000_000 - 2_902_000_000) / 100_000_000_000, 12);
  });

  it('reports a genuine net PAYDOWN as a POSITIVE contribution', () => {
    // payments 5B > issuance 1B ⇒ 4B genuinely retired, which *is* a positive
    // shareholder return. This pins the other sign, so neither direction is free.
    const sy = deriveShareholderYield({
      dividendsPaid: -1_000_000_000,
      repurchaseOfStock: -500_000_000,
      longTermDebtPayments: -5_000_000_000,
      longTermDebtIssuance: 1_000_000_000,
      sharesAtFyEnd: 1_000_000_000,
      priceAtFyEnd: 100,
      asOf: '2025-12-31',
    });
    expect(sy.debtPaydownPart.value).toBeCloseTo(4_000_000_000 / 100_000_000_000, 12);
    expect(sy.debtPaydownPart.value).toBeGreaterThan(0);
    expect(sy.total.value).toBeCloseTo((1_000_000_000 + 500_000_000 + 4_000_000_000) / 100_000_000_000, 12);
  });

  it('keeps an exactly-zero net at zero, with no sign', () => {
    const sy = deriveShareholderYield({
      dividendsPaid: -1,
      repurchaseOfStock: -1,
      longTermDebtPayments: -2_000_000_000,
      longTermDebtIssuance: 2_000_000_000,
      sharesAtFyEnd: 1_000_000_000,
      priceAtFyEnd: 100,
      asOf: '2025-12-31',
    });
    expect(sy.debtPaydownPart.value).toBe(0);
    expect(Object.is(sy.debtPaydownPart.value, -0)).toBe(false);
  });

  it('withholds a component and the total when the FY-end market cap is unknown', () => {
    const sy = deriveShareholderYield({
      dividendsPaid: -1,
      repurchaseOfStock: -1,
      longTermDebtPayments: -1,
      longTermDebtIssuance: 0,
      sharesAtFyEnd: null,
      priceAtFyEnd: null,
      asOf: '2025-12-31',
    });
    expect(sy.total.value).toBeNull();
    expect(sy.total.source).toBe('absent');
    expect(sy.dividendPart.value).toBeNull();
  });

  it('withholds the total when any leg is missing', () => {
    const sy = deriveShareholderYield({
      dividendsPaid: -1,
      repurchaseOfStock: null,
      longTermDebtPayments: -1,
      longTermDebtIssuance: 0,
      sharesAtFyEnd: 100,
      priceAtFyEnd: 10,
      asOf: '2025-12-31',
    });
    expect(sy.total.value).toBeNull();
    expect(sy.total.note).toBe('note.dividendShareholderIncomplete');
  });
});

/* -------------------------------------------------------------- assembly --- */

describe('§A.6 — payload assembly', () => {
  const shareholder = {
    dividendsPaid: null,
    repurchaseOfStock: null,
    longTermDebtPayments: null,
    longTermDebtIssuance: null,
    sharesAtFyEnd: null,
    priceAtFyEnd: null,
    asOf: '',
  };

  it('assembles a facts payload from all three upstreams', () => {
    const events = [2022, 2023, 2024, 2025].flatMap((y) => quarters(y, 0.25));
    const payload = assembleDividends({
      symbol: 'KO',
      now: at('2026-09-01'),
      price: 95.9,
      factsJson: quoteSummary({
        summaryDetail: { dividendRate: { raw: 1 }, dividendYield: { raw: 0.01 } },
        defaultKeyStatistics: { lastDividendValue: { raw: 0.25 } },
      }),
      chartJson: chart(events),
      yieldJson: null,
      shareholder,
      source: 'live',
      lastUpdated: 1,
      note: null,
    });
    expect(payload.symbol).toBe('KO');
    expect(payload.facts.frequency.value).toBe('quarterly');
    expect(payload.series.payments).toHaveLength(16);
    expect(payload.series.spansAvailable).toEqual(['1y', '3y', '5y', '10y', '20y', 'ALL']);
  });

  it('keeps the history flow alive when the facts envelope is empty', () => {
    const events = [2024, 2025].flatMap((y) => quarters(y, 0.25));
    const payload = assembleDividends({
      symbol: 'KO',
      now: at('2026-09-01'),
      price: 95.9,
      // The §A.7 outage: no `quoteSummary` key at all.
      factsJson: { finance: {} },
      chartJson: chart(events),
      yieldJson: null,
      shareholder,
      source: 'unavailable',
      lastUpdated: null,
      note: 'note.dividendFactsUnavailable',
    });
    expect(payload.facts.indicatedYield.value).toBeNull();
    // …but the crumb-free history is untouched.
    expect(payload.series.payments.length).toBe(8);
    expect(payload.series.payments[0].amount).toBeCloseTo(0.25, 10);
  });

  it('assembles a history payload for one span with its own payments', () => {
    const events = [2024, 2025, 2026].flatMap((y) => quarters(y, 0.3));
    const payload = assembleHistory({
      symbol: 'KO',
      span: '3y',
      now: at('2026-09-01'),
      price: null,
      factsJson: quoteSummary({ summaryDetail: { dividendRate: { raw: 1.2 } } }),
      chartJson: chart(events, [], 'HKD'),
      yieldJson: null,
      source: 'live',
      lastUpdated: 2,
      note: null,
    });
    expect(payload.span).toBe('3y');
    expect(payload.currency).toBe('HKD');
    expect(payload.payments).toHaveLength(12);
    expect(payload.reconstructed).toBe(false);
  });
});

/* ------------------------------------------------------------ provenance --- */

describe('provenance helpers', () => {
  it('never marks a missing value as direct or derived', () => {
    expect(direct<number>(null).source).toBe('absent');
    expect(direct<number>(0).source).toBe('direct');
    expect(direct<number>(0).value).toBe(0);
    expect(absent<number>('note.dividendGrowthUnavailable').note).toBe('note.dividendGrowthUnavailable');
  });

  it('every note this module can emit is a registered dictionary key', () => {
    const emitted = [
      deriveFrequency(1, 0.25, []).frequency.note, // arithmetic-only
      deriveFrequency(3.14, 0.1, [at('2023-01-01'), at('2023-04-01'), at('2023-07-01')]).frequency.note,
      parseDividendFacts({ finance: {} }, 1, []).indicatedYield.note,
      parseDividendFacts({ finance: {} }, 1, []).forwardYield.note,
      parseDividendFacts(quoteSummary({ summaryDetail: { payoutRatio: { raw: 0.5 } } }), 1, []).payoutRatioLtm.note,
      parseDividendFacts(quoteSummary({ summaryDetail: { fiveYearAvgDividendYield: { raw: 2.8 } } }), 1, [])
        .fiveYearAvgYield.note,
      deriveGrowth([], 2026).growth1y.note,
      deriveShareholderYield(shareholder0()).total.note,
    ];
    for (const note of emitted) {
      expect(note, 'a note key must be registered').toBeTruthy();
      expect((NOTE_KEYS as readonly string[]).includes(note!), `unregistered note: ${note}`).toBe(true);
    }
  });
});

function shareholder0() {
  return {
    dividendsPaid: -1,
    repurchaseOfStock: -1,
    longTermDebtPayments: -1,
    longTermDebtIssuance: 0,
    sharesAtFyEnd: null,
    priceAtFyEnd: null,
    asOf: '',
  };
}

/* ------------------------------------------------- §A.8 schedule coherence --- */

describe('§A.8 — one payment is exactly one row', () => {
  const shareholder = {
    dividendsPaid: null,
    repurchaseOfStock: null,
    longTermDebtPayments: null,
    longTermDebtIssuance: null,
    sharesAtFyEnd: null,
    priceAtFyEnd: null,
    asOf: '',
  };

  it('merges the upcoming payment into its chart row when they share the day', () => {
    // The chart stamps the same ex-date at 13:30Z, the calendar at 00:00Z; they
    // are the same day and must not become two rows (the QA defect).
    const exChart = at('2026-10-30') + 13.5 * 3600;
    const exCal = at('2026-10-30');
    const rows = buildSchedule(
      [{ date: exChart, amount: 0.272 }],
      'USD',
      'quarterly',
      { exDate: exCal, amount: 0.272, payDate: at('2026-11-13') },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].exDate).toBe(exChart);
    expect(rows[0].amount).toBeCloseTo(0.272, 10);
    // The reconciled payable date is stamped onto the existing chart row.
    expect(rows[0].payableDate).toBe(at('2026-11-13'));
  });

  it('appends a genuinely-new upcoming payment only when no row matches its day', () => {
    const rows = buildSchedule(
      [{ date: at('2026-07-30'), amount: 0.25 }],
      'USD',
      'quarterly',
      { exDate: at('2026-10-30'), amount: 0.27, payDate: at('2026-11-13') },
    );
    expect(rows).toHaveLength(2);
    expect(rows[1].exDate).toBe(at('2026-10-30'));
    expect(rows[0].payableDate).toBeNull();
  });

  it('never renders a Payable Date earlier than its own Ex-Date — it shows —', () => {
    // AAPL shape: ex 2026-11-12 but pay 2026-08-13 (91 days earlier).
    const facts = parseDividendFacts(
      quoteSummary({
        summaryDetail: { exDividendDate: { raw: at('2026-11-12') } },
        defaultKeyStatistics: { lastDividendValue: { raw: 0.27 } },
        calendarEvents: { dividendDate: { raw: at('2026-08-13') } },
      }),
      270,
      [],
    );
    const row = upcomingRow(facts, 'quarterly', [0.26, 0.27, 0.27]);
    expect(row).not.toBeNull();
    expect(row!.exDate).toBe(at('2026-11-12'));
    expect(row!.payableDate).toBeNull();
  });

  it('reconciles a pence/pound (100x) upcoming amount to the series unit', () => {
    // ULVR.L: lastDividendValue 0.3907 in pounds, chart series in pence (39.82).
    const facts = parseDividendFacts(
      quoteSummary({
        summaryDetail: { exDividendDate: { raw: at('2026-11-12') }, currency: 'GBp' },
        defaultKeyStatistics: { lastDividendValue: { raw: 0.3907 } },
      }),
      39.07,
      [],
    );
    const row = upcomingRow(facts, 'quarterly', [39.82, 40.46, 40.52]);
    expect(row).not.toBeNull();
    expect(row!.amount).toBeCloseTo(39.07, 6);
  });

  it('withholds an upcoming amount whose scale cannot be reconciled', () => {
    // 0005.HK: lastDividendValue 0.1 against a same-day chart amount 0.7839
    // (7.8x) — the ratio fits no supported factor, so show nothing.
    const facts = parseDividendFacts(
      quoteSummary({
        summaryDetail: { exDividendDate: { raw: at('2026-11-05') }, currency: 'HKD' },
        defaultKeyStatistics: { lastDividendValue: { raw: 0.1 } },
      }),
      29.5,
      [],
    );
    expect(upcomingRow(facts, null, [0.7839, 0.7839, 0.7839])).toBeNull();
  });

  it('the assembled payload carries no two rows for the same Ex-Date day, both routes', () => {
    const exChart = at('2026-10-30') + 13.5 * 3600;
    const chartJson = chart([{ date: '2026-07-30', amount: 0.25 }, { date: '2026-10-30', amount: 0.272 }]);
    // Stamp the chart's last event at 13:30Z to reproduce the exact pair.
    const raw = chartJson as { chart: { result: Array<{ events: { dividends: Record<string, { date: number; amount: number }> } }> } };
    raw.chart.result[0].events.dividends['1'].date = exChart;
    const factsJson = quoteSummary({
      summaryDetail: { exDividendDate: { raw: at('2026-10-30') } },
      defaultKeyStatistics: { lastDividendValue: { raw: 0.272 } },
      calendarEvents: { dividendDate: { raw: at('2026-11-13') } },
    });
    const base = {
      symbol: 'O',
      now: at('2026-11-01'),
      price: 60,
      factsJson,
      chartJson,
      yieldJson: null,
      shareholder,
      source: 'live',
      lastUpdated: 1,
      note: null,
    };
    const main = assembleDividends(base);
    const hist = assembleHistory({ ...base, span: '5y' } as never);
    for (const rows of [main.events, hist.rows]) {
      const days = rows.map((r) => Math.floor(r.exDate / 86400));
      expect(new Set(days).size).toBe(days.length);
      for (const r of rows) {
        if (r.payableDate !== null) expect(r.payableDate).toBeGreaterThanOrEqual(r.exDate);
      }
    }
  });
});

describe('§A.8 — no positional year runs', () => {
  const totals = (entries: Array<[number, number]>) => new Map(entries);

  it('a 17-year suspension breaks the streak instead of counting as an increase', () => {
    // AAPL shape: … 1995, then a hole to 2012, then clean rises to 2025.
    const years = [1995, 2012, 2013, 2014, 2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025];
    const map = totals(years.map((y, i) => [y, 1 + i * 0.05]));
    const series = { fullYears: years, excludedYears: [], totals: map };
    // Positionally the naive walk counts 15; honestly the streak is 13 (the
    // 1995→2012 jump is not a consecutive-year increase).
    expect(consecutiveIncreases(series)).toBe(13);
  });

  it('a contiguous rising payer still counts its whole run', () => {
    const years = [2020, 2021, 2022, 2023, 2024, 2025];
    const map = totals(years.map((y, i) => [y, 1 + i * 0.1]));
    expect(consecutiveIncreases({ fullYears: years, excludedYears: [], totals: map })).toBe(5);
  });

  it('growthOver uses the actual calendar year, not a positional offset', () => {
    // A hole inside the 5Y window must not let an 8-year span masquerade as 5Y.
    const years = [2017, 2018, 2020, 2021, 2022, 2023, 2024, 2025];
    const map = totals(years.map((y) => [y, 2]));
    const series = { fullYears: years, excludedYears: [], totals: map };
    // 2025 - 5 = 2020 exists → a real 5Y figure.
    expect(growthOver(series, 5)).toBeCloseTo(0, 10);
    // 2025 - 10 = 2015 is absent → the horizon is unavailable, not positionally faked.
    expect(growthOver(series, 10)).toBeNull();
  });
});

/* ------------------------------------------------ §A.8 next-payable facts --- */

describe('§A.8 — the facts-level next-payable date obeys monotonicity', () => {
  it('withholds a next-payable that precedes its own ex-date', () => {
    // AAPL shape: ex 2026-11-12, pay 2026-08-13 (91 days earlier).
    const facts = parseDividendFacts(
      quoteSummary({
        summaryDetail: { exDividendDate: { raw: at('2026-11-12') } },
        calendarEvents: { dividendDate: { raw: at('2026-08-13') } },
      }),
      270,
      [],
    );
    expect(facts.nextExDate.value).toBe(at('2026-11-12'));
    expect(facts.nextPayDate.value).toBeNull();
    expect(facts.nextPayDate.source).toBe('absent');
    expect(facts.nextPayDate.note).toBe('note.dividendPayableBeforeEx');
  });

  it('withholds a next-payable on the same day as its ex-date', () => {
    const facts = parseDividendFacts(
      quoteSummary({
        summaryDetail: { exDividendDate: { raw: at('2026-11-12') } },
        calendarEvents: { dividendDate: { raw: at('2026-11-12') } },
      }),
      270,
      [],
    );
    expect(facts.nextPayDate.value).toBeNull();
    expect(facts.nextPayDate.source).toBe('absent');
  });

  it('keeps a next-payable that is strictly after its ex-date', () => {
    const facts = parseDividendFacts(
      quoteSummary({
        summaryDetail: { exDividendDate: { raw: at('2026-12-01') } },
        calendarEvents: { dividendDate: { raw: at('2026-12-15') } },
      }),
      270,
      [],
    );
    expect(facts.nextPayDate.value).toBe(at('2026-12-15'));
    expect(facts.nextPayDate.source).toBe('direct');
  });

  it('the assembled payload carries the same validated payable, both routes', () => {
    const chartJson = chart([{ date: '2026-08-06', amount: 0.41 }]);
    const factsJson = quoteSummary({
      summaryDetail: { exDividendDate: { raw: at('2026-11-12') }, currency: 'GBp' },
      defaultKeyStatistics: { lastDividendValue: { raw: 39.07 } },
      calendarEvents: { dividendDate: { raw: at('2026-08-13') } },
    });
    const base = {
      symbol: 'ULVR.L',
      now: at('2026-11-01'),
      price: 100,
      factsJson,
      chartJson,
      yieldJson: null,
      shareholder: {
        dividendsPaid: null,
        repurchaseOfStock: null,
        longTermDebtPayments: null,
        longTermDebtIssuance: null,
        sharesAtFyEnd: null,
        priceAtFyEnd: null,
        asOf: '',
      },
      source: 'live',
      lastUpdated: 1,
      note: null,
    };
    const main = assembleDividends(base);
    const hist = assembleHistory({ ...base, span: '5y' } as never);
    expect(main.facts.nextPayDate.value).toBeNull();
    // The schedule agrees: no row pairs an early payable with this ex-date.
    for (const r of [...main.events, ...hist.rows]) {
      if (r.payableDate !== null) expect(r.payableDate).toBeGreaterThan(r.exDate);
    }
  });
});
