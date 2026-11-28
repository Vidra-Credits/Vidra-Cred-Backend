"use client";

import {Fragment,useState,type ReactNode} from "react";
import {ArrowLeft,ArrowRight,Download,Plus,ReceiptText} from "lucide-react";
import {POLICY,creditLine,cutListing,lateFee,monthDate,periodLabel,statement,sum,today,type Credit,type Currency,type Schedule} from "@/lib/finance";
import {api,Badge,csvDownload,date,Empty,errorMessage,Field,fmt,Metric,Modal,Notice,num,PageTitle,rate,shortId,statusLabels,useErrorFocus,useReplayKey,useSubmission,type ApiError} from "./ui";
import type {Data,Go,StoreRow} from "./workspace-types";

type StatementRow=ReturnType<typeof statement>["rows"][number];
const frequencyName=(schedule:Schedule)=>schedule.input.frequency==="MENSUAL"?"Mensual":"Quincenal";
export const firstUnpaid=(credit:Credit)=>credit.schedule.rows.find(r=>r.grace!=="T"&&!credit.payments.some(p=>p.installmentNumber===r.number));

export function Values({items}:{items:[string,ReactNode][]}) {
  return <dl className="values">{items.map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>;
}

export function ScheduleView({schedule,rows,currency}:{schedule:Schedule;rows?:StatementRow[];currency:Currency}) {
  const single=schedule.input.mode==="UNICO",period=periodLabel(schedule.input.frequency);
  const headings=["Vencimiento","Gracia","TEA %",...(!single?[period+" %"]:[]),
    "Saldo inicial","Interés","Cuota pactada","Capital","Saldo final",
    ...(rows?["Estado","Fecha de pago","Días de atraso","Mora","Pago recibido","Por cobrar"]:[])];
  const amount=(v:string)=>num(v);
  const percent=(v:string)=>rate(v).replace(" %","");
  function cells(values:ReactNode[]) {
    return values.map((value,index)=><td key={headings[index]} role="cell" data-label={headings[index]}>{value}</td>);
  }
  return <div className="schedule-sheet">
    <table className="financial-table" role="table" aria-label="Cronograma financiero">
      <caption>Importes en {currency} · año de 360 días</caption>
      <colgroup><col className="sheet-index"/>{headings.map(label=><col key={label} className={
        label==="Vencimiento"||label==="Fecha de pago"?"statement-date":label==="Estado"?"statement-status":label==="Gracia"?"sheet-short":undefined
      }/>)}</colgroup>
      <thead role="rowgroup"><tr role="row"><th scope="col">Cuota</th>
        {headings.map(label=><th key={label} scope="col" role="columnheader">{label}</th>)}
      </tr></thead>
      <tbody role="rowgroup">
        {!single&&<tr className="financial-base" role="row">
          <th scope="row" role="rowheader">0 <small>Desfase</small></th>
          {cells([date(schedule.baseDate),"—",percent(schedule.input.tea),percent(schedule.teq),
            amount(schedule.input.amount),amount(schedule.initialInterest),"—","—",amount(schedule.initialBalance),
            ...(rows?["—","—","—","—","—","—"]:[])])}
        </tr>}
        {schedule.rows.map((item,i)=>{
          const row=rows?.[i];
          return <tr key={item.number} role="row">
            <th scope="row" role="rowheader"><span className="sheet-row-prefix">Cuota </span>{item.number}</th>
            {cells([date(item.dueDate),item.grace,percent(item.tea??schedule.input.tea),...(!single?[percent(item.teq??schedule.teq)]:[]),
              ...[item.opening,item.interest,item.payment,item.principal,item.closing].map(amount),
              ...(rows?[row&&<Badge status={row.status}/>,date(row?.paidDate),row?.daysLate??"—",
                row?amount(row.lateFee):"—",row?amount(row.totalPaid):"—",row?amount(row.pending):"—"]:[])])}
          </tr>;
        })}
      </tbody>
      <tfoot role="rowgroup"><tr role="row">
        <th scope="row" role="rowheader">Totales</th>
        {cells(["—","—","—",...(!single?["—"]:[]),"—",amount(schedule.totals.interest),amount(schedule.totals.payments),
          amount(schedule.totals.principal),amount(schedule.rows.at(-1)!.closing),
          ...(rows?["—","—","—",amount(sum(rows.map(row=>row.lateFee))),amount(sum(rows.map(row=>row.totalPaid))),amount(sum(rows.map(row=>row.pending)))]:[])])}
      </tr></tfoot>
    </table>
    <p className="sheet-key">Gracia: S amortiza · P solo paga interés · T capitaliza. El interés total incluye el desfase inicial.</p>
  </div>;
}

export function QuoteSummary({schedule}:{schedule:Schedule}) {
  const {currency,mode,tea,mora}=schedule.input,single=mode==="UNICO";
  return <div className="quote-overview">
    <Values items={[
      [single?"Vencimiento":"Primera cuota",date(schedule.rows[0].dueDate)],
      ...(!single?[["Cuota base",fmt(schedule.ordinaryPayment,currency)] as [string,string]]:[]),
      ["Interés total",fmt(schedule.totals.interest,currency)],["Total a pagar",<strong>{fmt(schedule.totals.payments,currency)}</strong>],
      ["TEA",rate(tea)],["TEA moratoria",rate(mora??POLICY.mora)]
    ]}/>
    <ScheduleView schedule={schedule} currency={currency}/>
  </div>;
}

function CreditList({credits,asOf,go}:{credits:Credit[];asOf:string;go:Go}) {
  return <div className="record-list">{credits.map(c=>{
    const s=statement(c,asOf);
    const pending=s.rows.find(r=>r.pending!=="0.00");
    return <article className="record credit-record" key={c.id}>
      <div><strong>{c.packageName}</strong><small>{shortId(c.id)} · {c.clientName}</small></div>
      <div><small>Saldo financiero</small><b className="mono">{fmt(s.outstanding,c.currency)}</b></div>
      <div><small>{pending?.status==="VENCIDA"?"Cuota vencida":"Próximo vencimiento"}</small><b className="mono">{date(pending?.dueDate)}</b></div>
      <button className="text-button" onClick={()=>go("cronograma",c.id)}>Ver crédito <ArrowRight size={16}/></button>
    </article>;
  })}</div>;
}

export function Schedules({data,asOf,selected,go,refresh,notify}:{data:Data;asOf:string;selected?:string;go:Go;refresh:()=>Promise<unknown>;notify:(s:string)=>void}) {
  const [search,setSearch]=useState("");
  const credit=data.credits.find(c=>c.id===selected),client=data.actor.role==="CLIENTE";
  if(credit)return <CreditDetail key={credit.id} credit={credit} data={data} asOf={asOf} go={go} refresh={refresh} notify={notify}/>;
  if(selected)return <><PageTitle title="Crédito no disponible"/><Empty>El contrato no está disponible en esta cuenta.</Empty><button className="secondary" onClick={()=>go(client?"portal":"cronograma")}>Volver a {client?"Mi cuenta":"Créditos"}</button></>;
  const filtered=data.credits.filter(c=>[c.clientName,c.packageName,shortId(c.id)].some(v=>v.toLowerCase().includes(search.trim().toLowerCase())));
  return <>
    <PageTitle title="Créditos" subtitle={`Contratos y cuotas al ${date(asOf)}`}>
      {!data.actor.readOnly&&<button className="primary" onClick={()=>go("compra")}><Plus size={17}/> Nueva venta</button>}
      <button className="secondary" onClick={()=>go("corte")}>Corte mensual</button>
    </PageTitle>
    <section className="card">
      <div className="card-head"><h2>Contratos registrados</h2>
        <Field label="Buscar crédito"><input type="search" placeholder="Cliente, producto o código" value={search} onChange={e=>setSearch(e.target.value)}/></Field>
      </div>
      {filtered.length?<CreditList credits={filtered} asOf={asOf} go={go}/>:<Empty>{data.credits.length?"No hay créditos que coincidan con la búsqueda.":"Aún no hay créditos registrados."}</Empty>}
    </section>
  </>;
}

function CreditDetail({credit:c,data,asOf,go,refresh,notify}:{credit:Credit;data:Data;asOf:string;go:Go;refresh:()=>Promise<unknown>;notify:(s:string)=>void}) {
  const [collect,setCollect]=useState<number|null>(null);
  const s=statement(c,asOf),sc=c.schedule,client=data.actor.role==="CLIENTE";
  const first=firstUnpaid(c),collectible=!client&&!data.actor.readOnly&&first&&first.dueDate<=today();
  const next=s.rows.find(r=>r.pending!=="0.00");
  const owner=data.clients.find(row=>row.id===c.clientId);
  const line=owner?creditLine(owner.credit_limit,data.credits.filter(x=>x.clientId===c.clientId),asOf):null;
  const label=next?.status==="VENCIDA"?"Primera cuota vencida":"Próximo vencimiento";
  function exportCredit() {
    csvDownload(shortId(c.id)+".csv",
      ["Cuota","Vencimiento","Estado","Moneda","Gracia","TEA",periodLabel(sc.input.frequency),"Saldo inicial","Interés","Cuota pactada","Capital","Saldo final","Mora","Pago recibido","Fecha de pago","Días de atraso","Por cobrar"],
      s.rows.map(r=>[r.number,r.dueDate,statusLabels[r.status],c.currency,r.grace,r.tea??sc.input.tea,r.teq??sc.teq,r.opening,r.interest,r.payment,r.principal,r.closing,r.lateFee,r.totalPaid,r.paidDate??"",r.daysLate,r.pending]));
  }
  return <>
    <button className="text-button back-link" onClick={()=>go(client?"portal":"cronograma")}><ArrowLeft size={16}/> {client?"Mi cuenta":"Créditos"}</button>
    <PageTitle title={c.packageName} subtitle={`${shortId(c.id)} · ${c.clientName} · Compra ${date(sc.input.purchaseDate)}`}>
      {collectible&&<button className="primary" onClick={()=>setCollect(first.number)}><ReceiptText size={17}/> Registrar pago</button>}
      <button className="secondary" onClick={exportCredit}><Download size={16}/> CSV</button>
    </PageTitle>
    <div className="metrics">
      <Metric label={label} value={date(next?.dueDate)} note={next?`Cuota ${next.number} · ${fmt(next.pending,c.currency)} por cobrar`:"Cuotas al día"} accent/>
      <Metric label="Saldo financiero" value={fmt(s.outstanding,c.currency)} note={`Al ${date(asOf)}`}/>
      <Metric label="Pagos recibidos" value={fmt(s.paid,c.currency)} note={`Mora cobrada ${fmt(s.paidLateFee,c.currency)}`}/>
      {line&&<Metric label="Línea disponible" value={fmt(line.available,c.currency)} note={`Asignada ${fmt(line.limit,c.currency)}`}/>}
    </div>
    <section className="card">
      <div className="card-head"><div><h2>Cronograma del crédito</h2>
        <p>{sc.input.mode==="UNICO"?`Pago único · ${sc.initialDays} días de interés`:`${frequencyName(sc)} · ${sc.rows.length} cuotas · ${periodLabel(sc.input.frequency)} ${rate(sc.teq)}`}</p></div></div>
      <ScheduleView schedule={sc} rows={s.rows} currency={c.currency}/>
      <details className="full-schedule"><summary>Conciliación de intereses y capital</summary>
        <Values items={[
          ["Interés del desfase inicial",fmt(sc.initialInterest,c.currency)],
          ["Interés capitalizado durante la gracia total",fmt(sum(sc.rows.map(r=>r.capitalized)),c.currency)],
          ["Interés de las cuotas pactadas",fmt(sc.totals.cashInterest,c.currency)],
          ["Interés total",fmt(sc.totals.interest,c.currency)],["Amortizaciones recibidas",fmt(s.paidPrincipal,c.currency)],
          ["Mora pendiente al día consultado",fmt(s.pendingLateFee,c.currency)]
        ]}/>
      </details>
    </section>
    {collect!==null&&<PaymentView credit={c} number={collect} onClose={()=>setCollect(null)} onDone={async()=>{
      await refresh();setCollect(null);notify("Pago registrado. El saldo y la línea disponible se actualizaron.");
    }}/>}
  </>;
}

export function PaymentView({credit,number,onClose,onDone}:{credit:Credit;number:number;onClose:()=>void;onDone:()=>Promise<void>}) {
  const row=credit.schedule.rows[number-1],currency=credit.currency;
  const minDate=credit.payments.filter(p=>p.installmentNumber<number).reduce((min,p)=>p.paidDate>min?p.paidDate:min,row.dueDate);
  const [paidDate,setPaidDate]=useState(today),[error,setError]=useState<ApiError|null>(null),[reference,setReference]=useState("");
  const submission=useSubmission(),key=useReplayKey(),region=useErrorFocus(error,submission.busy);
  const fee=paidDate?lateFee(row.payment,row.dueDate,paidDate,credit.schedule.input.mora):{days:0,amount:"0.00"};
  const total=sum([row.payment,fee.amount]),paid=credit.payments.find(p=>p.installmentNumber===row.number);
  return <Modal title={`Registrar pago · cuota ${number}`} onClose={onClose} busy={submission.busy}>
    <div ref={region} className="modal-body">
      <p>{credit.packageName} · Vencimiento {date(row.dueDate)}</p>
      <form className="form-stack" onSubmit={e=>{
        e.preventDefault();
        void submission.run(async()=>{
          const payload={creditId:credit.id,installmentNumber:number,paidDate,total,reference:reference.trim()};
          setError(null);
          try {await api("payments",{...payload,idempotencyKey:key(payload)});await onDone();}
          catch(e){setError(errorMessage(e));}
        });
      }}>
        <Notice error={error}/>
        {paid&&<p role="status" className="banner">Esta cuota figura pagada el {date(paid.paidDate)}. Verifique la referencia {paid.reference||"del cobro"}.</p>}
        <Field label="Fecha de pago" hint="Desde el vencimiento o el último cobro hasta hoy." error={error}>
          <input name="paidDate" type="date" required min={minDate} max={today()} value={paidDate} onChange={e=>setPaidDate(e.target.value)}/>
        </Field>
        <Field label="Referencia del comprobante" hint="Número de recibo, operación o constancia." error={error}>
          <input name="reference" required maxLength={120} value={reference} onChange={e=>setReference(e.target.value)}/>
        </Field>
        <Values items={[
          ["Cuota pactada",fmt(row.payment,currency)],[`Mora · ${fee.days} días`,fmt(fee.amount,currency)],
          ["Interés compensatorio",fmt(row.interest,currency)],["Amortización de capital",fmt(row.principal,currency)]
        ]}/>
        <Field label="Importe completo a recibir" hint="Orden de imputación: mora, interés compensatorio y capital." error={error}>
          <input name="total" className="amount-input" readOnly value={fmt(total,currency)}/>
        </Field>
        <div className="form-actions">
          <button className="secondary" type="button" onClick={onClose} disabled={submission.busy}>Volver</button>
          <button className="primary" disabled={submission.busy||Boolean(paid&&!reference)}>{submission.busy?"Registrando…":"Confirmar pago"}</button>
        </div>
      </form>
    </div>
  </Modal>;
}

export function CutView({data,asOf,store,go}:{data:Data;asOf:string;store:StoreRow;go:Go}) {
  const days=[...new Set([store.cut_day,...data.credits.map(c=>c.schedule.input.cutDay)])].sort((a,b)=>a-b);
  const [cutDay,setCutDay]=useState(store.cut_day);
  const cutFor=(month:string,day:number)=>monthDate(Number(month.slice(0,4)),Number(month.slice(5,7))-1,day);
  const defaultMonth=asOf<cutFor(asOf.slice(0,7),cutDay)?monthDate(Number(asOf.slice(0,4)),Number(asOf.slice(5,7))-2,1).slice(0,7):asOf.slice(0,7);
  const [month,setMonth]=useState("");
  const listing=cutListing(data.credits,cutFor(month||defaultMonth,cutDay),cutDay,asOf);
  const totals=(["PEN","USD"] as const).map(currency=>{
    const rows=listing.rows.filter(r=>r.currency===currency);
    return {currency,base:sum(rows.map(r=>r.payment)),mora:sum(rows.map(r=>r.lateFee)),total:sum(rows.map(r=>r.pending))};
  });
  function exportCut() {
    const rows:(string|number)[][]=[];
    for(const r of listing.rows) {
      const meta=[r.clientName,r.purchaseDate,shortId(r.creditId),r.number,r.dueDate,r.currency];
      rows.push([...meta,"Cuota pactada",r.interest,r.principal,0,r.payment,r.category]);
      if(r.lateFee!=="0.00")rows.push([...meta,"Intereses por mora",0,0,r.lateFee,r.lateFee,r.category]);
    }
    for(const t of totals)rows.push(["","","","","",t.currency,`Total ${t.currency}`,"","",t.mora,t.total,""]);
    csvDownload("corte-"+listing.start+".csv",["Cliente","Fecha de compra","Crédito","Cuota","Vencimiento","Moneda","Concepto","Interés compensatorio","Capital","Mora","Por cobrar","Ciclo"],rows);
  }
  return <>
    <button className="text-button back-link" onClick={()=>go("cronograma")}><ArrowLeft size={16}/> Créditos</button>
    <PageTitle title="Corte mensual" subtitle={`Corte ${date(listing.start)} · Ciclo hasta ${date(listing.end)} · Consulta al ${date(asOf)}`}>
      <button className="secondary" onClick={exportCut}><Download size={16}/> Exportar CSV</button>
    </PageTitle>
    <div className="card filter-bar">
      <Field label="Mes de corte" hint="Seleccione el mes que desea consultar.">
        <input type="month" min="1900-02" max="2199-11" value={month||defaultMonth} onChange={e=>{if(e.target.value&&e.target.validity.valid)setMonth(e.target.value);}}/>
      </Field>
      <Field label="Día de corte" hint="Se aplica el día pactado en cada contrato.">
        <select value={cutDay} onChange={e=>setCutDay(Number(e.target.value))}>{days.map(d=><option key={d} value={d}>Día {d}{d===store.cut_day?" de la tienda":""}</option>)}</select>
      </Field>
    </div>
    <div className="metrics two">{totals.map(t=><Metric key={t.currency} label={`Por cobrar en ${t.currency}`} value={fmt(t.total,t.currency)} note={`Cuotas ${fmt(t.base,t.currency)} · Mora ${fmt(t.mora,t.currency)}`} accent={t.currency==="PEN"}/>)}</div>
    <section className="card">
      <div className="card-head"><h2>Cuotas por cobrar</h2><small>Ordenadas por cliente y fecha de compra</small></div>
      {listing.rows.length?<div className="record-list">{listing.rows.map(r=><Fragment key={r.creditId+r.number}>
        <article className="record cut-record">
          <div><strong>{r.clientName}</strong><small>{r.packageName} · Compra {date(r.purchaseDate)}</small></div>
          <div><strong>Cuota {r.number} · {date(r.dueDate)}</strong><small>{r.category==="CICLO"?"Del ciclo":"Atraso anterior"}</small></div>
          <div><Badge status={r.status}/><small>Interés {fmt(r.interest,r.currency)} · Capital {fmt(r.principal,r.currency)}</small></div>
          <b className="mono right">{fmt(r.payment,r.currency)}</b>
          <button className="text-button" onClick={()=>go("cronograma",r.creditId)} aria-label={`Ver crédito de ${r.clientName}, cuota ${r.number}`}><ArrowRight size={17}/></button>
        </article>
        {r.lateFee!=="0.00"&&<div className="late-record"><span>Intereses por mora · Cuota {r.number} · {r.daysLate} {r.daysLate===1?"día":"días"}</span><b className="mono">{fmt(r.lateFee,r.currency)}</b></div>}
      </Fragment>)}</div>:<Empty>No hay cuotas pendientes para este ciclo.</Empty>}
    </section>
  </>;
}

export function Portal({data,asOf,go}:{data:Data;asOf:string;go:Go}) {
  const client=data.clients[0];
  if(!client)return <><PageTitle title="Mi cuenta"/><Empty>La cuenta no está disponible.</Empty></>;
  const credits=data.credits.filter(c=>c.schedule.input.purchaseDate<=asOf);
  const line=creditLine(client.credit_limit,credits,asOf);
  return <>
    <PageTitle title="Mi cuenta" subtitle={client.name}/>
    <div className="metrics">
      <Metric label="Línea disponible" value={fmt(line.available,client.currency)} note={`Asignada ${fmt(line.limit,client.currency)}`} accent/>
      <Metric label="Saldo financiero" value={fmt(line.outstanding,client.currency)} note={`Al ${date(asOf)}`}/>
      <Metric label="Pagos recibidos" value={fmt(sum(credits.map(c=>statement(c,asOf).paid)),client.currency)}/>
    </div>
    <section className="card"><div className="card-head"><h2>Mis créditos</h2></div>{credits.length?<CreditList credits={credits} asOf={asOf} go={go}/>:<Empty>Aún no tiene créditos registrados.</Empty>}</section>
  </>;
}

export function Dashboard({data,asOf,go}:{data:Data;asOf:string;go:Go}) {
  const pending=data.requests.filter(r=>r.status==="PENDIENTE").length+data.clients.filter(c=>c.approval==="PENDIENTE").length;
  const all=data.credits.map(c=>({credit:c,statement:statement(c,asOf)}));
  const due=all.flatMap(({credit,statement:s})=>s.rows.filter(r=>r.pending!=="0.00").map(row=>({credit,row})))
    .sort((a,b)=>a.row.dueDate.localeCompare(b.row.dueDate)).slice(0,5);
  const pen=all.filter(x=>x.credit.currency==="PEN"),usd=all.filter(x=>x.credit.currency==="USD");
  return <>
    <PageTitle title="Inicio" subtitle={`${data.stores.find(s=>s.id===data.storeId)?.name??""} · Cartera al ${date(asOf)}`}>
      {!data.actor.readOnly&&<button className="primary" onClick={()=>go("compra")}><Plus size={17}/> Nueva venta</button>}
    </PageTitle>
    <div className="metrics">
      <Metric label="Saldo financiero en soles" value={fmt(sum(pen.map(x=>x.statement.outstanding)))} accent/>
      <Metric label="Por cobrar vencido en soles" value={fmt(sum(pen.map(x=>x.statement.overdue)))}/>
      <Metric label="Pagos recibidos en soles" value={fmt(sum(pen.map(x=>x.statement.paid)))}/>
      {usd.length>0&&<Metric label="Saldo financiero en dólares" value={fmt(sum(usd.map(x=>x.statement.outstanding)),"USD")}/>}
    </div>
    {pending>0&&<button className="banner actionable" onClick={()=>go("solicitudes")}><span>{pending} {pending===1?"solicitud por atender":"solicitudes por atender"}</span><ArrowRight size={18}/></button>}
    <section className="card">
      <div className="card-head"><h2>Próximos cobros y atrasos</h2><button className="text-button" onClick={()=>go("cronograma")}>Ver créditos <ArrowRight size={15}/></button></div>
      {due.length?<div className="record-list">{due.map(({credit:c,row:r})=><article className="record credit-record" key={c.id+r.number}>
        <div><strong>{c.clientName}</strong><small>{c.packageName} · Cuota {r.number}</small></div>
        <div><Badge status={r.status}/><small>{date(r.dueDate)}</small></div><b className="mono">{fmt(r.pending,c.currency)}</b>
        <button className="text-button" onClick={()=>go("cronograma",c.id)}>Ver crédito <ArrowRight size={16}/></button>
      </article>)}</div>:<Empty>No hay cobros pendientes a esta fecha.</Empty>}
    </section>
  </>;
}
