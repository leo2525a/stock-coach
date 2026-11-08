/**
 * REVIEWER evidence harness — the real production app on a throwaway SQLite DB.
 * Not part of the deliverable; reviewer evidence only.
 */
import { createApp, bootstrap, DIST_DIR } from '../server/app';
import { openDb } from '../server/db';

const PORT = Number(process.env.PORT ?? 8798);
const HOST = process.env.HOST ?? '127.0.0.1';
const DB_PATH = process.env.DB_PATH!;

const db = openDb(DB_PATH);
bootstrap(db);
createApp(db).listen(PORT, HOST, () => {
  console.log(`[live-server] listening on http://${HOST}:${PORT} (dist: ${DIST_DIR})`);
});
