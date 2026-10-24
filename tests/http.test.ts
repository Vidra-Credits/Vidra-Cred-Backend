import {test} from "node:test";
import assert from "node:assert/strict";
import {IDS} from "../scripts/demo";
const base=process.env.TEST_ORIGIN??"http://localhost:3000";
function requireDemoPassword(){const password=process.env.DEMO_PASSWORD;if(!password)throw new Error("Defina DEMO_PASSWORD en .env.");return password;}
async function request(path:string,body?:unknown,cookie?:string,origin=base){
  return fetch(base+path,{method:body?"POST":"GET",headers:{...(body?{"Content-Type":"application/json","Origin":origin}:{}),...(cookie?{Cookie:cookie}:{})},body:body?JSON.stringify(body):undefined});
}
test("HTTP: página, sesión local, permisos, validación del servidor y cierre de sesión",async()=>{
  const page=await request("/");assert.equal(page.status,200);assert.match(await page.text(),/VidraCred/);
  assert.equal((await request("/api/bootstrap")).status,401);
  assert.equal((await request("/api/auth/login",{email:"tienda@vidracred.local",password:"incorrecta"})).status,401);
  const login=await request("/api/auth/login",{email:"tienda@vidracred.local",password:requireDemoPassword()});assert.equal(login.status,200);
  const header=login.headers.get("set-cookie")!;assert.match(header,/HttpOnly/i);assert.match(header,/SameSite=strict/i);const cookie=header.split(";")[0];
  const data=await (await request("/api/bootstrap",undefined,cookie)).json();assert.equal(data.actor.role,"NEGOCIO");assert.equal(data.credits.length,4);
  const input={storeId:IDS.store,clientId:IDS.nutra,packageId:IDS.goteros,purchaseDate:"2026-07-08",months:1,grace:"SS"};
  const q=await request("/api/simulate",input,cookie);assert.equal(q.status,200);assert.equal((await q.json()).schedule.initialBalance,"2028.56");
  assert.equal((await request("/api/simulate",{...input,storeId:IDS.otherStore},cookie)).status,404);
  assert.equal((await request("/api/simulate",{...input,months:6,grace:"SSSSSSSSSSSS"},cookie)).status,422);
  assert.equal((await request("/api/simulate",input,cookie,"https://origen-no-autorizado.test")).status,403);
  assert.equal((await request("/api/stores",{},cookie)).status,403);
  assert.equal((await request("/api/auth/logout",{},cookie)).status,200);assert.equal((await request("/api/bootstrap",undefined,cookie)).status,401);
  const clientLogin=await request("/api/auth/login",{email:"cliente@vidracred.local",password:requireDemoPassword()});assert.equal(clientLogin.status,200);
  const clientCookie=clientLogin.headers.get("set-cookie")!.split(";")[0];
  const portal=await (await request("/api/bootstrap?storeId="+IDS.otherStore,undefined,clientCookie)).json();assert.equal(portal.clients.length,1);assert.ok(portal.credits.every((c:{clientId:string})=>c.clientId===IDS.carrillo));
  assert.equal((await request("/api/simulate",input,clientCookie)).status,403);
  await request("/api/auth/logout",{},clientCookie);
});
