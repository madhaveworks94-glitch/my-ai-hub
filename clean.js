import {db,save} from './store.js';
const due=b=>Math.max(b.total-b.paid,0);
// Never removed: unpaid udhaar, old balances not fully paid, customer khata accounts, GST invoices and GST credit notes (kept for the legal 6 years)
export function plan(m){
 const d=new Date();d.setMonth(d.getMonth()-m);const t=d.getTime();
 const gone=new Set(db.bills.filter(b=>b.date<t&&b.type!=='gst'&&due(b)<=0.004).map(b=>b.id));
 const opens=new Set(db.ledger.filter(l=>l.type==='opening'&&l.left<=0.004&&l.date<t).map(l=>l.id));
 const pays=new Set(db.ledger.filter(l=>l.type==='payment'&&l.date<t&&(l.allocs||[]).every(a=>a.k==='bill'?(gone.has(a.id)||!db.bills.some(b=>b.id===a.id)):(opens.has(a.id)||!db.ledger.some(x=>x.id===a.id)))).map(l=>l.id));
 return{gone,opens,pays,canc:(db.cancelled||[]).filter(b=>b.date<t&&b.type!=='gst'),cn:(db.creditNotes||[]).filter(c=>c.date<t&&c.type!=='gst'),trips:db.trips.filter(x=>x.done&&x.end<t),logs:(db.stockLog||[]).filter(x=>x.date<t)};
}
export const count=p=>p.gone.size+p.opens.size+p.pays.size+p.canc.length+p.cn.length+p.trips.length+p.logs.length;
export function run(m){
 const p=plan(m),n=count(p);if(!n)return 0;
 db.bills=db.bills.filter(b=>!p.gone.has(b.id));
 db.ledger=db.ledger.filter(l=>!(p.opens.has(l.id)||p.pays.has(l.id)||(l.billId&&p.gone.has(l.billId))));
 db.cancelled=(db.cancelled||[]).filter(b=>!p.canc.includes(b));db.creditNotes=(db.creditNotes||[]).filter(c=>!p.cn.includes(c));
 db.trips=db.trips.filter(x=>!p.trips.includes(x));db.stockLog=(db.stockLog||[]).filter(x=>!p.logs.includes(x));
 save();return n;
}
export function auto(){const m=db.cleanMonths||0;if(m>0)run(m)}
