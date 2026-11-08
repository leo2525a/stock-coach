import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  ApiResult,
  CategoryMap,
  EstimatesPayload,
  FxPayload,
  FundamentalsPayload,
  MarketData,
  NewsPayload,
  QuoteOverview,
  RatingsFullPayload,
  SignalsPayload,
  StatementsPayload,
  StatementPeriod,
  WatchQuote,
} from '../shared/types';
import { evaluateSignals, summarize, requiredCandles } from '../shared/signals';
import { computeIndicators } from '../shared/indicators';
import { isValidSymbol, normalizeSymbol } from '../shared/format';
import { loadMarketData, loadSeries, MarketDataError, YAHOO_USER_AGENT } from './market-service';
import { loadCategories, loadFundamentals, loadNews } from './phase2-service';
import {
  loadEstimates,
  loadFx,
  loadQuoteOverview,
  loadRatings,
  loadStatements,
} from './phase3-service';
import { loadDividendHistory, loadDividends } from './dividends-service';
import { DIVIDEND_SPANS } from '../shared/dividends';
import {
  addWatch,
  getMeta,
  listWatchlist,
  removeWatch,
  reorderWatchlist,
  seedWatchlistIfEmpty,
  type Db,
} from './db';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.resolve(__dirname, '..', 'dist');

function ok<T>(data: T): ApiResult<T> {
  return { ok: true, data };
}
function fail(error: string, code?: string): ApiResult<never> {
  return { ok: false, error, code };
}

export function createApp(db: Db): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '128kb' }));

  // Local-only API: permissive CORS keeps the Vite dev origin simple.
  app.use('/api', (_req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    next();
  });
  app.options(/^\/api\/.*/, (_req, res) => res.sendStatus(204));

  const health = (_req: Request, res: Response) => {
    res.json(ok({ status: 'ok', time: Math.floor(Date.now() / 1000), service: 'stock-coach-api' }));
  };
  app.get('/api/health', health);
  app.get('/healthz', health);

  // --- market data ---------------------------------------------------------
  app.get('/api/market/:symbol', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const symbol = normalizeSymbol(String(req.params.symbol ?? ''));
      if (!isValidSymbol(symbol)) {
        res.status(400).json(fail(`"${symbol}" is not a valid ticker symbol.`, 'BAD_SYMBOL'));
        return;
      }
      const force = req.query.force === '1' || req.query.force === 'true';
      const data: MarketData = await loadMarketData(db, symbol, {
        range: typeof req.query.range === 'string' ? req.query.range : null,
        interval: typeof req.query.interval === 'string' ? req.query.interval : null,
        force,
      });
      res.json(ok(data));
    } catch (err) {
      next(err);
    }
  });

  // --- signals -------------------------------------------------------------
  app.get('/api/signals/:symbol', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const symbol = normalizeSymbol(String(req.params.symbol ?? ''));
      if (!isValidSymbol(symbol)) {
        res.status(400).json(fail(`"${symbol}" is not a valid ticker symbol.`, 'BAD_SYMBOL'));
        return;
      }
      // Signals want the deepest history available, so use a long daily view and
      // refuse to score off a shallow cache (see LoadOptions.minCandles).
      const series = await loadSeries(db, symbol, {
        range: 'max',
        interval: '1d',
        minCandles: requiredCandles(),
      });
      const signals = evaluateSignals({
        candles: series.candles,
        indicators: computeIndicators(series.candles),
      });
      const payload: SignalsPayload = {
        symbol: series.symbol,
        interval: series.interval,
        range: series.range,
        signals,
        summary: summarize(signals),
        meta: series.meta,
        source: series.source,
        lastUpdated: series.lastUpdated,
        note: series.note,
        candleCount: series.candles.length,
      };
      res.json(ok(payload));
    } catch (err) {
      next(err);
    }
  });

  // --- Phase 2: fundamentals, news, categorisation -------------------------
  const requireSymbol = (raw: unknown): string | null => {
    const symbol = normalizeSymbol(String(raw ?? ''));
    return isValidSymbol(symbol) ? symbol : null;
  };

  app.get('/api/fundamentals/:symbol', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const symbol = requireSymbol(req.params.symbol);
      if (!symbol) {
        res.status(400).json(fail(`"${req.params.symbol}" is not a valid ticker symbol.`, 'BAD_SYMBOL'));
        return;
      }
      const payload: FundamentalsPayload = await loadFundamentals(db, symbol, {
        force: req.query.force === '1' || req.query.force === 'true',
      });
      res.json(ok(payload));
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/news/:symbol', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const symbol = requireSymbol(req.params.symbol);
      if (!symbol) {
        res.status(400).json(fail(`"${req.params.symbol}" is not a valid ticker symbol.`, 'BAD_SYMBOL'));
        return;
      }
      const payload: NewsPayload = await loadNews(db, symbol, {
        force: req.query.force === '1' || req.query.force === 'true',
      });
      res.json(ok(payload));
    } catch (err) {
      next(err);
    }
  });

  /**
   * Classification for a comma-separated symbol list. Defaults to the whole
   * watchlist — which is exactly what the grouping UI needs on first paint.
   */
  app.get('/api/categories', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const raw = typeof req.query.symbols === 'string' ? req.query.symbols : '';
      const requested = raw
        .split(',')
        .map((s) => normalizeSymbol(s))
        .filter((s) => isValidSymbol(s));
      const symbols = requested.length ? requested : listWatchlist(db).map((w) => w.symbol);
      const map: CategoryMap = await loadCategories(db, symbols, {
        force: req.query.force === '1' || req.query.force === 'true',
      });
      res.json(ok(map));
    } catch (err) {
      next(err);
    }
  });

  // --- Phase 3: statements, estimates, ratings, quotes, FX -----------------
  // Same shape as the Phase 2 routes: validate the symbol, hand off to the
  // service, return the `ApiResult` envelope. All four are cached and all four
  // answer with an honest empty payload (never a fabricated number) when the
  // provider cannot be reached and there is nothing cached.
  const forceish = (req: Request) => req.query.force === '1' || req.query.force === 'true';

  const STATEMENT_PERIODS: readonly StatementPeriod[] = ['annual', 'quarterly', 'ltm'];

  app.get('/api/statements/:symbol', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const symbol = requireSymbol(req.params.symbol);
      if (!symbol) {
        res.status(400).json(fail(`"${req.params.symbol}" is not a valid ticker symbol.`, 'BAD_SYMBOL'));
        return;
      }
      const raw = typeof req.query.period === 'string' ? req.query.period.toLowerCase() : 'annual';
      // An unknown period is a client bug, not a silently-defaulted request: a
      // typo must not look like "annual".
      if (!(STATEMENT_PERIODS as readonly string[]).includes(raw)) {
        res.status(400).json(fail(`period must be one of ${STATEMENT_PERIODS.join('|')}.`, 'BAD_REQUEST'));
        return;
      }
      const payload: StatementsPayload = await loadStatements(db, symbol, raw as StatementPeriod, {
        force: forceish(req),
      });
      res.json(ok(payload));
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/estimates/:symbol', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const symbol = requireSymbol(req.params.symbol);
      if (!symbol) {
        res.status(400).json(fail(`"${req.params.symbol}" is not a valid ticker symbol.`, 'BAD_SYMBOL'));
        return;
      }
      const payload: EstimatesPayload = await loadEstimates(db, symbol, { force: forceish(req) });
      res.json(ok(payload));
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/ratings/:symbol', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const symbol = requireSymbol(req.params.symbol);
      if (!symbol) {
        res.status(400).json(fail(`"${req.params.symbol}" is not a valid ticker symbol.`, 'BAD_SYMBOL'));
        return;
      }
      const payload: RatingsFullPayload = await loadRatings(db, symbol, { force: forceish(req) });
      res.json(ok(payload));
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/quotes/:symbol', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const symbol = requireSymbol(req.params.symbol);
      if (!symbol) {
        res.status(400).json(fail(`"${req.params.symbol}" is not a valid ticker symbol.`, 'BAD_SYMBOL'));
        return;
      }
      const payload: QuoteOverview = await loadQuoteOverview(db, symbol, { force: forceish(req) });
      res.json(ok(payload));
    } catch (err) {
      next(err);
    }
  });

  /**
   * USD cross-rates for the display-currency switch (SPEC-PHASE3 §A.4).
   * `to` is a comma-separated list of target codes; unknown codes are ignored
   * rather than guessed at.
   */
  app.get('/api/fx', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const raw = typeof req.query.to === 'string' ? req.query.to : '';
      const targets = raw.split(',').map((s) => s.trim()).filter(Boolean);
      const payload: FxPayload = await loadFx(db, targets, { force: forceish(req) });
      res.json(ok(payload));
    } catch (err) {
      next(err);
    }
  });

  /**
   * Phase 4 — dividends (SPEC-PHASE4 §A.1).
   *
   * Two routes with one shape: validate the symbol, hand off to the service,
   * return the `ApiResult` envelope. Both keep the Phase 1–3 honesty contract —
   * every unavailable figure is `null` (rendered `—`), and no cookie or crumb is
   * ever echoed into the body or the headers.
   */
  app.get('/api/dividends/:symbol', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const symbol = requireSymbol(req.params.symbol);
      if (!symbol) {
        res.status(400).json(fail(`"${req.params.symbol}" is not a valid ticker symbol.`, 'BAD_SYMBOL'));
        return;
      }
      const payload = await loadDividends(db, symbol, { force: forceish(req) });
      res.json(ok(payload));
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/dividends/:symbol/history', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const symbol = requireSymbol(req.params.symbol);
      if (!symbol) {
        res.status(400).json(fail(`"${req.params.symbol}" is not a valid ticker symbol.`, 'BAD_SYMBOL'));
        return;
      }
      const rawSpan = typeof req.query.span === 'string' ? req.query.span : '5y';
      // `spanWindow` treats the sentinel case-insensitively, so `all` and `ALL`
      // must both normalise to the one canonical label — otherwise the deepest
      // (and most useful) span is the single one the route refuses.
      const span = DIVIDEND_SPANS.find((s) => s.toLowerCase() === rawSpan.toLowerCase());
      // An unknown span is a client bug, not a silently-defaulted request: a
      // typo must not quietly answer a different range than the one asked for.
      if (!span) {
        res.status(400).json(fail(`span must be one of ${DIVIDEND_SPANS.join('|')}.`, 'BAD_REQUEST'));
        return;
      }
      const payload = await loadDividendHistory(db, symbol, span, { force: forceish(req) });
      res.json(ok(payload));
    } catch (err) {
      next(err);
    }
  });

  // --- symbol search -------------------------------------------------------
  app.get('/api/search', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const q = String(req.query.q ?? '').trim();
      if (!q) {
        res.json(ok([]));
        return;
      }
      const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=10&newsCount=0`;
      const res2 = await fetch(url, {
        headers: { 'User-Agent': YAHOO_USER_AGENT, Accept: 'application/json' },
      });
      if (!res2.ok) {
        res.json(ok([]));
        return;
      }
      const json = (await res2.json()) as { quotes?: Array<Record<string, unknown>> };
      const results = (json.quotes ?? [])
        .filter((x) => x.quoteType === 'EQUITY' || x.quoteType === 'ETF')
        .map((x) => ({
          symbol: String(x.symbol ?? ''),
          name: String(x.longname ?? x.shortname ?? x.symbol ?? ''),
          exchange: String(x.exchDisp ?? x.exchange ?? ''),
          type: String(x.typeDisp ?? x.quoteType ?? ''),
          // Phase 2: the categoriser needs the raw provider taxonomy.
          quoteType: x.quoteType === undefined ? undefined : String(x.quoteType),
          sector: x.sector === undefined || x.sector === null ? null : String(x.sector),
          industry: x.industry === undefined || x.industry === null ? null : String(x.industry),
        }))
        .filter((x) => x.symbol);
      res.json(ok(results));
    } catch (err) {
      next(err);
    }
  });

  // --- watchlist -----------------------------------------------------------
  app.get('/api/watchlist', (_req: Request, res: Response) => {
    res.json(ok(listWatchlist(db)));
  });

  app.post('/api/watchlist', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = (req.body ?? {}) as { symbol?: unknown; name?: unknown };
      const symbol = normalizeSymbol(String(body.symbol ?? ''));
      if (!isValidSymbol(symbol)) {
        res.status(400).json(fail(`"${symbol}" is not a valid ticker symbol.`, 'BAD_SYMBOL'));
        return;
      }
      let name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : null;
      if (!name) {
        // Verify the ticker exists and learn its proper name at the same time.
        try {
          const s = await loadSeries(db, symbol, { range: '5d', interval: '1d' });
          name = s.meta.name;
        } catch {
          res.status(404).json(fail(`Could not find a stock or ETF with the symbol "${symbol}".`, 'NOT_FOUND'));
          return;
        }
      }
      const item = addWatch(db, symbol, name, Math.floor(Date.now() / 1000));
      res.json(ok(item));
    } catch (err) {
      next(err);
    }
  });

  app.delete('/api/watchlist/:symbol', (req: Request, res: Response) => {
    const symbol = normalizeSymbol(String(req.params.symbol ?? ''));
    const removed = removeWatch(db, symbol);
    if (!removed) {
      res.status(404).json(fail(`"${symbol}" is not in the watchlist.`, 'NOT_FOUND'));
      return;
    }
    res.json(ok({ symbol, removed: true }));
  });

  app.post('/api/watchlist/reorder', (req: Request, res: Response) => {
    const body = (req.body ?? {}) as { symbols?: unknown };
    if (!Array.isArray(body.symbols) || !body.symbols.every((s) => typeof s === 'string')) {
      res.status(400).json(fail('Body must be { symbols: string[] }.', 'BAD_REQUEST'));
      return;
    }
    res.json(ok(reorderWatchlist(db, (body.symbols as string[]).map(normalizeSymbol))));
  });

  /** One request for every watchlist row's price — powers the dashboard strip. */
  app.get('/api/watchlist/quotes', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const items = listWatchlist(db);
      const now = Math.floor(Date.now() / 1000);
      const quotes: WatchQuote[] = [];
      const CONCURRENCY = 4;
      for (let i = 0; i < items.length; i += CONCURRENCY) {
        const chunk = items.slice(i, i + CONCURRENCY);
        const settled = await Promise.all(
          chunk.map(async (item) => {
            try {
              const s = await loadSeries(db, item.symbol, { range: '5d', interval: '1d' });
              return {
                symbol: s.symbol,
                name: item.name ?? s.meta.name,
                lastPrice: s.meta.lastPrice,
                change: s.meta.change,
                changePercent: s.meta.changePercent,
                currency: s.meta.currency,
                source: s.source,
                stale: s.source === 'stale-cache',
                lastUpdated: s.lastUpdated,
              } satisfies WatchQuote;
            } catch {
              // A single bad symbol must not blank the whole strip.
              const cached = getMeta(db, item.symbol);
              return {
                symbol: item.symbol,
                name: item.name ?? item.symbol,
                lastPrice: cached?.lastPrice ?? null,
                change: cached?.change ?? null,
                changePercent: cached?.changePercent ?? null,
                currency: cached?.currency ?? 'USD',
                source: 'unavailable',
                stale: true,
                lastUpdated: null,
              } satisfies WatchQuote;
            }
          }),
        );
        quotes.push(...settled);
      }
      void now;
      res.json(ok(quotes));
    } catch (err) {
      next(err);
    }
  });

  // --- static build (single-origin production/preview) ---------------------
  if (existsSync(DIST_DIR)) {
    app.use(express.static(DIST_DIR, { index: false, maxAge: '1h' }));
    app.use((req: Request, res: Response, next: NextFunction) => {
      if (req.method !== 'GET' || req.path.startsWith('/api')) {
        next();
        return;
      }
      // Send the SPA shell by *root-relative* name, never by absolute path.
      //
      // `res.sendFile('/abs/path/index.html')` routes the path through `send`,
      // which rejects any dotted path segment as a dotfile (404). That would
      // silently break the entire app whenever the install directory contains a
      // dot — and this project lives under ~/.openclaw/... Passing `root` keeps
      // the absolute directory out of that check, and is the documented form.
      res.sendFile('index.html', { root: DIST_DIR }, (err) => {
        if (err) next(err);
      });
    });
  }

  // --- errors --------------------------------------------------------------
  app.use((_req: Request, res: Response) => {
    res.status(404).json(fail('Not found.', 'NOT_FOUND'));
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const isMd = err instanceof MarketDataError;
    const code = isMd ? err.code : 'INTERNAL_ERROR';
    const message = err instanceof Error ? err.message : 'Unexpected server error.';
    // A body parser / static layer error already carries the right HTTP status;
    // honour it rather than mislabelling every non-upstream failure as a 502.
    const explicit = (err as { status?: unknown })?.status;
    const explicitStatus = typeof explicit === 'number' && explicit >= 400 && explicit < 600 ? explicit : null;
    const status = isMd
      ? code === 'NOT_FOUND'
        ? 404
        : code === 'BAD_REQUEST' || code === 'BAD_SYMBOL'
          ? 400
          : 502
      : (explicitStatus ?? 500);
    if (!isMd) console.error('[api] unhandled error:', err);
    res.status(status).json(fail(message, code));
  });

  return app;
}

/** First-run convenience: seed a starter watchlist. */
export function bootstrap(db: Db): void {
  seedWatchlistIfEmpty(db, Math.floor(Date.now() / 1000));
}

export { DIST_DIR };
