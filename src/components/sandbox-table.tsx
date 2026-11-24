"use client";

import {useId,useState} from "react";
import {ChevronDown,RotateCcw} from "lucide-react";
import {D,daysBetween,periodDays,periodLabel} from "@/lib/finance";
import {type sandbox,type CellEdit,type Driver,type SandboxEdits} from "@/lib/sandbox";
import {Badge,date,fmt,rate} from "./ui";

export type RowField=Driver|"dueDate"|"grace"|"tea"|"teq"|"paidDate"|"lateFee"|"delay";
export type RowIssue={index:number;field:RowField;message:string};
type Result=ReturnType<typeof sandbox>;
const driverNames:Record<Driver,string>={
  opening:"Saldo inicial",interest:"Interés",payment:"Cuota base",principal:"Capital",
  closing:"Saldo final",total:"Pago simulado"
};

function Cell({label,value,onCommit,issue,onDiscard,type="text",locked=false}:{
  label:string;value:string;onCommit:(v:string)=>boolean;issue?:string;onDiscard:()=>void;type?:string;locked?:boolean;
}) {
  const id=useId(),[draft,setDraft]=useState<string|null>(null);
  return <div className="field cell">
    <label htmlFor={id}>{label}</label>
    <input id={id} type={type} inputMode={type==="text"?"decimal":undefined} className="mono" readOnly={locked}
      value={draft??value}
      aria-invalid={issue?true:undefined} aria-describedby={issue?id+"-error":undefined}
      onChange={e=>setDraft(e.target.value)}
      onKeyDown={e=>{
        if(e.key==="Escape"){e.preventDefault();e.stopPropagation();setDraft(null);onDiscard();}
        if(e.key==="Enter"){e.preventDefault();if(!locked&&draft!==null&&onCommit(draft.trim().replace(",",".")))setDraft(null);}
      }}/>
    {issue&&<span id={id+"-error"} className="field-error" role="alert">{issue}</span>}
  </div>;
}

export function SandboxTable({result,edits,delays,adjustedDelays,issue,onCommit,onDiscard,onReset,locked,revision}:{
  result:Result;edits:SandboxEdits;delays:number[];issue:RowIssue|null;onCommit:(i:number,field:RowField,value:string)=>boolean;
  adjustedDelays:Record<number,number>;onDiscard:()=>void;onReset:(i:number)=>void;locked:boolean;revision:number;
}) {
  const currency=result.schedule.input.currency,period=periodLabel(result.schedule.input.frequency),single=result.schedule.input.mode==="UNICO";
  const [resets,setResets]=useState<Record<number,number>>({});
  return <div className="installments sandbox-table">
    <div className="installment-head"><span>Cuota</span><span>Vencimiento</span><span>Estado</span><span className="right">Cuota base</span><span/></div>
    {result.rows.map((r,i)=>{
      const edited=Boolean(edits[i]&&Object.keys(edits[i]).length)||Boolean(result.calculations[i].edit.driver)||Object.hasOwn(adjustedDelays,i);
      const status=edited?"AJUSTADA":r.grace==="T"?"GRACIA_TOTAL":"SIMULADA";
      const cell=(field:RowField,label:string,value:string,type?:string)=><Cell key={field} label={label+" · cuota "+r.number}
        value={value} issue={issue?.index===i&&issue.field===field?issue.message:undefined} type={type} locked={locked}
        onCommit={v=>onCommit(i,field,v)} onDiscard={()=>{if(issue?.index===i&&issue.field===field)onDiscard();}}/>;
      return <details key={r.number} className={"installment"+(edited?" edited":"")}>
        <summary aria-label={`Cuota ${r.number}, ${date(r.dueDate)}, ${fmt(r.payment,currency)}. Ajustar y ver fórmulas`}>
          <strong>Cuota {r.number}</strong><time dateTime={r.dueDate}>{date(r.dueDate)}</time>
          <Badge status={status}/><b className="right">{fmt(r.payment,currency)}</b><ChevronDown size={17}/>
        </summary>
        <div className="row-editor">
          <div className="split">
            <p>Enter aplica el valor. Escape descarta la edición.</p>
            <button type="button" className="secondary" disabled={locked} onClick={()=>{
              onReset(i);setResets(old=>({...old,[i]:(old[i]??0)+1}));
            }}><RotateCcw size={15}/> Restablecer fila {r.number}</button>
          </div>
          <div className="editor-fields" key={revision+"-"+(resets[i]??0)}>
            {cell("dueDate","Vencimiento",r.dueDate,"date")}
            {!single&&<label className="plain-field">Gracia · cuota {r.number}<select value={r.grace} disabled={locked}
              aria-invalid={issue?.index===i&&issue.field==="grace"||undefined}
              onChange={e=>onCommit(i,"grace",e.target.value)}>
              <option value="S">Sin gracia</option><option value="T">Total</option><option value="P">Parcial</option>
            </select>{issue?.index===i&&issue.field==="grace"&&<span className="field-error" role="alert">{issue.message}</span>}</label>}
            {cell("tea","TEA (%)",new D(r.tea!).mul(100).toFixed(7))}
            {!single&&cell("teq",period+" (%)",new D(r.teq!).mul(100).toFixed(7))}
            {(Object.entries(driverNames) as [Driver,string][]).map(([field,label])=>
              (r.grace!=="T"||field==="opening"||field==="interest")?cell(field,label,r[field]):null)}
            {r.grace!=="T"&&<>
              {cell("delay","Días de atraso",String(delays[i]??0))}
              {cell("paidDate","Fecha de pago simulado",r.paidDate??"","date")}
              {cell("lateFee","Mora",r.lateFee)}
            </>}
          </div>
          <RowFormulas result={result} index={i}/>
        </div>
      </details>;
    })}
  </div>;
}

function RowFormulas({result,index}:{result:Result;index:number}) {
  const r=result.rows[index],{edit,annuity}=result.calculations[index];
  const sc=result.schedule,single=sc.input.mode==="UNICO",period=periodLabel(sc.input.frequency);
  const interest=edit.driver==="interest"?`Ajuste manual de interés = ${r.interest}`
    :single?`Interés = ${r.opening} × ((1 + ${r.tea})^(${daysBetween(sc.input.purchaseDate,r.dueDate)}/360) − 1) = ${r.interest}`
    :`Interés = saldo inicial × tasa periódica = ${r.opening} × ${r.teq} = ${r.interest}`;
  const payment=edit.driver&&edit.driver!=="opening"&&edit.driver!=="interest"
    ?`Ajuste manual de ${driverNames[edit.driver].toLowerCase()} = ${edit.value}. Cuota base = ${r.payment}`
    :r.grace==="T"?"Gracia total. Cuota base = 0.00"
    :r.grace==="P"?`Gracia parcial. Cuota base = interés = ${r.interest}`
    :annuity?`Cuota francesa del tramo de la cuota ${annuity.row} = ${annuity.opening} × ${annuity.growth} ÷ ${annuity.factor} = ${r.payment}`
    :`Cuota base = saldo inicial + interés = ${r.opening} + ${r.interest} = ${r.payment}`;
  const mora=edit.lateFee!==undefined?`Ajuste manual de mora = ${r.lateFee}`
    :`Mora = ${r.payment} × ((1 + ${result.moraTea})^(${r.daysLate}/360) − 1) = ${r.lateFee}`;
  return <section className="row-formulas" aria-label={`Fórmulas de la cuota ${r.number}`}>
    <h3>Fórmulas de la cuota {r.number}</h3>
    <ul>
      {!single&&<li><code>{period} = (1 + {r.tea})^({periodDays(sc.input.frequency)}/360) − 1 = {rate(r.teq!)}</code></li>}
      <li><code>{interest}</code></li><li><code>{payment}</code></li>
      {r.grace==="T"?<li><code>Saldo final = {r.opening} + {r.capitalized} = {r.closing}</code></li>:<>
        <li><code>Capital = cuota base − interés = {r.payment} − {r.interest} = {r.principal}</code></li>
        <li><code>Saldo final = {r.opening} − {r.principal} = {r.closing}</code></li>
        <li><code>{mora}</code></li><li><code>Pago simulado = {r.payment} + {r.lateFee} = {r.total}</code></li>
      </>}
    </ul>
  </section>;
}

export function editRow(edits:SandboxEdits,index:number,field:Exclude<RowField,"delay">,value:string):CellEdit {
  const patch={...edits[index]};
  switch(field) {
    case "tea": case "teq": {
      delete patch[field==="tea"?"teq":"tea"];
      patch[field]=/^\d+(\.\d{1,10})?$/.test(value)?new D(value).div(100).toString():value;
      break;
    }
    case "dueDate": case "paidDate": case "lateFee": patch[field]=value;break;
    case "grace": patch.grace=value as CellEdit["grace"];break;
    default:patch.driver=field;patch.value=value;
  }
  return patch;
}
