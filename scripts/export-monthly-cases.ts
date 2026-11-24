import {writeFile,mkdir} from "node:fs/promises";
import {scenario,teaFromNominal,today} from "../src/lib/finance";
import {M1 as base,M1_DELAYS as delays} from "../src/lib/example-cases";
import {sandbox} from "../src/lib/sandbox";
const cases=[
 {id:"M1",title:"Crédito mensual sin gracia adicional",purpose:"Calendario del enunciado con 11 días iniciales y tres cuotas mensuales.",result:sandbox(base,delays,"0.35")},
 {id:"M2",title:"Crédito mensual con gracia total",purpose:"TSS capitaliza el interés del primer mes.",result:scenario({...base,grace:"TSS"},delays,"0.35")},
 {id:"M3",title:"Crédito mensual con gracia parcial",purpose:"PSS paga el interés del primer mes y amortiza en los otros dos.",result:scenario({...base,grace:"PSS"},delays,"0.35")},
 {id:"M4",title:"Tasa nominal capitalizable mensualmente",purpose:"TNA 18 % con capitalización mensual se convierte a TEA.",tna:"0.18",compounding:"MENSUAL",result:scenario({...base,tea:teaFromNominal("0.18","MENSUAL").toFixed(12)},delays,"0.35")},
 {id:"M5",title:"Cambio de tasa durante el plazo",purpose:"TEA 20 % al inicio y 18 % desde la cuota 2. Se recalcula la cuota francesa sobre el saldo pendiente.",result:scenario({...base,rateSteps:[{from:2,tea:"0.18"}]},delays,"0.35")},
 {id:"M6",title:"Pago único en la fecha pactada",purpose:"Interés por los 11 días hasta el 26/09 y mora por 10 días hasta el 06/10.",result:sandbox({...base,months:0,grace:"",mode:"UNICO"},[10],"0.35")},
 {id:"S1",title:"Simulador con cuota modificada",purpose:"La primera cuota base se fija en 800. Disminuye el saldo y se recalculan las cuotas restantes.",edit:{row:1,field:"payment",value:"800"},result:sandbox(base,delays,"0.35",{0:{driver:"payment",value:"800"}})}
];
const referenceP=Math.round(2000*Math.pow(1.2,11/360)*100)/100,referenceI=Math.pow(1.2,1/12)-1;
const singleInterest=(2000*(Math.pow(1.2,11/360)-1)).toFixed(2);
const singleBase=2000+Number(singleInterest);
const singleMora=(singleBase*(Math.pow(1.35,10/360)-1)).toFixed(2);
const independent={
  method:"Referencia independiente con Math.pow y redondeo monetario a céntimos.",
  M1:{initialBalance:referenceP.toFixed(2),periodicRate:referenceI.toFixed(15),payment:(referenceP*referenceI/(1-Math.pow(1+referenceI,-3))).toFixed(2)},
  M6:{interest:singleInterest,payment:singleBase.toFixed(2),lateFee:singleMora,total:(singleBase+Number(singleMora)).toFixed(2)}
};
if(cases[0].result.schedule.ordinaryPayment!==independent.M1.payment||
   cases[0].result.schedule.initialBalance!==independent.M1.initialBalance||
   cases[5].result.rows[0].interest!==independent.M6.interest||
   cases[5].result.totals.totalPaid!==independent.M6.total)
  throw new Error("Los resultados de M1 o M6 no concilian con la referencia independiente.");
await mkdir("docs",{recursive:true});
await writeFile("docs/casos-mensuales.json",JSON.stringify({generatedAt:today(),currency:"PEN",baseDays:360,periodDays:30,independent,cases},null,2));
const header=["Caso","N","Vencimiento","PG","TEA","TEM","Saldo inicial","Interés","Cuota base","Amortización","Saldo final","Pago simulado","Días mora","Mora","Cuota total"];
const rows=cases.flatMap(c=>c.result.rows.map(r=>[c.id,r.number,r.dueDate,r.grace,r.tea??"",r.teq??"",r.opening,r.interest,r.payment,r.principal,r.closing,r.paidDate??"",r.daysLate,r.lateFee,r.total]));
await writeFile("docs/casos-mensuales.csv","\ufeff"+[header,...rows].map(row=>row.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(";")).join("\r\n"));
for(const c of cases)console.log(c.id,"cuota",c.result.schedule.ordinaryPayment,"interés",c.result.totals.interest,"mora",c.result.totals.lateFee,"total",c.result.totals.totalPaid);
