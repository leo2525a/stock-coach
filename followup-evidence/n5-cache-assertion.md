# N5 — flaky `verify:runtime` fundamentals-cache assertion

Requester: `debug-debug_lead` · Implementer: `debug-coder` · Reported by: `debug-reviewer`
Date: 2026-11-06 · Project: `stock-app` (Phase 2 follow-up, N5)

## Symptom

`npm run verify:runtime` failed intermittently (reviewer: 2 of 5 runs) with:

```
✗ a second fundamentals call is served from cache (not re-fetched) — first=unavailable second=live
```

## Root cause (confirmed, not inferred)

The assertion reused the *moment-of-focus* fundamentals call and only made sense
when that call had already produced real data:

```ts
// before
const fundDocs = await get(`/api/fundamentals/${SYMBOL}`);
check(
  'a second fundamentals call is served from cache (not re-fetched)',
  fundDocs.data?.source === 'live' ? fundDocs.data.source === f?.source : true,
  …
);
```

`loadFundamentals` (`server/phase2-service.ts`) deliberately **refuses to cache a
reply that carries no usable facts** — caching one would turn a transient
provider hiccup into hours of "no data":

```ts
const usable = payload.profile !== null || payload.keyStats !== null || payload.health !== null;
if (usable) setKv(db, key, payload, now);
```

So on a cold/stale cookie+crumb session the sequence is:

| call | result | cached? |
|---|---|---|
| 1 (cold crumb) | `unavailable`, nothing cached | no |
| 2 (crumb now minted by call 1) | `live`, **persists** | yes |

Call 2 returning `live` is *correct behaviour*, not a caching regression — but
the assertion read it as one. The harness never warms the session before this
section, so whether it trips depends purely on Yahoo's mood.

### Direct reproduction

`review-evidence/n5-cold-crumb-probe.ts` replays exactly that sequence
(`resetSession()` + fresh DB per trial, then two `loadFundamentals` calls) against
the live provider. One captured run (`followup-evidence/n5-probe.log`):

```
trial  6: first=unavailable second=live        oldAssertion=FAILS   <-- the reported failure
trial  7: first=live        second=cache       oldAssertion=HOLDS
trial  8: first=unavailable second=live        oldAssertion=FAILS
trial 10: first=unavailable second=live        oldAssertion=FAILS
trial 11: first=unavailable second=live        oldAssertion=FAILS
…
tally: { "live -> cache": 10, "unavailable -> live": 4 }
```

4 of 14 trials reproduced it in that capture, and an earlier capture caught 1 in
14 — the race is real but Intermittent, which is exactly why it needed a
structural fix rather than a lucky re-run. (`first=unavailable second=unavailable`
also occurs and is already handled correctly by both the old and new checks.)

## Chosen fix — (c) a deterministic, provider-independent cache proof

Rejected (a) *tolerate the cold case*: the check is exactly the rule it must
enforce, so an escape hatch on `first=unavailable` also swallows a genuine
"stopped caching entirely" regression.

Rejected (b) *warm the crumb first*: warming only reddens the race — the first
call is still a live network round-trip that can come back `unavailable`, and
the harness still branches on the provider's answer.

Implemented fix, in two parts:

1. **A controlled cache probe (the real proof).** `probeFundamentalsCache()` in
   `scripts/verify-runtime.ts` calls the **real** `loadFundamentals` twice against
   a throwaway SQLite cache, stubbing only the upstream `fetchImpl` (cookie/crumb
   handshake included) so the provider always answers with a known good payload.
   It asserts:

   * call 1 → `source === 'live'` and the row is written
   * call 2 → `source === 'cache'`, identical `keyStats`, and call 1's `lastUpdated`

   This is deterministic — no Yahoo involvement — and it asserts the product's
   actual code path (`loadFundamentals` already takes an injectable `fetchImpl`),
   not a copy of it.

2. **The live assertion, narrowed and honest.** The live check now reads the
   cache entry the moment-of-focus call may have created. When that call produced
   nothing usable, there is genuinely nothing to read, so it reports an explicit
   `○ SKIP …` with the reason — counted as neither pass nor fail, and visible in
   the summary (`✓ runtime verification PASSED — 93 checks, 1 skipped`).

### Why the guarantee is preserved

* The **regression that matters** — "a usable fundamentals reply is persisted and
  then served from cache" — is now enforced *unconditionally* by the controlled
  probe, on every run.
* A mutation test proved the probe is not vacuous: with `setKv` disabled for
  fundamentals (`/* MUTATION: caching disabled */`), both checks failed:

  ```
  ✗ a fundamentals reply with real data is persisted (source=live, then served as source=cache) — probe first=live second=live …
  ✗ a second live fundamentals call is served from cache (not re-fetched) — first=live second=live
  ✗ runtime verification FAILED — 94 passed, 2 failed
  ```

* `tests/cacheability.test.ts` now unit-tests the cacheability rule itself
  (empty envelope → not cacheable; any one usable section → cacheable), so the
  contract the harness reasons about is pinned offline too.

## Proof — 10 consecutive runs

```
run  1: ✓ runtime verification PASSED — 96 checks               | skips=0
run  2: ✓ runtime verification PASSED — 96 checks               | skips=0
run  3: ✓ runtime verification PASSED — 96 checks               | skips=0
run  4: ✓ runtime verification PASSED — 93 checks, 1 skipped    | skips=1
run  5: ✓ runtime verification PASSED — 96 checks               | skips=0
run  6: ✓ runtime verification PASSED — 93 checks, 1 skipped    | skips=1
run  7: ✓ runtime verification PASSED — 96 checks               | skips=0
run  8: ✓ runtime verification PASSED — 96 checks               | skips=0
run  9: ✓ runtime verification PASSED — 96 checks               | skips=0
run 10: ✓ runtime verification PASSED — 93 checks, 1 skipped    | skips=1
-----------------------------------
PASS=10 FAIL=0  (total skips across runs=3)
```

3 of the 10 runs hit the cold-crumb path that used to fail — now reported as an
explicit skip. Earlier baseline (same harness design, this machine): 8 runs, all
PASS, before the change was made — i.e. the race is real but intermittent, which
is why it needed a structural fix rather than a re-run.

## Other gates after the change

```
npm test            11 files / 207 passed   (was 202; +5 in tests/cacheability.test.ts)
npm run lint        clean
npx tsc --noEmit    clean
npm run build       ✓ built in 883ms · precache 16 entries (544.95 KiB)
npm run evidence:chart  ✓ PASSED — 82 checks · 0 console errors
```

## Product code touched, and why

* `shared/fundamentals.ts` — added `isUsableFundamentals()`, the shared
  definition of "worth caching".
* `server/phase2-service.ts` — `loadFundamentals` now calls that predicate
  instead of an inline expression (behaviour identical).

Both changes are pure refactors that make one rule the *single* definition shared
by the service and the verifier, so a harness can never drift from the code it
tests. No route, no payload shape, and no frontend file changed — which is why
`dist/assets/index-XaYzCzND.js` rebuilds byte-for-byte identical.
