import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp, bootstrap } from '../../server/app';
import { openDb } from '../../server/db';
import { annualSeries, yearlyTotals } from '../../shared/dividends';
const dir = mkdtempSync(path.join(tmpdir(),'qa-p4-ga-'));
const db = openDb(path.join(dir,'db.sqlite')); bootstrap(db);
const app = createApp(db); const server = app.listen(0);
await new Promise(r=>server.once('listening',r));
const port=(server.address() as any).port;
try {
  for (const sym of ['AAPL','KO','O']) {
    const b = await (await fetch(`http://127.0.0.1:${port}/api/dividends/${sym}`)).json() as any;
    const p = b.data ?? b;
    // reconstruct the same series the server used
    const evs = p.series.payments.map((x:any)=>({date:x.date,amount:x.amount}));
    const yearly = yearlyTotals(evs);
    const years=[...yearly.keys()].sort((a,b)=>a-b);
    const gaps=[]; for(let i=1;i<years.length;i++) if(years[i]!==years[i-1]+1) gaps.push(`${years[i-1]}->${years[i]}`);
    const s = annualSeries(evs, 2026);
    const full=s.fullYears;
    console.log(`\n${sym}: fullYears=${full.length} gaps=[${gaps.join(', ')||'none'}] last=${full.at(-1)}`);
    for (const n of [1,3,5,10]) {
      if (full.length<=n) { console.log(`  growth${n}y: n/a`); continue; }
      const baseYear = full[full.length-1-n], lastYear = full[full.length-1];
      const base=yearly.get(baseYear)!, last=yearly.get(lastYear)!;
      const span=lastYear-baseYear;
      const val=Math.pow(last/base,1/n)-1;
      console.log(`  growth${n}y: labelled ${n}y but spans ${baseYear}->${lastYear} = ${span} calendar yrs; base=${base} last=${last} value=${val}`);
    }
  }
} finally { await new Promise<void>(r=>server.close(()=>r())); db.close(); rmSync(dir,{recursive:true,force:true}); }
