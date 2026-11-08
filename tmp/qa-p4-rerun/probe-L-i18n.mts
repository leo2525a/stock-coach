import { en, zhHK, auditDictionaries } from '../../shared/i18n';
const ek = Object.keys(en);
const zk = Object.keys(zhHK);
const audit = auditDictionaries();
console.log('auditDictionaries =', JSON.stringify(audit, null, 2).slice(0, 1200));
const identical = ek.filter((k) => en[k] === (zhHK as any)[k]);
console.log('en keys=', ek.length, 'zh keys=', zk.length);
console.log('identical values =', identical.length, identical.slice(0, 25));
console.log('has note.dividendPayableBeforeEx in en =', 'note.dividendPayableBeforeEx' in en, '| in zh =', 'note.dividendPayableBeforeEx' in zhHK);
