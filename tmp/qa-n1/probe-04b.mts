import { fetchProviderJson, analystSummaryPath } from '../../server/provider';
const pj = await fetchProviderJson(analystSummaryPath('0005.HK'));
const anypj: any = pj;
console.log('keys =', Object.keys(anypj ?? {}));
console.log('ok =', anypj?.ok, 'status =', anypj?.status);
const json: any = anypj?.json;
console.log('json keys =', json ? Object.keys(json) : null);
console.log(JSON.stringify(json).slice(0, 400));
