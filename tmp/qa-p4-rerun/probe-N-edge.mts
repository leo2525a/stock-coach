import { parseDividendFacts, buildSchedule, upcomingPayment, reconcileLastDividend } from '../../shared/dividends';
const at = (s: string) => Math.floor(Date.parse(s + 'T00:00:00Z') / 1000);
const qs = (o: any) => ({ quoteSummary: { result: [o] } });

console.log('=== A: ex-date ABSENT but a payable exists ===');
let f = parseDividendFacts(qs({ calendarEvents: { dividendDate: { raw: at('2026-12-15') } } }), 100, []);
console.log('  nextEx:', JSON.stringify(f.nextExDate), '\n  nextPay:', JSON.stringify(f.nextPayDate));

console.log('=== B: non-payer (real modules, no dividend fields): direct(null) ===');
f = parseDividendFacts(qs({ summaryDetail: {}, defaultKeyStatistics: {} }), 200, []);
console.log('  nextEx:', JSON.stringify(f.nextExDate), '\n  nextPay:', JSON.stringify(f.nextPayDate));

console.log('=== C: empty envelope: absent ===');
f = parseDividendFacts({ finance: {} }, 100, []);
console.log('  nextEx:', JSON.stringify(f.nextExDate), '\n  nextPay:', JSON.stringify(f.nextPayDate));

console.log('=== D: reconciledNextPayDate with ex==pay (same day) ===');
f = parseDividendFacts(qs({ summaryDetail: { exDividendDate: { raw: at('2026-11-12') } }, calendarEvents: { dividendDate: { raw: at('2026-11-12') } } }), 100, []);
console.log('  nextPay:', JSON.stringify(f.nextPayDate));

console.log('=== E: upcomingPayment with ex==pay must null the pay ===');
f = parseDividendFacts(qs({ summaryDetail: { exDividendDate: { raw: at('2026-11-12') }, currency: 'USD' }, defaultKeyStatistics: { lastDividendValue: { raw: 0.27 } }, calendarEvents: { dividendDate: { raw: at('2026-11-12') } } }), 27, []);
console.log('  upcomingPayment:', JSON.stringify(upcomingPayment(f, [0.26,0.27,0.27])));

console.log('=== F: buildSchedule given upcoming on a fresh day appends exactly one ===');
const rows = buildSchedule([{ date: at('2026-08-11'), amount: 0.27 }], 'USD', 'quarterly', { exDate: at('2026-11-12'), amount: 0.27, payDate: at('2026-11-20') });
console.log('  rows:', rows.length, rows.map((r) => [new Date(r.exDate*1000).toISOString().slice(0,10), r.payableDate===null?'—':new Date(r.payableDate*1000).toISOString().slice(0,10)]));

console.log('=== G: reconcileLastDividend on an already-absent field is a no-op ===');
f = parseDividendFacts({ finance: {} }, 100, []);
console.log('  ->', JSON.stringify(reconcileLastDividend(f, [1,2,3]).lastDividendValue));
