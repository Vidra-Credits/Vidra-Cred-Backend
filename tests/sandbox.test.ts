import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sandbox, type SandboxEdits} from '../src/lib/sandbox';
import {D, money, sum, scenario, RuleError, type CreditInput} from '../src/lib/finance';
const input:CreditInput={amount:'3000',tea:'0.2',currency:'PEN',months:3,grace:'SSSSSS',purchaseDate:'2026-07-08',cutDay:25,payDay:5};
const delays=[10,10,10,10,10,10];
function reconciles(edits:SandboxEdits){
  const s=sandbox(input,delays,'0.35',edits);
  s.rows.forEach((r,k)=>{
    assert.equal(r.total,sum([r.payment,r.lateFee]));
    assert.equal(r.closing,money(new D(r.opening).plus(r.capitalized).minus(r.principal)));
    if(r.grace!=='T')assert.equal(r.payment,sum([r.interest,r.principal]));
    if(k)assert.equal(r.opening,s.rows[k-1].closing);
  });
  assert.equal(s.totals.totalPaid,sum([s.totals.installments,s.totals.lateFee]));
  return s;
}
test('sandbox sin ediciones reproduce exactamente los escenarios originales y sus redondeos',()=>{
  for(const grace of ['SSSSSS','TPSSSS','TTSSSS','PPSSSS']){
    const i={...input,grace};
    assert.deepEqual(sandbox(i,delays,'0.35').rows,scenario(i,delays,'0.35').rows);
  }
});
test('ediciones de cuota, interés, amortización y saldo propagan y concilian',()=>{
  const original=sandbox(input,delays,'0.35');
  for(const [driver,value] of [['payment','650'],['principal','600'],['closing','2400'],['interest','100'],['opening','2500']] as const){
    const changed=reconciles({1:{driver,value}});
    assert.notEqual(changed.rows[2].opening,original.rows[2].opening,driver);
    assert.equal(changed.rows.at(-1)!.closing,'0.00');
  }
});
test('TEA y TEQ se propagan; un tramo posterior recupera la tasa pactada',()=>{
  const changed=reconciles({1:{tea:'0.4'}});
  assert.equal(changed.rows[0].tea,'0.200000000000');
  assert.ok(changed.rows.slice(1).every(r=>r.tea==='0.400000000000'));
  const q=reconciles({1:{teq:'0.01'}});
  assert.ok(new D(q.rows[1].teq!).minus('0.01').abs().lt('0.000000000001'));
  const stepped=sandbox({...input,rateSteps:[{from:4,tea:'0.18'}]},delays,'0.35',{1:{tea:'0.4'}});
  assert.equal(stepped.rows[3].tea,'0.180000000000');
});
test('mora editable se suma a la cuota y el total puede determinar la cuota base',()=>{
  const m=reconciles({1:{lateFee:'25'}});
  assert.equal(m.rows[1].total,sum([m.rows[1].payment,'25']));
  const t=reconciles({1:{lateFee:'25',driver:'total',value:'700'}});
  assert.equal(t.rows[1].payment,'675.00');assert.equal(t.rows[1].total,'700.00');
  assert.equal(sandbox(input,Array(6).fill(0),'0.35').totals.lateFee,'0.00');
  assert.ok(new D(m.totals.lateFee).gt(0));
});
test('vencimientos arrastran el desfase y pagos tardíos arrastran las fechas posteriores',()=>{
  const old=sandbox(input,delays,'0.35');
  const shifted=reconciles({1:{dueDate:'2026-09-07'}});
  assert.equal(shifted.rows[2].dueDate,'2026-09-22');
  assert.equal(shifted.rows[0].dueDate,old.rows[0].dueDate);
  const paid=reconciles({1:{paidDate:'2026-10-01'}});
  assert.equal(paid.rows[2].paidDate,'2026-10-01');assert.ok(paid.rows[2].daysLate>0);
});
test('gracias editables, errores recuperables y saldo final manual explícito',()=>{
  const t=reconciles({0:{grace:'T'}});assert.equal(t.rows[0].total,'0.00');
  const p=reconciles({0:{grace:'P'}});assert.equal(p.rows[0].payment,p.rows[0].interest);
  const last=reconciles({5:{driver:'payment',value:'100'}});assert.ok(new D(last.rows[5].closing).gt(0));
  for(const edit of [{tea:'abc'},{driver:'payment',value:'999999'},{dueDate:'2026-01-01'},{paidDate:'2026-01-01'},{grace:'T',lateFee:'10'}] as const){
    assert.throws(()=>sandbox(input,delays,'0.35',{0:edit}),RuleError);
  }
});
