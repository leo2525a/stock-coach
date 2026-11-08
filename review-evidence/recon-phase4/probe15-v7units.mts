/** RECON PHASE 4 — probe 15: v7/quote dividend units (with retries). READ-ONLY. */
import { fetchWithRetry, getSession, cookieHeader } from '../../server/provider';
for (let attempt = 0; attempt < 5; attempt++) {
  const s = await getSession();
  if (!s) { console.log(`attempt ${attempt}: no session`); continue; }
  const res = await fetchWithRetry(`https://query1.finance.yahoo.com/v7/finance/quote?symbols=AAPL,KO,O,AGNC&fields=currency,dividendRate,dividendYield,trailingAnnualDividendRate,trailingAnnualDividendYield`, { headers: { 'user-agent': 'Mozilla/5.0', cookie: cookieHeader(s.cookies) } });
  if (!res) { console.log(`attempt ${attempt}: no response (429/5xx)`); continue; }
  const text = await res.text();
  let j: any = null; try { j = JSON.parse(text); } catch { console.log(`attempt ${attempt}: non-JSON ${text.slice(0,80)}`); continue; }
  const arr = j?.quoteResponse?.result;
  if (!arr) { console.log(`attempt ${attempt}: no result keys=${JSON.stringify(Object.keys(j))}`); continue; }
  for (const q of arr) console.log(`  v7 ${q.symbol.padEnd(5)} currency=${q.currency} dividendRate=${q.dividendRate} dividendYield=${q.dividendYield} trailingADR=${q.trailingAnnualDividendRate} trailingADY=${q.trailingAnnualDividendYield}`);
  break;
}
console.log('DONE probe15');
