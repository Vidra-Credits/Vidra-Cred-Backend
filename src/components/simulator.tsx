"use client";

import {useState} from "react";
import {ArrowLeft,Download,RotateCcw} from "lucide-react";
import {D,MAX_DELAY_DAYS,POLICY_LIMITS,EXPLORE_LIMITS,RuleError,periodLabel,periodsPerMonth,teaFromNominal,type Compounding,type CreditInput,type Currency,type Frequency,type SaleMode} from "@/lib/finance";
import {M1,M1_DELAYS} from "@/lib/example-cases";
import {sandbox,type SandboxEdits} from "@/lib/sandbox";
import {editRow,SandboxTable,type RowField,type RowIssue} from "./sandbox-table";
import {Brand,csvDownload,date,errorMessage,Field,fmt,Notice,PageTitle,useErrorFocus,type ApiError} from "./ui";
import {compoundingLabels} from "./workspace-types";
import {Values} from "./credit-views";

type Settings={
  amount:string;currency:Currency;annual:string;rateKind:"TEA"|"TNA";compounding:Compounding;mora:string;
  purchaseDate:string;months:number;cutDay:string;payDay:string;grace:string;frequency:Frequency;mode:SaleMode;
  steps:NonNullable<CreditInput["rateSteps"]>; exploring:boolean;
};
const baseline:Settings={
  amount:M1.amount,currency:M1.currency,annual:"20",rateKind:"TEA",compounding:"MENSUAL",mora:"35",
  purchaseDate:M1.purchaseDate,months:M1.months,cutDay:String(M1.cutDay),payDay:String(M1.payDay),
  grace:M1.grace,frequency:"MENSUAL",mode:"CUOTAS",steps:[],exploring:false
};
const cases=[
  {id:"M1",label:"Crédito mensual",settings:baseline,delays:M1_DELAYS},
  {id:"M2",label:"Gracia total",settings:{...baseline,grace:"TSS"},delays:M1_DELAYS},
  {id:"M3",label:"Gracia parcial",settings:{...baseline,grace:"PSS"},delays:M1_DELAYS},
  {id:"M4",label:"Tasa nominal",settings:{...baseline,annual:"18",rateKind:"TNA" as const},delays:M1_DELAYS},
  {id:"M5",label:"Cambio de tasa",settings:{...baseline,steps:[{from:2,tea:"0.18"}]},delays:M1_DELAYS},
  {id:"M6",label:"Pago único",settings:{...baseline,mode:"UNICO" as const},delays:[10]},
  {id:"H1",label:"Crédito quincenal histórico",settings:{...baseline,frequency:"QUINCENAL" as const,months:1,grace:"SS",cutDay:"25",payDay:"5",purchaseDate:"2026-07-08"},delays:[0,5]}
];
const pct=(value:string,field:string)=>{
  const normalized=value.trim().replace(",",".");
  if(!/^\d+(\.\d{1,9})?$/.test(normalized))throw new RuleError("Escriba un porcentaje válido.",field);
  return new D(normalized).div(100);
};
function calculate(settings:Settings,delays:number[],edits:SandboxEdits) {
  const single=settings.mode==="UNICO",annual=pct(settings.annual,"tea");
  const tea=settings.rateKind==="TNA"?teaFromNominal(annual,settings.compounding):annual;
  const mora=pct(settings.mora,"mora");
  if(mora.gt(2))throw new RuleError("Ingrese una TEA moratoria entre 0 % y 200 %.","mora");
  const input:CreditInput={
    amount:settings.amount,currency:settings.currency,tea:tea.toFixed(12),
    purchaseDate:settings.purchaseDate,cutDay:Number(settings.cutDay),payDay:Number(settings.payDay),
    months:single?0:settings.months,frequency:settings.frequency,grace:single?"":settings.grace,
    mode:settings.mode,rateSteps:single?[]:settings.steps
  };
  return sandbox(input,delays,mora.toFixed(12),edits,settings.exploring?{...EXPLORE_LIMITS,teaMin:"0"}:POLICY_LIMITS);
}
const delaysFor=(base:number[],edits:Record<number,number>,length:number)=>Array.from({length},(_,i)=>edits[i]??base[i]??0);

export function Simulator({guest=false}:{guest?:boolean}) {
  const [settings,setSettings]=useState(baseline),[preset,setPreset]=useState("M1");
  const [baseDelays,setBaseDelays]=useState(M1_DELAYS),[delayEdits,setDelayEdits]=useState<Record<number,number>>({});
  const [edits,setEdits]=useState<SandboxEdits>({}),[revision,setRevision]=useState(0);
  const [result,setResult]=useState(()=>calculate(baseline,M1_DELAYS,{}));
  const [error,setError]=useState<ApiError|null>(null),[issue,setIssue]=useState<RowIssue|null>(null),region=useErrorFocus(error);
  const sc=result.schedule,currency=sc.input.currency,single=sc.input.mode==="UNICO",period=periodLabel(sc.input.frequency);
  const length=settings.mode==="UNICO"?1:settings.months*periodsPerMonth(settings.frequency);
  const delays=delaysFor(baseDelays,delayEdits,sc.rows.length);
  function change(next:Settings,reset=false) {
    const nextLength=next.mode==="UNICO"?1:next.months*periodsPerMonth(next.frequency);
    const nextEdits=reset?{}:edits,nextDelayEdits=reset?{}:delayEdits;
    setSettings(next);setPreset("");setIssue(null);
    if(reset){setEdits(nextEdits);setDelayEdits(nextDelayEdits);setRevision(r=>r+1);}
    try {setResult(calculate(next,delaysFor(baseDelays,nextDelayEdits,nextLength),nextEdits));setError(null);}
    catch(e){const err=errorMessage(e);setError(err.field==="date"?{...err,field:"purchaseDate"}:err);}
  }
  function loadCase(id:string) {
    const selected=cases.find(c=>c.id===id);
    if(!selected)return;
    setSettings(selected.settings);setPreset(id);setBaseDelays(selected.delays);setDelayEdits({});
    setEdits({});setRevision(r=>r+1);setIssue(null);setError(null);setResult(calculate(selected.settings,selected.delays,{}));
  }
  function commit(index:number,field:RowField,value:string) {
    const next={...edits},nextDelays={...delayEdits};
    try {
      if(field==="delay") {
        if(!/^\d{1,3}$/.test(value)||Number(value)>MAX_DELAY_DAYS)throw new RuleError(`Use un entero de 0 a ${MAX_DELAY_DAYS} días.`);
        nextDelays[index]=Number(value);next[index]={...next[index]};delete next[index].paidDate;
      } else {
        if(!value)throw new RuleError("Ingrese un valor o restablezca la fila.");
        next[index]=editRow(next,index,field,value);
      }
      setResult(calculate(settings,delaysFor(baseDelays,nextDelays,length),next));
      setEdits(next);setDelayEdits(nextDelays);setIssue(null);setPreset("");
      return true;
    } catch(e) {
      setIssue({index,field,message:errorMessage(e).error});
      return false;
    }
  }
  function resetRow(index:number) {
    const next={...edits},nextDelays={...delayEdits};
    delete next[index];delete nextDelays[index];
    try {
      setResult(calculate(settings,delaysFor(baseDelays,nextDelays,length),next));
      setEdits(next);setDelayEdits(nextDelays);setIssue(null);
    } catch(e) {setIssue({index,field:"grace",message:errorMessage(e).error});}
  }
  function resetRows() {
    setResult(calculate(settings,delaysFor(baseDelays,{},length),{}));
    setEdits({});setDelayEdits({});setIssue(null);setRevision(r=>r+1);
  }
  const back=guest?"/":"/?vista=tiendas";
  const annualLabel=settings.rateKind+" (%)";
  const limits=settings.exploring?EXPLORE_LIMITS:POLICY_LIMITS;
  function exportScenario() {
    csvDownload("vidracred-simulacion.csv",["Cuota","Vencimiento","Gracia","TEA",...(!single?[period]:[]),"Moneda","Saldo inicial","Interés","Cuota base","Capital","Saldo final","Fecha de pago","Días de atraso","Mora","Cuota total"],
      result.rows.map(r=>[r.number,r.dueDate,r.grace,r.tea??"",...(!single?[r.teq??""]:[]),currency,r.opening,r.interest,r.payment,r.principal,r.closing,r.paidDate??"",r.daysLate,r.lateFee,r.total]));
  }
  return <div className="simulator-shell">
    <header className="app-bar"><Brand href={back}/><a className="secondary link-button" href={back}><ArrowLeft size={16}/> {guest?"Volver a Inicio":"Volver a Tiendas"}</a></header>
    <main className="simulator-main">
      <PageTitle title="Simulador">
        <Field label="Caso de ejemplo"><select value={preset} onChange={e=>loadCase(e.target.value)}>
          <option value="" disabled>Escenario personalizado</option>
          {cases.map(c=><option key={c.id} value={c.id}>{c.id} · {c.label}</option>)}
        </select></Field>
      </PageTitle>
      <section className="card simulator-card">
        <div className="card-head"><div><h2>Cronograma editable</h2><p>{single?"Pago único":`${sc.rows.length} cuotas ${sc.input.frequency==="MENSUAL"?"mensuales":"quincenales"}`}
          {" · Compra "}{date(sc.input.purchaseDate)}{" · "}{single?"Vence ":"Base "}{date(single?sc.rows[0].dueDate:sc.baseDate)}</p></div>
          <div className="row-actions">
            <button className="text-button" disabled={!!error} onClick={resetRows}><RotateCcw size={15}/> Restablecer filas</button>
            <button className="secondary" disabled={!!error||!!issue} onClick={exportScenario}><Download size={16}/> CSV</button>
          </div>
        </div>
        <div className="simulator-settings" ref={region}>
          <div className="settings-fields">
            <Field label="Monto" hint={settings.exploring?"100–1 000 000":"1 000–5 000 · múltiplos de 100"} error={error}><input name="amount" type="number" min={limits.amountMin} max={limits.amountMax} step={limits.amountStep} value={settings.amount} onChange={e=>change({...settings,amount:e.target.value})}/></Field>
            <Field label={annualLabel} hint={settings.exploring?"TEA equivalente 0–100 %":"TEA equivalente 15–25 %"} error={error}><input name="tea" inputMode="decimal" value={settings.annual} onChange={e=>change({...settings,annual:e.target.value})}/></Field>
            {settings.mode==="CUOTAS"&&<Field label="Plazo" error={error}><select name="months" value={settings.months} onChange={e=>{
              const months=Number(e.target.value);change({...settings,months,grace:"S".repeat(months*periodsPerMonth(settings.frequency)),steps:[]},true);
            }}>{Array.from({length:limits.maxMonths},(_,k)=><option key={k} value={k+1}>{k+1} {k===0?"mes":"meses"}</option>)}</select></Field>}
            <Field label="TEA moratoria (%)" hint="Desde la TEA hasta 200 %" error={error}><input name="mora" inputMode="decimal" value={settings.mora} onChange={e=>change({...settings,mora:e.target.value})}/></Field>
          </div>
          <details className="advanced"><summary>Calendario y tasas</summary>
            <div className="form-grid">
              <Field label="Modalidad" hint="Pago único o cronograma en cuotas."><select value={settings.mode} onChange={e=>change({...settings,mode:e.target.value as SaleMode},true)}><option value="CUOTAS">Cuotas</option><option value="UNICO">Pago único</option></select></Field>
              <Field label="Fecha de compra" hint="Fecha desde la que se cuentan los días de desfase." error={error}><input name="purchaseDate" type="date" value={settings.purchaseDate} onChange={e=>change({...settings,purchaseDate:e.target.value})}/></Field>
              <Field label="Día de corte" hint="De 1 a 31." error={error}><input name="cutDay" type="number" min={1} max={31} value={settings.cutDay} onChange={e=>change({...settings,cutDay:e.target.value})}/></Field>
              <Field label="Día de pago" hint="De 1 a 30." error={error}><input name="payDay" type="number" min={1} max={30} value={settings.payDay} onChange={e=>change({...settings,payDay:e.target.value})}/></Field>
              <Field label="Moneda" hint="Moneda en la que se expresan los resultados."><select value={settings.currency} onChange={e=>change({...settings,currency:e.target.value as Currency})}><option>PEN</option><option>USD</option></select></Field>
              <Field label="Tipo de tasa" hint="TEA efectiva o TNA con capitalización."><select value={settings.rateKind} onChange={e=>change({...settings,rateKind:e.target.value as Settings["rateKind"]})}><option>TEA</option><option>TNA</option></select></Field>
              {settings.rateKind==="TNA"&&<Field label="Capitalización" hint="Número de períodos de capitalización al año." error={error}><select name="compounding" value={settings.compounding} onChange={e=>change({...settings,compounding:e.target.value as Compounding})}>
                {Object.entries(compoundingLabels).map(([k,label])=><option key={k} value={k}>{label}</option>)}
              </select></Field>}
              {settings.mode==="CUOTAS"&&
                <Field label="Frecuencia" hint="Quincenal para casos históricos."><select value={settings.frequency} onChange={e=>{
                  const frequency=e.target.value as Frequency;
                  change({...settings,frequency,grace:"S".repeat(settings.months*periodsPerMonth(frequency)),steps:[]},true);
                }}><option value="MENSUAL">Mensual</option><option value="QUINCENAL">Quincenal</option></select></Field>}
            </div>
            <label className="explore-toggle"><input type="checkbox" checked={settings.exploring} onChange={e=>{
              const exploring=e.target.checked;
              const months=Math.min(settings.months,(exploring?EXPLORE_LIMITS:POLICY_LIMITS).maxMonths);
              change({...settings,exploring,months,grace:months===settings.months?settings.grace:"S".repeat(months*periodsPerMonth(settings.frequency)),
                steps:months===settings.months?settings.steps:[]},true);
            }}/> Explorar fuera de los límites de crédito</label>
          </details>
          <Notice error={error}/>
          {(error||issue)&&<p role="status" className="reference-status">Se muestra el último resultado válido.</p>}
        </div>
        <SandboxTable key={revision} result={result} edits={edits} adjustedDelays={delayEdits} issue={issue}
          onCommit={commit} onDiscard={()=>setIssue(null)} onReset={resetRow} locked={!!error}/>
        {single&&<p className="sheet-key">{sc.initialDays} días de interés desde la compra hasta el vencimiento.</p>}
        {new D(sc.rows.at(-1)!.closing).gt(0)&&<p className="sheet-key reference-status">Saldo pendiente tras la última cuota por ajustes del escenario.</p>}
      </section>
      {!single&&sc.rows.length>1&&<GraceComparison input={sc.input} mora={result.moraTea} delays={delays} edits={edits}/>}
    </main>
  </div>;
}

function GraceComparison({input,mora,delays,edits}:{input:CreditInput;mora:string;delays:number[];edits:SandboxEdits}) {
  const tail="S".repeat(input.months*periodsPerMonth(input.frequency)-1);
  const comparable=Object.fromEntries(Object.entries(edits).map(([row,edit])=>[row,{
    dueDate:edit.dueDate,paidDate:edit.paidDate,tea:edit.tea,teq:edit.teq
  }]));
  try {
    const variants=[["Sin gracia","S"],["Gracia total","T"],["Gracia parcial","P"]].map(([label,first])=>({
      label,grace:first+tail,result:sandbox({...input,grace:first+tail},delays,mora,comparable)
    }));
    return <details className="card comparison">
      <summary>Comparación de gracia</summary>
      <p className="sheet-key">Se compara la primera cuota con el mismo monto, tasa, calendario y atrasos.</p>
      <div className="comparison-grid">
        {variants.map(({label,grace,result})=><div key={label}><h3>{label} <small>{grace}</small></h3>
          <Values items={[
            ["Cuota ordinaria",fmt(result.schedule.ordinaryPayment,input.currency)],["Interés",fmt(result.totals.interest,input.currency)],
            ["Mora",fmt(result.totals.lateFee,input.currency)],["Total",fmt(result.totals.totalPaid,input.currency)]
          ]}/>
        </div>)}
      </div>
    </details>;
  } catch {
    return <Notice error={{error:"Revise las fechas ajustadas para comparar las opciones de gracia."}}/>;
  }
}
