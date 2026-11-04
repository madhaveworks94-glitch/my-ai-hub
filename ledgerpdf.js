import {db} from './store.js';
import {tools} from './gstpdf.js';
import {stmt} from './khata.js';
const f2=n=>Number(n||0).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});
const dmy=t=>{const x=new Date(t);return String(x.getDate()).padStart(2,'0')+'-'+String(x.getMonth()+1).padStart(2,'0')+'-'+x.getFullYear()};
export async function makeLedgerPdf(cid,fromS,toS){
 const J=await tools(),doc=new J({unit:'mm',format:'a4'}),W=210,H=297,c=db.customers.find(x=>x.id===cid),sh=db.shop;
 const a=fromS?new Date(fromS+'T00:00:00').getTime():0,z=toS?new Date(toS+'T23:59:59.999').getTime():Date.now();
 const ev=stmt(cid).reverse(),before=ev.filter(e=>e.d<a),open=before.length?before[before.length-1].r:0,rows=ev.filter(e=>e.d>=a&&e.d<=z),close=rows.length?rows[rows.length-1].r:open;
 let y=14;
 doc.setFont('helvetica','bold');doc.setFontSize(15);doc.text('LEDGER ACCOUNT',W/2,y,{align:'center'});y+=7;
 doc.setFontSize(12);doc.text(sh.name||'',10,y);y+=5;doc.setFont('helvetica','normal');doc.setFontSize(9);
 [sh.addr,sh.phone?'Phone: '+sh.phone:'',sh.gstin?'GSTIN: '+sh.gstin:''].filter(Boolean).forEach(t=>{doc.text(t,10,y);y+=4.5});y+=2;
 doc.autoTable({startY:y,theme:'grid',margin:{left:10,right:10},styles:{fontSize:9,cellPadding:1.8,lineColor:[70,70,70],lineWidth:.15,textColor:20},body:[['Account of',c?c.name+(c.phone?'  ('+c.phone+')':''):''],['Period',(a?dmy(a):'Beginning')+' to '+dmy(z)],['Statement date',dmy(Date.now())]],columnStyles:{0:{fontStyle:'bold',fillColor:[240,240,240],cellWidth:38}}});
 y=doc.lastAutoTable.finalY+6;
 const dr=rows.reduce((s,e)=>s+(e.dr||0),0),cr=rows.reduce((s,e)=>s+(e.cr||0),0);
 doc.autoTable({startY:y,theme:'grid',margin:{left:10,right:10},styles:{fontSize:8.5,cellPadding:1.7,lineColor:[70,70,70],lineWidth:.15,textColor:20},headStyles:{fillColor:[225,225,225],textColor:20,fontStyle:'bold'},footStyles:{fillColor:[240,240,240],textColor:20,fontStyle:'bold'},showFoot:'lastPage',
  head:[['Date','Particulars','Note','Debit (Rs.)','Credit (Rs.)','Balance (Rs.)']],
  body:[['','Opening balance','','','',f2(open)],...rows.map(e=>[dmy(e.d),e.t,e.n||'',e.dr?f2(e.dr):'',e.cr?f2(e.cr):'',f2(e.r)])],
  foot:[['','Closing balance','',f2(dr),f2(cr),f2(close)]],
  didParseCell:k=>{if(k.column.index>=3)k.cell.styles.halign='right'}});
 y=doc.lastAutoTable.finalY+6;
 doc.setFontSize(8.5);doc.text(doc.splitTextToSize('Balance is the amount the customer owes. Debit means bills and old balance. Credit means payments received and credit notes. This is a computer generated statement.',W-20),10,y);
 doc.setFontSize(10);doc.setFont('helvetica','bold');doc.text(close>0.004?'Amount due: Rs. '+f2(close):'Account settled',W-10,y+14,{align:'right'});
 const n=doc.internal.getNumberOfPages();for(let i=1;i<=n;i++){doc.setPage(i);doc.setFont('helvetica','normal');doc.setFontSize(7.5);doc.setTextColor(90);doc.text((sh.name||'')+'   Ledger: '+(c?c.name:''),10,H-6);doc.text('Page '+i+' of '+n,W-10,H-6,{align:'right'})}
 return{name:('Ledger-'+(c?c.name:'customer')+'-'+(fromS||'start')+'_to_'+(toS||'today')).replace(/[^A-Za-z0-9_.-]+/g,'-')+'.pdf',b64:doc.output('datauristring').split('base64,')[1],doc};
}
