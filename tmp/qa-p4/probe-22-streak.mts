import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp, bootstrap } from '../../server/app';
import { openDb } from '../../server/db';
import { annualSeries, yearlyTotals, consecutiveIncreases } from '../../shared/dividends';
const dir = mkdtempSync(path.join(tmpdir(),'qa-p4-st-'));
const db = openDb(path.join(dir,'db.sqlite')); bootstrap(db);
const app = createApp(db); const server = app.listen(0);
await new Promise(r=>server.once('listening',r));
const port=(server.address() as any).port;
try {
  for (const sym of ['AAPL','KO','MSFT','COST','O']) {
    const b = await (await fetch(`http://127.0.0.1:${port}/api/dividends/${sym}`)).json() as any;
    const p = b.data ?? b;
    const evs = p.series.payments.map((x:any)=>({date:x.date,amount:x.amount}));
    const yearly = yearlyTotals(evs);
    const s = annualSeries(evs, 2026);
    const streak = consecutiveIncreases(s);
    // honest streak: walk back over CONTIGUOUS calendar years only
    const full = s.fullYears;
    let honest = 0;
    for (let i = full.length-1; i > 0; i--) {
      const contiguous = full[i] === full[i-1] + 1;
      const up = s.totals.get(full[i])! > s.totals.get(full[i-1])!;
      if (contiguous && up) honest++; else break;
    }
    const yrs = full.filter((y:number)=>y>=2012);
    console.log(`${sym}: code streak=${streak} honest contiguous streak=${honest} (fullYears ${full.length}, last ${full.at(-1)})`);
    // show the boundary where the hole crosses
    for (let i=1;i<full.length;i++) if (full[i]!==full[i-1]+1) console.log(`   HOLE ${full[i-1]} -> ${full[i]}: totals ${s.totals.get(full[i-1])} -> ${s.totals.get(full[i])} (up=${s.totals.get(full[i])!>s.totals.get(full[i-1])!})`);
  }
} finally { await new Promise<void>(r=>server.close(()=>r())); db.close(); rmSync(dir,{recursive:true,force:true}); }
