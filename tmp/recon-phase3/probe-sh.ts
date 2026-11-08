const HOST='https://query2.finance.yahoo.com';
async function f(sym:string,types:string[]){const u=`${HOST}/ws/fundamentals-timeseries/v1/finance/timeseries/${encodeURIComponent(sym)}?symbol=${encodeURIComponent(sym)}&type=${types.join(',')}&period1=1500000000&period2=${Math.floor(Date.now()/1000)}`;const r=await fetch(u,{headers:{'user-agent':'Mozilla/5.0',accept:'application/json'}});return await r.json() as any;}
const names=['OrdinarySharesNumber','ShareIssued','TotalEquityGrossMinorityInterest','TotalLiabilitiesNetMinorityInterest','CashCashEquivalentsAndShortTermInvestments','NetIncomeContinuousOperations','ReconciledDepreciation','LongTermDebt','CurrentDebt','TotalCapitalization','EBIT','EBITDA','InterestExpense','PretaxIncome','TaxProvision','OperatingIncome','FreeCashFlow','CapitalExpenditure','OperatingCashFlow'];
for (const p of ['annual','quarterly','trailing']) {
  const j = await f('AAPL', names.map(n=>p+n));
  const present:string[]=[], missing:string[]=[];
  for (const b of j.timeseries.result) { const t=b.meta.type[0]; const rows=(b[t]??[]).filter((x:any)=>x!=null); (rows.length?present:missing).push(t); }
  console.log(p,'present:',present.join(', '));
  console.log(p,'MISSING:',missing.join(', '));
}
const j = await f('AAPL',['quarterlyOrdinarySharesNumber','quarterlyTotalEquityGrossMinorityInterest','quarterlyEBITDA','quarterlyTotalDebt','quarterlyCashAndCashEquivalents','quarterlyFreeCashFlow','quarterlyCapitalExpenditure','quarterlyNetIncome','quarterlyTotalRevenue','quarterlyDilutedEPS']);
for (const b of j.timeseries.result) { const t=b.meta.type[0]; const rows=(b[t]??[]).filter((x:any)=>x!=null); console.log(t, rows.map((r:any)=>`${r.asOfDate}:${r.reportedValue?.raw}`).join(' ')); }
