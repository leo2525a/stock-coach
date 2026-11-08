import { YAHOO_USER_AGENT } from './market-service';

/**
 * Yahoo session (cookie + crumb) manager — SPEC-PHASE2 §G.
 *
 * The `quoteSummary` endpoint answers `{"code":"Unauthorized","description":
 * "Invalid Crumb"}` unless the request carries a session cookie *and* a crumb
 * minted from that cookie. We keep one session in memory and refresh it when it
 * goes stale or when the provider rejects it, because minting a crumb on every
 * request would double the upstream traffic for no benefit.
 *
 * Header policy: the short `Mozilla/5.0` token is the one the live endpoint
 * accepts (a verbose browser UA gets HTTP 429 — verified in market-service.ts).
 */

const CRUMB_URL = 'https://query1.finance.yahoo.com/v1/test/getcrumb';
const PRIME_URL = 'https://fc.yahoo.com/';
const HOST = 'https://query1.finance.yahoo.com';

/** A crumb is a short opaque token; anything else is a rate-limit/HTML page. */
const CRUMB_RE = /^[A-Za-z0-9._~-]{4,64}$/;

/** Refresh proactively after this long; reactively on an explicit rejection. */
const SESSION_TTL_MS = 30 * 60 * 1000;

const REQUEST_TIMEOUT_MS = 12_000;
const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 600;

export interface Session {
  crumb: string;
  cookies: string[];
  fetchedAt: number;
}

let session: Session | null = null;

/** Reset the in-memory session (tests, and after a hard auth failure). */
export function resetSession(): void {
  session = null;
}

/** Only the `name=value` pairs belong in the request `Cookie` header. */
export function cookieHeader(cookies: readonly string[]): string {
  return cookies.map((c) => c.split(';')[0].trim()).filter(Boolean).join('; ');
}

/** Pull `Set-Cookie` values off a response, tolerating both header APIs. */
export function absorbCookies(res: Response): string[] {
  const h = res.headers as Headers & { getSetCookie?: () => string[] };
  if (typeof h.getSetCookie === 'function') return h.getSetCookie();
  const single = res.headers.get('set-cookie');
  return single ? [single] : [];
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** A GET that retries transient 429/5xx, returning null instead of throwing. */
export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  fetchImpl: typeof fetch = fetch,
): Promise<Response | null> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetchImpl(url, { ...init, signal: controller.signal });
      if (res.ok) return res;
      if (res.status !== 429 && res.status < 500) return res;
    } catch {
      /* fall through to backoff */
    } finally {
      clearTimeout(timer);
    }
    if (attempt < MAX_ATTEMPTS) await sleep(BASE_BACKOFF_MS * 2 ** (attempt - 1));
  }
  return null;
}

/**
 * Mint a fresh session: visit the consent host to collect cookies, then ask for
 * a crumb with those cookies. Returns null if the provider will not cooperate —
 * the caller then serves cache or an honest "unavailable", never invented data.
 */
export async function mintSession(fetchImpl: typeof fetch = fetch): Promise<Session | null> {
  const cookies: string[] = [];

  // Step 1: any response from the consent host sets the session cookie. It is
  // a 404 by design; the cookie is the point, not the body. Routed through
  // `fetchWithRetry` because a cold connection to this host intermittently
  // drops the response, and one transient miss would otherwise degrade every
  // fundamentals panel to "unavailable" until the process restarts.
  try {
    const res = await fetchWithRetry(PRIME_URL, { headers: { 'User-Agent': YAHOO_USER_AGENT }, redirect: 'manual' }, fetchImpl);
    if (res) cookies.push(...absorbCookies(res));
  } catch {
    return null;
  }
  if (cookies.length === 0) return null;

  // Step 2: exchange the cookie for a crumb.
  const res = await fetchWithRetry(
    CRUMB_URL,
    { headers: { 'User-Agent': YAHOO_USER_AGENT, Cookie: cookieHeader(cookies) } },
    fetchImpl,
  );
  if (!res) return null;
  const cookieFromCrumb = absorbCookies(res);
  cookies.push(...cookieFromCrumb);
  const crumb = (await res.text()).trim();
  if (!CRUMB_RE.test(crumb)) return null;

  session = { crumb, cookies, fetchedAt: Date.now() };
  return session;
}

/** The current session, minting one if absent or past its TTL. */
export async function getSession(
  fetchImpl: typeof fetch = fetch,
  opts: { force?: boolean } = {},
): Promise<Session | null> {
  const stale = session === null || Date.now() - session.fetchedAt > SESSION_TTL_MS;
  if (opts.force || stale) return mintSession(fetchImpl);
  return session;
}

export interface ProviderJson {
  json: unknown;
  status: number;
  session: Session;
}

/**
 * Call a crumb-authenticated `query1.finance.yahoo.com` JSON endpoint.
 *
 * On a crumb rejection the session is re-minted and the call retried **once**;
 * a second rejection is reported as-is rather than looped on, because a loop of
 * auth failures looks exactly like an attack to the provider.
 */
export async function fetchProviderJson(
  pathAndQuery: string,
  opts: { fetchImpl?: typeof fetch; forceNewSession?: boolean } = {},
): Promise<ProviderJson | null> {
  const fetchImpl = opts.fetchImpl ?? fetch;

  for (let round = 0; round < 2; round += 1) {
    const s = await getSession(fetchImpl, { force: round > 0 || opts.forceNewSession });
    if (!s) return null;
    const sep = pathAndQuery.includes('?') ? '&' : '?';
    const url = `${HOST}${pathAndQuery}${sep}crumb=${encodeURIComponent(s.crumb)}`;
    const res = await fetchWithRetry(
      url,
      {
        headers: {
          'User-Agent': YAHOO_USER_AGENT,
          Accept: 'application/json',
          Cookie: cookieHeader(s.cookies),
        },
      },
      fetchImpl,
    );
    if (!res) return null;

    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      return null;
    }
    if (isCrumbRejection(json)) continue; // re-mint and retry once
    return { json, status: res.status, session: s };
  }
  return null;
}

const QUERY2_HOST = 'https://query2.finance.yahoo.com';

/**
 * Call a **crumb-free** `query2` endpoint (SPEC-PHASE3 §A.1).
 *
 * `fundamentals-timeseries` and the chart endpoint answer to a plain request
 * with the short User-Agent — no cookie, no crumb (RECON-PHASE3 §2, §3). That is
 * why the statement layer never touches `getSession()`: a crumb outage (which
 * happens, and is exactly why Phase 2 has a stale-cache path) must not be able
 * to blank out the balance sheet.
 *
 * Returns null on any failure — the caller serves cache or an honest empty.
 */
export async function fetchQuery2Json(
  pathAndQuery: string,
  opts: { fetchImpl?: typeof fetch; absolute?: boolean } = {},
): Promise<unknown | null> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const url = opts.absolute ? pathAndQuery : `${QUERY2_HOST}${pathAndQuery}`;
  const res = await fetchWithRetry(
    url,
    { headers: { 'User-Agent': YAHOO_USER_AGENT, Accept: 'application/json' } },
    fetchImpl,
  );
  if (!res) return null;
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/** Did the provider answer with its "wrong/expired crumb" envelope? */
export function isCrumbRejection(json: unknown): boolean {
  const root = json as { finance?: { error?: { code?: unknown; description?: unknown } }; quoteSummary?: { error?: { code?: unknown; description?: unknown } } } | null;
  const err = root?.quoteSummary?.error ?? root?.finance?.error;
  if (!err) return false;
  const code = String(err.code ?? '');
  const desc = String(err.description ?? '');
  return /unauthor/i.test(code) || /crumb/i.test(desc) || /unauthor/i.test(desc);
}

/** URL for the fundamentals call (module list kept in one place). */
export const QUOTE_SUMMARY_MODULES = [
  'assetProfile',
  'summaryDetail',
  'defaultKeyStatistics',
  'financialData',
  'price',
].join(',');

export function quoteSummaryPath(symbol: string): string {
  return `/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=${QUOTE_SUMMARY_MODULES}`;
}

/**
 * Phase 3 module set (SPEC-PHASE3 §A.1).
 *
 * Deliberately separate from `QUOTE_SUMMARY_MODULES`: the Phase 2 fundamentals
 * call is the app's hottest path and `upgradeDowngradeHistory` alone is ~185 kB
 * for a mega-cap (RECON-PHASE3 §1). Fetching them together would make every
 * dashboard paint pay for data only the analyst screens need.
 */
export const ANALYST_MODULES = [
  'financialData',
  'defaultKeyStatistics',
  'summaryDetail',
  'earningsTrend',
  'recommendationTrend',
  'upgradeDowngradeHistory',
  'calendarEvents',
  'earningsHistory',
  'price',
  'assetProfile',
].join(',');

export function analystSummaryPath(symbol: string): string {
  return `/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=${ANALYST_MODULES}`;
}

/**
 * The `fundamentals-timeseries` path (SPEC-PHASE3 §A.1).
 *
 * This lives on **`query2`**, which does *not* require a crumb — the binding
 * observation of RECON-PHASE3 §2. `types` is a comma-separated list of the
 * provider series names; every series is prefixed with the period we want
 * (`annual` / `quarterly` / `trailing`).
 */
export function timeseriesPath(symbol: string, typeNames: readonly string[], period1: number, period2: number): string {
  const type = typeNames.join(',');
  const params = new URLSearchParams({
    symbol,
    type,
    period1: String(period1),
    period2: String(period2),
  });
  return `/ws/fundamentals-timeseries/v1/finance/timeseries/${encodeURIComponent(symbol)}?${params.toString()}`;
}

export function searchPath(query: string, newsCount: number, quotesCount: number): string {
  const params = new URLSearchParams({
    q: query,
    quotesCount: String(quotesCount),
    newsCount: String(newsCount),
  });
  return `/v1/finance/search?${params.toString()}`;
}
