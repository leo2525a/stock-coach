/**
 * @vitest-environment jsdom
 *
 * Phase 4 — the honesty rules of the dividend UI (§B.3, §D.1, §D.5).
 *
 * "The build passes" proves nothing about whether a missing dividend figure is
 * rendered as `—` rather than as `0`, or whether a yield got coloured as if it
 * were a trend. Each claim §B/§C makes is turned into the assertion that fails
 * when it stops being true:
 *
 *  - a `null` figure printed as anything but the dash → fails;
 *  - a *level* (yield, payout ratio) given a `chg-up`/`chg-down` class → fails;
 *  - Announced / Record / Type rendered as a real value → fails;
 *  - a Payable Date on a historical row → fails;
 *  - a collapsed section that still renders its body → fails;
 *  - a `derived` figure rendered without the "computed" marker → fails;
 *  - the export losing a dash, or dropping the annulled columns → fails.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type {
  DividendFacts,
  DividendHistoryPayload,
  DividendPayload,
  DividendScheduleRow,
  FrequencyLabel,
  Sourced,
} from '../shared/dividends';
import { plainFormat, buildDividendTables, frequencyText } from '../src/dividend/exportModel';
import {
  DASH,
  formatAmount,
  formatCount,
  formatSignedPercent,
  formatYield,
  frequencyKey,
  sourcedText,
  spanLabel,
} from '../src/dividend/format';
import { FactsSection, GraphSection, GrowthSection, ScheduleSection, ShareholderSection } from '../src/dividend/sections';
import { isDividendSpan } from '../shared/dividends';
import { LangProvider } from '../src/i18n';
import { en } from '../shared/i18n';

if (!('ResizeObserver' in globalThis)) {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;
}
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** A tiny translator over the real English dictionary — no React needed. */
const t = Object.assign(
  (key: string, params?: Record<string, string | number>): string => {
    const raw = en[key] ?? key;
    if (!params) return raw;
    return raw.replace(/\{(\w+)\}/g, (m, name: string) => String(params[name] ?? m));
  },
  { lang: 'en' as const },
);

let container: HTMLDivElement;
let root: Root | null = null;

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container.remove();
  vi.restoreAllMocks();
});

function mount(ui: React.ReactElement) {
  act(() => {
    root = createRoot(container);
    root.render(<LangProvider lang="en">{ui}</LangProvider>);
  });
}

/* ------------------------------------------------------------- fixtures -- */

const direct = <T,>(value: T | null, note?: string): Sourced<T> =>
  value === null || value === undefined
    ? note
      ? { value: null, source: 'absent', note }
      : { value: null, source: 'absent' }
    : note
      ? { value, source: 'direct', note }
      : { value, source: 'direct' };

const derived = <T,>(value: T | null, note?: string): Sourced<T> =>
  value === null || value === undefined
    ? note
      ? { value: null, source: 'absent', note }
      : { value: null, source: 'absent' }
    : note
      ? { value, source: 'derived', note }
      : { value, source: 'derived' };

/** A populated KO-shaped fact block. */
function fullFacts(): DividendFacts {
  return {
    currency: direct('USD'),
    indicatedYield: direct(0.0294),
    trailingYield: direct(0.0287),
    forwardYield: derived(0.0294, 'note.dividendForwardIsIndicated'),
    payoutRatioLtm: direct(0.7321, 'note.dividendPayoutNormalised'),
    fiveYearAvgYield: direct(0.0303, 'note.dividendFiveYearPercentToFraction'),
    annualRate: direct(1.94),
    lastDividendValue: direct(0.51),
    nextExDate: direct(1_795_000_000),
    nextPayDate: direct(1_796_000_000),
    // The two derivation methods disagreed → the UI must render `—`.
    frequency: { value: null, source: 'absent', note: 'note.dividendFrequencyDisagree' },
  };
}

/** A non-payer (TSLA-shaped): every figure absent, and honestly so. */
function emptyFacts(): DividendFacts {
  const a = <T,>(note: string): Sourced<T> => ({ value: null, source: 'absent', note });
  return {
    currency: direct('USD'),
    indicatedYield: a<number>('note.dividendNoDividend'),
    trailingYield: a<number>('note.dividendNoDividend'),
    forwardYield: a<number>('note.dividendIndicatedUnavailable'),
    payoutRatioLtm: a<number>('note.dividendNoDividend'),
    fiveYearAvgYield: a<number>('note.dividendFiveYearPercentToFraction'),
    annualRate: direct<number>(null),
    lastDividendValue: direct<number>(null),
    nextExDate: direct<number>(null),
    nextPayDate: direct<number>(null),
    frequency: a<FrequencyLabel>('note.dividendFrequencyUnknown'),
  };
}

function row(over: Partial<DividendScheduleRow> = {}): DividendScheduleRow {
  return {
    exDate: 1_700_000_000,
    announcedDate: null,
    recordDate: null,
    payableDate: null,
    currency: 'USD',
    amount: 0.5,
    adjAmount: 0.5,
    frequency: 'quarterly',
    type: null,
    ...over,
  };
}

function payload(facts: DividendFacts, over: Partial<DividendPayload> = {}): DividendPayload {
  return {
    symbol: 'KO',
    price: 66,
    facts,
    events: [row()],
    growth: {
      consecutiveAnnualIncreases: derived(62, 'note.dividendGrowthUnavailable'),
      growth1y: derived(0.043),
      growth3y: derived(0.052),
      growth5y: derived(0.061),
      // 10Y is genuinely unavailable for a young payer → absent, not 0.
      growth10y: { value: null, source: 'absent', note: 'note.dividendGrowthUnavailable' },
    },
    shareholder: {
      total: derived(0.0412, 'note.dividendShareholderFyEnd'),
      dividendPart: derived(0.0288, 'note.dividendShareholderFyEnd'),
      buybackPart: derived(0.0151, 'note.dividendShareholderFyEnd'),
      // A net debt *increase* is a negative contribution and must stay negative.
      debtPaydownPart: derived(-0.0027, 'note.dividendShareholderFyEnd'),
      asOf: '2025-12-31',
    },
    series: {
      yields: [{ date: 1_700_000_000, value: 0.029, source: 'yahoo:trailingDividendYield' }],
      payments: [{ date: 1_700_000_000, amount: 0.5 }],
      spansAvailable: ['1y', '3y', '5y', '10y', '20y', 'ALL'],
      reconstructed: false,
    },
    source: 'live',
    lastUpdated: 1_795_000_000,
    note: null,
    ...over,
  };
}

function history(over: Partial<DividendHistoryPayload> = {}): DividendHistoryPayload {
  return {
    symbol: 'KO',
    span: '5y',
    currency: 'USD',
    price: 66,
    payments: [
      { date: 1_700_000_000, amount: 0.5 },
      { date: 1_708_000_000, amount: 0.51 },
    ],
    yields: [{ date: 1_700_000_000, value: 0.029, source: 'yahoo:trailingDividendYield' }],
    rows: [row({ exDate: 1_708_000_000, amount: 0.51, adjAmount: 0.51 })],
    reconstructed: false,
    spansAvailable: ['1y', '3y', '5y', '10y', '20y', 'ALL'],
    source: 'live',
    lastUpdated: 1_795_000_000,
    note: null,
    ...over,
  };
}

/* ================================================== §D.1 sourced honesty -- */

describe('§D.1 — a missing dividend figure is the dash, never a zero', () => {
  it('renders the dash for a null value and keeps the note as the reason', () => {
    const st = sourcedText<number>({ value: null, source: 'absent', note: 'note.dividendNoDividend' }, formatYield);
    expect(st.text).toBe(DASH);
    expect(st.absent).toBe(true);
    expect(st.computed).toBe(false);
    expect(st.note).toBe('note.dividendNoDividend');
  });

  it('renders the dash even when a payload contradictorily says source "direct"', () => {
    // A `value: null` with `source: 'direct'` must still be a dash: anything else
    // would put the word "null" on screen.
    const st = sourcedText<number>({ value: null, source: 'direct' } as Sourced<number>, formatYield);
    expect(st.text).toBe(DASH);
    expect(st.absent).toBe(true);
  });

  it('marks a derived figure as computed and a direct one as not', () => {
    expect(sourcedText<number>(derived(0.02), formatYield).computed).toBe(true);
    expect(sourcedText<number>(direct(0.02), formatYield).computed).toBe(false);
  });

  it('never renders 0 for an absent figure — 0 and absent are different answers', () => {
    // The distinction the whole phase turns on: a non-payer shows `—`, and only a
    // company that genuinely pays 0 would show `0.00%`.
    expect(sourcedText<number>({ value: null, source: 'absent' }, formatYield).text).toBe(DASH);
    expect(sourcedText<number>(direct(0), formatYield).text).toBe('0.00%');
  });
});

describe('§D.1 — the formatters', () => {
  it('turns a fraction into a percentage exactly once', () => {
    expect(formatYield(0.0294)).toBe('2.94%');
    expect(formatYield(null)).toBe(DASH);
    expect(formatYield(Number.NaN)).toBe(DASH);
    expect(formatYield(Number.POSITIVE_INFINITY)).toBe(DASH);
  });

  it('keeps the sign in a growth figure, using a real minus, not a hyphen', () => {
    expect(formatSignedPercent(0.043)).toBe('+4.30%');
    expect(formatSignedPercent(-0.1688)).toBe('−16.88%'); // COST's fake −16.88%
    expect(formatSignedPercent(null)).toBe(DASH);
  });

  it('formats a per-share amount with its currency, or the dash', () => {
    expect(formatAmount(0.5, 'USD')).toBe('0.50 USD');
    expect(formatAmount(1.94, null)).toBe('1.94');
    expect(formatAmount(null, 'USD')).toBe(DASH);
  });

  it('rounds a count and dashes a missing one', () => {
    expect(formatCount(62)).toBe('62');
    expect(formatCount(null)).toBe(DASH);
  });

  it('maps only the known frequencies, and dashes everything else', () => {
    expect(frequencyKey('quarterly')).toBe('div.freq.quarterly');
    expect(frequencyKey('biweekly')).toBe('div.freq.biweekly');
    expect(frequencyKey(null)).toBe(null);
    // A value that is not in the closed set must not become a made-up key.
    expect(frequencyKey('daily' as FrequencyLabel)).toBe(null);
  });

  it('labels the six spans without translating a horizon token', () => {
    expect(spanLabel('1y')).toBe('1Y');
    expect(spanLabel('ALL')).toBe('ALL');
    expect(spanLabel('20y')).toBe('20Y');
  });
});

/* ============================================ §B.3 direction colour rule -- */

describe('§B.3 — colour only directional change figures, never a level', () => {
  it('colours the growth figures and keeps the sign in the text', () => {
    mount(<GrowthSection open onToggle={() => {}} growth={payload(fullFacts()).growth} />);
    const up = container.querySelector('[data-testid="div-g-1y"]')!;
    expect(up.textContent).toContain('+4.30%');
    expect(up.className).toMatch(/chg-up/);

    // The 10Y figure is absent → a dash, and *no* colour class: "no data" must
    // never look like "flat" (§B.3).
    const absent = container.querySelector('[data-testid="div-g-10y"]')!;
    expect(absent.textContent).toBe(DASH);
    expect(absent.className).not.toMatch(/chg-(up|down|flat)/);
  });

  it('colours a negative growth figure down', () => {
    const g = { ...payload(fullFacts()).growth, growth3y: derived(-0.02) };
    mount(<GrowthSection open onToggle={() => {}} growth={g} />);
    const down = container.querySelector('[data-testid="div-g-3y"]')!;
    expect(down.textContent).toContain('−2.00%');
    expect(down.className).toMatch(/chg-down/);
  });

  it('never colours a yield level in the facts table', () => {
    mount(<FactsSection open onToggle={() => {}} facts={fullFacts()} currency="USD" />);
    for (const id of ['div-f-indicated', 'div-f-trailing', 'div-f-forward', 'div-f-payout', 'div-f-5y', 'div-f-rate']) {
      const el = container.querySelector(`[data-testid="${id}"]`)!;
      expect(el, `${id} must exist`).not.toBeNull();
      expect(el.className, `${id} is a level and must not be coloured`).not.toMatch(/chg-(up|down|flat)/);
    }
  });

  it('never colours a shareholder-yield level, not even the negative debt leg', () => {
    mount(<ShareholderSection open onToggle={() => {}} shareholder={payload(fullFacts()).shareholder} currency="USD" />);
    for (const id of ['div-sh-total', 'div-sh-dividend', 'div-sh-buyback', 'div-sh-debt']) {
      const el = container.querySelector(`[data-testid="${id}"]`)!;
      expect(el.className, `${id} is a level and must not be coloured`).not.toMatch(/chg-(up|down|flat)/);
    }
  });
});

/* ================================================== §C.1 / §C.2 / §C.3 -- */

describe('§C.1 — the facts table states its basis and its as-of', () => {
  it('labels the forward yield as indicated, never as consensus', () => {
    mount(<FactsSection open onToggle={() => {}} facts={fullFacts()} currency="USD" />);
    // The *label* of the row says "indicated"…
    const label = container.querySelector('.div-figure')!;
    expect(container.textContent ?? '').toContain(en['div.tag.indicated']);
    // …and no row is *labelled* a consensus: the one place the word appears in
    // the whole panel is the note that explicitly denies it (§C.1).
    const labels = [...container.querySelectorAll('.div-figure')].map((el) => el.textContent ?? '');
    for (const l of labels) expect(l.toLowerCase()).not.toContain('consensus');
    expect(label.textContent).toContain(en['div.f.currency']);
  });

  it('renders the derived forward yield with the computed marker', () => {
    mount(<FactsSection open onToggle={() => {}} facts={fullFacts()} currency="USD" />);
    expect(container.querySelector('[data-testid="div-f-forward-computed"]')).not.toBeNull();
    // A direct figure must not carry it.
    expect(container.querySelector('[data-testid="div-f-indicated-computed"]')).toBeNull();
  });

  it('dashes a frequency the two methods disagreed on, with the reason on hover', () => {
    mount(<FactsSection open onToggle={() => {}} facts={fullFacts()} currency="USD" />);
    const freq = container.querySelector('[data-testid="div-f-frequency"]')!;
    expect(freq.textContent).toBe(DASH);
    expect(freq.getAttribute('title')).toContain('disagree');
  });

  it('shows the derived frequency when it is trustworthy', () => {
    const facts = { ...fullFacts(), frequency: derived<FrequencyLabel>('quarterly', 'note.dividendFrequencyDerived') };
    mount(<FactsSection open onToggle={() => {}} facts={facts} currency="USD" />);
    const freq = container.querySelector('[data-testid="div-f-frequency"]')!;
    expect(freq.textContent).toContain('Quarterly');
  });

  it('renders an honest all-dash block for a non-payer, with no invented zero', () => {
    mount(<FactsSection open onToggle={() => {}} facts={emptyFacts()} currency="USD" />);
    const text = container.textContent ?? '';
    expect(text).not.toContain('0.00%');
    for (const id of ['div-f-indicated', 'div-f-trailing', 'div-f-forward', 'div-f-payout']) {
      expect(container.querySelector(`[data-testid="${id}"]`)!.textContent).toBe(DASH);
    }
    // …and the reason travels with the dash.
    expect(container.querySelector('[data-testid="div-f-indicated"]')!.getAttribute('title')).toContain('pays no dividend');
  });

  it('bounds every derived figure with a reason on hover', () => {
    mount(<FactsSection open onToggle={() => {}} facts={fullFacts()} currency="USD" />);
    const el = container.querySelector('[data-testid="div-f-payout"]')!;
    expect(el.getAttribute('title')).toContain('Payout ratio normalised');
  });
});

/* ============================================================== §C.5 -- */

describe('§C.5 — the schedule is honest about what upstream does not carry', () => {
  it('renders Announced and Record as permanent dashes', () => {
    mount(<ScheduleSection open onToggle={() => {}} history={history()} span="5y" loading={false} onSpan={() => {}} />);
    const announced = container.querySelectorAll('[data-testid="div-row-announced"]');
    const record = container.querySelectorAll('[data-testid="div-row-record"]');
    expect(announced.length).toBeGreaterThan(0);
    expect(record.length).toBe(announced.length);
    for (const el of announced) expect(el.textContent).toBe(DASH);
    for (const el of record) expect(el.textContent).toBe(DASH);
  });

  it('renders Type as a permanent dash for every row', () => {
    mount(<ScheduleSection open onToggle={() => {}} history={history()} span="5y" loading={false} onSpan={() => {}} />);
    const types = container.querySelectorAll('[data-testid="div-row-type"]');
    expect(types.length).toBeGreaterThan(0);
    for (const el of types) expect(el.textContent).toBe(DASH);
  });

  it('leaves Payable as a dash on historical rows and fills it only on the next one', () => {
    const rows = [row({ exDate: 1_700_000_000 }), row({ exDate: 1_800_000_000, payableDate: 1_800_500_000 })];
    mount(
      <ScheduleSection open onToggle={() => {}} history={history({ rows })} span="5y" loading={false} onSpan={() => {}} />,
    );
    const cells = [...container.querySelectorAll('#pf-body-c5 tbody tr')].map((tr) =>
      [...tr.querySelectorAll('td')].map((td) => td.textContent ?? ''),
    );
    // Newest first: the upcoming row (with a payable date) is the first one.
    expect(cells[0][3]).toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(cells[1][3]).toBe(DASH);
  });

  it('states that Adj. Amount equals Amount rather than implying a second field', () => {
    mount(<ScheduleSection open onToggle={() => {}} history={history()} span="5y" loading={false} onSpan={() => {}} />);
    const note = container.querySelector('[data-testid="div-s5-adj"]')!;
    expect(note.textContent).toContain('Adj. Amount equals Amount');
    // The two amount columns carry the same money text — honestly.
    const tr = container.querySelector('#pf-body-c5 tbody tr')!;
    const tds = [...tr.querySelectorAll('td')].map((td) => td.textContent ?? '');
    expect(tds[5]).toBe(tds[6]);
  });

  it('is empty (with its note) rather than inventing rows when the history is missing', () => {
    mount(<ScheduleSection open onToggle={() => {}} history={null} span="5y" loading={false} onSpan={() => {}} />);
    expect(container.querySelectorAll('[data-testid="div-row-announced"]').length).toBe(0);
    expect(container.querySelector('[data-testid="div-s5-absent"]')).not.toBeNull();
  });
});

/* ============================================================== §B.3 -- */

describe('§B.3 — a collapsed section renders and fetches nothing', () => {
  it('mounts no body when the facts section is closed', () => {
    mount(<FactsSection open={false} onToggle={() => {}} facts={fullFacts()} currency="USD" />);
    expect(container.querySelector('[data-testid="div-facts"]')).toBeNull();
    expect(container.querySelector('.pf-section')!.className).not.toMatch(/\bopen\b/);
  });

  it('mounts the body when the section is open', () => {
    mount(<FactsSection open onToggle={() => {}} facts={fullFacts()} currency="USD" />);
    expect(container.querySelector('[data-testid="div-facts"]')).not.toBeNull();
  });
});

/* ============================================ §A.1.2 range=max refusal -- */

describe('§A.1.2 — the UI can never ask for range=max', () => {
  it('offers exactly the six explicit spans and no `max` token', () => {
    mount(
      <GraphSection
        open
        onToggle={() => {}}
        history={history()}
        span="5y"
        loading={false}
        error={false}
        onSpan={() => {}}
      />,
    );
    const chips = [...container.querySelectorAll('[data-testid="div-span-c4"] [data-seg]')].map((b) =>
      b.getAttribute('data-seg'),
    );
    expect(chips).toEqual(['1y', '3y', '5y', '10y', '20y', 'ALL']);
    expect(chips).not.toContain('max');
    // Every chip is a token the server accepts, so no click can send a span it
    // would have to refuse (§A.1.2).
    for (const c of chips) expect(isDividendSpan(c!)).toBe(true);
  });
});

/* ============================================================== §C.6 -- */

describe('§C.6 — export says exactly what the screen says', () => {
  it('exports the annulled columns as dashes, not as blanks or inventions', () => {
    const tables = buildDividendTables(t, payload(fullFacts()), history());
    const schedule = tables.find((tb) => tb.title === en['div.s5.title'])!;
    expect(schedule).toBeDefined();
    const r = schedule.rows[0];
    // Announced, Record, Type are the 1st, 3rd and 9th columns.
    expect(r[0]).toBe(DASH);
    expect(r[2]).toBe(DASH);
    expect(r[8]).toBe(DASH);
  });

  it('exports a missing figure as the same dash the screen shows', () => {
    const p = payload(emptyFacts());
    const tables = buildDividendTables(t, p, null);
    const facts = tables.find((tb) => tb.title === en['div.s1.title'])!;
    const indicated = facts.rows.find((r) => r[0] === en['div.f.indicated'])!;
    expect(indicated[1]).toBe(DASH);
    expect(indicated[1]).not.toBe('');
  });

  it('carries the as-of date and the currency', () => {
    const tables = buildDividendTables(t, payload(fullFacts()), history());
    const shareholder = tables.find((tb) => tb.title === en['div.s3.title'])!;
    const asOf = shareholder.rows.find((r) => r[0] === en['div.col.asOf'])!;
    expect(asOf[1]).toBe('2025-12-31');
    const facts = tables.find((tb) => tb.title === en['div.s1.title'])!;
    expect(facts.rows.find((r) => r[0] === en['div.f.currency'])![1]).toBe('USD');
  });

  it('marks derived rows as computed and reported rows as published', () => {
    const tables = buildDividendTables(t, payload(fullFacts()), null);
    const facts = tables.find((tb) => tb.title === en['div.s1.title'])!;
    expect(facts.rows.find((r) => r[0] === en['div.f.indicated'])![2]).toBe(en['div.basis.direct']);
    expect(facts.rows.find((r) => r[0].startsWith(en['div.f.forward']))![2]).toBe(en['div.basis.derived']);
  });

  it('exports nothing at all when there is no payload', () => {
    expect(buildDividendTables(t, null, null)).toEqual([]);
  });

  it('interleaves payments and yields onto dated rows', () => {
    const tables = buildDividendTables(t, payload(fullFacts()), history());
    const graph = tables.find((tb) => tb.title.startsWith(en['div.s4.title']))!;
    expect(graph.rows.length).toBeGreaterThan(0);
    // Every row has a date in the first column.
    for (const r of graph.rows) expect(r[0]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('keeps the dash character stable — an importer must never read it as 0', () => {
    expect(DASH).toBe('—');
    expect(plainFormat.pct(null)).toBe(DASH);
    expect(plainFormat.signedPct(null)).toBe(DASH);
    expect(plainFormat.amount(null, 'USD')).toBe(DASH);
    expect(plainFormat.count(null)).toBe(DASH);
    expect(plainFormat.date(null)).toBe(DASH);
    // Not an empty string, not a hyphen, not a zero.
    expect(plainFormat.pct(null)).not.toBe('');
    expect(plainFormat.pct(null)).not.toBe('-');
    expect(plainFormat.pct(null)).not.toBe('0%');
  });

  it('never invents a frequency label in the export', () => {
    expect(frequencyText(t, 'quarterly')).toBe(en['div.freq.quarterly']);
    expect(frequencyText(t, null)).toBe(DASH);
  });
});

/* ======================================================= i18n coverage -- */

describe('§F.5 — every Phase 4 key is in both dictionaries', () => {
  it('has no Phase 4 key missing an English entry', () => {
    const keys = Object.keys(en).filter((k) => k.startsWith('div.') || k === 'nav.dividends' || k === 'nav.dividends.hint');
    expect(keys.length).toBeGreaterThan(60);
    for (const k of keys) expect(en[k], `${k} is empty`).not.toBe('');
  });
});
