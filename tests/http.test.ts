import {test} from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {IDS} from "../scripts/demo";
const base=process.env.TEST_ORIGIN??"http://localhost:3000";
async function request(path:string,body?:unknown,cookie?:string,origin=base){
  return fetch(base+path,{method:body?"POST":"GET",headers:{...(body?{"Content-Type":"application/json","Origin":origin}:{}),...(cookie?{Cookie:cookie}:{})},body:body?JSON.stringify(body):undefined});
}
test("HTTP: página, sesión local, permisos, validación del servidor y cierre de sesión",async()=>{
  const page=await request("/");assert.equal(page.status,200);assert.match(await page.text(),/VidraCred/);
  assert.equal((await request("/api/bootstrap")).status,401);
  assert.equal((await request("/api/auth/login",{email:"tienda@vidracred.local",password:"incorrecta"})).status,401);
  const login=await request("/api/auth/login",{email:"tienda@vidracred.local",password:process.env.DEMO_PASSWORD??"Vidra2026!"});assert.equal(login.status,200);
  const header=login.headers.get("set-cookie")!;assert.match(header,/HttpOnly/i);assert.match(header,/SameSite=strict/i);const cookie=header.split(";")[0];
  const data=await (await request("/api/bootstrap",undefined,cookie)).json();assert.equal(data.actor.role,"NEGOCIO");assert.ok(data.credits.length>=4);
  const input={storeId:IDS.store,clientId:IDS.nutra,packageId:IDS.goteros,purchaseDate:"2026-07-08",months:1,grace:"S"};
  const q=await request("/api/simulate",input,cookie);assert.equal(q.status,200);assert.equal((await q.json()).schedule.initialBalance,"2028.56");
  assert.equal((await request("/api/simulate",{...input,storeId:IDS.otherStore},cookie)).status,404);
  assert.equal((await request("/api/simulate",{...input,months:6,grace:"SSSSSSSSSSSS"},cookie)).status,422);
  assert.equal((await request("/api/simulate",input,cookie,"https://origen-no-autorizado.test")).status,403);
  assert.equal((await request("/api/stores",{},cookie)).status,403);
  assert.equal((await request("/api/auth/logout",{},cookie)).status,200);assert.equal((await request("/api/bootstrap",undefined,cookie)).status,401);
  const clientLogin=await request("/api/auth/login",{email:"cliente@vidracred.local",password:process.env.DEMO_PASSWORD??"Vidra2026!"});assert.equal(clientLogin.status,200);
  const clientCookie=clientLogin.headers.get("set-cookie")!.split(";")[0];
  assert.equal((await request("/api/bootstrap?storeId="+IDS.otherStore,undefined,clientCookie)).status,404);
  const portal=await (await request("/api/bootstrap",undefined,clientCookie)).json();assert.equal(portal.clients.length,1);assert.ok(portal.credits.every((c:{clientId:string})=>c.clientId===IDS.carrillo));
  const own=await request("/api/simulate",input,clientCookie);assert.ok([200,422].includes(own.status));
  if(own.status===200)assert.match((await own.json()).clientName,/Jardín Botánico Demo/);
  assert.equal((await request("/api/credits",{},clientCookie)).status,403);assert.equal((await request("/api/payments",{},clientCookie)).status,403);
  await request("/api/auth/logout",{},clientCookie);
});
test("HTTP: Cliente, Tienda y Sistema pueden iniciar sesión a la vez",async()=>{
  const roles=[["cliente","CLIENTE"],["tienda","NEGOCIO"],["sistema","SISTEMA"]] as const;
  const users=await Promise.all([...roles,...roles].map(async ([account,role])=>{
    const res=await request("/api/auth/login",{
      email:account+"@vidracred.local",password:process.env.DEMO_PASSWORD??"Vidra2026!"
    });
    assert.equal(res.status,200,account);
    assert.equal((await res.json()).actor.role,role);
    return res.headers.get("set-cookie")!.split(";")[0];
  }));
  await Promise.all(users.map(async cookie=>{
    assert.equal((await request("/api/auth/logout",{},cookie)).status,200);
  }));
});
test("HTTP: registro público, aislamiento del cliente nuevo y rutas restringidas",async()=>{
  const config=await (await request("/api/public/config")).json();
  if(!config.registration) {
    assert.equal((await request("/api/auth/register",{})).status,403);
    return;
  }
  const stores=await request("/api/public/stores");assert.equal(stores.status,200);assert.ok((await stores.json()).stores.length>=1);
  const email=`prueba.${Date.now()}@correo.test`,doc=String(Date.now()).slice(-8);
  const bad=await request("/api/auth/register",{storeId:IDS.store,name:"Prueba HTTP",document:"12",email,password:"clave-segura-1",currency:"PEN"});assert.equal(bad.status,422);
  const short=await request("/api/auth/register",{storeId:IDS.store,name:"Prueba HTTP",document:doc,email,password:"corta",currency:"PEN"});assert.equal(short.status,422);
  const ok=await request("/api/auth/register",{storeId:IDS.store,name:"Prueba HTTP",document:doc,email,password:"clave-segura-1",currency:"PEN"});assert.equal(ok.status,201);
  const header=ok.headers.get("set-cookie")!;assert.match(header,/HttpOnly/i);const cookie=header.split(";")[0];
  assert.equal((await request("/api/auth/register",{storeId:IDS.store,name:"Prueba HTTP",document:doc,email,password:"clave-segura-1",currency:"PEN"})).status,409);
  const data=await (await request("/api/bootstrap",undefined,cookie)).json();assert.equal(data.actor.role,"CLIENTE");assert.equal(data.clients[0].approval,"PENDIENTE");assert.equal(data.credits.length,0);
  const pkg=data.packages[0].id;
  assert.equal((await request("/api/requests",{packageId:pkg,months:1,grace:"SS",idempotencyKey:crypto.randomUUID()},cookie)).status,422);
  assert.equal((await request("/api/credits",{},cookie)).status,403);
  assert.equal((await request("/api/clients",{},cookie)).status,403);
  assert.equal((await request("/api/requests/resolve",{id:crypto.randomUUID(),action:"aprobar"},cookie)).status,403);
  assert.equal((await request("/api/auth/register",{storeId:IDS.store,name:"x",document:doc,email,password:"clave-segura-1",currency:"PEN"},undefined,"https://origen-no-autorizado.test")).status,403);
  await request("/api/auth/logout",{},cookie);
});
test("HTTP: modo invitado de solo lectura, datos personales enmascarados y sin acceso por contraseña",async()=>{
  const cfg=await (await request("/api/public/config")).json();
  if(!cfg.guest){
    assert.equal((await request("/api/auth/guest",{})).status,404);
    assert.equal((await request("/api/bootstrap")).status,401);
    return;
  }
  // La cuenta invitado no se puede usar con contraseña.
  assert.equal((await request("/api/auth/login",{email:"invitado@vidracred.demo",password:process.env.DEMO_PASSWORD??"Vidra2026!"})).status,401);
  assert.equal((await request("/api/bootstrap")).status,401);
  const res=await request("/api/auth/guest",{});assert.equal(res.status,200);
  const header=res.headers.get("set-cookie")!;assert.match(header,/HttpOnly/i);const cookie=header.split(";")[0];
  const data=await (await request("/api/bootstrap",undefined,cookie)).json();
  assert.equal(data.actor.readOnly,true);assert.equal(data.actor.role,"NEGOCIO");assert.ok(data.credits.length>=4);
  // Sin datos personales: documento enmascarado, sin teléfono ni dirección.
  assert.ok(data.clients.every((c:{document:string;phone:string;address:string})=>/^•+\d{3}$/.test(c.document)&&c.phone===""&&c.address===""));
  // Cotizar sí (no escribe).
  const input={storeId:IDS.store,clientId:IDS.nutra,packageId:IDS.goteros,purchaseDate:"2026-07-08",months:1,grace:"S"};
  assert.equal((await request("/api/simulate",input,cookie)).status,200);
  // Cualquier escritura queda bloqueada con 403, incluso con cuerpo válido.
  for(const path of ["/api/credits","/api/payments","/api/stores","/api/clients","/api/packages","/api/requests","/api/requests/resolve","/api/requests/cancel"])
    assert.equal((await request(path,{},cookie)).status,403,path);
  assert.equal((await request("/api/auth/logout",{},cookie)).status,200);assert.equal((await request("/api/bootstrap",undefined,cookie)).status,401);
});

test("HTTP: cotización persistida, crédito compartido y simulador con sesión Sistema",async()=>{
  async function login(role:string) {
    const res=await request("/api/auth/login",{email:role+"@vidracred.local",password:process.env.DEMO_PASSWORD??"Vidra2026!"});
    assert.equal(res.status,200);
    return res.headers.get("set-cookie")!.split(";")[0];
  }
  const [client,shop,other,system]=await Promise.all(["cliente","tienda","aurora","sistema"].map(login));
  const config={packageId:IDS.goteros,months:2,grace:"SS",frequency:"MENSUAL"};
  const quoteResponse=await request("/api/simulate",config,client);
  assert.equal(quoteResponse.status,200);
  const {fingerprint,schedule}=await quoteResponse.json();
  const payload={...config,previewFingerprint:fingerprint,idempotencyKey:crypto.randomUUID()};
  assert.equal((await request("/api/requests",{...payload,previewFingerprint:undefined},client)).status,422);
  const sent=await request("/api/requests",payload,client);
  assert.equal(sent.status,201);const {id}=await sent.json();
  assert.equal((await (await request("/api/requests",payload,client)).json()).id,id);
  assert.equal((await request("/api/requests/"+id+"/preview",undefined,other)).status,404);
  const res=await request("/api/requests/resolve",{id,action:"aprobar",idempotencyKey:crypto.randomUUID()},shop);
  assert.equal(res.status,200);const {creditId}=await res.json();
  for(const cookie of [client,shop]) {
    const data=await (await request("/api/bootstrap",undefined,cookie)).json();
    assert.equal(data.requests.find((r:{id:string})=>r.id===id).credit_id,creditId);
    assert.deepEqual(data.credits.find((c:{id:string})=>c.id===creditId).schedule,schedule);
  }
  const simulator=await fetch(base+"/simulador",{headers:{Cookie:system},redirect:"manual"});
  assert.equal(simulator.status,200);assert.match(await simulator.text(),/Cronograma editable/);
  assert.equal((await fetch(base+"/simulador",{headers:{Cookie:client},redirect:"manual"})).status,307);
});

test("HTTP: foto multipart privada, límite de 1 MB y edición sin reemplazo",async()=>{
  async function cookie(role:string) {
    const res=await request("/api/auth/login",{email:role+"@vidracred.local",password:process.env.DEMO_PASSWORD??"Vidra2026!"});
    assert.equal(res.status,200);return res.headers.get("set-cookie")!.split(";")[0];
  }
  const [shop,client,other]=await Promise.all(["tienda","cliente","aurora"].map(cookie));
  const product={storeId:IDS.store,name:"Caja con imagen de prueba",detail:"Foto de catálogo",currency:"PEN",amount:"1000",cashPrice:"925.93",active:true};
  const bytes=new Uint8Array(await readFile("public/productos/frascos.webp"));
  function upload(data:Uint8Array<ArrayBuffer>,type:string,key=crypto.randomUUID()){
    const form=new FormData();
    form.append("payload",JSON.stringify(product));
    form.append("image",new Blob([data],{type}),"producto.webp");
    return fetch(base+"/api/packages",{method:"POST",headers:{Origin:base,Cookie:shop,"Idempotency-Key":key},body:form});
  }
  assert.equal((await upload(new Uint8Array(1024*1024+1),"image/webp")).status,413);
  assert.equal((await upload(new TextEncoder().encode("archivo inválido"),"image/webp")).status,422);
  const key=crypto.randomUUID(),saved=await upload(bytes,"image/webp",key);
  assert.equal(saved.status,200);
  const {id}=await saved.json();
  assert.equal((await (await upload(bytes,"image/webp",key)).json()).id,id);
  const path="/api/packages/"+id+"/image";
  assert.equal((await request(path)).status,401);
  assert.equal((await request(path,undefined,other)).status,404);
  const photo=await request(path,undefined,client);
  assert.equal(photo.status,200);assert.equal(photo.headers.get("content-type"),"image/webp");
  assert.deepEqual(new Uint8Array(await photo.arrayBuffer()),bytes);
  assert.equal((await request("/api/packages",{...product,id,detail:"Foto conservada"},shop)).status,200);
  assert.equal((await request(path,undefined,client)).status,200);
  assert.equal((await request("/api/packages",{...product,id,active:false},shop)).status,200);
  assert.equal((await request(path,undefined,client)).status,404);
});
