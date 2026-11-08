/**
 * One rule, one home: which colour class a *directional* figure gets.
 *
 * The owner's request (2026-11-06) is that a figure which goes **up** or
 * **down** should read as such at a glance, without the eye having to parse the
 * sign. That is a single decision — sign → class — so it lives here rather than
 * being re-spelled in every panel (§B.3 簡潔唔好亂).
 *
 * The contract, in full:
 *
 *   - `> 0` → `chg-up`   (the existing `--up` token)
 *   - `< 0` → `chg-down` (the existing `--down` token)
 *   - `= 0` → `chg-flat` (the existing neutral tone)
 *   - `null` / missing / non-finite → `''`, i.e. **no colour at all**
 *
 * The last line is the important one: a missing figure renders as an em dash and
 * must stay uncoloured. Colouring it would imply a direction the data does not
 * have (§D.5 honesty), and would make "no data" look like "flat".
 *
 * Colour is a *secondary* cue only. Every call site keeps the sign and the
 * magnitude in the text (`+12.30%`), so the meaning survives colour-blindness,
 * a monochrome screenshot, and a screen reader.
 */

/** The colour classes this rule can return. `''` means "no colour". */
export type DirClass = '' | 'chg-up' | 'chg-down' | 'chg-flat';

/**
 * The colour class for a signed quantity, or `''` when there is no value.
 *
 * Note this is deliberately *strict* about `null`: it returns no class, not a
 * neutral one. Callers that want "unknown" to look dim (a price column beside a
 * change column, say) must ask for that explicitly, so the honest default is
 * never accidentally relaxed.
 */
export function dirClass(value: number | null | undefined): DirClass {
  if (value === null || value === undefined || !Number.isFinite(value)) return '';
  if (value > 0) return 'chg-up';
  if (value < 0) return 'chg-down';
  return 'chg-flat';
}

/**
 * Like {@link dirClass}, but a missing value falls back to the flat tone.
 *
 * Used where the figure sits beside a *price* and the two must share one tone
 * (the watchlist row), so "no quote yet" stays visually quiet rather than
 * jumping to the default text colour.
 */
export function dirClassOrFlat(value: number | null | undefined): DirClass {
  return dirClass(value) || 'chg-flat';
}
