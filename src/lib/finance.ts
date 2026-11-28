import Decimal from "decimal.js";

export const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
export const money = (v: Decimal.Value) => new D(v).toDecimalPlaces(2).toFixed(2);
export const sum = (values: Decimal.Value[]) => money(values.reduce<Decimal>((a,v)=>a.plus(v),new D(0)));
export const POLICY = { mora: "0.35", min: "1000", max: "5000", version: "VC-2026.1" } as const;
export type Frequency = "MENSUAL" | "QUINCENAL";
export const periodsPerMonth = (frequency?:Frequency) => frequency==="MENSUAL"?1:2;
export const periodDays = (frequency?:Frequency) => frequency==="MENSUAL"?30:15;
export const periodLabel = (frequency?:Frequency) => frequency==="MENSUAL"?"TEM":"TEQ";
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
export function validateMoratoryRate(mora: Decimal.Value, tea: Decimal.Value, field="mora") {
  if(new D(mora).lt(tea)) {
    throw new RuleError("La TEA moratoria debe ser igual o mayor que la TEA compensatoria.",field);
  }
}
/** Cambio de TEA durante el plazo: desde la cuota `from` (2..n) rige `tea`. */
export type RateStep = { from: number; tea: string };
export type SaleMode = "CUOTAS" | "UNICO";
export type CreditInput = { amount: string; currency: Currency; tea: string; purchaseDate: string; months: number; cutDay: number; payDay: number; grace: string; mora?: string; rateSteps?: RateStep[]; mode?: SaleMode; frequency?:Frequency };
/** `tea` y `teq` están en las filas de créditos nuevos; los cronogramas guardados antes de la tasa por tramos usan la del crédito. */
export type Installment = {number:number;dueDate:string;grace:Grace;opening:string;interest:string;payment:string;principal:string;closing:string;capitalized:string;tea?:string;teq?:string};
export type Schedule = {input:CreditInput;cutDate:string;baseDate:string;dueDays:number[];initialDays:number;initialInterest:string;initialBalance:string;teq:string;ordinaryPayment:string;rows:Installment[];totals:{interest:string;cashInterest:string;capitalized:string;payments:string;principal:string};policyVersion:string};
/** Rangos aceptados por el motor. Los créditos reales usan siempre POLICY_LIMITS; el simulador de escenarios puede explorar con EXPLORE_LIMITS. */
export type Limits = { teaMin: string; teaMax: string; amountMin: string; amountMax: string; amountStep: string; maxMonths: number };
export const POLICY_LIMITS: Limits = { teaMin: "0.15", teaMax: "0.25", amountMin: "1000", amountMax: "5000", amountStep: "100", maxMonths: 5 };
export const EXPLORE_LIMITS: Limits = { teaMin: "0.01", teaMax: "1", amountMin: "100", amountMax: "1000000", amountStep: "1", maxMonths: 12 };
export function simulate(input: CreditInput, limits: Limits = POLICY_LIMITS): Schedule {
  const amount=decimalInput(input.amount,"amount",limits.amountMin,limits.amountMax);
  if(!amount.mod(limits.amountStep).eq(0)) throw new RuleError(`El monto debe ser múltiplo de ${limits.amountStep}.`,"amount");
  const tea=decimalInput(input.tea,"tea",limits.teaMin,limits.teaMax);
  if(!["PEN","USD"].includes(input.currency)) throw new RuleError("Seleccione PEN o USD.","currency");
  const mora=decimalInput(input.mora??POLICY.mora,"mora","0","2").toString();
  const mode:SaleMode=input.mode??"CUOTAS";
  if(mode!=="CUOTAS"&&mode!=="UNICO") throw new RuleError("Elija pago único o en cuotas.","mode");
  if(input.frequency!==undefined&&!["MENSUAL","QUINCENAL"].includes(input.frequency))throw new RuleError("Frecuencia no válida.","frequency");
  const quarter=(t:Decimal)=>t.plus(1).pow(new D(periodDays(input.frequency)).div(360)).minus(1);
  const cal=calendar(input.purchaseDate,input.cutDay,input.payDay);
  if(input.frequency==="MENSUAL")cal.dueDays=[input.payDay];
  if(mode==="UNICO") {
    // Compra para pagar de una sola vez en la fecha de pago: interés por los días entre la compra y esa fecha.
    if(input.months!==0||(input.grace??"")!==""||(input.rateSteps?.length??0)>0) throw new RuleError("El pago único no lleva plazo, gracia ni cambio de tasa.","mode");
    const interest=money(amount.mul(tea.plus(1).pow(new D(cal.initialDays).div(360))).minus(amount)),principal=money(amount),payment=money(new D(principal).plus(interest));
    const row:Installment={number:1,dueDate:cal.baseDate,grace:"S",opening:principal,interest,payment,principal,closing:"0.00",capitalized:"0.00",tea:tea.toFixed(12),teq:quarter(tea).toFixed(30)};
    return {input:{...input,frequency:input.frequency??"QUINCENAL",mode,months:0,grace:"",rateSteps:[],mora},...cal,initialBalance:principal,initialInterest:"0.00",teq:quarter(tea).toFixed(30),ordinaryPayment:payment,rows:[row],totals:{interest,cashInterest:interest,capitalized:"0.00",payments:payment,principal},policyVersion:POLICY.version};
  }
  if(!Number.isInteger(input.months)||input.months<1||input.months>limits.maxMonths) throw new RuleError(`El plazo debe estar entre 1 y ${limits.maxMonths} meses.`,"months");
  const n=input.months*periodsPerMonth(input.frequency);
  if(typeof input.grace!=="string"||input.grace.length!==n||! /^(T|P)*S+$/.test(input.grace)) throw new RuleError(`Use ${n} letras T/P/S. La gracia va al inicio y debe quedar al menos una S.`,"grace");
  const steps=(input.rateSteps??[]).map(st=>({from:st.from,tea:st.tea}));
  if(steps.length>4) throw new RuleError("Se admiten hasta 4 cambios de tasa.","rateSteps");
  steps.forEach((st,i)=>{
    if(!Number.isInteger(st.from)||st.from<2||st.from>n) throw new RuleError(`El cambio de tasa debe empezar entre la cuota 2 y la ${n}.`,"rateSteps");
    if(i>0&&st.from<=steps[i-1].from) throw new RuleError("Los cambios de tasa deben ir en orden creciente de cuota.","rateSteps");
    decimalInput(st.tea,"rateSteps",limits.teaMin,limits.teaMax);
  });
  const teaAt=(k:number)=>steps.reduce<Decimal>((t,st)=>k+1>=st.from?new D(st.tea):t,tea);
  const rate=quarter(tea);
  const initialBalance=money(amount.mul(tea.plus(1).pow(new D(cal.initialDays).div(360))));
  let balance=new D(initialBalance),ordinary=new D(0),first=new D(0),lastRate:Decimal|null=null;
  const dates=nextDueDates(cal.baseDate,cal.dueDays,n),rows:Installment[]=[];
  for(let k=0;k<n;k++) {
    const rowTea=teaAt(k),rowRate=quarter(rowTea);
    if(lastRate&&!rowRate.eq(lastRate)) ordinary=new D(0); // nuevo tramo: la cuota francesa se recalcula con la tasa vigente
    lastRate=rowRate;
    const grace=input.grace[k] as Grace,opening=money(balance),interest=money(balance.mul(rowRate));
    let payment="0.00",principal="0.00",capitalized="0.00";
    if(grace==="T") { capitalized=interest; balance=balance.plus(interest); }
    else if(grace==="P") payment=interest;
    else {
      if(ordinary.eq(0)) { const factor=rowRate.plus(1).pow(n-k); ordinary=new D(money(rowRate.eq(0)?balance.div(n-k):balance.mul(rowRate).mul(factor).div(factor.minus(1)))); if(first.eq(0)) first=ordinary; }
      payment=k===n-1?money(balance.plus(interest)):money(ordinary);
      principal=money(new D(payment).minus(interest)); balance=balance.minus(principal);
    }
    rows.push({number:k+1,dueDate:dates[k],grace,opening,interest,payment,principal,closing:money(balance),capitalized,tea:rowTea.toFixed(12),teq:rowRate.toFixed(30)});
  }
  const initialInterest=money(new D(initialBalance).minus(amount));
  return {input:{...input,frequency:input.frequency??"QUINCENAL",mode,rateSteps:steps,mora},...cal,initialBalance,initialInterest,teq:rate.toFixed(30),ordinaryPayment:money(first),rows,totals:{
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
  // Solo los créditos cuyo corte pactado es este día; orden: cliente → fecha de compra → vencimiento.
  const rows=credits.filter(c=>(c.schedule.input.cutDay??cutDay)===cutDay).flatMap(c=>statement(c,asOf).rows.filter(r=>r.pending!=="0.00"&&c.schedule.input.purchaseDate<=cutDate&&r.dueDate<=range.end).map(r=>({...r,creditId:c.id,clientId:c.clientId,clientName:c.clientName,packageName:c.packageName,currency:c.currency,moraTea:c.schedule.input.mora??POLICY.mora,purchaseDate:c.schedule.input.purchaseDate,category:r.dueDate<=range.start?"ATRASO_ANTERIOR":"CICLO"})));
  rows.sort((a,b)=>a.clientName.localeCompare(b.clientName)||a.purchaseDate.localeCompare(b.purchaseDate)||a.dueDate.localeCompare(b.dueDate)||a.number-b.number);
  return { ...range, rows };
}

/* ───────── Simulador de escenarios (sin base de datos) ───────── */
/** Periodos de capitalización por año para convertir una tasa nominal (TNA) en efectiva. Año comercial de 360 días, mes de 30. */
export const COMPOUNDING = { DIARIA: 360, QUINCENAL: 24, MENSUAL: 12, BIMESTRAL: 6, TRIMESTRAL: 4, SEMESTRAL: 2, ANUAL: 1 } as const;
export type Compounding = keyof typeof COMPOUNDING;
/** TEA = (1 + TNA/m)^m − 1, con m periodos de capitalización por año. */
export function teaFromNominal(tna: Decimal.Value, compounding: Compounding) {
  const m = COMPOUNDING[compounding];
  if (!m) throw new RuleError("Seleccione una capitalización válida.", "compounding");
  const j = new D(tna);
  if (!j.isFinite() || j.lt(0)) throw new RuleError("La tasa nominal no puede ser negativa.", "tea");
  return new D(1).plus(j.div(m)).pow(m).minus(1);
}
export function addDays(date: string, days: number) {
  return new Date(Date.parse(dateOnly(date) + "T00:00:00Z") + days * 86400000).toISOString().slice(0, 10);
}
/** Avisos (no bloqueos) cuando un escenario sale de lo que el sistema aceptaría registrar con la política VC-2026.1. */
export function policyIssues(input: Pick<CreditInput, "amount" | "tea" | "months" | "rateSteps">) {
  const out: string[] = [], L = POLICY_LIMITS;
  const amount = new D(input.amount), tea = new D(input.tea);
  if (amount.lt(L.amountMin) || amount.gt(L.amountMax)) out.push(`El monto está fuera de ${L.amountMin}–${L.amountMax}: el sistema no lo registraría.`);
  else if (!amount.mod(L.amountStep).eq(0)) out.push(`El monto no es múltiplo de ${L.amountStep}: el sistema no lo registraría.`);
  if (tea.lt(L.teaMin) || tea.gt(L.teaMax)) out.push(`La TEA equivalente (${tea.mul(100).toDecimalPlaces(4).toString()} %) está fuera del rango pactable de ${new D(L.teaMin).mul(100)} % a ${new D(L.teaMax).mul(100)} %.`);
  if (input.months > L.maxMonths) out.push(`El plazo supera los ${L.maxMonths} meses que admite la política.`);
  (input.rateSteps ?? []).forEach(st => { const t = new D(st.tea); if (t.lt(L.teaMin) || t.gt(L.teaMax)) out.push(`La TEA del cambio desde la cuota ${st.from} (${t.mul(100).toDecimalPlaces(4).toString()} %) está fuera de ${new D(L.teaMin).mul(100)} %–${new D(L.teaMax).mul(100)} %.`); });
  if ((input.rateSteps?.length ?? 0) > 4) out.push("La política admite hasta 4 cambios de tasa.");
  return out;
}
export const MAX_DELAY_DAYS = 720;
export type ScenarioRow = Installment & { requestedDelay: number; paidDate: string | null; daysLate: number; lateFee: string; total: string };
/**
 * Escenario de pago sobre un cronograma: cada cuota cobrable se paga `delays[k]` días después de su vencimiento
 * y genera mora = cuota × ((1 + TEA moratoria)^(días/360) − 1), la misma fórmula de lateFee() y de los cobros reales.
 * Las cuotas se pagan en orden (como en el registro de pagos): una cuota no puede pagarse antes que la anterior.
 * La gracia total (T) no genera cobro ni mora. No escribe nada: es solo cálculo.
 */
export function scenario(input: CreditInput, delays: number[], moraTea: string, limits: Limits = EXPLORE_LIMITS) {
  const mora = decimalInput(moraTea, "mora", "0", "2");
  const schedule = simulate(input, limits);
  let previousPaid = "";
  const rows: ScenarioRow[] = schedule.rows.map((r, k) => {
    const requested = delays[k] ?? 0;
    if (!Number.isInteger(requested) || requested < 0 || requested > MAX_DELAY_DAYS) throw new RuleError(`Los días de atraso deben ser enteros entre 0 y ${MAX_DELAY_DAYS}.`, "delay");
    if (r.grace === "T") return { ...r, requestedDelay: 0, paidDate: null, daysLate: 0, lateFee: "0.00", total: "0.00" };
    let paid = addDays(r.dueDate, requested);
    if (previousPaid && paid < previousPaid) paid = previousPaid;
    previousPaid = paid;
    const fee = lateFee(r.payment, r.dueDate, paid, mora.toFixed(12));
    return { ...r, requestedDelay: requested, paidDate: paid, daysLate: fee.days, lateFee: fee.amount, total: money(new D(r.payment).plus(fee.amount)) };
  });
  const lateTotal = sum(rows.map(r => r.lateFee));
  return {
    schedule, rows, moraTea: mora.toFixed(12), ted: mora.plus(1).pow(new D(1).div(360)).minus(1).toFixed(12),
    totals: {
      installments: schedule.totals.payments, lateFee: lateTotal, totalPaid: sum(rows.map(r => r.total)),
      interest: schedule.totals.interest, financialCost: money(new D(schedule.totals.interest).plus(lateTotal))
    }
  };
}
