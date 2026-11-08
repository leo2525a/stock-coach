import { readFileSync } from 'node:fs';
const css = readFileSync(new URL('../../src/styles.css', import.meta.url), 'utf8');
const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');

function decls(sel) {
  const re = new RegExp(sel.replace(/[[\]'"\\]/g, (c) => '\\' + c) + '\\s*\\{([^}]*)\\}', 's');
  const m = re.exec(stripped);
  if (!m) return null;
  const s = new Set();
  for (const line of m[1].split(';')) {
    const t = line.trim();
    if (t.startsWith('--')) s.add(t.split(':')[0].trim());
  }
  return s;
}

const root = decls(':root');
const light = decls("[data-theme='light']");
if (!root || !light) { console.log('selector not found', !!root, !!light); process.exit(1); }

console.log('root tokens:', root.size, ' light tokens:', light.size);
const missing = [...root].filter((t) => !light.has(t));
console.log('DECLARED IN :root BUT NOT OVERRIDDEN IN LIGHT:', missing.length);
for (const m of missing) console.log('  ', m);

const used = new Set([...stripped.matchAll(/var\((--[a-zA-Z0-9-]+)/g)].map((m) => m[1]));
console.log('var()-referenced but not declared in :root:', [...used].filter((t) => !root.has(t)));

// tokens the light theme declares that :root does not
console.log('light-only tokens:', [...light].filter((t) => !root.has(t)));
