/**
 * QA rerun probe M — DETERMINISTIC minimal reproduction of the residual
 * wrong-scale §C.1 "Annual rate" (LSE / GBp symbols), and the exact exported
 * string. No network: the fact block is built by `parseDividendFacts` from a
 * provider shape captured live from ULVR.L (summaryDetail.currency = 'GBp',
 * dividendRate = 1.56 while the exchange quotes the share in pence, price 4930).
 */
import { parseDividendFacts } from '../../shared/dividends';
import { buildDividendTables } from '../../src/dividend/exportModel';
import { en } from '../../shared/i18n';

// The exact provider shape captured live from ULVR.L on 2026-11-07.
const providerJson = {
  quoteSummary: {
    result: [
      {
        summaryDetail: {
          currency: 'GBp',
          dividendRate: { raw: 1.56 },
          dividendYield: { raw: 0.0311 },
          trailingAnnualDividendRate: { raw: 1.886 },
          trailingAnnualDividendYield: { raw: 0.00037480128 },
          exDividendDate: { raw: Math.floor(Date.parse('2026-11-12T00:00:00Z') / 1000) },
        },
        defaultKeyStatistics: { lastDividendValue: { raw: 0.3907 } },
        price: { currency: 'GBp', regularMarketPrice: { raw: 4930 } },
        calendarEvents: {},
      },
    ],
  },
};

const facts = parseDividendFacts(providerJson, 4930, []);
console.log('parseDividendFacts(ULVR.L-shape):');
console.log('  currency      =', facts.currency.value);
console.log('  annualRate    =', facts.annualRate.value, '  <-- provider field is in GBP, label is GBp');
console.log('  lastDividend  =', facts.lastDividendValue.value, '  <-- provider field is in GBP');
console.log('  derived forward yield =', facts.forwardYield.value, `(${(facts.forwardYield.value * 100).toFixed(2)}%)`);

// The exact §C.1 export row, built by the product's own export model.
const payload: any = {
  symbol: 'ULVR.L',
  price: 4930,
  facts,
  events: [],
  growth: { consecutiveAnnualIncreases: { value: null, source: 'absent' }, growth1y: { value: null, source: 'absent' }, growth3y: { value: null, source: 'absent' }, growth5y: { value: null, source: 'absent' }, growth10y: { value: null, source: 'absent' } },
  shareholder: { total: { value: null, source: 'absent' }, dividendPart: { value: null, source: 'absent' }, buybackPart: { value: null, source: 'absent' }, debtPaydownPart: { value: null, source: 'absent' }, asOf: '' },
  series: { yields: [], payments: [], spansAvailable: [], reconstructed: false },
  source: 'live',
  lastUpdated: null,
  note: null,
};
const t = (k: string) => (en as any)[k] ?? k;
const tables = buildDividendTables(t as any, payload, null);
const s1 = tables[0];
console.log('\n§C.1 export table rows (figure | value | basis):');
for (const r of s1.rows) console.log(`  ${r[0].padEnd(22)} | ${r[1].padEnd(14)} | ${r[2]}`);

const rateRow = s1.rows.find((r) => r[0] === t('div.f.annualRate'));
const lastRow = s1.rows.find((r) => r[0] === t('div.f.lastDividend'));
console.log('\nDEFECT: the exported §C.1 "Annual rate" =', JSON.stringify(rateRow?.[1]));
console.log('        while the same export\'s "Last Dividend" =', JSON.stringify(lastRow?.[1]));
console.log('        and the graph payments on the same screen average ~40 GBp; an annual rate of');
console.log('        ~156 GBp is the honest GBp figure (1.56 GBP == 156 GBp).');
