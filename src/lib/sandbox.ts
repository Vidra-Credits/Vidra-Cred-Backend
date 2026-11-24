import type Decimal from "decimal.js";
import {D, money, sum, simulate, lateFee, addDays, daysBetween, dateOnly, RuleError, periodsPerMonth, periodDays, EXPLORE_LIMITS, MAX_DELAY_DAYS, type CreditInput, type Grace, type ScenarioRow} from './finance';

export type Driver = 'opening'|'interest'|'payment'|'principal'|'closing'|'total';
export type CellEdit = {dueDate?:string; grace?:Grace; tea?:string; teq?:string; paidDate?:string; lateFee?:string; driver?:Driver; value?:string};
export type SandboxEdits = Record<number,CellEdit>;
type AnnuityTrace={row:number;opening:string;growth:string;factor:string};
/** Each row's last edited financial value drives its dependent formulas. Rates and balances carry forward. */
export function sandbox(input:CreditInput, delays:number[], moraTea:string, edits:SandboxEdits={}) {
  edits=Object.fromEntries(Object.entries(edits).map(([k,v])=>[k,{...v}]));
  // An opening balance is the previous row's closing balance, never an independent constant.
  for(let k=1;k<(input.mode==='UNICO'?1:input.months*periodsPerMonth(input.frequency));k++)if(edits[k]?.driver==='opening'){
    edits[k-1]={...edits[k-1],driver:'closing',value:edits[k].value};delete edits[k].driver;delete edits[k].value;
  }
  const schedule=simulate(input,{...EXPLORE_LIMITS,teaMin:"0"}), mora=new D(moraTea);
  if(!mora.isFinite()||mora.lt(0)||mora.gt(2))throw new RuleError('La tasa moratoria debe estar entre 0 y 200 %.');
  const value=(s:string)=>{if(!/^\d+(\.\d{1,12})?$/.test(s))throw new RuleError('Ingrese un número no negativo con hasta 12 decimales.');return new D(s);};
  let balance=new D(schedule.initialBalance), previousPaid='', previousDue=input.mode==='UNICO'?input.purchaseDate:schedule.baseDate, carriedTea:string|undefined, dirty=false, dateShift=0, ordinary:Decimal|null=null, lastRate:Decimal|null=null;
  const rows:ScenarioRow[]=[],calculations:{annuity:AnnuityTrace|null;edit:CellEdit}[]=[];
  let annuityTrace:AnnuityTrace|null=null;
  for(let k=0;k<schedule.rows.length;k++) {
    const base=schedule.rows[k], edit=edits[k]??{}, count=schedule.rows.length-k;
    if(edit.tea!==undefined)carriedTea=value(edit.tea).toString();
    if(edit.teq!==undefined)carriedTea=value(edit.teq).plus(1).pow(360/periodDays(input.frequency)).minus(1).toString();
    // A contracted rate step starts a new rate segment unless this row sets its own rate.
    if(k>0&&base.tea!==schedule.rows[k-1].tea&&edit.tea===undefined&&edit.teq===undefined)carriedTea=undefined;
    const tea=new D(carriedTea??base.tea??input.tea), q=tea.plus(1).pow(new D(periodDays(input.frequency)).div(360)).minus(1);
    if(tea.gt(10))throw new RuleError('La TEA por fila no debe superar 1000 %.');
    if(edit.driver||edit.grace!==undefined||edit.tea!==undefined||edit.teq!==undefined){dirty=true;ordinary=null;}
    if(lastRate&&!lastRate.eq(q))ordinary=null;lastRate=q;
    if(edit.dueDate)dateShift=daysBetween(base.dueDate,dateOnly(edit.dueDate));
    const grace=edit.grace??base.grace, dueDate=addDays(base.dueDate,dateShift);
    if(input.mode==='UNICO' ? dueDate<previousDue : dueDate<=previousDue)
      throw new RuleError(input.mode==='UNICO'?'El vencimiento debe ser igual o posterior a la compra.':`Cuota ${k+1}: el vencimiento debe ser posterior al anterior.`);
    if(input.mode==='UNICO')schedule.initialDays=daysBetween(input.purchaseDate,dueDate);
    if(input.mode==='UNICO'&&edit.grace&&edit.grace!=='S')throw new RuleError('El pago único no lleva período de gracia.');
    previousDue=dueDate;
    if(edit.driver==='opening')balance=value(edit.value!);
    if(k===0&&edit.driver==='opening'){
      if(balance.lt(input.amount))throw new RuleError('El saldo inicial no puede ser menor que el monto financiado. Reduzca primero el monto del escenario.');
      schedule.initialBalance=money(balance);
      schedule.initialInterest=money(balance.minus(input.amount));
    }
    const opening=money(balance);
    let interest=edit.driver==='interest'?money(value(edit.value!)):money(balance.mul(q));
    // Single-payment interest uses the purchase-to-payment interval.
    if(input.mode==='UNICO'&&edit.driver!=='interest')interest=money(balance.mul(tea.plus(1).pow(new D(schedule.initialDays).div(360)).minus(1)));
    let payment='0.00', principal='0.00', capitalized='0.00', usedAnnuity:AnnuityTrace|null=null;
    const requested=delays[k]??0;
    if(!Number.isInteger(requested)||requested<0||requested>MAX_DELAY_DAYS)throw new RuleError(`El atraso debe ser un entero entre 0 y ${MAX_DELAY_DAYS}.`);
    let paidDate=edit.paidDate?dateOnly(edit.paidDate):addDays(dueDate,requested);
    if(paidDate<dueDate)throw new RuleError('La fecha de pago simulado debe ser igual o posterior al vencimiento.');
    if(previousPaid&&paidDate<previousPaid)paidDate=previousPaid;
    const daysLate=daysBetween(dueDate,paidDate), factor=mora.plus(1).pow(new D(daysLate).div(360)).minus(1);
    if(grace==='T') {
      if((edit.driver&&edit.driver!=='opening'&&edit.driver!=='interest')||(edit.lateFee!==undefined&&!value(edit.lateFee).eq(0)))throw new RuleError(`Cuota ${k+1}: cambie PG a S para editar el pago o la mora de una fila de gracia total.`);
      capitalized=interest;balance=balance.plus(interest);ordinary=null;
    }
    else {
      if(ordinary===null){
        let growth=new D(1),payments=new D(0);
        for(let j=k;j<schedule.rows.length;j++){
          const futureGrace=edits[j]?.grace??schedule.rows[j].grace;
          if(futureGrace!=="P"){growth=growth.mul(q.plus(1));payments=payments.mul(q.plus(1));}
          if(futureGrace==="S")payments=payments.plus(1);
        }
        ordinary=payments.eq(0)?new D(0):new D(money(balance.mul(growth).div(payments)));
        annuityTrace={row:k+1,opening,growth:growth.toFixed(12),factor:payments.toFixed(12)};
      }
      const annuity=ordinary;
      payment=grace==='P'?interest:k===schedule.rows.length-1?money(balance.plus(interest)):dirty?money(annuity):base.payment;
      if(edit.driver==='payment')payment=money(value(edit.value!));
      if(edit.driver==='principal')payment=money(value(edit.value!).plus(interest));
      if(edit.driver==='closing')payment=money(balance.minus(value(edit.value!)).plus(interest));
      if(edit.driver==='total')payment=edit.lateFee!==undefined?money(value(edit.value!).minus(value(edit.lateFee))):money(value(edit.value!).div(factor.plus(1)));
      principal=money(new D(payment).minus(interest));
      if(new D(principal).lt(0)||new D(principal).gt(balance))throw new RuleError(`Cuota ${k+1}: el pago debe cubrir el interés y como máximo el saldo más el interés.`);
      if(grace==='P'&&!new D(principal).eq(0))throw new RuleError('La gracia parcial paga solo interés. Cambie PG a S para amortizar.');
      if(grace==="S"&&k<schedule.rows.length-1&&!edit.driver)usedAnnuity=annuityTrace;
      balance=balance.minus(principal);previousPaid=paidDate;
      if(edit.driver||grace==="P")ordinary=null;
    }
    const fee=grace==='T'?'0.00':edit.lateFee!==undefined?money(value(edit.lateFee)):lateFee(payment,dueDate,paidDate,mora.toString()).amount;
    if(edit.driver==='total'&&money(new D(payment).plus(fee))!==money(value(edit.value!)))throw new RuleError('Ese total no concilia al céntimo con la mora. Ajuste la cuota base o la mora.');
    rows.push({...base,dueDate,grace,tea:tea.toFixed(12),teq:q.toFixed(30),opening,interest,payment,principal,closing:money(balance),capitalized,requestedDelay:grace==='T'?0:requested,paidDate:grace==='T'?null:paidDate,daysLate:grace==='T'?0:daysLate,lateFee:fee,total:money(new D(payment).plus(fee))});
    calculations.push({annuity:usedAnnuity,edit});
  }
  schedule.rows=rows;
  schedule.ordinaryPayment=rows.find(r=>r.grace==='S')?.payment??rows[0].payment;
  schedule.totals={interest:sum([schedule.initialInterest,...rows.map(r=>r.interest)]),cashInterest:sum(rows.filter(r=>r.grace!=='T').map(r=>r.interest)),capitalized:sum([schedule.initialInterest,...rows.map(r=>r.capitalized)]),payments:sum(rows.map(r=>r.payment)),principal:sum(rows.map(r=>r.principal))};
  const lateTotal=sum(rows.map(r=>r.lateFee));
  return {schedule,rows,calculations,moraTea:mora.toFixed(12),ted:mora.plus(1).pow(new D(1).div(360)).minus(1).toFixed(12),totals:{installments:schedule.totals.payments,lateFee:lateTotal,totalPaid:sum(rows.map(r=>r.total)),interest:schedule.totals.interest,financialCost:money(new D(schedule.totals.interest).plus(lateTotal))}};
}
