"use client";

import {Fragment,useId,useState} from "react";
import {RotateCcw} from "lucide-react";
import {D,daysBetween,periodDays,periodLabel,sum} from "@/lib/finance";
import {type sandbox,type CellEdit,type Driver,type SandboxEdits} from "@/lib/sandbox";
import {date,num,rate} from "./ui";

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
  function applyDraft(discardOnError=false) {
    if(locked||draft===null)return;
    if(draft===value||onCommit(draft.trim().replace(",","."))||discardOnError)setDraft(null);
  }
  return <div className="field cell">
    <label htmlFor={id}>{label}</label>
    <input id={id} type={type} inputMode={type==="text"?"decimal":undefined} className="mono" readOnly={locked}
      value={draft??value}
      aria-invalid={issue?true:undefined}
      onChange={e=>setDraft(e.target.value)}
      onBlur={()=>applyDraft(true)}
      onKeyDown={e=>{
        if(e.key==="Escape"){e.preventDefault();e.stopPropagation();setDraft(null);onDiscard();}
        if(e.key==="Enter"){e.preventDefault();applyDraft();}
      }}/>
  </div>;
}

export function SandboxTable({result,edits,adjustedDelays,issue,onCommit,onDiscard,onReset,locked}:{
  result:Result;edits:SandboxEdits;issue:RowIssue|null;onCommit:(i:number,field:RowField,value:string)=>boolean;
  adjustedDelays:Record<number,number>;onDiscard:()=>void;onReset:(i:number)=>void;locked:boolean;
}) {
  const {schedule}=result,{currency}=schedule.input,period=periodLabel(schedule.input.frequency);
  const single=schedule.input.mode==="UNICO";
  const [resets,setResets]=useState<Record<number,number>>({});
  const [openRow,setOpenRow]=useState<number|null>(null);
  const headings=["Vencimiento",...(!single?["Gracia"]:[]),"TEA %",...(!single?[period+" %"]:[]),
    "Saldo inicial","Interés","Cuota base","Capital","Saldo final","Fecha de pago","Días de atraso","Mora","Cuota total"];
  const displayRate=(value:string)=>rate(value).replace(" %","");
  const td=(label:string,content:React.ReactNode)=><td key={label} role="cell" data-label={label}>{content}</td>;
  function totals(values:string[]) {
    return values.map((value,i)=>td(headings[i],value));
  }
  return <div className="schedule-sheet schedule-editable">
    <table className="financial-table" role="table" aria-label="Cronograma editable">
      <caption>Simulación · {currency} · Enter o Tab aplica · Escape descarta</caption>
      <colgroup><col className="sheet-index"/>{headings.map(label=><col key={label} className={
        label==="Vencimiento"||label==="Fecha de pago"?"sheet-date":label==="Gracia"||label==="Días de atraso"?"sheet-short":undefined
      }/>)}</colgroup>
      <thead role="rowgroup"><tr role="row"><th scope="col">Cuota</th>
        {headings.map(label=><th key={label} scope="col" role="columnheader">{label}</th>)}
      </tr></thead>
      <tbody role="rowgroup">
        {!single&&<tr className="financial-base" role="row">
          <th scope="row" role="rowheader">0 <small>{schedule.initialDays} días</small></th>
          {totals([date(schedule.baseDate),"—",displayRate(schedule.input.tea),displayRate(schedule.teq),
            num(schedule.input.amount),num(schedule.initialInterest),"—","—",num(schedule.initialBalance),"—","—","—","—"])}
        </tr>}
        {result.rows.map((r,i)=>{
          const edited=Boolean(edits[i]&&Object.keys(edits[i]).length)||Boolean(result.calculations[i].edit.driver)||Object.hasOwn(adjustedDelays,i);
          const issueAt=(field:RowField)=>issue?.index===i&&issue.field===field?issue.message:undefined;
          const cell=(field:RowField,label:string,value:string,type?:string)=>td(label,<Cell label={label+" · cuota "+r.number}
            value={value} issue={issueAt(field)} type={type} locked={locked}
            onCommit={v=>onCommit(i,field,v)} onDiscard={()=>{if(issueAt(field))onDiscard();}}/>);
          const disabledFields=r.grace==="T";
          const show=openRow===r.number;
          return <Fragment key={r.number}>
            <tr className={edited?"sheet-edited":undefined} key={resets[i]??0} role="row">
              <th scope="row" role="rowheader">
                <button type="button" className="sheet-row-button" aria-label={`Fórmulas de la cuota ${r.number}`}
                  aria-expanded={show} onClick={()=>setOpenRow(show?null:r.number)}><span className="sheet-row-prefix">Cuota </span>{r.number}<span aria-hidden="true"> ƒ</span></button>
              </th>
              {cell("dueDate","Vencimiento",r.dueDate,"date")}
              {!single&&td("Gracia",<select value={r.grace} disabled={locked} aria-label={`Gracia · cuota ${r.number}`}
                aria-invalid={!!issueAt("grace")} onChange={e=>onCommit(i,"grace",e.target.value)}>
                <option value="S" title="Sin gracia">S</option><option value="T" title="Gracia total">T</option><option value="P" title="Gracia parcial">P</option>
              </select>)}
              {cell("tea","TEA %",displayRate(r.tea!))}
              {!single&&cell("teq",period+" %",displayRate(r.teq!))}
              {cell("opening","Saldo inicial",r.opening)}
              {cell("interest","Interés",r.interest)}
              {disabledFields?td("Cuota base",num(r.payment)):cell("payment","Cuota base",r.payment)}
              {disabledFields?td("Capital",num(r.principal)):cell("principal","Capital",r.principal)}
              {disabledFields?td("Saldo final",num(r.closing)):cell("closing","Saldo final",r.closing)}
              {disabledFields?td("Fecha de pago","—"):cell("paidDate","Fecha de pago",r.paidDate??"","date")}
              {disabledFields?td("Días de atraso","—"):cell("delay","Días de atraso",String(r.daysLate))}
              {disabledFields?td("Mora",num(r.lateFee)):cell("lateFee","Mora",r.lateFee)}
              {disabledFields?td("Cuota total",num(r.total)):cell("total","Cuota total",r.total)}
            </tr>
            {(show||issue?.index===i)&&<tr className="sheet-detail" role="row"><td colSpan={headings.length+1} role="cell">
              {issue?.index===i&&<p role="alert" className="field-error">Cuota {r.number}: {issue.message}</p>}
              {show&&<div className="row-editor">
                <button type="button" className="secondary" disabled={locked} onClick={()=>{
                  onReset(i);setResets(old=>({...old,[i]:(old[i]??0)+1}));
                }}><RotateCcw size={15}/> Restablecer fila {r.number}</button>
                <RowFormulas result={result} index={i}/>
              </div>}
            </td></tr>}
          </Fragment>;
        })}
      </tbody>
      <tfoot role="rowgroup"><tr role="row"><th scope="row" role="rowheader">Totales</th>
        {totals(["—",...(!single?["—"]:[]),"—",...(!single?["—"]:[]),"—",
          num(result.totals.interest),num(result.totals.installments),num(sum(result.rows.map(r=>r.principal))),
          num(result.rows.at(-1)!.closing),"—","—",num(result.totals.lateFee),num(result.totals.totalPaid)])}
      </tr></tfoot>
    </table>
    <p className="sheet-key">Gracia: S amortiza · P solo paga interés · T capitaliza. El interés total incluye el desfase. ƒ muestra las fórmulas.</p>
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
