import type { Candle, IndicatorSeries } from './types';
import { bbWidthPercent, INDICATOR_PARAMS } from './indicators';

/** Direction of a rule's reading. */
export type SignalState = 'bullish' | 'bearish' | 'neutral';

/** Confidence 0-100. Always derived from the numbers, never invented. */
export type Strength = number;

/** Params for a translated template. Values are `{placeholder}` replacements. */
export type I18nParams = Record<string, string | number>;

/**
 * One evidence line, in two parallel forms.
 *
 * `evidence` is the English sentence (Phase 1 contract, and the source of truth
 * the tests read). `i18n.key` is the template key for that same sentence;
 * applying `i18n.params` to that template in the English dictionary must
 * reproduce `evidence` verbatim — a test asserts exactly that, so the two can
 * never drift and a new locale cannot silently lose a number.
 */
export interface EvidenceLine {
  text: string;
  i18n: {
    key: string;
    params: I18nParams;
    /**
     * Sub-lists translated one item at a time (e.g. which trend checks passed).
     * Each value is a dictionary key, translated and joined by the renderer.
     */
    lists?: Record<string, string[]>;
  };
}

/**
 * What a rule returns: the English copy plus the structured `evidenceText`
 * lines. The public `Signal` is built from this by `signal()`.
 */
export interface RuleSignal {
  /** Stable rule id, e.g. 'ma-trend'. */
  id: string;
  /** Short human title (English; the UI renders a translated title). */
  label: string;
  /** Plain-language: what this indicator is. */
  what: string;
  /** Plain-language: what it means right now, for a total beginner. */
  meaning: string;
  /** Plain-language: what to watch next / the caveat. */
  watch: string;
  state: SignalState;
  strength: Strength;
  /** Candidate evidence lines; the English text becomes `Signal.evidence`. */
  evidenceText: EvidenceLine[];
  /** Which branch of the rule fired — the UI picks copy from this. */
  variant?: string;
  /** Scalar facts the UI needs to build its own translated sentences. */
  facts: I18nParams;
}

/**
 * The public shape of a signal.
 *
 * `evidence` is the Phase 1 contract: the engine's English sentences. Phase 2
 * added `evidenceI18n` (the same lines as dictionary keys — index-for-index),
 * `variant` (which branch fired) and `facts` (the numbers the UI re-states in
 * its own translated sentences). It is structurally identical to
 * `SignalPayloadItem` in shared/types.ts; a test asserts that.
 */
export interface Signal {
  id: string;
  label: string;
  what: string;
  meaning: string;
  watch: string;
  state: SignalState;
  strength: Strength;
  evidence: string[];
  variant: string;
  evidenceI18n: Array<{
    key: string;
    params: I18nParams;
    lists?: Record<string, string[]>;
  }>;
  facts: I18nParams;
}

export interface RuleContext {
  candles: Candle[];
  indicators: IndicatorSeries;
}

const num = (v: number | undefined | null): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

const last = <T>(arr: readonly T[]): T | undefined => arr[arr.length - 1];

/** `+1.23%` / `-1.23%` */
const pct = (a: number, b: number): string =>
  `${(((a - b) / b) * 100 >= 0 ? '+' : '')}${(((a - b) / b) * 100).toFixed(2)}%`;

const r2 = (v: number): string => v.toFixed(2);

/** Scale a 0..1 intensity into a 0..100 strength, clamped. */
function clamp100(v: number): Strength {
  return Math.max(0, Math.min(100, Math.round(v)));
}

/** Linear ramp: value at `at` -> 0, value at `full` -> 1. */
function ramp(value: number, at: number, full: number): number {
  if (full === at) return 0;
  return (value - at) / (full - at);
}

/** Volume: 1,234,567 */
const groupInt = (v: number): string => Math.round(v).toLocaleString('en-US');

/** Build one evidence line. English text and the i18n template are adjacent
 *  on purpose: they are impossible to update independently without noticing. */
function line(
  text: string,
  key: string,
  params: I18nParams = {},
  lists?: Record<string, string[]>,
): EvidenceLine {
  return { text, i18n: { key, params, ...(lists ? { lists } : {}) } };
}

/**
 * Publish a rule's output as a `Signal`: flatten the evidence lines to English
 * strings and carry the identical template list alongside, so the renderer can
 * show a translated sentence for every line it would otherwise show in English.
 */
function signal(rule: RuleSignal): Signal {
  const { evidenceText, variant, ...rest } = rule;
  return {
    ...rest,
    variant: variant ?? rule.state,
    evidence: evidenceText.map((e) => e.text),
    evidenceI18n: evidenceText.map((e) => ({
      key: e.i18n.key,
      params: e.i18n.params,
      ...(e.i18n.lists ? { lists: e.i18n.lists } : {}),
    })),
  };
}

// ---------------------------------------------------------------------------
// R1 — Moving-average trend (price vs SMA50/SMA200 + golden/death cross)
// ---------------------------------------------------------------------------
export function maTrendRule({ candles, indicators }: RuleContext): Signal | null {
  const price = num(last(candles)?.close);
  const s50 = num(last(indicators.sma50)?.value);
  const s200 = num(last(indicators.sma200)?.value);
  if (price === null || s50 === null || s200 === null) return null;

  const evidenceText: EvidenceLine[] = [
    line(`Last close: ${r2(price)}`, 'sig.ev.lastClose', { price: r2(price) }),
    line(`SMA50: ${r2(s50)} (price is ${pct(price, s50)})`, 'sig.ev.sma50', {
      value: r2(s50),
      pct: pct(price, s50),
    }),
    line(`SMA200: ${r2(s200)} (price is ${pct(price, s200)})`, 'sig.ev.sma200', {
      value: r2(s200),
      pct: pct(price, s200),
    }),
    line(
      `SMA50 vs SMA200: ${s50 > s200 ? 'SMA50 above (uptrend structure)' : 'SMA50 below (downtrend structure)'}`,
      s50 > s200 ? 'sig.ev.maStructureUp' : 'sig.ev.maStructureDown',
    ),
  ];

  // Cross detection on the last two SMA50/SMA200 pairs.
  const prevS50 = num(indicators.sma50[indicators.sma50.length - 2]?.value);
  const prevS200 = num(indicators.sma200[indicators.sma200.length - 2]?.value);
  let cross = 'none';
  if (prevS50 !== null && prevS200 !== null) {
    if (prevS50 <= prevS200 && s50 > s200) cross = 'golden';
    else if (prevS50 >= prevS200 && s50 < s200) cross = 'death';
  }

  /**
   * Three falsifiable checks. Rather than summing unrelated weights we require
   * the averages to *agree* before calling a trend: with only three binary
   * checks, a weighted score can never land in a middle band, so an
   * "all three agree" rule is both simpler and more honest for a beginner.
   */
  const checks: Array<{ key: string; pass: boolean }> = [
    { key: 'sig.check.priceAboveSma50', pass: price > s50 },
    { key: 'sig.check.priceAboveSma200', pass: price > s200 },
    { key: 'sig.check.sma50AboveSma200', pass: s50 > s200 },
  ];
  const trueCount = checks.filter((c) => c.pass).length;
  const ratio = trueCount / checks.length; // 0, 1/3, 2/3 or 1

  let state: SignalState;
  if (ratio === 1 || (cross === 'golden' && ratio >= 2 / 3)) state = 'bullish';
  else if (ratio === 0 || (cross === 'death' && ratio <= 1 / 3)) state = 'bearish';
  else state = 'neutral';

  // Conviction grows as the checks agree, plus a bump for a confirmed cross.
  const conviction = Math.abs(ratio - 0.5) * 2;
  let strength = clamp100(45 + conviction * 45 + (cross === 'none' ? 0 : 10));
  // A conflicting read must never masquerade as a strong signal.
  if (state === 'neutral') strength = Math.min(strength, 55);

  const held = checks.filter((t) => t.pass).map((t) => t.key);
  const failed = checks.filter((t) => !t.pass).map((t) => t.key);
  evidenceText.push(
    line(`${trueCount} of ${checks.length} trend checks agree`, 'sig.ev.trendChecks', {
      pass: trueCount,
      total: checks.length,
    }),
  );
  evidenceText.push(
    line(
      `Checks true (${held.length} of ${checks.length})`,
      'sig.ev.checksTrue',
      { count: held.length, total: checks.length },
      { checks: held },
    ),
  );
  if (failed.length) {
    evidenceText.push(
      line(
        `Checks false (${failed.length} of ${checks.length})`,
        'sig.ev.checksFalse',
        { count: failed.length, total: checks.length },
        { checks: failed },
      ),
    );
  }
  if (cross !== 'none') {
    evidenceText.push(
      line(
        `Crossover: ${cross === 'golden' ? 'golden cross (bullish)' : 'death cross (bearish)'} detected on the latest bars`,
        cross === 'golden' ? 'sig.ev.crossGolden' : 'sig.ev.crossDeath',
      ),
    );
  }

  const variant =
    cross === 'golden'
      ? 'golden'
      : cross === 'death'
        ? 'death'
        : state === 'bullish'
          ? 'above'
          : state === 'bearish'
            ? 'below'
            : 'mixed';

  const meaning =
    state === 'bullish'
      ? 'The price is trading above its medium (50-day) and long (200-day) average lines, and the 50-day line is above the 200-day line. Think of it like a runner who is above their long-term pace and still pulling ahead: the overall trend is up.'
      : state === 'bearish'
        ? 'The price is below its medium and long average lines, and the 50-day line is below the 200-day line. The overall trend is down — the stock is running slower than its own long-term pace.'
        : 'The price is mixed against its average lines, so there is no clear trend yet. The market has not decided.';

  const label =
    cross === 'golden'
      ? 'Moving-average trend — golden cross'
      : cross === 'death'
        ? 'Moving-average trend — death cross'
        : state === 'bullish'
          ? 'Moving-average trend — above averages'
          : state === 'bearish'
            ? 'Moving-average trend — below averages'
            : 'Moving-average trend — mixed';

  return signal({
    id: 'ma-trend',
    label,
    what: 'The moving-average trend compares today\u2019s price with the average price of the last 50 and 200 days. Smoothed averages strip out daily noise so the underlying direction is visible.',
    meaning,
    watch:
      'Averages lag: they confirm a trend after it has started. When the 50-day crosses above the 200-day it is called a \u201Cgolden cross\u201D (often bullish); the reverse is a \u201Cdeath cross\u201D (often bearish).',
    state,
    strength,
    evidenceText,
    variant,
    facts: {
      price: r2(price),
      sma50: r2(s50),
      sma200: r2(s200),
      checksPassed: trueCount,
      checksTotal: checks.length,
      cross,
    },
  });
}

// ---------------------------------------------------------------------------
// R2 — RSI(14) momentum
// ---------------------------------------------------------------------------
export function rsiRule({ indicators }: RuleContext): Signal | null {
  const v = num(last(indicators.rsi14)?.value);
  if (v === null) return null;

  const evidenceText: EvidenceLine[] = [line(`RSI(14): ${r2(v)}`, 'sig.ev.rsi', { value: r2(v) })];
  let state: SignalState;
  let strength: Strength;
  let meaning: string;
  let variant: string;

  if (v < 30) {
    state = 'bullish';
    strength = clamp100(50 + ramp(30 - v, 0, 20) * 50);
    variant = 'oversold';
    meaning =
      'RSI below 30 means the stock has been sold off hard recently and is \u201Coversold\u201D. Sellers may be exhausted, so a bounce is possible — but in a genuine downtrend, oversold can stay oversold for a long time. Treat it as \u201Cwatch for stabilisation\u201D, not \u201Cbuy now\u201D.';
  } else if (v > 70) {
    state = 'bearish';
    strength = clamp100(50 + ramp(v - 70, 0, 20) * 50);
    variant = 'overbought';
    meaning =
      'RSI above 70 means the stock has run up hard recently and is \u201Coverbought\u201D. Buyers may be running out of steam, so a pullback is possible — though strong trends can stay overbought for weeks.';
  } else {
    state = 'neutral';
    variant = 'balanced';
    // Closer to the middle = more neutral; near 30/70 = notable.
    strength = clamp100(25 + ramp(Math.abs(v - 50), 0, 20) * 45);
    meaning =
      'RSI between 30 and 70 means momentum is balanced — the stock is neither stretched up nor washed out. There is no strong short-term pressure in either direction from this measure.';
  }

  if (v < 30) {
    evidenceText.push(
      line(`Below the 30 oversold line by ${r2(30 - v)} points`, 'sig.ev.rsiBelow', {
        value: r2(30 - v),
      }),
    );
  } else if (v > 70) {
    evidenceText.push(
      line(`Above the 70 overbought line by ${r2(v - 70)} points`, 'sig.ev.rsiAbove', {
        value: r2(v - 70),
      }),
    );
  } else {
    evidenceText.push(line('Sitting comfortably between the 30 and 70 lines', 'sig.ev.rsiBetween'));
  }

  return signal({
    id: 'rsi',
    label:
      v < 30 ? 'RSI(14) — oversold' : v > 70 ? 'RSI(14) — overbought' : 'RSI(14) — balanced',
    what: 'RSI (Relative Strength Index) scores recent up-days versus down-days on a 0\u2013100 scale. Above 70 = hot, below 30 = cold.',
    meaning,
    watch:
      'RSI is a short-term gauge. It can stay stretched for a long time in a strong trend, so combine it with the trend rule before acting.',
    state,
    strength,
    evidenceText,
    variant,
    facts: { value: Number(v.toFixed(2)) },
  });
}

// ---------------------------------------------------------------------------
// R3 — MACD crossover + histogram direction
// ---------------------------------------------------------------------------
export function macdRule({ indicators }: RuleContext): Signal | null {
  const cur = last(indicators.macd);
  const prev = indicators.macd[indicators.macd.length - 2];
  if (!cur) return null;

  const above = cur.macd > cur.signal;
  let cross: 'bullish' | 'bearish' | 'none' = 'none';
  if (prev) {
    if (prev.macd <= prev.signal && cur.macd > cur.signal) cross = 'bullish';
    else if (prev.macd >= prev.signal && cur.macd < cur.signal) cross = 'bearish';
  }

  const histRising = prev ? cur.histogram > prev.histogram : cur.histogram > 0;

  const state: SignalState =
    cross === 'bullish' ? 'bullish' : cross === 'bearish' ? 'bearish' : above ? 'bullish' : 'bearish';

  // Fresh cross = strong. Histogram expanding in the same direction = confirmation.
  const magnitude = Math.abs(cur.histogram);
  const scale = Math.max(magnitude, Math.abs(cur.macd - cur.signal), 0.0001);
  const agreement = (histRising === above) || (cross === 'bullish' && histRising) ? 1 : 0.5;
  const strength = clamp100(35 + (cross !== 'none' ? 30 : 0) + Math.min(25, scale * 3) * agreement);

  const evidenceText: EvidenceLine[] = [
    line(`MACD line: ${cur.macd.toFixed(4)}`, 'sig.ev.macdLine', { value: cur.macd.toFixed(4) }),
    line(`Signal line: ${cur.signal.toFixed(4)}`, 'sig.ev.signalLine', {
      value: cur.signal.toFixed(4),
    }),
    line(
      `Histogram: ${cur.histogram.toFixed(4)} (${cur.histogram >= 0 ? 'positive' : 'negative'})`,
      cur.histogram >= 0 ? 'sig.ev.histogramPositive' : 'sig.ev.histogramNegative',
      { value: cur.histogram.toFixed(4) },
    ),
    line(
      `MACD is ${above ? 'above' : 'below'} its signal line`,
      above ? 'sig.ev.macdAbove' : 'sig.ev.macdBelow',
    ),
  ];
  if (prev) {
    evidenceText.push(
      line(
        `Histogram vs previous bar: ${histRising ? 'expanding upward' : 'contracting / falling'}`,
        histRising ? 'sig.ev.histRising' : 'sig.ev.histFalling',
      ),
    );
  }
  if (cross !== 'none') {
    evidenceText.push(
      line(
        `${cross === 'bullish' ? 'Bullish' : 'Bearish'} crossover confirmed on the latest bars`,
        cross === 'bullish' ? 'sig.ev.crossBullish' : 'sig.ev.crossBearish',
      ),
    );
  }

  // Four distinct branches: the copy for "above the signal line" must not be the
  // copy for "just crossed", or the UI would claim a fresh crossover on every
  // bar. The variant and the copy are therefore chosen together.
  const variant =
    cross === 'bullish' ? 'crossUp' : cross === 'bearish' ? 'crossDown' : above ? 'aboveSignal' : 'belowSignal';

  const meaning =
    variant === 'crossUp'
      ? 'The MACD line has just crossed above its signal line (a \u201Cbullish crossover\u201D). MACD compares a fast-moving average with a slow one; when the fast one pulls ahead, short-term momentum is turning up. It is like a car that has just started accelerating.'
      : variant === 'crossDown'
        ? 'The MACD line has just crossed below its signal line (a \u201Cbearish crossover\u201D), so short-term momentum is turning down. The car has taken its foot off the accelerator, or is braking.'
        : variant === 'aboveSignal'
          ? 'MACD is above its signal line, so short-term momentum is positive. The fast average is still ahead of the slow one \u2014 the car is still accelerating, though not necessarily speeding up further.'
          : 'MACD is below its signal line, so short-term momentum is fading or negative. The car has taken its foot off the accelerator, or is braking.';

  const label =
    variant === 'crossUp'
      ? 'MACD \u2014 bullish crossover'
      : variant === 'crossDown'
        ? 'MACD \u2014 bearish crossover'
        : above
          ? 'MACD \u2014 above signal (momentum up)'
          : 'MACD \u2014 below signal (momentum down)';

  return signal({
    id: 'macd',
    label,
    what: 'MACD tracks momentum by subtracting a slow moving average from a fast one. Where that line sits versus its own \u201Csignal\u201D line tells you whether momentum is speeding up or slowing down.',
    meaning,
    watch:
      'MACD works best in trending markets and can whipsaw in choppy, sideways ones. A crossover on its own is weaker than one confirmed by volume.',
    state,
    strength,
    evidenceText,
    variant,
    facts: {
      macd: cur.macd.toFixed(4),
      signal: cur.signal.toFixed(4),
      histogram: cur.histogram.toFixed(4),
      cross,
    },
  });
}

// ---------------------------------------------------------------------------
// R4 — Bollinger Band position
// ---------------------------------------------------------------------------
export function bollingerRule({ candles, indicators }: RuleContext): Signal | null {
  const price = num(last(candles)?.close);
  const b = last(indicators.bb);
  if (price === null || !b) return null;

  const range = b.upper - b.lower;
  if (range <= 0) return null;
  // %B: 0 = at lower band, 1 = at upper band.
  const percentB = (price - b.lower) / range;
  const middleDist = (price - b.middle) / (range / 2);

  let state: SignalState;
  let strength: Strength;
  let variant: string;
  let label: string;
  let meaning: string;

  if (percentB > 0.95) {
    state = 'bearish';
    variant = 'stretchedHigh';
    strength = clamp100(50 + ramp(percentB, 0.95, 1.15) * 45);
    label = 'Bollinger Bands — stretched high';
    meaning =
      'The price is near the top of its recent \u201Cnormal\u201D range (the upper Bollinger Band). Statistically it is stretched. Prices often cool off from here — but note that in a strong uptrend, hugging the upper band is a sign of strength, not weakness.';
  } else if (percentB < 0.05) {
    state = 'bullish';
    variant = 'stretchedLow';
    strength = clamp100(50 + ramp(0.05 - percentB, 0, 0.2) * 45);
    label = 'Bollinger Bands — stretched low';
    meaning =
      'The price is near the bottom of its recent range (the lower Bollinger Band). It is stretched to the downside; short-term bounces are common from here, but a falling price can keep riding the band.';
  } else {
    state = 'neutral';
    variant = 'inside';
    strength = clamp100(25 + ramp(Math.abs(percentB - 0.5), 0, 0.45) * 40);
    label = 'Bollinger Bands — inside the range';
    meaning =
      'The price is inside its normal recent range. There is no statistical stretch in either direction right now.';
  }

  const evidenceText: EvidenceLine[] = [
    line(`Last close: ${r2(price)}`, 'sig.ev.lastClose', { price: r2(price) }),
    line(`Upper band: ${r2(b.upper)}`, 'sig.ev.bbUpper', { value: r2(b.upper) }),
    line(`Middle (20-day average): ${r2(b.middle)}`, 'sig.ev.bbMiddle', { value: r2(b.middle) }),
    line(`Lower band: ${r2(b.lower)}`, 'sig.ev.bbLower', { value: r2(b.lower) }),
    line(
      `Position in the band (%B): ${(percentB * 100).toFixed(1)}% (0% = lower band, 100% = upper band)`,
      'sig.ev.percentB',
      { value: (percentB * 100).toFixed(1) },
    ),
    line(
      `Distance from middle band: ${middleDist >= 0 ? '+' : ''}${(middleDist * 100).toFixed(1)}% of half the band width`,
      'sig.ev.middleDist',
      { value: `${middleDist >= 0 ? '+' : ''}${(middleDist * 100).toFixed(1)}` },
    ),
  ];

  return signal({
    id: 'bollinger',
    label,
    what: 'Bollinger Bands draw a channel around the 20-day average that widens when the stock is volatile and narrows when it is calm. Where the price sits inside the channel tells you if it is stretched.',
    meaning,
    watch: 'Touching a band is not automatically a reversal signal. It means \u201Cstretched\u201D, which is information, not an order.',
    state,
    strength,
    evidenceText,
    variant,
    facts: { percentB: Number((percentB * 100).toFixed(1)) },
  });
}

// ---------------------------------------------------------------------------
// R5 — Volume confirmation
// ---------------------------------------------------------------------------
export function volumeRule({ candles }: RuleContext): Signal | null {
  if (candles.length < 21) return null;
  const recent = candles.slice(-20);
  const avg = recent.reduce((s, c) => s + c.volume, 0) / recent.length;
  const cur = num(last(candles)?.volume);
  const c = last(candles);
  if (cur === null || !c || avg <= 0) return null;

  const ratio = cur / avg;
  const priceUp = c.close >= c.open;

  let state: SignalState;
  let strength: Strength;
  let variant: string;
  let label: string;
  let meaning: string;

  if (ratio >= 1.5) {
    // Heavy volume confirms whatever the price is doing.
    state = priceUp ? 'bullish' : 'bearish';
    strength = clamp100(55 + ramp(ratio, 1.5, 3) * 40);
    variant = priceUp ? 'confirmUp' : 'confirmDown';
    label = priceUp ? 'Volume — confirming an up move' : 'Volume — confirming a down move';
    meaning = priceUp
      ? 'Today is trading on much heavier volume than usual AND the price is up. Extra volume means more people are agreeing with the move, which makes it more trustworthy — like a crowd voting with real money.'
      : 'Today is trading on much heavier volume than usual AND the price is down. Heavy selling volume means the drop has conviction behind it; it is not just drifting.';
  } else if (ratio <= 0.6) {
    state = 'neutral';
    variant = 'quiet';
    strength = clamp100(30 + ramp(0.6 - ratio, 0, 0.45) * 40);
    label = 'Volume — quiet / weak participation';
    meaning =
      'Today is trading on unusually light volume. Move or not, very few people are participating, so this move carries less weight. Quiet moves are easier to reverse.';
  } else {
    state = 'neutral';
    variant = 'normal';
    strength = clamp100(30 + Math.abs(ratio - 1) * 60);
    label = 'Volume — normal';
    meaning =
      'Today\u2019s volume is close to its recent average. Nothing unusual is happening in participation; the move is ordinary.';
  }

  const evidenceText: EvidenceLine[] = [
    line(`Latest volume: ${groupInt(cur)} shares`, 'sig.ev.volumeLatest', { value: groupInt(cur) }),
    line(`20-bar average volume: ${groupInt(avg)} shares`, 'sig.ev.volumeAvg', {
      value: groupInt(avg),
    }),
    line(`Volume ratio: ${ratio.toFixed(2)}x the average`, 'sig.ev.volumeRatio', {
      ratio: ratio.toFixed(2),
    }),
    line(
      `Latest bar: ${priceUp ? 'closed up' : 'closed down'} (open ${r2(c.open)} \u2192 close ${r2(c.close)})`,
      priceUp ? 'sig.ev.barUp' : 'sig.ev.barDown',
      { open: r2(c.open), close: r2(c.close) },
    ),
  ];

  return signal({
    id: 'volume',
    label,
    what: 'Volume is how many shares changed hands. Comparing today with the recent average shows whether the latest move has conviction behind it.',
    meaning,
    watch: 'A price move on thin volume is a weak signal. Big moves on big volume tend to stick.',
    state,
    strength,
    evidenceText,
    variant,
    facts: { ratio: Number(ratio.toFixed(2)) },
  });
}

// ---------------------------------------------------------------------------
// R6 — Volatility squeeze / expansion (Bollinger Band width percentile)
// ---------------------------------------------------------------------------
export function squeezeRule({ candles }: RuleContext): Signal | null {
  const width = bbWidthPercent(candles);
  const lookback = Math.min(120, width.length);
  if (lookback < 20) return null;

  const window = width.slice(-lookback);
  const cur = num(last(window)?.value);
  if (cur === null) return null;

  const sorted = window.map((p) => p.value).sort((a, b) => a - b);
  const below = sorted.filter((v) => v <= cur).length;
  const percentile = (below / sorted.length) * 100;

  let state: SignalState;
  let strength: Strength;
  let variant: string;
  let label: string;
  let meaning: string;

  if (percentile <= 20) {
    state = 'neutral';
    variant = 'squeezed';
    strength = clamp100(45 + ramp(20 - percentile, 0, 20) * 40);
    label = 'Volatility — squeezed (coiled spring)';
    meaning =
      'The Bollinger Bands are unusually narrow compared with the last few months. Narrow bands mean the stock has gone quiet. Quiet periods often end in a sharp move \u2014 but the squeeze alone does not tell you which direction, only that a move may be coming.';
  } else if (percentile >= 80) {
    state = 'neutral';
    variant = 'expanded';
    strength = clamp100(45 + ramp(percentile - 80, 0, 20) * 40);
    label = 'Volatility — expanded (big moves active)';
    meaning =
      'The Bollinger Bands are unusually wide: the stock is swinging hard. Expanded volatility can persist, but very wide bands often appear near emotional peaks or panic lows rather than calm, sustainable trends.';
  } else {
    state = 'neutral';
    variant = 'normal';
    strength = clamp100(25 + Math.abs(percentile - 50) * 0.5);
    label = 'Volatility — normal range';
    meaning =
      'Volatility is in its normal range for this stock. The market is neither unusually quiet nor unusually wild.';
  }

  const evidenceText: EvidenceLine[] = [
    line(`Current band width: ${cur.toFixed(2)}% of the middle band`, 'sig.ev.bandWidth', {
      value: cur.toFixed(2),
    }),    line(`Measured over the last ${lookback} bars`, 'sig.ev.bandWidthBars', { bars: lookback }),
    line(
      `Percentile: ${percentile.toFixed(0)}% (0% = narrowest seen, 100% = widest seen)`,
      'sig.ev.bandWidthPercentile',
      { value: percentile.toFixed(0) },
    ),
    line(
      `Window min/max width: ${sorted[0].toFixed(2)}% / ${sorted[sorted.length - 1].toFixed(2)}%`,
      'sig.ev.bandWidthRange',
      { min: sorted[0].toFixed(2), max: sorted[sorted.length - 1].toFixed(2) },
    ),
  ];

  return signal({
    id: 'squeeze',
    label,
    what: 'Band width measures how calm or wild the stock is. Ranking today\u2019s width against recent history gives a percentile from 0 (calmest) to 100 (wildest).',
    meaning,
    watch: 'A squeeze is a \u201Cget ready\u201D flag, not a direction. Wait for the breakout (with volume) before choosing a side.',
    state,
    strength,
    evidenceText,
    variant,
    facts: { percentile: Number(percentile.toFixed(0)) },
  });
}

// ---------------------------------------------------------------------------
// Aggregate
// ---------------------------------------------------------------------------

/**
 * Whether the candles contain enough history for each rule to be meaningful.
 * Rules that lack data are simply omitted (and counted), never faked.
 */
export function requiredCandles(): number {
  return INDICATOR_PARAMS.sma[2] + 20; // SMA200 + a 20-bar comparison window
}

export function evaluateSignals(ctx: RuleContext): Signal[] {
  const rules = [maTrendRule, rsiRule, macdRule, bollingerRule, volumeRule, squeezeRule];
  const out: Signal[] = [];
  for (const rule of rules) {
    const s = rule(ctx);
    if (s) out.push(s);
  }
  return out;
}

/** The minimum a signal must expose for `summarize` to tally it. */
export type SummarisableSignal = Pick<Signal, 'state' | 'strength'>;

/** Summary tally used by the UI header. */
export function summarize(signals: readonly SummarisableSignal[]): {
  bullish: number;
  bearish: number;
  neutral: number;
  score: number;
  verdict: string;
  verdictVariant: 'bullish' | 'bearish' | 'mixed' | 'noData';
} {
  const bullish = signals.filter((s) => s.state === 'bullish').length;
  const bearish = signals.filter((s) => s.state === 'bearish').length;
  const neutral = signals.filter((s) => s.state === 'neutral').length;
  // Weight each signal by its own strength so a 90-strength rule counts more.
  const total = signals.reduce((s, x) => s + x.strength, 0) || 1;
  const bullWeight = signals.filter((s) => s.state === 'bullish').reduce((s, x) => s + x.strength, 0);
  const bearWeight = signals.filter((s) => s.state === 'bearish').reduce((s, x) => s + x.strength, 0);
  const score = clamp100(50 + ((bullWeight - bearWeight) / total) * 50);

  let verdict: string;
  let verdictVariant: 'bullish' | 'bearish' | 'mixed' | 'noData';
  if (signals.length === 0) {
    verdict = 'Not enough data to score';
    verdictVariant = 'noData';
  } else if (score >= 65) {
    verdict = 'Leaning bullish';
    verdictVariant = 'bullish';
  } else if (score <= 35) {
    verdict = 'Leaning bearish';
    verdictVariant = 'bearish';
  } else {
    verdict = 'Mixed / no clear edge';
    verdictVariant = 'mixed';
  }

  return { bullish, bearish, neutral, score, verdict, verdictVariant };
}
