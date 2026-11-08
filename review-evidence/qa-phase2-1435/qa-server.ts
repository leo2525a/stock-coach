/**
 * QA (reviewer-owned) server launcher — real production app, throwaway SQLite.
 * Independent of the build's scripts and of review-evidence/live-server.ts.
 */
import { createApp, bootstrap, DIST_DIR } from '../../server/app';
import { openDb } from '../../server/db';

const PORT = Number(process.env.PORT ?? 8797);
const HOST = process.env.HOST ?? '127.0.0.1';
const DB_PATH = process.env.DB_PATH!;
const db = openDb(DB_PATH);
bootstrap(db);
createApp(db).listen(PORT, HOST, () => {
  console.log(`[qa-server] http://${HOST}:${PORT} dist=${DIST_DIR}`);
});
