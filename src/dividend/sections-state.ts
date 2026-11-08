/**
 * The persistent "which dividend sections are open" state (§C.6 convenience).
 *
 * Same shape as the analyst workspace's helper, with its own storage key so the
 * two screens do not fight over one preference. Closed sections are *unmounted*,
 * so this is a real cost saving and not only a visual one.
 */
export type DividendSectionId = 'c1' | 'c2' | 'c3' | 'c4' | 'c5' | 'c6';

export const DEFAULT_DIVIDEND_SECTIONS: Record<DividendSectionId, boolean> = {
  // The six §C areas start *closed* except the first two: the screen's job is
  // progressive disclosure (簡潔唔好亂), and a wall of nine tables on arrival is
  // the opposite of that.
  c1: true,
  c2: true,
  c3: false,
  c4: true,
  c5: false,
  c6: false,
};

const KEY = 'stockcoach.div.sections';

/** Read the persisted layout; anything corrupt degrades to the default. */
export function readDividendSections(): Record<DividendSectionId, boolean> {
  const fallback = DEFAULT_DIVIDEND_SECTIONS;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fallback;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return fallback;
    const out = { ...fallback };
    for (const id of Object.keys(fallback) as DividendSectionId[]) {
      const v = (parsed as Record<string, unknown>)[id];
      if (typeof v === 'boolean') out[id] = v;
    }
    return out;
  } catch {
    return fallback;
  }
}

export function persistDividendSections(state: Record<DividendSectionId, boolean>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* a preference is not worth crashing over */
  }
}
