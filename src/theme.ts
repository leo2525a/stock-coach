/**
 * Theme resolution (Phase 5, owner request: 「加日夜主題」).
 *
 * Pure and dependency-free, exactly like `shared/i18n` — the store, the React
 * shell and the unit tests all share one definition of what "dark", "light" and
 * "system" mean, so a bug can only live in one place.
 *
 * The structure is deliberate:
 *   - `:root` in `styles.css` holds the **dark** tokens (the app's original
 *     look). `[data-theme="light"]` overrides them. Nothing else changed token
 *     names, so every existing component and evidence script keeps working.
 *   - `<html data-theme="…">` always carries the *resolved* theme (`dark` or
 *     `light`) so the paint is a single CSS attribute switch with no flash: the
 *     inline boot script in `index.html` sets it before React mounts.
 */

/** What the user chose. `system` follows the OS preference. */
export type ThemeMode = 'dark' | 'light' | 'system';

/** What is actually painted. */
export type ResolvedTheme = 'dark' | 'light';

/** The user's stored key. Versioned like the other Phase 2 preferences. */
export const THEME_KEY = 'stockcoach.theme';

/** Default is "follow the OS", per the brief. */
export const DEFAULT_THEME_MODE: ThemeMode = 'system';

/** `localStorage` is user-writable, so anything unexpected degrades to system. */
export function normalizeThemeMode(value: unknown): ThemeMode {
  return value === 'dark' || value === 'light' || value === 'system' ? value : DEFAULT_THEME_MODE;
}

/**
 * Resolve a mode against the OS preference.
 *
 * `prefersDark` is passed in rather than read here so the function stays pure
 * and testable; the caller owns the `matchMedia` lookup and its fallback.
 */
export function resolveTheme(mode: ThemeMode, prefersDark: boolean): ResolvedTheme {
  if (mode === 'dark' || mode === 'light') return mode;
  return prefersDark ? 'dark' : 'light';
}

/**
 * The OS preference, or `true` (dark) when there is no `window.matchMedia`
 * (jsdom without the shim, a non-DOM caller). Dark is the app's original look,
 * so "no answer from the platform" keeps the status quo rather than flipping
 * every existing screenshot.
 */
export function systemPrefersDark(): boolean {
  try {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
      : true;
  } catch {
    return true;
  }
}

/** The next mode when the sun/moon button is tapped: dark ⇄ light. */
export function otherMode(theme: ResolvedTheme): ThemeMode {
  return theme === 'dark' ? 'light' : 'dark';
}

/**
 * Apply a resolved theme to the document and keep the browser chrome in sync.
 *
 * Two things happen here, and both are needed:
 *   1. `<html data-theme>` — the single CSS switch.
 *   2. `colorScheme` + the `theme-color` metas — so the iOS status bar / Android
 *      address bar match the page instead of showing a dark bar over a light UI.
 *      We also write `localStorage['stockcoach.theme-resolved']`, which is what
 *      the boot script reads to paint the very first frame.
 */
export function applyTheme(resolved: ResolvedTheme): void {
  try {
    const root = document.documentElement;
    root.setAttribute('data-theme', resolved);
    root.style.colorScheme = resolved;
    for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
      meta.setAttribute('content', resolved === 'light' ? '#ffffff' : '#0d1117');
    }
    localStorage.setItem('stockcoach.theme-resolved', resolved);
  } catch {
    /* non-DOM (unit tests) or private mode — a preference is not worth a crash */
  }
}

/** Persist the user's choice. Kept beside the reader so the two cannot drift. */
export function persistThemeMode(mode: ThemeMode, storage: Pick<Storage, 'setItem'> = localStorage): void {
  try {
    storage.setItem(THEME_KEY, mode);
  } catch {
    /* private mode / quota */
  }
}

/** The user's choice, degrading to `system` for a missing or corrupt value. */
export function readStoredThemeMode(storage: Pick<Storage, 'getItem'> = localStorage): ThemeMode {
  try {
    return normalizeThemeMode(storage.getItem(THEME_KEY));
  } catch {
    return DEFAULT_THEME_MODE;
  }
}
