/**
 * QA rework probe — latent hazard in the "trust the provider figure as-is"
 * branch. When `dividendYield` is absent the rework passes the raw `dividendRate`
 * through. For an LSE (GBp-quoted) name the raw rate is GBP, so it would be shown
 * as GBp = 100x off again. Check (a) deterministically, (b) whether any live
 * symbol can reach it.
 */
import { parseDividendFacts } from '../../shared/dividends';
import { fetchProviderJson, analystSummaryPath } from '../../server/provider';

const qs = (o: any) => ({ quoteSummary: { result: [o] } });

// (a) deterministic: ULVR.L shape but with dividendYield absent
const f = parseDividendFacts(
  qs({
    summaryDetail: { currency: 'GBp', dividendRate: { raw: 1.56 }, exDividendDate: { raw: 1794441600 } },
    price: { currency: 'GBp', regularMarketPrice: { raw: 4930 } },
  }),
  4930,
  [],
);
console.log('(a) LSE shape, dividendYield ABSENT:');
console.log('    annualRate =', JSON.stringify(f.annualRate), ' <-- honesty depends on this being withheld, not 1.56');
console.log('    forwardYield =', JSON.stringify(f.forwardYield));

// (b) live: does any LSE name with a dividendRate have no dividendYield?
console.log('\n(b) live co-occurrence of dividendRate and dividendYield:');
for (const sym of ['ULVR.L', 'BP.L', 'VOD.L', 'HSBA.L', 'SHEL.L', 'AZN.L', 'GSK.L', 'BATS.L', 'LGEN.L', 'TSCO.L', 'RDS.L', 'BA.L', 'RR.L', 'IAG.L']) {
  try {
    const pj: any = await fetchProviderJson(analystSummaryPath(sym));
    const r: any = pj?.json?.quoteSummary?.result?.[0];
    if (!r) { console.log(`  ${sym.padEnd(8)} no result`); continue; }
    const sd = r.summaryDetail ?? {}, px = r.price ?? {};
    const rate = sd.dividendRate?.raw ?? null, yld = sd.dividendYield?.raw ?? null, price = px.regularMarketPrice?.raw ?? null;
    const risky = rate != null && (yld == null || yld <= 0);
    console.log(
      `  ${sym.padEnd(8)} ccy=${px.currency ?? '—'} rate=${rate} yield=${yld} price=${price} identity=${yld && price ? (yld * price).toFixed(3) : '—'} ${risky ? '  <-- REACHES TRUST-RAW BRANCH' : ''}`,
    );
  } catch (e) {
    console.log(`  ${sym.padEnd(8)} fetch error: ${e instanceof Error ? e.message : String(e)}`);
  }
}
