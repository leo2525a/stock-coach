const UA = 'Mozilla/5.0';
const jar = [];
function cookieHeader() { return jar.map((c) => c.split(';')[0]).join('; '); }
function absorb(res) {
  const list = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie')].filter(Boolean);
  for (const c of list) if (c) jar.push(c);
}
// 1) prime
let r = await fetch('https://fc.yahoo.com/', { headers: { 'User-Agent': UA }, redirect: 'manual' });
absorb(r);
console.log('prime status', r.status, 'cookies', jar.length, jar.map(c=>c.split('=')[0]));
// 2) crumb
r = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', { headers: { 'User-Agent': UA, cookie: cookieHeader() } });
absorb(r);
const crumb = (await r.text()).trim();
console.log('crumb status', r.status, 'crumb=', JSON.stringify(crumb.slice(0,40)));
if (!crumb || crumb.length > 60) { console.log('NO CRUMB'); process.exit(1); }
// 3) quoteSummary
const mods = 'assetProfile,summaryDetail,defaultKeyStatistics,financialData,price';
const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/AAPL?modules=${mods}&crumb=${encodeURIComponent(crumb)}`;
r = await fetch(url, { headers: { 'User-Agent': UA, cookie: cookieHeader(), Accept: 'application/json' } });
console.log('qs status', r.status);
const j = await r.json();
const res = j?.quoteSummary?.result?.[0];
console.log('error:', JSON.stringify(j?.quoteSummary?.error ?? null));
if (res) {
  const p = res.price ?? {}, sd = res.summaryDetail ?? {}, ks = res.defaultKeyStatistics ?? {}, f = res.financialData ?? {}, ap = res.assetProfile ?? {};
  console.log('marketCap', p.marketCap?.raw, 'trailingPE', sd.trailingPE?.raw, 'forwardPE', sd.forwardPE?.raw, 'dividendYield', sd.dividendYield?.raw, 'beta', sd.beta?.raw);
  console.log('sector', ap.sector, '| industry', ap.industry, '| country', ap.country, '| employees', ap.fullTimeEmployees?.raw);
  console.log('summary len', (ap.longBusinessSummary ?? '').length);
  console.log('rec', f.recommendationKey, 'targetMean', f.targetMeanPrice?.raw, 'profitMargins', f.profitMargins?.raw, 'roe', f.returnOnEquity?.raw, 'revGrowth', f.revenueGrowth?.raw);
  console.log('52w', sd.fiftyTwoWeekHigh?.raw, sd.fiftyTwoWeekLow?.raw, 'avgVol', sd.averageVolume?.raw);
}
