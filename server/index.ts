import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp, bootstrap, DIST_DIR } from './app';
import { openDb } from './db';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? '127.0.0.1';
const DB_PATH = process.env.DB_PATH ?? path.join(ROOT, 'data', 'stock.db');

mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = openDb(DB_PATH);
bootstrap(db);

const app = createApp(db);

const server = app.listen(PORT, HOST, () => {
  const servingStatic = process.env.NODE_ENV === 'production' || DIST_DIR.length > 0;
  console.log(`[stock-coach] API listening on http://${HOST}:${PORT}`);
  console.log(`[stock-coach] SQLite cache: ${DB_PATH}`);
  if (servingStatic) console.log(`[stock-coach] serving built assets from: ${DIST_DIR}`);
});

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[stock-coach] Port ${PORT} is already in use. Set PORT to another value and retry.`);
  } else {
    console.error('[stock-coach] server error:', err);
  }
  process.exitCode = 1;
});

function shutdown(signal: string): void {
  console.log(`[stock-coach] ${signal} received, shutting down.`);
  server.close(() => {
    try {
      db.close();
    } catch {
      /* already closed */
    }
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
