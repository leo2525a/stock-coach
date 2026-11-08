/**
 * i18n contract tests (SPEC-PHASE2 §B).
 *
 * These are the tests that make "no hard-coded strings" and "same key set"
 * falsifiable rather than aspirational:
 *   - both dictionaries must have identical keys AND identical placeholders;
 *   - every template must interpolate cleanly, leaving no `{placeholder}` behind;
 *   - and the English dictionary must be able to *reproduce the engine's own
 *     evidence sentences character for character*.
 *
 * That last one is the interesting one: it means the translation layer cannot
 * silently drop a number the rule computed.
 */
import { describe, expect, it } from 'vitest';
import {
  auditDictionaries,
  createTranslator,
  DICTIONARIES,
  DEFAULT_LANG,
  en,
  interpolate,
  LANGS,
  normalizeLang,
  placeholderMismatches,
  placeholdersOf,
  translatorFor,
  zhHK,
  type Dict,
} from '../shared/i18n';
import { evaluateSignals } from '../shared/signals';
import { computeIndicators } from '../shared/indicators';
import { candlesFromCloses, trendCandles, wobbleCandles, upThenDown } from './helpers';

const ALL_DICTS: Array<[string, Dict]> = [
  ['en', en],
  ['zh-HK', zhHK],
];

describe('i18n — bundle health', () => {
  it('ships exactly the two locales the spec asks for, defaulting to zh-HK', () => {
    expect([...LANGS]).toEqual(['zh-HK', 'en']);
    expect(DEFAULT_LANG).toBe('zh-HK');
  });

  it('has an identical key set in both locales (no missing translations)', () => {
    const audit = auditDictionaries();
    expect(audit.missing['zh-HK'], 'keys in en but missing from zh-HK').toEqual([]);
    expect(audit.extra['zh-HK'], 'keys in zh-HK but not in en').toEqual([]);
  });

  it('uses the same placeholders in both locales', () => {
    const mismatches = placeholderMismatches(en, zhHK);
    expect(mismatches, JSON.stringify(mismatches, null, 2)).toEqual([]);
  });

  it('never composes an age label with a second time suffix', () => {
    // Regression guard for the reviewer's B1: `humanAge()` returns a *complete*
    // word (「7 分鐘前」), so a wrapper template adding its own 前/ago would say
    // 「7 分鐘前前更新」. Empty is the only healthy result now that the age
    // buckets are whole labels; this test keeps it that way in both locales.
    const audit = auditDictionaries();
    expect(
      audit.doubleSuffix,
      JSON.stringify(audit.doubleSuffix, null, 2),
    ).toEqual([]);
  });

  it('has no empty template in either locale', () => {
    for (const [name, dict] of ALL_DICTS) {
      for (const [key, value] of Object.entries(dict)) {
        expect(value.trim(), `${name}:${key} is empty`).not.toBe('');
      }
    }
  });

  it('actually differs from English somewhere (it is a real translation)', () => {
    // A handful of entries are legitimately identical across locales: two shell
    // commands, the em-dash placeholder, and the two indicator acronyms.
    const ALLOWED_IDENTICAL = new Set([
      'app.backendDown.server',
      'app.backendDown.dev',
      'common.noData',
      'chart.rsi',
      'chart.macd',
      // Phase 3 — tokens that are *identifiers, acronyms or formulae*, not prose.
      // A Chinese reader sees these verbatim in every terminal and annual report,
      // so "translating" them would make the UI less readable, not more.
      'pf.act.export.csv', // file-format name
      'pf.act.export.json', // file-format name
      'pf.currency.rate', // "1 {from} = {rate} {to}" — a formula, no words
      'pf.income.ebitda', // standard financial acronym
      'pf.income.ebit',
      'pf.matrix.ebitda',
      'pf.matrix.ebit',
      'pf.est.period.fyPlus', // "FY+{n}" — a period token
      'pf.period.ltm', // "LTM" — a period token
    ]);
    const identical = Object.keys(en).filter((k) => en[k] === zhHK[k]);
    const unexpected = identical.filter((k) => !ALLOWED_IDENTICAL.has(k));
    expect(unexpected, 'these keys were copied from English instead of translated').toEqual([]);
    expect(identical.length).toBeLessThan(Object.keys(en).length * 0.03);
  });
});

describe('i18n — interpolation', () => {
  it('replaces known placeholders and leaves unknown ones visible', () => {
    expect(interpolate('hi {name}, {n} left', { name: 'Ada', n: 3 })).toBe('hi Ada, 3 left');
    // A visible `{oops}` is a bug report; `undefined` would be a mystery.
    expect(interpolate('hi {oops}', {})).toBe('hi {oops}');
  });

  it('lists placeholders once, in order', () => {
    expect(placeholdersOf('{a} {b} {a}')).toEqual(['a', 'b']);
    expect(placeholdersOf('no placeholders')).toEqual([]);
  });

  it('renders every key in both locales without leaving a placeholder behind', () => {
    const params = {
      symbol: 'AAPL',
      error: 'boom',
      price: '1.00',
      value: '2.00',
      pct: '+1.00%',
      count: 3,
      total: 4,
      pass: 2,
      ratio: '1.50',
      open: '1',
      close: '2',
      min: '1',
      max: '2',
      bars: 120,
      age: '5m',
      n: 2,
      time: '2026-11-06 12:00',
      server: 'npm run server',
      dev: 'npm run dev',
      interval: '1d',
      range: '1y',
      label: 'SMA 50',
      tickers: 'AAPL, BAC',
      verdict: 'Mixed',
      score: 50,
      input: 'XYZ',
      // Phase 3 additions — the currency/date conversions and the statement
      // period labels introduce these placeholders.
      currency: 'USD',
      date: '2026-11-06',
      from: 'HKD',
      to: 'USD',
      rate: '0.1280',
      // The §C.4 matrix states the period basis of its two columns.
      asOf: '2026-09-30',
      // Phase 4 additions — the dividend span chips and the "about N months"
      // caption on the payments/yield graph introduce these placeholders.
      span: '5Y',
      months: 60,
    };
    for (const lang of LANGS) {
      const t = translatorFor(DICTIONARIES, lang);
      for (const key of Object.keys(en)) {
        const rendered = t(key, params);
        expect(rendered, `${lang}:${key} left a placeholder`).not.toMatch(/\{\w+\}/);
      }
    }
  });

  it('falls back to the other locale and then to the key itself', () => {
    const t = createTranslator({ a: 'A' }, { b: 'B' }, 'zh-HK');
    expect(t('a')).toBe('A');
    expect(t('b'), 'missing key falls back to the other locale').toBe('B');
    expect(t('nope'), 'unknown key stays visible').toBe('nope');
    expect(t.lang).toBe('zh-HK');
  });

  it('normalises persisted garbage back to the default locale', () => {
    expect(normalizeLang('en')).toBe('en');
    expect(normalizeLang('zh-HK')).toBe('zh-HK');
    expect(normalizeLang('fr')).toBe('zh-HK');
    expect(normalizeLang(null)).toBe('zh-HK');
  });
});

describe('i18n — the English dictionary reproduces the engine’s evidence', () => {
  /**
   * The guard rail for the whole migration: for real signals, applying the
   * English template to the params must return the exact `evidence` string the
   * rule produced. Any drift between shared/signals.ts and the dictionary fails
   * here instead of quietly rendering "SMA50: {value}".
   */
  const cases = [
    ['uptrend', trendCandles(320, 1)],
    ['downtrend', trendCandles(320, -1)],
    ['wobble', wobbleCandles(400)],
    ['up-then-down', upThenDown(200, 40)],
    ['short series', candlesFromCloses(Array.from({ length: 40 }, (_, i) => 100 + (i % 7)))],
  ] as const;

  for (const [name, candles] of cases) {
    it(`matches the engine exactly on a ${name} series`, () => {
      const signals = evaluateSignals({ candles, indicators: computeIndicators(candles) });
      expect(signals.length).toBeGreaterThan(0);
      for (const s of signals) {
        expect(s.evidenceI18n).toHaveLength(s.evidence.length);
        s.evidence.forEach((line, i) => {
          const tpl = en[s.evidenceI18n[i].key];
          expect(tpl, `missing template for ${s.evidenceI18n[i].key}`).toBeTruthy();
          expect(
            interpolate(tpl, s.evidenceI18n[i].params),
            `${s.id} line ${i} drifted from the dictionary`,
          ).toBe(line);
        });
      }
    });
  }

  it('gives every signal a title and copy key present in both locales', () => {
    const candles = trendCandles(320, 1);
    const signals = evaluateSignals({ candles, indicators: computeIndicators(candles) });
    expect(signals.map((s) => s.id).sort()).toEqual(
      ['bollinger', 'ma-trend', 'macd', 'rsi', 'squeeze', 'volume'].sort(),
    );
    for (const s of signals) {
      for (const key of [
        `sig.${s.id}.title.${s.variant}`,
        `sig.${s.id}.meaning.${s.variant}`,
        `sig.${s.id}.what`,
        `sig.${s.id}.watch`,
      ]) {
        expect(en[key], `en is missing ${key}`).toBeTruthy();
        expect(zhHK[key], `zh-HK is missing ${key}`).toBeTruthy();
      }
      // The English copy must be the engine's copy, verbatim.
      expect(en[`sig.${s.id}.title.${s.variant}`]).toBe(s.label);
      expect(en[`sig.${s.id}.meaning.${s.variant}`]).toBe(s.meaning);
      expect(en[`sig.${s.id}.what`]).toBe(s.what);
      expect(en[`sig.${s.id}.watch`]).toBe(s.watch);
    }
  });

  it('translates the trend-check sub-lists, so no English leaks into zh-HK', () => {
    const candles = trendCandles(320, 1);
    const s = evaluateSignals({ candles, indicators: computeIndicators(candles) }).find(
      (x) => x.id === 'ma-trend',
    )!;
    const withLists = s.evidenceI18n.filter((e) => e.lists);
    expect(withLists.length).toBeGreaterThan(0);
    for (const entry of withLists) {
      for (const [, keys] of Object.entries(entry.lists!)) {
        expect(keys.length).toBeGreaterThan(0);
        for (const key of keys) {
          expect(en[key], `en missing check key ${key}`).toBeTruthy();
          expect(zhHK[key], `zh-HK missing check key ${key}`).toBeTruthy();
          // Real Chinese, not the English label copied across.
          expect(zhHK[key]).not.toBe(en[key]);
        }
      }
    }
  });
});
