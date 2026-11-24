"use client";

import {useCallback,useEffect,useRef,useState} from "react";
import {ArrowLeft,BookOpen,CalendarDays,FlaskConical,LogOut,Menu,RefreshCw} from "lucide-react";
import {today} from "@/lib/finance";
import {Login,Register} from "./access";
import {CutView,Dashboard,Portal,Schedules} from "./credit-views";
import {Clients,Packages,Stores} from "./management";
import {Catalog,Purchase,Requests} from "./purchases";
import {api,Brand,date,errorMessage,Field,Notice,PageTitle,useSubmission,type ApiError} from "./ui";
import type {Data,Go,View} from "./workspace-types";

const clientNav=[["catalogo","Catálogo"],["solicitudes","Mis solicitudes"],["portal","Mi cuenta"]] as const;
const shopNav=[["panel","Inicio"],["solicitudes","Solicitudes"],["clientes","Clientes"],["paquetes","Productos"],["cronograma","Créditos"]] as const;
const systemNav=[["tiendas","Tiendas"]] as const;
const allViews=new Set<View>([...clientNav.map(x=>x[0]),...shopNav.map(x=>x[0]),"tiendas","compra","corte","pagos","guia","simulador"]);
type Location={view?:View;id?:string;store?:string};

function readLocation():Location {
  const params=new URLSearchParams(window.location.search),view=params.get("vista") as View;
  return {view:allViews.has(view)?view:undefined,id:params.get("id")??undefined,store:params.get("tienda")??undefined};
}
function writeLocation(nav:Location,replace=false) {
  const params=new URLSearchParams();
  if(nav.view)params.set("vista",nav.view);
  if(nav.id)params.set("id",nav.id);
  if(nav.store)params.set("tienda",nav.store);
  const url=params.size?"?"+params.toString():"/";
  if(replace)window.history.replaceState(null,"",url);
  else window.history.pushState(null,"",url);
}

function initialView(data:Data):View {
  return data.actor.role==="CLIENTE"?"catalogo":data.actor.role==="SISTEMA"?"tiendas":"panel";
}
function safeView(data:Data,nav:Location):View {
  const requested=nav.view??initialView(data);
  if(data.actor.role==="CLIENTE")
    return clientNav.some(([id])=>id===requested)||requested==="guia"||(requested==="cronograma"&&nav.id)?requested:"catalogo";
  if(data.actor.role==="SISTEMA"&&!data.storeId&&!["tiendas","guia","simulador"].includes(requested))return "tiendas";
  if(requested==="catalogo"||requested==="portal"||(requested==="tiendas"&&data.actor.role!=="SISTEMA"))return initialView(data);
  if(requested==="pagos")return "cronograma";
  if(requested==="simulador"&&data.actor.role!=="SISTEMA"&&!data.actor.readOnly)return "panel";
  return requested;
}

export default function Workspace() {
  const [data,setData]=useState<Data|null>(null),[loading,setLoading]=useState(true);
  const [error,setError]=useState<ApiError|null>(null),[route,setRoute]=useState<Location>({});
  const [historical,setHistorical]=useState<string|null>(null),[toast,setToast]=useState(""),[mobile,setMobile]=useState(false),[register,setRegister]=useState(false);
  const currentStore=useRef<string|undefined>(undefined),requestId=useRef(0),hadSession=useRef(false);
  const sessionSubmission=useSubmission();
  const refresh=useCallback(async(store=currentStore.current)=>{
    const id=++requestId.current;
    try {
      let fresh:Data;
      try {fresh=await api<Data>("bootstrap"+(store?"?storeId="+encodeURIComponent(store):""));}
      catch(e) {
        if(!store||errorMessage(e).status!==404)throw e;
        fresh=await api<Data>("bootstrap");
      }
      if(id!==requestId.current)return;
      hadSession.current=true;
      setData(fresh);setError(null);
      return fresh;
    } catch(e) {
      if(id!==requestId.current)return;
      const issue=errorMessage(e);
      if(issue.status===401) {
        setData(null);setRegister(false);
        setError(hadSession.current?{error:"Su sesión venció. Ingrese para continuar."}:null);
        hadSession.current=false;
      } else setError(issue);
    } finally {if(id===requestId.current)setLoading(false);}
  },[]);
  useEffect(()=>{
    function read() {
      const next=readLocation();
      const changed=currentStore.current!==next.store;
      currentStore.current=next.store;setRoute(next);setMobile(false);
      if(changed||!hadSession.current)void refresh();
    }
    function recheck(){if(hadSession.current&&document.visibilityState==="visible")void refresh();}
    read();
    window.addEventListener("popstate",read);
    window.addEventListener("focus",recheck);
    document.addEventListener("visibilitychange",recheck);
    window.addEventListener("online",recheck);
    window.addEventListener("vidracred-session",recheck);
    return()=>{
      window.removeEventListener("popstate",read);
      window.removeEventListener("focus",recheck);
      document.removeEventListener("visibilitychange",recheck);
      window.removeEventListener("online",recheck);
      window.removeEventListener("vidracred-session",recheck);
    };
  },[refresh]);
  useEffect(()=>{
    if(!toast)return;
    const timeout=setTimeout(()=>setToast(""),6500);
    return()=>clearTimeout(timeout);
  },[toast]);
  const screen=data?safeView(data,route):undefined;
  useEffect(()=>{
    if(screen==="simulador"){window.location.replace("/simulador");return;}
    if(!data)return;
    if(screen==="tiendas"&&route.view&&route.view!=="tiendas") {
      currentStore.current=undefined;
      const next:Location={view:"tiendas"};
      setRoute(next);writeLocation(next,true);
    }
  },[data,route.view,screen]);

  function navigate(next:Location,replace=false) {
    currentStore.current=next.store;
    setRoute(next);setMobile(false);writeLocation(next,replace);
    if(next.view!==route.view||(next.view==="cronograma"&&next.id!==route.id)) {
      window.scrollTo({top:0,behavior:"instant"});
      requestAnimationFrame(()=>{
        if(document.querySelector("dialog[open]"))return;
        const trigger=next.view==="solicitudes"&&route.view==="clientes"&&route.id
          ?document.querySelector<HTMLElement>(`[data-account-review="${CSS.escape(route.id)}"]`):null;
        (trigger??document.querySelector<HTMLElement>("main h1"))?.focus();
      });
    }
  }
  const go:Go=(view,id)=>navigate({view,id,store:view==="tiendas"?undefined:route.store});
  async function afterAuth() {
    const d=await refresh("");
    if(d){setHistorical(null);navigate({view:initialView(d)},true);}
  }
  function signOut() {
    void sessionSubmission.run(async()=>{
      try {
        await api("auth/logout",{});
        ++requestId.current;hadSession.current=false;
        setData(null);setError(null);setRegister(false);setHistorical(null);setToast("");
        navigate({},true);
      } catch(e){setError(errorMessage(e));}
    });
  }
  if(loading||screen==="simulador")return <main className="loading" aria-busy="true"><Brand/><p role="status">Preparando VidraCred…</p></main>;
  if(!data)return register?<Register onDone={afterAuth} onBack={()=>setRegister(false)}/>
    :<Login onLogin={afterAuth} onRegister={()=>setRegister(true)} connectionError={error}/>;

  const store=data.stores.find(s=>s.id===data.storeId),actor=data.actor;
  const client=actor.role==="CLIENTE",system=actor.role==="SISTEMA";
  const systemHome=system&&(screen==="tiendas"||!store||(screen==="guia"&&!route.store));
  const nav=client?clientNav:systemHome?systemNav:shopNav;
  const active=screen==="corte"||screen==="pagos"?"cronograma":screen==="compra"?"panel":client&&screen==="cronograma"?"portal":screen;
  const pending=data.requests.filter(r=>r.status==="PENDIENTE").length+(client?0:data.clients.filter(c=>c.active&&c.approval==="PENDIENTE").length);
  const selected=screen===route.view?route.id:undefined,asOf=historical??today();
  const doneRefresh=()=>refresh();
  async function openStore(id:string) {
    const fresh=await refresh(id);
    if(fresh?.storeId===id)navigate({view:"panel",store:id});
  }
  return <div className="workspace">
    <a className="skip-link" href="#contenido">Saltar al contenido</a>
    <header className="workspace-header">
      <div className="app-bar">
        <div className="app-identity"><Brand/><span className="store-name">{system&&screen==="tiendas"?"Sistema":store?.name}</span></div>
        <div className="header-actions">
          {(system||actor.readOnly)&&<a className="secondary link-button" href="/simulador"><FlaskConical size={17}/> Simulador</a>}
          <button className="icon-button" title="Ayuda" aria-label="Ayuda" onClick={()=>go("guia")}><BookOpen size={19}/></button>
          <button className="icon-button" title="Cerrar sesión" aria-label="Cerrar sesión" onClick={signOut} disabled={sessionSubmission.busy}><LogOut size={19}/></button>
          <button className="icon-button menu-button" type="button" aria-expanded={mobile} aria-controls="navegacion"
            onClick={()=>setMobile(v=>!v)} aria-label={mobile?"Cerrar menú":"Abrir menú"}><Menu size={22}/></button>
        </div>
      </div>
      <div className={"nav-rail"+(mobile?" open":"")}>
        <nav id="navegacion" aria-label="Navegación principal">
          {system&&!systemHome&&<button className="nav-back" onClick={()=>go("tiendas")}><ArrowLeft size={16}/> Tiendas</button>}
          {nav.map(([id,label])=><button key={id} onClick={()=>go(id)} aria-current={active===id?"page":undefined}>
            {label}{id==="solicitudes"&&pending>0&&<span className="nav-count" aria-label={`${pending} pendientes`}>{pending}</span>}
          </button>)}
        </nav>
        <div className="session-name"><span>{actor.readOnly?"Invitado":client?"Cliente":system?"Sistema":"Tienda"}</span><strong>{actor.name}</strong></div>
      </div>
    </header>
    <main id="contenido" className="workspace-main">
      {error&&<div className="connection"><Notice error={error}/><button className="secondary" onClick={()=>void refresh()}><RefreshCw size={16}/> Reintentar</button></div>}
      {actor.readOnly&&<p className="banner" role="status">Modo invitado · Consultas y simulación</p>}
      {["panel","clientes","cronograma","corte","portal"].includes(screen??"")&&<details className="history-filter" open={historical?true:undefined}>
        <summary><CalendarDays size={16}/> {historical?`Consulta al ${date(historical)}`:"Consultar una fecha histórica"}</summary>
        <div>
          <Field label="Fecha de consulta" hint="Los saldos y cobros se calculan a esta fecha.">
            <input type="date" min="1900-02-01" max={today()} value={asOf} onChange={e=>{
              if(e.target.value&&e.target.validity.valid)setHistorical(e.target.value===today()?null:e.target.value);
            }}/>
          </Field>
          <button className="secondary" onClick={()=>setHistorical(null)}>Usar fecha de hoy</button>
        </div>
      </details>}
      {screen==="tiendas"&&<Stores data={data} refresh={doneRefresh} notify={setToast} openStore={id=>void openStore(id)}/>}
      {screen==="panel"&&<Dashboard data={data} asOf={asOf} go={go}/>}
      {screen==="catalogo"&&<Catalog data={data} refresh={doneRefresh} notify={setToast} go={go}/>}
      {screen==="solicitudes"&&<Requests key={data.storeId} data={data} refresh={doneRefresh} notify={setToast} go={(view,id)=>{
        if(view==="cronograma")setHistorical(null);
        go(view,id);
      }} selected={selected}/>}
      {screen==="clientes"&&<Clients key={data.storeId} data={data} asOf={asOf} refresh={doneRefresh} notify={setToast} go={go} selected={selected}/>}
      {screen==="paquetes"&&<Packages key={data.storeId} data={data} refresh={doneRefresh} notify={setToast}/>}
      {screen==="compra"&&store&&(actor.readOnly?<Notice error={{error:"Inicie sesión como administrador para registrar una venta."}}/>:
        <Purchase key={store.id} data={data} store={store} onDone={async id=>{
          await refresh();setHistorical(null);setToast("Crédito registrado con las condiciones cotizadas.");go("cronograma",id);
        }}/>)}
      {screen==="cronograma"&&<Schedules key={data.storeId} data={data} asOf={asOf} selected={selected??(route.view==="pagos"?route.id:undefined)} go={go} refresh={doneRefresh} notify={message=>{setHistorical(null);setToast(message);}}/>}
      {screen==="corte"&&store&&<CutView key={store.id} data={data} asOf={asOf} store={store} go={go}/>}
      {screen==="portal"&&<Portal data={data} asOf={asOf} go={go}/>}
      {screen==="guia"&&<Guide role={actor.role} go={go}/>}
    </main>
    {toast&&<div className="toast" role="status">{toast}<button aria-label="Cerrar aviso" onClick={()=>setToast("")}>×</button></div>}
  </div>;
}

function Guide({role,go}:{role:Data["actor"]["role"];go:Go}) {
  const client=role==="CLIENTE",system=role==="SISTEMA";
  return <>
    <PageTitle title="Ayuda" subtitle={client?"Compras a crédito y vencimientos":system?"Administración de tiendas y simulación":"Ventas, aprobaciones y cobros"}/>
    <section className="card guide">
      <h2>{client?"Comprar desde el catálogo":system?"Administrar un comercio":"Atender una solicitud"}</h2>
      {client?<ol><li>Consulte la línea disponible y busque un producto.</li><li>Elija plazo o pago único y revise la cotización.</li><li>Envíe la solicitud. Abra el contrato desde Mis solicitudes al aprobarse.</li></ol>
        :system?<ol><li>Registre el calendario de la tienda y las credenciales del administrador.</li><li>Abra la tienda para consultar su operación.</li><li>Use el Simulador de la cabecera para probar el Anexo A.</li></ol>
        :<ol><li>Abra la cuenta nueva desde Solicitudes y defina la línea, tasa y plazo.</li><li>Revise la cotización de la compra antes de aprobarla.</li><li>Abra el crédito y registre el pago completo cuando venza la primera cuota pendiente.</li></ol>}
      <button className="secondary" onClick={()=>go(client?"catalogo":system?"tiendas":"solicitudes")}>{client?"Ir al catálogo":system?"Ver tiendas":"Ver solicitudes"}</button>
    </section>
    <section className="card guide">
      <h2>Convenciones de cálculo</h2>
      <dl>
        <dt>Tasa nominal a efectiva</dt><dd>TEA = (1 + TNA/m)ᵐ − 1. Use 360 capitalizaciones diarias o 12 mensuales por año.</dd>
        <dt>Frecuencia</dt><dd>TEM = (1 + TEA)^(30/360) − 1. En contratos quincenales use TEQ con 15/360.</dd>
        <dt>Gracia</dt><dd>T capitaliza el interés, P paga el interés y S amortiza el capital.</dd>
        <dt>Pago único</dt><dd>El interés usa los días reales entre la compra y el vencimiento, sobre una base anual de 360.</dd>
        <dt>Prelación de pagos</dt><dd>Se cobra primero la mora de la cuota vencida, después el interés compensatorio y al final el capital.</dd>
        <dt>Precisión</dt><dd>Importes a dos decimales, tasas a siete o más.</dd>
      </dl>
    </section>
  </>;
}

export {Login,Register,Clients,Packages,Purchase,Schedules,CutView,Portal,Stores,Catalog,Requests,Dashboard,Guide};
export {Simulator} from "./simulator";
export {PaymentView} from "./credit-views";
export type {Data};
