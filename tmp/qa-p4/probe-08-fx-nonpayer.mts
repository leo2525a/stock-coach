import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp, bootstrap } from '../../server/app';
import { openDb } from '../../server/db';
const dir = mkdtempSync(path.join(tmpdir(), 'qa-p4-fx-'));
const db = openDb(path.join(dir,'db.sqlite')); bootstrap(db);
const app = createApp(db); const server = app.listen(0);
await new Promise(r=>server.once('listening',r));
const port=(server.address() as any).port;
const base = `http://127.0.0.1:${port}`;
const iso=(t:number|null)=>t===null||t===undefined?'—':new Date(t*1000).toISOString().slice(0,10);
try {
  for (const sym of ['ULVR.L','0700.HK','0005.HK','TSLA','BRK-B']) {
    const r = await fetch(`${base}/api/dividends/${encodeURIComponent(sym)}`);
    console.log(`\n########## ${sym} HTTP ${r.status} ##########`);
    if (!r.ok) { console.log(await r.text()); continue; }
    const b = await r.json() as any; const p = b.data ?? b;
    const f = p.facts;
    console.log('currency      ', JSON.stringify(f.currency));
    console.log('indicatedYield', JSON.stringify(f.indicatedYield));
    console.log('trailingYield ', JSON.stringify(f.trailingYield));
    console.log('forwardYield  ', JSON.stringify(f.forwardYield));
    console.log('payoutRatioLtm', JSON.stringify(f.payoutRatioLtm));
    console.log('fiveYearAvg   ', JSON.stringify(f.fiveYearAvgYield));
    console.log('annualRate    ', JSON.stringify(f.annualRate));
    console.log('lastDivValue  ', JSON.stringify(f.lastDividendValue));
    console.log('nextExDate    ', JSON.stringify(f.nextExDate), iso(f.nextExDate.value));
    console.log('nextPayDate   ', JSON.stringify(f.nextPayDate), iso(f.nextPayDate.value));
    console.log('frequency     ', JSON.stringify(f.frequency));
    console.log('price         ', p.price);
    console.log('source/note   ', p.source, p.note);
    console.log('growth        ', JSON.stringify(p.growth));
    console.log('shareholder   ', JSON.stringify(p.shareholder));
    console.log('payments      ', p.series.payments.length, p.series.payments.slice(-2).map((x:any)=>`${iso(x.date)}=${x.amount}`).join(' '));
    const rows = (p.events??[]).slice(-3).map((x:any)=>`${iso(x.exDate)} amt=${x.amount} ccy=${x.currency} pay=${iso(x.payableDate)}`);
    console.log('sched tail    ', rows.join(' | '));
  }
} finally { await new Promise<void>(r=>server.close(()=>r())); db.close(); rmSync(dir,{recursive:true,force:true}); }
