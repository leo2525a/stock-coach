import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp, bootstrap } from '../../server/app';
import { openDb } from '../../server/db';
const dir = mkdtempSync(path.join(tmpdir(), 'qa-p4-dup-'));
const db = openDb(path.join(dir,'db.sqlite')); bootstrap(db);
const app = createApp(db); const server = app.listen(0);
await new Promise(r=>server.once('listening',r));
const port=(server.address() as any).port;
try {
  for (const sym of ['O','AAPL','COST','KO','MSFT','AGNC']) {
    const r = await fetch(`http://127.0.0.1:${port}/api/dividends/${sym}`);
    const b = await r.json() as any; const p = b.data ?? b;
    const exs = p.events.map((x:any)=>x.exDate);
    const counts = new Map<number,number>();
    for (const d of exs) counts.set(d,(counts.get(d)??0)+1);
    const dups=[...counts.entries()].filter(([,n])=>n>1);
    console.log(`${sym}: rows=${p.events.length} distinctExDates=${counts.size} dupExDates=${JSON.stringify(dups)}`);
    for (const [d,n] of dups) {
      const rows=p.events.filter((x:any)=>x.exDate===d);
      console.log(`   ${new Date(d*1000).toISOString()} x${n}:`, rows.map((x:any)=>`amt=${x.amount} pay=${x.payableDate===null?'—':new Date(x.payableDate*1000).toISOString()}`).join(' | '));
    }
    console.log(`   nextExDate raw=${p.facts.nextExDate.value} lastChartExDate raw=${Math.max(...exs)}`);
  }
} finally { await new Promise<void>(r=>server.close(()=>r())); db.close(); rmSync(dir,{recursive:true,force:true}); }
