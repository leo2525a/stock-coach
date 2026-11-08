import { createContext, useContext, useMemo, type ReactNode } from 'react';
import {
  createTranslator,
  DICTIONARIES,
  DEFAULT_LANG,
  type Lang,
  type Params,
  type Translator,
} from '../shared/i18n';
import { apiErrorI18n } from '../shared/api-errors';

/**
 * The React half of the i18n layer (SPEC-PHASE2 §B).
 *
 * The *contract* (dictionaries, interpolation, fallbacks) lives in
 * `shared/i18n` and is pure. This file only adapts it to React: one context, one
 * `useT()` hook. Components never touch a dictionary directly, which is what
 * makes "no hard-coded strings" enforceable by a single grep.
 */

const LangContext = createContext<Lang>(DEFAULT_LANG);

export function LangProvider({ lang, children }: { lang: Lang; children: ReactNode }) {
  return <LangContext.Provider value={lang}>{children}</LangContext.Provider>;
}

export function useLang(): Lang {
  return useContext(LangContext);
}

/**
 * The translator for the active locale.
 *
 * The fallback is the *other* dictionary, so a key that somehow exists in only
 * one locale renders English rather than the raw key. `npm test` still fails on
 * such a gap — this only softens a runtime edge, it does not excuse it.
 */
export function useT(): Translator {
  const lang = useLang();
  return useMemo(() => {
    const other: Lang = lang === 'zh-HK' ? 'en' : 'zh-HK';
    return createTranslator(DICTIONARIES[lang], DICTIONARIES[other], lang);
  }, [lang]);
}

/**
 * The user-facing reason for a failed request, in the active language.
 *
 * Failures carry a stable `code`; this turns it into copy. `fallback` is the
 * English `error` string the server sent, used only when the code is one we do
 * not know (an older/newer server) — showing an English diagnostic beats
 * showing a raw `{placeholder}`.
 */
export function useApiError(
  code: string | null | undefined,
  params: { symbol?: string; input?: string } = {},
  fallback = '',
): string {
  const t = useT();
  return translateApiError(t, code, params, fallback);
}

/**
 * Non-hook form of `useApiError`, for callbacks that already hold a translator
 * (e.g. an async submit handler that cannot call a hook mid-flight).
 */
export function translateApiError(
  t: Translator,
  code: string | null | undefined,
  params: { symbol?: string; input?: string } = {},
  fallback = '',
): string {
  const hit = apiErrorI18n(code, params);
  return hit ? t(hit.key, hit.params) : fallback;
}

export type { Params, Translator };
