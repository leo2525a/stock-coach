// server/index.ts
import { mkdirSync } from "node:fs";
import path2 from "node:path";
import { fileURLToPath as fileURLToPath2 } from "node:url";

// server/app.ts
import express from "express";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// shared/indicators.ts
import { SMA, EMA, RSI, MACD, BollingerBands, ATR } from "technicalindicators";
var dfault = {
  sma: [20, 50, 200],
  ema: [12, 26],
  rsi: 14,
  macd: { fast: 12, slow: 26, signal: 9 },
  bb: { period: 20, stdDev: 2 },
  atr: 14
};
function closes(candles) {
  return candles.map((c) => c.close);
}
function tailTimes(candles, outLength) {
  const offset = candles.length - outLength;
  const times = [];
  for (let i = 0; i < outLength; i += 1) times.push(candles[offset + i].time);
  return times;
}
function sma(candles, period) {
  if (period <= 0 || candles.length < period) return [];
  const values = closes(candles);
  const out = SMA.calculate({ period, values });
  const times = tailTimes(candles, out.length);
  return out.map((value, i) => ({ time: times[i], value }));
}
function ema(candles, period) {
  if (period <= 0 || candles.length < period) return [];
  const values = closes(candles);
  const out = EMA.calculate({ period, values });
  const times = tailTimes(candles, out.length);
  return out.map((value, i) => ({ time: times[i], value }));
}
function bollinger(candles, period = dfault.bb.period, stdDev = dfault.bb.stdDev) {
  if (period <= 0 || candles.length < period) return [];
  const values = closes(candles);
  const out = BollingerBands.calculate({ period, stdDev, values });
  const times = tailTimes(candles, out.length);
  return out.map((b, i) => ({
    time: times[i],
    upper: b.upper,
    middle: b.middle,
    lower: b.lower
  }));
}
function bbWidthPercent(candles, period = dfault.bb.period, stdDev = dfault.bb.stdDev) {
  return bollinger(candles, period, stdDev).filter((b) => b.middle !== 0).map((b) => ({ time: b.time, value: (b.upper - b.lower) / b.middle * 100 }));
}
function rsi(candles, period = dfault.rsi) {
  if (period <= 0 || candles.length <= period) return [];
  const out = RSI.calculate({ period, values: closes(candles) });
  const times = tailTimes(candles, out.length);
  return out.map((value, i) => ({ time: times[i], value }));
}
function macd(candles, fastPeriod = dfault.macd.fast, slowPeriod = dfault.macd.slow, signalPeriod = dfault.macd.signal) {
  if (candles.length < slowPeriod + signalPeriod) return [];
  const raw = MACD.calculate({
    values: closes(candles),
    fastPeriod,
    slowPeriod,
    signalPeriod,
    SimpleMAOscillator: false,
    SimpleMASignal: false
  });
  const full = raw.filter(
    (r) => typeof r.MACD === "number" && typeof r.signal === "number" && typeof r.histogram === "number"
  );
  const times = tailTimes(candles, full.length);
  return full.map((r, i) => ({
    time: times[i],
    macd: r.MACD,
    signal: r.signal,
    histogram: r.histogram
  }));
}
function computeIndicators(candles) {
  return {
    sma20: sma(candles, dfault.sma[0]),
    sma50: sma(candles, dfault.sma[1]),
    sma200: sma(candles, dfault.sma[2]),
    ema12: ema(candles, dfault.ema[0]),
    ema26: ema(candles, dfault.ema[1]),
    bb: bollinger(candles),
    rsi14: rsi(candles),
    macd: macd(candles)
  };
}
var INDICATOR_PARAMS = dfault;

// shared/signals.ts
var num = (v) => typeof v === "number" && Number.isFinite(v) ? v : null;
var last = (arr2) => arr2[arr2.length - 1];
var pct = (a, b) => `${(a - b) / b * 100 >= 0 ? "+" : ""}${((a - b) / b * 100).toFixed(2)}%`;
var r2 = (v) => v.toFixed(2);
function clamp100(v) {
  return Math.max(0, Math.min(100, Math.round(v)));
}
function ramp(value, at, full) {
  if (full === at) return 0;
  return (value - at) / (full - at);
}
var groupInt = (v) => Math.round(v).toLocaleString("en-US");
function line(text, key, params = {}, lists) {
  return { text, i18n: { key, params, ...lists ? { lists } : {} } };
}
function signal(rule) {
  const { evidenceText, variant, ...rest } = rule;
  return {
    ...rest,
    variant: variant ?? rule.state,
    evidence: evidenceText.map((e) => e.text),
    evidenceI18n: evidenceText.map((e) => ({
      key: e.i18n.key,
      params: e.i18n.params,
      ...e.i18n.lists ? { lists: e.i18n.lists } : {}
    }))
  };
}
function maTrendRule({ candles, indicators }) {
  const price = num(last(candles)?.close);
  const s50 = num(last(indicators.sma50)?.value);
  const s200 = num(last(indicators.sma200)?.value);
  if (price === null || s50 === null || s200 === null) return null;
  const evidenceText = [
    line(`Last close: ${r2(price)}`, "sig.ev.lastClose", { price: r2(price) }),
    line(`SMA50: ${r2(s50)} (price is ${pct(price, s50)})`, "sig.ev.sma50", {
      value: r2(s50),
      pct: pct(price, s50)
    }),
    line(`SMA200: ${r2(s200)} (price is ${pct(price, s200)})`, "sig.ev.sma200", {
      value: r2(s200),
      pct: pct(price, s200)
    }),
    line(
      `SMA50 vs SMA200: ${s50 > s200 ? "SMA50 above (uptrend structure)" : "SMA50 below (downtrend structure)"}`,
      s50 > s200 ? "sig.ev.maStructureUp" : "sig.ev.maStructureDown"
    )
  ];
  const prevS50 = num(indicators.sma50[indicators.sma50.length - 2]?.value);
  const prevS200 = num(indicators.sma200[indicators.sma200.length - 2]?.value);
  let cross = "none";
  if (prevS50 !== null && prevS200 !== null) {
    if (prevS50 <= prevS200 && s50 > s200) cross = "golden";
    else if (prevS50 >= prevS200 && s50 < s200) cross = "death";
  }
  const checks = [
    { key: "sig.check.priceAboveSma50", pass: price > s50 },
    { key: "sig.check.priceAboveSma200", pass: price > s200 },
    { key: "sig.check.sma50AboveSma200", pass: s50 > s200 }
  ];
  const trueCount = checks.filter((c) => c.pass).length;
  const ratio2 = trueCount / checks.length;
  let state;
  if (ratio2 === 1 || cross === "golden" && ratio2 >= 2 / 3) state = "bullish";
  else if (ratio2 === 0 || cross === "death" && ratio2 <= 1 / 3) state = "bearish";
  else state = "neutral";
  const conviction = Math.abs(ratio2 - 0.5) * 2;
  let strength = clamp100(45 + conviction * 45 + (cross === "none" ? 0 : 10));
  if (state === "neutral") strength = Math.min(strength, 55);
  const held = checks.filter((t) => t.pass).map((t) => t.key);
  const failed = checks.filter((t) => !t.pass).map((t) => t.key);
  evidenceText.push(
    line(`${trueCount} of ${checks.length} trend checks agree`, "sig.ev.trendChecks", {
      pass: trueCount,
      total: checks.length
    })
  );
  evidenceText.push(
    line(
      `Checks true (${held.length} of ${checks.length})`,
      "sig.ev.checksTrue",
      { count: held.length, total: checks.length },
      { checks: held }
    )
  );
  if (failed.length) {
    evidenceText.push(
      line(
        `Checks false (${failed.length} of ${checks.length})`,
        "sig.ev.checksFalse",
        { count: failed.length, total: checks.length },
        { checks: failed }
      )
    );
  }
  if (cross !== "none") {
    evidenceText.push(
      line(
        `Crossover: ${cross === "golden" ? "golden cross (bullish)" : "death cross (bearish)"} detected on the latest bars`,
        cross === "golden" ? "sig.ev.crossGolden" : "sig.ev.crossDeath"
      )
    );
  }
  const variant = cross === "golden" ? "golden" : cross === "death" ? "death" : state === "bullish" ? "above" : state === "bearish" ? "below" : "mixed";
  const meaning = state === "bullish" ? "The price is trading above its medium (50-day) and long (200-day) average lines, and the 50-day line is above the 200-day line. Think of it like a runner who is above their long-term pace and still pulling ahead: the overall trend is up." : state === "bearish" ? "The price is below its medium and long average lines, and the 50-day line is below the 200-day line. The overall trend is down \u2014 the stock is running slower than its own long-term pace." : "The price is mixed against its average lines, so there is no clear trend yet. The market has not decided.";
  const label = cross === "golden" ? "Moving-average trend \u2014 golden cross" : cross === "death" ? "Moving-average trend \u2014 death cross" : state === "bullish" ? "Moving-average trend \u2014 above averages" : state === "bearish" ? "Moving-average trend \u2014 below averages" : "Moving-average trend \u2014 mixed";
  return signal({
    id: "ma-trend",
    label,
    what: "The moving-average trend compares today\u2019s price with the average price of the last 50 and 200 days. Smoothed averages strip out daily noise so the underlying direction is visible.",
    meaning,
    watch: "Averages lag: they confirm a trend after it has started. When the 50-day crosses above the 200-day it is called a \u201Cgolden cross\u201D (often bullish); the reverse is a \u201Cdeath cross\u201D (often bearish).",
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
      cross
    }
  });
}
function rsiRule({ indicators }) {
  const v = num(last(indicators.rsi14)?.value);
  if (v === null) return null;
  const evidenceText = [line(`RSI(14): ${r2(v)}`, "sig.ev.rsi", { value: r2(v) })];
  let state;
  let strength;
  let meaning;
  let variant;
  if (v < 30) {
    state = "bullish";
    strength = clamp100(50 + ramp(30 - v, 0, 20) * 50);
    variant = "oversold";
    meaning = "RSI below 30 means the stock has been sold off hard recently and is \u201Coversold\u201D. Sellers may be exhausted, so a bounce is possible \u2014 but in a genuine downtrend, oversold can stay oversold for a long time. Treat it as \u201Cwatch for stabilisation\u201D, not \u201Cbuy now\u201D.";
  } else if (v > 70) {
    state = "bearish";
    strength = clamp100(50 + ramp(v - 70, 0, 20) * 50);
    variant = "overbought";
    meaning = "RSI above 70 means the stock has run up hard recently and is \u201Coverbought\u201D. Buyers may be running out of steam, so a pullback is possible \u2014 though strong trends can stay overbought for weeks.";
  } else {
    state = "neutral";
    variant = "balanced";
    strength = clamp100(25 + ramp(Math.abs(v - 50), 0, 20) * 45);
    meaning = "RSI between 30 and 70 means momentum is balanced \u2014 the stock is neither stretched up nor washed out. There is no strong short-term pressure in either direction from this measure.";
  }
  if (v < 30) {
    evidenceText.push(
      line(`Below the 30 oversold line by ${r2(30 - v)} points`, "sig.ev.rsiBelow", {
        value: r2(30 - v)
      })
    );
  } else if (v > 70) {
    evidenceText.push(
      line(`Above the 70 overbought line by ${r2(v - 70)} points`, "sig.ev.rsiAbove", {
        value: r2(v - 70)
      })
    );
  } else {
    evidenceText.push(line("Sitting comfortably between the 30 and 70 lines", "sig.ev.rsiBetween"));
  }
  return signal({
    id: "rsi",
    label: v < 30 ? "RSI(14) \u2014 oversold" : v > 70 ? "RSI(14) \u2014 overbought" : "RSI(14) \u2014 balanced",
    what: "RSI (Relative Strength Index) scores recent up-days versus down-days on a 0\u2013100 scale. Above 70 = hot, below 30 = cold.",
    meaning,
    watch: "RSI is a short-term gauge. It can stay stretched for a long time in a strong trend, so combine it with the trend rule before acting.",
    state,
    strength,
    evidenceText,
    variant,
    facts: { value: Number(v.toFixed(2)) }
  });
}
function macdRule({ indicators }) {
  const cur = last(indicators.macd);
  const prev = indicators.macd[indicators.macd.length - 2];
  if (!cur) return null;
  const above = cur.macd > cur.signal;
  let cross = "none";
  if (prev) {
    if (prev.macd <= prev.signal && cur.macd > cur.signal) cross = "bullish";
    else if (prev.macd >= prev.signal && cur.macd < cur.signal) cross = "bearish";
  }
  const histRising = prev ? cur.histogram > prev.histogram : cur.histogram > 0;
  const state = cross === "bullish" ? "bullish" : cross === "bearish" ? "bearish" : above ? "bullish" : "bearish";
  const magnitude = Math.abs(cur.histogram);
  const scale = Math.max(magnitude, Math.abs(cur.macd - cur.signal), 1e-4);
  const agreement = histRising === above || cross === "bullish" && histRising ? 1 : 0.5;
  const strength = clamp100(35 + (cross !== "none" ? 30 : 0) + Math.min(25, scale * 3) * agreement);
  const evidenceText = [
    line(`MACD line: ${cur.macd.toFixed(4)}`, "sig.ev.macdLine", { value: cur.macd.toFixed(4) }),
    line(`Signal line: ${cur.signal.toFixed(4)}`, "sig.ev.signalLine", {
      value: cur.signal.toFixed(4)
    }),
    line(
      `Histogram: ${cur.histogram.toFixed(4)} (${cur.histogram >= 0 ? "positive" : "negative"})`,
      cur.histogram >= 0 ? "sig.ev.histogramPositive" : "sig.ev.histogramNegative",
      { value: cur.histogram.toFixed(4) }
    ),
    line(
      `MACD is ${above ? "above" : "below"} its signal line`,
      above ? "sig.ev.macdAbove" : "sig.ev.macdBelow"
    )
  ];
  if (prev) {
    evidenceText.push(
      line(
        `Histogram vs previous bar: ${histRising ? "expanding upward" : "contracting / falling"}`,
        histRising ? "sig.ev.histRising" : "sig.ev.histFalling"
      )
    );
  }
  if (cross !== "none") {
    evidenceText.push(
      line(
        `${cross === "bullish" ? "Bullish" : "Bearish"} crossover confirmed on the latest bars`,
        cross === "bullish" ? "sig.ev.crossBullish" : "sig.ev.crossBearish"
      )
    );
  }
  const variant = cross === "bullish" ? "crossUp" : cross === "bearish" ? "crossDown" : above ? "aboveSignal" : "belowSignal";
  const meaning = variant === "crossUp" ? "The MACD line has just crossed above its signal line (a \u201Cbullish crossover\u201D). MACD compares a fast-moving average with a slow one; when the fast one pulls ahead, short-term momentum is turning up. It is like a car that has just started accelerating." : variant === "crossDown" ? "The MACD line has just crossed below its signal line (a \u201Cbearish crossover\u201D), so short-term momentum is turning down. The car has taken its foot off the accelerator, or is braking." : variant === "aboveSignal" ? "MACD is above its signal line, so short-term momentum is positive. The fast average is still ahead of the slow one \u2014 the car is still accelerating, though not necessarily speeding up further." : "MACD is below its signal line, so short-term momentum is fading or negative. The car has taken its foot off the accelerator, or is braking.";
  const label = variant === "crossUp" ? "MACD \u2014 bullish crossover" : variant === "crossDown" ? "MACD \u2014 bearish crossover" : above ? "MACD \u2014 above signal (momentum up)" : "MACD \u2014 below signal (momentum down)";
  return signal({
    id: "macd",
    label,
    what: "MACD tracks momentum by subtracting a slow moving average from a fast one. Where that line sits versus its own \u201Csignal\u201D line tells you whether momentum is speeding up or slowing down.",
    meaning,
    watch: "MACD works best in trending markets and can whipsaw in choppy, sideways ones. A crossover on its own is weaker than one confirmed by volume.",
    state,
    strength,
    evidenceText,
    variant,
    facts: {
      macd: cur.macd.toFixed(4),
      signal: cur.signal.toFixed(4),
      histogram: cur.histogram.toFixed(4),
      cross
    }
  });
}
function bollingerRule({ candles, indicators }) {
  const price = num(last(candles)?.close);
  const b = last(indicators.bb);
  if (price === null || !b) return null;
  const range = b.upper - b.lower;
  if (range <= 0) return null;
  const percentB = (price - b.lower) / range;
  const middleDist = (price - b.middle) / (range / 2);
  let state;
  let strength;
  let variant;
  let label;
  let meaning;
  if (percentB > 0.95) {
    state = "bearish";
    variant = "stretchedHigh";
    strength = clamp100(50 + ramp(percentB, 0.95, 1.15) * 45);
    label = "Bollinger Bands \u2014 stretched high";
    meaning = "The price is near the top of its recent \u201Cnormal\u201D range (the upper Bollinger Band). Statistically it is stretched. Prices often cool off from here \u2014 but note that in a strong uptrend, hugging the upper band is a sign of strength, not weakness.";
  } else if (percentB < 0.05) {
    state = "bullish";
    variant = "stretchedLow";
    strength = clamp100(50 + ramp(0.05 - percentB, 0, 0.2) * 45);
    label = "Bollinger Bands \u2014 stretched low";
    meaning = "The price is near the bottom of its recent range (the lower Bollinger Band). It is stretched to the downside; short-term bounces are common from here, but a falling price can keep riding the band.";
  } else {
    state = "neutral";
    variant = "inside";
    strength = clamp100(25 + ramp(Math.abs(percentB - 0.5), 0, 0.45) * 40);
    label = "Bollinger Bands \u2014 inside the range";
    meaning = "The price is inside its normal recent range. There is no statistical stretch in either direction right now.";
  }
  const evidenceText = [
    line(`Last close: ${r2(price)}`, "sig.ev.lastClose", { price: r2(price) }),
    line(`Upper band: ${r2(b.upper)}`, "sig.ev.bbUpper", { value: r2(b.upper) }),
    line(`Middle (20-day average): ${r2(b.middle)}`, "sig.ev.bbMiddle", { value: r2(b.middle) }),
    line(`Lower band: ${r2(b.lower)}`, "sig.ev.bbLower", { value: r2(b.lower) }),
    line(
      `Position in the band (%B): ${(percentB * 100).toFixed(1)}% (0% = lower band, 100% = upper band)`,
      "sig.ev.percentB",
      { value: (percentB * 100).toFixed(1) }
    ),
    line(
      `Distance from middle band: ${middleDist >= 0 ? "+" : ""}${(middleDist * 100).toFixed(1)}% of half the band width`,
      "sig.ev.middleDist",
      { value: `${middleDist >= 0 ? "+" : ""}${(middleDist * 100).toFixed(1)}` }
    )
  ];
  return signal({
    id: "bollinger",
    label,
    what: "Bollinger Bands draw a channel around the 20-day average that widens when the stock is volatile and narrows when it is calm. Where the price sits inside the channel tells you if it is stretched.",
    meaning,
    watch: "Touching a band is not automatically a reversal signal. It means \u201Cstretched\u201D, which is information, not an order.",
    state,
    strength,
    evidenceText,
    variant,
    facts: { percentB: Number((percentB * 100).toFixed(1)) }
  });
}
function volumeRule({ candles }) {
  if (candles.length < 21) return null;
  const recent = candles.slice(-20);
  const avg = recent.reduce((s, c2) => s + c2.volume, 0) / recent.length;
  const cur = num(last(candles)?.volume);
  const c = last(candles);
  if (cur === null || !c || avg <= 0) return null;
  const ratio2 = cur / avg;
  const priceUp = c.close >= c.open;
  let state;
  let strength;
  let variant;
  let label;
  let meaning;
  if (ratio2 >= 1.5) {
    state = priceUp ? "bullish" : "bearish";
    strength = clamp100(55 + ramp(ratio2, 1.5, 3) * 40);
    variant = priceUp ? "confirmUp" : "confirmDown";
    label = priceUp ? "Volume \u2014 confirming an up move" : "Volume \u2014 confirming a down move";
    meaning = priceUp ? "Today is trading on much heavier volume than usual AND the price is up. Extra volume means more people are agreeing with the move, which makes it more trustworthy \u2014 like a crowd voting with real money." : "Today is trading on much heavier volume than usual AND the price is down. Heavy selling volume means the drop has conviction behind it; it is not just drifting.";
  } else if (ratio2 <= 0.6) {
    state = "neutral";
    variant = "quiet";
    strength = clamp100(30 + ramp(0.6 - ratio2, 0, 0.45) * 40);
    label = "Volume \u2014 quiet / weak participation";
    meaning = "Today is trading on unusually light volume. Move or not, very few people are participating, so this move carries less weight. Quiet moves are easier to reverse.";
  } else {
    state = "neutral";
    variant = "normal";
    strength = clamp100(30 + Math.abs(ratio2 - 1) * 60);
    label = "Volume \u2014 normal";
    meaning = "Today\u2019s volume is close to its recent average. Nothing unusual is happening in participation; the move is ordinary.";
  }
  const evidenceText = [
    line(`Latest volume: ${groupInt(cur)} shares`, "sig.ev.volumeLatest", { value: groupInt(cur) }),
    line(`20-bar average volume: ${groupInt(avg)} shares`, "sig.ev.volumeAvg", {
      value: groupInt(avg)
    }),
    line(`Volume ratio: ${ratio2.toFixed(2)}x the average`, "sig.ev.volumeRatio", {
      ratio: ratio2.toFixed(2)
    }),
    line(
      `Latest bar: ${priceUp ? "closed up" : "closed down"} (open ${r2(c.open)} \u2192 close ${r2(c.close)})`,
      priceUp ? "sig.ev.barUp" : "sig.ev.barDown",
      { open: r2(c.open), close: r2(c.close) }
    )
  ];
  return signal({
    id: "volume",
    label,
    what: "Volume is how many shares changed hands. Comparing today with the recent average shows whether the latest move has conviction behind it.",
    meaning,
    watch: "A price move on thin volume is a weak signal. Big moves on big volume tend to stick.",
    state,
    strength,
    evidenceText,
    variant,
    facts: { ratio: Number(ratio2.toFixed(2)) }
  });
}
function squeezeRule({ candles }) {
  const width = bbWidthPercent(candles);
  const lookback = Math.min(120, width.length);
  if (lookback < 20) return null;
  const window = width.slice(-lookback);
  const cur = num(last(window)?.value);
  if (cur === null) return null;
  const sorted = window.map((p) => p.value).sort((a, b) => a - b);
  const below = sorted.filter((v) => v <= cur).length;
  const percentile = below / sorted.length * 100;
  let state;
  let strength;
  let variant;
  let label;
  let meaning;
  if (percentile <= 20) {
    state = "neutral";
    variant = "squeezed";
    strength = clamp100(45 + ramp(20 - percentile, 0, 20) * 40);
    label = "Volatility \u2014 squeezed (coiled spring)";
    meaning = "The Bollinger Bands are unusually narrow compared with the last few months. Narrow bands mean the stock has gone quiet. Quiet periods often end in a sharp move \u2014 but the squeeze alone does not tell you which direction, only that a move may be coming.";
  } else if (percentile >= 80) {
    state = "neutral";
    variant = "expanded";
    strength = clamp100(45 + ramp(percentile - 80, 0, 20) * 40);
    label = "Volatility \u2014 expanded (big moves active)";
    meaning = "The Bollinger Bands are unusually wide: the stock is swinging hard. Expanded volatility can persist, but very wide bands often appear near emotional peaks or panic lows rather than calm, sustainable trends.";
  } else {
    state = "neutral";
    variant = "normal";
    strength = clamp100(25 + Math.abs(percentile - 50) * 0.5);
    label = "Volatility \u2014 normal range";
    meaning = "Volatility is in its normal range for this stock. The market is neither unusually quiet nor unusually wild.";
  }
  const evidenceText = [
    line(`Current band width: ${cur.toFixed(2)}% of the middle band`, "sig.ev.bandWidth", {
      value: cur.toFixed(2)
    }),
    line(`Measured over the last ${lookback} bars`, "sig.ev.bandWidthBars", { bars: lookback }),
    line(
      `Percentile: ${percentile.toFixed(0)}% (0% = narrowest seen, 100% = widest seen)`,
      "sig.ev.bandWidthPercentile",
      { value: percentile.toFixed(0) }
    ),
    line(
      `Window min/max width: ${sorted[0].toFixed(2)}% / ${sorted[sorted.length - 1].toFixed(2)}%`,
      "sig.ev.bandWidthRange",
      { min: sorted[0].toFixed(2), max: sorted[sorted.length - 1].toFixed(2) }
    )
  ];
  return signal({
    id: "squeeze",
    label,
    what: "Band width measures how calm or wild the stock is. Ranking today\u2019s width against recent history gives a percentile from 0 (calmest) to 100 (wildest).",
    meaning,
    watch: "A squeeze is a \u201Cget ready\u201D flag, not a direction. Wait for the breakout (with volume) before choosing a side.",
    state,
    strength,
    evidenceText,
    variant,
    facts: { percentile: Number(percentile.toFixed(0)) }
  });
}
function requiredCandles() {
  return INDICATOR_PARAMS.sma[2] + 20;
}
function evaluateSignals(ctx) {
  const rules = [maTrendRule, rsiRule, macdRule, bollingerRule, volumeRule, squeezeRule];
  const out = [];
  for (const rule of rules) {
    const s = rule(ctx);
    if (s) out.push(s);
  }
  return out;
}
function summarize(signals) {
  const bullish = signals.filter((s) => s.state === "bullish").length;
  const bearish = signals.filter((s) => s.state === "bearish").length;
  const neutral = signals.filter((s) => s.state === "neutral").length;
  const total = signals.reduce((s, x) => s + x.strength, 0) || 1;
  const bullWeight = signals.filter((s) => s.state === "bullish").reduce((s, x) => s + x.strength, 0);
  const bearWeight = signals.filter((s) => s.state === "bearish").reduce((s, x) => s + x.strength, 0);
  const score = clamp100(50 + (bullWeight - bearWeight) / total * 50);
  let verdict;
  let verdictVariant;
  if (signals.length === 0) {
    verdict = "Not enough data to score";
    verdictVariant = "noData";
  } else if (score >= 65) {
    verdict = "Leaning bullish";
    verdictVariant = "bullish";
  } else if (score <= 35) {
    verdict = "Leaning bearish";
    verdictVariant = "bearish";
  } else {
    verdict = "Mixed / no clear edge";
    verdictVariant = "mixed";
  }
  return { bullish, bearish, neutral, score, verdict, verdictVariant };
}

// shared/format.ts
var HKT_TIME_ZONE = "Asia/Hong_Kong";
var hktDateTime = new Intl.DateTimeFormat("en-GB", {
  timeZone: HKT_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false
});
var hktDate = new Intl.DateTimeFormat("en-GB", {
  timeZone: HKT_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});
var hktTime = new Intl.DateTimeFormat("en-GB", {
  timeZone: HKT_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false
});
function normalizeSymbol(raw) {
  return raw.trim().toUpperCase().replace(/\s+/g, "");
}
function isValidSymbol(symbol) {
  return /^[A-Z0-9][A-Z0-9.\-=^]{0,14}$/.test(symbol);
}

// shared/yahoo.ts
var YAHOO_INTERVAL = {
  "1m": "1m",
  "5m": "5m",
  "15m": "15m",
  "1h": "1h",
  "1d": "1d",
  "1w": "1wk",
  "1mo": "1mo"
};
var BAR_SECONDS = {
  "1m": 60,
  "5m": 300,
  "15m": 900,
  "1h": 3600,
  "1d": 86400,
  "1w": 604800,
  "1mo": 2592e3
};
var YahooParseError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "YahooParseError";
  }
};
var asNumber = (v) => typeof v === "number" && Number.isFinite(v) ? v : null;
function asNumberArray(v) {
  if (!Array.isArray(v)) return [];
  return v.map((x) => asNumber(x));
}
function parseCandles(json) {
  const root = json;
  const result2 = root?.chart?.result?.[0];
  if (!result2) {
    const desc = root?.chart?.error?.description;
    throw new YahooParseError(desc ? `Yahoo returned an error: ${desc}` : "Yahoo response had no result");
  }
  const timestamps = asNumberArray(result2.timestamp);
  const quote = result2.indicators?.quote?.[0];
  if (!quote) throw new YahooParseError("Yahoo response had no quote data");
  const open = asNumberArray(quote.open);
  const high = asNumberArray(quote.high);
  const low = asNumberArray(quote.low);
  const close = asNumberArray(quote.close);
  const volume = asNumberArray(quote.volume);
  const candles = [];
  for (let i = 0; i < timestamps.length; i += 1) {
    const time = timestamps[i];
    const o = open[i];
    const h = high[i];
    const l = low[i];
    const c = close[i];
    if (time === null || o === null || h === null || l === null || c === null) continue;
    candles.push({
      time,
      open: o,
      high: h,
      low: l,
      close: c,
      volume: volume[i] ?? 0
    });
  }
  candles.sort((a, b) => a.time - b.time);
  const deduped = [];
  for (const candle of candles) {
    if (deduped.length && deduped[deduped.length - 1].time === candle.time) {
      deduped[deduped.length - 1] = candle;
    } else {
      deduped.push(candle);
    }
  }
  return deduped;
}
function parseMeta(json, fallbackSymbol) {
  const root = json;
  const result2 = root?.chart?.result?.[0];
  if (!result2) throw new YahooParseError("Yahoo response had no result");
  const m = result2.meta ?? {};
  const str3 = (v, fallback = "") => typeof v === "string" && v ? v : fallback;
  const lastPrice = asNumber(m.regularMarketPrice);
  const explicitChange = asNumber(m.regularMarketChange) ?? asNumber(m.fulldayChange);
  const chartPrev = asNumber(m.chartPreviousClose) ?? asNumber(m.previousClose);
  let previousClose = null;
  let computedChange = null;
  if (lastPrice !== null && explicitChange !== null) {
    computedChange = explicitChange;
    previousClose = lastPrice - explicitChange;
  } else if (lastPrice !== null && chartPrev !== null) {
    previousClose = chartPrev;
    computedChange = lastPrice - chartPrev;
  } else {
    previousClose = chartPrev;
  }
  const changePercent = asNumber(m.regularMarketChangePercent) ?? asNumber(m.fulldayChangePercent) ?? (computedChange !== null && previousClose ? computedChange / previousClose * 100 : null);
  return {
    symbol: str3(m.symbol, fallbackSymbol).toUpperCase(),
    name: str3(m.longName) || str3(m.shortName) || str3(m.symbol, fallbackSymbol).toUpperCase(),
    currency: str3(m.currency, "USD"),
    exchange: str3(m.fullExchangeName) || str3(m.exchangeName),
    exchangeTimezone: str3(m.exchangeTimezoneName) || str3(m.timezone, "UTC"),
    lastPrice,
    previousClose,
    change: computedChange,
    changePercent,
    dayHigh: asNumber(m.regularMarketDayHigh),
    dayLow: asNumber(m.regularMarketDayLow),
    fiftyTwoWeekHigh: asNumber(m.fiftyTwoWeekHigh),
    fiftyTwoWeekLow: asNumber(m.fiftyTwoWeekLow),
    volume: asNumber(m.regularMarketVolume),
    marketTime: asNumber(m.regularMarketTime)
  };
}
function hasUsableData(candles) {
  return candles.length >= 2;
}
function medianGapSeconds(candles) {
  if (candles.length < 3) return 0;
  const gaps = [];
  for (let i = 1; i < candles.length; i += 1) gaps.push(candles[i].time - candles[i - 1].time);
  gaps.sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)];
}
function validateIntervalMatch(candles, interval) {
  if (candles.length < 3) return null;
  const gap = medianGapSeconds(candles);
  if (gap <= 0) return null;
  const expected = BAR_SECONDS[interval];
  const ratio2 = gap / expected;
  if (interval !== "1mo" && gap > 45 * 86400) {
    return `Requested ${interval} bars but received roughly monthly data (~${Math.round(gap / 86400)} day bars)`;
  }
  if (ratio2 > 6 || ratio2 < 0.15) {
    return `Requested ${interval} bars but received roughly ${Math.round(gap / 60)}-minute data`;
  }
  return null;
}
var RANGE_SECONDS = {
  "1d": 86400,
  "5d": 5 * 86400,
  "1mo": 30 * 86400,
  "3mo": 90 * 86400,
  "6mo": 180 * 86400,
  "1y": 365 * 86400,
  "2y": 730 * 86400,
  "5y": 1825 * 86400,
  "10y": 3650 * 86400,
  max: 3650 * 86400
};
var INTERVAL_DEFAULT_RANGE = {
  "1m": "5d",
  "5m": "1mo",
  "15m": "1mo",
  "1h": "3mo",
  "1d": "1y",
  "1w": "5y",
  "1mo": "10y"
};
var RANGE_DEFAULT_INTERVAL = {
  "1d": "5m",
  "5d": "15m",
  "1mo": "1h",
  "3mo": "1d",
  "6mo": "1d",
  "1y": "1d",
  "2y": "1d",
  "5y": "1w",
  "10y": "1mo",
  max: "1mo"
};
var INTERVAL_MAX_RANGE_DAYS = {
  "1m": 7,
  "5m": 60,
  "15m": 60,
  "1h": 730,
  "1d": Number.POSITIVE_INFINITY,
  "1w": Number.POSITIVE_INFINITY,
  "1mo": Number.POSITIVE_INFINITY
};
function clampMaxRange(range, interval) {
  return range === "max" && interval !== "1mo" ? "10y" : range;
}
var RANGE_ORDER = ["1d", "5d", "1mo", "3mo", "6mo", "1y", "2y", "5y", "10y"];
function clampRangeForInterval(range, interval) {
  const safeRange = clampMaxRange(range, interval);
  const maxDays = INTERVAL_MAX_RANGE_DAYS[interval];
  if (!Number.isFinite(maxDays)) return safeRange;
  const idx = RANGE_ORDER.indexOf(safeRange);
  if (idx < 0) return "1mo";
  let chosen = RANGE_ORDER[0];
  for (const candidate of RANGE_ORDER) {
    if ((RANGE_SECONDS[candidate] ?? 0) / 86400 <= maxDays) chosen = candidate;
  }
  const requestedDays = (RANGE_SECONDS[safeRange] ?? 0) / 86400;
  return requestedDays <= maxDays ? safeRange : chosen;
}
function resolveView(range, interval) {
  const validIntervals = Object.keys(YAHOO_INTERVAL);
  const wantedInterval = interval && validIntervals.includes(interval) ? interval : null;
  const requestedRange = range && RANGE_SECONDS[range] !== void 0 ? range : wantedInterval ? INTERVAL_DEFAULT_RANGE[wantedInterval] : "1y";
  if (wantedInterval) {
    return { range: clampRangeForInterval(requestedRange, wantedInterval), interval: wantedInterval };
  }
  const resolvedInterval = RANGE_DEFAULT_INTERVAL[requestedRange] ?? "1d";
  return { range: clampRangeForInterval(requestedRange, resolvedInterval), interval: resolvedInterval };
}
function windowCandles(candles, range, nowSeconds) {
  const seconds = RANGE_SECONDS[range];
  if (seconds === void 0 || !Number.isFinite(seconds)) return candles;
  const cutoff = nowSeconds - seconds;
  const windowed = candles.filter((c) => c.time >= cutoff);
  return windowed.length ? windowed : candles;
}

// server/db.ts
import Database from "better-sqlite3";
var SCHEMA = `
CREATE TABLE IF NOT EXISTS candles (
  symbol   TEXT    NOT NULL,
  interval TEXT    NOT NULL,
  time     INTEGER NOT NULL,
  open     REAL    NOT NULL,
  high     REAL    NOT NULL,
  low      REAL    NOT NULL,
  close    REAL    NOT NULL,
  volume   REAL    NOT NULL,
  PRIMARY KEY (symbol, interval, time)
);

CREATE INDEX IF NOT EXISTS idx_candles_symbol_interval_time
  ON candles (symbol, interval, time DESC);

CREATE TABLE IF NOT EXISTS fetch_log (
  symbol       TEXT    NOT NULL,
  interval     TEXT    NOT NULL,
  last_updated INTEGER NOT NULL,
  source       TEXT    NOT NULL,
  candle_count INTEGER NOT NULL DEFAULT 0,
  range        TEXT,
  meta_json    TEXT,
  PRIMARY KEY (symbol, interval)
);

CREATE TABLE IF NOT EXISTS meta_cache (
  symbol     TEXT PRIMARY KEY,
  meta_json  TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS watchlist (
  symbol   TEXT PRIMARY KEY,
  name     TEXT,
  position INTEGER NOT NULL,
  added_at INTEGER NOT NULL
);

-- Phase 2: a single generic cache for provider payloads that are not candles
-- (fundamentals, news, symbol classifications). Kept generic on purpose: the
-- shape of these payloads changes far more often than the shape of a candle.
CREATE TABLE IF NOT EXISTS kv_cache (
  key        TEXT PRIMARY KEY,
  payload    TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
`;
var MAX_ROWS_PER_SERIES = 15e3;
function migrate(db2) {
  const columns = db2.prepare("PRAGMA table_info(fetch_log)").all().map(
    (c) => c.name
  );
  if (!columns.includes("range")) {
    db2.exec("ALTER TABLE fetch_log ADD COLUMN range TEXT");
  }
}
function openDb(path3) {
  const db2 = new Database(path3);
  db2.pragma("journal_mode = WAL");
  db2.pragma("foreign_keys = ON");
  db2.exec(SCHEMA);
  migrate(db2);
  return db2;
}
function saveCandles(db2, symbol, interval, candles) {
  if (candles.length === 0) return 0;
  const stmt = db2.prepare(
    `INSERT INTO candles (symbol, interval, time, open, high, low, close, volume)
     VALUES (@symbol, @interval, @time, @open, @high, @low, @close, @volume)
     ON CONFLICT(symbol, interval, time) DO UPDATE SET
       open = excluded.open, high = excluded.high, low = excluded.low,
       close = excluded.close, volume = excluded.volume`
  );
  const insertMany = db2.transaction((rows) => {
    for (const row of rows) stmt.run({ symbol, interval, ...row });
    return rows.length;
  });
  const n = insertMany(candles);
  prune(db2, symbol, interval);
  return n;
}
function prune(db2, symbol, interval) {
  db2.prepare(
    `DELETE FROM candles
     WHERE symbol = ? AND interval = ?
       AND time < (
         SELECT time FROM candles
         WHERE symbol = ? AND interval = ?
         ORDER BY time DESC
         LIMIT 1 OFFSET ?
       )`
  ).run(symbol, interval, symbol, interval, MAX_ROWS_PER_SERIES);
}
function getCandles(db2, symbol, interval) {
  return db2.prepare(
    `SELECT time, open, high, low, close, volume FROM candles
       WHERE symbol = ? AND interval = ? ORDER BY time ASC`
  ).all(symbol, interval);
}
function countCandles(db2, symbol, interval) {
  const row = db2.prepare("SELECT COUNT(*) AS n FROM candles WHERE symbol = ? AND interval = ?").get(symbol, interval);
  return row?.n ?? 0;
}
function recordFetch(db2, symbol, interval, lastUpdated, source, candleCount, range = null, meta) {
  db2.prepare(
    `INSERT INTO fetch_log (symbol, interval, last_updated, source, candle_count, range, meta_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(symbol, interval) DO UPDATE SET
       last_updated = excluded.last_updated,
       source = excluded.source,
       candle_count = excluded.candle_count,
       range = COALESCE(excluded.range, fetch_log.range),
       meta_json = COALESCE(excluded.meta_json, fetch_log.meta_json)`
  ).run(
    symbol,
    interval,
    lastUpdated,
    source,
    candleCount,
    range,
    meta ? JSON.stringify(meta) : null
  );
}
function getFetchRecord(db2, symbol, interval) {
  const row = db2.prepare(
    "SELECT symbol, interval, last_updated, source, candle_count, range FROM fetch_log WHERE symbol = ? AND interval = ?"
  ).get(symbol, interval);
  if (!row) return null;
  return {
    symbol: row.symbol,
    interval: row.interval,
    lastUpdated: row.last_updated,
    source: row.source,
    candleCount: row.candle_count,
    range: row.range
  };
}
function saveMeta(db2, meta, now) {
  db2.prepare(
    `INSERT INTO meta_cache (symbol, meta_json, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(symbol) DO UPDATE SET meta_json = excluded.meta_json, updated_at = excluded.updated_at`
  ).run(meta.symbol, JSON.stringify(meta), now);
}
function getMeta(db2, symbol) {
  const row = db2.prepare("SELECT meta_json FROM meta_cache WHERE symbol = ?").get(symbol);
  if (!row) return null;
  try {
    return JSON.parse(row.meta_json);
  } catch {
    return null;
  }
}
function listWatchlist(db2) {
  return db2.prepare("SELECT symbol, name, position, added_at FROM watchlist ORDER BY position ASC, symbol ASC").all();
}
function addWatch(db2, symbol, name, now) {
  const existing = db2.prepare("SELECT symbol FROM watchlist WHERE symbol = ?").get(symbol);
  if (!existing) {
    const max = db2.prepare("SELECT COALESCE(MAX(position), -1) AS m FROM watchlist").get();
    db2.prepare("INSERT INTO watchlist (symbol, name, position, added_at) VALUES (?, ?, ?, ?)").run(
      symbol,
      name,
      max.m + 1,
      now
    );
  } else if (name) {
    db2.prepare("UPDATE watchlist SET name = ? WHERE symbol = ?").run(name, symbol);
  }
  return listWatchlist(db2).find((w) => w.symbol === symbol);
}
function removeWatch(db2, symbol) {
  const info = db2.prepare("DELETE FROM watchlist WHERE symbol = ?").run(symbol);
  const rows = listWatchlist(db2);
  const reorder = db2.prepare("UPDATE watchlist SET position = ? WHERE symbol = ?");
  const tx = db2.transaction(() => rows.forEach((r, i) => reorder.run(i, r.symbol)));
  tx();
  return info.changes > 0;
}
function reorderWatchlist(db2, symbols) {
  const update = db2.prepare("UPDATE watchlist SET position = ? WHERE symbol = ?");
  const tx = db2.transaction(() => symbols.forEach((s, i) => update.run(i, s)));
  tx();
  return listWatchlist(db2);
}
function getKv(db2, key) {
  const row = db2.prepare("SELECT payload, updated_at FROM kv_cache WHERE key = ?").get(key);
  if (!row) return null;
  try {
    return { payload: JSON.parse(row.payload), updatedAt: row.updated_at };
  } catch {
    return null;
  }
}
function setKv(db2, key, payload, now) {
  db2.prepare(
    `INSERT INTO kv_cache (key, payload, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at`
  ).run(key, JSON.stringify(payload), now);
}
function seedWatchlistIfEmpty(db2, now) {
  const count = db2.prepare("SELECT COUNT(*) AS n FROM watchlist").get();
  if (count.n > 0) return;
  const seeds = [
    ["AAPL", "Apple Inc."],
    ["MSFT", "Microsoft Corporation"],
    ["NVDA", "NVIDIA Corporation"],
    ["SPY", "SPDR S&P 500 ETF Trust"]
  ];
  const insert = db2.prepare("INSERT OR IGNORE INTO watchlist (symbol, name, position, added_at) VALUES (?, ?, ?, ?)");
  const tx = db2.transaction(() => seeds.forEach(([s, n], i) => insert.run(s, n, i, now)));
  tx();
}

// server/market-service.ts
var YAHOO_HOST = "https://query1.finance.yahoo.com";
var REQUEST_TIMEOUT_MS = 12e3;
var YAHOO_USER_AGENT = "Mozilla/5.0";
var MAX_ATTEMPTS = 4;
var BASE_BACKOFF_MS = 700;
var MarketDataError = class extends Error {
  code;
  constructor(message, code = "MARKET_DATA_ERROR") {
    super(message);
    this.name = "MarketDataError";
    this.code = code;
  }
};
function cacheTtlSeconds(interval) {
  switch (interval) {
    case "1m":
      return 60;
    case "5m":
      return 120;
    case "15m":
      return 300;
    case "1h":
      return 900;
    case "1d":
      return 3600;
    case "1w":
      return 6 * 3600;
    case "1mo":
      return 12 * 3600;
    default:
      return 3600;
  }
}
function yahooChartUrl(symbol, interval, range) {
  const params = new URLSearchParams({
    range,
    interval: YAHOO_INTERVAL[interval],
    includePrePost: "false",
    events: "div,split"
  });
  return `${YAHOO_HOST}/v8/finance/chart/${encodeURIComponent(symbol)}?${params.toString()}`;
}
var sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function fetchYahooChart(symbol, interval, range, fetchImpl = fetch) {
  const url = yahooChartUrl(symbol, interval, range);
  let lastError = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetchImpl(url, {
        headers: { "User-Agent": YAHOO_USER_AGENT, Accept: "application/json" },
        signal: controller.signal
      });
      if (res.ok) return await res.json();
      const retryable = res.status === 429 || res.status >= 500;
      lastError = new MarketDataError(
        `Yahoo responded with HTTP ${res.status} for ${symbol}`,
        res.status === 404 ? "NOT_FOUND" : "UPSTREAM_HTTP_ERROR"
      );
      if (!retryable || attempt === MAX_ATTEMPTS) throw lastError;
    } catch (err) {
      if (err instanceof MarketDataError) {
        if (err.code === "NOT_FOUND") throw err;
        lastError = err;
      } else {
        const reason = err instanceof Error ? err.message : String(err);
        lastError = new MarketDataError(
          `Could not reach Yahoo Finance for ${symbol}: ${reason}`,
          "UPSTREAM_UNREACHABLE"
        );
      }
      if (attempt === MAX_ATTEMPTS) throw lastError;
    } finally {
      clearTimeout(timer);
    }
    await sleep(BASE_BACKOFF_MS * 2 ** (attempt - 1) + Math.random() * 250);
  }
  throw lastError ?? new MarketDataError(`Could not fetch ${symbol}`, "UPSTREAM_UNREACHABLE");
}
async function loadSeries(db2, rawSymbol, opts = {}) {
  const symbol = rawSymbol.trim().toUpperCase();
  if (!symbol) throw new MarketDataError("A symbol is required", "BAD_REQUEST");
  const view = resolveView(opts.range, opts.interval);
  const now = opts.now ?? Math.floor(Date.now() / 1e3);
  const record = getFetchRecord(db2, symbol, view.interval);
  const cachedCount = countCandles(db2, symbol, view.interval);
  const ttl = cacheTtlSeconds(view.interval);
  const needed = opts.minCandles ?? 2;
  const storedRangeSeconds = record?.range ? RANGE_SECONDS[record.range] ?? 0 : 0;
  const requestedRangeSeconds = RANGE_SECONDS[view.range] ?? 0;
  const rangeCovered = storedRangeSeconds >= requestedRangeSeconds * 0.95;
  const cacheIsFresh = record !== null && cachedCount >= needed && rangeCovered && now - record.lastUpdated <= ttl;
  if (!opts.force && cacheIsFresh) {
    const all = getCandles(db2, symbol, view.interval);
    const candles = all;
    const meta = getMeta(db2, symbol);
    if (hasUsableData(candles) && meta) {
      return {
        symbol,
        interval: view.interval,
        range: view.range,
        candles,
        meta,
        source: "cache",
        lastUpdated: record.lastUpdated,
        note: null
      };
    }
  }
  try {
    const json = await fetchYahooChart(symbol, view.interval, view.range, opts.fetchImpl);
    const candles = parseCandles(json);
    if (!hasUsableData(candles)) {
      throw new MarketDataError(`Yahoo returned no usable candles for ${symbol}`, "NO_DATA");
    }
    const mismatch = validateIntervalMatch(candles, view.interval);
    if (mismatch) {
      throw new MarketDataError(`${mismatch} (symbol ${symbol}).`, "INTERVAL_MISMATCH");
    }
    const meta = parseMeta(json, symbol);
    saveCandles(db2, symbol, view.interval, candles);
    saveMeta(db2, meta, now);
    recordFetch(db2, symbol, view.interval, now, "live", candles.length, view.range, meta);
    return {
      symbol,
      interval: view.interval,
      range: view.range,
      candles,
      meta,
      source: "live",
      lastUpdated: now,
      note: null
    };
  } catch (err) {
    const cached = getCandles(db2, symbol, view.interval);
    const meta = getMeta(db2, symbol);
    if (hasUsableData(cached) && meta) {
      const reason = err instanceof Error ? err.message : String(err);
      recordFetch(db2, symbol, view.interval, record?.lastUpdated ?? 0, "stale-cache", cached.length, record?.range ?? null);
      return {
        symbol,
        interval: view.interval,
        range: view.range,
        candles: cached,
        meta,
        source: "stale-cache",
        lastUpdated: record?.lastUpdated ?? null,
        // The UI localises the code; `reason` stays in `noteText` for logs.
        note: "note.marketLiveFetchFailed",
        noteText: reason
      };
    }
    if (err instanceof MarketDataError) throw err;
    throw new MarketDataError(
      `No cached data for ${symbol} and the live fetch failed (${err instanceof Error ? err.message : String(err)})`,
      "NO_DATA"
    );
  }
}
function windowIndicators(ind, fromTime) {
  const keep = (arr2) => arr2.filter((p) => p.time >= fromTime);
  return {
    sma20: keep(ind.sma20),
    sma50: keep(ind.sma50),
    sma200: keep(ind.sma200),
    ema12: keep(ind.ema12),
    ema26: keep(ind.ema26),
    bb: keep(ind.bb),
    rsi14: keep(ind.rsi14),
    macd: keep(ind.macd)
  };
}
async function loadMarketData(db2, rawSymbol, opts = {}) {
  const series = await loadSeries(db2, rawSymbol, opts);
  const now = opts.now ?? Math.floor(Date.now() / 1e3);
  const view = resolveView(opts.range, opts.interval);
  const fullIndicators = computeIndicators(series.candles);
  const candles = windowCandles(series.candles, view.range, now);
  const fromTime = candles.length ? candles[0].time : 0;
  const indicators = candles.length ? windowIndicators(fullIndicators, fromTime) : fullIndicators;
  return {
    symbol: series.symbol,
    interval: series.interval,
    candles,
    indicators,
    meta: series.meta,
    source: series.source,
    lastUpdated: series.lastUpdated,
    fetchedAt: now,
    note: series.note,
    count: candles.length
  };
}

// shared/fundamentals.ts
function rawNumber(value) {
  if (value === null || value === void 0) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  if (typeof value === "object") {
    return rawNumber(value.raw);
  }
  return null;
}
function nonZero(value) {
  const n = rawNumber(value);
  return n === null || n === 0 ? null : n;
}
function rawString(value) {
  if (typeof value !== "string") return null;
  const s = value.trim();
  return s ? s : null;
}
function firstResult(json) {
  return json?.quoteSummary?.result?.[0] ?? null;
}
function trimSummary(text, maxChars = 420) {
  if (!text) return null;
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= maxChars) return clean;
  const cut = clean.slice(0, maxChars);
  const lastStop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("; "));
  if (lastStop > maxChars * 0.5) return `${cut.slice(0, lastStop + 1)} \u2026`;
  const lastSpace = cut.lastIndexOf(" ");
  return `${cut.slice(0, lastSpace > 0 ? lastSpace : maxChars)} \u2026`;
}
function parseProfile(json) {
  const p = firstResult(json)?.assetProfile;
  if (!p) return null;
  const summary = trimSummary(rawString(p.longBusinessSummary));
  const profile = {
    sector: rawString(p.sectorDisp) ?? rawString(p.sector),
    industry: rawString(p.industryDisp) ?? rawString(p.industry),
    country: rawString(p.country),
    website: rawString(p.website),
    fullTimeEmployees: nonZero(p.fullTimeEmployees),
    summary
  };
  const empty = !profile.sector && !profile.industry && !profile.country && !profile.website && !profile.summary;
  return empty ? null : profile;
}
function parseKeyStats(json) {
  const r = firstResult(json);
  if (!r) return null;
  const price = r.price ?? {};
  const sd = r.summaryDetail ?? {};
  const ks = r.defaultKeyStatistics ?? {};
  const stats = {
    marketCap: nonZero(price.marketCap) ?? nonZero(sd.marketCap),
    trailingPE: nonZero(sd.trailingPE),
    forwardPE: nonZero(sd.forwardPE) ?? nonZero(ks.forwardPE),
    dividendYield: rawNumber(sd.dividendYield) || nonZero(sd.trailingAnnualDividendYield),
    beta: nonZero(sd.beta) ?? nonZero(ks.beta),
    priceToBook: nonZero(ks.priceToBook),
    trailingEps: rawNumber(ks.trailingEps),
    forwardEps: nonZero(ks.forwardEps),
    dayHigh: nonZero(price.regularMarketDayHigh) ?? nonZero(sd.dayHigh),
    dayLow: nonZero(price.regularMarketDayLow) ?? nonZero(sd.dayLow),
    previousClose: nonZero(sd.previousClose),
    fiftyTwoWeekHigh: nonZero(sd.fiftyTwoWeekHigh),
    fiftyTwoWeekLow: nonZero(sd.fiftyTwoWeekLow),
    volume: nonZero(price.regularMarketVolume),
    averageVolume: nonZero(sd.averageVolume)
  };
  const anyValue = Object.values(stats).some((v) => v !== null);
  return anyValue ? stats : null;
}
function parseHealthStats(json) {
  const f = firstResult(json)?.financialData;
  if (!f) return null;
  const health = {
    profitMargins: rawNumber(f.profitMargins),
    operatingMargins: rawNumber(f.operatingMargins),
    returnOnEquity: rawNumber(f.returnOnEquity),
    returnOnAssets: rawNumber(f.returnOnAssets),
    revenueGrowth: rawNumber(f.revenueGrowth),
    recommendationKey: rawString(f.recommendationKey),
    recommendationMean: nonZero(f.recommendationMean),
    numberOfAnalystOpinions: nonZero(f.numberOfAnalystOpinions),
    targetMeanPrice: nonZero(f.targetMeanPrice),
    targetHighPrice: nonZero(f.targetHighPrice),
    targetLowPrice: nonZero(f.targetLowPrice)
  };
  const anyValue = Object.values(health).some((v) => v !== null);
  return anyValue ? health : null;
}
function parseFundamentals(json, symbol, extras) {
  const r = firstResult(json);
  const price = r?.price ?? {};
  return {
    symbol,
    profile: parseProfile(json),
    keyStats: parseKeyStats(json),
    health: parseHealthStats(json),
    quoteType: extras.quoteType ?? rawString(price.quoteType),
    currency: extras.currency ?? rawString(price.currency),
    source: extras.source,
    lastUpdated: extras.lastUpdated,
    note: extras.note ?? null
  };
}
function isUsableFundamentals(payload) {
  return payload.profile !== null || payload.keyStats !== null || payload.health !== null;
}

// shared/news.ts
var asString = (v) => {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s ? s : null;
};
var asEpochSeconds = (v) => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n > 1e12 ? n / 1e3 : n);
};
function isHttpUrl(url) {
  if (!url) return false;
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}
function parseNewsItems(json, symbol) {
  const root = json;
  const raw = Array.isArray(root?.news) ? root.news : [];
  const wanted = symbol.trim().toUpperCase();
  const items = [];
  for (const n of raw) {
    const title = asString(n?.title);
    const link = asString(n?.link);
    if (!title || !isHttpUrl(link)) continue;
    const related = Array.isArray(n?.relatedTickers) ? n.relatedTickers.map((t) => String(t).toUpperCase()).filter(Boolean) : [];
    items.push({
      id: asString(n?.uuid) ?? link,
      title,
      // The provider is occasionally missing a publisher; say so honestly
      // rather than attributing the story to nobody.
      publisher: asString(n?.publisher) ?? "",
      link,
      publishedAt: asEpochSeconds(n?.providerPublishTime),
      relatedTickers: related,
      mentionsSymbol: related.includes(wanted)
    });
  }
  return items.map((item, index) => ({ item, index })).sort((a, b) => {
    if (a.item.mentionsSymbol !== b.item.mentionsSymbol) return a.item.mentionsSymbol ? -1 : 1;
    const ta = a.item.publishedAt ?? 0;
    const tb = b.item.publishedAt ?? 0;
    if (ta !== tb) return tb - ta;
    return a.index - b.index;
  }).map(({ item }) => item);
}
function parseNewsPayload(json, symbol, extras) {
  const items = parseNewsItems(json, symbol);
  return {
    symbol,
    items: extras.limit ? items.slice(0, extras.limit) : items,
    source: extras.source,
    lastUpdated: extras.lastUpdated,
    note: extras.note ?? null
  };
}

// shared/categorise.ts
var TYPE_BY_QUOTE_TYPE = {
  EQUITY: "stock",
  ETF: "etf"
};
var asString2 = (v) => {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s ? s : null;
};
var EXCHANGE_BUCKETS = [
  { id: "NASDAQ", match: /nasdaq|^nms$|^ngm$|^ncm$/i },
  { id: "NYSE Arca", match: /arca|^pcx$/i },
  { id: "NYSE", match: /^nyse$|^nyq$/i },
  { id: "HKEX", match: /hong kong|^hkse$|^hkex$|^hkg$/i },
  { id: "LSE", match: /london|^lse$|^lon$/i },
  { id: "TSE", match: /tokyo|^tse$|^tyo$|^jpx$/i },
  { id: "SSE", match: /^sse$/i },
  { id: "SZSE", match: /^szse$/i },
  { id: "TSX", match: /toronto|^tsx$|^tse-c$|^tsxv$/i },
  { id: "ASX", match: /australian|^asx$/i },
  { id: "XETRA", match: /xetra|german|frankfurt|^ger$/i },
  { id: "SIX", match: /swiss|^six$|^swx$/i }
];
function exchangeBucket(label) {
  const s = asString2(label);
  if (!s) return null;
  for (const bucket of EXCHANGE_BUCKETS) {
    if (bucket.match.test(s)) return bucket.id;
  }
  return s;
}
function assetTypeFrom(quoteType) {
  const q = asString2(quoteType);
  if (!q) return "other";
  return TYPE_BY_QUOTE_TYPE[q.toUpperCase()] ?? "other";
}
function classifySymbol(input) {
  const quoteType = asString2(input.quoteType);
  const exchangeRaw = asString2(input.exchange) ?? asString2(input.exchangeCode);
  return {
    symbol: input.symbol.trim().toUpperCase(),
    type: assetTypeFrom(quoteType),
    quoteType,
    sector: asString2(input.sector),
    industry: asString2(input.industry),
    exchange: exchangeBucket(exchangeRaw),
    exchangeCode: asString2(input.exchangeCode) ?? asString2(input.exchange),
    country: asString2(input.country),
    currency: asString2(input.currency)
  };
}
function mergeCategory(a, b) {
  if (!a) return b;
  return {
    symbol: b.symbol || a.symbol,
    type: b.type !== "other" ? b.type : a.type,
    quoteType: b.quoteType ?? a.quoteType,
    sector: b.sector ?? a.sector,
    industry: b.industry ?? a.industry,
    exchange: b.exchange ?? a.exchange,
    exchangeCode: b.exchangeCode ?? a.exchangeCode,
    country: b.country ?? a.country,
    currency: b.currency ?? a.currency
  };
}

// server/provider.ts
var CRUMB_URL = "https://query1.finance.yahoo.com/v1/test/getcrumb";
var PRIME_URL = "https://fc.yahoo.com/";
var HOST = "https://query1.finance.yahoo.com";
var CRUMB_RE = /^[A-Za-z0-9._~-]{4,64}$/;
var SESSION_TTL_MS = 30 * 60 * 1e3;
var REQUEST_TIMEOUT_MS2 = 12e3;
var MAX_ATTEMPTS2 = 3;
var BASE_BACKOFF_MS2 = 600;
var session = null;
function cookieHeader(cookies) {
  return cookies.map((c) => c.split(";")[0].trim()).filter(Boolean).join("; ");
}
function absorbCookies(res) {
  const h = res.headers;
  if (typeof h.getSetCookie === "function") return h.getSetCookie();
  const single = res.headers.get("set-cookie");
  return single ? [single] : [];
}
var sleep2 = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function fetchWithRetry(url, init, fetchImpl = fetch) {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS2; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS2);
    try {
      const res = await fetchImpl(url, { ...init, signal: controller.signal });
      if (res.ok) return res;
      if (res.status !== 429 && res.status < 500) return res;
    } catch {
    } finally {
      clearTimeout(timer);
    }
    if (attempt < MAX_ATTEMPTS2) await sleep2(BASE_BACKOFF_MS2 * 2 ** (attempt - 1));
  }
  return null;
}
async function mintSession(fetchImpl = fetch) {
  const cookies = [];
  try {
    const res2 = await fetchWithRetry(PRIME_URL, { headers: { "User-Agent": YAHOO_USER_AGENT }, redirect: "manual" }, fetchImpl);
    if (res2) cookies.push(...absorbCookies(res2));
  } catch {
    return null;
  }
  if (cookies.length === 0) return null;
  const res = await fetchWithRetry(
    CRUMB_URL,
    { headers: { "User-Agent": YAHOO_USER_AGENT, Cookie: cookieHeader(cookies) } },
    fetchImpl
  );
  if (!res) return null;
  const cookieFromCrumb = absorbCookies(res);
  cookies.push(...cookieFromCrumb);
  const crumb = (await res.text()).trim();
  if (!CRUMB_RE.test(crumb)) return null;
  session = { crumb, cookies, fetchedAt: Date.now() };
  return session;
}
async function getSession(fetchImpl = fetch, opts = {}) {
  const stale = session === null || Date.now() - session.fetchedAt > SESSION_TTL_MS;
  if (opts.force || stale) return mintSession(fetchImpl);
  return session;
}
async function fetchProviderJson(pathAndQuery, opts = {}) {
  const fetchImpl = opts.fetchImpl ?? fetch;
  for (let round = 0; round < 2; round += 1) {
    const s = await getSession(fetchImpl, { force: round > 0 || opts.forceNewSession });
    if (!s) return null;
    const sep = pathAndQuery.includes("?") ? "&" : "?";
    const url = `${HOST}${pathAndQuery}${sep}crumb=${encodeURIComponent(s.crumb)}`;
    const res = await fetchWithRetry(
      url,
      {
        headers: {
          "User-Agent": YAHOO_USER_AGENT,
          Accept: "application/json",
          Cookie: cookieHeader(s.cookies)
        }
      },
      fetchImpl
    );
    if (!res) return null;
    let json = null;
    try {
      json = await res.json();
    } catch {
      return null;
    }
    if (isCrumbRejection(json)) continue;
    return { json, status: res.status, session: s };
  }
  return null;
}
var QUERY2_HOST = "https://query2.finance.yahoo.com";
async function fetchQuery2Json(pathAndQuery, opts = {}) {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const url = opts.absolute ? pathAndQuery : `${QUERY2_HOST}${pathAndQuery}`;
  const res = await fetchWithRetry(
    url,
    { headers: { "User-Agent": YAHOO_USER_AGENT, Accept: "application/json" } },
    fetchImpl
  );
  if (!res) return null;
  try {
    return await res.json();
  } catch {
    return null;
  }
}
function isCrumbRejection(json) {
  const root = json;
  const err = root?.quoteSummary?.error ?? root?.finance?.error;
  if (!err) return false;
  const code = String(err.code ?? "");
  const desc = String(err.description ?? "");
  return /unauthor/i.test(code) || /crumb/i.test(desc) || /unauthor/i.test(desc);
}
var QUOTE_SUMMARY_MODULES = [
  "assetProfile",
  "summaryDetail",
  "defaultKeyStatistics",
  "financialData",
  "price"
].join(",");
function quoteSummaryPath(symbol) {
  return `/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=${QUOTE_SUMMARY_MODULES}`;
}
var ANALYST_MODULES = [
  "financialData",
  "defaultKeyStatistics",
  "summaryDetail",
  "earningsTrend",
  "recommendationTrend",
  "upgradeDowngradeHistory",
  "calendarEvents",
  "earningsHistory",
  "price",
  "assetProfile"
].join(",");
function analystSummaryPath(symbol) {
  return `/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=${ANALYST_MODULES}`;
}
function timeseriesPath(symbol, typeNames, period1, period2) {
  const type = typeNames.join(",");
  const params = new URLSearchParams({
    symbol,
    type,
    period1: String(period1),
    period2: String(period2)
  });
  return `/ws/fundamentals-timeseries/v1/finance/timeseries/${encodeURIComponent(symbol)}?${params.toString()}`;
}
function searchPath(query, newsCount, quotesCount) {
  const params = new URLSearchParams({
    q: query,
    quotesCount: String(quotesCount),
    newsCount: String(newsCount)
  });
  return `/v1/finance/search?${params.toString()}`;
}

// server/phase2-service.ts
var TTL = {
  fundamentals: 6 * 3600,
  news: 15 * 60,
  categories: 7 * 24 * 3600
};
var NEWS_LIMIT = 12;
async function fetchSearchJson(query, newsCount, quotesCount, fetchImpl) {
  const res = await fetchWithRetry(
    `https://query1.finance.yahoo.com${searchPath(query, newsCount, quotesCount)}`,
    { headers: { "User-Agent": YAHOO_USER_AGENT, Accept: "application/json" } },
    fetchImpl
  );
  if (!res) return null;
  try {
    return await res.json();
  } catch {
    return null;
  }
}
async function loadNews(db2, rawSymbol, opts = {}) {
  const symbol = rawSymbol.trim().toUpperCase();
  const now = opts.now ?? Math.floor(Date.now() / 1e3);
  const fetchImpl = opts.fetchImpl ?? fetch;
  const key = `news:${symbol}`;
  const cached = getKv(db2, key);
  const fresh = cached !== null && now - cached.updatedAt <= TTL.news;
  if (!opts.force && fresh && cached) {
    return { ...cached.payload, source: "cache", lastUpdated: cached.updatedAt };
  }
  const json = await fetchSearchJson(symbol, NEWS_LIMIT, 3, fetchImpl);
  if (json) {
    const payload = parseNewsPayload(json, symbol, {
      source: "live",
      lastUpdated: now,
      note: null,
      limit: NEWS_LIMIT
    });
    setKv(db2, key, payload, now);
    return payload;
  }
  if (cached) {
    return {
      ...cached.payload,
      source: "stale-cache",
      lastUpdated: cached.updatedAt,
      note: "note.newsUnreachableCached"
    };
  }
  return {
    symbol,
    items: [],
    source: "unavailable",
    lastUpdated: null,
    note: "note.newsUnreachableNone"
  };
}
async function loadFundamentals(db2, rawSymbol, opts = {}) {
  const symbol = rawSymbol.trim().toUpperCase();
  const now = opts.now ?? Math.floor(Date.now() / 1e3);
  const key = `fundamentals:${symbol}`;
  const cached = getKv(db2, key);
  const fresh = cached !== null && now - cached.updatedAt <= TTL.fundamentals;
  if (!opts.force && fresh && cached) {
    return { ...cached.payload, source: "cache", lastUpdated: cached.updatedAt };
  }
  const res = await fetchProviderJson(quoteSummaryPath(symbol), { fetchImpl: opts.fetchImpl });
  if (res) {
    const payload = parseFundamentals(res.json, symbol, {
      source: "live",
      lastUpdated: now,
      note: null
    });
    if (isUsableFundamentals(payload)) setKv(db2, key, payload, now);
    return payload;
  }
  if (cached) {
    return {
      ...cached.payload,
      source: "stale-cache",
      lastUpdated: cached.updatedAt,
      note: "note.fundamentalsUnreachableCached"
    };
  }
  return {
    symbol,
    profile: null,
    keyStats: null,
    health: null,
    quoteType: null,
    currency: null,
    source: "unavailable",
    lastUpdated: null,
    note: "note.fundamentalsUnavailable"
  };
}
async function loadCategories(db2, rawSymbols, opts = {}) {
  const now = opts.now ?? Math.floor(Date.now() / 1e3);
  const fetchImpl = opts.fetchImpl ?? fetch;
  const symbols = [...new Set(rawSymbols.map((s) => s.trim().toUpperCase()).filter(Boolean))];
  const out = {};
  const missing = [];
  for (const symbol of symbols) {
    const key = `category:${symbol}`;
    const cached = getKv(db2, key);
    const fresh = cached !== null && now - cached.updatedAt <= TTL.categories;
    if (!opts.force && fresh && cached) out[symbol] = cached.payload;
    else missing.push(symbol);
  }
  const CONCURRENCY = 4;
  for (let i = 0; i < missing.length; i += CONCURRENCY) {
    const chunk = missing.slice(i, i + CONCURRENCY);
    const settled = await Promise.all(
      chunk.map(async (symbol) => {
        const json = await fetchSearchJson(symbol, 0, 5, fetchImpl);
        const hit = json?.quotes?.find((q) => String(q.symbol).toUpperCase() === symbol) ?? json?.quotes?.[0];
        if (!hit) return { symbol, category: null };
        const category = classifySymbol({
          symbol,
          quoteType: str(hit.quoteType) ?? str(hit.typeDisp),
          sector: str(hit.sector) ?? str(hit.sectorDisp),
          industry: str(hit.industry) ?? str(hit.industryDisp),
          exchange: str(hit.exchDisp) ?? str(hit.exchange),
          exchangeCode: str(hit.exchange)
        });
        return { symbol, category };
      })
    );
    for (const { symbol, category } of settled) {
      const key = `category:${symbol}`;
      const cached = getKv(db2, key);
      if (category) {
        const merged = cached?.payload ? mergeCategory(cached.payload, category) : category;
        out[symbol] = merged;
        setKv(db2, key, merged, now);
      } else if (cached?.payload) {
        out[symbol] = cached.payload;
      } else {
        out[symbol] = classifySymbol({ symbol });
      }
    }
  }
  for (const symbol of Object.keys(out)) {
    const category = out[symbol];
    if (!category || category.country) continue;
    const profile = getKv(db2, `fundamentals:${symbol}`);
    const country = profile?.payload.profile?.country ?? null;
    if (country) {
      out[symbol] = { ...category, country, countryFromProfile: true };
      setKv(db2, `category:${symbol}`, out[symbol], now);
    }
  }
  return out;
}
function str(v) {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s ? s : null;
}

// shared/statements.ts
var INCOME_LINES = [
  { name: "TotalRevenue", labelKey: "pf.income.totalRevenue", kind: "money" },
  { name: "CostOfRevenue", labelKey: "pf.income.costOfRevenue", kind: "money" },
  { name: "GrossProfit", labelKey: "pf.income.grossProfit", kind: "money" },
  { name: "ResearchAndDevelopment", labelKey: "pf.income.researchAndDevelopment", kind: "money" },
  { name: "SellingGeneralAndAdministration", labelKey: "pf.income.sellingGeneralAndAdmin", kind: "money" },
  { name: "OperatingIncome", labelKey: "pf.income.operatingIncome", kind: "money" },
  { name: "EBITDA", labelKey: "pf.income.ebitda", kind: "money" },
  { name: "EBIT", labelKey: "pf.income.ebit", kind: "money" },
  { name: "InterestExpense", labelKey: "pf.income.interestExpense", kind: "money" },
  { name: "PretaxIncome", labelKey: "pf.income.pretaxIncome", kind: "money" },
  { name: "TaxProvision", labelKey: "pf.income.taxProvision", kind: "money" },
  { name: "NetIncome", labelKey: "pf.income.netIncome", kind: "money" },
  { name: "BasicEPS", labelKey: "pf.income.basicEps", kind: "perShare" },
  { name: "DilutedEPS", labelKey: "pf.income.dilutedEps", kind: "perShare" }
];
var BALANCE_LINES = [
  { name: "TotalAssets", labelKey: "pf.balance.totalAssets", kind: "money" },
  { name: "CurrentAssets", labelKey: "pf.balance.currentAssets", kind: "money" },
  { name: "CashAndCashEquivalents", labelKey: "pf.balance.cash", kind: "money" },
  { name: "Inventory", labelKey: "pf.balance.inventory", kind: "money" },
  { name: "Goodwill", labelKey: "pf.balance.goodwill", kind: "money" },
  { name: "OtherIntangibleAssets", labelKey: "pf.balance.otherIntangibles", kind: "money" },
  { name: "CurrentLiabilities", labelKey: "pf.balance.currentLiabilities", kind: "money" },
  { name: "TotalLiabilitiesNetMinorityInterest", labelKey: "pf.balance.totalLiabilities", kind: "money" },
  { name: "LongTermDebt", labelKey: "pf.balance.longTermDebt", kind: "money" },
  { name: "CurrentDebt", labelKey: "pf.balance.currentDebt", kind: "money" },
  { name: "TotalDebt", labelKey: "pf.balance.totalDebt", kind: "money" },
  { name: "NetDebt", labelKey: "pf.balance.netDebt", kind: "money" },
  { name: "StockholdersEquity", labelKey: "pf.balance.stockholdersEquity", kind: "money" },
  { name: "MinorityInterest", labelKey: "pf.balance.minorityInterest", kind: "money" },
  { name: "OrdinarySharesNumber", labelKey: "pf.balance.sharesOutstanding", kind: "number" },
  { name: "TotalCapitalization", labelKey: "pf.balance.totalCapitalization", kind: "money" }
];
var CASHFLOW_LINES = [
  { name: "OperatingCashFlow", labelKey: "pf.cash.operatingCashFlow", kind: "money" },
  { name: "CapitalExpenditure", labelKey: "pf.cash.capitalExpenditure", kind: "money" },
  { name: "FreeCashFlow", labelKey: "pf.cash.freeCashFlow", kind: "money" },
  { name: "InvestingCashFlow", labelKey: "pf.cash.investingCashFlow", kind: "money" },
  { name: "FinancingCashFlow", labelKey: "pf.cash.financingCashFlow", kind: "money" },
  { name: "DepreciationAndAmortization", labelKey: "pf.cash.depreciationAndAmortization", kind: "money" },
  { name: "ReconciledDepreciation", labelKey: "pf.cash.reconciledDepreciation", kind: "money" },
  { name: "StockBasedCompensation", labelKey: "pf.cash.stockBasedCompensation", kind: "money" },
  { name: "CashDividendsPaid", labelKey: "pf.cash.dividendsPaid", kind: "money" },
  { name: "RepurchaseOfCapitalStock", labelKey: "pf.cash.repurchaseOfStock", kind: "money" }
];
var ALL_LINE_NAMES = [
  ...INCOME_LINES,
  ...BALANCE_LINES,
  ...CASHFLOW_LINES
].map((l) => l.name);
function parseTimeseries(json) {
  const root = json;
  const results = root?.timeseries?.result;
  const blocks = {};
  if (!Array.isArray(results)) return { blocks, status: 0 };
  for (const block of results) {
    const b = block;
    const type = b.meta?.type?.[0];
    if (typeof type !== "string") continue;
    const rows = b[type];
    blocks[type] = Array.isArray(rows) ? rows : [];
  }
  return { blocks, status: 200 };
}
function rowNumber(value) {
  if (value === null || value === void 0) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "object") return rowNumber(value.raw);
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
function rowString(value) {
  if (typeof value !== "string") return null;
  const s = value.trim();
  return s ? s : null;
}
function seriesOf(blocks, type) {
  const rows = blocks.blocks[type];
  if (!Array.isArray(rows)) return [];
  const out = [];
  for (const row of rows) {
    const r = row;
    if (!r) continue;
    const asOf = rowString(r.asOfDate);
    const value = rowNumber(r.reportedValue);
    if (asOf === null || value === null) continue;
    out.push({
      asOf,
      periodType: rowString(r.periodType) ?? "",
      currency: rowString(r.currencyCode),
      value
    });
  }
  return out.sort((a, b) => a.asOf.localeCompare(b.asOf));
}
function prefixFor(period) {
  return period === "annual" ? "annual" : "quarterly";
}
var MAX_COLUMNS = 4;
function columnsFor(period, blocks) {
  const prefix = prefixFor(period);
  const dates = /* @__PURE__ */ new Set();
  for (const line2 of ALL_LINE_NAMES) {
    for (const p of seriesOf(blocks, `${prefix}${line2}`)) dates.add(p.asOf);
  }
  const sorted = [...dates].sort();
  return sorted.slice(Math.max(0, sorted.length - MAX_COLUMNS));
}
var STOCK_LINES = new Set(
  BALANCE_LINES.map((l) => l.name).concat(["OrdinarySharesNumber", "TotalCapitalization", "TotalEquityGrossMinorityInterest"])
);
var AVERAGE_LINES = /* @__PURE__ */ new Set(["BasicEPS", "DilutedEPS"]);
function rowFor(blocks, line2, period, columns) {
  const prefix = prefixFor(period);
  const series = seriesOf(blocks, `${prefix}${line2.name}`);
  const byDate = new Map(series.map((p) => [p.asOf, p.value]));
  if (period === "annual") {
    return {
      labelKey: line2.labelKey,
      kind: line2.kind,
      values: columns.map((c) => byDate.get(c) ?? null),
      computed: false
    };
  }
  if (period === "quarterly") {
    return {
      labelKey: line2.labelKey,
      kind: line2.kind,
      values: columns.map((c) => byDate.get(c) ?? null),
      computed: false
    };
  }
  const allDates = series.map((p) => p.asOf);
  return {
    labelKey: line2.labelKey,
    kind: line2.kind,
    values: columns.map((c) => {
      const idx = allDates.indexOf(c);
      if (idx < 0) return null;
      const window = series.slice(Math.max(0, idx - 3), idx + 1);
      if (window.length === 0) return null;
      if (STOCK_LINES.has(line2.name)) return window[window.length - 1].value;
      if (AVERAGE_LINES.has(line2.name)) {
        return window.reduce((n, p) => n + p.value, 0) / window.length;
      }
      return window.reduce((n, p) => n + p.value, 0);
    }),
    computed: true
  };
}
function buildTable(blocks, lines, period) {
  const columns = columnsFor(period, blocks);
  const rows = lines.map((line2) => rowFor(blocks, line2, period, columns));
  const prefix = prefixFor(period);
  let currency = null;
  let periodType = null;
  for (const line2 of lines) {
    const s = seriesOf(blocks, `${prefix}${line2.name}`);
    const last2 = s[s.length - 1];
    if (last2) {
      currency = currency ?? last2.currency;
      periodType = periodType ?? last2.periodType;
    }
  }
  return {
    columns,
    rows,
    period,
    currency,
    periodType,
    anyComputed: period === "ltm"
  };
}
function buildStatements(blocks, period) {
  return {
    period,
    income: buildTable(blocks, INCOME_LINES, period),
    balance: buildTable(blocks, BALANCE_LINES, period),
    cashflow: buildTable(blocks, CASHFLOW_LINES, period)
  };
}
var INPUT_BY_NAME = {
  TotalRevenue: "revenue",
  GrossProfit: "grossProfit",
  OperatingIncome: "operatingIncome",
  EBIT: "ebit",
  EBITDA: "ebitda",
  NetIncome: "netIncome",
  InterestExpense: "interestExpense",
  PretaxIncome: "pretaxIncome",
  TaxProvision: "taxProvision",
  TotalAssets: "totalAssets",
  TotalLiabilitiesNetMinorityInterest: "totalLiabilities",
  StockholdersEquity: "stockholdersEquity",
  TotalDebt: "totalDebt",
  LongTermDebt: "longTermDebt",
  CurrentDebt: "currentDebt",
  CashAndCashEquivalents: "cash",
  CurrentAssets: "currentAssets",
  CurrentLiabilities: "currentLiabilities",
  Inventory: "inventory",
  OperatingCashFlow: "operatingCashFlow",
  CapitalExpenditure: "capitalExpenditure",
  FreeCashFlow: "freeCashFlow",
  DilutedEPS: "dilutedEps",
  OrdinarySharesNumber: "sharesOutstanding"
};
function metricInputsFor(blocks, set) {
  const out = {
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
    currency: null
  };
  const tables = [set.income, set.balance, set.cashflow];
  const lastIndex = (t) => t.columns.length - 1;
  for (const table of tables) {
    const idx = lastIndex(table);
    if (idx < 0) continue;
    table.rows.forEach((row, ri) => {
      const spec = [...INCOME_LINES, ...BALANCE_LINES, ...CASHFLOW_LINES].find(
        (l) => l.labelKey === row.labelKey
      );
      if (!spec) return;
      void ri;
      const key = INPUT_BY_NAME[spec.name];
      if (!key || key === "currency") return;
      const v = row.values[idx];
      if (v !== null && v !== void 0) {
        out[key] = v;
      }
    });
    if (table.currency) out.currency = out.currency ?? table.currency;
  }
  const firstColumnTable = tables.find((t) => t.columns.length > 0);
  out.asOf = firstColumnTable ? firstColumnTable.columns[firstColumnTable.columns.length - 1] : null;
  return out;
}

// shared/metrics.ts
function need(...values) {
  const out = [];
  for (const v of values) {
    if (v === null || v === void 0 || !Number.isFinite(v)) return null;
    out.push(v);
  }
  return out;
}
function ratio(a, b) {
  const v = need(a, b);
  if (!v) return null;
  const [x, y] = v;
  if (y === 0) return null;
  const r = x / y;
  return Number.isFinite(r) ? r : null;
}
function diff(a, b) {
  const v = need(a, b);
  return v ? v[0] - v[1] : null;
}
function sum(a, b) {
  const v = need(a, b);
  return v ? v[0] + v[1] : null;
}
function marketCap(shares, price) {
  const v = need(shares, price);
  if (!v) return null;
  return v[0] * v[1];
}
function enterpriseValue(mcap, totalDebt, cash) {
  const v = need(mcap, totalDebt, cash);
  if (!v) return null;
  return v[0] + v[1] - v[2];
}
function netDebt(totalDebt, cash) {
  return diff(totalDebt, cash);
}
function nopat(ebit, pretaxIncome, taxProvision) {
  const v = need(ebit, pretaxIncome, taxProvision);
  if (!v) return null;
  const [e, pre, tax] = v;
  if (pre === 0) return null;
  const rate = tax / pre;
  return e * (1 - rate);
}
function investedCapital(totalDebt, equity, cash) {
  const v = need(totalDebt, equity, cash);
  if (!v) return null;
  return v[0] + v[1] - v[2];
}
function roic(nopatValue, invested) {
  const v = need(nopatValue, invested);
  if (!v) return null;
  if (v[1] <= 0) return null;
  return v[0] / v[1];
}
function metric(id, labelKey, kind, formulaKey, value) {
  return { id, labelKey, kind, formulaKey, value };
}
function deriveMetrics(inputs, price, mcapOverride = null) {
  const mcap = mcapOverride ?? marketCap(inputs.sharesOutstanding, price);
  const ev = enterpriseValue(mcap, inputs.totalDebt, inputs.cash);
  const nd = netDebt(inputs.totalDebt, inputs.cash);
  const ebitda = inputs.ebitda;
  const ebit = inputs.ebit;
  const revenue = inputs.revenue;
  const equity = inputs.stockholdersEquity;
  const totalDebt = inputs.totalDebt;
  const cash = inputs.cash;
  const capex = inputs.capitalExpenditure;
  const np = nopat(ebit, inputs.pretaxIncome, inputs.taxProvision);
  const invested = investedCapital(totalDebt, equity, cash);
  const items = [
    // --- multiples ------------------------------------------------------
    metric("pe", "pf.mult.pe", "x", "pf.formula.pe", ratio(safeAbs(price), inputs.dilutedEps)),
    metric("pb", "pf.mult.pb", "x", "pf.formula.pb", ratio(safeAbs(mcap), equity)),
    metric("ps", "pf.mult.ps", "x", "pf.formula.ps", ratio(mcap, revenue)),
    metric("evRevenue", "pf.mult.evRevenue", "x", "pf.formula.evRevenue", ratio(ev, revenue)),
    metric("evEbitda", "pf.mult.evEbitda", "x", "pf.formula.evEbitda", ratio(ev, ebitda)),
    metric("evEbit", "pf.mult.evEbit", "x", "pf.formula.evEbit", ratio(ev, ebit)),
    // --- profitability --------------------------------------------------
    metric("grossMargin", "pf.prof.grossMargin", "pct", "pf.formula.grossMargin", ratio(inputs.grossProfit, revenue)),
    metric("operatingMargin", "pf.prof.operatingMargin", "pct", "pf.formula.operatingMargin", ratio(inputs.operatingIncome, revenue)),
    metric("netMargin", "pf.prof.netMargin", "pct", "pf.formula.netMargin", ratio(inputs.netIncome, revenue)),
    metric("ebitdaMargin", "pf.prof.ebitdaMargin", "pct", "pf.formula.ebitdaMargin", ratio(ebitda, revenue)),
    metric("roe", "pf.prof.roe", "pct", "pf.formula.roe", ratio(inputs.netIncome, equity)),
    metric("roa", "pf.prof.roa", "pct", "pf.formula.roa", ratio(inputs.netIncome, inputs.totalAssets)),
    metric("roic", "pf.prof.roic", "pct", "pf.formula.roic", roic(np, invested)),
    // --- solvency -------------------------------------------------------
    metric("debtToEquity", "pf.solv.debtToEquity", "ratio", "pf.formula.debtToEquity", ratio(totalDebt, equity)),
    metric("ltDebtToEquity", "pf.solv.ltDebtToEquity", "ratio", "pf.formula.ltDebtToEquity", ratio(inputs.longTermDebt, equity)),
    metric("debtToCapital", "pf.solv.debtToCapital", "pct", "pf.formula.debtToCapital", ratio(totalDebt, sum(totalDebt, equity))),
    metric("liabToAssets", "pf.solv.liabToAssets", "pct", "pf.formula.liabToAssets", ratio(inputs.totalLiabilities, inputs.totalAssets)),
    metric("currentRatio", "pf.solv.currentRatio", "ratio", "pf.formula.currentRatio", ratio(inputs.currentAssets, inputs.currentLiabilities)),
    metric("ebitToInterest", "pf.solv.ebitToInterest", "x", "pf.formula.ebitToInterest", ratio(ebit, inputs.interestExpense)),
    metric("ebitdaToInterest", "pf.solv.ebitdaToInterest", "x", "pf.formula.ebitdaToInterest", ratio(ebitda, inputs.interestExpense)),
    metric("debtToEbitda", "pf.solv.debtToEbitda", "x", "pf.formula.debtToEbitda", ratio(totalDebt, ebitda)),
    metric("netDebtToEbitda", "pf.solv.netDebtToEbitda", "x", "pf.formula.netDebtToEbitda", ratio(nd, ebitda)),
    metric(
      "debtToEbitdaCapex",
      "pf.solv.debtToEbitdaCapex",
      "x",
      "pf.formula.debtToEbitdaCapex",
      // Capex is reported negative (an outflow); the formula wants the magnitude
      // because it is *subtracted* from EBITDA to reach free cash flow.
      ratio(totalDebt, diff(ebitda, safeAbs(capex)))
    )
  ];
  return { asOf: inputs.asOf, currency: inputs.currency, marketCap: mcap, ev, netDebt: nd, items };
}
function safeAbs(v) {
  if (v === null || !Number.isFinite(v)) return null;
  return Math.abs(v);
}

// shared/estimates.ts
function num2(value) {
  if (value === null || value === void 0) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    if (value.trim() === "") return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  if (typeof value === "object") return num2(value.raw);
  return null;
}
function str2(value) {
  if (typeof value !== "string") return null;
  const s = value.trim();
  return s ? s : null;
}
function result(json) {
  return json?.quoteSummary?.result?.[0] ?? null;
}
function module(json, name) {
  const r = result(json);
  const m = r?.[name];
  return m && typeof m === "object" ? m : null;
}
function arr(value) {
  return Array.isArray(value) ? value.filter((x) => x && typeof x === "object") : [];
}
function pick(m, key) {
  return m ? m[key] : null;
}
var ESTIMATE_PERIODS = ["0q", "+1q", "0y", "+1y"];
function side(raw, opts) {
  const block = raw && typeof raw === "object" ? raw : null;
  return {
    avg: num2(pick(block, "avg")),
    low: num2(pick(block, "low")),
    high: num2(pick(block, "high")),
    yearAgo: num2(pick(block, opts.yearAgoKey)),
    analysts: num2(pick(block, "numberOfAnalysts")),
    growth: num2(pick(block, "growth")),
    currency: str2(pick(block, opts.currencyKey))
  };
}
function sideEmpty(s) {
  return s.avg === null && s.low === null && s.high === null && s.analysts === null;
}
function parseEarningsTrend(json) {
  const trend = arr(pick(module(json, "earningsTrend"), "trend"));
  const byId = /* @__PURE__ */ new Map();
  for (const t of trend) {
    const id = str2(t.period);
    if (id) byId.set(id, t);
  }
  return ESTIMATE_PERIODS.map((id) => {
    const block = byId.get(id) ?? null;
    return {
      id,
      endDate: str2(pick(block, "endDate")),
      eps: side(pick(block, "earningsEstimate"), { yearAgoKey: "yearAgoEps", currencyKey: "earningsCurrency" }),
      revenue: side(pick(block, "revenueEstimate"), { yearAgoKey: "yearAgoRevenue", currencyKey: "revenueCurrency" })
    };
  });
}
function parseCalendar(json) {
  const cal = module(json, "calendarEvents");
  const earnings = pick(cal, "earnings");
  const dates = arr(pick(earnings, "earningsDate"));
  const first = dates[0] ?? null;
  return {
    nextEarningsAt: num2(pick(first, "raw")),
    nextEarningsLabel: str2(pick(first, "fmt")),
    isEstimate: pick(earnings, "isEarningsDateEstimate") === true,
    epsAvg: num2(pick(earnings, "earningsAverage")),
    epsLow: num2(pick(earnings, "earningsLow")),
    epsHigh: num2(pick(earnings, "earningsHigh")),
    revenueAvg: num2(pick(earnings, "revenueAverage")),
    revenueLow: num2(pick(earnings, "revenueLow")),
    revenueHigh: num2(pick(earnings, "revenueHigh"))
  };
}
function parseEarningsHistory(json) {
  const history = arr(pick(module(json, "earningsHistory"), "history"));
  const out = history.map((h) => {
    const at = num2(pick(h, "quarter"));
    return {
      quarterAt: at,
      quarterLabel: at === null ? null : new Date(at * 1e3).toISOString().slice(0, 10),
      period: str2(h.period),
      epsActual: num2(pick(h, "epsActual")),
      epsEstimate: num2(pick(h, "epsEstimate")),
      epsDifference: num2(pick(h, "epsDifference")),
      surprisePercent: num2(pick(h, "surprisePercent")),
      currency: str2(h.currency)
    };
  });
  out.sort((a, b) => (a.quarterAt ?? 0) - (b.quarterAt ?? 0));
  return out;
}
function parseRatings(json) {
  const buckets = arr(pick(module(json, "recommendationTrend"), "trend")).map((b) => ({
    period: str2(b.period) ?? "",
    strongBuy: num2(b.strongBuy),
    buy: num2(b.buy),
    hold: num2(b.hold),
    sell: num2(b.sell),
    strongSell: num2(b.strongSell)
  }));
  const fd = module(json, "financialData");
  return {
    buckets,
    recommendationMean: num2(pick(fd, "recommendationMean")),
    recommendationKey: str2(pick(fd, "recommendationKey")),
    numberOfAnalystOpinions: num2(pick(fd, "numberOfAnalystOpinions")),
    targetLow: num2(pick(fd, "targetLowPrice")),
    targetMean: num2(pick(fd, "targetMeanPrice")),
    targetMedian: num2(pick(fd, "targetMedianPrice")),
    targetHigh: num2(pick(fd, "targetHighPrice")),
    currentPrice: num2(pick(fd, "currentPrice"))
  };
}
function parseUpgrades(json, limit = 25) {
  const history = arr(pick(module(json, "upgradeDowngradeHistory"), "history"));
  const out = history.map((h) => {
    const at = num2(h.epochGradeDate);
    return {
      at,
      dateLabel: at === null ? null : new Date(at * 1e3).toISOString().slice(0, 10),
      firm: str2(h.firm),
      fromGrade: str2(h.fromGrade),
      toGrade: str2(h.toGrade),
      action: str2(h.action),
      priceTargetAction: str2(h.priceTargetAction),
      currentPriceTarget: num2(h.currentPriceTarget),
      priorPriceTarget: num2(h.priorPriceTarget)
    };
  }).filter((a) => a.at !== null && (a.firm !== null || a.toGrade !== null)).sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
  return limit > 0 ? out.slice(0, limit) : out;
}
function priceTargetView(ratings, price) {
  const p = ratings.currentPrice ?? price;
  const upside = ratings.targetMean !== null && p !== null && p > 0 ? (ratings.targetMean - p) / p : null;
  return {
    low: ratings.targetLow,
    mean: ratings.targetMean,
    median: ratings.targetMedian,
    high: ratings.targetHigh,
    upsidePct: upside,
    analysts: ratings.numberOfAnalystOpinions
  };
}
function growthBetween(actual, forecast) {
  if (actual === null || forecast === null) return null;
  if (actual === 0 || !Number.isFinite(actual) || !Number.isFinite(forecast)) return null;
  const g = (forecast - actual) / Math.abs(actual);
  return Number.isFinite(g) ? g : null;
}
function buildForecastMatrix(args) {
  const { forecast, actual } = args;
  const asOf = args.asOf ?? null;
  const epsForecast = forecast?.eps.avg ?? null;
  const revenueForecast = forecast?.revenue.avg ?? null;
  const rows = [
    {
      labelKey: "pf.matrix.revenue",
      kind: "money",
      actual: actual.revenue,
      forecast: revenueForecast,
      growth: growthBetween(actual.revenue, revenueForecast),
      noEstimateUpstream: revenueForecast === null,
      basis: "quarter",
      asOf
    },
    {
      labelKey: "pf.matrix.ebitda",
      kind: "money",
      actual: actual.ebitda,
      forecast: null,
      growth: null,
      // Not carried by Yahoo's estimate block for any symbol — not a gap in our
      // request, a gap upstream. Said plainly rather than rendered as a blank.
      noEstimateUpstream: true,
      basis: "quarter",
      asOf
    },
    {
      labelKey: "pf.matrix.ebit",
      kind: "money",
      actual: actual.ebit,
      forecast: null,
      growth: null,
      noEstimateUpstream: true,
      basis: "quarter",
      asOf
    },
    {
      labelKey: "pf.matrix.eps",
      kind: "perShare",
      actual: actual.dilutedEps,
      forecast: epsForecast,
      growth: growthBetween(actual.dilutedEps, epsForecast),
      noEstimateUpstream: epsForecast === null,
      basis: "quarter",
      asOf
    }
  ];
  return rows;
}
function periodMatrix(periods, extraYears = 2) {
  return { periods: periods.filter((p) => !sideEmpty(p.eps) || !sideEmpty(p.revenue)), extraYears };
}
function forwardLevel(periods) {
  const byId = new Map(periods.map((p) => [p.id, p]));
  const q0 = byId.get("0q") ?? null;
  const q1 = byId.get("+1q") ?? null;
  if (q0?.eps.avg !== null && q0?.eps.avg !== void 0 && q1?.eps.avg !== null && q1?.eps.avg !== void 0) {
    const revenueOk = q0.revenue.avg !== null && q1.revenue.avg !== null;
    return {
      eps: q0.eps.avg + q1.eps.avg,
      revenue: revenueOk ? (q0.revenue.avg ?? 0) + (q1.revenue.avg ?? 0) : null,
      quarters: ["0q", "+1q"],
      basis: "quarters"
    };
  }
  const fy = byId.get("0y") ?? null;
  if (fy && (fy.eps.avg !== null || fy.revenue.avg !== null)) {
    return { eps: fy.eps.avg, revenue: fy.revenue.avg, quarters: [], basis: "fy" };
  }
  return { eps: null, revenue: null, quarters: [], basis: null };
}

// shared/fx.ts
var DISPLAY_CURRENCIES = ["USD", "HKD", "CNY", "EUR", "GBP", "JPY"];
var FX_SYMBOLS = {
  HKD: "USDHKD=X",
  // 1 USD in HKD (7.84)
  CNY: "USDCNY=X",
  // 1 USD in CNY (6.67)
  EUR: "EURUSD=X",
  // 1 EUR in USD (1.12)
  GBP: "GBPUSD=X",
  // 1 GBP in USD (1.34)
  JPY: "JPYUSD=X"
  // 1 JPY in USD (0.0063)
};
function usdPerUnit(code, quote) {
  if (code === "USD") return 1;
  if (quote === null || !Number.isFinite(quote) || quote <= 0) return null;
  if (code === "HKD" || code === "CNY" || code === "JPY") {
    return 1 / quote;
  }
  return quote;
}

// server/phase3-service.ts
var TTL3 = {
  /** Statements change a few times a year; a long TTL is honest and cheap. */
  statements: 12 * 3600,
  /** The analyst bundle (estimates + ratings + header quote). */
  analyst: 3600,
  /** USD cross-rates move daily at most. */
  fx: 6 * 3600
};
var ACTION_LIMIT = 25;
var EXTRA_YEAR_COLUMNS = 2;
var DAY = 86400;
function nowOf(opts) {
  return opts.now ?? Math.floor(Date.now() / 1e3);
}
function windowFor(period, now) {
  const years = period === "annual" ? 6 : 3;
  return { period1: now - years * 366 * DAY, period2: now + DAY };
}
async function loadStatements(db2, rawSymbol, period = "annual", opts = {}) {
  const symbol = rawSymbol.trim().toUpperCase();
  const now = nowOf(opts);
  const prefix = prefixFor(period);
  const key = `statements:${symbol}:${period}`;
  const cached = getKv(db2, key);
  const fresh = cached !== null && now - cached.updatedAt <= TTL3.statements;
  if (!opts.force && fresh && cached) {
    return relabel(cached.payload, cached.updatedAt, "cache");
  }
  const types = ALL_LINE_NAMES.map((n) => `${prefix}${n}`);
  const win = windowFor(period, now);
  const json = await fetchQuery2Json(timeseriesPath(symbol, types, win.period1, win.period2), {
    fetchImpl: opts.fetchImpl
  });
  if (json) {
    const parsed = parseTimeseries(json);
    if (hasAnyRows(parsed)) {
      const payload = await buildPayload(db2, symbol, period, parsed, now, opts);
      setKv(db2, key, payload, now);
      return payload;
    }
  }
  if (cached) {
    return relabel(cached.payload, cached.updatedAt, "stale-cache");
  }
  return emptyStatements(symbol, period);
}
function hasAnyRows(blocks) {
  return Object.values(blocks.blocks).some((rows) => rows.length > 0);
}
async function buildPayload(db2, symbol, period, blocks, now, opts) {
  const price = await loadPrice(db2, symbol, opts);
  return assemble(symbol, period, blocks, price, now, "live", null);
}
function relabel(payload, updatedAt, source) {
  return { ...payload, source, lastUpdated: payload.lastUpdated ?? updatedAt };
}
function assemble(symbol, period, blocks, price, now, source, note) {
  const set = buildStatements(blocks, period);
  const inputs = metricInputsFor(blocks, set);
  const metrics = deriveMetrics(inputs, price);
  return {
    symbol,
    period,
    currency: set.income.currency ?? set.balance.currency ?? set.cashflow.currency ?? null,
    periodType: set.income.periodType ?? set.balance.periodType ?? set.cashflow.periodType ?? null,
    income: set.income,
    balance: set.balance,
    cashflow: set.cashflow,
    metrics,
    inputs,
    price,
    source,
    lastUpdated: now,
    note
  };
}
function emptyStatements(symbol, period) {
  return assemble(symbol, period, { blocks: {}, status: 0 }, null, Date.now() / 1e3, "unavailable", "note.statementsUnavailable");
}
async function loadPrice(db2, symbol, opts) {
  try {
    const series = await loadSeries(db2, symbol, { range: "5d", interval: "1d", fetchImpl: opts.fetchImpl });
    const last2 = series.meta.lastPrice ?? series.candles.at(-1)?.close ?? null;
    return last2 !== null && Number.isFinite(last2) ? last2 : null;
  } catch {
    return null;
  }
}
async function loadAnalystBundle(db2, symbol, opts) {
  const now = nowOf(opts);
  const key = `analyst:${symbol}`;
  const cached = getKv(db2, key);
  const fresh = cached !== null && now - cached.updatedAt <= TTL3.analyst;
  if (!opts.force && fresh && cached) {
    return { bundle: cached.payload.bundle, source: "cache", lastUpdated: cached.updatedAt };
  }
  const res = await fetchProviderJson(analystSummaryPath(symbol), { fetchImpl: opts.fetchImpl });
  if (res) {
    const bundle = mapAnalystBundle(res.json, db2, symbol, now, opts);
    if (isUsableBundle(bundle)) {
      setKv(db2, key, { bundle }, now);
      return { bundle, source: "live", lastUpdated: now };
    }
  }
  if (cached) {
    return { bundle: cached.payload.bundle, source: "stale-cache", lastUpdated: cached.updatedAt };
  }
  return null;
}
function isUsableBundle(bundle) {
  const e = bundle.estimates;
  const r = bundle.ratings;
  return e.periods.some((p) => p.eps.avg !== null || p.revenue.avg !== null) || e.calendar.nextEarningsAt !== null || e.history.length > 0 || r.ratings.buckets.length > 0 || r.ratings.targetMean !== null || r.price !== null;
}
function mapAnalystBundle(json, db2, symbol, now, opts) {
  const periods = parseEarningsTrend(json);
  const calendar = parseCalendar(json);
  const history = parseEarningsHistory(json);
  const ratings = parseRatings(json);
  const price = ratings.currentPrice ?? readPrice(json);
  const currency = periods.find((p) => p.eps.currency)?.eps.currency ?? periods.find((p) => p.revenue.currency)?.revenue.currency ?? readString(json, "financialData", "financialCurrency") ?? readString(json, "price", "currency");
  const pm = periodMatrix(periods, EXTRA_YEAR_COLUMNS);
  const target = priceTargetView(ratings, price);
  const forward = forwardLevel(periods);
  const matrix = [];
  const quoteType = readString(json, "price", "quoteType") ?? readRootString(json, "quoteType");
  const marketState = readString(json, "price", "marketState");
  const exchange = readString(json, "price", "exchangeName") ?? readString(json, "price", "fullExchangeName");
  const name = readString(json, "price", "longName") ?? readString(json, "price", "shortName");
  const sector = readString(json, "assetProfile", "sector") ?? readString(json, "assetProfile", "sectorDisp");
  const industry = readString(json, "assetProfile", "industry") ?? readString(json, "assetProfile", "industryDisp");
  const bundle = {
    estimates: {
      periods,
      extraYears: pm.extraYears,
      calendar,
      history,
      matrix,
      forward,
      /** EV for the estimate rows' EV multiple; derived from the *latest*
       *  cached statements, so it is the same EV the statements panel shows. */
      ev: evFor(db2, symbol),
      price,
      currency
    },
    ratings: {
      ratings,
      target,
      actions: parseUpgrades(json, ACTION_LIMIT),
      oneYearReturn: null,
      // filled by `loadRatings` from real price history
      price,
      currency
    },
    quote: {
      name,
      price,
      change: readNumber(json, "price", "regularMarketChange"),
      changePercent: readNumber(json, "price", "regularMarketChangePercent"),
      volume: readNumber(json, "price", "regularMarketVolume"),
      currency: readString(json, "price", "currency"),
      exchange,
      marketState,
      previousClose: readNumber(json, "summaryDetail", "previousClose") ?? readNumber(json, "price", "regularMarketPreviousClose"),
      dayHigh: readNumber(json, "price", "regularMarketDayHigh") ?? readNumber(json, "summaryDetail", "dayHigh"),
      dayLow: readNumber(json, "price", "regularMarketDayLow") ?? readNumber(json, "summaryDetail", "dayLow"),
      fiftyTwoWeekHigh: readNumber(json, "summaryDetail", "fiftyTwoWeekHigh") ?? readNumber(json, "price", "fiftyTwoWeekHigh"),
      fiftyTwoWeekLow: readNumber(json, "summaryDetail", "fiftyTwoWeekLow") ?? readNumber(json, "price", "fiftyTwoWeekLow"),
      // Pre/post are only ever populated when the provider actually published
      // them (RECON-PHASE3 §3: usually `{}`/null) — the UI omits the row otherwise.
      preMarket: readNumber(json, "price", "preMarketPrice"),
      postMarket: readNumber(json, "price", "postMarketPrice"),
      marketCap: readNumber(json, "price", "marketCap") ?? readNumber(json, "summaryDetail", "marketCap"),
      trailingPE: readNumber(json, "summaryDetail", "trailingPE"),
      forwardPE: readNumber(json, "summaryDetail", "forwardPE") ?? readNumber(json, "defaultKeyStatistics", "forwardPE"),
      sector,
      industry,
      quoteType
    }
  };
  void now;
  void opts;
  return bundle;
}
async function ensureQuarterlyStatements(db2, symbol, opts) {
  const now = nowOf(opts);
  const cached = getKv(db2, `statements:${symbol}:quarterly`);
  if (cached && now - cached.updatedAt <= TTL3.statements) return cached.payload;
  const fresh = await loadStatements(db2, symbol, "quarterly", opts);
  return fresh.income.rows.length > 0 || fresh.inputs.revenue !== null ? fresh : cached?.payload ?? null;
}
function rowValues(p) {
  if (!p) return { revenue: null, ebitda: null, ebit: null, dilutedEps: null };
  return {
    revenue: p.inputs.revenue,
    ebitda: p.inputs.ebitda,
    ebit: p.inputs.ebit,
    dilutedEps: p.inputs.dilutedEps
  };
}
function latestQuarterRow(p) {
  if (!p) return null;
  const latest = p.income.columns[p.income.columns.length - 1] ?? null;
  return { label: latest ?? "unknown", cells: p };
}
function evFor(db2, symbol) {
  for (const period of ["ltm", "quarterly", "annual"]) {
    const hit = getKv(db2, `statements:${symbol}:${period}`);
    if (hit && hit.payload.metrics.ev !== null) return hit.payload.metrics.ev;
  }
  return null;
}
async function loadEstimates(db2, rawSymbol, opts = {}) {
  const symbol = rawSymbol.trim().toUpperCase();
  const hit = await loadAnalystBundle(db2, symbol, opts);
  if (hit) {
    const quarter = await ensureQuarterlyStatements(db2, symbol, opts);
    const matrix = buildForecastMatrix({
      forecast: hit.bundle.estimates.periods.find((p) => p.id === "0q") ?? hit.bundle.estimates.periods[0] ?? null,
      actual: rowValues(quarter),
      asOf: quarter ? latestQuarterRow(quarter)?.label ?? null : null
    });
    return {
      symbol,
      ...hit.bundle.estimates,
      matrix,
      source: hit.source,
      lastUpdated: hit.lastUpdated,
      note: hit.source === "stale-cache" ? "note.estimatesUnreachableCached" : null
    };
  }
  return {
    symbol,
    periods: [],
    extraYears: 0,
    calendar: {
      nextEarningsAt: null,
      nextEarningsLabel: null,
      isEstimate: false,
      epsAvg: null,
      epsLow: null,
      epsHigh: null,
      revenueAvg: null,
      revenueLow: null,
      revenueHigh: null
    },
    history: [],
    matrix: [],
    forward: { eps: null, revenue: null, quarters: [], basis: null },
    ev: null,
    price: null,
    currency: null,
    source: "unavailable",
    lastUpdated: null,
    note: "note.estimatesUnavailable"
  };
}
async function loadRatings(db2, rawSymbol, opts = {}) {
  const symbol = rawSymbol.trim().toUpperCase();
  const hit = await loadAnalystBundle(db2, symbol, opts);
  const oneYearReturn = await loadOneYearReturn(db2, symbol, opts);
  if (hit) {
    return {
      symbol,
      ...hit.bundle.ratings,
      oneYearReturn,
      source: hit.source,
      lastUpdated: hit.lastUpdated,
      note: hit.source === "stale-cache" ? "note.ratingsUnreachableCached" : null
    };
  }
  return {
    symbol,
    ratings: {
      buckets: [],
      recommendationMean: null,
      recommendationKey: null,
      numberOfAnalystOpinions: null,
      targetLow: null,
      targetMean: null,
      targetMedian: null,
      targetHigh: null,
      currentPrice: null
    },
    target: { low: null, mean: null, median: null, high: null, upsidePct: null, analysts: null },
    actions: [],
    oneYearReturn,
    price: null,
    currency: null,
    source: "unavailable",
    lastUpdated: null,
    note: "note.ratingsUnavailable"
  };
}
async function loadQuoteOverview(db2, rawSymbol, opts = {}) {
  const symbol = rawSymbol.trim().toUpperCase();
  const hit = await loadAnalystBundle(db2, symbol, opts);
  const base = hit?.bundle.quote ?? emptyQuote();
  let chartMeta = null;
  try {
    const series = await loadSeries(db2, symbol, { range: "5d", interval: "1d", fetchImpl: opts.fetchImpl });
    chartMeta = {
      price: series.meta.lastPrice,
      volume: series.meta.volume,
      name: series.meta.name || null,
      currency: series.meta.currency || null,
      exchange: series.meta.exchange || null,
      high: series.meta.fiftyTwoWeekHigh,
      low: series.meta.fiftyTwoWeekLow
    };
  } catch {
    chartMeta = null;
  }
  const merged = {
    symbol,
    name: base.name ?? chartMeta?.name ?? null,
    price: base.price ?? chartMeta?.price ?? null,
    change: base.change,
    changePercent: base.changePercent,
    volume: base.volume ?? chartMeta?.volume ?? null,
    currency: base.currency ?? chartMeta?.currency ?? null,
    exchange: base.exchange ?? chartMeta?.exchange ?? null,
    marketState: base.marketState,
    previousClose: base.previousClose,
    dayHigh: base.dayHigh,
    dayLow: base.dayLow,
    fiftyTwoWeekHigh: base.fiftyTwoWeekHigh ?? chartMeta?.high ?? null,
    fiftyTwoWeekLow: base.fiftyTwoWeekLow ?? chartMeta?.low ?? null,
    preMarket: base.preMarket,
    postMarket: base.postMarket,
    marketCap: base.marketCap,
    trailingPE: base.trailingPE,
    forwardPE: base.forwardPE,
    sector: base.sector,
    industry: base.industry,
    quoteType: base.quoteType,
    source: hit?.source ?? "live",
    lastUpdated: hit?.lastUpdated ?? null,
    note: hit?.source === "stale-cache" ? "note.quotesUnreachableCached" : null
  };
  return merged;
}
function emptyQuote() {
  return {
    name: null,
    price: null,
    change: null,
    changePercent: null,
    volume: null,
    currency: null,
    exchange: null,
    marketState: null,
    previousClose: null,
    dayHigh: null,
    dayLow: null,
    fiftyTwoWeekHigh: null,
    fiftyTwoWeekLow: null,
    preMarket: null,
    postMarket: null,
    marketCap: null,
    trailingPE: null,
    forwardPE: null,
    sector: null,
    industry: null,
    quoteType: null
  };
}
async function loadOneYearReturn(db2, symbol, opts) {
  try {
    const series = await loadSeries(db2, symbol, { range: "1y", interval: "1d", fetchImpl: opts.fetchImpl });
    const first = series.candles[0]?.close ?? null;
    const last2 = series.candles.at(-1)?.close ?? series.meta.lastPrice ?? null;
    return growthBetween(first, last2);
  } catch {
    return null;
  }
}
async function loadFx(db2, targets = [], opts = {}) {
  const now = nowOf(opts);
  const wanted = [...new Set(targets.map((c) => c.trim().toUpperCase()))].filter(
    (c) => c && c !== "USD" && DISPLAY_CURRENCIES.includes(c)
  );
  const perUsd = { USD: 1 };
  let asOf = null;
  let anyFetched = false;
  for (const code of wanted) {
    const pair = FX_SYMBOLS[code];
    if (!pair) continue;
    const key = `fx:${pair}`;
    const cached = getKv(db2, key);
    const fresh = cached !== null && now - cached.updatedAt <= TTL3.fx;
    if (!opts.force && fresh && cached) {
      const rate = usdPerUnit(code, cached.payload.quote);
      if (rate !== null) {
        perUsd[code] = rate;
        asOf = Math.max(asOf ?? 0, cached.payload.at);
        anyFetched = true;
      }
      continue;
    }
    const json = await fetchQuery2Json(
      `/v8/finance/chart/${encodeURIComponent(pair)}?range=1d&interval=1d`,
      { fetchImpl: opts.fetchImpl }
    );
    const quote = readChartPrice(json);
    if (quote !== null) {
      const rate = usdPerUnit(code, quote);
      if (rate !== null) {
        perUsd[code] = rate;
        setKv(db2, key, { quote, at: now }, now);
        asOf = Math.max(asOf ?? 0, now);
        anyFetched = true;
        continue;
      }
    }
    if (cached) {
      const rate = usdPerUnit(code, cached.payload.quote);
      if (rate !== null) {
        perUsd[code] = rate;
        asOf = Math.max(asOf ?? 0, cached.payload.at);
        anyFetched = true;
      }
    }
  }
  return {
    perUsd,
    asOf,
    unavailable: !anyFetched && wanted.length > 0,
    source: anyFetched ? "live" : wanted.length === 0 ? "live" : "unavailable",
    lastUpdated: anyFetched ? now : null,
    note: !anyFetched && wanted.length > 0 ? "note.fxUnavailable" : null
  };
}
function readChartPrice(json) {
  const r = json?.chart?.result?.[0];
  const meta = r?.meta;
  if (!meta) return null;
  const v = meta.regularMarketPrice;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function moduleOf(json, name) {
  const r = json?.quoteSummary?.result?.[0];
  const m = r?.[name];
  return m && typeof m === "object" ? m : null;
}
function readNumber(json, mod, key) {
  const v = moduleOf(json, mod)?.[key];
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (v && typeof v === "object") {
    const raw = v.raw;
    return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
  }
  return null;
}
function readString(json, mod, key) {
  const v = moduleOf(json, mod)?.[key];
  if (typeof v === "string") {
    const s = v.trim();
    return s ? s : null;
  }
  return null;
}
function readRootString(json, key) {
  const r = json?.quoteSummary?.result?.[0];
  const v = r?.[key];
  if (typeof v === "string") {
    const s = v.trim();
    return s ? s : null;
  }
  return null;
}
function readPrice(json) {
  const v = readNumber(json, "price", "regularMarketPrice");
  return v ?? readNumber(json, "financialData", "currentPrice");
}

// server/app.ts
var __dirname = path.dirname(fileURLToPath("file:///Users/love21/.openclaw/workspace/debug-coder/projects/stock-app/server/index.ts"));
var DIST_DIR = path.resolve(__dirname, "..", "dist");
function ok(data) {
  return { ok: true, data };
}
function fail(error, code) {
  return { ok: false, error, code };
}
function createApp(db2) {
  const app2 = express();
  app2.disable("x-powered-by");
  app2.use(express.json({ limit: "128kb" }));
  app2.use("/api", (_req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    next();
  });
  app2.options(/^\/api\/.*/, (_req, res) => res.sendStatus(204));
  const health = (_req, res) => {
    res.json(ok({ status: "ok", time: Math.floor(Date.now() / 1e3), service: "stock-coach-api" }));
  };
  app2.get("/api/health", health);
  app2.get("/healthz", health);
  app2.get("/api/market/:symbol", async (req, res, next) => {
    try {
      const symbol = normalizeSymbol(String(req.params.symbol ?? ""));
      if (!isValidSymbol(symbol)) {
        res.status(400).json(fail(`"${symbol}" is not a valid ticker symbol.`, "BAD_SYMBOL"));
        return;
      }
      const force = req.query.force === "1" || req.query.force === "true";
      const data = await loadMarketData(db2, symbol, {
        range: typeof req.query.range === "string" ? req.query.range : null,
        interval: typeof req.query.interval === "string" ? req.query.interval : null,
        force
      });
      res.json(ok(data));
    } catch (err) {
      next(err);
    }
  });
  app2.get("/api/signals/:symbol", async (req, res, next) => {
    try {
      const symbol = normalizeSymbol(String(req.params.symbol ?? ""));
      if (!isValidSymbol(symbol)) {
        res.status(400).json(fail(`"${symbol}" is not a valid ticker symbol.`, "BAD_SYMBOL"));
        return;
      }
      const series = await loadSeries(db2, symbol, {
        range: "max",
        interval: "1d",
        minCandles: requiredCandles()
      });
      const signals = evaluateSignals({
        candles: series.candles,
        indicators: computeIndicators(series.candles)
      });
      const payload = {
        symbol: series.symbol,
        interval: series.interval,
        range: series.range,
        signals,
        summary: summarize(signals),
        meta: series.meta,
        source: series.source,
        lastUpdated: series.lastUpdated,
        note: series.note,
        candleCount: series.candles.length
      };
      res.json(ok(payload));
    } catch (err) {
      next(err);
    }
  });
  const requireSymbol = (raw) => {
    const symbol = normalizeSymbol(String(raw ?? ""));
    return isValidSymbol(symbol) ? symbol : null;
  };
  app2.get("/api/fundamentals/:symbol", async (req, res, next) => {
    try {
      const symbol = requireSymbol(req.params.symbol);
      if (!symbol) {
        res.status(400).json(fail(`"${req.params.symbol}" is not a valid ticker symbol.`, "BAD_SYMBOL"));
        return;
      }
      const payload = await loadFundamentals(db2, symbol, {
        force: req.query.force === "1" || req.query.force === "true"
      });
      res.json(ok(payload));
    } catch (err) {
      next(err);
    }
  });
  app2.get("/api/news/:symbol", async (req, res, next) => {
    try {
      const symbol = requireSymbol(req.params.symbol);
      if (!symbol) {
        res.status(400).json(fail(`"${req.params.symbol}" is not a valid ticker symbol.`, "BAD_SYMBOL"));
        return;
      }
      const payload = await loadNews(db2, symbol, {
        force: req.query.force === "1" || req.query.force === "true"
      });
      res.json(ok(payload));
    } catch (err) {
      next(err);
    }
  });
  app2.get("/api/categories", async (req, res, next) => {
    try {
      const raw = typeof req.query.symbols === "string" ? req.query.symbols : "";
      const requested = raw.split(",").map((s) => normalizeSymbol(s)).filter((s) => isValidSymbol(s));
      const symbols = requested.length ? requested : listWatchlist(db2).map((w) => w.symbol);
      const map = await loadCategories(db2, symbols, {
        force: req.query.force === "1" || req.query.force === "true"
      });
      res.json(ok(map));
    } catch (err) {
      next(err);
    }
  });
  const forceish = (req) => req.query.force === "1" || req.query.force === "true";
  const STATEMENT_PERIODS = ["annual", "quarterly", "ltm"];
  app2.get("/api/statements/:symbol", async (req, res, next) => {
    try {
      const symbol = requireSymbol(req.params.symbol);
      if (!symbol) {
        res.status(400).json(fail(`"${req.params.symbol}" is not a valid ticker symbol.`, "BAD_SYMBOL"));
        return;
      }
      const raw = typeof req.query.period === "string" ? req.query.period.toLowerCase() : "annual";
      if (!STATEMENT_PERIODS.includes(raw)) {
        res.status(400).json(fail(`period must be one of ${STATEMENT_PERIODS.join("|")}.`, "BAD_REQUEST"));
        return;
      }
      const payload = await loadStatements(db2, symbol, raw, {
        force: forceish(req)
      });
      res.json(ok(payload));
    } catch (err) {
      next(err);
    }
  });
  app2.get("/api/estimates/:symbol", async (req, res, next) => {
    try {
      const symbol = requireSymbol(req.params.symbol);
      if (!symbol) {
        res.status(400).json(fail(`"${req.params.symbol}" is not a valid ticker symbol.`, "BAD_SYMBOL"));
        return;
      }
      const payload = await loadEstimates(db2, symbol, { force: forceish(req) });
      res.json(ok(payload));
    } catch (err) {
      next(err);
    }
  });
  app2.get("/api/ratings/:symbol", async (req, res, next) => {
    try {
      const symbol = requireSymbol(req.params.symbol);
      if (!symbol) {
        res.status(400).json(fail(`"${req.params.symbol}" is not a valid ticker symbol.`, "BAD_SYMBOL"));
        return;
      }
      const payload = await loadRatings(db2, symbol, { force: forceish(req) });
      res.json(ok(payload));
    } catch (err) {
      next(err);
    }
  });
  app2.get("/api/quotes/:symbol", async (req, res, next) => {
    try {
      const symbol = requireSymbol(req.params.symbol);
      if (!symbol) {
        res.status(400).json(fail(`"${req.params.symbol}" is not a valid ticker symbol.`, "BAD_SYMBOL"));
        return;
      }
      const payload = await loadQuoteOverview(db2, symbol, { force: forceish(req) });
      res.json(ok(payload));
    } catch (err) {
      next(err);
    }
  });
  app2.get("/api/fx", async (req, res, next) => {
    try {
      const raw = typeof req.query.to === "string" ? req.query.to : "";
      const targets = raw.split(",").map((s) => s.trim()).filter(Boolean);
      const payload = await loadFx(db2, targets, { force: forceish(req) });
      res.json(ok(payload));
    } catch (err) {
      next(err);
    }
  });
  app2.get("/api/search", async (req, res, next) => {
    try {
      const q = String(req.query.q ?? "").trim();
      if (!q) {
        res.json(ok([]));
        return;
      }
      const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=10&newsCount=0`;
      const res2 = await fetch(url, {
        headers: { "User-Agent": YAHOO_USER_AGENT, Accept: "application/json" }
      });
      if (!res2.ok) {
        res.json(ok([]));
        return;
      }
      const json = await res2.json();
      const results = (json.quotes ?? []).filter((x) => x.quoteType === "EQUITY" || x.quoteType === "ETF").map((x) => ({
        symbol: String(x.symbol ?? ""),
        name: String(x.longname ?? x.shortname ?? x.symbol ?? ""),
        exchange: String(x.exchDisp ?? x.exchange ?? ""),
        type: String(x.typeDisp ?? x.quoteType ?? ""),
        // Phase 2: the categoriser needs the raw provider taxonomy.
        quoteType: x.quoteType === void 0 ? void 0 : String(x.quoteType),
        sector: x.sector === void 0 || x.sector === null ? null : String(x.sector),
        industry: x.industry === void 0 || x.industry === null ? null : String(x.industry)
      })).filter((x) => x.symbol);
      res.json(ok(results));
    } catch (err) {
      next(err);
    }
  });
  app2.get("/api/watchlist", (_req, res) => {
    res.json(ok(listWatchlist(db2)));
  });
  app2.post("/api/watchlist", async (req, res, next) => {
    try {
      const body = req.body ?? {};
      const symbol = normalizeSymbol(String(body.symbol ?? ""));
      if (!isValidSymbol(symbol)) {
        res.status(400).json(fail(`"${symbol}" is not a valid ticker symbol.`, "BAD_SYMBOL"));
        return;
      }
      let name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : null;
      if (!name) {
        try {
          const s = await loadSeries(db2, symbol, { range: "5d", interval: "1d" });
          name = s.meta.name;
        } catch {
          res.status(404).json(fail(`Could not find a stock or ETF with the symbol "${symbol}".`, "NOT_FOUND"));
          return;
        }
      }
      const item = addWatch(db2, symbol, name, Math.floor(Date.now() / 1e3));
      res.json(ok(item));
    } catch (err) {
      next(err);
    }
  });
  app2.delete("/api/watchlist/:symbol", (req, res) => {
    const symbol = normalizeSymbol(String(req.params.symbol ?? ""));
    const removed = removeWatch(db2, symbol);
    if (!removed) {
      res.status(404).json(fail(`"${symbol}" is not in the watchlist.`, "NOT_FOUND"));
      return;
    }
    res.json(ok({ symbol, removed: true }));
  });
  app2.post("/api/watchlist/reorder", (req, res) => {
    const body = req.body ?? {};
    if (!Array.isArray(body.symbols) || !body.symbols.every((s) => typeof s === "string")) {
      res.status(400).json(fail("Body must be { symbols: string[] }.", "BAD_REQUEST"));
      return;
    }
    res.json(ok(reorderWatchlist(db2, body.symbols.map(normalizeSymbol))));
  });
  app2.get("/api/watchlist/quotes", async (_req, res, next) => {
    try {
      const items = listWatchlist(db2);
      const now = Math.floor(Date.now() / 1e3);
      const quotes = [];
      const CONCURRENCY = 4;
      for (let i = 0; i < items.length; i += CONCURRENCY) {
        const chunk = items.slice(i, i + CONCURRENCY);
        const settled = await Promise.all(
          chunk.map(async (item) => {
            try {
              const s = await loadSeries(db2, item.symbol, { range: "5d", interval: "1d" });
              return {
                symbol: s.symbol,
                name: item.name ?? s.meta.name,
                lastPrice: s.meta.lastPrice,
                change: s.meta.change,
                changePercent: s.meta.changePercent,
                currency: s.meta.currency,
                source: s.source,
                stale: s.source === "stale-cache",
                lastUpdated: s.lastUpdated
              };
            } catch {
              const cached = getMeta(db2, item.symbol);
              return {
                symbol: item.symbol,
                name: item.name ?? item.symbol,
                lastPrice: cached?.lastPrice ?? null,
                change: cached?.change ?? null,
                changePercent: cached?.changePercent ?? null,
                currency: cached?.currency ?? "USD",
                source: "unavailable",
                stale: true,
                lastUpdated: null
              };
            }
          })
        );
        quotes.push(...settled);
      }
      void now;
      res.json(ok(quotes));
    } catch (err) {
      next(err);
    }
  });
  if (existsSync(DIST_DIR)) {
    app2.use(express.static(DIST_DIR, { index: false, maxAge: "1h" }));
    app2.use((req, res, next) => {
      if (req.method !== "GET" || req.path.startsWith("/api")) {
        next();
        return;
      }
      res.sendFile("index.html", { root: DIST_DIR }, (err) => {
        if (err) next(err);
      });
    });
  }
  app2.use((_req, res) => {
    res.status(404).json(fail("Not found.", "NOT_FOUND"));
  });
  app2.use((err, _req, res, _next) => {
    const isMd = err instanceof MarketDataError;
    const code = isMd ? err.code : "INTERNAL_ERROR";
    const message = err instanceof Error ? err.message : "Unexpected server error.";
    const explicit = err?.status;
    const explicitStatus = typeof explicit === "number" && explicit >= 400 && explicit < 600 ? explicit : null;
    const status = isMd ? code === "NOT_FOUND" ? 404 : code === "BAD_REQUEST" || code === "BAD_SYMBOL" ? 400 : 502 : explicitStatus ?? 500;
    if (!isMd) console.error("[api] unhandled error:", err);
    res.status(status).json(fail(message, code));
  });
  return app2;
}
function bootstrap(db2) {
  seedWatchlistIfEmpty(db2, Math.floor(Date.now() / 1e3));
}

// server/index.ts
var __dirname2 = path2.dirname(fileURLToPath2("file:///Users/love21/.openclaw/workspace/debug-coder/projects/stock-app/server/index.ts"));
var ROOT = path2.resolve(__dirname2, "..");
var PORT = Number(process.env.PORT ?? 8787);
var HOST2 = process.env.HOST ?? "127.0.0.1";
var DB_PATH = process.env.DB_PATH ?? path2.join(ROOT, "data", "stock.db");
mkdirSync(path2.dirname(DB_PATH), { recursive: true });
var db = openDb(DB_PATH);
bootstrap(db);
var app = createApp(db);
var server = app.listen(PORT, HOST2, () => {
  const servingStatic = process.env.NODE_ENV === "production" || DIST_DIR.length > 0;
  console.log(`[stock-coach] API listening on http://${HOST2}:${PORT}`);
  console.log(`[stock-coach] SQLite cache: ${DB_PATH}`);
  if (servingStatic) console.log(`[stock-coach] serving built assets from: ${DIST_DIR}`);
});
server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`[stock-coach] Port ${PORT} is already in use. Set PORT to another value and retry.`);
  } else {
    console.error("[stock-coach] server error:", err);
  }
  process.exitCode = 1;
});
function shutdown(signal2) {
  console.log(`[stock-coach] ${signal2} received, shutting down.`);
  server.close(() => {
    try {
      db.close();
    } catch {
    }
    process.exit(0);
  });
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
