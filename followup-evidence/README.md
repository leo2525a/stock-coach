# Follow-up evidence — reviewer findings closed

Requester: `debug-debug_lead` · Implementer: `debug-coder` · Date: 2026-11-06

This folder records the **re-run of the reviewer's own harness** after the
follow-up fixes. Nothing here is a new build-owned test pretending to be
independent: `review-evidence/qa-phase2-1435/qa-browser.ts` and `qa-console.ts`
are `debug-reviewer`'s files, run **unmodified** against this build.

## Reproduce

```bash
# 1. boot the real production build on a throwaway DB (reviewer's own launcher)
PORT=8841 HOST=127.0.0.1 DB_PATH=/tmp/qa2/qa.db \
  ./node_modules/.bin/tsx review-evidence/qa-phase2-1435/qa-server.ts &

# 2. reviewer's browser checks
BASE=http://127.0.0.1:8841 ./node_modules/.bin/tsx review-evidence/qa-phase2-1435/qa-browser.ts

# 3. reviewer's clean-session console probe
BASE=http://127.0.0.1:8841 ./node_modules/.bin/tsx review-evidence/qa-phase2-1435/qa-console.ts
```

## Result

- `qa-browser.ts` → **71 passed / 4 failed** (`reviewer-harness-rerun.log`).
- `qa-console.ts` → `consoleErrs: []`, `pageErrs: []`, `failed: []`,
  `badResponses: []` (clean session).
- Reviewer's original run on the pre-fix build was **67 passed / 8 failed**; the
  reviewer themselves reclassified **5** of those 8 as reporter-side artefacts
  (their QA-REPORT §6). **Those same 5 are still reported as failing here**
  because the assertions were not changed — they remain wrong on their own
  terms, not on the app's.

## The two B1 render sites — now Chinese (this is the fix)

Taken verbatim from `reviewer-harness-rerun.log` §3 (the reviewer's own leak
sweep, unchanged):

```
✓ zh-HK screen "dashboard" has no English prose leak — clean
✓ zh-HK screen "chart" has no English prose leak — clean
✓ zh-HK screen "signals" has no English prose leak — clean
✓ zh-HK screen "watchlist" has no English prose leak — clean
✓ zh-HK screen "help" has no English prose leak — clean
✓ source badge (freshness) is Chinese in zh-HK — "快取 · 1 分鐘前"
✓ news relative-time is Chinese in zh-HK — … · 2 個鐘前更新 · 提及 AAPL · 開啟原文 ↗
```

Before the fix these read `快取 · 7 min ago` and `… · 1 h ago前更新`.

## The 4 remaining failures — all reporter-side (reviewer's own §6)

| Failing assertion | Why it fails | Whose premise is wrong |
|---|---|---|
| `invalid fundamentals symbol rejected (4xx…)` → `HTTP 200` | `/api/fundamentals/ZZZZZZ` honestly returns **200** with every field `null` (`{profile:null,keyStats:null,health:null,…}`). SPEC-PHASE2 §G requires degrading honestly, not erroring, so 200-all-null is correct. | Reviewer §6.3 (they reached the same conclusion) |
| `valid-but-unpublished fundamentals returns honest empty envelope` | Same endpoint/same premise — this one asserts `source=live keyStats={marketCap:null,…}`, i.e. the honest envelope it says should be "empty". | Reviewer §6.4 |
| `zero console errors` → `1`: `Failed to load resource … 400` | The 400 is the harness's **own** deliberate `/api/news/@@bad@@` call, made inside the same page session. | Reviewer §6.5 |
| `zero failed requests` → `7` `net::ERR_ABORTED` | `ERR_ABORTED` on `?range=`/`interval=` navigations is the SPA cancelling superseded in-flight fetches, not a failure. | Reviewer §6 (aborted navigations) |

The reviewer's `qa-console.ts` — a clean session with no deliberate bad requests
and no rapid re-navigation — reports **zero** console errors, page errors and
failed requests, which is the honest measurement for the console criterion.

## A note on the reviewer's original `grep dist` evidence

The reviewer's B1 proof included:

```
grep -o "just now\|min ago\| h ago\| d ago" dist/assets/index-….js   # each present
```

That grep **still matches** on the fixed build — correctly. `en` is a shipped
locale, so the English words are in the bundle by design; the bug was never that
they existed, it was that a **zh-HK session rendered them**. The honest
replacement for that as a regression signal is therefore a rendering assertion,
not a bundle grep:

- the reviewer's own leak sweep now reads `快取 · 1 分鐘前` / `· 2 個鐘前更新`
  (`reviewer-harness-rerun.log` §3), and
- `scripts/evidence-chart.mjs` asserts on the shipped build that neither the
  source badge, its `title`, nor the news meta contains an English time word in
  zh-HK, and that switching to `en` still reads as English.

The zh-HK dictionary itself contains no bare English time words (checked above),
which is the property that matters for the default locale.

## N5 — `verify:runtime` flakiness (closed)

Full write-up: `followup-evidence/n5-cache-assertion.md`.
Raw reproduction: `followup-evidence/n5-probe.log`,
`review-evidence/n5-cold-crumb-probe.ts`.

The old "a second fundamentals call is served from cache" assertion branched on
whether the *moment-of-focus* live call had returned real data, so a cold
cookie/crumb session (`first=unavailable`, then a crumb-minted `live`) tripped
it. Fixed by (1) a deterministic provider-stubbed cache probe that always asserts
persist-then-serve-from-cache through the real `loadFundamentals`, and (2) turning
the live assertion into an explicit, visible `○ SKIP` when there is genuinely
nothing in the cache to read. 10/10 runs PASS; 3 of them exercised the skip path.
