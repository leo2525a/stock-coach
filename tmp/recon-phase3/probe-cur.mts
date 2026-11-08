const HOST='https://query2.finance.yahoo.com';
async function f(sym:string,types:string[]){const u=`${HOST}/ws/fundamentals-timeseries/v1/finance/timeseries/${encodeURIComponent(sym)}?symbol=${encodeURIComponent(sym)}&type=${types.join(',')}&period1=1500000000&period2=${Math.floor(Date.now()/1000)}`;const r=await fetch(u,{headers:{'user-agent':'Mozilla/5.0',accept:'application/json'}});return await r.json() as any;}
for (const sym of ['AAPL','0700.HK','MSFT']) {
  const j = await f(sym,['annualTotalRevenue','quarterlyTotalRevenue']);
  for (const b of j.timeseries.result) {
    const t=b.meta.type[0]; const rows=(b[t]??[]).filter((x:any)=>x!=null);
    console.log(sym, t, JSON.stringify(rows.at(-1)));
  }
  console.log(sym, 'meta.currencyCode=', j.timeseries.result[0]?.meta?.currencyCode, 'meta keys=', Object.keys(j.timeseries.result[0]?.meta ?? {}).join(','));
}
