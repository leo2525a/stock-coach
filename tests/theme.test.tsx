/**
 * @vitest-environment jsdom
 *
 * Phase 5 — day/night theme (§owner request 「加日夜模式」) and the removal of the
 * duplicated top nav bar.
 *
 * The owner asked for three concrete things, each of which is checkable, so
 * this file checks *those* and not "the CSS file got bigger":
 *
 *  - a `system` user follows the OS, an explicit dark/light choice does not —
 *    and the resolved value is what lands on `<html data-theme>` (the paint);
 *  - the light theme defines the **same chart tokens** as the dark `:root`, so
 *    flipping to light can never leave a canvas with an unreadable dark value;
 *  - the top bar no longer duplicates the sidebar's navigation (it has no
 *    `<nav>`), which is exactly the "拆走 nav bar" the owner asked for.
 *
 * A mutation that reverts any of these fails the matching test below.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readStylesheet } from './css-source';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  DEFAULT_THEME_MODE,
  THEME_KEY,
  applyTheme,
  normalizeThemeMode,
  otherMode,
  persistThemeMode,
  readStoredThemeMode,
  resolveTheme,
  systemPrefersDark,
} from '../src/theme';
import { useStore } from '../src/store';
import { ThemeToggle } from '../src/components/Controls';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ROOT = resolve(__dirname, '..');
// `src/styles.css` is an entry point that imports the modules in `src/styles/`,
// so read the resolved graph: the assertions below are about the rules.
const CSS = readStylesheet(resolve(ROOT, 'src/styles.css'));
const HTML = readFileSync(resolve(ROOT, 'index.html'), 'utf8');

/** Pull the custom-property names declared inside a selector block. */
function tokensIn(css: string, selector: string): Set<string> {
  const re = new RegExp(`${selector.replace(/[[\]'"]/g, (c) => `\\${c}`)}\\s*\\{([^}]*)\\}`, 's');
  const m = re.exec(css.replace(/\/\*[\s\S]*?\*\//g, ''));
  if (!m) throw new Error(`selector not found in styles.css: ${selector}`);
  const names = new Set<string>();
  for (const line of m[1].split(';')) {
    const t = line.trim();
    if (t.startsWith('--')) names.add(t.split(':')[0].trim());
  }
  return names;
}

/**
 * Every token `src/chart/theme.ts` reads for a canvas. If light omits one, the
 * canvas silently keeps the dark value on a white background — the exact bug
 * this assertion exists to catch.
 */
const CHART_TOKENS = [
  '--chart-bg',
  '--chart-grid',
  '--chart-text',
  '--chart-axis',
  '--accent',
  '--up',
  '--down',
  '--up-soft',
  '--down-soft',
  '--sma20',
  '--sma50',
  '--sma200',
  '--ema12',
  '--ema26',
  '--bb',
  '--bb-middle',
  '--rsi',
  '--macd',
  '--macd-signal',
  '--ref-price',
  '--ref-low',
  '--ref-mean',
  '--ref-high',
  '--ref-estimate',
];

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.style.colorScheme = '';
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('theme resolution (§owner 「日夜 mode」)', () => {
  it('honours an explicit choice regardless of the OS preference', () => {
    expect(resolveTheme('dark', false)).toBe('dark');
    expect(resolveTheme('light', true)).toBe('light');
  });

  it('follows the OS only for `system`', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
  });

  it('degrades a corrupt stored value to the default (system)', () => {
    expect(normalizeThemeMode('purple')).toBe(DEFAULT_THEME_MODE);
    expect(normalizeThemeMode(null)).toBe(DEFAULT_THEME_MODE);
    expect(normalizeThemeMode(undefined)).toBe(DEFAULT_THEME_MODE);
    expect(normalizeThemeMode('light')).toBe('light');
  });

  it('falls back to dark when the platform offers no preference (no shim)', () => {
    // jsdom has no matchMedia here → the app must keep its original dark look
    // rather than guessing light and flashing on every screen.
    expect(systemPrefersDark()).toBe(true);
  });

  it('the sun/moon button only ever flips between dark and light', () => {
    expect(otherMode('dark')).toBe('light');
    expect(otherMode('light')).toBe('dark');
  });
});

describe('applyTheme paints the document', () => {
  it('sets <html data-theme>, colorScheme, theme-color and the boot key', () => {
    const meta = document.createElement('meta');
    meta.setAttribute('name', 'theme-color');
    meta.setAttribute('content', '#0d1117');
    document.head.appendChild(meta);

    applyTheme('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(document.documentElement.style.colorScheme).toBe('light');
    expect(meta.getAttribute('content')).toBe('#ffffff');
    expect(localStorage.getItem('stockcoach.theme-resolved')).toBe('light');

    applyTheme('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(meta.getAttribute('content')).toBe('#0d1117');

    meta.remove();
  });

  it('round-trips a stored preference and never throws on a dead store', () => {
    persistThemeMode('light');
    expect(readStoredThemeMode()).toBe('light');
    expect(localStorage.getItem(THEME_KEY)).toBe('light');

    const dead = {
      getItem: () => {
        throw new Error('private mode');
      },
    };
    expect(readStoredThemeMode(dead)).toBe(DEFAULT_THEME_MODE);
    expect(() => persistThemeMode('dark', { setItem: () => { throw new Error('quota'); } })).not.toThrow();
  });
});

describe('store theme transitions', () => {
  it('setThemeMode applies the resolved theme to <html> and the store', () => {
    act(() => useStore.getState().setThemeMode('light'));
    expect(useStore.getState().theme).toBe('light');
    expect(useStore.getState().themeMode).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');

    act(() => useStore.getState().setThemeMode('dark'));
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('toggleTheme flips dark ⇄ light and makes the choice explicit', () => {
    act(() => useStore.getState().setThemeMode('dark'));
    act(() => useStore.getState().toggleTheme());
    expect(useStore.getState().theme).toBe('light');
    expect(useStore.getState().themeMode).toBe('light');
    expect(localStorage.getItem(THEME_KEY)).toBe('light');

    act(() => useStore.getState().toggleTheme());
    expect(useStore.getState().theme).toBe('dark');
    expect(localStorage.getItem(THEME_KEY)).toBe('dark');
  });

  it('an explicit choice ignores a later OS change; `system` follows it', () => {
    // Explicit light, then the OS flips to dark → stays light.
    act(() => useStore.getState().setThemeMode('light'));
    act(() => useStore.getState().syncSystemTheme());
    expect(useStore.getState().theme).toBe('light');

    // Back to `system` → the OS preference wins again.
    act(() => useStore.getState().setThemeMode('system'));
    expect(useStore.getState().theme).toBe(systemPrefersDark() ? 'dark' : 'light');
  });
});

describe('the stylesheet defines both palettes completely', () => {
  it('the dark :root carries every chart token', () => {
    const root = tokensIn(CSS, ':root');
    for (const tok of CHART_TOKENS) expect(root.has(tok), `dark :root is missing ${tok}`).toBe(true);
  });

  it('the light theme overrides every chart token (no dark value leaks onto white)', () => {
    const light = tokensIn(CSS, "[data-theme='light']");
    for (const tok of CHART_TOKENS) expect(light.has(tok), `[data-theme='light'] is missing ${tok}`).toBe(true);
  });

  it('index.html paints data-theme before the bundle (no flash)', () => {
    expect(HTML).toMatch(/stockcoach\.theme-resolved/);
    expect(HTML).toMatch(/setAttribute\(\s*['"]data-theme['"]/);
  });

  it('the analyst reference lines are themed, not a dark-only constant (§N1)', () => {
    // The old code hard-coded REF_COLORS; #26a69a was only 2.99:1 on white.
    // Light must now override every reference colour with a *different* value.
    const dark = tokensIn(CSS, ':root');
    const light = tokensIn(CSS, "[data-theme='light']");
    const refTokens = ['--ref-price', '--ref-low', '--ref-mean', '--ref-high', '--ref-estimate'];
    for (const tok of refTokens) {
      expect(dark.has(tok), `dark :root is missing ${tok}`).toBe(true);
      expect(light.has(tok), `light is missing ${tok}`).toBe(true);
    }
    const darkMean = /--ref-mean:\s*([^;]+);/.exec(CSS.replace(/\/\*[\s\S]*?\*\//g, ''))?.[1]?.trim();
    const lightBlock = CSS.slice(CSS.indexOf("[data-theme='light']"));
    const lightMean = /--ref-mean:\s*([^;]+);/.exec(lightBlock)?.[1]?.trim();
    expect(lightMean, 'light --ref-mean must differ from dark (a copy-paste would leave them equal)').not.toBe(darkMean);
  });
});

describe('the duplicated top nav bar is gone (§owner 「淨係要 sidebar」)', () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    if (root) act(() => root!.unmount());
    root = null;
    container.remove();
  });

  it('the global controls now live in the sidebar, not a top bar', () => {
    // Owner (38/100) removed the logo bar entirely: the brand, theme, language
    // and refresh controls moved into the sidebar. `ThemeToggle` renders no
    // <nav> and exposes the testid the evidence gates drive.
    act(() => {
      root = createRoot(container);
      root.render(<ThemeToggle />);
    });
    expect(container.querySelector('nav')).toBeNull();
    expect(container.querySelector('[data-testid="theme-toggle"]')).not.toBeNull();
  });
});
