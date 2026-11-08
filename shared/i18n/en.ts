import type { Dict } from './index';

/**
 * English dictionary — the **reference locale**.
 *
 * Two rules keep this file honest:
 *  1. `sig.ev.*` templates are not free copy: `npm test` renders every signal
 *     with the English dictionary and asserts the result is character-for-
 *     character identical to the engine's `evidence` line. If you reword one
 *     here without rewording `shared/signals.ts`, a test fails.
 *  2. `npm test` asserts this key set and the zh-HK key set are identical, so a
 *     string can never ship in one language only.
 */
export const en: Dict = {
  // ---- app shell -------------------------------------------------------
  'app.title': 'Stock Coach — beginner-first market reading',
  'app.brand': 'Stock Coach',
  'app.brandShort': 'SC',
  'app.tagline': 'Beginner-first market reading',
  'app.loading': 'Loading…',
  'app.retry': 'Retry',
  'app.backendDown.title': 'Can’t reach the data service.',
  'app.backendDown.body':
    'Stock Coach’s backend (which talks to the market-data provider) is not responding. Start it with {server} — or {dev} to run the API and the web app together — then retry.',
  'app.backendDown.server': 'npm run server',
  'app.backendDown.dev': 'npm run dev',

  // ---- navigation ------------------------------------------------------
  'nav.primary': 'Primary',
  // ---- theme (Phase 5) ------------------------------------------------
  'theme.light': 'Light mode',
  'theme.dark': 'Dark mode',
  'theme.system': 'Match system',
  'theme.toggleTitle': 'Switch between light and dark',
  'nav.group.markets': 'Markets',
  'nav.group.analysis': 'Analysis',
  'nav.group.mine': 'My stuff',
  'nav.dashboard': 'Dashboard',
  'nav.dashboard.hint': 'One-screen overview',
  'nav.chart': 'Chart',
  'nav.chart.hint': 'Full charting workspace',
  'nav.signals': 'Signals',
  'nav.signals.hint': 'What the indicators say',
  'nav.watchlist': 'Watchlist',
  'nav.watchlist.hint': 'Your tickers',
  'nav.help': 'Help',
  'nav.help.hint': 'Beginner glossary',
  'nav.collapse': 'Collapse sidebar',
  'nav.expand': 'Expand sidebar',
  'nav.hide': 'Put the sidebar away',
  'nav.hideTitle': 'Put the panel away — bring it back with the ⟩ handle or the C key',
  'nav.show': 'Show the sidebar',
  'nav.showTitle': 'Bring the sidebar back',
  'nav.section': 'Section navigation',

  // ---- shared vocabulary ----------------------------------------------
  'common.refresh': 'Refresh',
  'common.refreshing': 'Refreshing…',
  'common.tryAgain': 'Try again',
  'common.forceRedownload': 'Force re-download',
  'common.seeAll': 'See all →',
  'common.seeAllSignals': 'See all signals →',
  'common.openChart': 'Open the chart →',
  'common.openChartShort': 'Open chart',
  'common.close': 'Close',
  'common.more': 'More',
  'common.less': 'Show less',
  'common.none': 'None',
  'common.noData': '—',
  'common.unknown': 'Unknown',
  'common.loadingSection': 'Loading…',
  'common.copy': 'Plain-language read',
  'common.hkt': 'HKT',
  'common.networkError': 'Could not reach the server.',
  'common.networkErrorShort': 'Network request failed.',

  // ---- relative time (the "age" buckets) ------------------------------
  // These are the *whole* label for an age, composed by humanAge(). `src.updated`
  // wraps one to say "Updated 2 min ago". English states the unit mid-phrase;
  // Chinese states it inside the word (「2 分鐘前」), which is why the bucket is
  // translated whole instead of a blanket "{age}前" suffix.
  'age.now': 'just now',
  'age.min': '{n} min ago',
  'age.hour': '{n} h ago',
  'age.day': '{n} d ago',
  'age.unknown': 'unknown',

  // ---- source badges ---------------------------------------------------
  'src.live': 'Live',
  'src.cache': 'Cached',
  'src.stale': 'Stale',
  'src.updated': 'Updated {age}',
  'src.staleTitle': 'This number comes from stored history that could not be refreshed.',
  'src.updatedHint': 'When this number was last fetched from the provider.',

  // ---- top bar ---------------------------------------------------------
  'topbar.stale': 'Stale ⚠',
  'topbar.staleTitle': 'These numbers come from stored history that could not be refreshed.',
  'topbar.vol': 'Vol {value}',
  'topbar.refreshTitle': 'Force a fresh download for the current symbol and watchlist',
  'topbar.language': 'Language',
  'topbar.languageTitle': 'Switch the interface language',

  // ---- sidebar ---------------------------------------------------------
  'sidebar.title': 'Watchlist',
  'sidebar.empty': 'Your watchlist is empty. Add a ticker on the Watchlist screen.',
  'sidebar.refreshTitle': 'Refresh watchlist prices',
  'sidebar.more': '{count} more in Watchlist',

  // ---- dashboard -------------------------------------------------------
  'dash.movers.title': 'Your watchlist today',
  'dash.movers.empty': 'No quote data yet — add symbols to your watchlist.',
  'dash.hero.asOf': 'as of {time}',
  'dash.error': 'Could not load {symbol}: {error}',
  'dash.noPrice': 'No price data for this window yet.',
  'dash.downloading': 'Downloading {symbol} candles…',

  'dash.profile.title': 'About {symbol}',
  'dash.profile.noSummary': 'The provider does not publish a business summary for this listing.',
  'dash.profile.sector': 'Sector',
  'dash.profile.industry': 'Industry',
  'dash.profile.exchange': 'Exchange',
  'dash.profile.country': 'Country',
  'dash.profile.website': 'Website',
  'dash.profile.websiteLink': 'Open the company site ↗',
  'dash.profile.employees': 'Employees',
  'dash.profile.loading': 'Fetching the company profile…',

  'dash.cat.title': 'What kind of instrument is this?',
  'dash.cat.type': 'Type',
  'dash.cat.sector': 'Sector',
  'dash.cat.industry': 'Industry',
  'dash.cat.exchange': 'Exchange',
  'dash.cat.country': 'Country',
  'dash.cat.note': 'Classification comes straight from the provider. Unknown means the provider did not say — we never guess.',

  'dash.stats.title': 'Key numbers for {symbol}',
  'dash.stats.marketCap': 'Market cap',
  'dash.stats.trailingPE': 'Trailing P/E',
  'dash.stats.forwardPE': 'Forward P/E',
  'dash.stats.dividendYield': 'Dividend yield',
  'dash.stats.beta': 'Beta',
  'dash.stats.priceToBook': 'Price / book',
  'dash.stats.trailingEps': 'Trailing EPS',
  'dash.stats.dayHigh': 'Day high',
  'dash.stats.dayLow': 'Day low',
  'dash.stats.prevClose': 'Prev close',
  'dash.stats.open': 'Open',
  'dash.stats.w52High': '52-week high',
  'dash.stats.w52Low': '52-week low',
  'dash.stats.volume': 'Volume',
  'dash.stats.avgVolume': 'Avg volume (3m)',
  'dash.stats.notPublished': '{label}: not published by the provider',
  'dash.stats.loading': 'Fetching fundamentals…',
  'dash.stats.none': 'The provider does not publish fundamental data for this instrument (common for ETFs and non-US listings).',

  'dash.health.title': 'Health & analyst view',
  'dash.health.profitMargins': 'Profit margin',
  'dash.health.operatingMargins': 'Operating margin',
  'dash.health.returnOnEquity': 'Return on equity',
  'dash.health.returnOnAssets': 'Return on assets',
  'dash.health.revenueGrowth': 'Revenue growth (y/y)',
  'dash.health.recommendation': 'Analyst recommendation',
  'dash.health.targetMean': 'Mean target price',
  'dash.health.targetRange': 'Target range',
  'dash.health.analysts': 'Analysts covering',
  'dash.health.opinionNote':
    'The recommendation and target prices are the opinions of analysts polled by the provider — not our view, and not a recommendation to buy or sell.',

  'dash.range.title': 'Where today sits in the 52-week range',
  'dash.range.low': '52-week low',
  'dash.range.high': '52-week high',
  'dash.range.now': 'Now',
  'dash.range.position': 'The price is {value}% up its 52-week range.',
  'dash.range.unknown': 'The provider did not supply both ends of the 52-week range.',

  'dash.news.title': 'News & updates for {symbol}',
  'dash.news.empty': 'No recent news for {symbol}.',
  'dash.news.error': 'Could not load news for {symbol}: {error}',
  'dash.news.loading': 'Fetching recent headlines…',
  'dash.news.relevant': 'Mentions {symbol}',
  'dash.news.related': 'Provider matched: {tickers}',
  'dash.news.open': 'Open the story ↗',
  'dash.news.publisherUnknown': 'Publisher not stated',
  'dash.news.sourceNote':
    'Headlines come from the provider’s own news search. Every item links to the original story — nothing here is written or paraphrased by Stock Coach.',

  'dash.signals.title': 'What the indicators say',
  'dash.signals.verdict': '{verdict} — score {score}/100 across {count} rules.',
  'dash.signals.loading': 'Loading indicator readings…',
  'dash.signals.hint': 'These are rule-based readings, explained in plain language.',

  'dash.help.title': 'New to this? Start here',
  'dash.help.tip1':
    'Change the time range (1D … MAX) and interval buttons to zoom the chart. The indicator readings are always scored on daily bars so they stay comparable.',
  'dash.help.tip2':
    'Not sure what a term means? Every signal explains itself on the Signals tab, and the Help tab has a beginner glossary.',
  'dash.help.tip3':
    'Every number here comes from real market data; nothing is simulated. A missing value shows as “—” rather than a made-up figure.',

  // ---- chart screen ----------------------------------------------------
  'chart.range': 'Range',
  'chart.rangeGroup': 'Time range',
  'chart.interval': 'Interval',
  'chart.intervalGroup': 'Bar interval',
  'chart.auto': 'Auto',
  'chart.intervalHint.1m': 'Each candle = 1 minute. Very short-term intraday noise.',
  'chart.intervalHint.5m': 'Each candle = 5 minutes. Intraday moves.',
  'chart.intervalHint.15m': 'Each candle = 15 minutes. A common intraday swing view.',
  'chart.intervalHint.1h': 'Each candle = 1 hour. Intraday trend.',
  'chart.intervalHint.1d': 'Each candle = 1 trading day. The default, most reliable view.',
  'chart.intervalHint.1w': 'Each candle = 1 week. Medium-term trend.',
  'chart.intervalHint.1mo': 'Each candle = 1 month. Long-term trend.',
  'chart.autoTitle': 'Pick the interval automatically from the range',
  'chart.overlays': 'Overlays',
  'chart.overlayGroup': 'Indicators',
  'chart.panes': 'Panes',
  'chart.paneGroup': 'Sub-panes',
  'chart.volume': 'Volume',
  'chart.rsi': 'RSI',
  'chart.macd': 'MACD',
  'chart.toggleOverlay': 'Toggle {label}',
  'chart.needsHistory': '{label} needs more history than this window shows',
  'chart.refreshTitle': 'Re-download this window from the data provider, bypassing the cache',
  'chart.bars': '{count} bars',
  'chart.barsLast': '{count} bars · last {price}',
  'chart.attribution': 'Charts by TradingView Lightweight Charts',
  'chart.prevClose': 'prev close {value}',
  'chart.error': 'Could not load {symbol}: {error}',
  'chart.noData': 'No price data for this window yet.',
  'chart.downloading': 'Downloading {symbol} {range} candles…',
  'chart.reading.title': 'Reading the candles',
  'chart.reading.candle':
    'Each candle covers one {interval} bar of trading. The thick body spans the open and close; the thin wicks mark the high and low of that bar. Green means the bar closed higher than it opened, red means lower.',
  'chart.reading.zoom':
    'Scroll or pinch to zoom, drag to pan. Hover (or tap and drag) to see the open/high/low/close for any bar in the legend at the top-left.',
  'chart.reading.times': 'Times are shown in Hong Kong time; the candle dates themselves are calendar dates in UTC.',

  // ---- signals screen --------------------------------------------------
  'signals.loading': 'Reading the indicators for {symbol}…',
  'signals.error': 'Could not load signals for {symbol}: {error}',
  'signals.empty': 'No signals loaded yet.',
  'signals.score': '{verdict} · score {score}/100',
  'signals.verdict.bullish': 'Leaning bullish',
  'signals.verdict.bearish': 'Leaning bearish',
  'signals.verdict.mixed': 'Mixed / no clear edge',
  'signals.verdict.noData': 'Not enough data to score',
  'signals.sentence.bullish': 'Most of the rules currently point higher.',
  'signals.sentence.bearish': 'Most of the rules currently point lower.',
  'signals.sentence.mixed': 'The rules disagree — there is no clear edge right now.',
  'signals.sentence.noData': 'There is not enough history to score this symbol.',
  'signals.tally.bullish': '{count} bullish',
  'signals.tally.bearish': '{count} bearish',
  'signals.tally.neutral': '{count} neutral',
  'signals.rescore': '⟳ Re-score',
  'signals.scored': '{count} daily bars · scored {time}',
  'signals.scoredOn': 'Scored on {symbol} daily bars ({range} history, {interval} bars).',
  'signals.openChart': 'Open the chart →',
  'signals.howto.title': 'How to read this',
  'signals.howto.state':
    'Bullish means the rule currently reads as a positive/upward condition, bearish the opposite, and neutral means the readings disagree or sit in the middle.',
  'signals.howto.strength':
    'Strength is how strongly the numbers point that way, not how likely a move is. Two rules can disagree — that is normal and is exactly why we show all six.',
  'signals.disclaimer':
    'These are rule-based readings of price history, not investment advice. They describe what the numbers show — they do not predict the future.',

  'signal.state.bullish': 'Bullish',
  'signal.state.bearish': 'Bearish',
  'signal.state.neutral': 'Neutral',
  'signal.strength': 'strength {value}/100',
  'signal.strengthTitle': 'How strongly the numbers point this way (0–100)',
  'signal.whatThisIs': 'What this is',
  'signal.whatItMeans': 'What it means right now',
  'signal.whatToWatch': 'What to watch',
  'signal.evidence': 'Show the numbers behind this ({count})',
  'signal.evidenceEmpty': 'No evidence lines for this reading.',

  // ---- watchlist screen ------------------------------------------------
  'watch.title': 'Watchlist',
  'watch.subtitle': 'Add, remove and reorder the tickers you follow.',
  'watch.add': 'Add',
  'watch.addLabel': 'Add a ticker',
  'watch.addPlaceholder': 'Ticker or company name, e.g. AAPL',
  'watch.search': 'Search',
  'watch.searching': 'Searching…',
  'watch.noResults': 'No matching stocks or ETFs found.',
  'watch.empty': 'Nothing on your watchlist yet. Search above and add your first ticker.',
  'watch.groupBy': 'Group by',
  'watch.group.all': 'All',
  'watch.group.sector': 'Sector',
  'watch.group.type': 'Type',
  'watch.group.exchange': 'Exchange',
  'watch.group.unknown': 'Uncategorised',
  'watch.group.count': '{count} symbols',
  'watch.remove': 'Remove {symbol}',
  'watch.moveUp': 'Move {symbol} up',
  'watch.moveDown': 'Move {symbol} down',
  'watch.loading': 'Loading your watchlist…',
  'watch.added': 'Added {symbol} to your watchlist.',
  'watch.addBtn': 'Add to watchlist',
  'watch.checking': 'Checking…',
  'watch.addFailed': 'Could not add that symbol.',
  'watch.invalid': '“{input}” does not look like a ticker symbol.',
  'watch.addError': 'Could not add that symbol.',
  'watch.listTitle': 'Your watchlist ({count})',
  'watch.refreshPrices': '⟳ Refresh prices',
  'watch.view': 'View',
  'watch.whatIs': 'What is a watchlist?',
  'watch.whatIs.body':
    'It is just the short list of tickers you care about. Keeping it short (5–10 names) makes the dashboard readable and the movers strip a useful signal instead of noise. Your watchlist is stored locally on this machine.',

  // ---- categorisation --------------------------------------------------
  'cat.type.stock': 'Stock',
  'cat.type.etf': 'ETF',
  'cat.type.other': 'Other',
  'cat.unknown': 'Unknown',

  // ---- misc UI ---------------------------------------------------------
  'mover.onChart': 'on chart',
  'mover.openTitle': 'Open {symbol} on the chart',
  'mover.openLabel': 'Open {symbol} on the chart',

  // ---- help screen -----------------------------------------------------
  'help.readFirst.title': 'Read this first',
  'help.readFirst.body':
    'Stock Coach shows you real market data and explains what common indicators are saying in plain language. It is a learning and reading tool. It does not tell you to buy or sell anything, and no indicator can predict the future.',
  'help.fiveMin.title': 'Your first five minutes',
  'help.fiveMin.1': 'Open Watchlist and add two or three tickers you already know (try {symbol}, or type a company name).',
  'help.fiveMin.2': 'Go to Dashboard — you will see your names ranked by how much they moved today.',
  'help.fiveMin.3': 'Use the time range buttons (1D, 1M, 1Y, MAX…) to see the same stock over different horizons.',
  'help.fiveMin.4': 'Hover over the chart to read the open/high/low/close of any single bar.',
  'help.fiveMin.5': 'Open Signals and expand “Show the numbers behind this” on any card to see exactly why the app said what it said.',
  'help.screens.title': 'The screens',
  'help.screens.dashboard': 'The one-screen overview: your watchlist movers, the selected stock’s chart, its profile, fundamentals and news.',
  'help.screens.chart': 'The full charting workspace — time ranges, candle intervals, every overlay, and the volume / RSI / MACD sub-panes.',
  'help.screens.signals': 'Six rule-based readings explained in plain language, each with the exact numbers behind it.',
  'help.screens.watchlist': 'Add, remove, group and reorder the tickers you follow. Search by ticker or company name.',
  'help.screens.help': 'This page: how to use the app, what each term means, and what the app deliberately does not do.',
  'help.glossary.title': 'Beginner glossary',
  'help.indicators.title': 'What each indicator means',
  'help.data.title': 'Where the data comes from — and its limits',
  'help.data.1':
    'Prices come from the provider’s public chart endpoint. The app caches what it downloads so it stays fast and keeps working when the provider is briefly rate-limiting.',
  'help.data.2':
    'Company profile, key statistics and analyst estimates come from the provider’s fundamentals endpoint, which needs a short-lived session token. If that call fails, those panels say so instead of guessing.',
  'help.data.3':
    'News headlines come from the provider’s news search. Each headline links to the original article; Stock Coach never writes or edits a headline.',
  'help.data.4':
    'Every panel tells you whether its numbers are Live, Cached or Stale, and when they were last updated (Hong Kong time). If a value is missing it is shown as “—” — never as a fabricated number.',
  'help.data.5':
    'Intraday history is limited by the provider: minute bars go back about a week, 5–15 minute bars about a month, hourly bars about two years. Pick a longer interval to see further back.',
  'help.install.title': 'Install it like an app',
  'help.install.1': 'iPhone / iPad (Safari): Share → Add to Home Screen. It then opens full-screen like a native app.',
  'help.install.2': 'Mac (Safari): File → Add to Dock. Chrome/Edge: the install icon in the address bar.',
  'help.install.3': 'Android (Chrome): menu → Install app.',
  'help.language.title': 'Language',
  'help.language.body':
    'The interface ships in 繁體中文 (default) and English. Use the 中 / EN switch in the top bar; your choice is remembered on this device.',
  'help.notAdvice.title': 'Not investment advice',
  'help.notAdvice.body':
    'Stock Coach is a reading and learning tool. The signals describe what price history looks like right now under a fixed set of rules; they are not predictions and not recommendations. Always do your own research and consider speaking to a licensed professional before making any investment decision.',

  // ---- UI glossary (help screen) ---------------------------------------
  'glossary.symbol.term': 'Ticker / symbol',
  'glossary.symbol.plain':
    'The short code a stock trades under, e.g. AAPL for Apple. Hong Kong listings add a suffix, e.g. 0700.HK for Tencent.',
  'glossary.candle.term': 'Candle',
  'glossary.candle.plain':
    'One bar on the chart covering a fixed slice of time. The thick body spans the opening and closing price; the thin lines (wicks) show the highest and lowest price in that slice.',
  'glossary.ohlc.term': 'Open / High / Low / Close (OHLC)',
  'glossary.ohlc.plain':
    'The four prices that define a candle: where it started, the highest and lowest it reached, and where it ended.',
  'glossary.volume.term': 'Volume',
  'glossary.volume.plain': 'How many shares changed hands during that slice of time. Big volume means lots of people were trading.',
  'glossary.interval.term': 'Timeframe / interval',
  'glossary.interval.plain':
    'How much time one candle covers. 1D means one candle per trading day; 1m means one candle per minute. Short intervals show noise, long intervals show the bigger trend.',
  'glossary.trend.term': 'Trend',
  'glossary.trend.plain':
    'The general direction a price has been moving — up, down, or sideways. Trends are only obvious in hindsight.',
  'glossary.support.term': 'Support / resistance',
  'glossary.support.plain':
    'A price level the stock has repeatedly bounced off (support) or struggled to rise past (resistance). These are habits, not rules.',
  'glossary.bullish.term': 'Bullish / bearish',
  'glossary.bullish.plain':
    'Jargon for “pointing up” / “pointing down”. A bullish reading suggests upward pressure; bearish suggests downward pressure.',
  'glossary.snapshot.term': 'Snapshot',
  'glossary.snapshot.plain': 'The state of all the indicators at one moment in time.',
  'glossary.sector.term': 'Sector / industry',
  'glossary.sector.plain':
    'The broad business area a company belongs to (sector, e.g. Technology) and the narrower niche inside it (industry, e.g. Consumer Electronics). ETFs and funds usually have neither.',
  'glossary.exchange.term': 'Exchange',
  'glossary.exchange.plain':
    'The marketplace where a listing trades, e.g. NASDAQ, NYSE or HKEX. The same company can list on several.',

  'ind.sma.term': 'SMA (Simple Moving Average)',
  'ind.sma.plain':
    'The plain average of the last N closing prices, redrawn as a line. SMA 50 averages 50 days. It smooths out day-to-day noise so the trend is easier to see.',
  'ind.ema.term': 'EMA (Exponential Moving Average)',
  'ind.ema.plain': 'Like an SMA, but recent days count more than older ones, so it reacts faster to new prices.',
  'ind.rsi.term': 'RSI (Relative Strength Index)',
  'ind.rsi.plain':
    'A 0–100 score of how one-sided recent moves have been. Above 70 is often called “overbought” and below 30 “oversold” — but in a strong trend, RSI can stay extreme for a long time.',
  'ind.macd.term': 'MACD',
  'ind.macd.plain':
    'The gap between a fast and a slow moving average, plus an average of that gap (the “signal line”). When the fast line crosses above the signal line it is read as momentum turning up.',
  'ind.bb.term': 'Bollinger Bands',
  'ind.bb.plain':
    'A moving average with an upper and lower band placed a fixed distance away, based on recent volatility. Narrow bands mean the price has been calm; wide bands mean it has been jumpy.',
  'ind.atr.term': 'ATR (Average True Range)',
  'ind.atr.plain':
    'The average size of a bar’s move, high to low. It is a simple way to measure how volatile a stock currently is — larger ATR means bigger swings.',
  'ind.cross.term': 'Golden cross / death cross',
  'ind.cross.plain':
    'When the 50-day average crosses above the 200-day average (golden) or below it (death). Popular long-term trend markers — slow, and always late.',
  'ind.squeeze.term': 'Squeeze',
  'ind.squeeze.plain':
    'When volatility contracts to an unusually low level, often before a larger move. It tells you a move is brewing, not which direction it will go.',
  'ind.strength.term': 'Strength',
  'ind.strength.plain':
    'Our 0–100 measure of how strongly the numbers point a given way. It is a description of the current data, not a probability of a future move.',

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

  // ---- failure notes ---------------------------------------------------
  // Rendered where `source !== 'live'`. The server ships the code; the text
  // lives here so a Chinese user never reads an English sentence.
  'note.marketLiveFetchFailed':
    'Live prices could not be refreshed just now, so this is the last data we stored.',
  'note.newsUnreachableCached': 'The news provider could not be reached. Showing the last headlines we saved.',
  'note.newsUnreachableNone': 'The news provider could not be reached and nothing is saved yet.',
  'note.fundamentalsUnreachableCached':
    'The company-data provider could not be reached. Showing the last snapshot we saved.',
  'note.fundamentalsUnavailable': 'Company data is unavailable right now; we will try again shortly.',
  'note.indicatorsUnavailable': 'There is not enough history yet to draw the indicators for this window.',

  // ---- API failures ----------------------------------------------------
  // `code` → message. See `shared/api-errors.ts`.
  'api.badSymbol': '“{symbol}” is not a ticker symbol we recognise.',
  'api.notFound': 'No stock or ETF matches “{symbol}”.',
  'api.notInWatchlist': '“{symbol}” is not on your watchlist.',
  'api.badRequest': 'That request was not valid.',
  'api.badResponse': 'The server sent something we could not read.',
  'api.internalError': 'Something went wrong on our side. Please try again.',
  'api.upstreamError': 'The market-data provider is not responding right now. Please try again.',

  // ======================================================================
  // Phase 3 — the analyst workspace (SPEC-PHASE3 §C).
  //
  // Keyed under `pf.` ("professional financials") so the Phase 1/2 namespaces
  // stay recognisable. Labels and *formulas* are both here: §A.3 requires the
  // arithmetic to be shown on hover, so a formula is user-facing copy.
  // ======================================================================

  // ---- shell -----------------------------------------------------------
  'nav.analysts': 'Analysts',
  'nav.analysts.hint': 'Estimates, statements & ratings',
  'nav.group.analysts': 'Research',
  'pf.title': 'Analysts',
  'pf.subtitle': 'Consensus estimates, financial statements and analyst ratings for {symbol}.',
  'pf.tab.overview': 'Overview',
  'pf.tab.statements': 'Statements',
  'pf.tab.estimates': 'Estimates',
  'pf.tab.ratings': 'Ratings',
  'pf.tab.aria': 'Analyst sections',
  'pf.section.toggle': 'Show or hide this section',
  'pf.section.loading': 'Loading…',
  'pf.error.title': 'Could not load this section.',
  'pf.empty.panel': 'Nothing to show here yet.',
  'pf.asOf': 'As of {date}',

  // ---- company header & overview (§C.1) --------------------------------
  'pf.head.title': 'Overview',
  'pf.head.name': 'Company',
  'pf.head.exchange': 'Exchange',
  'pf.head.marketState': 'Market state',
  'pf.head.state.regular': 'Regular session',
  'pf.head.state.pre': 'Pre-market',
  'pf.head.state.post': 'After hours',
  'pf.head.state.closed': 'Closed',
  'pf.head.preMarket': 'Pre-market',
  'pf.head.postMarket': 'After hours',
  'pf.head.prevClose': 'Previous close',
  'pf.head.dayHigh': 'Day high',
  'pf.head.dayLow': 'Day low',
  'pf.head.w52': '52-week range',
  'pf.head.volume': 'Volume',
  'pf.head.marketCap': 'Market cap',
  'pf.head.trailingPE': 'P/E (trailing)',
  'pf.head.forwardPE': 'P/E (forward)',
  'pf.head.sector': 'Sector',
  'pf.head.industry': 'Industry',
  'pf.head.nextEarnings': 'Next earnings',
  'pf.head.nextEarningsNone': 'Not announced yet',
  'pf.head.note': 'Pre-market and after-hours rows appear only when the provider publishes them.',

  // ---- quick actions (§C.1) --------------------------------------------
  'pf.act.title': 'Views & export',
  'pf.act.watch': 'Watchlist',
  'pf.act.watch.add': 'Add to watchlist',
  'pf.act.watch.added': 'On watchlist',
  'pf.act.watch.remove': 'Remove from watchlist',
  'pf.act.alerts': 'My alerts',
  'pf.act.alerts.placeholder': 'Remind me at this price',
  'pf.act.alerts.set': 'Save reminder',
  'pf.act.alerts.clear': 'Clear',
  'pf.act.alerts.none': 'No reminders yet.',
  'pf.act.alerts.current': 'Reminder: {price}',
  'pf.act.alerts.local': 'Reminders are stored in this browser only — they are a note to yourself, not a notification.',
  'pf.act.notes': 'My notes',
  'pf.act.notes.placeholder': 'Notes on {symbol} (kept on this device)',
  'pf.act.notes.save': 'Save note',
  'pf.act.notes.saved': 'Saved',
  'pf.act.notes.local': 'Notes never leave this browser.',
  'pf.act.export': 'Export visible data',
  'pf.act.export.csv': 'CSV',
  'pf.act.export.json': 'JSON',
  'pf.act.export.none': 'Nothing visible to export.',
  'pf.export.note':
    'Values are exactly what the screen showed, including any missing figures as "—".',

  // ---- recap -----------------------------------------------------------
  'pf.recap.title': 'Analyst recap',
  'pf.recap.rating': 'Consensus rating',
  'pf.recap.target': 'Mean price target',
  'pf.recap.upside': 'Upside to target',
  'pf.recap.epsNextQ': 'EPS, next quarter',
  'pf.recap.revenueNextQ': 'Revenue, next quarter',
  'pf.recap.forwardPE': 'Forward P/E',
  'pf.recap.nextEarnings': 'Next earnings',
  'pf.recap.lines': 'Statement lines',
  'pf.recap.metrics': 'Derived metrics',

  // ---- period switch ---------------------------------------------------
  'pf.period.aria': 'Statement period',
  'pf.period.ltm': 'LTM',
  'pf.period.quarterly': 'Q',
  'pf.period.annual': 'Y',
  'pf.period.ltmHint': 'Trailing twelve months, computed from the last four reported quarters.',
  'pf.period.quarterlyHint': 'The last four reported quarters, exactly as filed.',
  'pf.period.annualHint': 'The last four reported fiscal years, exactly as filed.',
  'pf.computed': 'LTM (computed)',
  'pf.computedNote': 'LTM figures are computed from the last four reported quarters; the provider does not report a twelve-month column itself.',
  'pf.column.count': '{count} periods',
  'pf.period.label': 'Period',

  // ---- currency switch (§A.4) ------------------------------------------
  'pf.currency.switch': 'Display currency',
  'pf.currency.source': 'Reported in {currency}',
  'pf.currency.rate': '1 {from} = {rate} {to}',
  'pf.currency.rateAt': 'rate as of {time}',
  'pf.currency.rateUnknown': 'rate unavailable',
  'pf.currency.fellBack': 'No live {to} rate, so this figure stays in {from}.',
  'pf.currency.note': 'Conversion is for display only; the statements remain in the currency the company reports in.',

  // ---- statements (§C.2) -----------------------------------------------
  'pf.stmt.title': 'Financial statements',
  'pf.stmt.income': 'Income statement',
  'pf.stmt.balance': 'Balance sheet',
  'pf.stmt.cashflow': 'Cash flow',
  'pf.stmt.empty': 'The provider publishes no figures for this period.',
  'pf.stmt.missing': 'Not published for this period.',
  'pf.stmt.change': 'Latest change',
  'pf.stmt.changeNote': 'The Change column is the newest period against the one before it, as a percentage. It is our arithmetic, not a reported figure.',
  'pf.stmt.lineNote': 'A dash means the provider published nothing for that line — it is not a zero.',
  'pf.stmt.currencyPer': 'Figures in {currency}',

  // ---- multiples / profitability / solvency (§A.3) ---------------------
  'pf.mult.title': 'Multiples & enterprise value',
  'pf.prof.title': 'Profitability & returns',
  'pf.solv.title': 'Debt & coverage',
  'pf.metric.asOf': 'Latest reported period: {date}',
  'pf.metric.formula': 'Formula',
  'pf.metric.note': 'Every ratio here is computed from the statement lines above; hover a value to see its formula.',
  'pf.metric.marketCap': 'Market cap used',
  'pf.metric.ev': 'Enterprise value',
  'pf.metric.netDebt': 'Net debt',

  'pf.mult.pe': 'P/E',
  'pf.mult.pb': 'P/B',
  'pf.mult.ps': 'P/S',
  'pf.mult.evRevenue': 'EV/Revenue',
  'pf.mult.evEbitda': 'EV/EBITDA',
  'pf.mult.evEbit': 'EV/EBIT',

  'pf.prof.grossMargin': 'Gross margin',
  'pf.prof.operatingMargin': 'Operating margin',
  'pf.prof.netMargin': 'Net margin',
  'pf.prof.ebitdaMargin': 'EBITDA margin',
  'pf.prof.roe': 'Return on equity',
  'pf.prof.roa': 'Return on assets',
  'pf.prof.roic': 'ROIC',

  'pf.solv.debtToEquity': 'Total debt / equity',
  'pf.solv.ltDebtToEquity': 'Long-term debt / equity',
  'pf.solv.debtToCapital': 'Total debt / capital',
  'pf.solv.liabToAssets': 'Liabilities / assets',
  'pf.solv.currentRatio': 'Current ratio',
  'pf.solv.ebitToInterest': 'EBIT / interest',
  'pf.solv.ebitdaToInterest': 'EBITDA / interest',
  'pf.solv.debtToEbitda': 'Total debt / EBITDA',
  'pf.solv.netDebtToEbitda': 'Net debt / EBITDA',
  'pf.solv.debtToEbitdaCapex': 'Debt / (EBITDA − capex)',

  // Formulas, shown on hover. Written plainly so the number can be traced.
  'pf.formula.pe': 'price ÷ diluted EPS (latest reported period)',
  'pf.formula.pb': 'market cap ÷ shareholders’ equity',
  'pf.formula.ps': 'market cap ÷ revenue',
  'pf.formula.evRevenue': 'enterprise value ÷ revenue',
  'pf.formula.evEbitda': 'enterprise value ÷ EBITDA',
  'pf.formula.evEbit': 'enterprise value ÷ EBIT',
  'pf.formula.grossMargin': 'gross profit ÷ revenue',
  'pf.formula.operatingMargin': 'operating income ÷ revenue',
  'pf.formula.netMargin': 'net income ÷ revenue',
  'pf.formula.ebitdaMargin': 'EBITDA ÷ revenue',
  'pf.formula.roe': 'net income ÷ shareholders’ equity',
  'pf.formula.roa': 'net income ÷ total assets',
  'pf.formula.roic': 'NOPAT ÷ (total debt + equity − cash), with NOPAT = EBIT × (1 − tax ÷ pretax income)',
  'pf.formula.debtToEquity': 'total debt ÷ shareholders’ equity',
  'pf.formula.ltDebtToEquity': 'long-term debt ÷ shareholders’ equity',
  'pf.formula.debtToCapital': 'total debt ÷ (total debt + equity)',
  'pf.formula.liabToAssets': 'total liabilities ÷ total assets',
  'pf.formula.currentRatio': 'current assets ÷ current liabilities',
  'pf.formula.ebitToInterest': 'EBIT ÷ interest expense',
  'pf.formula.ebitdaToInterest': 'EBITDA ÷ interest expense',
  'pf.formula.debtToEbitda': 'total debt ÷ EBITDA',
  'pf.formula.netDebtToEbitda': 'net debt ÷ EBITDA',
  'pf.formula.debtToEbitdaCapex': 'total debt ÷ (EBITDA − capital expenditure)',

  // ---- income statement lines ------------------------------------------
  'pf.income.totalRevenue': 'Total revenue',
  'pf.income.costOfRevenue': 'Cost of revenue',
  'pf.income.grossProfit': 'Gross profit',
  'pf.income.researchAndDevelopment': 'Research & development',
  'pf.income.sellingGeneralAndAdmin': 'Selling, general & admin',
  'pf.income.operatingIncome': 'Operating income',
  'pf.income.ebitda': 'EBITDA',
  'pf.income.ebit': 'EBIT',
  'pf.income.interestExpense': 'Interest expense',
  'pf.income.pretaxIncome': 'Pretax income',
  'pf.income.taxProvision': 'Tax provision',
  'pf.income.netIncome': 'Net income',
  'pf.income.basicEps': 'Basic EPS',
  'pf.income.dilutedEps': 'Diluted EPS',

  // ---- balance-sheet lines ---------------------------------------------
  'pf.balance.totalAssets': 'Total assets',
  'pf.balance.currentAssets': 'Current assets',
  'pf.balance.cash': 'Cash & equivalents',
  'pf.balance.inventory': 'Inventory',
  'pf.balance.goodwill': 'Goodwill',
  'pf.balance.otherIntangibles': 'Other intangibles',
  'pf.balance.currentLiabilities': 'Current liabilities',
  'pf.balance.totalLiabilities': 'Total liabilities',
  'pf.balance.longTermDebt': 'Long-term debt',
  'pf.balance.currentDebt': 'Current debt',
  'pf.balance.totalDebt': 'Total debt',
  'pf.balance.netDebt': 'Net debt',
  'pf.balance.stockholdersEquity': 'Shareholders’ equity',
  'pf.balance.minorityInterest': 'Minority interest',
  'pf.balance.sharesOutstanding': 'Shares outstanding',
  'pf.balance.totalCapitalization': 'Total capitalisation',

  // ---- cash-flow lines --------------------------------------------------
  'pf.cash.operatingCashFlow': 'Operating cash flow',
  'pf.cash.capitalExpenditure': 'Capital expenditure',
  'pf.cash.freeCashFlow': 'Free cash flow',
  'pf.cash.investingCashFlow': 'Investing cash flow',
  'pf.cash.financingCashFlow': 'Financing cash flow',
  'pf.cash.depreciationAndAmortization': 'Depreciation & amortisation',
  'pf.cash.reconciledDepreciation': 'Reconciled depreciation',
  'pf.cash.stockBasedCompensation': 'Stock-based compensation',
  'pf.cash.dividendsPaid': 'Dividends paid',
  'pf.cash.repurchaseOfStock': 'Share repurchases',

  // ---- estimates (§C.3, §C.6) ------------------------------------------
  'pf.est.title': 'Estimates',
  'pf.est.trend': 'Estimate trend',
  'pf.est.breakdown': 'Estimate breakdown',
  'pf.est.period': 'Period',
  'pf.est.endDate': 'Ends',
  'pf.est.eps': 'EPS',
  'pf.est.revenue': 'Revenue',
  'pf.est.avg': 'Average',
  'pf.est.low': 'Low',
  'pf.est.high': 'High',
  'pf.est.range': 'Low → high',
  'pf.est.analysts': 'Analysts',
  'pf.est.growth': 'YoY growth',
  'pf.est.yearAgo': 'A year ago',
  'pf.est.evMultiple': 'EV multiple',
  'pf.est.priceMultiple': 'Price multiple',
  'pf.est.noEstimate': 'No estimate published',
  'pf.est.period.0q': 'This quarter',
  'pf.est.period.+1q': 'Next quarter',
  'pf.est.period.0y': 'This fiscal year',
  'pf.est.period.+1y': 'Next fiscal year',
  'pf.est.period.fyPlus': 'FY+{n}',
  'pf.est.period.fyPlusHint': 'The provider carries no estimate for this year.',
  'pf.est.extraYears': 'Not carried upstream',
  'pf.est.extraYearsNote': 'Yahoo publishes estimates for four periods only (this quarter, next quarter, this year, next year). The further years are shown as dashes because no data exists for them — nothing here is interpolated.',
  'pf.est.calendar.title': 'Next earnings date',
  'pf.est.calendar.estimated': 'Expected (provider estimate)',
  'pf.est.calendar.confirmed': 'Confirmed by the company',
  'pf.est.calendar.none': 'The provider has not announced a date yet.',
  'pf.est.calendar.epsAvg': 'Consensus EPS',
  'pf.est.calendar.revenueAvg': 'Consensus revenue',
  'pf.est.history.title': 'Reported quarters vs consensus',
  'pf.est.history.period': 'Quarter',
  'pf.est.history.actual': 'Actual EPS',
  'pf.est.history.estimate': 'Consensus EPS',
  'pf.est.history.diff': 'Difference',
  'pf.est.history.surprise': 'Surprise',
  'pf.est.history.none': 'The provider has no reported-quarter history for this symbol.',
  'pf.est.matrix.title': 'Next quarter forecast vs last reported quarter',
  'pf.est.matrix.metric': 'Metric',
  'pf.est.matrix.actual': 'Last reported',
  'pf.est.matrix.forecast': 'Forecast',
  'pf.est.matrix.growth': 'Change',
  'pf.est.matrix.asOf': 'Latest reported quarter: {asOf}',
  'pf.est.matrix.basisNote': 'Both columns use the same period basis (one quarter).',
  'pf.est.matrix.notCarried': 'No consensus is published for this line upstream.',
  'pf.est.ntm.title': 'Estimate level vs price',
  'pf.est.ntm.note': 'The estimate overlay is a single current point (the forward estimate level). The provider publishes no historical estimate series, so there is no past line to draw — the price line is real history.',
  'pf.est.ntm.level': 'Current forward estimate',
  'pf.est.ntm.price': 'Price now',
  'pf.est.ntm.noEstimate': 'No forward estimate available, so there is nothing to plot against the price.',
  'pf.est.side.eps': 'EPS',
  'pf.est.side.revenue': 'Revenue',

  'pf.matrix.revenue': 'Revenue',
  'pf.matrix.ebitda': 'EBITDA',
  'pf.matrix.ebit': 'EBIT',
  'pf.matrix.eps': 'Diluted EPS',

  // ---- ratings (§C.5) ---------------------------------------------------
  'pf.rat.title': 'Ratings',
  'pf.rat.distribution': 'Rating distribution',
  'pf.rat.trend': 'Ratings over time',
  'pf.rat.score': 'Composite score',
  'pf.rat.scoreHint': '1 = strong buy, 5 = strong sell, as the provider computes it.',
  'pf.rat.analysts': 'Analyst opinions',
  'pf.rat.bucket': 'Month',
  'pf.rat.strongBuy': 'Strong buy',
  'pf.rat.buy': 'Buy',
  'pf.rat.hold': 'Hold',
  'pf.rat.sell': 'Sell',
  'pf.rat.strongSell': 'Strong sell',
  'pf.rat.mean': 'Mean target',
  'pf.rat.median': 'Median target',
  'pf.rat.low': 'Low target',
  'pf.rat.high': 'High target',
  'pf.rat.currentPrice': 'Price now',
  'pf.rat.upside': 'Return potential',
  'pf.rat.oneYear': 'Trailing 1-year return',
  'pf.rat.none': 'The provider publishes no analyst coverage for this symbol.',
  'pf.rat.actions': 'Recent upgrades & downgrades',
  'pf.rat.actions.none': 'No recent rating actions.',
  'pf.rat.date': 'Date',
  'pf.rat.firm': 'Firm',
  'pf.rat.from': 'From',
  'pf.rat.to': 'To',
  'pf.rat.action': 'Action',
  'pf.rat.targetAction': 'Target',
  'pf.rat.currentTarget': 'New target',
  'pf.rat.priorTarget': 'Prior target',
  'pf.rat.band.title': 'Price target vs price',
  'pf.rat.band.note': 'The band is the current analyst target range; the line is the real price history. The provider keeps no historical target series, so the band is drawn once, as today’s range — it is not a past series.',
  'pf.rat.band.span': 'Span',
  'pf.rat.band.legendPrice': 'Price',
  'pf.rat.band.legendTarget': 'Target band (current)',
  'pf.rat.band.noHistory': 'No price history for this span.',
  'pf.rat.band.above': 'above the target range',
  'pf.rat.band.below': 'below the target range',
  'pf.rat.band.inside': 'inside the target range',

  // ---- Phase 3 failure notes -------------------------------------------
  'note.statementsUnavailable': 'The financial-statements provider could not be reached and nothing is saved yet.',
  'note.estimatesUnavailable': 'Analyst estimates are unavailable right now; we will try again shortly.',
  'note.estimatesUnreachableCached': 'The estimate provider could not be reached. Showing the last snapshot we saved.',
  'note.ratingsUnavailable': 'Analyst ratings are unavailable right now; we will try again shortly.',
  'note.ratingsUnreachableCached': 'The ratings provider could not be reached. Showing the last snapshot we saved.',
  'note.quotesUnreachableCached': 'Live quote details could not be refreshed. Showing the last snapshot we saved.',
  'note.fxUnavailable': 'Exchange rates are unavailable right now, so figures are shown in their reported currency.',
  // ---- Phase 4 dividend notes ------------------------------------------
  // Each note names the *unit* or *derivation* that was checked, so a dash is
  // never mistaken for "the provider said zero".
  'note.dividendNoDividend': 'This company currently pays no dividend, so yield and payout figures are not shown.',
  'note.dividendStaleCached': 'The dividend provider could not be reached. Showing the last snapshot we saved.',
  'note.dividendNoRecentPayment': 'No dividend payment in the last twelve months, so the current yield figures are not shown.',
  'note.dividendFactsUnavailable': 'Current dividend details are unavailable right now; the payment history below is unaffected.',
  'note.dividendForwardIsIndicated': 'Forward yield is the *indicated* rate, not an analyst consensus.',
  'note.dividendIndicatedUnavailable': 'No indicated rate and no price, so no forward yield can be derived.',
  'note.dividendPayoutNormalised': 'Payout ratio normalised from the provider\u2019s fraction/percent form.',
  'note.dividendPayableBeforeEx':
    'The announced payable date falls before its own ex-date, so it is withheld rather than shown.',
  'note.dividendAmountScaleUnreconciled':
    'This payment amount is published in a different unit from the series, so it is withheld rather than shown at the wrong scale.',
  'note.dividendPayoutUnitUnresolved': 'The payout ratio unit could not be resolved, so it is withheld rather than shown 100x wrong.',
  'note.dividendFiveYearPercentToFraction': 'The five-year average yield is published as a percent and converted to a fraction.',
  'note.dividendFrequencyDerived': 'Payment frequency is derived from the annual rate and the chart spacing, and the two agree.',
  'note.dividendFrequencyArithmeticOnly': 'Frequency derived from the annual rate only: the chart window is too short to cross-check.',
  'note.dividendFrequencySpacingOnly': 'Frequency inferred from chart payment spacing only: no last-dividend value was published.',
  'note.dividendFrequencyDisagree': 'The two frequency methods disagree, so no frequency is shown.',
  'note.dividendFrequencyUnknown': 'No annual rate and too few payments to infer a frequency.',
  'note.dividendGrowthUnavailable': 'Not enough complete years of payments to compute this growth figure.',
  'note.dividendSpecialExcluded': 'Years containing a special dividend were excluded from growth, or they would distort it.',
  'note.dividendShareholderFyEnd': 'Computed against market capitalisation at the fiscal-year-end, using shares and price at that date.',
  'note.dividendShareholderIncomplete': 'A component of shareholder yield is missing, so the total is withheld.',

  // ======================================================================
  // Phase 4 — the dividend workspace (SPEC-PHASE4 §C).
  //
  // Keyed under `div.` (the payload namespace is `dividend`), so the Phase 1–3
  // namespaces stay recognisable. The *basis* column is here on purpose: §A.3
  // requires the derivation to be visible, so "computed" and "normalised" are
  // user-facing copy rather than internal vocabulary.
  // ======================================================================

  // ---- shell -----------------------------------------------------------
  'nav.dividends': 'Dividends',
  'nav.dividends.hint': 'Yield, growth, payments & schedule',
  'div.title': 'Dividends',
  'div.subtitle': 'Dividend yield, growth, shareholder yield, payments and the payout schedule for {symbol}.',
  'div.recap.title': 'Dividend at a glance',
  'div.error.title': 'Could not load dividend details.',
  'div.empty': 'No dividend details to show yet.',
  'div.export.note': 'Dividend data exported from the Dividend screen. Missing figures appear as the dash character; see the source note in the screen.',
  'div.reason.notPublished': 'The provider does not publish this figure for the requested period.',

  // ---- shared table vocabulary ----------------------------------------
  'div.col.figure': 'Figure',
  'div.col.value': 'Value',
  'div.col.basis': 'Basis',
  'div.col.period': 'Period',
  'div.col.asOf': 'As of',
  'div.col.date': 'Date',
  'div.col.payment': 'Payment per share',
  'div.col.yield': 'Yield',
  'div.col.announced': 'Announced',
  'div.col.exDate': 'Ex-Date',
  'div.col.record': 'Record Date',
  'div.col.payable': 'Payable Date',
  'div.col.currency': 'Currency',
  'div.col.amount': 'Amount',
  'div.col.adjAmount': 'Adj. Amount',
  'div.col.frequency': 'Frequency',
  'div.col.type': 'Type',
  'div.tag.computed': 'computed',
  'div.tag.indicated': 'indicated',
  'div.basis.direct': 'As published',
  'div.basis.derived': 'Computed from the figures above',
  'div.basis.normalised': 'Unit-normalised',
  'div.basis.withheld': 'Withheld — the methods disagreed',

  // ---- §C.1 yield & frequency -----------------------------------------
  'div.s1.title': 'Dividend yield & frequency',
  'div.s1.sub': 'What the company pays, how often, and how that compares with its earnings.',
  'div.s1.note': 'Yields are shown as a percentage of today\u2019s price. The forward yield is the *indicated* rate — the annualised rate the company has declared — not an analyst consensus.',
  'div.f.currency': 'Currency',
  'div.f.indicated': 'Indicated yield',
  'div.f.trailing': 'Trailing yield (LTM)',
  'div.f.forward': 'Forward yield',
  'div.f.payout': 'Payout ratio (LTM)',
  'div.f.fiveYearAvg': 'Five-year average yield',
  'div.f.annualRate': 'Annual rate',
  'div.f.lastDividend': 'Last dividend (per share)',
  'div.f.nextEx': 'Next ex-date',
  'div.f.nextPay': 'Next payable date',
  'div.f.frequency': 'Payment frequency',
  'div.freq.annual': 'Annual',
  'div.freq.semi-annual': 'Semi-annual',
  'div.freq.quarterly': 'Quarterly',
  'div.freq.monthly': 'Monthly',
  'div.freq.semi-monthly': 'Semi-monthly',
  'div.freq.biweekly': 'Biweekly',
  'div.freq.weekly': 'Weekly',

  // ---- §C.2 growth -----------------------------------------------------
  'div.s2.title': 'Dividend growth',
  'div.s2.sub': 'How the annual payment has grown, measured on the yearly totals of the payment history.',
  'div.s2.note': 'Growth is computed from complete calendar years of payments only, so 1Y compares a full year against the full year before it.',
  'div.s2.special': 'Years containing a special dividend are excluded from the growth figures, or a one-off payment would distort a decade of growth.',
  'div.f.streak': 'Consecutive annual increases',
  'div.g.1y': 'Growth, 1Y',
  'div.g.3y': 'Growth, 3Y',
  'div.g.5y': 'Growth, 5Y',
  'div.g.10y': 'Growth, 10Y',

  // ---- §C.3 shareholder yield ------------------------------------------
  'div.s3.title': 'Shareholder yield',
  'div.s3.sub': 'Dividends plus buybacks plus net debt paydown, measured against market capitalisation at the fiscal year-end.',
  'div.s3.note': 'The debt leg keeps its sign: net debt issued is a negative contribution and is shown as such, not as a paydown.',
  'div.f.shTotal': 'Shareholder yield (total)',
  'div.f.shDividend': 'Dividends',
  'div.f.shBuyback': 'Buybacks',
  'div.f.shDebt': 'Net debt paydown',

  // ---- §C.4 payments & yield graph -------------------------------------
  'div.s4.title': 'Dividend yield & payments',
  'div.s4.sub': 'Payments per share as bars, yield over time as a line, on one shared scale.',
  'div.s4.payments': 'Payment per share',
  'div.s4.yield': 'Yield',
  'div.s4.empty': 'No payments in this period.',
  'div.s4.live': 'Yield line for {span}, as published by the provider.',
  'div.s4.reconstructed': 'Yield line for {span}. Points before April 2015 are reconstructed from payment history and price, and are labelled here rather than passed off as published data.',
  'div.span.aria': 'Dividend history span',
  'div.span.label': 'Span',
  'div.span.yearsNote': 'about {months} months of history',
  'div.span.allNote': 'all available history',

  // ---- §C.5 payout schedule --------------------------------------------
  'div.s5.title': 'Dividend payout schedule',
  'div.s5.sub': 'Every payment the provider carries. Announced, Record Date and Type are not published for any period and are always shown as a dash.',
  'div.s5.absent': 'Announced, Record Date and Type are not published by the provider, so these columns are intentionally blank rather than missing.',
  'div.s5.adj': 'Adj. Amount equals Amount: the payment history is already split-adjusted and the provider carries no separate figure.',
  'div.s5.payable': 'Payable Date is filled in only for the next payment, which is the one the provider announces in advance.',

  // ---- §C.6 consistency & export ---------------------------------------
  'div.s6.title': 'Consistency & export',
  'div.s6.sub': 'What this screen is showing, and the same data as a file.',
  'div.s6.currency': 'Per-share figures are denominated in the currency the dividend is actually paid in, taken from the price history — not from the financial statements, which can use a different currency.',
  'div.s6.absent': 'Every figure the provider does not publish is shown as a dash. A dash means the figure is not available; it never means zero.',
  'div.s6.export': 'The export contains exactly what is on this screen, including the dashes, plus the date it was taken.',
  'div.c6.span': 'Span shown',
  'div.c6.payments': 'Payments in span',
  'div.c6.yieldPoints': 'Yield points in span',
  'div.c6.reconstructed': 'Reconstructed yields',
  'div.c6.spansTitle': 'Spans available',
  'div.c6.yes': 'Yes',
  'div.c6.no': 'No',
};

