import { parseDividendFacts } from '../../shared/dividends';
const qs = (o: any) => ({ quoteSummary: { result: [o] } });
// ULVR.L shape, but with `dividendYield` (indicated) ABSENT so the derived
// forward yield path runs: annualRate(GBP) / price(GBp).
const f = parseDividendFacts(
  qs({
    summaryDetail: { currency: 'GBp', dividendRate: { raw: 1.56 }, exDividendDate: { raw: 1794441600 } },
    price: { currency: 'GBp', regularMarketPrice: { raw: 4930 } },
  }),
  4930,
  [],
);
console.log('currency   =', f.currency.value);
console.log('indicated  =', JSON.stringify(f.indicatedYield));
console.log('forwardYld =', f.forwardYield.value, `(${(f.forwardYield.value*100).toFixed(4)}%)  note=${f.forwardYield.note}`);
console.log('honest forward (1.56 GBP = 156 GBp / 4930 GBp) =', (156/4930*100).toFixed(3) + '%');
