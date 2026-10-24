import {readFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import {randomUUID} from "node:crypto";
import {pool,transaction,type DB} from "../src/lib/db";
import {hashPassword,type Actor} from "../src/lib/security";
import {insertCredit} from "../src/lib/service";
import {simulate,lateFee,sum} from "../src/lib/finance";
import {IDS} from "./demo";
export async function migrate(db:DB) {
  await db.query("SELECT pg_advisory_xact_lock(77152026)");
  const found=await db.query("SELECT to_regclass('schema_migrations') AS found");
  if(!found.rows[0].found)await db.query(await readFile(fileURLToPath(new URL("../db/001_schema.sql",import.meta.url)),"utf8"));
}
export async function seed(db:DB) {
  if((await db.query("SELECT 1 FROM stores LIMIT 1")).rowCount)return;
  const password=process.env.DEMO_PASSWORD;if(!password)throw new Error("Defina DEMO_PASSWORD en .env.");const hash=hashPassword(password);
  await db.query("INSERT INTO stores(id,name,business,ruc,cut_day,pay_day) VALUES($1,'Vidra Plastic S.A.C.S.','Envases de vidrio y plástico','20613867938',25,5),($2,'Bodega Aurora','Tienda de prueba para aislamiento de datos','20609999002',25,5)",[IDS.store,IDS.otherStore]);
  const clients=[
    [IDS.nutra,IDS.store,"Corporación Nutra Laboratorios Perú S.A.C.","20612420859","PEN","0.20","5000",5],
    [IDS.carrillo,IDS.store,"Carrillo Guerra Dilver Alexander","76700834","PEN","0.25","5000",5],
    [IDS.brenma,IDS.store,"Brenma y Asociados S.R.L.","20603895879","PEN","0.15","2500",3],
    [IDS.valdivia,IDS.store,"Valdivia Urribarri Luis Leandro","10442653761","PEN","0.20","4000",5],
    [IDS.jemsa,IDS.store,"Jemsa Perú","20600121171","PEN","0.20","3000",5],
    [IDS.usd,IDS.store,"Cliente en dólares (prueba)","90000001","USD","0.20","5000",5],
    [IDS.otherClient,IDS.otherStore,"Cliente de Bodega Aurora","90000002","PEN","0.18","5000",5]
  ];
  for(const c of clients)await db.query("INSERT INTO clients(id,store_id,name,document,currency,tea,credit_limit,max_months) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",c);
  const users=[
    [IDS.admin,null,null,"sistema@vidracred.local","Administrador del sistema","SISTEMA"],
    [IDS.business,IDS.store,null,"tienda@vidracred.local","Luis · Vidra Plastic","NEGOCIO"],
    [IDS.otherBusiness,IDS.otherStore,null,"aurora@vidracred.local","Administrador Aurora","NEGOCIO"],
    [IDS.customer,IDS.store,IDS.carrillo,"cliente@vidracred.local","Dilver Carrillo","CLIENTE"]
  ];
  for(const u of users)await db.query("INSERT INTO users(id,store_id,client_id,email,name,role,password_hash) VALUES($1,$2,$3,$4,$5,$6,$7)",[...u,hash]);
  const packages=[
    [IDS.goteros,IDS.store,"Paquete Goteros 50 ml","Frascos gotero de vidrio ámbar de 50 ml con tapa y chupón","PEN","2000"],
    [IDS.cosmetica,IDS.store,"Paquete Cosmética","Tubos colapsibles blancos de 60 ml con tapa y frascos gotero de vidrio ámbar","PEN","4800"],
    [IDS.frascos,IDS.store,"Paquete Frascos","Frascos de vidrio transparente de 20 ml con tapa baquelita N24 y laina de silicona","PEN","1500"],
    [IDS.antecedente,IDS.store,"Paquete Mayorista","Envases surtidos de vidrio y plástico para reventa","PEN","2300"],
    [IDS.usdPackage,IDS.store,"Paquete Exportación","Envases para exportación, precio en dólares","USD","1000"],
    [IDS.otherPackage,IDS.otherStore,"Paquete Abarrotes","Productos de bodega para demostrar el aislamiento entre tiendas","PEN","1000"]
  ];
  for(const p of packages)await db.query("INSERT INTO packages(id,store_id,name,detail,currency,amount) VALUES($1,$2,$3,$4,$5,$6)",p);
  const actor:Actor={id:IDS.business,storeId:IDS.store,clientId:null,role:"NEGOCIO",name:"Demo",email:"tienda@vidracred.local"};
  const cases=[
    {id:IDS.case1,clientId:IDS.nutra,packageId:IDS.goteros,amount:"2000",tea:"0.20",date:"2026-07-08",months:1,grace:"SS",payments:["2026-08-20","2026-09-10"]},
    {id:IDS.case2,clientId:IDS.carrillo,packageId:IDS.cosmetica,amount:"4800",tea:"0.25",date:"2026-03-28",months:5,grace:"TPPSSSSSSS",payments:[null,"2026-06-05","2026-06-20","2026-07-05","2026-07-25","2026-08-05","2026-09-01","2026-09-05","2026-09-20",null]},
    {id:IDS.case3,clientId:IDS.brenma,packageId:IDS.frascos,amount:"1500",tea:"0.15",date:"2026-06-15",months:3,grace:"TTSSSS",payments:[null,null,"2026-08-20","2026-09-08","2026-09-20",null]},
    {id:IDS.case4,clientId:IDS.valdivia,packageId:IDS.antecedente,amount:"2300",tea:"0.20",date:"2026-09-26",months:3,grace:"SSSSSS",payments:[]}
  ];
  for(const c of cases) {
    const schedule=simulate({amount:c.amount,currency:"PEN",tea:c.tea,purchaseDate:c.date,months:c.months,cutDay:25,payDay:5,grace:c.grace});
    const pkg=packages.find(p=>p[0]===c.packageId)!;
    await insertCredit(db,actor,{storeId:IDS.store,clientId:c.clientId,packageId:c.packageId,purchaseDate:c.date,months:c.months,grace:c.grace},schedule,pkg[2],randomUUID(),c.id);
    for(let k=0;k<c.payments.length;k++) {
      const paid=c.payments[k];if(!paid)continue;const row=schedule.rows[k],fee=lateFee(row.payment,row.dueDate,paid);
      const inst=await db.query("SELECT id FROM installments WHERE credit_id=$1 AND number=$2",[c.id,k+1]);
      await db.query("INSERT INTO payments(id,installment_id,user_id,paid_date,late_days,late_fee,interest,principal,total,reference,idempotency_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",[randomUUID(),inst.rows[0].id,IDS.business,paid,fee.days,fee.amount,row.interest,row.principal,sum([row.payment,fee.amount]),"Demostración del informe",randomUUID()]);
    }
  }
  await db.query("INSERT INTO audit(user_id,store_id,action,details) VALUES($1,$2,'CARGAR_DEMOSTRACION',$3)",[IDS.business,IDS.store,JSON.stringify({source:"Entrega_TP",asOf:"2026-09-26",policy:"VC-2026.1",synthetic:"RUC de tiendas, usuarios, datos USD, Bodega Aurora y antecedente del caso 4"})]);
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]) {
  try {await transaction(async db=>{await migrate(db);await seed(db);});console.log("Base de datos preparada. La demostración se carga solo en una base vacía.");}
  catch(e){console.error(e);process.exitCode=1;}finally{await pool.end();}
}
