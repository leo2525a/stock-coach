const UA = 'Mozilla/5.0';
async function session() {
  const r1 = await fetch('https://fc.yahoo.com/', { headers: { 'User-Agent': UA } });
  const sc = r1.headers.getSetCookie ? r1.headers.getSetCookie() : [r1.headers.get('set-cookie')];
  const cookie = (sc ?? []).map(c => c.split(';')[0]).filter(Boolean).join('; ');
  const r2 = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', { headers: { 'User-Agent': UA, Cookie: cookie } });
  const crumb = await r2.text();
  return { cookie, crumb };
}
const { cookie, crumb } = await session();
const mods = 'price,summaryDetail,defaultKeyStatistics,financialData,assetProfile';
function pick(obj, keys) {
  const out = {};
  for (const k of keys) out[k] = obj?.[k]?.raw ?? obj?.[k] ?? null;
  return out;
}
for (const sym of ['AAPL', 'SPY', '0700.HK']) {
  const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(sym)}?modules=${mods}&crumb=${encodeURIComponent(crumb)}`;
  const r = await fetch(url, { headers: { 'User-Agent': UA, Cookie: cookie, Accept: 'application/json' } });
  const j = await r.json();
  const res = j.quoteSummary?.result?.[0];
  console.log('=====', sym, 'status', r.status, '=====');
  if (!res) { console.log(JSON.stringify(j).slice(0, 500)); continue; }
  console.log('price:', JSON.stringify(pick(res.price, ['currency','currencySymbol','exchangeName','fullExchangeName','marketCap','regularMarketPrice','regularMarketChange','regularMarketChangePercent','regularMarketDayHigh','regularMarketDayLow','regularMarketVolume','regularMarketTime','longName','shortName','quoteType','marketState']), null, 1));
  console.log('summaryDetail:', JSON.stringify(pick(res.summaryDetail, ['trailingPE','forwardPE','dividendYield','beta','fiftyTwoWeekHigh','fiftyTwoWeekLow','averageVolume','averageVolume10days','dayHigh','dayLow','previousClose','marketCap','yield','payoutRatio','trailingAnnualDividendYield']), null, 1));
  console.log('defaultKeyStatistics:', JSON.stringify(pick(res.defaultKeyStatistics, ['enterpriseValue','forwardPE','profitMargins','sharesOutstanding','floatShares','beta','priceToBook','enterpriseToRevenue','enterpriseToEbitda','trailingEps','forwardEps']), null, 1));
  console.log('financialData:', JSON.stringify(pick(res.financialData, ['currentPrice','targetHighPrice','targetLowPrice','targetMeanPrice','targetMedianPrice','recommendationMean','recommendationKey','numberOfAnalystOpinions','totalRevenue','revenueGrowth','grossMargins','operatingMargins','profitMargins','returnOnAssets','returnOnEquity','freeCashflow','ebitdaMargins','totalDebt','debtToEquity']), null, 1));
  console.log('assetProfile:', JSON.stringify(pick(res.assetProfile, ['sector','industry','country','website','fullTimeEmployees','longBusinessSummary']).longBusinessSummary ? { sector: res.assetProfile.sector, industry: res.assetProfile.industry, sectorDisp: res.assetProfile.sectorDisp, industryDisp: res.assetProfile.industryDisp, country: res.assetProfile.country, website: res.assetProfile.website, fullTimeEmployees: res.assetProfile.fullTimeEmployees, summaryLen: res.assetProfile.longBusinessSummary.length, summaryHead: res.assetProfile.longBusinessSummary.slice(0, 120) } : null, null, 1));
}
