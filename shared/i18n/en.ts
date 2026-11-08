import type { Dict } from './index';
import { shell } from './en/shell';
import { screens } from './en/screens';
import { analyst } from './en/analyst';
import { sig } from './en/sig';

/**
 * English dictionary — the **reference locale**.
 *
 * The strings live in `./en/` split by namespace; this file only assembles them.
 * Spread order is irrelevant — every consumer treats the dictionary as an
 * unordered map, and `npm test` compares key *sets*, never order.
 *
 * Two rules keep this dictionary honest:
 *  1. `sig.ev.*` templates are not free copy: `npm test` renders every signal
 *     with the English dictionary and asserts the result is character-for-
 *     character identical to the engine's `evidence` line. If you reword one
 *     here without rewording `shared/signals.ts`, a test fails.
 *  2. `npm test` asserts this key set and the zh-HK key set are identical, so a
 *     string can never ship in one language only.
 */
export const en: Dict = { ...shell, ...screens, ...analyst, ...sig };