"use client";

import {useEffect,useRef,useState} from "react";
import {ArrowRight,Check,Eye,Plus,X} from "lucide-react";
import {D,POLICY,creditLine,today,type SaleMode} from "@/lib/finance";
import type {Quote} from "@/lib/service";
import {QuoteSummary,Values} from "./credit-views";
import {EditForm,ProductCard} from "./management";
import {api,Badge,date,Empty,errorMessage,Field,fmt,Modal,Notice,PageTitle,rate,textValue,useErrorFocus,useReplayKey,useSubmission,type ApiError} from "./ui";
import {saleModeLabels,type ClientRow,type Data,type Go,type Notify,type PackageRow,type Refresh,type RequestRow,type StoreRow} from "./workspace-types";

function ApprovalStatus({client}:{client:ClientRow}) {
  if(client.approval==="APROBADO")return null;
  const pending=client.approval==="PENDIENTE";
  return <div className={"banner"+(pending?"":" danger")} role="status">
    <div><strong>{pending?"Su cuenta está en revisión":"La tienda rechazó su cuenta"}</strong>
    <p>{pending?"La tienda revisará sus datos y le asignará una línea, una tasa y un plazo.":client.approval_note||"Consulte el motivo con su tienda."}</p></div>
  </div>;
}

export function Catalog({data,refresh,notify,go}:{data:Data;refresh:Refresh;notify:Notify;go:Go}) {
  const [product,setProduct]=useState<PackageRow|null>(null),[search,setSearch]=useState("");
  const client=data.clients[0];
  if(!client)return <><PageTitle title="Catálogo"/><Empty>No se encontró su cuenta.</Empty></>;
  const approved=client.approval==="APROBADO",line=creditLine(client.credit_limit,data.credits,today());
  const filtered=data.packages.filter(p=>(p.name+" "+p.detail+" "+p.brand).toLowerCase().includes(search.trim().toLowerCase()));
  return <>
    <PageTitle title="Catálogo" subtitle={data.stores[0]?.name}>
      <Field label="Buscar producto"><input type="search" placeholder="Nombre o descripción" value={search} onChange={e=>setSearch(e.target.value)}/></Field>
    </PageTitle>
    <ApprovalStatus client={client}/>
    {approved&&<div className="catalog-line"><div><span>Línea disponible</span><strong>{fmt(line.available,client.currency)}</strong></div><p>Hasta {client.max_months} {client.max_months===1?"mes":"meses"} · {client.currency}</p></div>}
    {filtered.length?<div className="product-grid">{filtered.map(p=>{
      const exceeds=approved&&new D(p.amount).gt(line.available);
      return <ProductCard product={p} key={p.id} restriction={exceeds?"Su línea disponible es insuficiente para esta compra.":undefined}>
        <button className="primary full" onClick={()=>setProduct(p)} disabled={!approved||exceeds}>Solicitar a crédito <ArrowRight size={16}/></button>
      </ProductCard>;
    })}</div>:<section className="card"><Empty>{data.packages.length?"No hay productos que coincidan con la búsqueda.":"La tienda aún no publicó productos en su moneda."}</Empty></section>}
    {product&&<RequestModal client={client} product={product} onClose={()=>setProduct(null)} onDone={async()=>{
      setProduct(null);await refresh();notify("Solicitud enviada a la tienda.");go("solicitudes");
    }}/>}
  </>;
}

function QuoteFields({product,mode,months,maxMonths,setMode,setMonths,error}:{product:PackageRow;mode:SaleMode;months:number;maxMonths:number;setMode:(mode:SaleMode)=>void;setMonths:(months:number)=>void;error:ApiError|null}) {
  return <>
    {product.sale_mode==="AMBOS"?<Field label="Modalidad de pago" hint="Elija entre cuotas mensuales o un pago en la fecha pactada." error={error}>
      <select name="mode" value={mode} onChange={e=>setMode(e.target.value as SaleMode)}>
        <option value="CUOTAS">Cuotas mensuales</option><option value="UNICO">Pago único</option>
      </select>
    </Field>:<p className="muted">{saleModeLabels[product.sale_mode]}</p>}
    {mode==="CUOTAS"&&<Field label="Plazo" hint={`Una cuota mensual. Su máximo es ${maxMonths} ${maxMonths===1?"mes":"meses"}.`} error={error}>
      <select name="months" value={months} onChange={e=>setMonths(Number(e.target.value))}>
        {Array.from({length:maxMonths},(_,i)=>i+1).map(n=><option value={n} key={n}>{n} {n===1?"mes":"meses"}</option>)}
      </select>
    </Field>}
  </>;
}

function RequestModal({client,product,onClose,onDone}:{client:ClientRow;product:PackageRow;onClose:()=>void;onDone:()=>Promise<void>}) {
  const [mode,setMode]=useState<SaleMode>("CUOTAS"),[months,setMonths]=useState(1),[quote,setQuote]=useState<Quote|null>(null);
  const [error,setError]=useState<ApiError|null>(null),submission=useSubmission(),key=useReplayKey(),region=useErrorFocus(error,submission.busy);
  const summary=useRef<HTMLDivElement>(null);
  useEffect(()=>{if(quote)summary.current?.focus();},[quote]);
  const effective=product.sale_mode==="AMBOS"?mode:product.sale_mode,single=effective==="UNICO";
  const payload={packageId:product.id,mode:effective,months:single?0:months,frequency:"MENSUAL",grace:single?"":"S".repeat(months)};
  function change(action:()=>void){action();setQuote(null);setError(null);}
  return <Modal title={product.name} onClose={onClose} busy={submission.busy}>
    <div className="modal-body" ref={region}>
      <p className="modal-price">Monto a financiar <strong className="mono">{fmt(quote?.schedule.input.amount??product.amount,product.currency)}</strong></p>
      <form className="form-stack" onSubmit={e=>{
        e.preventDefault();
        void submission.run(async()=>{
          setError(null);
          try {
            if(!quote){setQuote(await api<Quote>("simulate",payload));return;}
            const request={...payload,previewFingerprint:quote.fingerprint};
            await api("requests",{...request,idempotencyKey:key(request)});
            await onDone();
          } catch(e) {
            const issue=errorMessage(e);
            if(quote&&issue.status===409&&issue.field==="previewFingerprint")setQuote(null);
            setError(issue);
          }
        });
      }}>
        <Notice error={error}/>
        {!quote?<fieldset className="form-stack" disabled={submission.busy}>
          <QuoteFields product={product} mode={effective} months={months} maxMonths={client.max_months}
            setMode={v=>change(()=>setMode(v))} setMonths={v=>change(()=>setMonths(v))} error={error}/>
          <button className="primary full"><Eye size={17}/> {submission.busy?"Calculando…":"Ver cotización"}</button>
        </fieldset>:<>
          <div aria-live="polite" tabIndex={-1} ref={summary}><QuoteSummary schedule={quote.schedule}/></div>
          <p className="muted">La tienda revisará la solicitud con estas condiciones.</p>
          <div className="form-actions">
            <button className="secondary" type="button" onClick={()=>change(()=>{})} disabled={submission.busy}>Cambiar condiciones</button>
            <button className="primary" disabled={submission.busy}><Check size={17}/> {submission.busy?"Enviando…":"Enviar solicitud"}</button>
          </div>
        </>}
      </form>
    </div>
  </Modal>;
}

type RateStep={from:number;tea:string};
function RateSteps({steps,setSteps,months,defaultRate,error}:{steps:RateStep[];setSteps:(v:RateStep[])=>void;months:number;defaultRate:string;error:ApiError|null}) {
  const options=Array.from({length:Math.max(0,months-1)},(_,i)=>i+2);
  const available=options.filter(n=>!steps.some(r=>r.from===n));
  function update(index:number,step:RateStep) {
    setSteps(steps.map((r,i)=>index===i?step:r).sort((a,b)=>a.from-b.from));
  }
  return <div className="form-stack">
    <div className="split"><div><h3>Cambios de tasa</h3><p>La cuota se recalcula desde la fecha en que entra en vigor la nueva TEA.</p></div>
      <button type="button" className="secondary" disabled={!available.length||steps.length>=4} onClick={()=>setSteps([...steps,{from:available[0],tea:defaultRate}].sort((a,b)=>a.from-b.from))}><Plus size={15}/> Agregar tasa</button></div>
    {steps.map((step,i)=><div className="rate-step" key={i}>
      <Field label={`Desde cuota · cambio ${i+1}`} hint="Elija la primera cuota con la nueva TEA.">
        <select value={step.from} onChange={e=>update(i,{...step,from:Number(e.target.value)})}>{options.filter(n=>n===step.from||available.includes(n)).map(n=><option key={n}>{n}</option>)}</select>
      </Field>
      <Field label={`Nueva TEA (%) · cambio ${i+1}`} hint="Entre 15 % y 25 %." error={error} name={i===0?"rateSteps":undefined}>
        <input type="number" min={15} max={25} step="any" required value={step.tea} onChange={e=>update(i,{...step,tea:e.target.value})}/>
      </Field>
      <button type="button" className="icon-button" aria-label={`Quitar cambio ${i+1}`} onClick={()=>setSteps(steps.filter((_,j)=>j!==i))}><X size={17}/></button>
    </div>)}
  </div>;
}

export function Purchase({data,store,onDone}:{data:Data;store:StoreRow;onDone:(id:string)=>Promise<void>}) {
  const eligible=data.clients.filter(c=>c.active&&c.approval==="APROBADO");
  const [clientId,setClientId]=useState(eligible[0]?.id??""),client=eligible.find(c=>c.id===clientId);
  const products=data.packages.filter(p=>p.active&&p.currency===client?.currency);
  const [picked,setPicked]=useState(""),product=products.find(p=>p.id===picked)??(!picked?products[0]:undefined);
  const [mode,setMode]=useState<SaleMode>("CUOTAS"),[purchaseDate,setPurchaseDate]=useState(today);
  const [months,setMonths]=useState(1),[grace,setGrace]=useState("S"),[steps,setSteps]=useState<RateStep[]>([]);
  const [review,setReview]=useState<{quote:Quote;payload:Record<string,unknown>}|null>(null),[error,setError]=useState<ApiError|null>(null);
  const quote=review?.quote;
  const submission=useSubmission(),key=useReplayKey(),region=useErrorFocus(error,submission.busy);
  const summary=useRef<HTMLDivElement>(null);
  useEffect(()=>{if(quote)summary.current?.focus();},[quote]);
  const effective=product?.sale_mode==="UNICO"?"UNICO":product?.sale_mode==="CUOTAS"?"CUOTAS":mode,single=effective==="UNICO";
  const line=client?creditLine(client.credit_limit,data.credits.filter(c=>c.clientId===client.id),today()):null;
  function change(action:()=>void){action();setReview(null);setError(null);}
  function term(n:number){setMonths(n);setGrace("S".repeat(n));setSteps([]);}
  return <>
    <PageTitle title="Nueva venta" subtitle="Cotice las condiciones del cliente antes de registrar el crédito."/>
    {!eligible.length?<section className="card"><Empty>Primero registre o apruebe a un cliente con línea de crédito.</Empty></section>:<div className="purchase-layout">
      <section className="card">
        <div className="card-head"><h2>{quote?"Vista previa de la venta":"Datos de la venta"}</h2></div>
        <div className="card-body" ref={region}>
          <Notice error={error}/>
          <form className="form-stack" onSubmit={e=>{
            e.preventDefault();
            void submission.run(async()=>{
              setError(null);
              try {
                const payload={storeId:store.id,clientId,packageId:product?.id,purchaseDate,mode:effective,frequency:"MENSUAL",
                  months:single?0:months,grace:single?"":grace,rateSteps:single?[]:steps.map(s=>({from:s.from,tea:new D(s.tea).div(100).toFixed(12)}))};
                if(!review){setReview({quote:await api<Quote>("simulate",payload),payload});return;}
                const request={...review.payload,previewFingerprint:review.quote.fingerprint};
                const result=await api<{id:string}>("credits",{...request,idempotencyKey:key(request)});
                await onDone(result.id);
              } catch(e){
                const issue=errorMessage(e);
                if(issue.status===409&&issue.field==="previewFingerprint")setReview(null);
                setError(issue);
              }
            });
          }}>
            {quote?<><div tabIndex={-1} ref={summary}><p>{quote.clientName} · {quote.packageName}</p><QuoteSummary schedule={quote.schedule}/></div>
              <div className="form-actions">
                <button className="secondary" type="button" onClick={()=>change(()=>{})} disabled={submission.busy}>Editar datos</button>
                <button className="primary" disabled={submission.busy}>{submission.busy?"Registrando…":"Registrar crédito"}</button>
              </div></>:<fieldset className="form-stack" disabled={submission.busy}>
              <Field label="Cliente" hint="Cuenta aprobada y activa." error={error}><select name="clientId" required value={client?.id??""} onChange={e=>change(()=>{setClientId(e.target.value);setPicked("");term(1);})}>
                <option value="" disabled>Seleccione un cliente</option>{eligible.map(c=><option value={c.id} key={c.id}>{c.name} · {c.currency}</option>)}
              </select></Field>
              <Field label="Producto" hint="Productos disponibles en la moneda del cliente." error={error}><select name="packageId" required value={product?.id??""} onChange={e=>change(()=>setPicked(e.target.value))}>
                <option value="" disabled>{products.length?"Seleccione un producto":"Sin productos disponibles"}</option>
                {products.map(p=><option value={p.id} key={p.id}>{p.name} · {fmt(p.amount,p.currency)}</option>)}
              </select></Field>
              <Field label="Fecha de compra" hint="Empieza en la fecha actual de Lima. Puede registrar una compra anterior." error={error}>
                <input name="purchaseDate" type="date" required min="1900-01-01" max={today()} value={purchaseDate} onChange={e=>change(()=>setPurchaseDate(e.target.value))}/>
              </Field>
              {product&&client&&<QuoteFields product={product} mode={effective} months={months} maxMonths={client.max_months} setMode={m=>change(()=>setMode(m))} setMonths={n=>change(()=>term(n))} error={error}/>}
              {!single&&product&&<details className="advanced"><summary>Condiciones avanzadas</summary>
                <div className="form-stack">
                  <Field label="Gracia por cuota" hint={`${months} letras. T = total, P = parcial, S = sin gracia. Termine con al menos una S.`} error={error}>
                    <input name="grace" required maxLength={months} className="mono" value={grace} onChange={e=>change(()=>setGrace(e.target.value.toUpperCase()))}/>
                  </Field>
                  <RateSteps steps={steps} setSteps={v=>change(()=>setSteps(v))} months={months} defaultRate={new D(client?.tea??".20").mul(100).toString()} error={error}/>
                </div>
              </details>}
              <button className="primary full" disabled={!client||!product}><Eye size={17}/> {submission.busy?"Calculando…":"Ver cotización"}</button>
            </fieldset>}
          </form>
        </div>
      </section>
      {client&&<aside className="card purchase-terms">
        <div className="card-head"><h2>Condiciones del cliente</h2></div>
        <Values items={[
          ["Línea disponible",fmt(line?.available??"0",client.currency)],
          ["TEA",rate(client.tea)],["TEA moratoria",rate(client.mora_tea??POLICY.mora)],
          ["Corte",`Día ${client.cut_day??store.cut_day}`],["Pago mensual",`Día ${client.pay_day??store.pay_day}`]
        ]}/>
      </aside>}
    </div>}
  </>;
}

function RequestDetail({request:r,client,readOnly,onClose,refresh,notify,go}:{
  request:RequestRow;client:boolean;readOnly:boolean;onClose:()=>void;refresh:Refresh;notify:Notify;go:Go;
}) {
  const [preview,setPreview]=useState<Quote|null>(null),[error,setError]=useState<ApiError|null>(null),[reject,setReject]=useState(false);
  const submission=useSubmission(),key=useReplayKey(),region=useErrorFocus(error,submission.busy);
  const schedule=r.quote_snapshot?.schedule??preview?.schedule,pending=r.status==="PENDIENTE";
  async function approve() {
    await submission.run(async()=>{
      setError(null);
      try {
        if(!schedule){setPreview(await api<Quote>(`requests/${r.id}/preview`));return;}
        const payload={id:r.id,action:"aprobar",previewFingerprint:preview?.fingerprint};
        const result=await api<{creditId:string}>("requests/resolve",{...payload,idempotencyKey:key(payload)});
        await refresh();notify("Solicitud aprobada. El crédito quedó registrado.");go("cronograma",result.creditId);
      } catch(e) {
        const issue=errorMessage(e);
        if(!r.quote_snapshot&&issue.status===409)setPreview(null);
        setError(issue);
        if(issue.status===409)await refresh();
      }
    });
  }
  async function cancel() {
    await submission.run(async()=>{
      setError(null);
      try {await api("requests/cancel",{id:r.id});await refresh();notify("Solicitud cancelada.");onClose();}
      catch(e){const issue=errorMessage(e);setError(issue);if(issue.status===409)await refresh();}
    });
  }
  if(reject)return <EditForm title="Rechazar solicitud" submitLabel="Confirmar rechazo" onClose={()=>setReject(false)} onSave={async(f,k)=>{
    await api("requests/resolve",{id:r.id,action:"rechazar",note:textValue(f,"note"),idempotencyKey:k});await refresh();notify("Solicitud rechazada.");onClose();
  }}>{err=><Field label="Motivo para el cliente" hint="Explique por qué se rechaza esta compra." error={err}><textarea name="note" rows={3} required maxLength={300}/></Field>}</EditForm>;
  return <Modal title={r.package_name} onClose={onClose} busy={submission.busy}>
    <div className="modal-body form-stack" ref={region}>
      <div className="split"><p>{!client&&r.client_name+" · "}{date(r.purchase_date)} · {fmt(r.amount,r.currency)}</p><Badge status={r.status}/></div>
      {r.note&&<p className="banner">{r.note}</p>}
      <Notice error={error??(pending&&r.review_issue?{error:r.review_issue}:null)}/>
      {schedule?<div><h3>{preview?"Vista previa actual":"Cotización enviada"}</h3><QuoteSummary schedule={schedule}/></div>
        :pending&&<p>La solicitud se registró antes de guardar las cotizaciones. La tienda debe generar y revisar la vista previa antes de aprobarla.</p>}
      <div className="form-actions">
        {pending&&client&&<button className="secondary" onClick={()=>void cancel()} disabled={submission.busy}>{submission.busy?"Cancelando…":"Cancelar solicitud"}</button>}
        {pending&&!client&&!readOnly&&<>
          <button className="secondary" onClick={()=>setReject(true)} disabled={submission.busy}>Rechazar</button>
          <button className="primary" onClick={()=>void approve()} disabled={submission.busy}>{submission.busy?"Procesando…":schedule?"Aprobar solicitud":"Generar vista previa"}</button>
        </>}
        {r.credit_id&&<button className="primary" onClick={()=>go("cronograma",r.credit_id!)}>Ver crédito <ArrowRight size={17}/></button>}
      </div>
    </div>
  </Modal>;
}

export function Requests({data,refresh,notify,go,selected}:{data:Data;refresh:Refresh;notify:Notify;go:Go;selected?:string}) {
  const client=data.actor.role==="CLIENTE",pendingClients=data.clients.filter(c=>c.active&&c.approval==="PENDIENTE");
  const request=data.requests.find(r=>r.id===selected);
  const activeClient=client?data.clients[0]:undefined;
  return <>
    <PageTitle title={client?"Mis solicitudes":"Solicitudes"} subtitle={client?"Estado de sus compras a crédito":"Cuentas nuevas y compras por revisar"}>
      {client&&<button className="secondary" onClick={()=>go("catalogo")}>Ir al catálogo <ArrowRight size={17}/></button>}
    </PageTitle>
    {activeClient&&<ApprovalStatus client={activeClient}/>}
    {!client&&<section className="card group">
      <div className="card-head"><h2>Cuentas en revisión</h2></div>
      {pendingClients.length?<div className="record-list">{pendingClients.map(c=><article className="record account-record" key={c.id}>
        <div><strong>{c.name}</strong><small>{c.document} · {c.currency}</small></div><Badge status={c.approval}/>
        {!data.actor.readOnly&&<button className="text-button" data-account-review={c.id} onClick={()=>go("clientes",c.id)}>Revisar cuenta <ArrowRight size={16}/></button>}
      </article>)}</div>:<Empty>No hay cuentas nuevas por revisar.</Empty>}
    </section>}
    <section className="card">
      <div className="card-head"><h2>{client?"Compras solicitadas":"Solicitudes de compra"}</h2><small>{data.requests.length} {data.requests.length===1?"solicitud":"solicitudes"}</small></div>
      {data.requests.length?<div className="record-list">{data.requests.map(r=><article className="record request-record" key={r.id}>
        <div><strong>{r.package_name}</strong><small>{!client&&r.client_name+" · "}{date(r.purchase_date)}</small></div>
        <div><b className="mono">{fmt(r.amount,r.currency)}</b><small>{r.mode==="UNICO"?"Pago único":`${r.months} ${r.months===1?"mes":"meses"}`}</small></div>
        <div><Badge status={r.status}/>{r.note&&<small>{r.note}</small>}{r.status==="PENDIENTE"&&r.review_issue&&<small>{r.review_issue}</small>}</div>
        <div className="row-actions">
          <button className={r.status==="PENDIENTE"&&!client?"secondary":"text-button"} onClick={()=>go("solicitudes",r.id)}>{r.status==="PENDIENTE"&&!client?"Revisar solicitud":"Ver solicitud"}</button>
          {r.credit_id&&<button className="text-button" onClick={()=>go("cronograma",r.credit_id!)}>Ver crédito <ArrowRight size={16}/></button>}
        </div>
      </article>)}</div>:<Empty>{client?"Aún no ha enviado solicitudes. Puede empezar en el catálogo.":"No hay solicitudes de compra."}</Empty>}
    </section>
    {selected&&!request&&<Notice error={{error:"La solicitud no está disponible en esta cuenta."}}/>}
    {request&&<RequestDetail key={request.id} request={request} client={client} readOnly={!!data.actor.readOnly}
      onClose={()=>go("solicitudes")} refresh={refresh} notify={notify} go={go}/>}
  </>;
}
