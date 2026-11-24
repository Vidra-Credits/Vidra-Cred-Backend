import {test} from 'node:test';
import assert from 'node:assert/strict';
import {simulate, money, sum, D, lateFee, type CreditInput} from '../src/lib/finance';
import {sandbox} from '../src/lib/sandbox';
const monthly:CreditInput={amount:'2000',currency:'PEN',tea:'0.20',purchaseDate:'2026-09-15',months:3,cutDay:20,payDay:26,grace:'SSS',frequency:'MENSUAL'};
test('ejemplo literal del enunciado: 11 días de gracia inicial, luego octubre, noviembre y diciembre',()=>{
  const s=simulate(monthly);
  assert.equal(s.baseDate,'2026-09-26');assert.equal(s.initialDays,11);
  assert.deepEqual(s.rows.map(r=>r.dueDate),['2026-10-26','2026-11-26','2026-12-26']);
  // Independent floating-point reference, sufficiently far from half-cent ties.
  const p=Math.round(2000*Math.pow(1.2,11/360)*100)/100, i=Math.pow(1.2,1/12)-1;
  const payment=(p*i/(1-Math.pow(1+i,-3))).toFixed(2);
  assert.equal(s.initialBalance,p.toFixed(2));assert.equal(s.ordinaryPayment,payment);
  assert.equal(s.rows.at(-1)!.closing,'0.00');
  assert.equal(s.totals.payments,money(new D(monthly.amount).plus(s.totals.interest)));
});
test('compra posterior al corte y meses cortos mantienen el día pactado sin deriva',()=>{
  const onCut=simulate({...monthly,purchaseDate:'2026-09-20'});
  assert.equal(onCut.cutDate,'2026-09-20');assert.equal(onCut.rows[0].dueDate,'2026-10-26');
  const s=simulate({...monthly,purchaseDate:'2026-09-21'});
  assert.equal(s.baseDate,'2026-10-26');assert.equal(s.rows[0].dueDate,'2026-11-26');
  const feb=simulate({...monthly,purchaseDate:'2026-01-10',payDay:30});
  assert.deepEqual(feb.rows.map(r=>r.dueDate),['2026-02-28','2026-03-30','2026-04-30']);
});
test('pago único editable reproduce la fecha pactada, el interés diario y la mora',()=>{
  const input={...monthly,months:0,grace:"",mode:"UNICO" as const};
  const single=sandbox(input,[10],"0.35");
  assert.equal(single.rows.length,1);
  assert.equal(single.rows[0].dueDate,"2026-09-26");
  assert.equal(single.rows[0].interest,"11.17");
  assert.equal(single.rows[0].lateFee,lateFee("2011.17","2026-09-26","2026-10-06").amount);
  const edited=sandbox(input,[5],"0.35",{0:{dueDate:"2026-09-30"}});
  assert.equal(edited.schedule.initialDays,15);
  assert.equal(edited.rows[0].closing,"0.00");
  assert.ok(Number(edited.rows[0].interest)>Number(single.rows[0].interest));
});
test('dos escenarios mensuales: gracia total y parcial conservan identidades y saldo cero',()=>{
  for(const grace of ['SSSSS','TSSSS','TPSSS','PPSSS']){
    const input={...monthly,months:5,grace},s=sandbox(input,Array(5).fill(7),'0.35');
    assert.equal(s.rows.length,5);assert.equal(s.rows.at(-1)!.closing,'0.00');
    s.rows.forEach(r=>{assert.equal(r.total,sum([r.payment,r.lateFee]));assert.equal(r.closing,money(new D(r.opening).plus(r.capitalized).minus(r.principal)));});
    assert.equal(s.totals.totalPaid,sum([s.totals.installments,s.totals.lateFee]));
  }
});
test('sandbox mensual: tasa cero, cambio de tasa, gracia intermedia y edición inversa',()=>{
  const zero=sandbox({...monthly,tea:'0'},[0,0,0],'0');
  assert.equal(zero.totals.totalPaid,'2000.00');assert.equal(zero.rows.at(-1)!.closing,'0.00');
  const raised=sandbox(monthly,[10,10,10],'0.35',{1:{tea:'0.4'}});
  assert.equal(raised.rows[1].teq,new D(1.4).pow(new D(30).div(360)).minus(1).toFixed(30));
  assert.equal(raised.rows.at(-1)!.closing,'0.00');
  const interspersed=sandbox({...monthly,months:5,grace:'SSSSS'},[], '0.35',{2:{grace:'T'}});
  assert.equal(interspersed.rows.at(-1)!.closing,'0.00');
  assert.equal(interspersed.rows[2].payment,'0.00');
  const inverse=sandbox(monthly,[10,10,10],'0.35',{1:{driver:'total',value:'750',lateFee:'5'}});
  assert.equal(inverse.rows[1].payment,'745.00');assert.equal(inverse.rows[1].total,'750.00');
});
test('tasa moratoria pactada forma parte del cronograma y determina el recargo',()=>{
  const s=simulate({...monthly,mora:'0.12'});
  assert.equal(s.input.mora,'0.12');
  assert.ok(new D(lateFee(s.rows[0].payment,'2026-10-26','2026-11-05','0.12').amount).lt(lateFee(s.rows[0].payment,'2026-10-26','2026-11-05','0.35').amount));
});
