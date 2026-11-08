import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp, bootstrap } from '../../server/app';
import { openDb } from '../../server/db';
import { sourcedText, formatYield, DASH } from '../../src/dividend/format';
const dir = mkdtempSync(path.join(tmpdir(),'qa-p4-np-'));
const db = openDb(path.join(dir,'db.sqlite')); bootstrap(db);
const app = createApp(db); const server = app.listen(0);
await new Promise(r=>server.once('listening',r));
const port=(server.address() as any).port;
try {
  for (const sym of ['TSLA','BRK-B','KO']) {
    const r = await fetch(`http://127.0.0.1:${port}/api/dividends/${sym}`);
    const b = await r.json() as any;
    console.log(`\n### ${sym} HTTP ${r.status} ${b && b.error ? JSON.stringify(b.error) : ''}`);
    const p = b.data ?? b;
    if (!p.facts) continue;
    const f = p.facts;
    console.log(`   indicatedYield raw=${JSON.stringify(f.indicatedYield)}`);
    console.log(`     → rendered "${sourcedText(f.indicatedYield, (v)=>formatYield(v)).text}"`)
    console.log(`   trailingYield  raw=${JSON.stringify(f.trailingYield)}`);
    console.log(`     → rendered "${sourcedText(f.trailingYield, (v)=>formatYield(v)).text}"`);
    console.log(`   forwardYield   raw=${JSON.stringify(f.forwardYield)}`);
    console.log(`   annualRate     raw=${JSON.stringify(f.annualRate)}`);
    console.log(`   annualRate cell→ "${sourcedText(f.annualRate, (v)=>String(v)+' '+f.currency.value).text}"`);
    // scan every rendered cell for a literal "0%" or "0 %"
    const cells:string[]=[];
    for (const k of Object.keys(f)) { const s:any=f[k]; if (s && typeof s==='object' && 'value' in s) cells.push(sourcedText(s,(v)=>formatYield(v)).text); }
    console.log(`   any literal zero-yield cell ("0%"/"0.00%"/"0 %")? ${cells.filter(c=>/^0(\.0+)?\s?%$/.test(c.trim())).join(', ') || 'none'}`);
    console.log(`   schedule rows=${(p.events??[]).length} growth1y=${JSON.stringify(p.growth?.growth1y??null)}`);
  }
} finally { await new Promise<void>(r=>server.close(()=>r())); db.close(); rmSync(dir,{recursive:true,force:true}); }
