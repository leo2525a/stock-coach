/**
 * QA probe 14 — (a) does `fullYears` positional indexing mislabel the growth
 * horizon when the annual series has a HOLE inside the trailing window?
 * (b) how are GBp amounts rendered (unit)?
 */
import { deriveGrowth, annualSeries, growthOver, consecutiveIncreases, type RawDividendEvent } from '../../shared/dividends';
const at = (iso: string) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / 1000);

console.log('=== (a) growth horizon with a hole inside the trailing window ===');
// Annual payer: pays 1.00/yr in 2015, NOTHING in 2016-2019, then 2.00/yr 2020-2025.
// The honest "10-year" window (2015 → 2025) is a 10-year span. But note that the
// series has only 10 *observed* years, so positional indexing shifts the horizon.
const evs: RawDividendEvent[] = [];
for (const y of [2015, 2020, 2021, 2022, 2023, 2024, 2025]) evs.push({ date: at(`${y}-07-01`), amount: y === 2015 ? 1 : 2 });
const series = annualSeries(evs, 2026);
console.log('payments in real life: 2015=1, gap 2016-2019, then 2/yr 2020-2025');
console.log('fullYears =', JSON.stringify(series.fullYears));
const g = deriveGrowth(evs, 2026);
console.log('growth1y =', g.growth1y.value, '(2025 vs 2024 -> 2 vs 2 = 0%)');
console.log('growth5y =', g.growth5y.value);
console.log('consecutiveAnnualIncreases =', g.consecutiveAnnualIncreases.value);
// Now the killer: an annual payer with ONLY a hole in the last 3 years.
const evs2: RawDividendEvent[] = [];
for (const y of [2010, 2011, 2012, 2013, 2014, 2015, 2016, 2017, 2018, 2019, 2020, 2024, 2025]) {
  if (y === 2024 || y === 2025) evs2.push({ date: at(`${y}-07-01`), amount: 3 });
  else evs2.push({ date: at(`${y}-07-01`), amount: 1 });
}
const s2 = annualSeries(evs2, 2026);
const g2 = deriveGrowth(evs2, 2026);
console.log('\nseries with 2024-2025 = 3.00 and a HOLE at 2021-2023:');
console.log('fullYears =', JSON.stringify(s2.fullYears));
const full = s2.fullYears;
console.log('growth5y: baseYear =', full[full.length - 1 - 5], 'lastYear =', full[full.length - 1]);
console.log('   -> the labelled "5Y" is actually', full[full.length - 1] - full[full.length - 1 - 5], 'calendar years');
console.log('growth5y value =', g2.growth5y.value);
console.log('growth3y: baseYear =', full[full.length - 1 - 3], 'lastYear =', full[full.length - 1], '-> span', full[full.length - 1] - full[full.length - 1 - 3], 'years');
console.log('growth3y value =', g2.growth3y.value);
console.log('consecutiveAnnualIncreases =', g2.consecutiveAnnualIncreases.value, '(the 2021-2023 hole counts as an increase)');

console.log('\n=== (a2) the shipped AAPL case, live shape ===');
// AAPL paid 1987-1995, suspended 1996-2011, resumed 2012. Rebuild that shape.
const evs3: RawDividendEvent[] = [];
const aaplYears = [1987, 1988, 1989, 1990, 1991, 1992, 1993, 1994, 1995, ...Array.from({ length: 14 }, (_, i) => 2012 + i)];
for (const y of aaplYears) evs3.push({ date: at(`${y}-08-10`), amount: 0.1 + (y - 1987) * 0.05 });
const g3 = deriveGrowth(evs3, 2026);
console.log('shape: 1987-1995 paid, 1996-2011 SUSPENDED, 2012-2025 paid');
console.log('consecutiveAnnualIncreases =', g3.consecutiveAnnualIncreases.value, '<- counts the 17-year suspension as an "increase"');
console.log('growth10y =', g3.growth10y.value);
