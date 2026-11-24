import {readFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import {randomUUID} from "node:crypto";
import {pool,transaction,type DB} from "../src/lib/db";
import {hashPassword,GUEST_EMAIL,type Actor} from "../src/lib/security";
import {randomBytes} from "node:crypto";
import {insertCredit} from "../src/lib/service";
import {simulate,lateFee,sum} from "../src/lib/finance";
import {IDS} from "./demo";
export async function migrate(db:DB) {
  await db.query("SELECT pg_advisory_xact_lock(77152026)");
  const found=await db.query("SELECT to_regclass('schema_migrations') AS found");
  const applied=found.rows[0].found?(await db.query("SELECT version FROM schema_migrations")).rows.map(r=>r.version as number):[];
  for(const [version,file] of [[1,"001_schema.sql"],[2,"002_autoservicio.sql"],[3,"003_enunciado.sql"],[4,"004_invitado.sql"],[5,"005_revision_final.sql"],[6,"006_cotizaciones_imagenes.sql"]] as const)
    if(!applied.includes(version))await db.query(await readFile(fileURLToPath(new URL("../db/"+file,import.meta.url)),"utf8"));
}
export async function seed(db:DB) {
  if((await db.query("SELECT 1 FROM stores LIMIT 1")).rowCount)return;
  const password=process.env.DEMO_PASSWORD??"Vidra2026!",hash=hashPassword(password);
  await db.query("INSERT INTO stores(id,name,business,ruc,cut_day,pay_day) VALUES($1,'Vidra Envases Demo','Envases de vidrio y plástico','90000001001',25,5),($2,'Bodega Aurora Demo','Abarrotes y conservas','90000001002',20,26)",[IDS.store,IDS.otherStore]);
  const clients=[
    [IDS.nutra,IDS.store,"Laboratorio Horizonte Demo","90000002001","PEN","0.20","5000",5],
    [IDS.carrillo,IDS.store,"Jardín Botánico Demo","90000002002","PEN","0.25","5000",5],
    [IDS.brenma,IDS.store,"Cosmética Brisa Demo","90000002003","PEN","0.15","2500",3],
    [IDS.valdivia,IDS.store,"Comercial Sur Demo","90000002004","PEN","0.20","4000",5],
    [IDS.jemsa,IDS.store,"Taller Lago Demo","90000002005","PEN","0.20","3000",5],
    [IDS.usd,IDS.store,"Exportadora Delta Demo","90000002006","USD","0.20","5000",5],
    [IDS.otherClient,IDS.otherStore,"Mercado Solar Demo","90000002007","PEN","0.18","5000",5]
  ];
  for(const c of clients)await db.query("INSERT INTO clients(id,store_id,name,document,currency,tea,credit_limit,max_months) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",c);
  const users=[
    [IDS.admin,null,null,"sistema@vidracred.local","Administrador del sistema","SISTEMA"],
    [IDS.business,IDS.store,null,"tienda@vidracred.local","Administración Vidra Envases","NEGOCIO"],
    [IDS.otherBusiness,IDS.otherStore,null,"aurora@vidracred.local","Administrador Aurora","NEGOCIO"],
    [IDS.customer,IDS.store,IDS.carrillo,"cliente@vidracred.local","Jardín Botánico Demo","CLIENTE"]
  ];
  for(const u of users)await db.query("INSERT INTO users(id,store_id,client_id,email,name,role,password_hash) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING",[...u,hash]);
  const packages=[
    [IDS.goteros,IDS.store,"Goteros ámbar de 50 ml","Frascos de vidrio ámbar con pipeta y tapa roscada.","PEN","2000","1850","Caja","goteros"],
    [IDS.cosmetica,IDS.store,"Envases para cosmética","Tubos blancos de 60 ml con tapa y frascos con gotero.","PEN","4800","4500","Lote","cosmetica"],
    [IDS.frascos,IDS.store,"Frascos de vidrio de 20 ml","Frascos transparentes con tapa negra y sello de silicona.","PEN","1500","1390","Caja","frascos"],
    [IDS.antecedente,IDS.store,"Envases surtidos para reventa","Botellas, frascos y envases de plástico en un solo lote.","PEN","2300","2150","Lote","mayorista"],
    [IDS.usdPackage,IDS.store,"Envases para exportación","Botellas y frascos protegidos en una caja con separadores.","USD","1000","920","Caja","exportacion"],
    [IDS.otherPackage,IDS.otherStore,"Caja de conservas","Surtido de conservas para reventa.","PEN","1000","940","Caja",null]
  ] as const;
  for(const [id,store,name,detail,currency,amount,cash,unit,photo] of packages) {
    await db.query("INSERT INTO packages(id,store_id,name,detail,currency,amount,cash_price,unit,brand,image) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
      [id,store,name,detail,currency,amount,cash,unit,store===IDS.store?"Vidra Envases Demo":"Aurora Demo",photo?`/productos/${photo}.webp`:null]);
  }
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
  await db.query("INSERT INTO audit(user_id,store_id,action,details) VALUES($1,$2,'CARGAR_DEMOSTRACION',$3)",[IDS.business,IDS.store,JSON.stringify({source:"Casos de la entrega parcial",asOf:"2026-09-26",policy:"VC-2026.1",identities:"ficticias"})]);
}
export async function ensureSystem(db:DB) {
  if((await db.query("SELECT 1 FROM users WHERE role='SISTEMA' LIMIT 1")).rowCount)return;
  if(!process.env.DEMO_PASSWORD)throw new Error("Configure DEMO_PASSWORD para crear el primer acceso de Sistema.");
  await db.query("INSERT INTO users(id,email,name,password_hash,role) VALUES($1,'sistema@vidracred.local','Administrador del sistema',$2,'SISTEMA')",
    [IDS.admin,hashPassword(process.env.DEMO_PASSWORD)]);
}
/** Cuenta de solo lectura para visitantes. Su contraseña es aleatoria y nunca se muestra: solo entra por «Entrar como invitado». */
export async function ensureGuest(db:DB) {
  if(!(await db.query("SELECT 1 FROM stores WHERE id=$1",[IDS.store])).rowCount)return;
  await db.query("INSERT INTO users(id,store_id,email,name,password_hash,role,read_only) VALUES($1,$2,$3,'Invitado',$4,'NEGOCIO',true) ON CONFLICT(email) DO UPDATE SET read_only=true,role='NEGOCIO',store_id=EXCLUDED.store_id,active=true",[IDS.guest,IDS.store,GUEST_EMAIL,hashPassword(randomBytes(24).toString("hex"))]);
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]) {
  try {await transaction(async db=>{
    await migrate(db);
    if(process.env.SEED_DEMO==="0")await ensureSystem(db);
    else await seed(db);
    await ensureGuest(db);
  });console.log("Base de datos preparada.");}
  catch(e){console.error(e);process.exitCode=1;}finally{await pool.end();}
}
