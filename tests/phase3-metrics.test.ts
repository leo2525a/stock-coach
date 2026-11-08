/**
 * Phase 3 — derived metrics and estimate math (§A.3, §D.1).
 *
 * The point of this file is **cross-checking**: every formula the UI shows is
 * recomputed here from its raw inputs, independently of `deriveMetrics`. If the
 * two ever disagree, one of them is wrong and the test says which. A test that
 * called `deriveMetrics` and compared it to itself would prove nothing.
 *
 * The second job is the honesty rule (§A.3 / §D.1): a missing input must yield
 * `null` — never `0`, `NaN` or `Infinity`. Those three are the failure modes the
 * spec is most explicit about, because each one *looks* like real data.
 */
import { describe, expect, it } from 'vitest';
import {
  deriveMetrics,
  enterpriseValue,
  investedCapital,
  marketCap,
  netDebt,
  nopat,
  roic,
} from '../shared/metrics';
import { metricInputsFor, type MetricInputs } from '../shared/statements';
import {
  evMultiple,
  forwardLevel,
  growthBetween,
  parseEarningsTrend,
  priceMultiple,
  priceTargetView,
  parseRatings,
  parseUpgrades,
  periodMatrix,
  ESTIMATE_PERIODS,
  type EstimatePeriod,
} from '../shared/estimates';

/** A complete, internally consistent input set (real-ish AAPL LTM figures). */
function fullInputs(over: Partial<MetricInputs> = {}): MetricInputs {
  return {
    asOf: '2026-09-27',
    revenue: 400_000_000_000,
    grossProfit: 180_000_000_000,
    operatingIncome: 120_000_000_000,
    ebit: 120_000_000_000,
    ebitda: 140_000_000_000,
    netIncome: 100_000_000_000,
    interestExpense: 4_000_000_000,
    pretaxIncome: 125_000_000_000,
    taxProvision: 25_000_000_000,
    totalAssets: 360_000_000_000,
    totalLiabilities: 280_000_000_000,
    stockholdersEquity: 80_000_000_000,
    totalDebt: 100_000_000_000,
    longTermDebt: 90_000_000_000,
    currentDebt: 10_000_000_000,
    cash: 30_000_000_000,
    currentAssets: 130_000_000_000,
    currentLiabilities: 110_000_000_000,
    inventory: 8_000_000_000,
    operatingCashFlow: 115_000_000_000,
    capitalExpenditure: -11_000_000_000,
    freeCashFlow: 104_000_000_000,
    dilutedEps: 6.5,
    sharesOutstanding: 15_000_000_000,
    currency: 'USD',
    ...over,
  };
}

/** Look one metric up by id, failing loudly if the id is not produced. */
function metricOf(items: ReturnType<typeof deriveMetrics>['items'], id: string) {
  const found = items.find((m) => m.id === id);
  expect(found, `metric '${id}' must exist`).toBeDefined();
  return found!;
}

describe('phase 3 — derived metrics cross-check against an independent recompute', () => {
  const price = 200;
  const inputs = fullInputs();
  const m = deriveMetrics(inputs, price);
  const mcap = 15_000_000_000 * price; // shares × price
  const ev = mcap + 100_000_000_000 - 30_000_000_000;

  it('market cap is shares × price, not the provider figure', () => {
    expect(m.marketCap).toBe(mcap);
    expect(marketCap(15_000_000_000, price)).toBe(mcap);
  });

  it('EV = market cap + total debt − cash', () => {
    expect(m.ev).toBe(ev);
    expect(enterpriseValue(mcap, 100_000_000_000, 30_000_000_000)).toBe(ev);
  });

  it('net debt = total debt − cash', () => {
    expect(m.netDebt).toBe(70_000_000_000);
    expect(netDebt(100_000_000_000, 30_000_000_000)).toBe(70_000_000_000);
  });

  it('P/E, P/B, P/S match price ÷ per-share and mcap ÷ line', () => {
    expect(metricOf(m.items, 'pe').value).toBeCloseTo(price / 6.5, 10);
    expect(metricOf(m.items, 'pb').value).toBeCloseTo(mcap / 80_000_000_000, 10);
    expect(metricOf(m.items, 'ps').value).toBeCloseTo(mcap / 400_000_000_000, 10);
  });

  it('EV multiples match EV ÷ line', () => {
    expect(metricOf(m.items, 'evRevenue').value).toBeCloseTo(ev / 400_000_000_000, 10);
    expect(metricOf(m.items, 'evEbitda').value).toBeCloseTo(ev / 140_000_000_000, 10);
    expect(metricOf(m.items, 'evEbit').value).toBeCloseTo(ev / 120_000_000_000, 10);
  });

  it('margins, ROE and ROA match their formulas', () => {
    expect(metricOf(m.items, 'grossMargin').value).toBeCloseTo(180 / 400, 10);
    expect(metricOf(m.items, 'operatingMargin').value).toBeCloseTo(120 / 400, 10);
    expect(metricOf(m.items, 'netMargin').value).toBeCloseTo(100 / 400, 10);
    expect(metricOf(m.items, 'ebitdaMargin').value).toBeCloseTo(140 / 400, 10);
    expect(metricOf(m.items, 'roe').value).toBeCloseTo(100 / 80, 10);
    expect(metricOf(m.items, 'roa').value).toBeCloseTo(100 / 360, 10);
  });

  it('ROIC matches NOPAT ÷ invested capital, recomputed by hand', () => {
    // NOPAT = EBIT × (1 − tax ÷ pretax) = 120 × (1 − 25/125) = 96
    const np = 120_000_000_000 * (1 - 25_000_000_000 / 125_000_000_000);
    expect(np).toBe(96_000_000_000);
    expect(nopat(120_000_000_000, 125_000_000_000, 25_000_000_000)).toBeCloseTo(np, 6);
    // Invested capital = debt + equity − cash = 100 + 80 − 30 = 150
    expect(investedCapital(100_000_000_000, 80_000_000_000, 30_000_000_000)).toBe(150_000_000_000);
    expect(metricOf(m.items, 'roic').value).toBeCloseTo(np / 150_000_000_000, 10);
    expect(roic(np, 150_000_000_000)).toBeCloseTo(np / 150_000_000_000, 10);
  });

  it('solvency ratios match their formulas', () => {
    expect(metricOf(m.items, 'debtToEquity').value).toBeCloseTo(100 / 80, 10);
    expect(metricOf(m.items, 'ltDebtToEquity').value).toBeCloseTo(90 / 80, 10);
    expect(metricOf(m.items, 'debtToCapital').value).toBeCloseTo(100 / 180, 10);
    expect(metricOf(m.items, 'liabToAssets').value).toBeCloseTo(280 / 360, 10);
    expect(metricOf(m.items, 'currentRatio').value).toBeCloseTo(130 / 110, 10);
    expect(metricOf(m.items, 'ebitToInterest').value).toBeCloseTo(120 / 4, 10);
    expect(metricOf(m.items, 'ebitdaToInterest').value).toBeCloseTo(140 / 4, 10);
    expect(metricOf(m.items, 'debtToEbitda').value).toBeCloseTo(100 / 140, 10);
    expect(metricOf(m.items, 'netDebtToEbitda').value).toBeCloseTo(70 / 140, 10);
  });

  it('Debt/(EBITDA − capex) subtracts the capex *magnitude*, not its sign', () => {
    // Capex is reported as −11; the formula wants 140 − 11 = 129, never 140 − (−11).
    expect(metricOf(m.items, 'debtToEbitdaCapex').value).toBeCloseTo(100 / 129, 10);
  });

  it('every ratio exposes the formula key the UI shows on hover', () => {
    for (const item of m.items) {
      expect(item.formulaKey, `${item.id} needs a formula key`).toMatch(/^pf\.formula\./);
      expect(item.labelKey, `${item.id} needs a label key`).toMatch(/^pf\./);
    }
  });
});

describe('phase 3 — a missing input is null, never 0 / NaN / Infinity (§A.3, §D.1)', () => {
  const cases: Array<[string, keyof MetricInputs]> = [
    ['pe', 'dilutedEps'],
    ['pb', 'stockholdersEquity'],
    ['ps', 'revenue'],
    ['evRevenue', 'revenue'],
    ['evEbitda', 'ebitda'],
    ['evEbit', 'ebit'],
    ['grossMargin', 'grossProfit'],
    ['operatingMargin', 'operatingIncome'],
    ['netMargin', 'netIncome'],
    ['ebitdaMargin', 'ebitda'],
    ['roe', 'stockholdersEquity'],
    ['roa', 'totalAssets'],
    ['debtToEquity', 'stockholdersEquity'],
    ['ltDebtToEquity', 'longTermDebt'],
    ['liabToAssets', 'totalLiabilities'],
    ['currentRatio', 'currentLiabilities'],
    ['ebitToInterest', 'interestExpense'],
    ['ebitdaToInterest', 'ebitda'],
    ['debtToEbitda', 'ebitda'],
  ];

  it.each(cases)('%s is null (not a fabricated number) when %s is missing', (metricId, inputKey) => {
    const m = deriveMetrics(fullInputs({ [inputKey]: null }), 200);
    const value = metricOf(m.items, metricId).value;
    expect(value, `${metricId} with ${String(inputKey)}=null`).toBeNull();
  });

  it('a zero denominator yields null, not Infinity', () => {
    const m = deriveMetrics(fullInputs({ revenue: 0 }), 200);
    expect(metricOf(m.items, 'ps').value).toBeNull();
    expect(metricOf(m.items, 'evRevenue').value).toBeNull();
    // And nothing anywhere is Infinity/NaN, which would format as a plausible "-".
    for (const item of m.items) {
      expect(Number.isFinite(item.value ?? 0), `${item.id} must be null or finite`).toBe(true);
    }
  });

  it('a zero interest expense yields null coverage, not Infinity', () => {
    const m = deriveMetrics(fullInputs({ interestExpense: 0 }), 200);
    expect(metricOf(m.items, 'ebitToInterest').value).toBeNull();
    expect(metricOf(m.items, 'ebitdaToInterest').value).toBeNull();
  });

  it('an all-missing input set produces an all-null metric list, never throws', () => {
    const empty: MetricInputs = Object.fromEntries(
      Object.keys(fullInputs()).map((k) => [k, null]),
    ) as unknown as MetricInputs;
    const m = deriveMetrics(empty, null);
    expect(m.marketCap).toBeNull();
    expect(m.ev).toBeNull();
    expect(m.items.every((i) => i.value === null)).toBe(true);
  });

  it('a missing price makes every price-derived multiple null', () => {
    const m = deriveMetrics(fullInputs(), null);
    expect(metricOf(m.items, 'pe').value).toBeNull();
    expect(metricOf(m.items, 'pb').value).toBeNull();
  });

  it('nothing is ever Infinity or NaN even on an absurd-but-finite input set', () => {
    const m = deriveMetrics(fullInputs({ revenue: 1e-9, ebitda: 1e12 }), 1e9);
    for (const item of m.items) {
      if (item.value !== null) expect(Number.isFinite(item.value), `${item.id} = ${item.value}`).toBe(true);
    }
  });
});

describe('phase 3 — forward estimate level is never a partial sum (§A.2)', () => {
  const period = (id: EstimatePeriod['id'], epsAvg: number | null): EstimatePeriod => ({
    id,
    endDate: null,
    eps: { avg: epsAvg, low: null, high: null, yearAgo: null, analysts: 4, growth: null, currency: 'USD' },
    revenue: { avg: null, low: null, high: null, yearAgo: null, analysts: 4, growth: null, currency: 'USD' },
  });

  it('sums the two quarters when both are present', () => {
    const f = forwardLevel([period('0q', 2), period('+1q', 3)]);
    expect(f.basis).toBe('quarters');
    expect(f.eps).toBe(5);
  });

  it('falls back to the fiscal year rather than summing one quarter', () => {
    // Only `0q` present: a single quarter is NOT a forward-year figure, so the
    // honest answer is the FY estimate, not 2.
    const f = forwardLevel([period('0q', 2), period('0y', 9)]);
    expect(f.basis).toBe('fy');
    expect(f.eps).toBe(9);
  });

  it('is null when neither basis is complete', () => {
    const f = forwardLevel([period('0q', 2)]);
    expect(f.eps).toBeNull();
    expect(f.basis).toBeNull();
  });

  it('is null on an empty period list', () => {
    const f = forwardLevel([]);
    expect(f.eps).toBeNull();
    expect(f.revenue).toBeNull();
  });
});

describe('phase 3 — estimate parsing keeps only the four real periods (§A.2)', () => {
  it('ESTIMATE_PERIODS is exactly the four the provider carries', () => {
    expect([...ESTIMATE_PERIODS]).toEqual(['0q', '+1q', '0y', '+1y']);
  });

  it('a missing earningsTrend yields the four periods with null sides, never a fabricated value', () => {
    const periods = parseEarningsTrend({});
    expect(periods.map((p) => p.id)).toEqual([...ESTIMATE_PERIODS]);
    expect(periods.every((p) => p.eps.avg === null && p.revenue.avg === null)).toBe(true);
    expect(parseEarningsTrend({ quoteSummary: { result: [] } })).toHaveLength(4);
  });

  it('periodMatrix reports only the periods that carry data, and counts the extra years', () => {
    const periods = parseEarningsTrend({
      quoteSummary: {
        result: [
          {
            earningsTrend: {
              trend: [
                { period: '0q', endDate: '2026-12-31', growth: { raw: 0.1 }, earningsEstimate: { avg: { raw: 2 } } },
                { period: '+1q', endDate: '2027-03-31', earningsEstimate: { avg: { raw: 2.2 } } },
              ],
            },
          },
        ],
      },
    });
    const matrix = periodMatrix(periods, 2);
    // Only 0q and +1q carry data; 0y/+1y have null sides and are dropped.
    expect(matrix.periods.map((p) => p.id)).toEqual(['0q', '+1q']);
    // The further years exist only as a count the UI renders as dashes.
    expect(matrix.extraYears).toBe(2);
  });
});

describe('phase 3 — multiples guard a non-positive denominator', () => {
  it('priceMultiple is null when the per-share base is 0 or negative', () => {
    expect(priceMultiple(100, 5)).toBe(20);
    expect(priceMultiple(100, 0)).toBeNull();
    expect(priceMultiple(100, -5)).toBeNull();
    expect(priceMultiple(null, 5)).toBeNull();
  });

  it('evMultiple is null when revenue is 0 or the EV is absent', () => {
    expect(evMultiple(1000, 100)).toBe(10);
    expect(evMultiple(1000, 0)).toBeNull();
    expect(evMultiple(null, 100)).toBeNull();
  });
});

describe('phase 3 — growth and target views degrade honestly', () => {
  it('growthBetween is null when either side is absent, never a made-up 0%', () => {
    expect(growthBetween(100, 110)).toBeCloseTo(0.1, 10);
    expect(growthBetween(null, 110)).toBeNull();
    expect(growthBetween(100, null)).toBeNull();
    expect(growthBetween(0, 110)).toBeNull(); // zero base ⇒ undefined growth
  });

  it('priceTargetView leaves a missing target as null', () => {
    const ratings = parseRatings({
      quoteSummary: {
        result: [
          {
            financialData: {
              targetMeanPrice: { raw: 250 },
              targetHighPrice: { raw: 300 },
              targetLowPrice: { raw: 180 },
              numberOfAnalystOpinions: { raw: 30 },
            },
          },
        ],
      },
    });
    const view = priceTargetView(ratings, 200);
    expect(view.mean).toBe(250);
    expect(view.high).toBe(300);
    expect(view.upsidePct).toBeCloseTo(0.25, 10);

    const partial = priceTargetView(ratings, null);
    // No price ⇒ no return potential, not a 0.
    expect(partial.upsidePct).toBeNull();

    const noTarget = parseRatings({ quoteSummary: { result: [{}] } });
    const empty = priceTargetView(noTarget, 200);
    expect(empty.low).toBeNull();
    expect(empty.high).toBeNull();
    expect(empty.upsidePct).toBeNull();
  });

  it('a symbol with no analyst coverage yields empty buckets and null targets', () => {
    const r = parseRatings({ quoteSummary: { result: [{}] } });
    expect(r.buckets).toEqual([]);
    expect(r.recommendationMean).toBeNull();
    expect(r.numberOfAnalystOpinions).toBeNull();
  });

  it('upgrades are capped and never invented', () => {
    expect(parseUpgrades({}, 25)).toEqual([]);
    const many = {
      quoteSummary: {
        result: [
          {
            upgradeDowngradeHistory: {
              history: Array.from({ length: 40 }, (_, i) => ({
                epochGradeDate: 1_700_000_000 + i,
                firm: `Firm ${i}`,
                toGrade: 'Buy',
              })),
            },
          },
        ],
      },
    };
    expect(parseUpgrades(many, 25).length).toBe(25);
  });
});

describe('phase 3 — metricInputsFor reads the latest column, never a blend', () => {
  it('takes the last column of each table and leaves absent lines null', () => {
    const inputs = metricInputsFor(
      {
        annual: {
          income: [['2025-09-27', 100], ['2026-09-27', 200]],
          balance: [['2025-09-27', 50], ['2026-09-27', 60]],
          cashflow: [['2025-09-27', 10], ['2026-09-27', 20]],
        },
      } as never,
      {
        income: {
          columns: ['2025', '2026'],
          rows: [{ labelKey: 'pf.income.totalRevenue', name: 'TotalRevenue', kind: 'money', computed: false, values: [100, 200] }],
          currency: 'USD',
        },
        balance: {
          columns: ['2025', '2026'],
          rows: [{ labelKey: 'pf.balance.cash', name: 'CashAndCashEquivalents', kind: 'money', computed: false, values: [40, 60] }],
          currency: 'USD',
        },
        cashflow: {
          columns: ['2025', '2026'],
          rows: [{ labelKey: 'pf.cash.capitalExpenditure', name: 'CapitalExpenditure', kind: 'money', computed: false, values: [-9, -20] }],
          currency: 'USD',
        },
      } as never,
    );
    expect(inputs.asOf).toBe('2026');
    expect(inputs.revenue).toBe(200);
    expect(inputs.cash).toBe(60);
    expect(inputs.capitalExpenditure).toBe(-20);
    // A line that is not in the table at all stays null — it is not 0.
    expect(inputs.ebitda).toBeNull();
    expect(inputs.currency).toBe('USD');
  });
});
