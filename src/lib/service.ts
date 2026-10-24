import {randomUUID} from "node:crypto";
import {z} from "zod";
import {pool,transaction,type DB} from "./db";
import {D,money,simulate,statement,creditLine,lateFee,today,dateOnly,RuleError,type Credit,type Payment,type Schedule} from "./finance";
import {legalReference} from "./legal";
import {type Actor,requireRole,requireStore,audit,hashPassword} from "./security";

const uuid=z.string().uuid();
export const quoteSchema=z.object({storeId:uuid,clientId:uuid,packageId:uuid,purchaseDate:z.string(),months:z.number().int(),grace:z.string().max(10)}).strict();
export const registrationSchema=quoteSchema.extend({idempotencyKey:uuid,previewFingerprint:z.string().min(1)});
export const paySchema=z.object({creditId:uuid,installmentNumber:z.number().int().min(1).max(10),paidDate:z.string(),total:z.string().regex(/^\d+\.\d{2}$/),reference:z.string().trim().min(1).max(120),idempotencyKey:uuid}).strict();
type QuoteInput=z.infer<typeof quoteSchema>;
export async function loadCredits(db:DB,storeId:string,clientId?:string):Promise<Credit[]> {
  const {rows}=await db.query("SELECT c.*,cl.name client_name FROM credits c JOIN clients cl ON cl.id=c.client_id WHERE c.store_id=$1 AND ($2::uuid IS NULL OR c.client_id=$2) ORDER BY c.purchase_date DESC,c.id",[storeId,clientId??null]);
  if(!rows.length)return [];
  const paid=await db.query("SELECT p.*,i.credit_id,i.number FROM payments p JOIN installments i ON i.id=p.installment_id WHERE i.credit_id=ANY($1::uuid[])",[rows.map(r=>r.id)]);
  return rows.map(r=>({id:r.id,clientId:r.client_id,storeId:r.store_id,clientName:r.client_name,packageName:r.snapshot.packageName,currency:r.currency,schedule:r.snapshot.schedule,createdAt:r.created_at.toISOString(),payments:paid.rows.filter(p=>p.credit_id===r.id).map(p=>({id:p.id,installmentNumber:p.number,paidDate:p.paid_date,lateFee:p.late_fee,interest:p.interest,principal:p.principal,total:p.total,reference:p.reference}))}));
}
export async function getQuote(db:DB,actor:Actor,input:QuoteInput) {
  requireRole(actor,["NEGOCIO","SISTEMA"]);requireStore(actor,input.storeId);
  dateOnly(input.purchaseDate);if(input.purchaseDate>today())throw new RuleError("La compra no puede ser posterior a hoy.","purchaseDate");
  const client=await db.query("SELECT * FROM clients WHERE id=$1 AND store_id=$2 AND active",[input.clientId,input.storeId]);
  const pack=await db.query("SELECT * FROM packages WHERE id=$1 AND store_id=$2 AND active",[input.packageId,input.storeId]);
  const store=await db.query("SELECT * FROM stores WHERE id=$1 AND active",[input.storeId]);
  const c=client.rows[0],p=pack.rows[0],t=store.rows[0];
  if(!c||!p||!t)throw new RuleError("Cliente, paquete o tienda no disponible.","general",404);
  if(c.currency!==p.currency)throw new RuleError("La moneda del cliente y del paquete debe coincidir.","packageId");
  if(input.months>c.max_months)throw new RuleError(`El plazo máximo del cliente es ${c.max_months} meses.`,"months");
  const schedule=simulate({amount:p.amount,currency:p.currency,tea:c.tea,purchaseDate:input.purchaseDate,months:input.months,cutDay:t.cut_day,payDay:t.pay_day,grace:input.grace});
  const credits=await loadCredits(db,input.storeId,c.id);
  const line=creditLine(c.credit_limit,credits,input.purchaseDate),lineNow=creditLine(c.credit_limit,credits,today());
  // A backdated purchase must fit both its original date and the financial balance at booking.
  const proposed:Credit={id:"preview",clientId:c.id,storeId:t.id,clientName:c.name,packageName:p.name,currency:p.currency,schedule,payments:[]};
  if(new D(p.amount).gt(line.available)||new D(statement(proposed,today()).outstanding).gt(lineNow.available))throw new RuleError(`La compra excede la línea disponible (${c.currency==="PEN"?"S/":"US$"} ${new Intl.NumberFormat("es-PE",{minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(D.min(line.available,lineNow.available).toFixed(2)))}).`,"packageId");
  const fingerprint=JSON.stringify({schedule,clientId:c.id,packageId:p.id,packageName:p.name,limit:c.credit_limit,maxMonths:c.max_months});
  return {schedule,line,lineNow,clientName:c.name,packageName:p.name,fingerprint,legal:legalReference(input.purchaseDate,p.currency)};
}
export async function insertCredit(db:DB,actor:Actor,input:QuoteInput,schedule:Schedule,packageName:string,idempotencyKey:string,id:string=randomUUID()) {
  await db.query("INSERT INTO credits(id,store_id,client_id,package_id,user_id,purchase_date,amount,currency,tea,mora,months,initial_balance,initial_interest,cut_date,base_date,snapshot,legal_reference,idempotency_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)",
    [id,input.storeId,input.clientId,input.packageId,actor.id,input.purchaseDate,schedule.input.amount,schedule.input.currency,schedule.input.tea,schedule.input.mora,input.months,schedule.initialBalance,schedule.initialInterest,schedule.cutDate,schedule.baseDate,JSON.stringify({schedule,packageName}),JSON.stringify(legalReference(input.purchaseDate,schedule.input.currency)),idempotencyKey]);
  for(const r of schedule.rows) await db.query("INSERT INTO installments(id,credit_id,number,due_date,grace,opening,interest,payment,principal,closing,capitalized) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",[randomUUID(),id,r.number,r.dueDate,r.grace,r.opening,r.interest,r.payment,r.principal,r.closing,r.capitalized]);
  await audit(db,actor,"REGISTRAR_CREDITO",id,{amount:schedule.input.amount,currency:schedule.input.currency},input.storeId);
  return id;
}
export async function registerCredit(actor:Actor,raw:unknown) {
  const input=registrationSchema.parse(raw);
  return transaction(async db=>{
    requireRole(actor,["NEGOCIO","SISTEMA"]);requireStore(actor,input.storeId);
    await db.query("SELECT id FROM clients WHERE id=$1 AND store_id=$2 FOR UPDATE",[input.clientId,input.storeId]);
    const existing=await db.query("SELECT id,store_id,client_id,package_id,purchase_date,months,snapshot FROM credits WHERE idempotency_key=$1",[input.idempotencyKey]);
    if(existing.rows[0]) {const e=existing.rows[0];if(e.store_id!==input.storeId||e.client_id!==input.clientId||e.package_id!==input.packageId||e.purchase_date!==input.purchaseDate||e.months!==input.months||e.snapshot.schedule.input.grace!==input.grace)throw new RuleError("La clave ya se utilizó para otra solicitud.","general",409);return {id:e.id,replayed:true};}
    const quote=await getQuote(db,actor,input);
    if(quote.fingerprint!==input.previewFingerprint)throw new RuleError("Las condiciones cambiaron. Genere una nueva vista previa.","general",409);
    const id=await insertCredit(db,actor,input,quote.schedule,quote.packageName,input.idempotencyKey);
    return {id,replayed:false};
  });
}
export async function registerPayment(actor:Actor,raw:unknown) {
  const input=paySchema.parse(raw);
  requireRole(actor,["NEGOCIO","SISTEMA"]);dateOnly(input.paidDate);
  if(input.paidDate>today())throw new RuleError("El pago no puede ser posterior a hoy.","paidDate");
  return transaction(async db=>{
    const {rows}=await db.query("SELECT * FROM credits WHERE id=$1 FOR UPDATE",[input.creditId]);const c=rows[0];
    if(!c)throw new RuleError("Crédito no disponible.","general",404);requireStore(actor,c.store_id);
    const prior=await db.query("SELECT p.id,p.paid_date,p.total,p.reference,i.credit_id,i.number FROM payments p JOIN installments i ON i.id=p.installment_id WHERE p.idempotency_key=$1",[input.idempotencyKey]);
    if(prior.rows[0]){const p=prior.rows[0];if(p.credit_id!==c.id||p.number!==input.installmentNumber||p.paid_date!==input.paidDate||p.total!==input.total||p.reference!==input.reference)throw new RuleError("La clave ya se utilizó para otra solicitud.","general",409);return {id:p.id,replayed:true};}
    const credit=(await loadCredits(db,c.store_id,c.client_id)).find(x=>x.id===c.id)!;
    const row=credit.schedule.rows.find(r=>r.number===input.installmentNumber)!;
    if(!row)throw new RuleError("Cuota no disponible.","installmentNumber");
    if(row.grace==="T")throw new RuleError("La gracia total capitaliza interés y no genera un cobro.","installmentNumber");
    if(credit.payments.some(p=>p.installmentNumber===row.number))throw new RuleError("La cuota ya fue pagada.","installmentNumber",409);
    const firstUnpaid=credit.schedule.rows.find(r=>r.grace!=="T"&&!credit.payments.some(p=>p.installmentNumber===r.number));
    if(firstUnpaid?.number!==row.number)throw new RuleError("Debe pagar primero la cuota pendiente más antigua.","installmentNumber");
    if(input.paidDate<row.dueDate)throw new RuleError("Este flujo registra cobros desde el vencimiento de la cuota.","paidDate");
    if(credit.payments.some(p=>p.paidDate>input.paidDate))throw new RuleError("La fecha no puede ser anterior al último pago del crédito.","paidDate");
    const fee=lateFee(row.payment,row.dueDate,input.paidDate,c.mora),total=money(new D(row.payment).plus(fee.amount));
    if(total!==input.total)throw new RuleError(`El pago completo debe ser ${c.currency} ${total}. Actualice el cálculo.`,"total",409);
    const id=randomUUID(),inst=await db.query("SELECT id FROM installments WHERE credit_id=$1 AND number=$2",[c.id,row.number]);
    await db.query("INSERT INTO payments(id,installment_id,user_id,paid_date,late_days,late_fee,interest,principal,total,reference,idempotency_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",[id,inst.rows[0].id,actor.id,input.paidDate,fee.days,fee.amount,row.interest,row.principal,total,input.reference,input.idempotencyKey]);
    await audit(db,actor,"REGISTRAR_PAGO",id,{creditId:c.id,installment:row.number,total,lateFee:fee.amount,interest:row.interest,principal:row.principal},c.store_id);
    return {id,replayed:false};
  });
}
const storeSchema=z.object({id:uuid.optional(),name:z.string().trim().min(2).max(120),business:z.string().trim().min(2).max(60),ruc:z.string().regex(/^\d{11}$/),cutDay:z.number().int().min(1).max(31),payDay:z.number().int().min(1).max(30),active:z.boolean(),adminEmail:z.email().max(120).optional(),adminName:z.string().min(2).max(120).optional(),adminPassword:z.string().min(10).max(128).optional()}).strict();
const clientSchema=z.object({id:uuid.optional(),storeId:uuid,name:z.string().trim().min(2).max(150),document:z.string().regex(/^(\d{8}|\d{11})$/),phone:z.string().max(20),address:z.string().max(200),currency:z.enum(["PEN","USD"]),tea:z.string(),creditLimit:z.string(),maxMonths:z.number().int().min(1).max(5),active:z.boolean(),portalEmail:z.email().max(120).optional(),portalPassword:z.string().min(10).max(128).optional()}).strict();
const packageSchema=z.object({id:uuid.optional(),storeId:uuid,name:z.string().trim().min(2).max(120),detail:z.string().max(500),currency:z.enum(["PEN","USD"]),amount:z.string(),active:z.boolean()}).strict();
export async function saveEntity(actor:Actor,kind:string,raw:unknown) {
  return transaction(async db=>{
    if(kind==="stores") {
      requireRole(actor,["SISTEMA"]);const v=storeSchema.parse(raw);const id=v.id??randomUUID();
      if(v.id) { const r=await db.query("UPDATE stores SET name=$2,business=$3,ruc=$4,cut_day=$5,pay_day=$6,active=$7 WHERE id=$1 RETURNING id",[id,v.name,v.business,v.ruc,v.cutDay,v.payDay,v.active]);if(!r.rowCount)throw new RuleError("Tienda no disponible.","general",404); }
      else {
        if(!v.adminEmail||!v.adminPassword||!v.adminName)throw new RuleError("Complete las credenciales del administrador de la tienda.","adminEmail");
        await db.query("INSERT INTO stores(id,name,business,ruc,cut_day,pay_day,active) VALUES($1,$2,$3,$4,$5,$6,$7)",[id,v.name,v.business,v.ruc,v.cutDay,v.payDay,v.active]);
        await db.query("INSERT INTO users(id,store_id,email,name,password_hash,role) VALUES($1,$2,$3,$4,$5,'NEGOCIO')",[randomUUID(),id,v.adminEmail.toLowerCase(),v.adminName,hashPassword(v.adminPassword)]);
      }
      await audit(db,actor,"GUARDAR_TIENDA",id,{active:v.active},id);return {id};
    }
    requireRole(actor,["SISTEMA","NEGOCIO"]);
    if(kind==="clients") {
      const v=clientSchema.parse(raw);requireStore(actor,v.storeId);
      const {decimalInput}=await import("./finance");decimalInput(v.tea,"tea","0.15","0.25");decimalInput(v.creditLimit,"creditLimit","1000","1000000");
      if(!new D(v.creditLimit).eq(money(v.creditLimit)))throw new RuleError("Use como máximo dos decimales.","creditLimit");
      const id=v.id??randomUUID();
      if(v.id) {
        const prior=await db.query("SELECT * FROM clients WHERE id=$1 AND store_id=$2 FOR UPDATE",[id,v.storeId]);if(!prior.rows[0])throw new RuleError("Cliente no disponible.","general",404);
        if(prior.rows[0].currency!==v.currency&&(await db.query("SELECT 1 FROM credits WHERE client_id=$1 LIMIT 1",[id])).rowCount)throw new RuleError("Un cliente con créditos conserva su moneda.","currency");
        await db.query("UPDATE clients SET name=$3,document=$4,phone=$5,address=$6,currency=$7,tea=$8,credit_limit=$9,max_months=$10,active=$11 WHERE id=$1 AND store_id=$2",[id,v.storeId,v.name,v.document,v.phone,v.address,v.currency,v.tea,v.creditLimit,v.maxMonths,v.active]);
      } else await db.query("INSERT INTO clients(id,store_id,name,document,phone,address,currency,tea,credit_limit,max_months,active) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",[id,v.storeId,v.name,v.document,v.phone,v.address,v.currency,v.tea,v.creditLimit,v.maxMonths,v.active]);
      if(v.portalEmail||v.portalPassword) {
        if(!v.portalEmail||!v.portalPassword)throw new RuleError("Complete correo y contraseña del portal.","portalEmail");
        const u=await db.query("SELECT id FROM users WHERE client_id=$1",[id]);
        if(u.rows[0])await db.query("UPDATE users SET email=$2,password_hash=$3,active=true WHERE id=$1",[u.rows[0].id,v.portalEmail.toLowerCase(),hashPassword(v.portalPassword)]);
        else await db.query("INSERT INTO users(id,store_id,client_id,email,name,password_hash,role) VALUES($1,$2,$3,$4,$5,$6,'CLIENTE')",[randomUUID(),v.storeId,id,v.portalEmail.toLowerCase(),v.name.slice(0,120),hashPassword(v.portalPassword)]);
      }
      await audit(db,actor,"GUARDAR_CLIENTE",id,{active:v.active},v.storeId);return {id};
    }
    if(kind==="packages") {
      const v=packageSchema.parse(raw);requireStore(actor,v.storeId);
      simulate({amount:v.amount,currency:v.currency,tea:"0.20",purchaseDate:today(),months:1,cutDay:25,payDay:5,grace:"SS"});
      const id=v.id??randomUUID();
      if(v.id){const r=await db.query("UPDATE packages SET name=$3,detail=$4,currency=$5,amount=$6,active=$7 WHERE id=$1 AND store_id=$2 RETURNING id",[id,v.storeId,v.name,v.detail,v.currency,v.amount,v.active]);if(!r.rowCount)throw new RuleError("Paquete no disponible.","general",404);}
      else await db.query("INSERT INTO packages(id,store_id,name,detail,currency,amount,active) VALUES($1,$2,$3,$4,$5,$6,$7)",[id,v.storeId,v.name,v.detail,v.currency,v.amount,v.active]);
      await audit(db,actor,"GUARDAR_PAQUETE",id,{amount:v.amount,currency:v.currency},v.storeId);return {id};
    }
    throw new RuleError("Operación no disponible.","general",404);
  });
}
export async function bootstrap(actor:Actor,requestedStore?:string) {
  if(requestedStore&&!uuid.safeParse(requestedStore).success)throw new RuleError("Tienda no disponible.","general",404);
  const stores=await pool.query(actor.role==="SISTEMA"?"SELECT * FROM stores ORDER BY name":"SELECT * FROM stores WHERE id=$1 AND active",actor.role==="SISTEMA"?[]:[actor.storeId]);
  const storeId=actor.role==="SISTEMA"?(requestedStore??stores.rows[0]?.id):actor.storeId;
  if(!storeId)return {actor,stores:stores.rows,storeId:null,clients:[],packages:[],credits:[],audit:[]};requireStore(actor,storeId);
  if(!stores.rows.some(s=>s.id===storeId))throw new RuleError("Tienda no disponible.","general",404);
  const [clients,packages,credits,trail]=await Promise.all([
    pool.query("SELECT * FROM clients WHERE store_id=$1 AND ($2::uuid IS NULL OR id=$2) ORDER BY name",[storeId,actor.role==="CLIENTE"?actor.clientId:null]),
    actor.role==="CLIENTE"?Promise.resolve({rows:[]}):pool.query("SELECT * FROM packages WHERE store_id=$1 ORDER BY amount",[storeId]),
    loadCredits(pool,storeId,actor.role==="CLIENTE"?actor.clientId!:undefined),
    actor.role==="CLIENTE"?Promise.resolve({rows:[]}):pool.query("SELECT a.action,a.entity_id,a.details,a.created_at,u.name user_name FROM audit a LEFT JOIN users u ON u.id=a.user_id WHERE a.store_id=$1 AND a.action<>'INICIAR_SESION' ORDER BY a.id DESC LIMIT 20",[storeId])
  ]);
  return {actor,stores:stores.rows,storeId,clients:clients.rows,packages:packages.rows,credits,audit:trail.rows};
}
