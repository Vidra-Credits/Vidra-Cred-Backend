"use client";

import {cloneElement,useEffect,useId,useLayoutEffect,useRef,useState,type ReactElement,type ReactNode} from "react";
import {GlassWater,Package,X} from "lucide-react";
import {D,RuleError,type Currency} from "@/lib/finance";

export type ApiError={error:string;field?:string;status?:number};
export function errorMessage(e:unknown):ApiError {
  if(e instanceof RuleError)return {error:e.message,field:e.field,status:e.status};
  if(e&&typeof e==="object"&&"error" in e)return e as ApiError;
  return {error:"No se pudo completar la operación. Intente nuevamente."};
}

export async function api<T>(path:string,body?:unknown,key?:string):Promise<T> {
  const headers=new Headers(key?{"Idempotency-Key":key}:undefined);
  if(body!==undefined&&!(body instanceof FormData))headers.set("Content-Type","application/json");
  let response:Response;
  try {
    response=await fetch("/api/"+path,{
      method:body===undefined?"GET":"POST",headers,cache:"no-store",
      body:body===undefined?undefined:body instanceof FormData?body:JSON.stringify(body)
    });
  } catch {throw {error:"Se perdió la conexión. Puede volver a intentar.",status:0} satisfies ApiError;}
  const json=await response.json().catch(()=>null);
  if(!response.ok) {
    if(response.status===401&&!["auth/login","bootstrap"].includes(path))
      window.dispatchEvent(new Event("vidracred-session"));
    throw {error:json?.error??"El servicio no está disponible. Intente nuevamente.",field:json?.field,status:response.status} satisfies ApiError;
  }
  if(!json)throw {error:"No se recibió una respuesta válida. Puede volver a intentar.",status:0} satisfies ApiError;
  return json;
}

export function useSubmission() {
  const running=useRef(false),[busy,setBusy]=useState(false);
  async function run(action:()=>Promise<void>) {
    if(running.current)return;
    running.current=true;
    setBusy(true);
    try {await action();}
    finally {running.current=false;setBusy(false);}
  }
  return {busy,run};
}

export function useReplayKey() {
  const attempt=useRef<{payload:string;id:string}|null>(null);
  function key(payload:unknown) {
    const signature=JSON.stringify(payload);
    if(attempt.current?.payload!==signature)attempt.current={payload:signature,id:crypto.randomUUID()};
    return attempt.current.id;
  }
  return key;
}

const numberFormat=new Intl.NumberFormat("es-PE",{minimumFractionDigits:2,maximumFractionDigits:2});
export const num=(value:string|number)=>numberFormat.format(Number(value));
export const fmt=(value:string|number,currency:Currency="PEN")=>(currency==="PEN"?"S/ ":"US$ ")+num(value);
export const rate=(value:string)=>new D(value).mul(100).toFixed(7)+" %";
export const date=(value?:string|null)=>value?value.split("-").reverse().join("/"):"—";
export const shortId=(id:string)=>"VC-"+id.slice(-6).toUpperCase();
export const textValue=(form:FormData,key:string)=>String(form.get(key)??"");

export function csvDownload(name:string,headers:string[],rows:(string|number)[][]) {
  const encode=(v:string|number)=>'"'+String(v).replace(/^[=+@\-]/,"'$&").replaceAll('"','""')+'"';
  const blob=new Blob(["\ufeff"+[headers,...rows].map(row=>row.map(encode).join(";")).join("\r\n")],{type:"text/csv;charset=utf-8"});
  const url=URL.createObjectURL(blob),link=document.createElement("a");
  link.href=url;link.download=name;link.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}

export const statusLabels:Record<string,string>={
  PAGADA:"Pagada",VENCIDA:"Vencida",VENCE_HOY:"Vence hoy",POR_VENCER:"Por vencer",
  GRACIA_TOTAL:"Gracia total",GRACIA_PROGRAMADA:"Gracia programada",NO_ORIGINADO:"Por originar",
  PENDIENTE:"En revisión",APROBADA:"Aprobada",APROBADO:"Aprobada",RECHAZADA:"Rechazada",
  RECHAZADO:"Rechazada",CANCELADA:"Cancelada",ACTIVA:"Activa",INACTIVA:"Inactiva",
  PACTADA:"Pactada",SIMULADA:"Simulada",AJUSTADA:"Ajustada"
};
const tones:Record<string,string>={
  PAGADA:"positive",APROBADA:"positive",APROBADO:"positive",ACTIVA:"positive",
  VENCIDA:"danger",RECHAZADA:"danger",RECHAZADO:"danger",VENCE_HOY:"warning",PENDIENTE:"warning",AJUSTADA:"warning",
  POR_VENCER:"info",SIMULADA:"info",GRACIA_TOTAL:"grace",GRACIA_PROGRAMADA:"grace"
};
export function Badge({status}:{status:string}) {
  return <span className={"badge "+(tones[status]??"neutral")}>{statusLabels[status]??status}</span>;
}

export function Brand({href="/"}:{href?:string}) {
  return <a className="brand" href={href}><span className="brand-icon"><GlassWater size={22}/></span><span>Vidra<span>Cred</span></span></a>;
}

export function PageTitle({title,subtitle,children}:{title:string;subtitle?:string;children?:ReactNode}) {
  return <div className="page-title">
    <div><h1 tabIndex={-1}>{title}</h1>{subtitle&&<p>{subtitle}</p>}</div>
    {children&&<div className="page-actions">{children}</div>}
  </div>;
}

export function Field({label,hint,children,name,error}:{label:string;hint?:string;children:ReactElement<{id?:string;name?:string;"aria-describedby"?:string;"aria-invalid"?:boolean}>;name?:string;error?:ApiError|null}) {
  const id=useId(),invalid=Boolean(error?.field&&error.field===(name??children.props.name));
  const help=hint?id+"-hint":undefined,issue=invalid?id+"-error":undefined;
  return <div className={"field"+(invalid?" invalid":"")}>
    <label htmlFor={id}>{label}</label>
    {cloneElement(children,{id,"aria-describedby":[help,issue].filter(Boolean).join(" ")||undefined,"aria-invalid":invalid||undefined})}
    {hint&&<small id={help}>{hint}</small>}
    {invalid&&<span className="field-error" id={issue}>{error?.error}</span>}
  </div>;
}

export function Notice({error}:{error:ApiError|null|undefined}) {
  return error?<div className="notice error" role="alert" tabIndex={-1}>{error.error}</div>:null;
}

export function useErrorFocus(error:ApiError|null,disabled=false) {
  const region=useRef<HTMLDivElement>(null);
  useLayoutEffect(()=>{
    if(!error||disabled)return;
    const invalid=region.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
    const focus=invalid??region.current?.querySelector<HTMLElement>(".notice.error");
    const details=focus?.closest("details");
    if(details)details.open=true;
    focus?.focus();
  },[error,disabled]);
  return region;
}

export function Empty({children}:{children:ReactNode}) {
  return <div className="empty"><Package size={26} aria-hidden="true"/><p>{children}</p></div>;
}
export function Metric({label,value,note,accent=false}:{label:string;value:string;note?:string;accent?:boolean}) {
  return <div className={"metric"+(accent?" accent":"")}><span>{label}</span><strong>{value}</strong>{note&&<small>{note}</small>}</div>;
}

export function Modal({title,children,onClose,busy=false}:{title:string;children:ReactNode;onClose:()=>void;busy?:boolean}) {
  const dialog=useRef<HTMLDialogElement>(null),heading=useRef<HTMLHeadingElement>(null),id=useId();
  useEffect(()=>{
    const trigger=document.activeElement as HTMLElement|null;
    const element=dialog.current;
    element?.showModal();
    heading.current?.focus();
    return ()=>{
      element?.close();
      if(trigger?.isConnected)trigger.focus();
    };
  },[]);
  return <dialog className="modal" ref={dialog} aria-labelledby={id} onCancel={e=>{e.preventDefault();if(!busy)onClose();}}>
    <header className="modal-head"><h2 id={id} ref={heading} tabIndex={-1}>{title}</h2>
      <button type="button" className="icon-button" aria-label="Cerrar" onClick={onClose} disabled={busy}><X size={20}/></button>
    </header>
    {children}
  </dialog>;
}
