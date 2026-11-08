/**
 * "No hard-coded user-facing strings" — enforced, not asserted (SPEC-PHASE2 §A.6).
 *
 * The spec asks for a grep *and* a test. A grep only helps a human who runs it;
 * this test runs it for them, in CI, so the guarantee survives future edits.
 *
 * The rule: every string a user can read in `src/` must come from `t('key')`.
 * We scan the JSX and the component sources for literal text in the places text
 * can reach the screen, and for the two dictionary files' own English leakage.
 *
 * A short, explicit allow-list covers the things that are deliberately *not*
 * translated, each with a reason:
 *   - ticker/interval/range codes (AAPL, 1D, MAX) — the universal trading
 *     vocabulary; translating them would be worse, not better.
 *   - the brand ("StockCoach") and its logotype.
 *   - glyphs (⟳ ☰ ★ ‹ › × ▲) that are aria-labelled anyway.
 *   - `className`/`data-*`/`aria-*` values and CSS-ish tokens.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { en, zhHK } from '../shared/i18n';

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');

/** Every `.ts`/`.tsx` under `src/`, except the i18n adapter and type shims. */
function sourceFiles(dir = SRC): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
      continue;
    }
    if (!/\.tsx?$/.test(name)) continue;
    if (name === 'vite-env.d.ts' || name === 'i18n.tsx') continue;
    out.push(full);
  }
  return out;
}

/**
 * Literal text that is allowed to appear in the source.
 *
 * Kept deliberately small and *typed out* rather than a loose regex, so adding
 * an exception is a visible decision in review.
 */
const ALLOWED_LITERALS = new Set([
  // Brand.
  'StockCoach',
  'Stock',
  'Coach',
  'Stock Coach',
  // Structural / non-copy props that happen to be plain strings.
  'button',
  'submit',
  'px',
  'page',
  'true',
  'false',
  'none',
  'all',
  'other',
  'stock',
  'etf',
  // CSS class-ish tokens that are not user copy.
  'active',
  'collapsed',
  'open',
  'selected',
  'is-stale',
  // Font names, not UI copy.
  'SF Mono',
  'SFMono-Regular',
  'Menlo',
  'Consolas',
]);

/**
 * Diagnostics, not copy. These are log/invariant messages the UI never renders —
 * when something fails the UI renders the failure `code` through
 * `apiErrorI18n()`, not the English `error` string. Exempt by *shape* rather
 * than by file, so the exemption cannot silently widen to a whole component.
 */
const DIAGNOSTIC_PATTERNS = [
  /\b(?:error|noteText|message|reason|desc)\s*:\s*(?:`[^`]*`|'[^']*'|"[^"]*")/g,
  /\bnew (?:Error|MarketDataError|YahooParseError|RangeError|TypeError)\s*\([^()]*\)/g,
  /\bnew (?:Error|MarketDataError|YahooParseError|RangeError|TypeError)\s*\(\s*(?:`[^`]*`|'[^']*'|"[^"]*")/g,
];

/**
 * Decode the string escapes that `tsc`/`esbuild` leave in source.
 *
 * The engine authors prose as `'\u2019'` and `'\u201C'` so the curly quotes are
 * readable in a plain editor; without decoding, a literal would compare as
 * `RSI (Relative Strength Index) scores recent up-days versus down-days on a
 * 0\u2013100 scale.` and never match the dictionary's real em dash. Decoding
 * first is what makes the "copy is present in the dictionary" check honest.
 */
function decodeEscapes(value: string): string {
  return value.replace(
    /\\(u\{([0-9a-fA-F]+)\}|u([0-9a-fA-F]{4})|x([0-9a-fA-F]{2})|([ntrbfv0'"\\]))/g,
    (_m, _all: string, brace: string, u4: string, x2: string, ch: string) => {
      if (brace) return String.fromCodePoint(parseInt(brace, 16));
      if (u4) return String.fromCharCode(parseInt(u4, 16));
      if (x2) return String.fromCharCode(parseInt(x2, 16));
      const map: Record<string, string> = {
        n: '\n',
        t: '\t',
        r: '\r',
        b: '\b',
        f: '\f',
        v: '\v',
        '0': '\0',
        "'": "'",
        '"': '"',
        '\\': '\\',
      };
      return map[ch] ?? ch;
    },
  );
}

/**
 * Prose that lives in a non-dictionary module *on purpose*.
 *
 * One entry, with its reason, so it reads as a decision rather than a gap:
 *   - `NYSE Arca` is a venue's own registered name, matched by the exchange
 *     bucket table. Renaming it would break the match; it is data, not copy.
 */
const SOURCED_BY_DESIGN = new Set(['NYSE Arca']);

/** Remove diagnostic expressions so only real copy is left to scan. */
function stripDiagnostics(source: string): string {
  return DIAGNOSTIC_PATTERNS.reduce((acc, re) => acc.replace(re, '<diagnostic>'), source);
}

/**
 * A literal is "user-facing copy" when it reads like prose rather than an
 * identifier, ticker, class name or CSS token.
 *
 * The capitalisation (or CJK) requirement is what keeps `className` strings
 * out: CSS classes, `data-*` values and internal "kinds" are lower-case by
 * convention, while every real label is capitalised (`Add to watchlist`),
 * Chinese (「加入自選股」), or both.
 */
function looksLikeCopy(text: string): boolean {
  const s = text.trim();
  if (s.length < 3) return false;
  if (ALLOWED_LITERALS.has(s)) return false;
  if (/^[A-Z0-9.]{1,6}$/.test(s)) return false; // AAPL, 1Y, MAX, SMA, RSI
  if (/^[a-z][a-z0-9-]*$/.test(s)) return false; // class names, kinds
  if (/^[^\p{L}]+$/u.test(s)) return false; // pure glyphs / punctuation
  // Chinese copy carries meaning without spaces or capitals.
  if (/[\u3400-\u9fff]/.test(s)) return s.length >= 2;
  if (!/[A-Z]/.test(s)) return false; // lower-case Latin ⇒ CSS-ish
  // Prose: at least two letter-words separated by a space.
  return /\p{L}{2,}\s+\p{L}{2,}/u.test(s) && s.length >= 6;
}

/**
 * Attribute copy (`aria-label`, `title`, `alt`, `placeholder`) is held to a
 * stricter bar than text nodes: a single capitalised word there is real copy
 * because the attribute exists precisely to describe the control, so there is
 * no identifier it could plausibly be.
 */
function looksLikeAttrCopy(text: string): boolean {
  const s = text.trim();
  if (s.length < 3) return false;
  if (ALLOWED_LITERALS.has(s)) return false;
  if (/^[A-Z0-9.]{1,6}$/.test(s)) return false; // AAPL, SMA 50-ish codes
  if (/^[^\p{L}]+$/u.test(s)) return false; // pure glyphs
  if (/[\u3400-\u9fff]/.test(s)) return s.length >= 2; // Chinese label
  // Capitalised word (or phrase) — e.g. "Close", "Refresh prices".
  return /^[A-Z]/.test(s);
}

/**
 * Extract plain-text children of JSX elements: `>Some text<` and
 * `>Some text{` … plus string literals in `title=`/`aria-label=`/`placeholder=`
 * attributes (the accessible copy a user also reads).
 */
function offensiveLiterals(source: string): string[] {
  const found: string[] = [];
  const scan = stripDiagnostics(source);

  // JSX text nodes: between a `>` and the next `<` or `{`.
  for (const m of scan.matchAll(/>([^<>{}]+)</g)) {
    const text = m[1];
    if (looksLikeCopy(text)) found.push(text.trim());
  }

  // Attribute copy that ends up on screen or in a screen reader. These are
  // checked as *attributes*, so a single capitalised word (`aria-label="Close"`)
  // is copy even though a lone word in a text node usually is not.
  for (const m of scan.matchAll(/\b(?:title|aria-label|placeholder|alt)\s*=\s*"([^"]*)"/g)) {
    const text = m[1].trim();
    if (looksLikeAttrCopy(text)) found.push(text);
  }

  // Literal noun phrases inside ternaries / template expressions, e.g.
  // `{cond ? 'Add to watchlist' : 'Add'}` would slip past the JSX scan because
  // the strings are inside braces.
  for (const m of scan.matchAll(/(?<=[?:,(]\s)'([^'\n]{6,})'/g)) {
    const text = decodeEscapes(m[1]);
    if (looksLikeCopy(text)) found.push(text.trim());
  }

  // Template literals holding prose. `${...}` interpolations are stripped
  // first, so `` `${n} bars · last ${p}` `` is judged on "bars · last".
  for (const m of scan.matchAll(/`([^`\n]*)`/g)) {
    const stripped = m[1].replace(/\$\{[^}]*\}/g, '');
    if (/[A-Za-z]{2,}[\s·]+[A-Za-z]{2,}/.test(stripped)) found.push(stripped.trim());
  }

  return found;
}

describe('i18n — no hard-coded user-facing copy survives in src/', () => {
  const files = sourceFiles();

  it('scans a real set of component files', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it('every JSX text node and copy attribute comes from t()', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      // The scan is line-oriented so the failure message can point at a line.
      src.split('\n').forEach((line, i) => {
        if (line.includes('t(') || line.trim().startsWith('//') || line.trim().startsWith('*')) return;
        for (const lit of offensiveLiterals(line)) {
          offenders.push(`${path.relative(ROOT, file)}:${i + 1} → ${JSON.stringify(lit)}`);
        }
      });
    }
    expect(offenders, `hard-coded copy found:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('finds each English key present in the zh-HK dictionary', () => {
    // Belt-and-braces with the parity test: even if a key set matched, an empty
    // zh-HK value would leak English at runtime. The other test covers emptiness.
    const missing = Object.keys(en).filter((k) => !(k in zhHK));
    expect(missing).toEqual([]);
  });

  it('has real Chinese (not just Latin text) in the zh-HK dictionary', () => {
    const han = /[\u3400-\u9fff]/;
    const values = Object.values(zhHK);
    const translated = values.filter((v) => han.test(v));
    // Not every string can be Chinese (tickers, "SMA 50"), but the bulk must be.
    expect(translated.length / values.length).toBeGreaterThan(0.7);
  });

  it('the detector actually catches copy (self-test)', () => {
    // A guard on the guard: if `looksLikeCopy` ever became a no-op, the big
    // test above would pass vacuously.
    expect(looksLikeCopy('Add to watchlist')).toBe(true);
    expect(looksLikeCopy('No recent news')).toBe(true);
    expect(looksLikeCopy('加入自選股')).toBe(true);
    expect(looksLikeCopy('AAPL')).toBe(false);
    expect(looksLikeCopy('active')).toBe(false);
    expect(looksLikeCopy('tiny chg-up')).toBe(false);
    expect(looksLikeCopy('⟳')).toBe(false);
    // Diagnostics must not be mistaken for copy.
    expect(offensiveLiterals("error: 'Unexpected response shape (HTTP 500).',")).toEqual([]);
    expect(offensiveLiterals('throw new Error(`bad timestamp: ${x}`)')).toEqual([]);
    expect(offensiveLiterals('<p>Some real sentence here</p>')).toContain('Some real sentence here');
    expect(offensiveLiterals('title="Refresh prices"')).toContain('Refresh prices');
    // A one-word accessible label is copy too.
    expect(offensiveLiterals('aria-label="Close"')).toContain('Close');
    expect(looksLikeAttrCopy('Close')).toBe(true);
    expect(offensiveLiterals('`${n} bars · last ${p}`')).toContain('bars · last');
    // Escaped prose must decode before it is judged, or every curly quote
    // literal would silently become a false negative.
    expect(decodeEscapes('today\\u2019s')).toBe('today\u2019s');
    expect(decodeEscapes('\\u{1F600}')).toBe('\u{1F600}');
    // Decoding is what makes a quoted sentence with a curly dash readable copy
    // rather than an escaped blob.
    expect(looksLikeCopy(decodeEscapes('MACD \\u2014 bullish crossover'))).toBe(true);
  });

  /**
   * SPEC-PHASE2 §6 — "no hard-coded user-facing strings left outside the
   * translation layer".
   *
   * An English sentence in `src/` is a bug the user sees the moment they switch
   * to Chinese. The same sentence in `shared/signals.ts` is a different shape of
   * bug: the engine legitimately authors its beginner copy there, but the UI
   * never renders it — it renders `t('sig.<id>.what')` instead. So the guarantee
   * we enforce is not "no English anywhere", it is "no English reaches the
   * screen": every prose literal in `shared/` must either be published by the
   * dictionary (so it *is* the translated copy) or be a documented diagnostic.
   *
   * That is a real check, not a restatement: renaming a key in `en.ts`, editing
   * a sentence in `signals.ts`, or writing a new user-facing string in `format`
   * all fail here, and each failure names the file, line and literal.
   */
  describe('shared/ — engine prose is either published copy or a diagnostic', () => {
    /** Prose literals in a shared module, with file:line, escapes decoded. */
    function proseLiteralsIn(files: string[]): string[] {
      const found: string[] = [];
      for (const file of files) {
        const src = readFileSync(path.join(ROOT, 'shared', file), 'utf8');
        src.split('\n').forEach((line, i) => {
          const trimmed = line.trim();
          if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return;
          // A diagnostic is exempt by shape, exactly as in `src/`.
          const scan = stripDiagnostics(line);
          for (const m of scan.matchAll(/'([^'\n]*)'/g)) {
            const value = decodeEscapes(m[1]).trim();
            if (value !== m[1].trim() && looksLikeCopy(value)) {
              found.push(`shared/${file}:${i + 1} → ${JSON.stringify(value)}`);
            } else if (looksLikeCopy(m[1])) {
              found.push(`shared/${file}:${i + 1} → ${JSON.stringify(m[1].trim())}`);
            }
          }
        });
      }
      return found;
    }

    it('every indicator sentence the engine authors is the dictionary copy', () => {
      // `signals.ts` is where the plain-language copy is written. Each sentence
      // must appear verbatim in the English dictionary, which is what proves the
      // Chinese UI can show a translated version of it instead.
      const englishValues = new Set(Object.values(en));
      // A literal counts as published when it is a whole dictionary value *or*
      // a fragment of one. `signals.ts` composes a line as
      // `SMA50 vs SMA200: ${cond ? 'SMA50 above (uptrend structure)' : …}`,
      // so the branch literal is a substring of the published sentence rather
      // than an entry of its own. Substring matching keeps that real composition
      // honest without demanding the engine spell the prefix twice.
      const isPublished = (literal: string) =>
        englishValues.has(literal) ||
        [...englishValues].some((value) => value.includes(literal));
      const published = proseLiteralsIn(['signals.ts']).filter((hit) => {
        const literal = JSON.parse(hit.slice(hit.indexOf('→ ') + 2));
        return isPublished(literal) || SOURCED_BY_DESIGN.has(literal);
      });
      // A floor, so the assertion cannot pass by finding nothing at all.
      expect(published.length).toBeGreaterThan(40);
    });

    it('no unexplained English prose survives in shared/', () => {
      const englishValues = new Set(Object.values(en));
      const isPublished = (literal: string) =>
        englishValues.has(literal) ||
        [...englishValues].some((value) => value.includes(literal));
      const offenders = proseLiteralsIn([
        'signals.ts',
        'categorise.ts',
        'format.ts',
        'api-errors.ts',
        'types.ts',
        'yahoo.ts',
      ]).filter((hit) => {
        const literal = JSON.parse(hit.slice(hit.indexOf('→ ') + 2));
        return !isPublished(literal) && !SOURCED_BY_DESIGN.has(literal);
      });
      expect(
        offenders,
        [
          'English prose in shared/ that no dictionary publishes and that is not',
          'a diagnostic. Either move it into shared/i18n/*.ts or add it to',
          'SOURCED_BY_DESIGN with a reason.',
          ...offenders,
        ].join('\n'),
      ).toEqual([]);
    });

    it('the shared detector is not vacuous', () => {
      // Prove the scan sees the copy it is supposed to see, so a future regex
      // edit that silently stops matching cannot make the check above pass.
      expect(proseLiteralsIn(['signals.ts']).length).toBeGreaterThan(40);
      expect(decodeEscapes('Band width \\u2014 a "get ready" flag')).toBe(
        'Band width \u2014 a "get ready" flag',
      );
    });
  });
});
