const UA = 'Mozilla/5.0';
for (const q of ['AAPL', 'SPY', '0700.HK']) {
  const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=5&newsCount=0`;
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  const j = await r.json();
  console.log('=====', q, r.status, 'news', (j.news??[]).length, 'quotes', (j.quotes??[]).length);
  console.log(JSON.stringify((j.quotes ?? [])[0] ?? null, null, 1));
}
