"use client";

import {useEffect,useState,type ReactNode} from "react";
import {ArrowRight,Package,Plus} from "lucide-react";
import {D,POLICY,RuleError,creditLine,teaFromNominal,type Compounding} from "@/lib/finance";
import {api,Badge,Empty,errorMessage,Field,fmt,Modal,Notice,PageTitle,rate,textValue,useErrorFocus,useReplayKey,useSubmission,type ApiError} from "./ui";
import {compoundingLabels,saleModeLabels,type ClientRow,type Data,type Go,type Notify,type PackageRow,type Refresh,type StoreRow} from "./workspace-types";

export function ProductPhoto({src,alt=""}:{src?:string|null;alt?:string}) {
  const [broken,setBroken]=useState<string|null>(null);
  return <div className="product-photo">
    {src&&broken!==src?<img src={src} alt={alt} loading="lazy" onError={()=>setBroken(src)}/>:<Package size={42} strokeWidth={1.35} aria-hidden="true"/>}
  </div>;
}

export function ProductCard({product:p,restriction,children}:{product:PackageRow;restriction?:string;children:ReactNode}) {
  return <article className="card product-card">
    <ProductPhoto src={p.image} alt={`Foto de ${p.name}`}/>
    <div className="product-body">
      <div className="product-identity"><h2>{p.name}</h2>{!p.active&&<Badge status="INACTIVA"/>}</div>
      <p>{p.detail||p.brand}</p>
      <small>{p.unit} · {saleModeLabels[p.sale_mode]}</small>
      {restriction&&<small className="product-restriction">{restriction}</small>}
      <div className="prices">
        <div><span>Al contado</span><strong>{fmt(p.cash_price,p.currency)}</strong></div>
        <div><span>A crédito</span><strong>{fmt(p.amount,p.currency)}</strong></div>
      </div>
      {children}
    </div>
  </article>;
}

export function EditForm({title,onClose,onSave,children,submitLabel="Guardar cambios"}:{
  title:string;onClose:()=>void;onSave:(form:FormData,key:string)=>Promise<void>;
  children:(error:ApiError|null)=>ReactNode;submitLabel?:string;
}) {
  const [error,setError]=useState<ApiError|null>(null),submission=useSubmission(),key=useReplayKey(),region=useErrorFocus(error,submission.busy);
  return <Modal title={title} onClose={onClose} busy={submission.busy}>
    <div ref={region} className="modal-body">
      <Notice error={error}/>
      <form onSubmit={e=>{
        e.preventDefault();
        const form=new FormData(e.currentTarget);
        void submission.run(async()=>{
          setError(null);
          const signature=Array.from(form.entries(),([field,value])=>[field,
            typeof value==="string"?value:[value.name,value.size,value.type]]);
          try {await onSave(form,key(signature));onClose();}
          catch(e){setError(errorMessage(e));}
        });
      }}>
        <fieldset className="form-stack" disabled={submission.busy}>
          {children(error)}
          <div className="form-actions">
            <button type="button" className="secondary" onClick={onClose}>Cancelar</button>
            <button className="primary">{submission.busy?"Guardando…":submitLabel}</button>
          </div>
        </fieldset>
      </form>
    </div>
  </Modal>;
}

function RateFields({client,moratory=false,error}:{client?:ClientRow;moratory?:boolean;error:ApiError|null}) {
  const [kind,setKind]=useState(moratory?client?.mora_kind??"TEA":client?.rate_kind??"TEA");
  const kindName=moratory?"moraKind":"rateKind",rateName=moratory?"moraTea":"tea",compoundingName=moratory?"moraCompounding":"compounding";
  const raw=moratory?(client?.mora_kind==="TNA"?client.mora_input:client?.mora_tea)??POLICY.mora
    :(client?.rate_kind==="TNA"?client.rate_input:client?.tea)??"0.20";
  return <div className="form-grid">
    <Field label={moratory?"Tipo de tasa moratoria":"Tipo de tasa compensatoria"} hint="TEA efectiva o TNA nominal." error={error}>
      <select name={kindName} value={kind} onChange={e=>setKind(e.target.value as "TEA"|"TNA")}><option>TEA</option><option>TNA</option></select>
    </Field>
    <Field label={moratory?"Tasa moratoria (%)":"Tasa compensatoria (%)"} hint={moratory?"TEA equivalente de 0 % a 200 %.":"TEA equivalente de 15 % a 25 %."} error={error}>
      <input name={rateName} type="number" min={0} max={moratory?200:100} step="any" required defaultValue={new D(raw).mul(100).toString()}/>
    </Field>
    {kind==="TNA"&&<Field label={moratory?"Capitalización moratoria":"Capitalización compensatoria"} hint="Frecuencia con que se capitaliza la TNA." error={error}>
      <select name={compoundingName} defaultValue={(moratory?client?.mora_compounding:client?.compounding)??"MENSUAL"}>
        {Object.entries(compoundingLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}
      </select>
    </Field>}
  </div>;
}

function clientRate(form:FormData,moratory=false) {
  const kind=textValue(form,moratory?"moraKind":"rateKind"),field=moratory?"moraTea":"tea";
  const compounding=textValue(form,moratory?"moraCompounding":"compounding") as Compounding;
  try {
    const value=new D(textValue(form,field)).div(100),nominal=kind==="TNA";
    const effective=nominal?teaFromNominal(value,compounding):value;
    return {effective:effective.toFixed(12),kind,nominal:nominal?value.toFixed(12):null,compounding:nominal?compounding:null};
  } catch {throw new RuleError("Ingrese una tasa válida.",field);}
}

export function Clients({data,asOf,refresh,notify,go,selected}:{data:Data;asOf:string;refresh:Refresh;notify:Notify;go:Go;selected?:string}) {
  const [search,setSearch]=useState(""),[edit,setEdit]=useState<ClientRow|"new"|null>(null);
  const linked=data.clients.find(c=>c.id===selected),target=edit??linked,client=target==="new"?undefined:target;
  const shop=data.stores.find(s=>s.id===data.storeId);
  const found=data.clients.filter(c=>(c.name+" "+c.document).toLowerCase().includes(search.trim().toLowerCase()));
  function close(){setEdit(null);if(selected)go("solicitudes");}
  return <>
    <PageTitle title="Clientes" subtitle="Líneas, tasas y condiciones de compra">
      {!data.actor.readOnly&&<button className="primary" onClick={()=>setEdit("new")}><Plus size={17}/> Nuevo cliente</button>}
    </PageTitle>
    <section className="card">
      <div className="card-head"><h2>Cartera de clientes</h2><Field label="Buscar cliente"><input type="search" placeholder="Nombre o documento" value={search} onChange={e=>setSearch(e.target.value)}/></Field></div>
      {found.length?<div className="record-list">{found.map(c=>{
        const line=creditLine(c.credit_limit,data.credits.filter(x=>x.clientId===c.id),asOf);
        return <article className="record customer-record" key={c.id}>
          <div><strong>{c.name}</strong><small>{c.document} · {c.currency}</small></div>
          <div><Badge status={c.active?c.approval:"INACTIVA"}/><small>TEA {rate(c.tea)}</small></div>
          <div><small>Línea disponible</small><b className="mono">{fmt(line.available,c.currency)}</b></div>
          <div><small>Línea asignada</small><b className="mono">{fmt(line.limit,c.currency)}</b></div>
          {!data.actor.readOnly&&<button type="button" className="text-button" onClick={()=>setEdit(c)}>Editar <ArrowRight size={16}/></button>}
        </article>;
      })}</div>:<Empty>{data.clients.length?"No hay clientes que coincidan con la búsqueda.":"Aún no hay clientes registrados."}</Empty>}
    </section>
    {selected&&!linked&&<Notice error={{error:"La cuenta no está disponible en esta tienda."}}/>}
    {target&&!data.actor.readOnly&&<EditForm key={client?.id??"nuevo"} title={client?client.name:"Nuevo cliente"} onClose={close}
      onSave={async(f,key)=>{
        const compensatory=clientRate(f),mora=clientRate(f,true);
        const cutDay=textValue(f,"cutDay"),payDay=textValue(f,"payDay");
        const portalEmail=textValue(f,"portalEmail"),portalPassword=textValue(f,"portalPassword");
        await api("clients",{
          id:client?.id,storeId:data.storeId,name:textValue(f,"name"),document:textValue(f,"document"),phone:textValue(f,"phone"),address:textValue(f,"address"),
          currency:textValue(f,"currency"),tea:compensatory.effective,rateKind:compensatory.kind,rateInput:compensatory.nominal,compounding:compensatory.compounding,
          moraTea:mora.effective,moraKind:mora.kind,moraInput:mora.nominal,moraCompounding:mora.compounding,
          cutDay:cutDay?Number(cutDay):null,payDay:payDay?Number(payDay):null,
          creditLimit:textValue(f,"creditLimit"),maxMonths:Number(f.get("maxMonths")),active:f.has("active"),
          approval:textValue(f,"approval"),approvalNote:textValue(f,"approvalNote"),
          portalEmail:portalEmail||undefined,portalPassword:portalPassword||undefined
        },key);
        await refresh();notify("Cliente y condiciones guardados.");
      }}>
      {err=><>
        {client?.approval==="PENDIENTE"&&<p className="banner" role="status">Cuenta nueva en revisión. Fije la línea, la tasa y el plazo antes de aprobarla.</p>}
        <div className="form-grid">
          <Field label="Nombre o razón social" hint="Como figura en el documento." error={err}><input required name="name" minLength={2} maxLength={150} defaultValue={client?.name}/></Field>
          <Field label="DNI o RUC" hint="DNI de 8 dígitos o RUC de 11." error={err}><input required name="document" inputMode="numeric" pattern="[0-9]{8}|[0-9]{11}" defaultValue={client?.document}/></Field>
          <Field label="Teléfono" hint="Opcional. Hasta 20 caracteres." error={err}><input name="phone" type="tel" maxLength={20} defaultValue={client?.phone}/></Field>
          <Field label="Dirección" hint="Opcional. Dirección de contacto." error={err}><input name="address" maxLength={200} defaultValue={client?.address}/></Field>
          <Field label="Moneda" hint="Moneda de la línea y de las compras." error={err}><select name="currency" defaultValue={client?.currency??"PEN"}><option>PEN</option><option>USD</option></select></Field>
          <Field label="Línea asignada" hint="Entre 1 000 y 1 000 000 en la moneda elegida." error={err}><input required name="creditLimit" type="number" min={1000} max={1000000} step="0.01" defaultValue={client?.credit_limit??"5000"}/></Field>
          <Field label="Plazo máximo" hint="Cantidad máxima de cuotas mensuales." error={err}><select name="maxMonths" defaultValue={client?.max_months??5}>{[1,2,3,4,5].map(n=><option key={n} value={n}>{n} {n===1?"mes":"meses"}</option>)}</select></Field>
          <Field label="Estado de la cuenta" hint="Aprobada habilita las compras a crédito." error={err}><select name="approval" defaultValue={client?.approval??"APROBADO"}><option value="PENDIENTE">En revisión</option><option value="APROBADO">Aprobada</option><option value="RECHAZADO">Rechazada</option></select></Field>
        </div>
        <RateFields client={client} error={err}/>
        <details className="advanced"><summary>Condiciones avanzadas</summary>
          <div className="form-stack">
            <RateFields client={client} moratory error={err}/>
            <div className="form-grid">
              <Field label="Día de corte propio" hint={`Opcional. Valor de la tienda: día ${shop?.cut_day??25}.`} error={err}><input name="cutDay" type="number" min={1} max={31} defaultValue={client?.cut_day??""}/></Field>
              <Field label="Día de pago propio" hint={`Indique ambos días o herede el calendario de la tienda: pago el día ${shop?.pay_day??5}.`} error={err}><input name="payDay" type="number" min={1} max={30} defaultValue={client?.pay_day??""}/></Field>
            </div>
          </div>
        </details>
        <Field label="Nota para el cliente" hint="Es obligatoria si rechaza la cuenta." error={err}><textarea name="approvalNote" maxLength={300} rows={2} defaultValue={client?.approval_note}/></Field>
        <label className="checkbox"><input name="active" type="checkbox" defaultChecked={client?.active??true}/> Cliente activo</label>
        <details className="advanced"><summary>Acceso de cliente</summary><div className="form-grid">
          <Field label="Correo de acceso" hint="Complete ambos campos para crear o renovar el acceso." error={err}><input name="portalEmail" type="email" maxLength={120}/></Field>
          <Field label="Contraseña de acceso" hint="Mínimo 10 caracteres." error={err}><input name="portalPassword" type="password" minLength={10} maxLength={128} autoComplete="new-password"/></Field>
        </div></details>
      </>}
    </EditForm>}
  </>;
}

function ImageField({image,error}:{image?:string|null;error:ApiError|null}) {
  const [file,setFile]=useState<File|null>(null),[preview,setPreview]=useState(""),[remove,setRemove]=useState(false);
  useEffect(()=>{
    if(!file){setPreview("");return;}
    const url=URL.createObjectURL(file);
    setPreview(url);
    return ()=>URL.revokeObjectURL(url);
  },[file]);
  return <div className="image-field">
    <ProductPhoto src={preview||(remove?null:image)} alt="Vista previa del producto"/>
    <div className="form-stack">
      <Field label="Subir imagen" hint="JPEG, PNG o WebP. Hasta 1 MB." error={error}>
        <input name="image" type="file" accept="image/jpeg,image/png,image/webp" onChange={e=>{setFile(e.target.files?.[0]??null);setRemove(false);}}/>
      </Field>
      {image&&!file&&<label className="checkbox"><input type="checkbox" name="removeImage" checked={remove} onChange={e=>setRemove(e.target.checked)}/> Quitar la imagen actual</label>}
    </div>
  </div>;
}

export function Packages({data,refresh,notify}:{data:Data;refresh:Refresh;notify:Notify}) {
  const [edit,setEdit]=useState<PackageRow|"new"|null>(null),p=edit&&edit!=="new"?edit:undefined;
  return <>
    <PageTitle title="Productos" subtitle="Precios, modalidad de venta y fotos del catálogo">
      {!data.actor.readOnly&&<button className="primary" onClick={()=>setEdit("new")}><Plus size={17}/> Nuevo producto</button>}
    </PageTitle>
    {data.packages.length?<div className="product-grid">{data.packages.map(p=><ProductCard product={p} key={p.id}>
      {!data.actor.readOnly&&<button className="secondary full" onClick={()=>setEdit(p)}>Editar producto</button>}
    </ProductCard>)}</div>:<section className="card"><Empty>Aún no hay productos en esta tienda.</Empty></section>}
    {edit&&<EditForm title={p?"Editar producto":"Nuevo producto"} onClose={()=>setEdit(null)} onSave={async(f,key)=>{
      const value=(name:string)=>textValue(f,name);
      const payload={id:p?.id,storeId:data.storeId,name:value("name"),detail:value("detail"),currency:value("currency"),
        amount:value("amount"),cashPrice:value("cashPrice"),brand:value("brand"),supplier:value("supplier"),unit:value("unit"),
        saleMode:value("saleMode"),active:f.has("active"),removeImage:f.has("removeImage")};
      const image=f.get("image");
      if(image instanceof File&&image.size) {
        if(image.size>1024*1024)throw new RuleError("Suba una imagen de hasta 1 MB.","image");
        const upload=new FormData();
        upload.append("payload",JSON.stringify(payload));upload.append("image",image);
        await api("packages",upload,key);
      } else await api("packages",payload,key);
      await refresh();notify("Producto guardado.");
    }}>
      {err=><>
        <ImageField image={p?.image} error={err}/>
        <Field label="Nombre del producto" hint="Así se muestra en el catálogo." error={err}><input name="name" required minLength={2} maxLength={120} defaultValue={p?.name}/></Field>
        <Field label="Descripción" hint="Indique qué recibe el comprador." error={err}><textarea name="detail" maxLength={500} rows={2} defaultValue={p?.detail}/></Field>
        <div className="form-grid">
          <Field label="Precio a crédito" hint="De 1 000 a 5 000, en múltiplos de 100." error={err}><input name="amount" type="number" required min={1000} max={5000} step={100} defaultValue={p?.amount??1000}/></Field>
          <Field label="Precio al contado" hint="Hasta el precio a crédito." error={err}><input name="cashPrice" type="number" required min="0.01" max={5000} step="0.01" defaultValue={p?.cash_price??1000}/></Field>
          <Field label="Moneda" hint="Moneda de ambos precios." error={err}><select name="currency" defaultValue={p?.currency??"PEN"}><option>PEN</option><option>USD</option></select></Field>
          <Field label="Modalidad de venta" hint="Opciones que el cliente podrá cotizar." error={err}><select name="saleMode" defaultValue={p?.sale_mode??"AMBOS"}>{Object.entries(saleModeLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></Field>
          <Field label="Unidad de venta" hint="Ejemplo, caja, paquete o docena." error={err}><input name="unit" required maxLength={30} defaultValue={p?.unit??"Paquete"}/></Field>
          <Field label="Marca" hint="Opcional." error={err}><input name="brand" maxLength={80} defaultValue={p?.brand}/></Field>
          <Field label="Proveedor" hint="Opcional." error={err}><input name="supplier" maxLength={120} defaultValue={p?.supplier}/></Field>
        </div>
        <label className="checkbox"><input name="active" type="checkbox" defaultChecked={p?.active??true}/> Mostrar en el catálogo</label>
      </>}
    </EditForm>}
  </>;
}

export function Stores({data,refresh,notify,openStore}:{data:Data;refresh:Refresh;notify:Notify;openStore:(storeId:string)=>void}) {
  const [edit,setEdit]=useState<StoreRow|"new"|null>(null),s=edit&&edit!=="new"?edit:undefined;
  return <>
    <PageTitle title="Tiendas" subtitle="Calendario y acceso del administrador de cada comercio">
      <button className="primary" onClick={()=>setEdit("new")}><Plus size={17}/> {data.stores.length?"Nueva tienda":"Crear primera tienda"}</button>
    </PageTitle>
    <section className="card">
      <div className="card-head"><h2>Comercios registrados</h2><small>{data.stores.filter(t=>t.active).length} {data.stores.filter(t=>t.active).length===1?"activa":"activas"}</small></div>
      {data.stores.length?<div className="record-list">{data.stores.map(s=><article className="record store-record" key={s.id}>
        <div><strong>{s.name}</strong><small>{s.business} · RUC {s.ruc}</small><small>{s.admin_email??"Administrador por asignar"}</small></div>
        <div><small>Corte mensual</small><strong>Día {s.cut_day}</strong></div>
        <div><small>Pago mensual</small><strong>Día {s.pay_day}</strong></div>
        <Badge status={s.active?"ACTIVA":"INACTIVA"}/>
        <div className="row-actions"><button className="secondary" onClick={()=>setEdit(s)}>Editar</button>
          {s.active&&<button className="text-button" onClick={()=>openStore(s.id)}>Abrir tienda <ArrowRight size={16}/></button>}
        </div>
      </article>)}</div>:<Empty>Registre una tienda y las credenciales de su administrador para empezar.</Empty>}
      {data.stores.length>0&&!data.stores.some(t=>t.active)&&<Empty>Active una tienda o cree una nueva para operar.</Empty>}
    </section>
    {edit&&<EditForm title={s?"Editar tienda":"Nueva tienda"} onClose={()=>setEdit(null)} onSave={async(f,key)=>{
      const value=(name:string)=>textValue(f,name);
      await api("stores",{id:s?.id,name:value("name"),business:value("business"),ruc:value("ruc"),
        cutDay:Number(value("cutDay")),payDay:Number(value("payDay")),active:f.has("active"),
        adminName:value("adminName"),adminEmail:value("adminEmail"),adminPassword:value("adminPassword")||undefined},key);
      await refresh();notify("Tienda guardada.");
    }}>
      {err=><>
        <div className="form-grid">
          <Field label="Nombre comercial" hint="Identifica el comercio en el acceso." error={err}><input name="name" required minLength={2} maxLength={120} defaultValue={s?.name}/></Field>
          <Field label="Giro" hint="Actividad principal de la tienda." error={err}><input name="business" required minLength={2} maxLength={60} defaultValue={s?.business}/></Field>
          <Field label="RUC" hint="11 dígitos." error={err}><input name="ruc" required inputMode="numeric" pattern="[0-9]{11}" defaultValue={s?.ruc}/></Field>
          <Field label="Día de corte" hint="De 1 a 31. En meses cortos se usa el último día." error={err}><input name="cutDay" type="number" min={1} max={31} required defaultValue={s?.cut_day??20}/></Field>
          <Field label="Día de pago mensual" hint="De 1 a 30. Si el día es igual o anterior al corte, el pago pasa al mes siguiente." error={err}><input name="payDay" type="number" min={1} max={30} required defaultValue={s?.pay_day??26}/></Field>
        </div>
        <label className="checkbox"><input name="active" type="checkbox" defaultChecked={s?.active??true}/> Tienda activa</label>
        <h3>Administrador de tienda</h3>
        <div className="form-grid">
          <Field label="Nombre del administrador" hint="Nombre visible en la sesión de Tienda." error={err}><input name="adminName" required minLength={2} maxLength={120} defaultValue={s?.admin_name??""}/></Field>
          <Field label="Correo de acceso" hint="Correo con el que iniciará sesión." error={err}><input name="adminEmail" required type="email" maxLength={120} defaultValue={s?.admin_email??""}/></Field>
          <Field label="Contraseña del administrador" hint={s?.admin_email?"10 caracteres como mínimo. Deje vacío para conservar la contraseña.":"10 caracteres como mínimo."} error={err}><input name="adminPassword" required={!s?.admin_email} type="password" minLength={10} maxLength={128} autoComplete="new-password"/></Field>
        </div>
      </>}
    </EditForm>}
  </>;
}
