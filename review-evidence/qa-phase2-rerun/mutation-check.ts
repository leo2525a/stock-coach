/**
 * INDEPENDENT MUTATION CHECK (debug-reviewer) — does the extended guard actually
 * catch the double-suffix class it claims to?
 *
 * We do NOT edit app source (read-only boundary). Instead we call the shipped
 * pure function `auditDictionaries(bundle)` with a synthetic bundle that
 * reintroduces the bug, and assert it is flagged. Then we assert the REAL
 * shipped bundle is clean.
 */
import { auditDictionaries, en, zhHK, type DictBundle } from '../../shared/i18n';
import { humanAge } from '../../shared/format';
import { createTranslator } from '../../shared/i18n';

const badBundle: DictBundle = {
  en: { ...en, 'src.updated': 'Updated {age}' },
  'zh-HK': { ...zhHK, 'src.updated': '{age}前更新' }, // the OLD bug
};
const good = auditDictionaries();
const bad = auditDictionaries(badBundle);

console.log('REAL shipped bundle doubleSuffix:', JSON.stringify(good.doubleSuffix));
console.log('REAL shipped bundle missing:', JSON.stringify(good.missing));
console.log('REAL shipped bundle placeholderMismatches:', JSON.stringify(good.placeholderMismatches));
console.log('MUTATED bundle doubleSuffix:', JSON.stringify(bad.doubleSuffix));

const caught = bad.doubleSuffix.some((d) => d.lang === 'zh-HK' && d.key === 'src.updated');
const cleanReal = good.doubleSuffix.length === 0;

// Show the actual rendered composition both ways.
const tGood = createTranslator(zhHK, en, 'zh-HK');
const tBad = createTranslator(badBundle['zh-HK'], en, 'zh-HK');
const age = humanAge(120, tGood);
console.log('\nhumanAge(120s) zh-HK:', JSON.stringify(age));
console.log('GOOD  src.updated({age}):', JSON.stringify(tGood('src.updated', { age })));
console.log('BAD   src.updated({age}):', JSON.stringify(tBad('src.updated', { age })));

const ok = caught && cleanReal;
console.log('\nMUTATION CHECK:', ok
  ? 'PASS — the guard flags the reintroduced «{age}前更新» bug and the shipped bundle is clean'
  : 'FAIL — guard did not catch the mutation');
process.exit(ok ? 0 : 1);
