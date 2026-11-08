const HOST='https://query2.finance.yahoo.com';
for (const pair of ['HKDUSD=X','EURUSD=X','USDCNY=X','GBPUSD=X','JPYUSD=X']) {
  const r = await fetch(`${HOST}/v8/finance/chart/${pair}?range=1d&interval=1d`,{headers:{'user-agent':'Mozilla/5.0'}});
  const j:any = await r.json().catch(()=>null);
  const m = j?.chart?.result?.[0]?.meta;
  console.log(pair, r.status, m ? `price=${m.regularMarketPrice} time=${m.regularMarketTime} cur=${m.currency} prev=${m.chartPreviousClose}` : JSON.stringify(j).slice(0,150));
}
