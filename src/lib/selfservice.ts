import {randomUUID} from "node:crypto";
import {z} from "zod";
import {pool,transaction,type DB} from "./db";
import {today,RuleError} from "./finance";
import {type Actor,requireRole,requireStore,audit,hashPassword,verifyPassword,actorFromRow} from "./security";
import {fingerprintSchema,getQuote,insertCredit,type QuoteInput,type QuoteSnapshot} from "./service";

const uuid=z.string().uuid();
export const MAX_PENDING_REQUESTS=3;
// Valores provisionales hasta que la tienda apruebe la cuenta y fije las condiciones reales.
export const PROVISIONAL={tea:"0.25",creditLimit:"1000.00",maxMonths:1} as const;

export const registerSchema=z.object({
  storeId:uuid,name:z.string().trim().min(2,"Escriba su nombre o razón social.").max(150),document:z.string().regex(/^(\d{8}|\d{11})$/,"Use 8 dígitos (DNI) u 11 dígitos (RUC)."),
  phone:z.string().trim().max(20).default(""),email:z.email("Escriba un correo válido.").max(120),password:z.string().min(10,"La contraseña debe tener al menos 10 caracteres.").max(128),
  currency:z.enum(["PEN","USD"]),idempotencyKey:uuid.optional()
}).strict();
export const requestSchema=z.object({packageId:uuid,frequency:z.literal("MENSUAL").default("MENSUAL"),months:z.number().int(),grace:z.string().max(10),mode:z.enum(["CUOTAS","UNICO"]).default("CUOTAS"),previewFingerprint:fingerprintSchema,idempotencyKey:uuid}).strict();
export const resolveSchema=z.object({id:uuid,action:z.enum(["aprobar","rechazar"]),note:z.string().trim().max(300).default(""),previewFingerprint:fingerprintSchema.optional(),idempotencyKey:uuid.optional()}).strict();
export const cancelSchema=z.object({id:uuid}).strict();

export async function publicStores() {
  const {rows}=await pool.query("SELECT id,name,business FROM stores WHERE active ORDER BY name");
  return {stores:rows};
}

export async function registerClient(raw:unknown) {
  const v=registerSchema.parse(raw);
  return transaction(async db=>{
    const store=await db.query("SELECT id FROM stores WHERE id=$1 AND active",[v.storeId]);
    if(!store.rowCount)throw new RuleError("Elija una tienda disponible.","storeId");
    const clientId=randomUUID(),userId=randomUUID(),email=v.email.toLowerCase();
    const prior=(await db.query(`SELECT u.*,c.document,c.currency,c.phone FROM users u
      LEFT JOIN clients c ON c.id=u.client_id AND c.active WHERE lower(u.email)=$1`,[email])).rows[0];
    if(prior) {
      if(v.idempotencyKey&&prior.signup_key===v.idempotencyKey&&prior.active&&prior.role==="CLIENTE"&&
        prior.store_id===v.storeId&&prior.name===v.name.slice(0,120)&&prior.document===v.document&&prior.currency===v.currency&&
        prior.phone===v.phone&&verifyPassword(v.password,prior.password_hash))return actorFromRow(prior);
      throw new RuleError("Ya existe una cuenta con este correo. Ingrese con su contraseña.","email",409);
    }
    if((await db.query("SELECT 1 FROM clients WHERE store_id=$1 AND document=$2",[v.storeId,v.document])).rowCount)throw new RuleError("Este documento ya está registrado en la tienda. Pida a la tienda que le entregue su acceso.","document",409);
    await db.query("INSERT INTO clients(id,store_id,name,document,phone,currency,tea,credit_limit,max_months,approval) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'PENDIENTE')",[clientId,v.storeId,v.name,v.document,v.phone,v.currency,PROVISIONAL.tea,PROVISIONAL.creditLimit,PROVISIONAL.maxMonths]);
    await db.query("INSERT INTO users(id,store_id,client_id,email,name,password_hash,role,signup_key) VALUES($1,$2,$3,$4,$5,$6,'CLIENTE',$7)",[userId,v.storeId,clientId,email,v.name.slice(0,120),hashPassword(v.password),v.idempotencyKey??null]);
    const actor=actorFromRow({id:userId,store_id:v.storeId,client_id:clientId,role:"CLIENTE",name:v.name.slice(0,120),email});
    await audit(db,actor,"REGISTRAR_CLIENTE",clientId,{currency:v.currency},v.storeId);
    return actor;
  });
}

export async function createRequest(actor:Actor,raw:unknown) {
  requireRole(actor,["CLIENTE"]);
  const v=requestSchema.parse(raw);
  return transaction(async db=>{
    await db.query("SELECT id FROM clients WHERE id=$1 AND store_id=$2 FOR UPDATE",[actor.clientId,actor.storeId]);
    const prior=await db.query("SELECT id,client_id,package_id,months,grace,mode,frequency,quote_fingerprint FROM purchase_requests WHERE idempotency_key=$1",[v.idempotencyKey]);
    if(prior.rows[0]) {const p=prior.rows[0];if(p.client_id!==actor.clientId||p.package_id!==v.packageId||p.months!==v.months||p.grace!==v.grace||p.mode!==v.mode||p.frequency!==v.frequency||p.quote_fingerprint!==v.previewFingerprint)throw new RuleError("La clave ya se utilizó para otra solicitud.","general",409);return {id:p.id,replayed:true};}
    const pending=await db.query("SELECT count(*)::int n FROM purchase_requests WHERE client_id=$1 AND status='PENDIENTE'",[actor.clientId]);
    if(pending.rows[0].n>=MAX_PENDING_REQUESTS)throw new RuleError(`Ya tiene ${MAX_PENDING_REQUESTS} solicitudes en espera. Espere la respuesta de la tienda o cancele alguna.`,"general",409);
    const input={storeId:actor.storeId!,clientId:actor.clientId!,packageId:v.packageId,purchaseDate:today(),months:v.months,grace:v.grace,mode:v.mode,frequency:v.frequency,rateSteps:[]};
    const quote=await getQuote(db,actor,input,true);
    if(quote.fingerprint!==v.previewFingerprint)throw new RuleError("Cambió la fecha o alguna condición de la compra. Vuelva a cotizar.","previewFingerprint",409);
    const snapshot:QuoteSnapshot={schedule:quote.schedule,terms:quote.terms,packageName:quote.packageName};
    const id=randomUUID();
    await db.query(`INSERT INTO purchase_requests(id,store_id,client_id,package_id,purchase_date,months,grace,mode,idempotency_key,frequency,quote_fingerprint,quote_snapshot)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [id,input.storeId,input.clientId,input.packageId,input.purchaseDate,input.months,input.grace,input.mode,v.idempotencyKey,v.frequency,quote.fingerprint,JSON.stringify(snapshot)]);
    await audit(db,actor,"SOLICITAR_COMPRA",id,{packageId:v.packageId,months:v.months,mode:v.mode},input.storeId);
    return {id,replayed:false};
  });
}

export async function cancelRequest(actor:Actor,raw:unknown) {
  requireRole(actor,["CLIENTE"]);
  const v=cancelSchema.parse(raw);
  return transaction(async db=>{
    const r=await db.query("SELECT status FROM purchase_requests WHERE id=$1 AND client_id=$2 AND store_id=$3 FOR UPDATE",[v.id,actor.clientId,actor.storeId]);
    if(!r.rows[0])throw new RuleError("Solicitud no disponible.","general",404);
    if(r.rows[0].status==="CANCELADA")return {id:v.id,replayed:true};
    if(r.rows[0].status!=="PENDIENTE")throw new RuleError("Esta solicitud ya fue atendida.","general",409);
    await db.query("UPDATE purchase_requests SET status='CANCELADA',resolved_at=now(),review_issue=NULL WHERE id=$1",[v.id]);
    await audit(db,actor,"CANCELAR_SOLICITUD",v.id,{},actor.storeId);
    return {id:v.id};
  });
}

type StoredRequest={
  id:string;store_id:string;client_id:string;package_id:string;purchase_date:string;
  months:number;grace:string;mode:"CUOTAS"|"UNICO";frequency:"MENSUAL"|"QUINCENAL";
  status:string;note:string;credit_id:string|null;resolved_by:string|null;resolution_key:string|null;
  quote_fingerprint:string|null;quote_snapshot:QuoteSnapshot|null;
};
async function readRequest(db:DB,actor:Actor,id:string,lock=false) {
  const found=await db.query<StoredRequest>("SELECT * FROM purchase_requests WHERE id=$1"+(lock?" FOR UPDATE":""),[id]);
  const r=found.rows[0];
  if(!r)throw new RuleError("Solicitud no disponible.","general",404);
  requireStore(actor,r.store_id);
  return r;
}
function requestInput(r:StoredRequest):QuoteInput {
  return {storeId:r.store_id,clientId:r.client_id,packageId:r.package_id,purchaseDate:r.purchase_date,months:r.months,grace:r.grace,mode:r.mode,frequency:r.frequency,rateSteps:[]};
}
export async function previewRequest(actor:Actor,id:string) {
  requireRole(actor,["NEGOCIO","SISTEMA"]);
  const r=await readRequest(pool,actor,uuid.parse(id));
  if(r.status!=="PENDIENTE")throw new RuleError("Esta solicitud ya fue atendida.","general",409);
  return getQuote(pool,actor,requestInput(r));
}
function changedTerms(before:QuoteSnapshot,after:QuoteSnapshot) {
  const {price,rate,calendar,saleMode}=before.terms, current=after.terms;
  if(price.amount!==current.price.amount||price.cash!==current.price.cash||price.currency!==current.price.currency)return "Cambió el precio o la moneda del producto.";
  if(Object.keys(rate).some(key=>rate[key as keyof typeof rate]!==current.rate[key as keyof typeof rate]))return "Cambió la tasa pactada o su capitalización.";
  if(calendar.cutDay!==current.calendar.cutDay||calendar.payDay!==current.calendar.payDay)return "Cambió el calendario de corte y pago.";
  if(saleMode!==current.saleMode)return "Cambió la modalidad disponible del producto.";
  return "Cambió el cronograma de la cotización.";
}
export async function resolveRequest(actor:Actor,raw:unknown) {
  requireRole(actor,["NEGOCIO","SISTEMA"]);
  const v=resolveSchema.parse(raw);
  const result=await transaction(async db=>{
    const r=await readRequest(db,actor,v.id,true);
    if(r.status!=="PENDIENTE") {
      if(v.idempotencyKey&&r.resolution_key===v.idempotencyKey&&r.resolved_by===actor.id&&
        r.status===(v.action==="aprobar"?"APROBADA":"RECHAZADA")&&r.note===v.note)return {id:r.id,creditId:r.credit_id,replayed:true};
      throw new RuleError("Esta solicitud ya fue atendida.","general",409);
    }
    if(v.action==="rechazar") {
      if(!v.note)throw new RuleError("Indique el motivo para que el cliente lo vea.","note");
      await db.query("UPDATE purchase_requests SET status='RECHAZADA',note=$2,resolved_by=$3,resolved_at=now(),resolution_key=$4,review_issue=NULL WHERE id=$1",[r.id,v.note,actor.id,v.idempotencyKey??null]);
      await audit(db,actor,"RECHAZAR_SOLICITUD",r.id,{},r.store_id);
      return {id:r.id,creditId:null};
    }
    await db.query("SELECT id FROM clients WHERE id=$1 AND store_id=$2 FOR UPDATE",[r.client_id,r.store_id]);
    const input=requestInput(r);
    const reviewIssue=async(reason:string)=>{
      const message=reason+(r.quote_snapshot?" El cliente puede cancelar y volver a cotizar.":" Revise las condiciones y genere otra vista previa.");
      await db.query("UPDATE purchase_requests SET review_issue=$2 WHERE id=$1",[r.id,message]);
      return {issue:message};
    };
    let quote;
    try {quote=await getQuote(db,actor,input,true);}
    catch(e) {
      if(e instanceof RuleError)return reviewIssue(e.message);
      throw e;
    }
    if(r.quote_fingerprint&&quote.fingerprint!==r.quote_fingerprint)
      return reviewIssue(changedTerms(r.quote_snapshot!,quote));
    if(!r.quote_fingerprint&&quote.fingerprint!==v.previewFingerprint)
      return reviewIssue("La solicitud anterior necesita una vista previa vigente para aprobarse.");
    const creditId=await insertCredit(db,actor,input,quote.schedule,r.quote_snapshot?.packageName??quote.packageName,randomUUID());
    await db.query("UPDATE purchase_requests SET status='APROBADA',credit_id=$2,note=$3,resolved_by=$4,resolved_at=now(),resolution_key=$5,review_issue=NULL WHERE id=$1",[r.id,creditId,v.note,actor.id,v.idempotencyKey??null]);
    await audit(db,actor,"APROBAR_SOLICITUD",r.id,{creditId},r.store_id);
    return {id:r.id,creditId};
  });
  if("issue" in result)throw new RuleError(result.issue,"previewFingerprint",409);
  return result;
}
