import Database from 'better-sqlite3';
import type { Candle, Interval, SymbolMeta, WatchlistItem } from '../shared/types';

export type Db = Database.Database;

const SCHEMA = `
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

/** Maximum candles retained per (symbol, interval); oldest rows are pruned. */
const MAX_ROWS_PER_SERIES = 15000;

/** Additive migrations for databases created by an earlier build. */
function migrate(db: Db): void {
  const columns = (db.prepare('PRAGMA table_info(fetch_log)').all() as Array<{ name: string }>).map(
    (c) => c.name,
  );
  if (!columns.includes('range')) {
    db.exec('ALTER TABLE fetch_log ADD COLUMN range TEXT');
  }
}

export function openDb(path: string): Db {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

export interface FetchRecord {
  symbol: string;
  interval: Interval;
  lastUpdated: number;
  source: string;
  candleCount: number;
  /** The range string the cached data was pulled with (for coverage checks). */
  range: string | null;
}

/** Upsert candles. Existing timestamps are refreshed (Yahoo revises live bars). */
export function saveCandles(db: Db, symbol: string, interval: Interval, candles: Candle[]): number {
  if (candles.length === 0) return 0;
  const stmt = db.prepare(
    `INSERT INTO candles (symbol, interval, time, open, high, low, close, volume)
     VALUES (@symbol, @interval, @time, @open, @high, @low, @close, @volume)
     ON CONFLICT(symbol, interval, time) DO UPDATE SET
       open = excluded.open, high = excluded.high, low = excluded.low,
       close = excluded.close, volume = excluded.volume`,
  );
  const insertMany = db.transaction((rows: Candle[]) => {
    for (const row of rows) stmt.run({ symbol, interval, ...row });
    return rows.length;
  });
  const n = insertMany(candles);
  prune(db, symbol, interval);
  return n;
}

function prune(db: Db, symbol: string, interval: Interval): void {
  db.prepare(
    `DELETE FROM candles
     WHERE symbol = ? AND interval = ?
       AND time < (
         SELECT time FROM candles
         WHERE symbol = ? AND interval = ?
         ORDER BY time DESC
         LIMIT 1 OFFSET ?
       )`,
  ).run(symbol, interval, symbol, interval, MAX_ROWS_PER_SERIES);
}

export function getCandles(db: Db, symbol: string, interval: Interval): Candle[] {
  return db
    .prepare(
      `SELECT time, open, high, low, close, volume FROM candles
       WHERE symbol = ? AND interval = ? ORDER BY time ASC`,
    )
    .all(symbol, interval) as Candle[];
}

export function countCandles(db: Db, symbol: string, interval: Interval): number {
  const row = db
    .prepare('SELECT COUNT(*) AS n FROM candles WHERE symbol = ? AND interval = ?')
    .get(symbol, interval) as { n: number } | undefined;
  return row?.n ?? 0;
}

export function recordFetch(
  db: Db,
  symbol: string,
  interval: Interval,
  lastUpdated: number,
  source: string,
  candleCount: number,
  range: string | null = null,
  meta?: SymbolMeta,
): void {
  db.prepare(
    `INSERT INTO fetch_log (symbol, interval, last_updated, source, candle_count, range, meta_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(symbol, interval) DO UPDATE SET
       last_updated = excluded.last_updated,
       source = excluded.source,
       candle_count = excluded.candle_count,
       range = COALESCE(excluded.range, fetch_log.range),
       meta_json = COALESCE(excluded.meta_json, fetch_log.meta_json)`,
  ).run(
    symbol,
    interval,
    lastUpdated,
    source,
    candleCount,
    range,
    meta ? JSON.stringify(meta) : null,
  );
}

export function getFetchRecord(db: Db, symbol: string, interval: Interval): FetchRecord | null {
  const row = db
    .prepare(
      'SELECT symbol, interval, last_updated, source, candle_count, range FROM fetch_log WHERE symbol = ? AND interval = ?',
    )
    .get(symbol, interval) as
    | {
        symbol: string;
        interval: string;
        last_updated: number;
        source: string;
        candle_count: number;
        range: string | null;
      }
    | undefined;
  if (!row) return null;
  return {
    symbol: row.symbol,
    interval: row.interval as Interval,
    lastUpdated: row.last_updated,
    source: row.source,
    candleCount: row.candle_count,
    range: row.range,
  };
}

export function saveMeta(db: Db, meta: SymbolMeta, now: number): void {
  db.prepare(
    `INSERT INTO meta_cache (symbol, meta_json, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(symbol) DO UPDATE SET meta_json = excluded.meta_json, updated_at = excluded.updated_at`,
  ).run(meta.symbol, JSON.stringify(meta), now);
}

export function getMeta(db: Db, symbol: string): SymbolMeta | null {
  const row = db.prepare('SELECT meta_json FROM meta_cache WHERE symbol = ?').get(symbol) as
    | { meta_json: string }
    | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.meta_json) as SymbolMeta;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Watchlist
// ---------------------------------------------------------------------------

export function listWatchlist(db: Db): WatchlistItem[] {
  return db
    .prepare('SELECT symbol, name, position, added_at FROM watchlist ORDER BY position ASC, symbol ASC')
    .all() as WatchlistItem[];
}

export function addWatch(db: Db, symbol: string, name: string | null, now: number): WatchlistItem {
  const existing = db.prepare('SELECT symbol FROM watchlist WHERE symbol = ?').get(symbol);
  if (!existing) {
    const max = db.prepare('SELECT COALESCE(MAX(position), -1) AS m FROM watchlist').get() as { m: number };
    db.prepare('INSERT INTO watchlist (symbol, name, position, added_at) VALUES (?, ?, ?, ?)').run(
      symbol,
      name,
      max.m + 1,
      now,
    );
  } else if (name) {
    db.prepare('UPDATE watchlist SET name = ? WHERE symbol = ?').run(name, symbol);
  }
  return listWatchlist(db).find((w) => w.symbol === symbol)!;
}

export function removeWatch(db: Db, symbol: string): boolean {
  const info = db.prepare('DELETE FROM watchlist WHERE symbol = ?').run(symbol);
  const rows = listWatchlist(db);
  const reorder = db.prepare('UPDATE watchlist SET position = ? WHERE symbol = ?');
  const tx = db.transaction(() => rows.forEach((r, i) => reorder.run(i, r.symbol)));
  tx();
  return info.changes > 0;
}

/** Persist a new explicit order. Unknown symbols are ignored. */
export function reorderWatchlist(db: Db, symbols: string[]): WatchlistItem[] {
  const update = db.prepare('UPDATE watchlist SET position = ? WHERE symbol = ?');
  const tx = db.transaction(() => symbols.forEach((s, i) => update.run(i, s)));
  tx();
  return listWatchlist(db);
}

// ---------------------------------------------------------------------------
// Generic keyed cache (Phase 2: fundamentals, news, classifications)
// ---------------------------------------------------------------------------

export interface KvRecord<T> {
  payload: T;
  updatedAt: number;
}

/**
 * Read a cached payload. Corrupt JSON is treated as a miss rather than crashing
 * the request — a cache is an optimisation, never a source of truth.
 */
export function getKv<T>(db: Db, key: string): KvRecord<T> | null {
  const row = db.prepare('SELECT payload, updated_at FROM kv_cache WHERE key = ?').get(key) as
    | { payload: string; updated_at: number }
    | undefined;
  if (!row) return null;
  try {
    return { payload: JSON.parse(row.payload) as T, updatedAt: row.updated_at };
  } catch {
    return null;
  }
}

export function setKv<T>(db: Db, key: string, payload: T, now: number): void {
  db.prepare(
    `INSERT INTO kv_cache (key, payload, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at`,
  ).run(key, JSON.stringify(payload), now);
}

/** Seed a first-run watchlist so the dashboard is never empty. */
export function seedWatchlistIfEmpty(db: Db, now: number): void {
  const count = db.prepare('SELECT COUNT(*) AS n FROM watchlist').get() as { n: number };
  if (count.n > 0) return;
  const seeds: Array<[string, string]> = [
    ['AAPL', 'Apple Inc.'],
    ['MSFT', 'Microsoft Corporation'],
    ['NVDA', 'NVIDIA Corporation'],
    ['SPY', 'SPDR S&P 500 ETF Trust'],
  ];
  const insert = db.prepare('INSERT OR IGNORE INTO watchlist (symbol, name, position, added_at) VALUES (?, ?, ?, ?)');
  const tx = db.transaction(() => seeds.forEach(([s, n], i) => insert.run(s, n, i, now)));
  tx();
}
