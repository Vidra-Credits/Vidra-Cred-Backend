import {test} from "node:test";
import assert from "node:assert/strict";
import {D,simulate,money,sum,calendar,nextDueDates,statement,creditLine,lateFee,cutListing,dateOnly,RuleError,type CreditInput,type Credit} from "../src/lib/finance";
import {legalReference} from "../src/lib/legal";
const base:CreditInput={amount:"2000",currency:"PEN",tea:"0.20",purchaseDate:"2026-07-08",months:1,cutDay:25,payDay:5,grace:"SS"};
const cases=[base,{...base,amount:"4800",tea:"0.25",purchaseDate:"2026-03-28",months:5,grace:"TPPSSSSSSS"},{...base,amount:"1500",tea:"0.15",purchaseDate:"2026-06-15",months:3,grace:"TTSSSS"}];
function credit(input:CreditInput=base):Credit{return {id:"test",clientId:"client",storeId:"store",clientName:"Prueba",packageName:"Paquete",currency:"PEN",schedule:simulate(input),payments:[]};}
test("los tres casos reproducen fila 0, cuota ordinaria, fechas y ajuste final",()=>{
  const expected=[["2028.56","1025.90","1025.89","51.79"],["4914.40","735.34","735.34","440.04"],["1511.69","387.95","387.94","51.79"]];
  cases.forEach((input,i)=>{const s=simulate(input),e=expected[i];assert.equal(s.initialBalance,e[0]);assert.equal(s.ordinaryPayment,e[1]);assert.equal(s.rows.at(-1)!.payment,e[2]);assert.equal(s.totals.interest,e[3]);assert.equal(s.rows.at(-1)!.closing,"0.00");});
  assert.equal(simulate(cases[1]).rows[9].dueDate,"2026-10-05");
  assert.equal(simulate(cases[2]).rows[5].dueDate,"2026-10-05");
});
test("moras al 35 por ciento, como el informe",()=>{
  assert.equal(lateFee("1025.89","2026-09-05","2026-09-10").amount,"4.28");
  assert.equal(lateFee("735.34","2026-07-20","2026-07-25").amount,"3.07");
  assert.equal(lateFee("735.34","2026-08-20","2026-09-01").amount,"7.39");
  assert.equal(lateFee("387.95","2026-09-05","2026-09-08").amount,"0.97");
  assert.equal(lateFee("1000","2026-09-05","2026-09-04").amount,"0.00");
});
test("calendario fijo, compra en y después del corte",()=>{
  assert.equal(calendar("2026-03-25",25,5).baseDate,"2026-04-05");
  assert.equal(calendar("2026-03-26",25,5).baseDate,"2026-05-05");
  assert.deepEqual(nextDueDates("2026-01-30",[15,30],5),["2026-02-15","2026-02-28","2026-03-15","2026-03-30","2026-04-15"]);
  assert.deepEqual(nextDueDates("2028-01-30",[15,30],3),["2028-02-15","2028-02-29","2028-03-15"]);
  assert.equal(calendar("2026-02-28",31,30).baseDate,"2026-03-30");
  assert.deepEqual(calendar("2026-01-02",10,20).dueDays,[5,20]);
  assert.throws(()=>dateOnly("2026-02-29"),RuleError);
});
test("las cuotas futuras nunca amortizan el saldo actual y las fechas de pago gobiernan el histórico",()=>{
  const c=credit(cases[1]);
  assert.equal(statement(c,"2026-03-27").outstanding,"0.00");
  assert.equal(statement(c,"2026-03-28").outstanding,"4800.00");
  assert.equal(statement(c,"2026-05-05").outstanding,"4914.40");
  assert.equal(statement(c,"2026-05-20").outstanding,"4960.31");
  assert.equal(statement(c,"2027-01-01").outstanding,"4960.31");
  const r=c.schedule.rows[3];c.payments.push({installmentNumber:4,paidDate:"2026-07-10",lateFee:"3.07",interest:r.interest,principal:r.principal,total:sum([r.payment,"3.07"])});
  assert.equal(statement(c,"2026-07-09").outstanding,"4960.31");
  assert.equal(statement(c,"2026-07-10").outstanding,"4271.30");
  assert.equal(statement(c,"2026-05-20").rows[0].status,"GRACIA_TOTAL");
  assert.equal(statement(c,"2026-05-20").rows[0].pending,"0.00");
  assert.equal(creditLine("1000",[c],"2026-07-10").available,"0.00");
});
test("rechazos de monto, tasa, plazo, gracia y calendario",()=>{
  for(const patch of [{amount:"800"},{amount:"1250"},{amount:"5100"},{amount:"NaN"},{tea:"0.28"},{tea:"0.14999"},{months:6},{months:0},{months:1.5},{grace:"TT"},{grace:"ST"},{grace:"SX"},{grace:"S"},{payDay:31},{cutDay:0},{mora:"0.15"},{currency:"EUR"}])assert.throws(()=>simulate({...base,...patch} as CreditInput),RuleError);
});
test("conciliación al céntimo en 150 combinaciones de monto, tasa, plazo y gracia",()=>{
  for(const amount of ["1000","2300","4800","5000","1500"])for(const tea of ["0.15","0.20","0.25"])for(let months=1;months<=5;months++)for(const grace of ["S".repeat(months*2),"T"+"P".repeat(months*2-2)+"S"]){
    const s=simulate({...base,amount,tea,months,grace});
    assert.equal(s.rows.at(-1)!.closing,"0.00");
    assert.equal(s.totals.principal,sum([s.initialBalance,...s.rows.map(r=>r.capitalized)]));
    assert.equal(s.totals.payments,sum([s.totals.principal,s.totals.cashInterest]));
    assert.equal(s.totals.interest,money(new D(s.totals.payments).minus(amount)));
    for(const r of s.rows){assert.equal(r.closing,money(new D(r.opening).plus(r.capitalized).minus(r.principal)));if(r.grace!=="T")assert.equal(r.payment,sum([r.principal,r.interest]));}
  }
});
test("el listado incluye las dos quincenas del ciclo y los atrasos anteriores",()=>{
  const c=credit(cases[1]),list=cutListing([c],"2026-08-25",25,"2026-08-26");
  assert.ok(list.rows.some(r=>r.dueDate==="2026-09-05"));assert.ok(list.rows.some(r=>r.dueDate==="2026-09-20"));
  assert.ok(list.rows.some(r=>r.dueDate==="2026-07-05"&&r.category==="ATRASO_ANTERIOR"));
  assert.ok(list.rows.every(r=>r.grace!=="T"&&r.dueDate<="2026-09-25"));
  assert.throws(()=>cutListing([c],"2026-08-24",25,"2026-08-26"),RuleError);
});
test("los límites compensatorio y moratorio tienen vigencia y moneda propias",()=>{
  assert.equal(legalReference("2026-09-26","PEN")?.moratory,"0.171195");
  assert.equal(legalReference("2026-03-28","USD")?.moratory,"0.143100");
  assert.equal(legalReference("2026-09-26","USD")?.moratory,"0.149760");
  assert.equal(legalReference("2027-01-01","PEN"),null);
});
