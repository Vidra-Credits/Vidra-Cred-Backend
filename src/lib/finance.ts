import Decimal from "decimal.js";

export const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
export const money = (v: Decimal.Value) => new D(v).toDecimalPlaces(2).toFixed(2);
export const sum = (values: Decimal.Value[]) => money(values.reduce<Decimal>((a,v)=>a.plus(v),new D(0)));
export const POLICY = { mora: "0.35", min: "1000", max: "5000", version: "VC-2026.1" } as const;
export type Currency = "PEN" | "USD";
export type Grace = "T" | "P" | "S";
export class RuleError extends Error {
  constructor(message: string, public field = "general", public status = 422) { super(message); }
}
export function dateOnly(s: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || !Number.isFinite(Date.parse(s+"T00:00:00Z")) || new Date(s+"T00:00:00Z").toISOString().slice(0,10)!==s || s<"1900-01-01" || s>"2199-12-31") throw new RuleError("Ingrese una fecha válida entre 1900 y 2199.","date");
  return s;
}
export const today = () => new Intl.DateTimeFormat("en-CA", {timeZone:"America/Lima",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
export const daysBetween = (a: string,b: string) => Math.round((Date.parse(dateOnly(b)+"T00:00:00Z")-Date.parse(dateOnly(a)+"T00:00:00Z"))/86400000);
export function monthDate(year: number, month: number, day: number) {
  const last = new Date(Date.UTC(year,month+1,0)).getUTCDate();
  return new Date(Date.UTC(year,month,Math.min(day,last))).toISOString().slice(0,10);
}
export function validateCalendar(cutDay: number, payDay: number) {
  if(!Number.isInteger(cutDay)||cutDay<1||cutDay>31) throw new RuleError("El corte debe estar entre 1 y 31.","cutDay");
  if(!Number.isInteger(payDay)||payDay<1||payDay>30) throw new RuleError("El día de pago debe estar entre 1 y 30.","payDay");
}
export function calendar(purchaseDate: string,cutDay: number,payDay: number) {
  dateOnly(purchaseDate); validateCalendar(cutDay,payDay);
  const p=new Date(purchaseDate+"T00:00:00Z"), y=p.getUTCFullYear(); let m=p.getUTCMonth();
  if(purchaseDate>monthDate(y,m,cutDay)) m++;
  const cutDate=monthDate(y,m,cutDay);
  const baseDate=monthDate(y,m+(payDay<=cutDay?1:0),payDay);
  return {cutDate,baseDate,dueDays:[payDay,((payDay+14)%30)+1].sort((a,b)=>a-b),initialDays:daysBetween(purchaseDate,baseDate)};
}
export function nextDueDates(baseDate: string,dueDays: number[],n: number) {
  const b=new Date(dateOnly(baseDate)+"T00:00:00Z"), result: string[]=[];
  for(let offset=0;result.length<n;offset++) {
    for(const day of dueDays) {
      const s=monthDate(b.getUTCFullYear(),b.getUTCMonth()+offset,day);
      if(s>baseDate && result.length<n && !result.includes(s)) result.push(s);
    }
  }
  return result;
}
export function decimalInput(value: unknown,field: string,min: string,max: string) {
  if(typeof value!=="string" || !/^\d+(\.\d{1,12})?$/.test(value) || !new D(value).isFinite() || new D(value).lt(min)||new D(value).gt(max)) throw new RuleError(`Valor permitido: ${min} a ${max}.`,field);
  return new D(value);
}
export type CreditInput = { amount: string; currency: Currency; tea: string; purchaseDate: string; months: number; cutDay: number; payDay: number; grace: string; mora?: string };
export type Installment = {number:number;dueDate:string;grace:Grace;opening:string;interest:string;payment:string;principal:string;closing:string;capitalized:string};
export type Schedule = {input:CreditInput;cutDate:string;baseDate:string;dueDays:number[];initialDays:number;initialInterest:string;initialBalance:string;teq:string;ordinaryPayment:string;rows:Installment[];totals:{interest:string;cashInterest:string;capitalized:string;payments:string;principal:string};policyVersion:string};
export function simulate(input: CreditInput): Schedule {
  const amount=decimalInput(input.amount,"amount","1000","5000");
  if(!amount.mod(100).eq(0)) throw new RuleError("El monto debe ser múltiplo de 100.","amount");
  const tea=decimalInput(input.tea,"tea","0.15","0.25");
  if(!["PEN","USD"].includes(input.currency)) throw new RuleError("Seleccione PEN o USD.","currency");
  if(input.mora && input.mora!==POLICY.mora) throw new RuleError("La política de mora es 35 % efectivo anual.","mora");
  if(!Number.isInteger(input.months)||input.months<1||input.months>5) throw new RuleError("El plazo debe estar entre 1 y 5 meses.","months");
  const n=input.months*2;
  if(typeof input.grace!=="string"||input.grace.length!==n||! /^(T|P)*S+$/.test(input.grace)) throw new RuleError(`Use ${n} letras T/P/S. La gracia va al inicio y debe quedar al menos una S.`,"grace");
  const cal=calendar(input.purchaseDate,input.cutDay,input.payDay);
  const rate=tea.plus(1).pow(new D(15).div(360)).minus(1);
  const initialBalance=money(amount.mul(tea.plus(1).pow(new D(cal.initialDays).div(360))));
  let balance=new D(initialBalance),ordinary=new D(0);
  const dates=nextDueDates(cal.baseDate,cal.dueDays,n),rows:Installment[]=[];
  for(let k=0;k<n;k++) {
    const grace=input.grace[k] as Grace,opening=money(balance),interest=money(balance.mul(rate));
    let payment="0.00",principal="0.00",capitalized="0.00";
    if(grace==="T") { capitalized=interest; balance=balance.plus(interest); }
    else if(grace==="P") payment=interest;
    else {
      if(ordinary.eq(0)) { const factor=rate.plus(1).pow(n-k); ordinary=new D(money(balance.mul(rate).mul(factor).div(factor.minus(1)))); }
      payment=k===n-1?money(balance.plus(interest)):money(ordinary);
      principal=money(new D(payment).minus(interest)); balance=balance.minus(principal);
    }
    rows.push({number:k+1,dueDate:dates[k],grace,opening,interest,payment,principal,closing:money(balance),capitalized});
  }
  const initialInterest=money(new D(initialBalance).minus(amount));
  return {input:{...input,mora:POLICY.mora},...cal,initialBalance,initialInterest,teq:rate.toFixed(30),ordinaryPayment:money(ordinary),rows,totals:{
    interest:sum([initialInterest,...rows.map(r=>r.interest)]),cashInterest:sum(rows.filter(r=>r.grace!=="T").map(r=>r.interest)),
    capitalized:sum([initialInterest,...rows.map(r=>r.capitalized)]),payments:sum(rows.map(r=>r.payment)),principal:sum(rows.map(r=>r.principal))
  },policyVersion:POLICY.version};
}
export function lateFee(amount: string,dueDate: string,paymentDate: string,rate: string=POLICY.mora) {
  const days=Math.max(0,daysBetween(dueDate,paymentDate));
  return {days,amount:money(new D(amount).mul(new D(rate).plus(1).pow(new D(days).div(360)).minus(1)))};
}
export type Payment = {id?:string;installmentNumber:number;paidDate:string;lateFee:string;interest:string;principal:string;total:string;reference?:string};
export type Credit = {id:string;clientId:string;storeId:string;clientName:string;packageName:string;currency:Currency;schedule:Schedule;payments:Payment[];createdAt?:string};
export function statement(credit: Credit,asOf: string) {
  dateOnly(asOf);
  const s=credit.schedule,active=s.input.purchaseDate<=asOf;
  const payments=credit.payments.filter(p=>p.paidDate<=asOf),initial=active&&s.baseDate<=asOf?s.initialInterest:"0.00";
  const capitalized=active?sum([initial,...s.rows.filter(r=>r.dueDate<=asOf).map(r=>r.capitalized)]):"0.00";
  const outstanding=active?money(D.max(0,new D(s.input.amount).plus(capitalized).minus(sum(payments.map(p=>p.principal))))):"0.00";
  const rows=s.rows.map(row=>{
    const p=payments.find(p=>p.installmentNumber===row.number);
    const fee=row.grace==="T"?{days:0,amount:"0.00"}:lateFee(row.payment,row.dueDate,p?.paidDate??asOf,s.input.mora);
    const status=!active?"NO_ORIGINADO":row.grace==="T"?(row.dueDate<=asOf?"GRACIA_TOTAL":"GRACIA_PROGRAMADA"):p?"PAGADA":row.dueDate<asOf?"VENCIDA":row.dueDate===asOf?"VENCE_HOY":"POR_VENCER";
    return {...row,status,paidDate:p?.paidDate??null,daysLate:fee.days,lateFee:p?.lateFee??fee.amount,totalPaid:p?.total??"0.00",pending:!active||p||row.grace==="T"?"0.00":money(new D(row.payment).plus(fee.amount))};
  });
  const unpaid=rows.filter(r=>r.grace!=="T"&&!r.paidDate&&active);
  return {id:credit.id,active,outstanding,capitalized,paid:sum(payments.map(p=>p.total)),paidPrincipal:sum(payments.map(p=>p.principal)),paidInterest:sum(payments.map(p=>p.interest)),paidLateFee:sum(payments.map(p=>p.lateFee)),
    overdue:sum(unpaid.filter(r=>r.dueDate<asOf).map(r=>r.pending)),dueToday:sum(unpaid.filter(r=>r.dueDate===asOf).map(r=>r.pending)),pendingLateFee:sum(unpaid.map(r=>r.lateFee)),
    projectedInterest:active?s.totals.interest:"0.00",futureCashInterest:sum(unpaid.filter(r=>r.dueDate>asOf).map(r=>r.interest)),
    nextDue:unpaid.filter(r=>r.dueDate>=asOf).sort((a,b)=>a.dueDate.localeCompare(b.dueDate))[0]?.dueDate??null,rows};
}
export function creditLine(limit: string,credits: Credit[],asOf:string) {
  const outstanding=sum(credits.map(c=>statement(c,asOf).outstanding));
  return {limit:money(limit),outstanding,available:money(D.max(0,new D(limit).minus(outstanding)))};
}
export function cycle(cutDate: string,cutDay: number) {
  const d=new Date(dateOnly(cutDate)+"T00:00:00Z");
  if(monthDate(d.getUTCFullYear(),d.getUTCMonth(),cutDay)!==cutDate) throw new RuleError("Seleccione la fecha de corte de la tienda.","cutDate");
  return {start:cutDate,end:monthDate(d.getUTCFullYear(),d.getUTCMonth()+1,cutDay)};
}
export function cutListing(credits:Credit[],cutDate:string,cutDay:number,asOf:string) {
  const range=cycle(cutDate,cutDay);
  return { ...range, rows:credits.flatMap(c=>statement(c,asOf).rows.filter(r=>r.pending!=="0.00"&&c.schedule.input.purchaseDate<=cutDate&&r.dueDate<=range.end).map(r=>({...r,creditId:c.id,clientId:c.clientId,clientName:c.clientName,packageName:c.packageName,currency:c.currency,category:r.dueDate<=range.start?"ATRASO_ANTERIOR":"CICLO"}))) };
}
