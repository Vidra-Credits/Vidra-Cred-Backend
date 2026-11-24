import {test} from "node:test";
import assert from "node:assert/strict";
import {D,simulate,money,sum,calendar,nextDueDates,statement,creditLine,lateFee,cutListing,dateOnly,RuleError,scenario,teaFromNominal,policyIssues,addDays,type CreditInput,type Credit} from "../src/lib/finance";
import {legalReference} from "../src/lib/legal";
const base:CreditInput={amount:"2000",currency:"PEN",tea:"0.20",purchaseDate:"2026-07-08",months:1,cutDay:25,payDay:5,grace:"SS"};
const cases=[base,{...base,amount:"4800",tea:"0.25",purchaseDate:"2026-03-28",months:5,grace:"TPPSSSSSSS"},{...base,amount:"1500",tea:"0.15",purchaseDate:"2026-06-15",months:3,grace:"TTSSSS"}];
function credit(input:CreditInput=base):Credit{return {id:"test",clientId:"client",storeId:"store",clientName:"Prueba",packageName:"Paquete",currency:"PEN",schedule:simulate(input),payments:[]};}

test("defensa: cuota total coincide con el pago real, sin inventar cobros pendientes ni futuros",()=>{
  const c=credit({...base,months:2,grace:"SSSS"}),r=c.schedule.rows[0];
  const paidDate=addDays(r.dueDate,10),fee=lateFee(r.payment,r.dueDate,paidDate);
  c.payments.push({installmentNumber:1,paidDate,lateFee:fee.amount,interest:r.interest,principal:r.principal,total:sum([r.payment,fee.amount])});
  const paid=statement(c,paidDate).rows[0];
  assert.ok(new D(paid.lateFee).gt(0));
  assert.equal(paid.totalPaid,sum([paid.payment,paid.lateFee]));
  assert.notEqual(paid.totalPaid,paid.payment);
  assert.equal(statement(c,r.dueDate).rows[0].totalPaid,"0.00");
  assert.equal(statement(c,paidDate).rows[1].totalPaid,"0.00");
  assert.equal(statement(c,addDays(paidDate,100)).rows[0].lateFee,fee.amount);
});

test("corte informa la tasa moratoria del contrato, incluso después de cambiar la ficha del cliente",()=>{
  const c=credit({...base,mora:"0.12"});
  const row=cutListing([c],"2026-08-25",25,"2026-08-30").rows[0];
  assert.ok(row);assert.equal(row.moraTea,"0.12");
  assert.equal(row.lateFee,lateFee(row.payment,row.dueDate,"2026-08-30","0.12").amount);
  assert.ok(new D(row.lateFee).gt(0));
});
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
  for(const patch of [{amount:"800"},{amount:"1250"},{amount:"5100"},{amount:"NaN"},{tea:"0.28"},{tea:"0.14999"},{months:6},{months:0},{months:1.5},{grace:"TT"},{grace:"ST"},{grace:"SX"},{grace:"S"},{payDay:31},{cutDay:0},{mora:"2.01"},{currency:"EUR"}])assert.throws(()=>simulate({...base,...patch} as CreditInput),RuleError);
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
test("el máximo moratorio de referencia tiene vigencia y moneda propias",()=>{
  assert.equal(legalReference("2026-09-26","PEN")?.moratory,"0.171195");
  assert.equal(legalReference("2026-03-28","USD")?.moratory,"0.143100");
  assert.equal(legalReference("2026-09-26","USD")?.moratory,"0.149760");
  assert.equal(legalReference("2027-01-01","PEN"),null);
});

test("TNA con capitalización se convierte a TEA y rechaza datos inválidos",()=>{
  assert.equal(teaFromNominal("0.12","MENSUAL").toFixed(6),"0.126825");
  assert.equal(teaFromNominal("0.12","ANUAL").toFixed(6),"0.120000");
  assert.equal(teaFromNominal("0.18","TRIMESTRAL").toFixed(6),"0.192519");
  assert.ok(teaFromNominal("0.18","DIARIA").gt(teaFromNominal("0.18","MENSUAL")));
  assert.throws(()=>teaFromNominal("-0.1","MENSUAL"),RuleError);
  assert.throws(()=>teaFromNominal("0.1","SEMANAL" as never),RuleError);
});
test("el escenario reproduce la mora real cuota por cuota y los totales concilian",()=>{
  const input={...base,amount:"3000",months:2,purchaseDate:"2026-08-10",grace:"SSSS"};
  const e=scenario(input,[10,10,10,10],"0.35");
  e.rows.forEach(r=>{assert.equal(r.daysLate,10);assert.equal(r.lateFee,lateFee(r.payment,r.dueDate,addDays(r.dueDate,10),"0.35").amount);assert.equal(r.total,money(new D(r.payment).plus(r.lateFee)));});
  assert.equal(e.rows[0].lateFee,"6.48");
  assert.equal(e.totals.totalPaid,sum([e.totals.installments,e.totals.lateFee]));
  assert.equal(e.totals.financialCost,money(new D(e.totals.totalPaid).minus(input.amount)));
  assert.equal(scenario(input,[0,0,0,0],"0.35").totals.lateFee,"0.00");
});
test("el escenario respeta el orden de pago, la gracia total y la tasa moratoria elegida",()=>{
  const input={...base,amount:"2000",months:2,purchaseDate:"2026-08-10",grace:"TSSS"};
  const e=scenario(input,[50,30,0,0],"0.35");
  assert.equal(e.rows[0].paidDate,null);assert.equal(e.rows[0].lateFee,"0.00");assert.equal(e.rows[0].total,"0.00");
  assert.equal(e.rows[1].daysLate,30);
  assert.equal(e.rows[2].paidDate,e.rows[1].paidDate);
  assert.equal(e.rows[2].daysLate,Math.max(0,Math.round((Date.parse(e.rows[2].paidDate!)-Date.parse(e.rows[2].dueDate))/864e5)));
  assert.ok(e.rows[2].daysLate>0);
  assert.ok(e.rows[3].paidDate!>=e.rows[2].paidDate!);
  const low=scenario(input,[10,10,10,10],"0.15"),high=scenario(input,[10,10,10,10],"0.60");
  assert.ok(new D(high.totals.lateFee).gt(low.totals.lateFee));
  assert.equal(scenario(input,[10,10,10,10],"0").totals.lateFee,"0.00");
});
test("modo exploración acepta valores fuera de la política y policyIssues los avisa; los créditos reales los rechazan",()=>{
  const wild={...base,amount:"12000",tea:"0.30",months:8,grace:"S".repeat(16)};
  assert.throws(()=>simulate(wild),RuleError);
  const e=scenario(wild,Array(16).fill(5),"0.35");
  assert.equal(e.rows.length,16);assert.equal(e.rows.at(-1)!.closing,"0.00");
  assert.equal(policyIssues(wild).length,3);
  assert.deepEqual(policyIssues({amount:"3000",tea:"0.20",months:3}),[]);
  assert.equal(policyIssues({amount:"1250",tea:"0.20",months:3}).length,1);
});
test("el escenario rechaza datos inválidos con RuleError",()=>{
  const ok={...base,months:1,grace:"SS"};
  for(const [delays,mora] of [[[-1,0],"0.35"],[[1.5,0],"0.35"],[[721,0],"0.35"],[[0,0],"3"],[[0,0],"abc"]] as [number[],string][])assert.throws(()=>scenario(ok,delays,mora),RuleError);
  for(const patch of [{amount:"50"},{tea:"1.5"},{tea:"0.005"},{months:13},{months:0},{grace:"TT"},{grace:"S"}])assert.throws(()=>scenario({...ok,...patch} as CreditInput,[0,0],"0.35"),RuleError);
});
test("barrido del escenario: 5 plazos × 4 gracias × 3 tasas × 3 atrasos concilian al céntimo",()=>{
  for(let months=1;months<=5;months++)for(const tea of ["0.15","0.2","0.25"])for(const delay of [0,7,45]){
    const n=months*2;
    for(const grace of ["S".repeat(n),"T"+"S".repeat(n-1),n>2?"TP"+"S".repeat(n-2):"P"+"S".repeat(n-1),n>3?"PP"+"S".repeat(n-2):"S".repeat(n)]){
      const e=scenario({...base,months,tea,grace,amount:"4200"},Array(n).fill(delay),"0.35");
      assert.equal(e.rows.at(-1)!.closing,"0.00");
      assert.equal(e.totals.totalPaid,sum([e.totals.installments,e.totals.lateFee]));
      assert.equal(e.totals.lateFee,sum(e.rows.map(r=>r.lateFee)));
      if(delay===0)assert.equal(e.totals.lateFee,"0.00");
      else assert.ok(new D(e.totals.lateFee).gt(0));
    }
  }
});

test("tasa por tramos: la cuota se recalcula con la tasa vigente, cierra en 0 y sin tramos es idéntico",()=>{
  const input={...base,amount:"4800",tea:"0.25",purchaseDate:"2026-03-28",months:5,grace:"TPPSSSSSSS"};
  const plain=simulate(input),same=simulate({...input,rateSteps:[]});
  assert.deepEqual(same.rows,plain.rows);assert.equal(same.ordinaryPayment,"735.34");
  const v=simulate({...input,rateSteps:[{from:6,tea:"0.18"}]});
  assert.equal(v.rows.at(-1)!.closing,"0.00");
  v.rows.forEach((r,k)=>assert.equal(r.tea,k+1>=6?"0.180000000000":"0.250000000000"));
  assert.deepEqual(v.rows.slice(0,5).map(r=>r.payment),plain.rows.slice(0,5).map(r=>r.payment));
  assert.ok(new D(v.rows[5].payment).lt(plain.rows[5].payment));
  assert.ok(new D(v.totals.interest).lt(plain.totals.interest));
  assert.equal(v.ordinaryPayment,"735.34");assert.equal(v.totals.payments,sum([v.totals.principal,v.totals.cashInterest]));
  const two=simulate({...input,rateSteps:[{from:5,tea:"0.20"},{from:8,tea:"0.15"}]});
  assert.equal(two.rows.at(-1)!.closing,"0.00");assert.equal(two.rows[4].tea,"0.200000000000");assert.equal(two.rows[7].tea,"0.150000000000");
});
test("tasa por tramos: valida orden, rango de cuota y tasa",()=>{
  const ok={...base,months:3,grace:"SSSSSS"};
  for(const rateSteps of [[{from:1,tea:"0.2"}],[{from:7,tea:"0.2"}],[{from:3,tea:"0.2"},{from:3,tea:"0.18"}],[{from:4,tea:"0.2"},{from:3,tea:"0.18"}],[{from:3,tea:"0.30"}],[{from:2.5,tea:"0.2"}],[{from:2,tea:"0.2"},{from:3,tea:"0.2"},{from:4,tea:"0.2"},{from:5,tea:"0.2"},{from:6,tea:"0.2"}]])assert.throws(()=>simulate({...ok,rateSteps}),RuleError);
  assert.ok(simulate({...ok,rateSteps:[{from:3,tea:"0.18"}]}).rows.length===6);
  assert.equal(scenario({...ok,tea:"0.3",rateSteps:[{from:3,tea:"0.5"}]},Array(6).fill(0),"0.35").rows[2].tea,"0.500000000000");
  assert.equal(policyIssues({amount:"3000",tea:"0.20",months:3,rateSteps:[{from:3,tea:"0.5"}]}).length,1);
});
test("pago único: una cuota en la fecha de pago con interés por los días de la compra al pago, y la mora sale de lateFee",()=>{
  const u=simulate({...base,months:0,grace:"",mode:"UNICO"});
  assert.equal(u.rows.length,1);assert.equal(u.rows[0].dueDate,"2026-08-05");assert.equal(u.initialDays,28);
  assert.equal(u.rows[0].interest,"28.56");assert.equal(u.rows[0].payment,"2028.56");assert.equal(u.totals.interest,"28.56");
  assert.equal(u.rows[0].principal,"2000.00");assert.equal(u.rows[0].closing,"0.00");assert.equal(u.totals.payments,sum([u.totals.principal,u.totals.cashInterest]));
  assert.equal(u.initialBalance,"2000.00");assert.equal(u.initialBalance,money(base.amount));
  const c=credit({...base,months:0,grace:"",mode:"UNICO"});
  assert.equal(statement(c,"2026-07-30").outstanding,"2000.00");
  assert.equal(statement(c,"2026-08-05").rows[0].pending,"2028.56");
  assert.equal(statement(c,"2026-08-15").rows[0].lateFee,lateFee("2028.56","2026-08-05","2026-08-15").amount);
  c.payments.push({installmentNumber:1,paidDate:"2026-08-05",lateFee:"0.00",interest:"28.56",principal:"2000.00",total:"2028.56"});
  assert.equal(statement(c,"2026-08-05").outstanding,"0.00");
  for(const patch of [{months:1},{grace:"SS"},{rateSteps:[{from:2,tea:"0.2"}]}])assert.throws(()=>simulate({...base,months:0,grace:"",mode:"UNICO",...patch} as CreditInput),RuleError);
  assert.throws(()=>simulate({...base,mode:"OTRO" as never}),RuleError);
});
test("el listado de corte ordena por cliente y fecha de compra, y separa por día de corte",()=>{
  const a=credit({...base,purchaseDate:"2026-07-08"}),b={...credit({...base,purchaseDate:"2026-06-20",cutDay:10,payDay:20,amount:"1500"}),clientName:"Zeta",id:"b"},c={...credit({...base,purchaseDate:"2026-06-10"}),clientName:"Alfa",id:"c"};
  const l=cutListing([a,b,c],"2026-08-25",25,"2026-08-26");
  assert.ok(l.rows.every(r=>r.creditId!=="b"));
  assert.deepEqual([...new Set(l.rows.map(r=>r.clientName))],["Alfa","Prueba"]);
  assert.ok(l.rows.every((r,i,arr)=>i===0||arr[i-1].clientName<r.clientName||arr[i-1].clientName===r.clientName&&arr[i-1].purchaseDate<=r.purchaseDate));
  assert.ok(cutListing([b],"2026-08-10",10,"2026-08-26").rows.every(r=>r.creditId==="b"));
});

test("el simulador reproduce los atrasos reales de los tres casos del informe (fila, fecha de pago y mora)",()=>{
  // Mismos índices de atraso que «Cargar caso 1/2/3» del simulador y que los pagos sembrados en la base de demostración.
  const late=[{1:5},{4:5,6:12},{3:3}] as Record<number,number>[];
  const expected=[
    {total:"4.28",rows:[[2,"2026-09-05","2026-09-10","4.28"]]},
    {total:"10.46",rows:[[5,"2026-07-20","2026-07-25","3.07"],[7,"2026-08-20","2026-09-01","7.39"]]},
    {total:"0.97",rows:[[4,"2026-09-05","2026-09-08","0.97"]]}
  ];
  cases.forEach((input,i)=>{
    const n=input.months*2,r=scenario(input,Array.from({length:n},(_,k)=>late[i][k]??0),"0.35");
    assert.equal(r.totals.lateFee,expected[i].total);
    const withFee=r.rows.filter(x=>x.daysLate>0).map(x=>[x.number,x.dueDate,x.paidDate,x.lateFee]);
    assert.deepEqual(withFee,expected[i].rows);
  });
});
