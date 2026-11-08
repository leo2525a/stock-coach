/**
 * QA probe 01 — recompute derived figures from the *captured raw* upstream
 * payloads in review-evidence/recon-phase4/out, independently of the builder's
 * helpers where possible.
 */
import { readFileSync } from 'node:fs';
import {
  parseDividendFacts,
  parseDividendEvents,
  deriveGrowth,
  normalizeRatio,
  percentToFraction,
  deriveShareholderYield,
  parseTrailingYield,
  yearlyTotals,
  annualSeries,
  consecutiveIncreases,
  growthOver,
  isOutlierYear,
  deriveFrequency,
  medianGapDays,
} from '../../shared/dividends';

const OUT = 'review-evidence/recon-phase4/out/';
const read = (f: string) => JSON.parse(readFileSync(OUT + f, 'utf8'));
const at = (iso: string) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / 1000);

console.log('=================== AAPL quoteSummary → facts ===================');
const aaplQs = read('qs-analyst-AAPL.json');
const aaplFacts = parseDividendFacts(aaplQs, 345.43, []);
console.log('indicatedYield   ', JSON.stringify(aaplFacts.indicatedYield), 'expected ~0.0031 fraction');
console.log('trailingYield    ', JSON.stringify(aaplFacts.trailingYield), 'expected ~0.003079873 fraction');
console.log('forwardYield     ', JSON.stringify(aaplFacts.forwardYield), 'expected rate/price 1.08/345.43=0.0031265');
console.log('payoutRatioLtm   ', JSON.stringify(aaplFacts.payoutRatioLtm), 'expected 0.118 (fraction)');
console.log('fiveYearAvgYield ', JSON.stringify(aaplFacts.fiveYearAvgYield), 'expected 0.0047 (0.47%)');
console.log('annualRate       ', JSON.stringify(aaplFacts.annualRate));
console.log('lastDividendValue', JSON.stringify(aaplFacts.lastDividendValue));
console.log('nextExDate       ', JSON.stringify(aaplFacts.nextExDate));
console.log('nextPayDate      ', JSON.stringify(aaplFacts.nextPayDate));
console.log('frequency        ', JSON.stringify(aaplFacts.frequency));
console.log('currency         ', JSON.stringify(aaplFacts.currency));

console.log('\n--- independent recompute of AAPL forward yield (rate/price) ---');
const rawFwd = 1.08 / 345.43;
console.log('1.08/345.43 =', rawFwd, ' code gave', aaplFacts.forwardYield.value, ' delta', Math.abs((aaplFacts.forwardYield.value ?? 0) - rawFwd));

console.log('\n=================== KO growth from captured chart ===================');
// div-KO-max.json is the `range=max` capture (169 events; the KNOWN-bad window).
const koMax = read('div-KO-max.json');
const koMaxEvents = parseDividendEvents({ chart: { result: [{ events: { dividends: koMax } }] } });
console.log('KO max events:', koMaxEvents.length);
const koMaxYears = yearlyTotals(koMaxEvents);
console.log('KO max decade histogram:');
const dec = new Map<number, number>();
for (const y of koMaxYears.keys()) dec.set(Math.floor(y / 10) * 10, (dec.get(Math.floor(y / 10) * 10) ?? 0) + 1);
console.log('   ', [...dec.entries()].sort((a, b) => a[0] - b[0]).map(([d, n]) => `${d}s=${n}`).join(' '));

console.log('\n=================== unit-trap table ===================');
const traps: Array<[string, number | null, number | null, string]> = [
  ['payoutRatio AAPL 0.118 w/ ref 0.118', normalizeRatio(0.118, 0.118), 0.118, 'fraction'],
  ['payoutRatio AGNC 72 w/ ref 0.72', normalizeRatio(72, 0.72), 0.72, 'percent'],
  ['payoutRatio O 2.2199 w/ ref 3.26/1.4687', normalizeRatio(2.2199, 3.26 / 1.4687), 2.2199, 'fraction'],
  ['fiveYearAvg AAPL 0.47', percentToFraction(0.47), 0.0047, 'percent'],
  ['fiveYearAvg KO 2.83', percentToFraction(2.83), 0.0283, 'percent'],
];
for (const [name, got, want, unit] of traps) {
  const ok = got !== null && want !== null && Math.abs(got - want) < 1e-9;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}: got ${got} want ${want} (${unit})`);
}

console.log('\n=================== frequency: MAIN / 0005.HK shapes ===================');
// The recon says 0005.HK rate/last = 31.4 → disagreement.
const hk = deriveFrequency(3.14, 0.1, [at('2023-03-15'), at('2023-06-15'), at('2023-09-15'), at('2023-12-15'), at('2024-03-15'), at('2024-06-15')].map((d) => d));
console.log('0005.HK-shaped:', JSON.stringify(hk.frequency));
// MAIN monthly inferring 13/yr
console.log('MAIN 13/yr -> frequencyFromPerYear(13) =', (await import('../../shared/dividends')).frequencyFromPerYear(13));
