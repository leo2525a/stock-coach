const HOST='https://query2.finance.yahoo.com';
for (const pair of ['USDHKD=X','CNYUSD=X','USDHKD','HKD=X','EURHKD=X']) {
  const r = await fetch(`${HOST}/v8/finance/chart/${encodeURIComponent(pair)}?range=1d&interval=1d`,{headers:{'user-agent':'Mozilla/5.0'}});
  const j:any = await r.json().catch(()=>null);
  const m = j?.chart?.result?.[0]?.meta;
  console.log(pair, r.status, m ? `price=${m.regularMarketPrice} cur=${m.currency} exc=${m.exchangeName}` : JSON.stringify(j).slice(0,120));
}
