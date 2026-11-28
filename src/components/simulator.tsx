"use client";

import {useState} from "react";
import {ArrowLeft,Download,RotateCcw} from "lucide-react";
import {D,MAX_DELAY_DAYS,POLICY_LIMITS,EXPLORE_LIMITS,RuleError,periodLabel,periodsPerMonth,teaFromNominal,type Compounding,type CreditInput,type Currency,type Frequency,type SaleMode} from "@/lib/finance";
import {M1,M1_DELAYS} from "@/lib/example-cases";
import {sandbox,type SandboxEdits} from "@/lib/sandbox";
import {editRow,SandboxTable,type RowField,type RowIssue} from "./sandbox-table";
import {Brand,csvDownload,date,errorMessage,Field,fmt,Metric,Notice,PageTitle,rate,useErrorFocus,type ApiError} from "./ui";
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
      setEdits(next);setDelayEdits(nextDelays);setIssue(null);
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
    csvDownload("vidracred-simulacion.csv",["Cuota","Vencimiento","Gracia","TEA",...(!single?[period]:[]),"Moneda","Saldo inicial","Interés","Cuota base","Capital","Saldo final","Pago simulado","Días de atraso","Mora","Total"],
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
        <div className="card-head"><div><h2>Cronograma editable</h2><p>{single?"Un pago":`${sc.rows.length} cuotas ${sc.input.frequency==="MENSUAL"?"mensuales":"quincenales"}`} · {currency}</p></div>
          <div className="row-actions">
            <button className="text-button" disabled={!!error} onClick={resetRows}><RotateCcw size={15}/> Restablecer filas</button>
            <button className="secondary" disabled={!!error||!!issue} onClick={exportScenario}><Download size={16}/> CSV</button>
          </div>
        </div>
        <div className="simulator-settings" ref={region}>
          <div className="settings-fields">
            <Field label="Monto" hint={settings.exploring?"De 100 a 1 000 000.":"De 1 000 a 5 000, múltiplos de 100."} error={error}><input name="amount" type="number" min={limits.amountMin} max={limits.amountMax} step={limits.amountStep} value={settings.amount} onChange={e=>change({...settings,amount:e.target.value})}/></Field>
            <Field label={annualLabel} hint={settings.exploring?"TEA equivalente de 0 % a 100 %.":"TEA equivalente de 15 % a 25 %."} error={error}><input name="tea" inputMode="decimal" value={settings.annual} onChange={e=>change({...settings,annual:e.target.value})}/></Field>
            {settings.mode==="CUOTAS"&&<Field label="Plazo" hint={`De 1 a ${limits.maxMonths} meses.`} error={error}><select name="months" value={settings.months} onChange={e=>{
              const months=Number(e.target.value);change({...settings,months,grace:"S".repeat(months*periodsPerMonth(settings.frequency)),steps:[]},true);
            }}>{Array.from({length:limits.maxMonths},(_,k)=><option key={k} value={k+1}>{k+1} {k===0?"mes":"meses"}</option>)}</select></Field>}
            <Field label="TEA moratoria (%)" hint="Desde la TEA compensatoria hasta 200 %." error={error}><input name="mora" inputMode="decimal" value={settings.mora} onChange={e=>change({...settings,mora:e.target.value})}/></Field>
          </div>
          <details className="advanced"><summary>Condiciones avanzadas</summary>
            <label className="explore-toggle"><input type="checkbox" checked={settings.exploring} onChange={e=>{
              const exploring=e.target.checked;
              const months=Math.min(settings.months,(exploring?EXPLORE_LIMITS:POLICY_LIMITS).maxMonths);
              change({...settings,exploring,months,grace:months===settings.months?settings.grace:"S".repeat(months*periodsPerMonth(settings.frequency)),
                steps:months===settings.months?settings.steps:[]},true);
            }}/> Explorar fuera de los límites de crédito</label>
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
              {settings.mode==="CUOTAS"&&<>
                <Field label="Frecuencia" hint="Quincenal para contratos históricos."><select value={settings.frequency} onChange={e=>{
                  const frequency=e.target.value as Frequency;
                  change({...settings,frequency,grace:"S".repeat(settings.months*periodsPerMonth(frequency)),steps:[]},true);
                }}><option value="MENSUAL">Mensual</option><option value="QUINCENAL">Quincenal</option></select></Field>
                <Field label="Gracia por cuota" hint="T = total, P = parcial, S = sin gracia. Termine con S." error={error}><input name="grace" value={settings.grace} maxLength={length} onChange={e=>change({...settings,grace:e.target.value.toUpperCase()})}/></Field>
                <Field label="Cambio de TEA desde la cuota 2 (%)" hint="Opcional. Los demás cambios se editan en la fila." error={error}><input name="rateSteps" type="number" min={0} max={100} step="any" disabled={length<2}
                  value={settings.steps[0]?new D(settings.steps[0].tea).mul(100).toString():""} onChange={e=>{
                    const value=e.target.value;change({...settings,steps:value?[{from:2,tea:new D(value).div(100).toFixed(12)}]:[]});
                  }}/></Field>
              </>}
            </div>
          </details>
          <Notice error={error}/>
          {(error||issue)&&<p role="status" className="reference-status">Se muestra el último resultado válido.</p>}
        </div>
        <SandboxTable result={result} edits={edits} adjustedDelays={delayEdits} issue={issue}
          onCommit={commit} onDiscard={()=>setIssue(null)} onReset={resetRow} locked={!!error} revision={revision}/>
        <Values items={[
          ["Interés total",fmt(result.totals.interest,currency)],["Mora simulada",fmt(result.totals.lateFee,currency)],
          ["Total de pagos simulados",fmt(result.totals.totalPaid,currency)],["Saldo final",fmt(result.rows.at(-1)!.closing,currency)]
        ]}/>
      </section>
      <div className="metrics simulator-metrics" aria-label="Resumen del escenario">
        <Metric label={single?"Días de interés":"Desfase inicial"} value={`${sc.initialDays} días`} note={`Compra ${date(sc.input.purchaseDate)} · Pago ${date(sc.baseDate)}`} accent/>
        <Metric label="Saldo inicial" value={fmt(sc.initialBalance,currency)} note={single?"Capital de la compra":`Interés del desfase ${fmt(sc.initialInterest,currency)}`}/>
        <Metric label={single?"Pago único pactado":"Cuota base"} value={fmt(sc.ordinaryPayment,currency)} note={single?`Interés por días ${fmt(sc.rows[0].interest,currency)}`:`${period} ${rate(sc.teq)}`}/>
      </div>
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
    return <section className="card comparison">
      <div className="card-head"><div><h2>Comparación de gracia</h2><p>Mismo monto, tasa, calendario y atrasos. Se cambia la gracia de la primera cuota.</p></div></div>
      <div className="comparison-grid">
        {variants.map(({label,grace,result})=><div key={label}><h3>{label} <small>{grace}</small></h3>
          <Values items={[
            ["Cuota ordinaria",fmt(result.schedule.ordinaryPayment,input.currency)],["Interés",fmt(result.totals.interest,input.currency)],
            ["Mora",fmt(result.totals.lateFee,input.currency)],["Total",fmt(result.totals.totalPaid,input.currency)]
          ]}/>
        </div>)}
      </div>
    </section>;
  } catch {
    return <Notice error={{error:"Revise las fechas ajustadas para comparar las opciones de gracia."}}/>;
  }
}
