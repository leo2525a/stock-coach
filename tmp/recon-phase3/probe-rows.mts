const HOST = 'https://query2.finance.yahoo.com';
const UA = 'Mozilla/5.0';
async function f(sym: string, types: string[], p1=1500000000, p2=Math.floor(Date.now()/1000)) {
  const url = `${HOST}/ws/fundamentals-timeseries/v1/finance/timeseries/${encodeURIComponent(sym)}?symbol=${encodeURIComponent(sym)}&type=${types.join(',')}&period1=${p1}&period2=${p2}`;
  const r = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' } });
  return await r.json() as any;
}
let j = await f('AAPL', ['trailingTotalRevenue','trailingNetIncome','trailingEBITDA','trailingOperatingIncome','trailingDilutedEPS','trailingFreeCashFlow','trailingOperatingCashFlow']);
for (const b of j.timeseries.result) {
  const t = b.meta.type[0];
  const rows = (b[t]??[]).filter((x:any)=>x!=null);
  console.log(t, rows.length);
  console.log('  first:', JSON.stringify(rows[0]));
  console.log('  last :', JSON.stringify(rows.at(-1)));
}
console.log('\n--- annual raw row ---');
j = await f('AAPL', ['annualTotalRevenue','annualDilutedEPS','annualTotalDebt','annualStockholdersEquity','annualEBITDA']);
console.log(JSON.stringify(j.timeseries.result[0].annualTotalRevenue.slice(-1)[0], null, 1));
console.log('\n--- quarterly rows ---');
j = await f('AAPL', ['quarterlyTotalRevenue','quarterlyTotalDebt','quarterlyStockholdersEquity','quarterlyEBITDA','quarterlyNetIncome']);
for (const b of j.timeseries.result) {
  const t = b.meta.type[0];
  const rows = (b[t]??[]).filter((x:any)=>x!=null);
  console.log(t, rows.map((r:any)=>`${r.asOfDate}:${r.periodType}=${r.reportedValue?.raw}`).join(' '));
}
console.log('\n--- 0700.HK check ---');
j = await f('0700.HK', ['annualTotalRevenue','annualNetIncome','annualTotalDebt','annualStockholdersEquity','annualTotalAssets']);
for (const b of j.timeseries.result) {
  const t = b.meta.type[0];
  const rows = (b[t]??[]).filter((x:any)=>x!=null);
  console.log(t, rows.map((r:any)=>`${r.asOfDate}=${r.reportedValue?.raw}:${r.reportedValue?.currencyCode ?? '?'}`).join(' '));
}
