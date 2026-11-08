/**
 * Tiny in-repo internationalisation core (Phase 2, SPEC §B).
 *
 * Deliberately dependency-free: the app only needs two locales, one flat key
 * table per locale, and `{placeholder}` interpolation. Anything heavier would
 * be more code to test than the feature it replaces.
 *
 * This module is pure (no React, no window) so the backend, the tests and a
 * future native wrapper can all share exactly one translation contract.
 */

/** The shipped locales. `zh-HK` is the default (SPEC §B). */
export type Lang = 'zh-HK' | 'en';

export const LANGS: readonly Lang[] = ['zh-HK', 'en'];

export const DEFAULT_LANG: Lang = 'zh-HK';

/** Short labels for the top-bar toggle. */
export const LANG_LABELS: Record<Lang, string> = {
  'zh-HK': '中',
  en: 'EN',
};

/** `lang` values are sometimes persisted by an older build; keep it honest. */
export function normalizeLang(value: unknown): Lang {
  return value === 'en' ? 'en' : DEFAULT_LANG;
}

/** A flat key → template table. Keys are dotted namespaces, e.g. `nav.chart`. */
export type Dict = Record<string, string>;

/** Interpolation values. Everything is stringified with `String()`. */
export type Params = Record<string, string | number>;

/**
 * Replace `{name}` placeholders.
 *
 * An unknown placeholder is left untouched rather than replaced with "undefined"
 * — a visible `{count}` in the UI is a bug report; `undefined` is a mystery.
 */
export function interpolate(template: string, params?: Params): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match,
  );
}

/**
 * The placeholder names a template asks for, in order, de-duplicated.
 */
export function placeholdersOf(template: string): string[] {
  const out: string[] = [];
  for (const m of template.matchAll(/\{(\w+)\}/g)) {
    if (!out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

export interface Translator {
  /** Translate a key, interpolating `{placeholders}`. */
  (key: string, params?: Params): string;
  /** The locale this translator speaks. */
  lang: Lang;
}

/**
 * Build a translator for one locale.
 *
 * A missing key falls back to the other locale, and failing that returns the key
 * itself. That keeps the UI readable during development while the
 * `npm test` key-parity check and `npm run check:i18n` make sure a real gap can
 * never ship.
 */
export function createTranslator(primary: Dict, fallback: Dict = {}, lang: Lang = DEFAULT_LANG): Translator {
  const t = ((key: string, params?: Params): string => {
    const template = primary[key] ?? fallback[key] ?? key;
    return interpolate(template, params);
  }) as Translator;
  t.lang = lang;
  return t;
}

/** Keys present in `base` but missing from `other`. */
export function missingKeys(base: Dict, other: Dict): string[] {
  return Object.keys(base).filter((k) => !(k in other));
}

/** Keys present in `other` but not in `base`. */
export function extraKeys(base: Dict, other: Dict): string[] {
  return Object.keys(other).filter((k) => !(k in base));
}

/**
 * Placeholder mismatches between two locales — the sneaky i18n bug where both
 * dictionaries have the key but one forgot `{count}`, so the number silently
 * vanishes in one language.
 */
export function placeholderMismatches(
  base: Dict,
  other: Dict,
): Array<{ key: string; base: string[]; other: string[] }> {
  const out: Array<{ key: string; base: string[]; other: string[] }> = [];
  for (const key of Object.keys(base)) {
    if (!(key in other)) continue;
    const a = placeholdersOf(base[key]);
    const b = placeholdersOf(other[key]);
    if (a.length !== b.length || a.some((name, i) => name !== b[i])) {
      out.push({ key, base: a, other: b });
    }
  }
  return out;
}

/** Every locale's dictionary, keyed by locale. */
export type DictBundle = Record<Lang, Dict>;

/** Shared shape used by the app, the API and tests. */
export function translatorFor(bundle: DictBundle, lang: Lang): Translator {
  const other: Lang = lang === 'zh-HK' ? 'en' : 'zh-HK';
  return createTranslator(bundle[lang], bundle[other], lang);
}

/* -------------------------------------------------------------------------
   The shipped dictionaries. Imported here (rather than in the components) so
   the whole app — and the tests — share exactly one bundle.
   ------------------------------------------------------------------------- */
import { en } from './en';
import { zhHK } from './zh-HK';

export { en, zhHK };

export const DICTIONARIES: DictBundle = { 'zh-HK': zhHK, en };

/**
 * Copy patterns that are grammatically wrong in *any* locale value, whatever
 * the surrounding context.
 *
 * Concretely: `humanAge()` now returns a complete word (「7 分鐘前」), so a
 * template that wraps it must not add its own time suffix — «{age}前更新» with a
 * Chinese age would render «7 分鐘前前更新» ("before-before"). This is checked
 * here, next to the dictionaries, so the mistake cannot come back in either
 * locale while the audit stays green.
 */
const DOUBLE_SUFFIX_PATTERNS: Array<{ re: RegExp; why: string }> = [
  {
    re: /\{age\}[^\s]{0,3}前/,
    why: 'an age that already ends in 前 must not be followed by another 前/前更新',
  },
  {
    re: /\{age\}\s*(?:ago|前)/,
    why: 'an age label must not be followed by a second "ago"/前',
  },
];

/** Key-parity report across every shipped locale. Empty arrays = healthy. */
export function auditDictionaries(bundle: DictBundle = DICTIONARIES): {
  reference: Lang;
  missing: Record<string, string[]>;
  extra: Record<string, string[]>;
  placeholderMismatches: Array<{ lang: Lang; key: string; reference: string[]; other: string[] }>;
  doubleSuffix: Array<{ lang: Lang; key: string; value: string; why: string }>;
} {
  const reference: Lang = 'en';
  const missing: Record<string, string[]> = {};
  const extra: Record<string, string[]> = {};
  const mismatches: Array<{ lang: Lang; key: string; reference: string[]; other: string[] }> = [];
  const doubleSuffix: Array<{ lang: Lang; key: string; value: string; why: string }> = [];

  for (const lang of LANGS) {
    for (const [key, value] of Object.entries(bundle[lang])) {
      for (const { re, why } of DOUBLE_SUFFIX_PATTERNS) {
        if (re.test(value)) doubleSuffix.push({ lang, key, value, why });
      }
    }
    if (lang === reference) continue;
    missing[lang] = missingKeys(bundle[reference], bundle[lang]);
    extra[lang] = extraKeys(bundle[reference], bundle[lang]);
    for (const m of placeholderMismatches(bundle[reference], bundle[lang])) {
      mismatches.push({ lang, key: m.key, reference: m.base, other: m.other });
    }
  }
  return { reference, missing, extra, placeholderMismatches: mismatches, doubleSuffix };
}
