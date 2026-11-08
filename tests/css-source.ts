import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/**
 * Read a stylesheet as one string, following `@import` statements.
 *
 * `src/styles.css` is an entry point that only wires up the modules under
 * `src/styles/`. Tests that assert on the *rules* must therefore read the
 * resolved graph, not the entry file — otherwise a refactor that splits the
 * stylesheet looks like a missing rule. Resolution is depth-first in source
 * order, which reproduces the original single-file cascade.
 */
export function readStylesheet(entry: string): string {
  const seen = new Set<string>();

  function walk(file: string): string {
    const abs = resolve(file);
    if (seen.has(abs)) return '';
    seen.add(abs);

    const src = readFileSync(abs, 'utf8');
    const importRe = /@import\s+(?:url\()?['"]([^'"]+)['"]\)?\s*;/g;

    return src.replace(importRe, (_match, spec: string) => {
      if (!spec.startsWith('.')) return _match; // bare package import — leave as is
      return walk(resolve(dirname(abs), spec));
    });
  }

  return walk(entry);
}