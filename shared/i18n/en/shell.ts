import type { Dict } from '../index';

/** Shell chrome: app frame, navigation, theme, sidebar, top bar, shared vocabulary, source/age badges and the help-screen glossary. */
export const shell: Dict = {
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
  // ---- categorisation --------------------------------------------------
  'cat.type.stock': 'Stock',
  'cat.type.etf': 'ETF',
  'cat.type.other': 'Other',
  'cat.unknown': 'Unknown',
  // ---- misc UI ---------------------------------------------------------
  'mover.onChart': 'on chart',
  'mover.openTitle': 'Open {symbol} on the chart',
  'mover.openLabel': 'Open {symbol} on the chart',
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
};
