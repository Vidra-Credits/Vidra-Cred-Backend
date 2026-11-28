import {test,before,after} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import pg from "pg";
import {IDS} from "../scripts/demo";
import {sum,statement,creditLine,lateFee,cutListing,teaFromNominal,today,RuleError} from "../src/lib/finance";
// Each execution uses a separate database. The demo database is never cleared.
const url=new URL(process.env.DATABASE_URL!),admin=new pg.Pool({connectionString:url.toString()});
const dbName="vidracred_test_"+randomUUID().replaceAll("-","");
await admin.query(`CREATE DATABASE ${dbName}`);
url.pathname="/"+dbName;process.env.DATABASE_URL=url.toString();
const {pool,transaction}=await import("../src/lib/db");
const {migrate,seed}=await import("../scripts/setup");
const {actorFromRow,hashPassword,verifyPassword}=await import("../src/lib/security");
const {registerClient,createRequest,cancelRequest,resolveRequest,previewRequest,publicStores}=await import("../src/lib/selfservice");
const {bootstrap,getQuote,loadCredits,registerCredit,registerPayment,saveEntity}=await import("../src/lib/service");
let business:ReturnType<typeof actorFromRow>,customer:ReturnType<typeof actorFromRow>,other:ReturnType<typeof actorFromRow>;
before(async()=>{await transaction(async db=>{await migrate(db);await seed(db);});
  const r=await pool.query("SELECT * FROM users");business=actorFromRow(r.rows.find(u=>u.id===IDS.business));customer=actorFromRow(r.rows.find(u=>u.id===IDS.customer));other=actorFromRow(r.rows.find(u=>u.id===IDS.otherBusiness));});
after(async()=>{await pool.end();await admin.query(`DROP DATABASE ${dbName}`);await admin.end();});
const input={storeId:IDS.store,clientId:IDS.jemsa,packageId:IDS.frascos,purchaseDate:"2026-07-08",months:1,grace:"S"};
const quoteInput=(actor:typeof customer,packageId=IDS.goteros,months=1,mode:"CUOTAS"|"UNICO"="CUOTAS")=>({
  storeId:actor.storeId!,clientId:actor.clientId!,packageId,purchaseDate:today(),months,mode,grace:"S".repeat(months)
});
const requestInput=(packageId=IDS.goteros,months=1,mode:"CUOTAS"|"UNICO"="CUOTAS")=>({
  packageId,months,mode,grace:"S".repeat(months),idempotencyKey:randomUUID(),previewFingerprint:"0".repeat(64)
});
async function quoted(actor:typeof customer,packageId=IDS.goteros,months=1,mode:"CUOTAS"|"UNICO"="CUOTAS") {
  const quote=await getQuote(pool,actor,quoteInput(actor,packageId,months,mode));
  return {...requestInput(packageId,months,mode),previewFingerprint:quote.fingerprint};
}
test("los datos semilla reproducen pagos y saldos del informe corregido",async()=>{
  const credits=await loadCredits(pool,IDS.store);assert.equal(credits.length,4);
  const expected=[[IDS.case1,"2056.07","0.00"],[IDS.case2,"4515.16","728.53"],[IDS.case3,"1164.82","385.69"]];
  for(const [id,paid,saldo] of expected){const s=statement(credits.find(c=>c.id===id)!,"2026-09-26");assert.equal(s.paid,paid);assert.equal(s.outstanding,saldo);}
  await transaction(async db=>{await migrate(db);await seed(db);});assert.equal((await loadCredits(pool,IDS.store)).length,4);
});
test("los hashes verifican contraseñas sin almacenar el texto",()=>{const h=hashPassword("Clave local válida");assert.notEqual(h,"Clave local válida");assert.equal(verifyPassword("Clave local válida",h),true);assert.equal(verifyPassword("incorrecta",h),false);});
test("permisos de tienda y consulta exclusiva del cliente",async()=>{
  await assert.rejects(()=>bootstrap(customer,IDS.otherStore),(e:unknown)=>e instanceof RuleError&&e.status===404);
  const portal=await bootstrap(customer);assert.equal(portal.clients.length,1);assert.ok(portal.credits.every(c=>c.clientId===IDS.carrillo));assert.ok(portal.packages.length>0&&portal.packages.every(p=>p.store_id===IDS.store&&p.active&&p.currency==="PEN"));assert.equal(portal.audit.length,0);
  const otherData=await bootstrap(other);assert.ok(otherData.clients.every(c=>c.store_id===IDS.otherStore));assert.equal(otherData.credits.length,0);
  await assert.rejects(()=>getQuote(pool,other,input),(e:unknown)=>e instanceof RuleError&&e.status===404);
  await assert.rejects(()=>getQuote(pool,customer,input),(e:unknown)=>e instanceof RuleError&&e.status===404);
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
  await assert.rejects(()=>registerCredit(business,{...input,idempotencyKey:randomUUID(),previewFingerprint:"0".repeat(64)}),/condiciones cambiaron/);
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
  await saveEntity(business,"packages",{id:IDS.frascos,storeId:IDS.store,name:"Frascos editados",detail:"Nuevo contenido",currency:"PEN",amount:"1800",cashPrice:"1900",active:true});
  const fresh=(await loadCredits(pool,IDS.store,IDS.jemsa))[0];assert.equal(JSON.stringify(fresh.schedule),original);assert.equal(fresh.packageName,"Frascos de vidrio de 20 ml");
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

const signup={storeId:IDS.store,name:"Ana Torres Quispe",document:"45678912",phone:"999111222",email:"Ana@Correo.test",password:"clave-segura-1",currency:"PEN" as const};
test("autoservicio: registro crea cuenta pendiente, sin acceso a crédito y con aislamiento por tienda",async()=>{
  assert.ok((await publicStores()).stores.length>=2);
  const ana=await registerClient(signup);assert.equal(ana.role,"CLIENTE");assert.equal(ana.email,"ana@correo.test");
  const row=(await pool.query("SELECT * FROM clients WHERE id=$1",[ana.clientId])).rows[0];
  assert.equal(row.approval,"PENDIENTE");assert.equal(row.credit_limit,"1000.00");assert.equal(Number(row.tea),0.25);
  await assert.rejects(()=>registerClient(signup),/correo/);
  await assert.rejects(()=>registerClient({...signup,email:"otra@correo.test"}),/documento/);
  await assert.rejects(()=>registerClient({...signup,email:"x@correo.test",password:"corta"}));
  await assert.rejects(()=>registerClient({...signup,email:"y@correo.test",document:"123"}));
  await assert.rejects(()=>registerClient({...signup,email:"z@correo.test",storeId:randomUUID()}),/tienda/);
  const data=await bootstrap(ana);assert.equal(data.clients.length,1);assert.equal(data.credits.length,0);assert.ok(data.packages.every(p=>p.active&&p.currency==="PEN"));
  const req=requestInput(IDS.frascos);
  await assert.rejects(()=>createRequest(ana,req),/pendiente de aprobación/);
  await assert.rejects(()=>createRequest(business,req),/permiso/);
});
test("autoservicio: el cliente aprobado solicita, la tienda aprueba y el crédito nace con las condiciones fijadas",async()=>{
  const ana=actorFromRow((await pool.query("SELECT * FROM users WHERE email='ana@correo.test'")).rows[0]);
  const id=ana.clientId!;
  await saveEntity(business,"clients",{id,storeId:IDS.store,name:"Ana Torres Quispe",document:"45678912",phone:"",address:"",currency:"PEN",tea:"0.18",creditLimit:"3000",maxMonths:3,active:true,approval:"APROBADO"});
  const quote=await getQuote(pool,ana,{storeId:IDS.store,clientId:id,packageId:IDS.frascos,purchaseDate:"2026-01-01",months:2,grace:"SS"});
  assert.equal(quote.schedule.rows.length,2);
  await assert.rejects(()=>getQuote(pool,ana,{storeId:IDS.store,clientId:IDS.nutra,packageId:IDS.frascos,purchaseDate:"2026-10-01",months:1,grace:"SS"}),(e:unknown)=>e instanceof RuleError&&e.status===404);
  await assert.rejects(()=>createRequest(ana,requestInput(IDS.frascos,5)),/plazo máximo/);
  await assert.rejects(()=>createRequest(ana,requestInput(IDS.usdPackage)),/moneda/);
  await assert.rejects(()=>createRequest(ana,requestInput(IDS.otherPackage)),/no disponible/);
  const req=await quoted(ana,IDS.frascos);
  const first=await createRequest(ana,req);assert.equal(first.replayed,false);assert.equal((await createRequest(ana,req)).replayed,true);
  await assert.rejects(()=>createRequest(ana,{...req,months:2,grace:"SSSS"}),/otra solicitud/);
  assert.equal((await bootstrap(ana)).requests.length,1);
  assert.equal((await bootstrap(other)).requests.length,0);
  await assert.rejects(()=>resolveRequest(other,{id:first.id,action:"aprobar"}),/no disponible/);
  await assert.rejects(()=>resolveRequest(ana,{id:first.id,action:"aprobar"}),/permiso/);
  await assert.rejects(()=>resolveRequest(business,{id:first.id,action:"rechazar"}),/motivo/);
  const done=await resolveRequest(business,{id:first.id,action:"aprobar"});assert.ok(done.creditId);
  await assert.rejects(()=>resolveRequest(business,{id:first.id,action:"aprobar"}),/ya fue atendida/);
  const credits=await loadCredits(pool,IDS.store,id);assert.equal(credits.length,1);assert.equal(credits[0].schedule.input.tea,"0.180000000000");
  assert.equal((await pool.query("SELECT status FROM purchase_requests WHERE id=$1",[first.id])).rows[0].status,"APROBADA");
  assert.ok((await bootstrap(ana)).credits.every(c=>c.clientId===id));
  // Cancelar y rechazar
  await saveEntity(business,"clients",{id,storeId:IDS.store,name:"Ana Torres Quispe",document:"45678912",phone:"",address:"",currency:"PEN",tea:"0.18",creditLimit:"6000",maxMonths:3,active:true});
  const second=await createRequest(ana,await quoted(ana));
  await cancelRequest(ana,{id:second.id});assert.equal((await cancelRequest(ana,{id:second.id})).replayed,true);
  await assert.rejects(()=>cancelRequest(customer,{id:second.id}),/no disponible/);
  const third=await createRequest(ana,await quoted(ana));
  await resolveRequest(business,{id:third.id,action:"rechazar",note:"Documentación incompleta"});
  assert.equal((await bootstrap(ana)).requests.find(r=>r.id===third.id)!.note,"Documentación incompleta");
});
test("autoservicio: la solicitud falla si la línea no alcanza y el límite de pendientes se respeta",async()=>{
  const ana=actorFromRow((await pool.query("SELECT * FROM users WHERE email='ana@correo.test'")).rows[0]);
  await saveEntity(business,"clients",{id:ana.clientId,storeId:IDS.store,name:"Ana Torres Quispe",document:"45678912",phone:"",address:"",currency:"PEN",tea:"0.18",creditLimit:"1000",maxMonths:3,active:true});
  await assert.rejects(()=>createRequest(ana,requestInput()),/excede la línea/);
  await saveEntity(business,"clients",{id:ana.clientId,storeId:IDS.store,name:"Ana Torres Quispe",document:"45678912",phone:"",address:"",currency:"PEN",tea:"0.18",creditLimit:"50000",maxMonths:3,active:true,approval:"RECHAZADO",approvalNote:"Revisión"});
  await assert.rejects(()=>createRequest(ana,requestInput()),/no aprobó/);
  await saveEntity(business,"clients",{id:ana.clientId,storeId:IDS.store,name:"Ana Torres Quispe",document:"45678912",phone:"",address:"",currency:"PEN",tea:"0.18",creditLimit:"50000",maxMonths:3,active:true,approval:"APROBADO"});
  for(let i=0;i<3;i++)await createRequest(ana,await quoted(ana));
  await assert.rejects(()=>createRequest(ana,requestInput()),/solicitudes en espera/);
});

const newClient=(over:Record<string,unknown>)=>({storeId:IDS.store,name:"Cliente de prueba",document:"20512345678",phone:"",address:"",currency:"PEN",tea:"0.20",creditLimit:"20000",maxMonths:5,active:true,...over});
test("tasa pactada nominal: el servidor recalcula la TEA, la persiste y rechaza una TEA que no corresponde",async()=>{
  const tea=teaFromNominal("0.18","MENSUAL").toFixed(12);
  await assert.rejects(()=>saveEntity(business,"clients",newClient({tea:"0.2",rateKind:"TNA",rateInput:"0.18",compounding:"MENSUAL"})),/no corresponde/);
  await assert.rejects(()=>saveEntity(business,"clients",newClient({tea,rateKind:"TNA"})),/capitalización/);
  const {id}=await saveEntity(business,"clients",newClient({tea,rateKind:"TNA",rateInput:"0.18",compounding:"MENSUAL"}));
  const row=(await bootstrap(business)).clients.find(c=>c.id===id)!;
  assert.equal(row.rate_kind,"TNA");assert.equal(Number(row.rate_input),0.18);assert.equal(row.compounding,"MENSUAL");assert.equal(Number(row.tea).toFixed(6),"0.195618");
  // Al volver a TEA la tasa nominal pactada deja de existir.
  await saveEntity(business,"clients",newClient({id,tea:"0.2"}));
  const back=(await bootstrap(business)).clients.find(c=>c.id===id)!;assert.equal(back.rate_kind,"TEA");assert.equal(back.rate_input,null);assert.equal(back.compounding,null);
});
test("corte y pago por cliente: usa los pactados, hereda los de la tienda si faltan y exige ambos",async()=>{
  await assert.rejects(()=>saveEntity(business,"clients",newClient({document:"20512345679",cutDay:10})),/corte y el de pago/);
  const mine=await saveEntity(business,"clients",newClient({document:"20512345680",name:"Corte Diez SAC",cutDay:10,payDay:20}));
  const hereda=await saveEntity(business,"clients",newClient({document:"20512345681",name:"Corte Tienda SAC"}));
  const base={storeId:IDS.store,packageId:IDS.frascos,purchaseDate:"2026-08-02",months:1,grace:"S"};
  const own=await getQuote(pool,business,{...base,clientId:mine.id});
  assert.equal(own.schedule.input.cutDay,10);assert.equal(own.schedule.input.payDay,20);assert.equal(own.schedule.cutDate,"2026-08-10");assert.equal(own.schedule.baseDate,"2026-08-20");
  const shop=await getQuote(pool,business,{...base,clientId:hereda.id});
  assert.equal(shop.schedule.input.cutDay,25);assert.equal(shop.schedule.input.payDay,5);assert.equal(shop.schedule.cutDate,"2026-08-25");
  await registerCredit(business,{...base,clientId:mine.id,idempotencyKey:randomUUID(),previewFingerprint:own.fingerprint});
  await registerCredit(business,{...base,clientId:hereda.id,idempotencyKey:randomUUID(),previewFingerprint:shop.fingerprint});
  const credits=await loadCredits(pool,IDS.store);
  const diez=cutListing(credits,"2026-09-10",10,"2026-10-31"),veinticinco=cutListing(credits,"2026-09-25",25,"2026-10-31");
  assert.ok(diez.rows.length>0&&diez.rows.every(r=>r.clientId===mine.id));
  assert.ok(veinticinco.rows.length>0&&veinticinco.rows.every(r=>r.clientId!==mine.id));
});
test("tasa por tramos en un crédito real: se recalcula, se guarda, es idempotente y el cliente no puede enviarla",async()=>{
  const {id:clientId}=await saveEntity(business,"clients",newClient({document:"20512345682",name:"Tramos SAC"}));
  const base={storeId:IDS.store,clientId,packageId:IDS.frascos,purchaseDate:"2026-07-08",months:3,grace:"SSS"};
  const plain=await getQuote(pool,business,base),steps=[{from:2,tea:"0.16"}];
  const q=await getQuote(pool,business,{...base,rateSteps:steps});
  assert.equal(q.schedule.rows.at(-1)!.closing,"0.00");assert.equal(q.schedule.rows[1].tea,"0.160000000000");assert.equal(q.schedule.rows[0].tea,"0.200000000000");
  assert.equal(q.schedule.rows[0].payment,plain.schedule.rows[0].payment);
  assert.ok(Number(q.schedule.totals.interest)<Number(plain.schedule.totals.interest));
  assert.notEqual(q.fingerprint,plain.fingerprint);
  await assert.rejects(()=>getQuote(pool,business,{...base,rateSteps:[{from:4,tea:"0.30"}]}),RuleError);
  await assert.rejects(()=>getQuote(pool,business,{...base,rateSteps:[{from:1,tea:"0.2"}]}),/cuota 2/);
  const key=randomUUID(),reg={...base,rateSteps:steps,idempotencyKey:key,previewFingerprint:q.fingerprint};
  const first=await registerCredit(business,reg);assert.equal(first.replayed,false);
  assert.equal((await registerCredit(business,reg)).replayed,true);
  await assert.rejects(()=>registerCredit(business,{...reg,rateSteps:[{from:5,tea:"0.16"}]}),/otra solicitud/);
  await assert.rejects(()=>registerCredit(business,{...reg,rateSteps:[]}),/otra solicitud/);
  const saved=(await pool.query("SELECT rate_steps,mode,months FROM credits WHERE id=$1",[first.id])).rows[0];
  assert.deepEqual(saved.rate_steps,steps);assert.equal(saved.mode,"CUOTAS");assert.equal(saved.months,3);
  const teas=(await pool.query("SELECT number,tea FROM installments WHERE credit_id=$1 ORDER BY number",[first.id])).rows.map(r=>Number(r.tea));
  assert.deepEqual(teas,[0.2,0.16,0.16]);
  const credit=(await loadCredits(pool,IDS.store,clientId))[0];
  assert.deepEqual(credit.schedule.input.rateSteps,steps);
  const r1=credit.schedule.rows[0];
  await registerPayment(business,{creditId:first.id,installmentNumber:1,paidDate:r1.dueDate,total:r1.payment,reference:"TRAMOS-1",idempotencyKey:randomUUID()});
  // La cotización del cliente en autoservicio nunca acepta tramos.
  const ana=actorFromRow((await pool.query("SELECT * FROM users WHERE email='ana@correo.test'")).rows[0]);
  await assert.rejects(()=>getQuote(pool,ana,{storeId:IDS.store,clientId:ana.clientId!,packageId:IDS.frascos,purchaseDate:"2026-10-01",months:3,grace:"SSSSSS",rateSteps:steps}),/define la tienda/);
});
test("producto completo y pago único: modalidad de venta, precio contado, interés por días y mora sobre la cuota única",async()=>{
  const pack={storeId:IDS.store,name:"Caja de vasos",detail:"Vasos de 10 oz",currency:"PEN",amount:"2000",active:true,brand:"Vidra Plastic",unit:"Caja"};
  await assert.rejects(()=>saveEntity(business,"packages",{...pack,cashPrice:"1900"}),/debe ser mayor/);
  await assert.rejects(()=>saveEntity(business,"packages",{...pack,cashPrice:"2000"}),/debe ser mayor/);
  await assert.rejects(()=>saveEntity(business,"packages",{...pack,cashPrice:"2160",unit:""}),/unidad/);
  const unico=await saveEntity(business,"packages",{...pack,cashPrice:"2160",saleMode:"UNICO"});
  const cuotas=await saveEntity(business,"packages",{...pack,name:"Caja en cuotas",cashPrice:"2160",saleMode:"CUOTAS"});
  const both=(await bootstrap(business)).packages;
  const u=both.find(p=>p.id===unico.id)!;assert.equal(u.brand,"Vidra Plastic");assert.equal(u.unit,"Caja");assert.equal(u.cash_price,"2160.00");assert.equal(u.sale_mode,"UNICO");
  assert.equal(both.find(p=>p.id===IDS.frascos)!.sale_mode,"AMBOS");assert.equal(both.find(p=>p.id===IDS.frascos)!.cash_price,"1900.00");
  const {id:clientId}=await saveEntity(business,"clients",newClient({document:"20512345683",name:"Pago Único SAC"}));
  const base={storeId:IDS.store,clientId,purchaseDate:"2026-07-08"};
  await assert.rejects(()=>getQuote(pool,business,{...base,packageId:unico.id,months:1,grace:"SS"}),/solo se vende a pago único/);
  await assert.rejects(()=>getQuote(pool,business,{...base,packageId:cuotas.id,months:0,grace:"",mode:"UNICO"}),/solo se vende en cuotas/);
  await assert.rejects(()=>getQuote(pool,business,{...base,packageId:unico.id,months:0,grace:"",mode:"UNICO",rateSteps:[{from:2,tea:"0.2"}]}),RuleError);
  const q=await getQuote(pool,business,{...base,packageId:unico.id,months:0,grace:"",mode:"UNICO"});
  assert.equal(q.schedule.rows.length,1);assert.equal(q.schedule.rows[0].dueDate,"2026-08-05");assert.equal(q.schedule.rows[0].interest,"28.56");assert.equal(q.schedule.rows[0].payment,"2028.56");
  const reg={...base,packageId:unico.id,months:0,grace:"",mode:"UNICO" as const,idempotencyKey:randomUUID(),previewFingerprint:q.fingerprint};
  const {id}=await registerCredit(business,reg);assert.equal((await registerCredit(business,reg)).replayed,true);
  await assert.rejects(()=>registerCredit(business,{...reg,mode:"CUOTAS" as const,months:1,grace:"SS"}),/otra solicitud|solo se vende a pago único/);
  const row=(await pool.query("SELECT mode,months,initial_balance,initial_interest FROM credits WHERE id=$1",[id])).rows[0];
  assert.equal(row.mode,"UNICO");assert.equal(row.months,0);assert.equal(row.initial_balance,"2000.00");assert.equal(row.initial_interest,"0.00");
  assert.equal((await pool.query("SELECT count(*)::int n FROM installments WHERE credit_id=$1",[id])).rows[0].n,1);
  const fee=lateFee("2028.56","2026-08-05","2026-08-15");assert.ok(Number(fee.amount)>0);
  const total=sum(["2028.56",fee.amount]);
  await assert.rejects(()=>registerPayment(business,{creditId:id,installmentNumber:1,paidDate:"2026-08-15",total:"2028.56",reference:"UNICO-0",idempotencyKey:randomUUID()}),/pago completo/);
  await registerPayment(business,{creditId:id,installmentNumber:1,paidDate:"2026-08-15",total,reference:"UNICO-1",idempotencyKey:randomUUID()});
  const credit=(await loadCredits(pool,IDS.store,clientId)).find(c=>c.id===id)!;
  assert.equal(statement(credit,"2026-08-15").outstanding,"0.00");assert.equal(credit.payments[0].lateFee,fee.amount);assert.equal(credit.payments[0].total,total);
});
test("autoservicio con pago único: la solicitud respeta la modalidad y el crédito aprobado nace a pago único",async()=>{
  const ana=actorFromRow((await pool.query("SELECT * FROM users WHERE email='ana@correo.test'")).rows[0]);
  for(const r of (await bootstrap(ana)).requests.filter(r=>r.status==="PENDIENTE"))await cancelRequest(ana,{id:r.id});
  const unico=(await bootstrap(business)).packages.find(p=>p.sale_mode==="UNICO")!;
  await assert.rejects(()=>createRequest(ana,requestInput(unico.id)),/solo se vende a pago único/);
  const req=await quoted(ana,unico.id,0,"UNICO");
  const r=await createRequest(ana,req);assert.equal((await createRequest(ana,req)).replayed,true);
  await assert.rejects(()=>createRequest(ana,{...req,mode:"CUOTAS" as const}),/otra solicitud/);
  assert.equal((await bootstrap(ana)).requests.find(x=>x.id===r.id)!.mode,"UNICO");
  const done=await resolveRequest(business,{id:r.id,action:"aprobar"});
  const credit=(await loadCredits(pool,IDS.store,ana.clientId!)).find(c=>c.id===done.creditId)!;
  assert.equal(credit.schedule.input.mode,"UNICO");assert.equal(credit.schedule.rows.length,1);
});


test("enunciado mensual: contrato persistido, cuota total y mora nominal pactada, sin alterar históricos",async()=>{
  const mora=teaFromNominal("0.12","MENSUAL").toFixed(12);
  await assert.rejects(()=>saveEntity(business,"clients",newClient({document:"20512345901",moraTea:"0.35",moraKind:"TNA",moraInput:"0.12",moraCompounding:"MENSUAL"})),/no corresponde/);
  const person=await saveEntity(business,"clients",newClient({document:"20512345901",name:"Cliente mensual",cutDay:20,payDay:26,moraTea:mora,moraKind:"TNA",moraInput:"0.12",moraCompounding:"MENSUAL"}));
  const input={storeId:IDS.store,clientId:person.id,packageId:IDS.goteros,purchaseDate:"2026-06-15",months:3,grace:"SSS",frequency:"MENSUAL" as const};
  const q=await getQuote(pool,business,input);
  assert.deepEqual(q.schedule.rows.map(r=>r.dueDate),["2026-07-26","2026-08-26","2026-09-26"]);
  assert.equal(q.schedule.input.mora,Number(mora).toString());
  const key=randomUUID(),saved=await registerCredit(business,{...input,idempotencyKey:key,previewFingerprint:q.fingerprint});
  assert.equal((await registerCredit(business,{...input,idempotencyKey:key,previewFingerprint:q.fingerprint})).replayed,true);
  await assert.rejects(()=>registerCredit(business,{...input,frequency:"QUINCENAL",grace:"SSSSSS",idempotencyKey:key,previewFingerprint:q.fingerprint}),/clave ya/);
  const row=q.schedule.rows[0],fee=lateFee(row.payment,row.dueDate,"2026-08-05",mora);
  await registerPayment(business,{creditId:saved.id,installmentNumber:1,paidDate:"2026-08-05",total:sum([row.payment,fee.amount]),reference:"Mensual pactado",idempotencyKey:randomUUID()});
  await saveEntity(business,"clients",newClient({id:person.id,document:"20512345901",moraTea:"0.35",moraKind:"TEA"}));
  const real=(await loadCredits(pool,IDS.store,person.id))[0];
  assert.equal(real.schedule.input.frequency,"MENSUAL");assert.equal(real.payments[0].lateFee,fee.amount);
  const statementRow=statement(real,"2026-08-05").rows[0];assert.equal(statementRow.totalPaid,sum([statementRow.payment,statementRow.lateFee]));
  assert.equal(real.schedule.rows.at(-1)!.closing,"0.00");
  assert.equal((await loadCredits(pool,IDS.store,IDS.nutra)).find(c=>c.id===IDS.case1)!.schedule.rows.length,2);
});

test("solicitud mensual conserva su frecuencia hasta la aprobación",async()=>{
  const actor=await registerClient({storeId:IDS.store,name:"Cliente mensual web",document:"49567801",email:"mensual@correo.test",password:"clave-segura-1",currency:"PEN"});
  await saveEntity(business,"clients",newClient({id:actor.clientId,document:"49567801",name:"Cliente mensual web",approval:"APROBADO"}));
  const req=await createRequest(actor,await quoted(actor,IDS.goteros,3));
  await resolveRequest(business,{id:req.id,action:"aprobar"});
  const credit=(await loadCredits(pool,IDS.store,actor.clientId!))[0];
  assert.equal(credit.schedule.input.frequency,"MENSUAL");assert.equal(credit.schedule.rows.length,3);
});

test("cotización: huella obligatoria, rechazo de cambios y reintentos de la misma aprobación",async()=>{
  const customerInput=()=>quoted(customer,IDS.goteros,2);
  const product={id:IDS.goteros,storeId:IDS.store,name:"Goteros ámbar de 50 ml",detail:"Producto de prueba",
    currency:"PEN",amount:"2100",cashPrice:"2300",active:true};
  const before=await customerInput();
  await saveEntity(business,"packages",product);
  await assert.rejects(()=>createRequest(customer,before),/Vuelva a cotizar/);
  const payload=await customerInput();
  const [request,retry]=await Promise.all([createRequest(customer,payload),createRequest(customer,payload)]);
  assert.equal(request.id,retry.id);
  const storeBefore=(await bootstrap(business)).requests.find(r=>r.id===request.id)!;
  await saveEntity(business,"packages",{...product,amount:"2200"});
  await assert.rejects(()=>resolveRequest(business,{id:request.id,action:"aprobar"}),/Cambió el precio/);
  const pending=(await bootstrap(customer)).requests.find(r=>r.id===request.id)!;
  assert.equal(pending.status,"PENDIENTE");assert.equal(pending.amount,"2100.00");
  assert.match(pending.review_issue,/cancelar y volver a cotizar/);
  assert.deepEqual(pending.quote_snapshot,storeBefore.quote_snapshot);
  await cancelRequest(customer,{id:request.id});
  const newRequest=await createRequest(customer,await customerInput());
  const approval={id:newRequest.id,action:"aprobar",idempotencyKey:randomUUID()};
  const done=await resolveRequest(business,approval);
  assert.equal((await resolveRequest(business,approval)).creditId,done.creditId);
  assert.ok((await bootstrap(customer)).credits.some(c=>c.id===done.creditId&&c.schedule.input.amount==="2200.00"));
});

test("solicitud anterior a la migración exige una vista previa y respeta su frecuencia",async()=>{
  const id=randomUUID();
  await pool.query(`INSERT INTO purchase_requests(id,store_id,client_id,package_id,purchase_date,months,grace,mode,frequency,idempotency_key)
    VALUES($1,$2,$3,$4,$5,1,'SS','CUOTAS','QUINCENAL',$6)`,
    [id,IDS.store,IDS.carrillo,IDS.frascos,today(),randomUUID()]);
  await assert.rejects(()=>resolveRequest(business,{id,action:"aprobar"}),/vista previa vigente/);
  const q=await previewRequest(business,id);
  assert.equal(q.schedule.input.frequency,"QUINCENAL");
  const done=await resolveRequest(business,{id,action:"aprobar",previewFingerprint:q.fingerprint});
  assert.ok((await loadCredits(pool,IDS.store,IDS.carrillo)).some(c=>c.id===done.creditId&&c.schedule.rows.length===2));
});
