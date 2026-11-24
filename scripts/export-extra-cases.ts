import {writeFile,mkdir} from "node:fs/promises";
import {scenario,teaFromNominal,type CreditInput} from "../src/lib/finance";
// Casos adicionales para el informe y la exposición. Se calculan con el mismo motor que el sistema (sin base de datos).
const base:CreditInput={amount:"2000",currency:"PEN",tea:"0.20",purchaseDate:"2026-07-08",months:1,cutDay:25,payDay:5,grace:"SS"};
const caso2:CreditInput={...base,amount:"4800",tea:"0.25",purchaseDate:"2026-03-28",months:5,grace:"TPPSSSSSSS"};
const mora="0.35";
const delays=(n:number,late:Record<number,number>)=>Array.from({length:n},(_,k)=>late[k]??0);
const tnaTea=teaFromNominal("0.18","MENSUAL").toFixed(12);
const cases=[
  {id:"A",title:"Caso 2 con cambio de tasa",note:"Mismo crédito del caso 2 (4 800, 5 meses, gracia TPPSSSSSSS) con la TEA de 25 % hasta la cuota 5 y de 18 % desde la cuota 6. Los atrasos son los del caso 2: 5 días en la cuota 5 y 12 días en la cuota 7.",result:scenario({...caso2,rateSteps:[{from:6,tea:"0.18"}]},delays(10,{4:5,6:12}),mora)},
  {id:"B",title:"Caso 1 como pago único",note:"Compra de 2 000 con TEA de 20 % pagada de una sola vez en la fecha de pago (05/08/2026). El interés cubre los 28 días entre la compra y esa fecha. Se paga 10 días tarde.",result:scenario({...base,months:0,grace:"",mode:"UNICO"},[10],mora)},
  {id:"C",title:"Caso 1 con tasa nominal",note:"Compra de 2 000 con TNA de 18 % capitalizada mensualmente, equivalente a una TEA de 19.5618 %: TEA = (1 + 0.18/12)^12 − 1. Atraso de 5 días en la cuota 2.",result:scenario({...base,tea:tnaTea},delays(2,{1:5}),mora)}
];
await mkdir("docs",{recursive:true});
await writeFile("docs/casos-adicionales.json",JSON.stringify({moraTea:mora,cases},null,2));
for(const c of cases)console.log(c.id,c.title,"| cuota",c.result.schedule.ordinaryPayment,"| interés",c.result.totals.interest,"| mora",c.result.totals.lateFee,"| total",c.result.totals.totalPaid);
