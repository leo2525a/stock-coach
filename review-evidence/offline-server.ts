/**
 * REVIEWER evidence harness — an API server whose upstream (Yahoo) always fails.
 *
 * It serves the REAL production build from dist/ and the REAL Express app, but
 * patches global fetch so any request to finance.yahoo.com throws. That lets us
 * drive the UI into the increasingly-common "provider is down" state and check
 * SPEC §7: last cached data + a clear stale badge, never a blank chart and never
 * an invented price.
 *
 * Not part of the deliverable; reviewer evidence only.
 */
import { createApp, bootstrap, DIST_DIR } from '../server/app';
import { openDb } from '../server/db';

const realFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = (async (input: any, init?: any) => {
  const url =
    typeof input === 'string' ? input : input instanceof URL ? input.toString() : String(input?.url ?? '');
  if (url.includes('finance.yahoo.com')) {
    throw new Error('reviewer: simulated data-provider outage');
  }
  return realFetch(input, init);
}) as typeof fetch;

const PORT = Number(process.env.PORT ?? 8799);
const HOST = process.env.HOST ?? '127.0.0.1';
const DB_PATH = process.env.DB_PATH!;

const db = openDb(DB_PATH);
bootstrap(db);
createApp(db).listen(PORT, HOST, () => {
  console.log(`[offline-server] listening on http://${HOST}:${PORT} (dist: ${DIST_DIR})`);
});
