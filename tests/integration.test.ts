import {test,before,after} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import pg from "pg";
import {IDS} from "../scripts/demo";
import {sum,statement,creditLine,lateFee,RuleError} from "../src/lib/finance";
// Each execution uses a separate database. The demo database is never cleared.
const url=new URL(process.env.DATABASE_URL!),admin=new pg.Pool({connectionString:url.toString()});
const dbName="vidracred_test_"+randomUUID().replaceAll("-","");
await admin.query(`CREATE DATABASE ${dbName}`);
url.pathname="/"+dbName;process.env.DATABASE_URL=url.toString();
const {pool,transaction}=await import("../src/lib/db");
const {migrate,seed}=await import("../scripts/setup");
const {actorFromRow,hashPassword,verifyPassword}=await import("../src/lib/security");
const {bootstrap,getQuote,loadCredits,registerCredit,registerPayment,saveEntity}=await import("../src/lib/service");
let business:ReturnType<typeof actorFromRow>,customer:ReturnType<typeof actorFromRow>,other:ReturnType<typeof actorFromRow>;
before(async()=>{await transaction(async db=>{await migrate(db);await seed(db);});
  const r=await pool.query("SELECT * FROM users");business=actorFromRow(r.rows.find(u=>u.id===IDS.business));customer=actorFromRow(r.rows.find(u=>u.id===IDS.customer));other=actorFromRow(r.rows.find(u=>u.id===IDS.otherBusiness));});
after(async()=>{await pool.end();await admin.query(`DROP DATABASE ${dbName}`);await admin.end();});
const input={storeId:IDS.store,clientId:IDS.jemsa,packageId:IDS.frascos,purchaseDate:"2026-07-08",months:1,grace:"SS"};
test("los datos semilla reproducen pagos y saldos del informe corregido",async()=>{
  const credits=await loadCredits(pool,IDS.store);assert.equal(credits.length,4);
  const expected=[[IDS.case1,"2056.07","0.00"],[IDS.case2,"4515.16","728.53"],[IDS.case3,"1164.82","385.69"]];
  for(const [id,paid,saldo] of expected){const s=statement(credits.find(c=>c.id===id)!,"2026-09-26");assert.equal(s.paid,paid);assert.equal(s.outstanding,saldo);}
  await transaction(async db=>{await migrate(db);await seed(db);});assert.equal((await loadCredits(pool,IDS.store)).length,4);
});
test("los hashes verifican contraseñas sin almacenar el texto",()=>{const h=hashPassword("Clave local válida");assert.notEqual(h,"Clave local válida");assert.equal(verifyPassword("Clave local válida",h),true);assert.equal(verifyPassword("incorrecta",h),false);});
test("permisos de tienda y consulta exclusiva del cliente",async()=>{
  const portal=await bootstrap(customer,IDS.otherStore);assert.equal(portal.clients.length,1);assert.ok(portal.credits.every(c=>c.clientId===IDS.carrillo));assert.equal(portal.packages.length,0);assert.equal(portal.audit.length,0);
  const otherData=await bootstrap(other);assert.ok(otherData.clients.every(c=>c.store_id===IDS.otherStore));assert.equal(otherData.credits.length,0);
  await assert.rejects(()=>getQuote(pool,other,input),(e:unknown)=>e instanceof RuleError&&e.status===404);
  await assert.rejects(()=>getQuote(pool,customer,input),(e:unknown)=>e instanceof RuleError&&e.status===403);
  await assert.rejects(()=>registerPayment(customer,{creditId:IDS.case2,installmentNumber:10,paidDate:"2026-10-05",total:"735.34",reference:"No permitido",idempotencyKey:randomUUID()}));
});
test("caso 4: la línea disponible es 1700 y rechaza un paquete de 2000",async()=>{
  const credits=await loadCredits(pool,IDS.store,IDS.valdivia);assert.equal(creditLine("4000",credits,"2026-09-26").available,"1700.00");
  await assert.rejects(()=>getQuote(pool,business,{...input,clientId:IDS.valdivia,packageId:IDS.goteros,purchaseDate:"2026-09-26"}),/excede la línea/);
});
test("el servidor verifica plazo del cliente y coincidencia de monedas",async()=>{
  await assert.rejects(()=>getQuote(pool,business,{...input,clientId:IDS.brenma,months:5,grace:"SSSSSSSSSS"}),/plazo máximo/);
  await assert.rejects(()=>getQuote(pool,business,{...input,packageId:IDS.usdPackage}),/moneda/);
});
test("vista previa obligatoria, registro idempotente y dos compras simultáneas por la misma línea",async()=>{
  const q=await getQuote(pool,business,input);
  await assert.rejects(()=>registerCredit(business,{...input,idempotencyKey:randomUUID(),previewFingerprint:"obsoleto"}),/condiciones cambiaron/);
  const one={...input,idempotencyKey:randomUUID(),previewFingerprint:q.fingerprint},two={...one,idempotencyKey:randomUUID()};
  const results=await Promise.allSettled([registerCredit(business,one),registerCredit(business,two)]);
  assert.equal(results.filter(r=>r.status==="fulfilled").length,1);assert.equal(results.filter(r=>r.status==="rejected").length,1);
  const winner=results[0].status==="fulfilled"?one:two;
  const again=await registerCredit(business,winner);assert.equal(again.replayed,true);
  const credits=await loadCredits(pool,IDS.store,IDS.jemsa);assert.equal(credits.length,1);
  assert.ok(Number(creditLine("3000",credits,"2026-09-26").available)<1500);
});
test("un cambio posterior del cliente, tienda o paquete no modifica el crédito pactado",async()=>{
  const c=(await loadCredits(pool,IDS.store,IDS.jemsa))[0],original=JSON.stringify(c.schedule);
  await saveEntity(business,"clients",{id:IDS.jemsa,storeId:IDS.store,name:"Jemsa Perú",document:"20600121171",phone:"",address:"",currency:"PEN",tea:"0.25",creditLimit:"3000",maxMonths:2,active:true});
  await saveEntity(business,"packages",{id:IDS.frascos,storeId:IDS.store,name:"Frascos editados",detail:"Nuevo contenido",currency:"PEN",amount:"1800",active:true});
  const fresh=(await loadCredits(pool,IDS.store,IDS.jemsa))[0];assert.equal(JSON.stringify(fresh.schedule),original);assert.equal(fresh.packageName,"Paquete Frascos");
});
test("pagos: rechaza gracia, duplicados, pago incompleto y fechas inválidas; libera línea solo al cobrar",async()=>{
  const credits=await loadCredits(pool,IDS.store),c=credits.find(c=>c.id===IDS.case2)!,r=c.schedule.rows[9];
  const p={creditId:c.id,installmentNumber:10,paidDate:"2026-10-10",total:sum([r.payment,lateFee(r.payment,r.dueDate,"2026-10-10").amount]),reference:"TEST-001",idempotencyKey:randomUUID()};
  await assert.rejects(()=>registerPayment(business,{...p,total:"1.00"}),/pago completo/);
  await assert.rejects(()=>registerPayment(business,{...p,installmentNumber:1}),/gracia total/);
  await assert.rejects(()=>registerPayment(business,{...p,paidDate:"2026-10-01"}),/desde el vencimiento/);
  await assert.rejects(()=>registerPayment(business,{...p,paidDate:"2099-01-01"}),/posterior a hoy/);
  await assert.rejects(()=>registerPayment(other,p),/no disponible/);
  const result=await registerPayment(business,p);assert.ok(result.id);assert.equal((await registerPayment(business,p)).replayed,true);
  await assert.rejects(()=>registerPayment(business,{...p,idempotencyKey:randomUUID()}),/ya fue pagada/);
  const fresh=(await loadCredits(pool,IDS.store)).find(c=>c.id===IDS.case2)!;
  assert.equal(statement(fresh,"2026-10-09").outstanding,"728.53");assert.equal(statement(fresh,"2026-10-10").outstanding,"0.00");
  assert.equal(creditLine("5000",[fresh],"2026-10-10").available,"5000.00");
  assert.ok((await pool.query("SELECT 1 FROM audit WHERE action='REGISTRAR_PAGO'")).rowCount);
});
test("USD funciona sin mezclar importes y el pago puntual no genera mora",async()=>{
  const inputUsd={...input,clientId:IDS.usd,packageId:IDS.usdPackage};const q=await getQuote(pool,business,inputUsd);
  const {id}=await registerCredit(business,{...inputUsd,previewFingerprint:q.fingerprint,idempotencyKey:randomUUID()});
  const r=q.schedule.rows[0];await registerPayment(business,{creditId:id,installmentNumber:1,paidDate:r.dueDate,total:r.payment,reference:"USD-001",idempotencyKey:randomUUID()});
  const c=(await loadCredits(pool,IDS.store,IDS.usd))[0];assert.equal(c.currency,"USD");assert.equal(c.payments[0].lateFee,"0.00");
});
