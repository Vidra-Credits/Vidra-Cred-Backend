"use client";

import {useEffect,useState,type ReactNode} from "react";
import {ArrowLeft,ArrowRight} from "lucide-react";
import {api,Brand,errorMessage,Field,Notice,textValue,useErrorFocus,useReplayKey,useSubmission,type ApiError} from "./ui";

function AccessFrame({title,children}:{title:string;children:ReactNode}) {
  return <main className="access">
    <div className="access-panel">
      <Brand/>
      <section className="access-card"><h1>{title}</h1>{children}</section>
    </div>
    <aside className="access-visual" aria-hidden="true"/>
  </main>;
}

export function Login({onLogin,onRegister,connectionError}:{onLogin:()=>Promise<void>;onRegister?:()=>void;connectionError:ApiError|null}) {
  const [error,setError]=useState<ApiError|null>(null),[config,setConfig]=useState<{registration:boolean;guest:boolean}|null>(null);
  const submission=useSubmission(),region=useErrorFocus(error,submission.busy);
  useEffect(()=>{
    void api<{registration:boolean;guest:boolean}>("public/config").then(setConfig).catch(()=>{});
  },[]);
  async function signIn(path:string,payload:object) {
    await submission.run(async()=>{
      setError(null);
      try {await api(path,payload);await onLogin();}
      catch(e){setError(errorMessage(e));}
    });
  }
  return <AccessFrame title="Iniciar sesión">
    <div ref={region}>
      <Notice error={error??connectionError}/>
      <form className="form-stack" onSubmit={e=>{
        e.preventDefault();const f=new FormData(e.currentTarget);
        void signIn("auth/login",{email:textValue(f,"email"),password:textValue(f,"password")});
      }}>
        <Field label="Correo electrónico"><input name="email" type="email" required maxLength={120} autoComplete="username"/></Field>
        <Field label="Contraseña"><input name="password" type="password" required maxLength={128} autoComplete="current-password"/></Field>
        <button className="primary full" disabled={submission.busy}>{submission.busy?"Ingresando…":"Ingresar"} <ArrowRight size={17}/></button>
      </form>
      {config?.guest&&<button className="secondary full access-link" type="button" disabled={submission.busy} onClick={()=>void signIn("auth/guest",{})}>Entrar como invitado</button>}
      {config?.registration!==false&&onRegister&&<button type="button" className="text-button access-link" onClick={onRegister} disabled={submission.busy}>Crear cuenta de cliente</button>}
    </div>
  </AccessFrame>;
}

export function Register({onDone,onBack}:{onDone:()=>Promise<void>;onBack:()=>void}) {
  const [stores,setStores]=useState<{id:string;name:string}[]|null>(null),[error,setError]=useState<ApiError|null>(null),[reload,setReload]=useState(0);
  const submission=useSubmission(),key=useReplayKey(),region=useErrorFocus(error,submission.busy);
  useEffect(()=>{
    let alive=true;
    void api<{stores:{id:string;name:string}[]}>("public/stores")
      .then(r=>{if(alive)setStores(r.stores);}).catch(e=>{if(alive)setError(errorMessage(e));});
    return()=>{alive=false;};
  },[reload]);
  return <AccessFrame title="Crear cuenta de cliente">
    <div ref={region}>
      <Notice error={error}/>
      {stores===null&&error&&<button className="secondary" onClick={()=>{setError(null);setReload(n=>n+1);}}>Reintentar conexión</button>}
      {stores===null&&!error&&<p role="status">Cargando tiendas…</p>}
      {stores?.length===0&&<p role="status">Aún no hay tiendas disponibles para registrarse.</p>}
      <form className="form-stack" onSubmit={e=>{
        e.preventDefault();
        const f=new FormData(e.currentTarget),value=(name:string)=>textValue(f,name);
        const payload={storeId:value("storeId"),name:value("name"),document:value("document"),phone:value("phone"),currency:value("currency"),email:value("email"),password:value("password")};
        void submission.run(async()=>{
          setError(null);
          try {await api("auth/register",{...payload,idempotencyKey:key(payload)});await onDone();}
          catch(e){setError(errorMessage(e));}
        });
      }}>
        <fieldset className="form-stack" disabled={submission.busy||!stores?.length}>
          <Field label="Tienda" hint="La tienda elegida revisará su cuenta." error={error}><select name="storeId" required defaultValue=""><option value="" disabled>Seleccione una tienda</option>{stores?.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
          <Field label="Nombre o razón social" hint="Tal como aparece en su documento." error={error}><input name="name" required minLength={2} maxLength={150} autoComplete="name"/></Field>
          <div className="form-grid">
            <Field label="DNI o RUC" hint="DNI de 8 dígitos o RUC de 11." error={error}><input name="document" inputMode="numeric" required pattern="[0-9]{8}|[0-9]{11}"/></Field>
            <Field label="Teléfono" hint="Opcional. Para coordinar con la tienda." error={error}><input name="phone" type="tel" maxLength={20} autoComplete="tel"/></Field>
          </div>
          <Field label="Moneda" hint="Moneda de sus compras y de su línea." error={error}><select name="currency" defaultValue="PEN"><option value="PEN">Soles (PEN)</option><option value="USD">Dólares (USD)</option></select></Field>
          <Field label="Correo electrónico" hint="Será su usuario de acceso." error={error}><input name="email" type="email" required maxLength={120} autoComplete="username"/></Field>
          <Field label="Contraseña" hint="Mínimo 10 caracteres." error={error}><input name="password" type="password" required minLength={10} maxLength={128} autoComplete="new-password"/></Field>
          <button className="primary full">{submission.busy?"Creando…":"Crear mi cuenta"} <ArrowRight size={17}/></button>
        </fieldset>
      </form>
      <button type="button" className="text-button access-link" disabled={submission.busy} onClick={onBack}><ArrowLeft size={16}/> Volver al acceso</button>
    </div>
  </AccessFrame>;
}
