const r = await fetch('https://query1.finance.yahoo.com/v1/finance/search?q=AAPL&quotesCount=3&newsCount=6', { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' } });
console.log('status', r.status);
const j = await r.json();
console.log('news count', (j.news ?? []).length);
for (const n of (j.news ?? []).slice(0, 4)) {
  console.log('-', n.title);
  console.log('   publisher:', n.publisher, '| time:', n.providerPublishTime, '| related:', JSON.stringify(n.relatedTickers), '| link:', n.link?.slice(0, 70));
}
console.log('quote keys for first hit:', Object.keys((j.quotes ?? [])[0] ?? {}).join(','));
const q = j.quotes?.[0];
console.log('quote sample:', q?.symbol, q?.quoteType, q?.sector, q?.industry, q?.exchDisp, q?.typeDisp);
