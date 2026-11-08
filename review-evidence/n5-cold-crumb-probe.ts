/**
 * N5 probe — demonstrate the cold/stale crumb race that makes the
 * "second fundamentals call is served from cache" assertion flaky.
 *
 * Sequence per trial (mirrors the harness, which never warms the session
 * before its fundamentals section):
 *   1. resetSession()   -> pretend the process just booted
 *   2. loadFundamentals()  -> moment-of-focus call (cold crumb)
 *   3. loadFundamentals()  -> the assertion's "second call"
 *
 * If step 2 returns 'unavailable' it cached nothing, so step 3 legitimately
 * re-fetches and can come back 'live' — which is NOT a caching regression.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openDb } from '../server/db';
import { bootstrap } from '../server/app';
import { loadFundamentals } from '../server/phase2-service';
import { resetSession } from '../server/provider';

const TRIALS = Number(process.argv[2] ?? 6);

async function main(): Promise<void> {
  const tally: Record<string, number> = {};
  for (let i = 1; i <= TRIALS; i += 1) {
    // Faithful to the harness: a brand-new process has a cold session AND an
    // empty cache. Use a throwaway DB per trial so trial N does not inherit
    // trial N-1's cached payload.
    const dir = mkdtempSync(path.join(tmpdir(), 'n5probe-'));
    const db = openDb(path.join(dir, 'n5.db'));
    bootstrap(db);
    resetSession(); // cold: same as a fresh harness process
    const first = await loadFundamentals(db, 'AAPL');
    const second = await loadFundamentals(db, 'AAPL');
    const key = `${first.source} -> ${second.source}`;
    tally[key] = (tally[key] ?? 0) + 1;
    // The failing assertion's exact condition:
    const oldAssertionHolds = second.source === 'live' ? second.source === first.source : true;
    console.log(
      `trial ${i}: first=${first.source.padEnd(11)} second=${second.source.padEnd(11)} oldAssertion=${oldAssertionHolds ? 'HOLDS' : 'FAILS'}`,
    );
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
  console.log('\ntally:', JSON.stringify(tally, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
