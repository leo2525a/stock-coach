/**
 * Failure copy is translated, not hard-coded (SPEC-PHASE2 §A.4/§K).
 *
 * The server (and `src/api.ts`) speak in stable failure `code`s and note keys.
 * These tests pin the two halves of that contract:
 *
 *   1. every code the UI can receive has a dictionary entry in *both* locales;
 *   2. resolving a code through `apiErrorI18n` produces real, localised copy —
 *      no English leaking into the Chinese build and no raw `{placeholder}`
 *      surviving interpolation.
 *
 * Without this, a Chinese user hitting "no such ticker" would read an English
 * sentence, which is exactly the regression a hard-coded string causes.
 */
import { describe, expect, it } from 'vitest';
import { API_ERROR_COPY, NOTE_KEYS, apiErrorI18n, isNoteKey } from '../shared/api-errors';
import { createTranslator, en, zhHK } from '../shared/i18n';

const tEn = createTranslator(en, {}, 'en');
const tZh = createTranslator(zhHK, {}, 'zh-HK');

/** Keys the dictionaries must contain for the failure surface to work. */
const REQUIRED_KEYS = [
  ...Object.values(API_ERROR_COPY).map((c) => c.key),
  ...NOTE_KEYS,
  // The two strings the client itself produces (no server code involved).
  'common.networkError',
  'common.networkErrorShort',
];

describe('failure copy — dictionary coverage', () => {
  it('every API code has copy in both locales', () => {
    for (const key of REQUIRED_KEYS) {
      expect(en[key], `en is missing ${key}`).toBeTruthy();
      expect(zhHK[key], `zh-HK is missing ${key}`).toBeTruthy();
    }
  });

  it('every note key is recognisable as a key (so t() is the right call)', () => {
    for (const key of NOTE_KEYS) expect(isNoteKey(key)).toBe(true);
    // Raw prose must NOT be treated as a key, so legacy payloads pass through.
    expect(isNoteKey('Provider unreachable; showing stored history.')).toBe(false);
    expect(isNoteKey(null)).toBe(false);
  });

  it('the Chinese failure copy is genuinely Chinese, not English', () => {
    const han = /[\u3400-\u9fff]/;
    for (const key of REQUIRED_KEYS) {
      if (key === 'common.networkErrorShort') continue; // may be a short Latin fallback
      expect(han.test(zhHK[key]), `zh-HK:${key} has no Chinese: ${zhHK[key]}`).toBe(true);
    }
  });
});

describe('failure copy — code resolution', () => {
  it('maps a symbol-scoped code and interpolates the ticker', () => {
    const hit = apiErrorI18n('NOT_FOUND', { symbol: 'ZZZZ' });
    expect(hit).toEqual({ key: 'api.notFound', params: { symbol: 'ZZZZ' } });
    expect(tEn(hit!.key, hit!.params)).toContain('ZZZZ');
    expect(tZh(hit!.key, hit!.params)).toContain('ZZZZ');
  });

  it('resolves every code without leaving a placeholder behind', () => {
    for (const code of Object.keys(API_ERROR_COPY)) {
      const hit = apiErrorI18n(code, { symbol: 'AAPL', input: 'aapl' });
      expect(hit, `${code} did not resolve`).not.toBeNull();
      for (const t of [tEn, tZh]) {
        const text = t(hit!.key, hit!.params);
        expect(text, `${code} in ${t.lang} still shows a placeholder`).not.toMatch(/\{[a-z]+\}/);
        expect(text.length).toBeGreaterThan(3);
      }
    }
  });

  it('refuses to invent copy for an unknown code', () => {
    // An unknown code must fall through so the caller keeps the server detail,
    // rather than rendering an empty box.
    expect(apiErrorI18n('SOMETHING_NEW', { symbol: 'AAPL' })).toBeNull();
    expect(apiErrorI18n(null)).toBeNull();
    expect(apiErrorI18n(undefined)).toBeNull();
  });

  it('refuses a code whose required parameter is missing', () => {
    // Rendering `api.notFound` without `{symbol}` would print a literal
    // placeholder; falling back is strictly better.
    expect(apiErrorI18n('NOT_FOUND', {})).toBeNull();
  });

  it('the Chinese and English renderings actually differ', () => {
    const hit = apiErrorI18n('INTERNAL_ERROR')!;
    expect(tEn(hit.key)).not.toBe(tZh(hit.key));
  });
});
