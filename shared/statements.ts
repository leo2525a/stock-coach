/**
 * Pure mapping layer for Yahoo's `fundamentals-timeseries` endpoint
 * (SPEC-PHASE3 §A.1, §A.2, §A.3).
 *
 * What Yahoo actually returns, confirmed live and captured into
 * `tests/fixtures/timeseries-*.json`:
 *
 * ```jsonc
 * { "timeseries": { "result": [
 *   { "meta": { "symbol": "AAPL", "type": ["annualTotalRevenue"] },
 *     "annualTotalRevenue": [                                  // …or [] when absent
 *       { "dataId": 20100, "asOfDate": "2026-09-30", "periodType": "12M",
 *         "currencyCode": "USD", "reportedValue": { "raw": 478834000000, "fmt": "478.83B" } }
 *     ] }
 * ] } }
 * ```
 *
 * Three deliberate design points, all of them honesty rules:
 *
 * 1. **Empty arrays are the provider's way of saying "not published".** All
 *    four groups carry 46–27 blocks whether or not they have rows, so
 *    `annualGoodwill: []` and `annualGoodwill` missing mean exactly the same
 *    thing. Both map to `[]`, and the UI prints `—`. Never `0`.
 * 2. **`currencyCode` is per *row*, not per response.** `meta` carries only
 *    `symbol` and `type`. A series is read with each row's own currency and
 *    date; nothing is guessed from a sibling row.
 * 3. **Rows arrive newest-first.** Every series is re-sorted oldest→newest
 *    here, once, so no consumer has to remember the provider's ordering.
 *
 * This module is pure (no network, no clock) so the whole mapper is unit
 * testable against the captured fixtures.
 */

/** One reported value with the date/currency it belongs to. */
export interface ReportedPoint {
  /** Provider `asOfDate`, exactly as reported, e.g. '2026-09-30'. */
  asOf: string;
  /** Provider `periodType`: '12M' | '3M' | 'TTM'. */
  periodType: string;
  /** The row's own `currencyCode` (per-row, never inferred). */
  currency: string | null;
  value: number;
}

/** A named series of reported points, oldest → newest. */
export type Series = ReportedPoint[];

/** period switch the UI offers. `ltm` is *computed* from four quarters. */
export type StatementPeriod = 'annual' | 'quarterly' | 'ltm';

/**
 * The line items we ask for, per statement, in the order they are displayed.
 *
 * Every entry is a `{ dataId: labelKey }` pair: the `labelKey` is a dictionary
 * key (`pf.income.totalRevenue`), never prose, so the table renders in the
 * active language. A line the provider does not carry still renders — with `—`.
 */
export interface LineSpec {
  /** Yahoo series name *without* the `annual`/`quarterly`/`trailing` prefix. */
  name: string;
  /** Dictionary key for the row label. */
  labelKey: string;
  /** `money` → compact currency; `perShare` → 2dp with currency; `number` → compact. */
  kind: 'money' | 'perShare' | 'number';
}

/** Income statement, in reading order: revenue → … → bottom line. */
export const INCOME_LINES: readonly LineSpec[] = [
  { name: 'TotalRevenue', labelKey: 'pf.income.totalRevenue', kind: 'money' },
  { name: 'CostOfRevenue', labelKey: 'pf.income.costOfRevenue', kind: 'money' },
  { name: 'GrossProfit', labelKey: 'pf.income.grossProfit', kind: 'money' },
  { name: 'ResearchAndDevelopment', labelKey: 'pf.income.researchAndDevelopment', kind: 'money' },
  { name: 'SellingGeneralAndAdministration', labelKey: 'pf.income.sellingGeneralAndAdmin', kind: 'money' },
  { name: 'OperatingIncome', labelKey: 'pf.income.operatingIncome', kind: 'money' },
  { name: 'EBITDA', labelKey: 'pf.income.ebitda', kind: 'money' },
  { name: 'EBIT', labelKey: 'pf.income.ebit', kind: 'money' },
  { name: 'InterestExpense', labelKey: 'pf.income.interestExpense', kind: 'money' },
  { name: 'PretaxIncome', labelKey: 'pf.income.pretaxIncome', kind: 'money' },
  { name: 'TaxProvision', labelKey: 'pf.income.taxProvision', kind: 'money' },
  { name: 'NetIncome', labelKey: 'pf.income.netIncome', kind: 'money' },
  { name: 'BasicEPS', labelKey: 'pf.income.basicEps', kind: 'perShare' },
  { name: 'DilutedEPS', labelKey: 'pf.income.dilutedEps', kind: 'perShare' },
];

/** Balance sheet. */
export const BALANCE_LINES: readonly LineSpec[] = [
  { name: 'TotalAssets', labelKey: 'pf.balance.totalAssets', kind: 'money' },
  { name: 'CurrentAssets', labelKey: 'pf.balance.currentAssets', kind: 'money' },
  { name: 'CashAndCashEquivalents', labelKey: 'pf.balance.cash', kind: 'money' },
  { name: 'Inventory', labelKey: 'pf.balance.inventory', kind: 'money' },
  { name: 'Goodwill', labelKey: 'pf.balance.goodwill', kind: 'money' },
  { name: 'OtherIntangibleAssets', labelKey: 'pf.balance.otherIntangibles', kind: 'money' },
  { name: 'CurrentLiabilities', labelKey: 'pf.balance.currentLiabilities', kind: 'money' },
  { name: 'TotalLiabilitiesNetMinorityInterest', labelKey: 'pf.balance.totalLiabilities', kind: 'money' },
  { name: 'LongTermDebt', labelKey: 'pf.balance.longTermDebt', kind: 'money' },
  { name: 'CurrentDebt', labelKey: 'pf.balance.currentDebt', kind: 'money' },
  { name: 'TotalDebt', labelKey: 'pf.balance.totalDebt', kind: 'money' },
  { name: 'NetDebt', labelKey: 'pf.balance.netDebt', kind: 'money' },
  { name: 'StockholdersEquity', labelKey: 'pf.balance.stockholdersEquity', kind: 'money' },
  { name: 'MinorityInterest', labelKey: 'pf.balance.minorityInterest', kind: 'money' },
  { name: 'OrdinarySharesNumber', labelKey: 'pf.balance.sharesOutstanding', kind: 'number' },
  { name: 'TotalCapitalization', labelKey: 'pf.balance.totalCapitalization', kind: 'money' },
];

/** Cash-flow statement. */
export const CASHFLOW_LINES: readonly LineSpec[] = [
  { name: 'OperatingCashFlow', labelKey: 'pf.cash.operatingCashFlow', kind: 'money' },
  { name: 'CapitalExpenditure', labelKey: 'pf.cash.capitalExpenditure', kind: 'money' },
  { name: 'FreeCashFlow', labelKey: 'pf.cash.freeCashFlow', kind: 'money' },
  { name: 'InvestingCashFlow', labelKey: 'pf.cash.investingCashFlow', kind: 'money' },
  { name: 'FinancingCashFlow', labelKey: 'pf.cash.financingCashFlow', kind: 'money' },
  { name: 'DepreciationAndAmortization', labelKey: 'pf.cash.depreciationAndAmortization', kind: 'money' },
  { name: 'ReconciledDepreciation', labelKey: 'pf.cash.reconciledDepreciation', kind: 'money' },
  { name: 'StockBasedCompensation', labelKey: 'pf.cash.stockBasedCompensation', kind: 'money' },
  { name: 'CashDividendsPaid', labelKey: 'pf.cash.dividendsPaid', kind: 'money' },
  { name: 'RepurchaseOfCapitalStock', labelKey: 'pf.cash.repurchaseOfStock', kind: 'money' },
];

/** Every series name the backend asks the provider for, per prefix. */
export const ALL_LINE_NAMES: readonly string[] = [
  ...INCOME_LINES,
  ...BALANCE_LINES,
  ...CASHFLOW_LINES,
].map((l) => l.name);

export interface TimeseriesBlocks {
  /** `type` (e.g. `annualTotalRevenue`) → raw rows, exactly as returned. */
  blocks: Record<string, unknown[]>;
  /** Provider status (for diagnostics / the runtime verifier). */
  status: number;
}

/**
 * Flatten a `fundamentals-timeseries` envelope into `type → rows`.
 *
 * A block whose array is empty is *kept* with `[]` so "the provider returned
 * the block but published nothing" stays distinguishable from "we never asked".
 * Callers treat both as missing, but a diagnostic/verifier can tell them apart.
 */
export function parseTimeseries(json: unknown): TimeseriesBlocks {
  const root = json as { timeseries?: { result?: unknown[] } } | null;
  const results = root?.timeseries?.result;
  const blocks: Record<string, unknown[]> = {};
  if (!Array.isArray(results)) return { blocks, status: 0 };
  for (const block of results) {
    const b = block as { meta?: { type?: unknown[] } } & Record<string, unknown>;
    const type = b.meta?.type?.[0];
    if (typeof type !== 'string') continue;
    const rows = b[type];
    blocks[type] = Array.isArray(rows) ? rows : [];
  }
  return { blocks, status: 200 };
}

/** `{ raw: 5 }`, `5`, `null`, `{}` → number | null. Never throws. */
function rowNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'object') return rowNumber((value as { raw?: unknown }).raw);
  if (typeof value === 'string') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function rowString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const s = value.trim();
  return s ? s : null;
}

/**
 * One series (e.g. `annualTotalRevenue`) → `ReportedPoint[]`, oldest → newest.
 *
 * Rows with no `asOfDate` or no numeric `raw` are dropped rather than turned
 * into a `0` placeholder: a zero would read as a real reported fact.
 */
export function seriesOf(blocks: TimeseriesBlocks, type: string): Series {
  const rows = blocks.blocks[type];
  if (!Array.isArray(rows)) return [];
  const out: ReportedPoint[] = [];
  for (const row of rows) {
    const r = row as {
      asOfDate?: unknown;
      periodType?: unknown;
      currencyCode?: unknown;
      reportedValue?: unknown;
    } | null;
    if (!r) continue;
    const asOf = rowString(r.asOfDate);
    const value = rowNumber(r.reportedValue);
    if (asOf === null || value === null) continue;
    out.push({
      asOf,
      periodType: rowString(r.periodType) ?? '',
      currency: rowString(r.currencyCode),
      value,
    });
  }
  // Provider order is newest-first; normalise to oldest-first so a chart and a
  // table agree without either re-sorting.
  return out.sort((a, b) => a.asOf.localeCompare(b.asOf));
}

/**
 * Which prefix a requested period maps to.
 *
 * `ltm` is deliberately mapped to the **quarterly** series, not `trailing`:
 * Yahoo's `trailing` rows exist too but are sparse (AAPL carries only two TTM
 * points, 2025-06-30 and 2026-09-30, with a gap), so a four-quarter sum is both
 * more available and more explainable. The result is labelled "LTM (computed)".
 */
export function prefixFor(period: StatementPeriod): string {
  return period === 'annual' ? 'annual' : 'quarterly';
}

/**
 * The period labels used as table columns.
 *
 * LTM/Q → the last four quarters, oldest→newest. Annual → the last four fiscal
 * years. Never more than four columns: the table is a *comparison*, not a data
 * dump (SPEC-PHASE3 §B.3).
 */
export const MAX_COLUMNS = 4;

/** Column keys for a table (ascending time), capped at `MAX_COLUMNS`. */
export function columnsFor(period: StatementPeriod, blocks: TimeseriesBlocks): string[] {
  const prefix = prefixFor(period);
  const dates = new Set<string>();
  for (const line of ALL_LINE_NAMES) {
    for (const p of seriesOf(blocks, `${prefix}${line}`)) dates.add(p.asOf);
  }
  const sorted = [...dates].sort();
  return sorted.slice(Math.max(0, sorted.length - MAX_COLUMNS));
}

/**
 * One row of a statement table: the label key plus one *serie* per column.
 *
 * `values[i]` belongs to `columns[i]`; `null` means the provider published
 * nothing for that line in that period, which the UI renders as `—`.
 * `sumQuarters` is set for the LTM view, where a flow line is the sum of the
 * four quarters in its window rather than a single reported figure.
 */
export interface StatementRow {
  labelKey: string;
  kind: LineSpec['kind'];
  values: Array<number | null>;
  /** True when the numbers are summed/averaged across the window (LTM). */
  computed: boolean;
}

/**
 * Is this line a *stock* (a point-in-time balance) rather than a *flow*
 * (accumulated over the period)?
 *
 * The distinction matters for exactly one thing: LTM. Summing four quarters of
 * revenue is right; summing four quarters of "total assets" is nonsense, and
 * the honest LTM value for a stock line is the latest reported figure.
 */
const STOCK_LINES = new Set(
  BALANCE_LINES.map((l) => l.name).concat(['OrdinarySharesNumber', 'TotalCapitalization', 'TotalEquityGrossMinorityInterest']),
);

/** Per-share amounts are averages, not sums (four quarters of EPS ÷ nothing). */
const AVERAGE_LINES = new Set(['BasicEPS', 'DilutedEPS']);

export interface StatementTable {
  columns: string[];
  rows: StatementRow[];
  period: StatementPeriod;
  /** Currency of the figures, or null when no row carried one. */
  currency: string | null;
  /** Provider periodType actually read ('12M' | '3M'). */
  periodType: string | null;
  /** True when any figure is computed rather than reported verbatim. */
  anyComputed: boolean;
}

function rowFor(
  blocks: TimeseriesBlocks,
  line: LineSpec,
  period: StatementPeriod,
  columns: string[],
): StatementRow {
  const prefix = prefixFor(period);
  const series = seriesOf(blocks, `${prefix}${line.name}`);
  const byDate = new Map(series.map((p) => [p.asOf, p.value]));

  if (period === 'annual') {
    return {
      labelKey: line.labelKey,
      kind: line.kind,
      values: columns.map((c) => byDate.get(c) ?? null),
      computed: false,
    };
  }

  // Q and LTM both start from the same quarterly series; LTM additionally
  // aggregates the trailing four quarters behind each column.
  if (period === 'quarterly') {
    return {
      labelKey: line.labelKey,
      kind: line.kind,
      values: columns.map((c) => byDate.get(c) ?? null),
      computed: false,
    };
  }

  const allDates = series.map((p) => p.asOf);
  return {
    labelKey: line.labelKey,
    kind: line.kind,
    values: columns.map((c) => {
      const idx = allDates.indexOf(c);
      if (idx < 0) return null;
      const window = series.slice(Math.max(0, idx - 3), idx + 1);
      if (window.length === 0) return null;
      // A stock line is a snapshot: its LTM value is the latest reported figure.
      if (STOCK_LINES.has(line.name)) return window[window.length - 1].value;
      // An average line (EPS) is the mean of the four quarters.
      if (AVERAGE_LINES.has(line.name)) {
        return window.reduce((n, p) => n + p.value, 0) / window.length;
      }
      // Everything else is a flow: four quarters sum to the trailing 12 months.
      return window.reduce((n, p) => n + p.value, 0);
    }),
    computed: true,
  };
}

/**
 * Build one statement table (income / balance / cash flow) for a period.
 *
 * The table is intentionally *borderless about availability*: a line Yahoo
 * does not publish for this symbol is still rendered, with every value `null`.
 * Dropping the row would hide the fact that the metric exists but is missing.
 */
export function buildTable(
  blocks: TimeseriesBlocks,
  lines: readonly LineSpec[],
  period: StatementPeriod,
): StatementTable {
  const columns = columnsFor(period, blocks);
  const rows = lines.map((line) => rowFor(blocks, line, period, columns));
  const prefix = prefixFor(period);
  let currency: string | null = null;
  let periodType: string | null = null;
  for (const line of lines) {
    const s = seriesOf(blocks, `${prefix}${line.name}`);
    const last = s[s.length - 1];
    if (last) {
      currency = currency ?? last.currency;
      periodType = periodType ?? last.periodType;
    }
  }
  return {
    columns,
    rows,
    period,
    currency,
    periodType,
    anyComputed: period === 'ltm',
  };
}

/** The three tables, built once from one fetch. */
export interface StatementSet {
  period: StatementPeriod;
  income: StatementTable;
  balance: StatementTable;
  cashflow: StatementTable;
}

export function buildStatements(blocks: TimeseriesBlocks, period: StatementPeriod): StatementSet {
  return {
    period,
    income: buildTable(blocks, INCOME_LINES, period),
    balance: buildTable(blocks, BALANCE_LINES, period),
    cashflow: buildTable(blocks, CASHFLOW_LINES, period),
  };
}

/**
 * The input set the derived-metric layer needs, pulled from *one* period's
 * tables. Every field is `number | null`; a null input makes every metric that
 * depends on it `—` rather than a silently wrong number.
 */
export interface MetricInputs {
  /** As-of date of the latest column, or null. */
  asOf: string | null;
  revenue: number | null;
  grossProfit: number | null;
  operatingIncome: number | null;
  ebit: number | null;
  ebitda: number | null;
  netIncome: number | null;
  interestExpense: number | null;
  pretaxIncome: number | null;
  taxProvision: number | null;
  totalAssets: number | null;
  totalLiabilities: number | null;
  stockholdersEquity: number | null;
  totalDebt: number | null;
  longTermDebt: number | null;
  currentDebt: number | null;
  cash: number | null;
  currentAssets: number | null;
  currentLiabilities: number | null;
  inventory: number | null;
  operatingCashFlow: number | null;
  capitalExpenditure: number | null;
  freeCashFlow: number | null;
  dilutedEps: number | null;
  sharesOutstanding: number | null;
  /** Currency of the statement figures (per-row `currencyCode`). */
  currency: string | null;
}

const INPUT_BY_NAME: Record<string, keyof MetricInputs> = {
  TotalRevenue: 'revenue',
  GrossProfit: 'grossProfit',
  OperatingIncome: 'operatingIncome',
  EBIT: 'ebit',
  EBITDA: 'ebitda',
  NetIncome: 'netIncome',
  InterestExpense: 'interestExpense',
  PretaxIncome: 'pretaxIncome',
  TaxProvision: 'taxProvision',
  TotalAssets: 'totalAssets',
  TotalLiabilitiesNetMinorityInterest: 'totalLiabilities',
  StockholdersEquity: 'stockholdersEquity',
  TotalDebt: 'totalDebt',
  LongTermDebt: 'longTermDebt',
  CurrentDebt: 'currentDebt',
  CashAndCashEquivalents: 'cash',
  CurrentAssets: 'currentAssets',
  CurrentLiabilities: 'currentLiabilities',
  Inventory: 'inventory',
  OperatingCashFlow: 'operatingCashFlow',
  CapitalExpenditure: 'capitalExpenditure',
  FreeCashFlow: 'freeCashFlow',
  DilutedEPS: 'dilutedEps',
  OrdinarySharesNumber: 'sharesOutstanding',
};

/**
 * Pull the latest-column inputs for a period.
 *
 * `ltm` uses the LTM tables (so revenue is a trailing-12-month sum); `annual`
 * and `quarterly` use the most recent reported column. The 12-month view is the
 * default for ratios because a single quarter is a noisy base for an annual
 * multiple.
 */
export function metricInputsFor(blocks: TimeseriesBlocks, set: StatementSet): MetricInputs {
  const out: MetricInputs = {
    asOf: null,
    revenue: null,
    grossProfit: null,
    operatingIncome: null,
    ebit: null,
    ebitda: null,
    netIncome: null,
    interestExpense: null,
    pretaxIncome: null,
    taxProvision: null,
    totalAssets: null,
    totalLiabilities: null,
    stockholdersEquity: null,
    totalDebt: null,
    longTermDebt: null,
    currentDebt: null,
    cash: null,
    currentAssets: null,
    currentLiabilities: null,
    inventory: null,
    operatingCashFlow: null,
    capitalExpenditure: null,
    freeCashFlow: null,
    dilutedEps: null,
    sharesOutstanding: null,
    currency: null,
  };

  const tables = [set.income, set.balance, set.cashflow];
  const lastIndex = (t: StatementTable) => t.columns.length - 1;

  for (const table of tables) {
    const idx = lastIndex(table);
    if (idx < 0) continue;
    table.rows.forEach((row, ri) => {
      const spec = [...INCOME_LINES, ...BALANCE_LINES, ...CASHFLOW_LINES].find(
        (l) => l.labelKey === row.labelKey,
      );
      if (!spec) return;
      void ri;
      const key = INPUT_BY_NAME[spec.name];
      if (!key || key === 'currency') return;
      const v = row.values[idx];
      if (v !== null && v !== undefined) {
        (out[key] as number | null) = v;
      }
    });
    if (table.currency) out.currency = out.currency ?? table.currency;
  }

  const firstColumnTable = tables.find((t) => t.columns.length > 0);
  out.asOf = firstColumnTable ? firstColumnTable.columns[firstColumnTable.columns.length - 1] : null;
  return out;
}
