import type { Dict } from '../index';

/** Signal engine copy (`sig.`): titles, plain-language meanings, what-to-watch notes and evidence templates that must match `shared/signals.ts` exactly. */
export const sig: Dict = {
  // ---- signal copy (keyed by rule id + the variant that fired) ---------
  'sig.ma-trend.title.golden': 'Moving-average trend — golden cross',
  'sig.ma-trend.title.death': 'Moving-average trend — death cross',
  'sig.ma-trend.title.above': 'Moving-average trend — above averages',
  'sig.ma-trend.title.below': 'Moving-average trend — below averages',
  'sig.ma-trend.title.mixed': 'Moving-average trend — mixed',
  'sig.ma-trend.what':
    'The moving-average trend compares today\u2019s price with the average price of the last 50 and 200 days. Smoothed averages strip out daily noise so the underlying direction is visible.',
  'sig.ma-trend.meaning.golden':
    'The 50-day average has just crossed above the 200-day average — a “golden cross”. It is the classic long-term “trend turning up” marker. It confirms a change that has already begun, so expect it to arrive late.',
  'sig.ma-trend.meaning.death':
    'The 50-day average has just crossed below the 200-day average — a “death cross”. It is the classic long-term “trend turning down” marker. Like all average signals it is late, not early.',
  'sig.ma-trend.meaning.above':
    'The price is trading above its medium (50-day) and long (200-day) average lines, and the 50-day line is above the 200-day line. Think of it like a runner who is above their long-term pace and still pulling ahead: the overall trend is up.',
  'sig.ma-trend.meaning.below':
    'The price is below its medium and long average lines, and the 50-day line is below the 200-day line. The overall trend is down — the stock is running slower than its own long-term pace.',
  'sig.ma-trend.meaning.mixed':
    'The price is mixed against its average lines, so there is no clear trend yet. The market has not decided.',
  'sig.ma-trend.watch':
    'Averages lag: they confirm a trend after it has started. When the 50-day crosses above the 200-day it is called a “golden cross” (often bullish); the reverse is a “death cross” (often bearish).',
  'sig.rsi.title.oversold': 'RSI(14) — oversold',
  'sig.rsi.title.overbought': 'RSI(14) — overbought',
  'sig.rsi.title.balanced': 'RSI(14) — balanced',
  'sig.rsi.what':
    'RSI (Relative Strength Index) scores recent up-days versus down-days on a 0–100 scale. Above 70 = hot, below 30 = cold.',
  'sig.rsi.meaning.oversold':
    'RSI below 30 means the stock has been sold off hard recently and is “oversold”. Sellers may be exhausted, so a bounce is possible — but in a genuine downtrend, oversold can stay oversold for a long time. Treat it as “watch for stabilisation”, not “buy now”.',
  'sig.rsi.meaning.overbought':
    'RSI above 70 means the stock has run up hard recently and is “overbought”. Buyers may be running out of steam, so a pullback is possible — though strong trends can stay overbought for weeks.',
  'sig.rsi.meaning.balanced':
    'RSI between 30 and 70 means momentum is balanced — the stock is neither stretched up nor washed out. There is no strong short-term pressure in either direction from this measure.',
  'sig.rsi.watch':
    'RSI is a short-term gauge. It can stay stretched for a long time in a strong trend, so combine it with the trend rule before acting.',
  'sig.macd.title.crossUp': 'MACD — bullish crossover',
  'sig.macd.title.crossDown': 'MACD — bearish crossover',
  'sig.macd.title.aboveSignal': 'MACD — above signal (momentum up)',
  'sig.macd.title.belowSignal': 'MACD — below signal (momentum down)',
  'sig.macd.what':
    'MACD tracks momentum by subtracting a slow moving average from a fast one. Where that line sits versus its own “signal” line tells you whether momentum is speeding up or slowing down.',
  'sig.macd.meaning.crossUp':
    'The MACD line has just crossed above its signal line (a “bullish crossover”). MACD compares a fast-moving average with a slow one; when the fast one pulls ahead, short-term momentum is turning up. It is like a car that has just started accelerating.',
  'sig.macd.meaning.crossDown':
    'The MACD line has just crossed below its signal line (a “bearish crossover”), so short-term momentum is turning down. The car has taken its foot off the accelerator, or is braking.',
  'sig.macd.meaning.aboveSignal':
    'MACD is above its signal line, so short-term momentum is positive. The fast average is still ahead of the slow one — the car is still accelerating, though not necessarily speeding up further.',
  'sig.macd.meaning.belowSignal':
    'MACD is below its signal line, so short-term momentum is fading or negative. The car has taken its foot off the accelerator, or is braking.',
  'sig.macd.watch':
    'MACD works best in trending markets and can whipsaw in choppy, sideways ones. A crossover on its own is weaker than one confirmed by volume.',
  'sig.bollinger.title.stretchedHigh': 'Bollinger Bands — stretched high',
  'sig.bollinger.title.stretchedLow': 'Bollinger Bands — stretched low',
  'sig.bollinger.title.inside': 'Bollinger Bands — inside the range',
  'sig.bollinger.what':
    'Bollinger Bands draw a channel around the 20-day average that widens when the stock is volatile and narrows when it is calm. Where the price sits inside the channel tells you if it is stretched.',
  'sig.bollinger.meaning.stretchedHigh':
    'The price is near the top of its recent “normal” range (the upper Bollinger Band). Statistically it is stretched. Prices often cool off from here — but note that in a strong uptrend, hugging the upper band is a sign of strength, not weakness.',
  'sig.bollinger.meaning.stretchedLow':
    'The price is near the bottom of its recent range (the lower Bollinger Band). It is stretched to the downside; short-term bounces are common from here, but a falling price can keep riding the band.',
  'sig.bollinger.meaning.inside':
    'The price is inside its normal recent range. There is no statistical stretch in either direction right now.',
  'sig.bollinger.watch':
    'Touching a band is not automatically a reversal signal. It means “stretched”, which is information, not an order.',
  'sig.volume.title.confirmUp': 'Volume — confirming an up move',
  'sig.volume.title.confirmDown': 'Volume — confirming a down move',
  'sig.volume.title.quiet': 'Volume — quiet / weak participation',
  'sig.volume.title.normal': 'Volume — normal',
  'sig.volume.what':
    'Volume is how many shares changed hands. Comparing today with the recent average shows whether the latest move has conviction behind it.',
  'sig.volume.meaning.confirmUp':
    'Today is trading on much heavier volume than usual AND the price is up. Extra volume means more people are agreeing with the move, which makes it more trustworthy — like a crowd voting with real money.',
  'sig.volume.meaning.confirmDown':
    'Today is trading on much heavier volume than usual AND the price is down. Heavy selling volume means the drop has conviction behind it; it is not just drifting.',
  'sig.volume.meaning.quiet':
    'Today is trading on unusually light volume. Move or not, very few people are participating, so this move carries less weight. Quiet moves are easier to reverse.',
  'sig.volume.meaning.normal':
    'Today\u2019s volume is close to its recent average. Nothing unusual is happening in participation; the move is ordinary.',
  'sig.volume.watch': 'A price move on thin volume is a weak signal. Big moves on big volume tend to stick.',
  'sig.squeeze.title.squeezed': 'Volatility — squeezed (coiled spring)',
  'sig.squeeze.title.expanded': 'Volatility — expanded (big moves active)',
  'sig.squeeze.title.normal': 'Volatility — normal range',
  'sig.squeeze.what':
    'Band width measures how calm or wild the stock is. Ranking today\u2019s width against recent history gives a percentile from 0 (calmest) to 100 (wildest).',
  'sig.squeeze.meaning.squeezed':
    'The Bollinger Bands are unusually narrow compared with the last few months. Narrow bands mean the stock has gone quiet. Quiet periods often end in a sharp move — but the squeeze alone does not tell you which direction, only that a move may be coming.',
  'sig.squeeze.meaning.expanded':
    'The Bollinger Bands are unusually wide: the stock is swinging hard. Expanded volatility can persist, but very wide bands often appear near emotional peaks or panic lows rather than calm, sustainable trends.',
  'sig.squeeze.meaning.normal':
    'Volatility is in its normal range for this stock. The market is neither unusually quiet nor unusually wild.',
  'sig.squeeze.watch':
    'A squeeze is a “get ready” flag, not a direction. Wait for the breakout (with volume) before choosing a side.',
  // ---- signal evidence templates (must match shared/signals.ts exactly) --
  'sig.ev.lastClose': 'Last close: {price}',
  'sig.ev.sma50': 'SMA50: {value} (price is {pct})',
  'sig.ev.sma200': 'SMA200: {value} (price is {pct})',
  'sig.ev.maStructureUp': 'SMA50 vs SMA200: SMA50 above (uptrend structure)',
  'sig.ev.maStructureDown': 'SMA50 vs SMA200: SMA50 below (downtrend structure)',
  'sig.ev.trendChecks': '{pass} of {total} trend checks agree',
  'sig.ev.checksTrue': 'Checks true ({count} of {total})',
  'sig.ev.checksFalse': 'Checks false ({count} of {total})',
  'sig.ev.crossGolden': 'Crossover: golden cross (bullish) detected on the latest bars',
  'sig.ev.crossDeath': 'Crossover: death cross (bearish) detected on the latest bars',
  'sig.check.priceAboveSma50': 'Price above SMA50',
  'sig.check.priceAboveSma200': 'Price above SMA200',
  'sig.check.sma50AboveSma200': 'SMA50 above SMA200',
  'sig.ev.rsi': 'RSI(14): {value}',
  'sig.ev.rsiBelow': 'Below the 30 oversold line by {value} points',
  'sig.ev.rsiAbove': 'Above the 70 overbought line by {value} points',
  'sig.ev.rsiBetween': 'Sitting comfortably between the 30 and 70 lines',
  'sig.ev.macdLine': 'MACD line: {value}',
  'sig.ev.signalLine': 'Signal line: {value}',
  'sig.ev.histogramPositive': 'Histogram: {value} (positive)',
  'sig.ev.histogramNegative': 'Histogram: {value} (negative)',
  'sig.ev.macdAbove': 'MACD is above its signal line',
  'sig.ev.macdBelow': 'MACD is below its signal line',
  'sig.ev.histRising': 'Histogram vs previous bar: expanding upward',
  'sig.ev.histFalling': 'Histogram vs previous bar: contracting / falling',
  'sig.ev.crossBullish': 'Bullish crossover confirmed on the latest bars',
  'sig.ev.crossBearish': 'Bearish crossover confirmed on the latest bars',
  'sig.ev.bbUpper': 'Upper band: {value}',
  'sig.ev.bbMiddle': 'Middle (20-day average): {value}',
  'sig.ev.bbLower': 'Lower band: {value}',
  'sig.ev.percentB': 'Position in the band (%B): {value}% (0% = lower band, 100% = upper band)',
  'sig.ev.middleDist': 'Distance from middle band: {value}% of half the band width',
  'sig.ev.volumeLatest': 'Latest volume: {value} shares',
  'sig.ev.volumeAvg': '20-bar average volume: {value} shares',
  'sig.ev.volumeRatio': 'Volume ratio: {ratio}x the average',
  'sig.ev.barUp': 'Latest bar: closed up (open {open} → close {close})',
  'sig.ev.barDown': 'Latest bar: closed down (open {open} → close {close})',
  'sig.ev.bandWidth': 'Current band width: {value}% of the middle band',
  'sig.ev.bandWidthBars': 'Measured over the last {bars} bars',
  'sig.ev.bandWidthPercentile': 'Percentile: {value}% (0% = narrowest seen, 100% = widest seen)',
  'sig.ev.bandWidthRange': 'Window min/max width: {min}% / {max}%',
};
