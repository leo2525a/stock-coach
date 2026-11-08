import { describe, expect, it } from 'vitest';
import {
  formatCompact,
  formatHKT,
  formatHKTAxis,
  formatHKTClock,
  formatHKTDate,
  formatNumber,
  formatOhlcLegend,
  formatPercent,
  formatPrice,
  formatSigned,
  humanAge,
  isValidSymbol,
  NO_DATA,
  normalizeSymbol,
  staleness,
  staleThreshold,
} from '../shared/format';
import { DICTIONARIES, translatorFor } from '../shared/i18n';

/**
 * Time assertions use an independent `Intl` formatter rather than hard-coded
 * strings, so the suite stays correct if ICU data is updated — while still
 * proving we render in HKT rather than the machine's local zone.
 */
const hktReference = (epochSeconds: number, opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Hong_Kong', ...opts }).format(
    new Date(epochSeconds * 1000),
  );

describe('HKT time formatting', () => {
  // 2026-11-06T03:25:58Z === 11:25:58 HKT (UTC+8).
  const t = Math.floor(Date.parse('2026-11-06T03:25:58Z') / 1000);

  it('labels every timestamp as HKT', () => {
    expect(formatHKT(t)).toContain('HKT');
    expect(formatHKTDate(t)).toContain('HKT');
    expect(formatHKTClock(t)).toContain('HKT');
  });

  it('renders the HKT wall-clock time, not the machine local time', () => {
    const expectedHour = hktReference(t, { hour: '2-digit', hour12: false });
    expect(formatHKTClock(t)).toContain(`${expectedHour}:`);
    expect(formatHKTClock(t)).toContain('11:25');
  });

  it('formats a full timestamp as YYYY-MM-DD HH:mm HKT', () => {
    expect(formatHKT(t)).toBe('2026-11-06 11:25 HKT');
  });

  it('formats a date-only stamp', () => {
    expect(formatHKTDate(t)).toBe('2026-11-06 HKT');
  });

  it('uses date labels for daily/weekly/monthly axes and clock labels for intraday', () => {
    expect(formatHKTAxis(t, '1d')).toBe('2026-11-06');
    expect(formatHKTAxis(t, '1w')).toBe('2026-11-06');
    expect(formatHKTAxis(t, '1mo')).toBe('2026-11-06');
    expect(formatHKTAxis(t, '1m')).toBe('11:25');
    expect(formatHKTAxis(t, '5m')).toBe('11:25');
    expect(formatHKTAxis(t, '1h')).toBe('11:25');
  });

  it('crosses the date boundary correctly relative to UTC', () => {
    // 2026-11-06T17:00:00Z is already 2026-11-07 01:00 in HKT.
    const late = Math.floor(Date.parse('2026-11-06T17:00:00Z') / 1000);
    expect(formatHKT(late)).toBe('2026-11-07 01:00 HKT');
  });

  it('returns the shared no-data sentinel rather than an invalid date for null/NaN', () => {
    // The sentinel is a glyph, never English prose: a missing value used to
    // render as the literal "no data" inside the Chinese UI. `NO_DATA` is the
    // one spelling, and it is what the dictionary returns too.
    expect(formatHKT(null)).toBe(NO_DATA);
    expect(formatHKT(undefined)).toBe(NO_DATA);
    expect(formatHKT(Number.NaN)).toBe(NO_DATA);
    expect(formatHKTDate(null)).toBe(NO_DATA);
    expect(formatHKTClock(Number.NaN)).toBe(NO_DATA);
  });

  it('renders the no-data sentinel in the caller language', () => {
    const zh = translatorFor(DICTIONARIES, 'zh-HK');
    expect(formatHKT(null, zh)).toBe(zh('common.noData'));
    expect(formatPrice(null, undefined, zh)).toBe(zh('common.noData'));
  });
});

describe('humanAge', () => {
  it('describes ages in friendly units (English fallback)', () => {
    expect(humanAge(5)).toBe('just now');
    expect(humanAge(120)).toBe('2 min ago');
    expect(humanAge(7200)).toBe('2 h ago');
    expect(humanAge(172800)).toBe('2 d ago');
  });

  it('is fully localised, unit included', () => {
    // Regression guard for the reviewer's blocking finding: the relative time
    // rendered inside the zh-HK UI as "2 min ago". Chinese states the unit
    // inside the word, so the whole bucket — not a "{age}前" suffix — is
    // translated.
    const zh = translatorFor(DICTIONARIES, 'zh-HK');
    expect(humanAge(5, zh)).toBe('啱啱');
    expect(humanAge(120, zh)).toBe('2 分鐘前');
    expect(humanAge(7200, zh)).toBe('2 個鐘前');
    expect(humanAge(172800, zh)).toBe('2 日前');
    expect(humanAge(Number.NaN, zh)).toBe('不詳');
  });
});

describe('staleness', () => {
  const now = 1_800_000_000;

  it('marks fresh data as not stale', () => {
    const s = staleness('1d', now - 60, now);
    expect(s.stale).toBe(false);
    expect(s.label).toBe('1 min ago');
  });

  it('marks old daily data as stale', () => {
    const s = staleness('1d', now - 10 * 86400, now);
    expect(s.stale).toBe(true);
    expect(s.ageSeconds).toBe(10 * 86400);
  });

  it('treats a missing timestamp as stale, never as fresh', () => {
    const s = staleness('1d', null, now);
    expect(s.stale).toBe(true);
    expect(s.label).toBe('unknown');
  });

  it('uses tighter thresholds for intraday intervals than for daily', () => {
    expect(staleThreshold('1m')).toBeLessThan(staleThreshold('1d'));
    expect(staleThreshold('1d')).toBeLessThan(staleThreshold('1mo'));
  });

  it('does not flag daily data as stale across a long weekend', () => {
    expect(staleness('1d', now - 3 * 86400, now).stale).toBe(false);
  });

  it('flags intraday data as stale after a few hours', () => {
    expect(staleness('5m', now - 3 * 3600, now).stale).toBe(true);
  });
});

describe('number formatting', () => {
  it('formats prices with two decimals and optional currency', () => {
    expect(formatPrice(344.1)).toBe('344.10');
    expect(formatPrice(344.1, 'USD')).toBe('344.10 USD');
    expect(formatPrice(1234.567)).toBe('1,234.57');
  });

  it('returns the no-data sentinel instead of NaN/null/undefined', () => {
    expect(formatPrice(null)).toBe(NO_DATA);
    expect(formatPrice(undefined)).toBe(NO_DATA);
    expect(formatPrice(Number.NaN)).toBe(NO_DATA);
    expect(formatPercent(null)).toBe(NO_DATA);
    expect(formatCompact(null)).toBe(NO_DATA);
    expect(formatNumber(Number.POSITIVE_INFINITY)).toBe(NO_DATA);
  });

  it('always signs signed values', () => {
    expect(formatSigned(6.27)).toBe('+6.27');
    expect(formatSigned(-6.27)).toBe('-6.27');
    expect(formatSigned(0)).toBe('+0.00');
  });

  it('always signs percentages', () => {
    expect(formatPercent(1.528)).toBe('+1.53%');
    expect(formatPercent(-1.528)).toBe('-1.53%');
    expect(formatPercent(0)).toBe('+0.00%');
  });

  it('compacts large numbers', () => {
    expect(formatCompact(74_173_346)).toBe('74.17M');
    expect(formatCompact(1_234_567_890)).toBe('1.23B');
    expect(formatCompact(2_500)).toBe('2.50K');
    expect(formatCompact(999)).toBe('999');
  });

  it('formats the crosshair OHLC legend', () => {
    const legend = formatOhlcLegend(100, 110, 95, 105);
    expect(legend.open).toBe('100');
    expect(legend.high).toBe('110');
    expect(legend.low).toBe('95');
    expect(legend.close).toBe('105');
    expect(legend.change).toBe('+5.00%');
  });

  it('handles a zero open without dividing by zero', () => {
    expect(formatOhlcLegend(0, 1, 0, 1).change).toBe('+0.00%');
  });
});

describe('symbol handling', () => {
  it('normalises user input', () => {
    expect(normalizeSymbol(' aapl ')).toBe('AAPL');
    expect(normalizeSymbol('brk.b')).toBe('BRK.B');
    expect(normalizeSymbol('0700.hk')).toBe('0700.HK');
    expect(normalizeSymbol('brk b')).toBe('BRKB');
  });

  it('accepts plausible tickers', () => {
    expect(isValidSymbol('AAPL')).toBe(true);
    expect(isValidSymbol('BRK.B')).toBe(true);
    expect(isValidSymbol('0700.HK')).toBe(true);
    expect(isValidSymbol('BTC-USD')).toBe(true);
    expect(isValidSymbol('^GSPC')).toBe(false); // leading caret is not in our charset
  });

  it('rejects obviously bad input', () => {
    expect(isValidSymbol('')).toBe(false);
    expect(isValidSymbol('A')).toBe(true);
    expect(isValidSymbol('THIS-SYMBOL-IS-FAR-TOO-LONG')).toBe(false);
    expect(isValidSymbol('AAPL;DROP')).toBe(false);
    expect(isValidSymbol('a b')).toBe(false);
  });
});
