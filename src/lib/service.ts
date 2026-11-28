import {createHash,randomUUID} from "node:crypto";
import {z} from "zod";
import {pool,transaction,type DB} from "./db";
import {D,money,simulate,statement,creditLine,lateFee,today,dateOnly,decimalInput,teaFromNominal,COMPOUNDING,RuleError,type Compounding,type Credit,type Payment,type Schedule} from "./finance";
import {legalReference} from "./legal";
import {type Actor,requireRole,requireStore,audit,hashPassword} from "./security";
import {readProductImage,type ProductImage} from "./product-image";

const uuid=z.string().uuid();
const rateStepSchema=z.object({from:z.number().int(),tea:z.string().max(20)}).strict();
export const fingerprintSchema=z.string().regex(/^[a-f0-9]{64}$/,"Genere una vista previa vigente.");
export const quoteSchema=z.object({storeId:uuid,clientId:uuid,packageId:uuid,purchaseDate:z.string(),frequency:z.enum(["MENSUAL","QUINCENAL"]).default("MENSUAL"),months:z.number().int(),grace:z.string().max(10),mode:z.enum(["CUOTAS","UNICO"]).default("CUOTAS"),rateSteps:z.array(rateStepSchema).max(4).default([])}).strict();
export const registrationSchema=quoteSchema.extend({idempotencyKey:uuid,previewFingerprint:fingerprintSchema});
export const paySchema=z.object({creditId:uuid,installmentNumber:z.number().int().min(1).max(10),paidDate:z.string(),total:z.string().regex(/^\d+\.\d{2}$/),reference:z.string().trim().min(1).max(120),idempotencyKey:uuid}).strict();
export type QuoteInput=z.input<typeof quoteSchema>;
const fingerprintOf=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
/** jsonb no conserva el orden de las claves: se compara por contenido. */
const stepsKey=(steps:{from:number;tea:string}[])=>(steps??[]).map(x=>`${x.from}:${x.tea}`).join("|");
export async function loadCredits(db:DB,storeId:string,clientId?:string):Promise<Credit[]> {
  const {rows}=await db.query("SELECT c.*,cl.name client_name FROM credits c JOIN clients cl ON cl.id=c.client_id WHERE c.store_id=$1 AND ($2::uuid IS NULL OR c.client_id=$2) ORDER BY c.purchase_date DESC,c.id",[storeId,clientId??null]);
  if(!rows.length)return [];
  const paid=await db.query("SELECT p.*,i.credit_id,i.number FROM payments p JOIN installments i ON i.id=p.installment_id WHERE i.credit_id=ANY($1::uuid[])",[rows.map(r=>r.id)]);
  return rows.map(r=>({id:r.id,clientId:r.client_id,storeId:r.store_id,clientName:r.client_name,packageName:r.snapshot.packageName,currency:r.currency,schedule:r.snapshot.schedule,createdAt:r.created_at.toISOString(),payments:paid.rows.filter(p=>p.credit_id===r.id).map(p=>({id:p.id,installmentNumber:p.number,paidDate:p.paid_date,lateFee:p.late_fee,interest:p.interest,principal:p.principal,total:p.total,reference:p.reference}))}));
}
export async function getQuote(db:DB,actor:Actor,input:QuoteInput,lock=false) {
  if(actor.role==="CLIENTE") {if(actor.clientId!==input.clientId||actor.storeId!==input.storeId)throw new RuleError("Recurso no disponible.","general",404);}
  else requireRole(actor,["NEGOCIO","SISTEMA"]);
  requireStore(actor,input.storeId);
  dateOnly(input.purchaseDate);if(input.purchaseDate>today())throw new RuleError("La compra no puede ser posterior a hoy.","purchaseDate");
  const client=await db.query("SELECT * FROM clients WHERE id=$1 AND store_id=$2 AND active",[input.clientId,input.storeId]);
  const pack=await db.query("SELECT id,name,amount,cash_price,currency,sale_mode FROM packages WHERE id=$1 AND store_id=$2 AND active"+(lock?" FOR SHARE":""),[input.packageId,input.storeId]);
  const store=await db.query("SELECT * FROM stores WHERE id=$1 AND active"+(lock?" FOR SHARE":""),[input.storeId]);
  const c=client.rows[0],p=pack.rows[0],t=store.rows[0];
  if(!c||!p||!t)throw new RuleError("Cliente, paquete o tienda no disponible.","general",404);
  if(c.approval!=="APROBADO")throw new RuleError(c.approval==="PENDIENTE"?"La cuenta aún está pendiente de aprobación de la tienda.":"La tienda no aprobó esta cuenta para comprar a crédito.","clientId");
  if(c.currency!==p.currency)throw new RuleError("La moneda del cliente y del paquete debe coincidir.","packageId");
  if(input.months>c.max_months)throw new RuleError(`El plazo máximo del cliente es ${c.max_months} meses.`,"months");
  const mode=input.mode??"CUOTAS",rateSteps=input.rateSteps??[];
  if(actor.role==="CLIENTE"&&rateSteps.length)throw new RuleError("Los cambios de tasa los define la tienda.","rateSteps");
  if(p.sale_mode!=="AMBOS"&&p.sale_mode!==mode)throw new RuleError(p.sale_mode==="UNICO"?"Este producto solo se vende a pago único en la fecha de pago.":"Este producto solo se vende en cuotas.","mode");
  // Corte y pago: los del cliente si los tiene pactados; si no, los de la tienda.
  const schedule=simulate({amount:p.amount,currency:p.currency,tea:c.tea,purchaseDate:input.purchaseDate,months:input.months,cutDay:c.cut_day??t.cut_day,payDay:c.pay_day??t.pay_day,grace:input.grace,mode,rateSteps,frequency:input.frequency??"MENSUAL",mora:c.mora_tea??"0.35"});
  const credits=await loadCredits(db,input.storeId,c.id);
  const line=creditLine(c.credit_limit,credits,input.purchaseDate),lineNow=creditLine(c.credit_limit,credits,today());
  // A backdated purchase must fit both its original date and the financial balance at booking.
  const proposed:Credit={id:"preview",clientId:c.id,storeId:t.id,clientName:c.name,packageName:p.name,currency:p.currency,schedule,payments:[]};
  if(new D(p.amount).gt(line.available)||new D(statement(proposed,today()).outstanding).gt(lineNow.available))throw new RuleError(`La compra excede la línea disponible (${c.currency==="PEN"?"S/":"US$"} ${new Intl.NumberFormat("es-PE",{minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(D.min(line.available,lineNow.available).toFixed(2)))}).`,"packageId");
  const terms={
    price:{amount:String(p.amount),cash:String(p.cash_price),currency:schedule.input.currency},
    rate:{tea:schedule.input.tea,kind:String(c.rate_kind),nominal:c.rate_input as string|null,compounding:c.compounding as string|null,
      mora:schedule.input.mora, moraKind:String(c.mora_kind),moraNominal:c.mora_input as string|null,moraCompounding:c.mora_compounding as string|null},
    calendar:{cutDay:schedule.input.cutDay,payDay:schedule.input.payDay},
    saleMode:String(p.sale_mode)
  };
  const snapshot={schedule,terms,packageName:String(p.name)};
  const fingerprint=fingerprintOf({storeId:t.id,clientId:c.id,packageId:p.id,schedule,terms});
  return {schedule,terms,line,lineNow,clientName:String(c.name),packageName:snapshot.packageName,fingerprint,legal:legalReference(input.purchaseDate,p.currency)};
}
export type Quote=Awaited<ReturnType<typeof getQuote>>;
export type QuoteSnapshot=Pick<Quote,"schedule"|"terms"|"packageName">;
export async function insertCredit(db:DB,actor:Actor,input:QuoteInput,schedule:Schedule,packageName:string,idempotencyKey:string,id:string=randomUUID()) {
  await db.query("INSERT INTO credits(id,store_id,client_id,package_id,user_id,purchase_date,amount,currency,tea,mora,months,initial_balance,initial_interest,cut_date,base_date,snapshot,legal_reference,idempotency_key,mode,rate_steps) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)",
    [id,input.storeId,input.clientId,input.packageId,actor.id,input.purchaseDate,schedule.input.amount,schedule.input.currency,schedule.input.tea,schedule.input.mora,input.months,schedule.initialBalance,schedule.initialInterest,schedule.cutDate,schedule.baseDate,JSON.stringify({schedule,packageName}),JSON.stringify(legalReference(input.purchaseDate,schedule.input.currency)),idempotencyKey,schedule.input.mode??"CUOTAS",JSON.stringify(schedule.input.rateSteps??[])]);
  for(const r of schedule.rows) await db.query("INSERT INTO installments(id,credit_id,number,due_date,grace,opening,interest,payment,principal,closing,capitalized,tea) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",[randomUUID(),id,r.number,r.dueDate,r.grace,r.opening,r.interest,r.payment,r.principal,r.closing,r.capitalized,r.tea??schedule.input.tea]);
  await audit(db,actor,"REGISTRAR_CREDITO",id,{amount:schedule.input.amount,currency:schedule.input.currency},input.storeId);
  return id;
}
export async function registerCredit(actor:Actor,raw:unknown) {
  requireRole(actor,["NEGOCIO","SISTEMA"]);
  const input=registrationSchema.parse(raw);
  return transaction(async db=>{
    requireRole(actor,["NEGOCIO","SISTEMA"]);requireStore(actor,input.storeId);
    await db.query("SELECT id FROM clients WHERE id=$1 AND store_id=$2 FOR UPDATE",[input.clientId,input.storeId]);
    const existing=await db.query("SELECT id,store_id,client_id,package_id,purchase_date,months,mode,rate_steps,snapshot FROM credits WHERE idempotency_key=$1",[input.idempotencyKey]);
    if(existing.rows[0]) {const e=existing.rows[0];if(e.store_id!==input.storeId||e.client_id!==input.clientId||e.package_id!==input.packageId||e.purchase_date!==input.purchaseDate||e.months!==input.months||e.snapshot.schedule.input.grace!==input.grace||(e.snapshot.schedule.input.frequency??"QUINCENAL")!==input.frequency||e.mode!==(input.mode??"CUOTAS")||stepsKey(e.rate_steps)!==stepsKey(input.rateSteps??[]))throw new RuleError("La clave ya se utilizó para otra solicitud.","general",409);return {id:e.id,replayed:true};}
    if(input.frequency!=="MENSUAL")throw new RuleError("Las ventas nuevas usan frecuencia mensual.","frequency");
    const quote=await getQuote(db,actor,input,true);
    if(quote.fingerprint!==input.previewFingerprint)throw new RuleError("Las condiciones cambiaron. Genere una nueva vista previa.","previewFingerprint",409);
    const id=await insertCredit(db,actor,input,quote.schedule,quote.packageName,input.idempotencyKey);
    return {id,replayed:false};
  });
}
export async function registerPayment(actor:Actor,raw:unknown) {
  requireRole(actor,["NEGOCIO","SISTEMA"]);
  const input=paySchema.parse(raw);dateOnly(input.paidDate);
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
const clientSchema=z.object({id:uuid.optional(),storeId:uuid,name:z.string().trim().min(2).max(150),document:z.string().regex(/^(\d{8}|\d{11})$/),phone:z.string().max(20),address:z.string().max(200),currency:z.enum(["PEN","USD"]),tea:z.string(),creditLimit:z.string(),maxMonths:z.number().int().min(1).max(5),active:z.boolean(),cutDay:z.number().int().min(1).max(31).nullable().optional(),payDay:z.number().int().min(1).max(30).nullable().optional(),rateKind:z.enum(["TEA","TNA"]).default("TEA"),rateInput:z.string().max(20).nullable().optional(),compounding:z.enum(Object.keys(COMPOUNDING) as [Compounding,...Compounding[]]).nullable().optional(),moraTea:z.string().optional(),moraKind:z.enum(["TEA","TNA"]).optional(),moraInput:z.string().nullable().optional(),moraCompounding:z.enum(Object.keys(COMPOUNDING) as [Compounding,...Compounding[]]).nullable().optional(),approval:z.enum(["PENDIENTE","APROBADO","RECHAZADO"]).optional(),approvalNote:z.string().max(300).optional(),portalEmail:z.email().max(120).optional(),portalPassword:z.string().min(10).max(128).optional()}).strict();
const packageSchema=z.object({id:uuid.optional(),storeId:uuid,name:z.string().trim().min(2).max(120),detail:z.string().max(500),currency:z.enum(["PEN","USD"]),amount:z.string(),cashPrice:z.string(),brand:z.string().trim().max(80).default(""),supplier:z.string().trim().max(120).default(""),unit:z.string().trim().min(1,"Indique la unidad de medida.").max(30).default("Paquete"),saleMode:z.enum(["UNICO","CUOTAS","AMBOS"]).default("AMBOS"),image:z.string().regex(/^\/productos\/[A-Za-z0-9._-]+$/).max(200).nullable().optional(),removeImage:z.boolean().default(false),active:z.boolean()}).strict();
export async function saveEntity(actor:Actor,kind:string,raw:unknown,file?:File,rawKey?:string|null) {
  requireRole(actor,kind==="stores"?["SISTEMA"]:["SISTEMA","NEGOCIO"]);
  const key=rawKey?uuid.parse(rawKey):null;
  const photo=file?await readProductImage(file):undefined;
  const fingerprint=key?fingerprintOf([kind,raw,photo&&createHash("sha256").update(photo.data).digest("hex")]):null;
  return transaction(async db=>{
    if(key) {
      // El usuario y la clave identifican el mismo intento, incluso si se perdió la respuesta.
      await db.query("SELECT id FROM users WHERE id=$1 FOR UPDATE",[actor.id]);
      const prior=(await db.query("SELECT user_id,fingerprint,entity_id FROM entity_saves WHERE idempotency_key=$1",[key])).rows[0];
      if(prior) {
        if(prior.user_id!==actor.id||prior.fingerprint!==fingerprint)throw new RuleError("La clave ya se utilizó para otra operación.","general",409);
        return {id:prior.entity_id as string,replayed:true};
      }
    }
    const result=await saveEntityInTransaction(db,actor,kind,raw,photo);
    if(key)await db.query("INSERT INTO entity_saves(idempotency_key,user_id,fingerprint,entity_id) VALUES($1,$2,$3,$4)",[key,actor.id,fingerprint,result.id]);
    return result;
  });
}
async function saveEntityInTransaction(db:DB,actor:Actor,kind:string,raw:unknown,photo?:ProductImage) {
    if(kind==="stores") {
      const v=storeSchema.parse(raw);const id=v.id??randomUUID();
      if(v.id) { const r=await db.query("UPDATE stores SET name=$2,business=$3,ruc=$4,cut_day=$5,pay_day=$6,active=$7 WHERE id=$1 RETURNING id",[id,v.name,v.business,v.ruc,v.cutDay,v.payDay,v.active]);if(!r.rowCount)throw new RuleError("Tienda no disponible.","general",404); }
      else {
        await db.query("INSERT INTO stores(id,name,business,ruc,cut_day,pay_day,active) VALUES($1,$2,$3,$4,$5,$6,$7)",[id,v.name,v.business,v.ruc,v.cutDay,v.payDay,v.active]);
      }
      if(!v.id||v.adminEmail||v.adminName||v.adminPassword) {
        if(!v.adminEmail||!v.adminName)throw new RuleError("Complete el nombre y el correo del administrador.","adminEmail");
        const admin=(await db.query("SELECT id,email FROM users WHERE store_id=$1 AND role='NEGOCIO' AND NOT read_only ORDER BY active DESC,id LIMIT 1 FOR UPDATE",[id])).rows[0];
        if(admin) {
          await db.query("UPDATE users SET name=$2,email=$3,password_hash=COALESCE($4,password_hash) WHERE id=$1",[admin.id,v.adminName,v.adminEmail.toLowerCase(),v.adminPassword?hashPassword(v.adminPassword):null]);
          if(v.adminPassword||admin.email!==v.adminEmail.toLowerCase())await db.query("DELETE FROM sessions WHERE user_id=$1",[admin.id]);
        } else {
          if(!v.adminPassword)throw new RuleError("Indique una contraseña para el administrador.","adminPassword");
          await db.query("INSERT INTO users(id,store_id,email,name,password_hash,role) VALUES($1,$2,$3,$4,$5,'NEGOCIO')",[randomUUID(),id,v.adminEmail.toLowerCase(),v.adminName,hashPassword(v.adminPassword)]);
        }
      }
      await audit(db,actor,"GUARDAR_TIENDA",id,{active:v.active},id);return {id};
    }
    if(kind==="clients") {
      const v=clientSchema.parse(raw);requireStore(actor,v.storeId);
      decimalInput(v.tea,"tea","0.15","0.25");decimalInput(v.creditLimit,"creditLimit","1000","1000000");
      // Tasa pactada nominal: la TEA que se guarda debe ser exactamente la equivalente, calculada aquí y no confiada al navegador.
      let rateInput:string|null=null,compounding:string|null=null;
      if(v.rateKind==="TNA") {
        if(!v.rateInput||!v.compounding)throw new RuleError("Indique la tasa nominal y su capitalización.","tea");
        decimalInput(v.rateInput,"tea","0","1");
        if(!teaFromNominal(v.rateInput,v.compounding).toDecimalPlaces(12).eq(new D(v.tea).toDecimalPlaces(12)))throw new RuleError("La TEA no corresponde a la tasa nominal y capitalización indicadas.","tea");
        rateInput=v.rateInput;compounding=v.compounding;
      }
      const cutDay=v.cutDay??null,payDay=v.payDay??null;
      if((cutDay===null)!==(payDay===null))throw new RuleError("Indique el día de corte y el de pago del cliente, o deje ambos vacíos para usar los de la tienda.",cutDay===null?"cutDay":"payDay");
      if(!new D(v.creditLimit).eq(money(v.creditLimit)))throw new RuleError("Use como máximo dos decimales.","creditLimit");
      const id=v.id??randomUUID();
      if(v.id) {
        const prior=await db.query("SELECT * FROM clients WHERE id=$1 AND store_id=$2 FOR UPDATE",[id,v.storeId]);if(!prior.rows[0])throw new RuleError("Cliente no disponible.","general",404);
        if(v.approval==="RECHAZADO"&&!v.approvalNote?.trim())throw new RuleError("Indique el motivo del rechazo para el cliente.","approvalNote");
        if(prior.rows[0].currency!==v.currency&&(await db.query("SELECT 1 FROM credits WHERE client_id=$1 LIMIT 1",[id])).rowCount)throw new RuleError("Un cliente con créditos conserva su moneda.","currency");
        await db.query("UPDATE clients SET name=$3,document=$4,phone=$5,address=$6,currency=$7,tea=$8,credit_limit=$9,max_months=$10,active=$11,approval=COALESCE($12,approval),approval_note=COALESCE($13,approval_note),cut_day=$14,pay_day=$15,rate_kind=$16,rate_input=$17,compounding=$18 WHERE id=$1 AND store_id=$2",[id,v.storeId,v.name,v.document,v.phone,v.address,v.currency,v.tea,v.creditLimit,v.maxMonths,v.active,v.approval??null,v.approvalNote??null,cutDay,payDay,v.rateKind,rateInput,compounding]);
      } else await db.query("INSERT INTO clients(id,store_id,name,document,phone,address,currency,tea,credit_limit,max_months,active,cut_day,pay_day,rate_kind,rate_input,compounding) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)",[id,v.storeId,v.name,v.document,v.phone,v.address,v.currency,v.tea,v.creditLimit,v.maxMonths,v.active,cutDay,payDay,v.rateKind,rateInput,compounding]);
      if(v.moraTea!==undefined){
        const mora=decimalInput(v.moraTea,"moraTea","0","2"),kind=v.moraKind??"TEA";
        if(kind==="TNA"){
          if(!v.moraInput||!v.moraCompounding)throw new RuleError("Indique la TNA moratoria y su capitalización.","moraTea");
          decimalInput(v.moraInput,"moraTea","0","2");
          if(!teaFromNominal(v.moraInput,v.moraCompounding).toDecimalPlaces(12).eq(mora.toDecimalPlaces(12)))throw new RuleError("La mora efectiva no corresponde a la nominal pactada.","moraTea");
        }
        await db.query("UPDATE clients SET mora_tea=$2,mora_kind=$3,mora_input=$4,mora_compounding=$5 WHERE id=$1",[id,mora.toFixed(12),kind,kind==="TNA"?v.moraInput:null,kind==="TNA"?v.moraCompounding:null]);
      }
      if(v.portalEmail||v.portalPassword) {
        if(!v.portalEmail||!v.portalPassword)throw new RuleError("Complete correo y contraseña del portal.","portalEmail");
        const u=await db.query("SELECT id FROM users WHERE client_id=$1",[id]);
        if(u.rows[0])await db.query("UPDATE users SET email=$2,password_hash=$3,active=true WHERE id=$1",[u.rows[0].id,v.portalEmail.toLowerCase(),hashPassword(v.portalPassword)]);
        else await db.query("INSERT INTO users(id,store_id,client_id,email,name,password_hash,role) VALUES($1,$2,$3,$4,$5,$6,'CLIENTE')",[randomUUID(),v.storeId,id,v.portalEmail.toLowerCase(),v.name.slice(0,120),hashPassword(v.portalPassword)]);
      }
      await audit(db,actor,"GUARDAR_CLIENTE",id,{active:v.active,approval:v.approval??"sin cambio"},v.storeId);return {id};
    }
    if(kind==="packages") {
      const v=packageSchema.parse(raw);requireStore(actor,v.storeId);
      if(photo&&v.removeImage)throw new RuleError("Elija una imagen o quite la anterior.","image");
      simulate({amount:v.amount,currency:v.currency,tea:"0.20",purchaseDate:today(),months:1,cutDay:25,payDay:5,grace:"SS"});
      // amount = precio de lista (a crédito); el precio al contado nunca lo supera.
      const cash=v.cashPrice;
      decimalInput(cash,"cashPrice","0.01","5000");
      if(!new D(cash).eq(money(cash)))throw new RuleError("Use como máximo dos decimales.","cashPrice");
      if(new D(cash).gte(v.amount))throw new RuleError("El precio al contado debe ser menor que el monto financiado.","cashPrice");
      const id=v.id??randomUUID();
      const values=[id,v.storeId,v.name,v.detail,v.currency,v.amount,v.active,v.image??null,cash,v.brand,v.supplier,v.unit,v.saleMode,photo?.data??null,photo?.mime??null];
      if(v.id) {
        const replaceImage=Boolean(photo)||v.removeImage||v.image!==undefined;
        const r=await db.query(`UPDATE packages SET name=$3,detail=$4,currency=$5,amount=$6,active=$7,cash_price=$9,brand=$10,supplier=$11,unit=$12,sale_mode=$13,
          image=CASE WHEN $16 THEN $8 ELSE image END,
          image_data=CASE WHEN $16 THEN $14 ELSE image_data END,
          image_mime=CASE WHEN $16 THEN $15 ELSE image_mime END
          WHERE id=$1 AND store_id=$2 RETURNING id`,[...values,replaceImage]);
        if(!r.rowCount)throw new RuleError("Producto no disponible.","general",404);
      } else await db.query("INSERT INTO packages(id,store_id,name,detail,currency,amount,active,image,cash_price,brand,supplier,unit,sale_mode,image_data,image_mime) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)",values);
      await audit(db,actor,"GUARDAR_PAQUETE",id,{amount:v.amount,cashPrice:cash,currency:v.currency,saleMode:v.saleMode},v.storeId);return {id};
    }
    throw new RuleError("Operación no disponible.","general",404);
}
export async function getProductImage(actor:Actor,rawId:string) {
  if(!uuid.safeParse(rawId).success)throw new RuleError("Imagen no disponible.","image",404);
  const {rows}=await pool.query(`SELECT p.image_data,p.image_mime FROM packages p
    JOIN stores s ON s.id=p.store_id AND s.active
    WHERE p.id=$1 AND p.image_data IS NOT NULL AND ($2 OR p.store_id=$3)
    AND ($4::uuid IS NULL OR (p.active AND p.currency=(SELECT currency FROM clients WHERE id=$4 AND active)))`,
    [rawId,actor.role==="SISTEMA",actor.storeId,actor.role==="CLIENTE"?actor.clientId:null]);
  if(!rows[0])throw new RuleError("Imagen no disponible.","image",404);
  return {data:rows[0].image_data as Buffer,mime:rows[0].image_mime as string};
}
export async function bootstrap(actor:Actor,requestedStore?:string) {
  return transaction(db=>readWorkspace(db,actor,requestedStore));
}
async function readWorkspace(db:DB,actor:Actor,requestedStore?:string) {
  if(requestedStore&&!uuid.safeParse(requestedStore).success)throw new RuleError("Tienda no disponible.","general",404);
  const stores=await db.query(actor.role==="SISTEMA"?`SELECT s.*,a.email admin_email,a.name admin_name FROM stores s
    LEFT JOIN LATERAL (SELECT email,name FROM users WHERE store_id=s.id AND role='NEGOCIO' AND NOT read_only ORDER BY active DESC,id LIMIT 1) a ON true
    ORDER BY s.name`:"SELECT * FROM stores WHERE id=$1 AND active",actor.role==="SISTEMA"?[]:[actor.storeId]);
  if(requestedStore)requireStore(actor,requestedStore);
  if(requestedStore&&!stores.rows.some(s=>s.id===requestedStore))throw new RuleError("Tienda no disponible.","general",404);
  const storeId=actor.role==="SISTEMA"?(stores.rows.find(s=>s.id===requestedStore&&s.active)??stores.rows.find(s=>s.active))?.id:actor.storeId;
  if(!storeId)return {actor,stores:stores.rows,storeId:null,clients:[],packages:[],credits:[],audit:[],requests:[]};
  const clientId=actor.role==="CLIENTE"?actor.clientId:null;
  const clients=await db.query("SELECT * FROM clients WHERE store_id=$1 AND ($2::uuid IS NULL OR id=$2) ORDER BY name",[storeId,clientId]);
  // xmin changes when a product is edited so the browser requests its replacement even on the same card.
  const packages=await db.query(`SELECT id,store_id,name,detail,currency,amount,active,brand,supplier,unit,cash_price,sale_mode,
      CASE WHEN image_mime IS NOT NULL THEN '/api/packages/'||id||'/image?v='||xmin::text ELSE image END AS image
      FROM packages WHERE store_id=$1 AND ($2::uuid IS NULL OR (active AND currency=(SELECT currency FROM clients WHERE id=$2))) ORDER BY amount,name`,[storeId,clientId]);
  const credits=await loadCredits(db,storeId,clientId??undefined);
  const trail=clientId?{rows:[]}:await db.query("SELECT a.action,a.entity_id,a.details,a.created_at,u.name user_name FROM audit a LEFT JOIN users u ON u.id=a.user_id WHERE a.store_id=$1 AND a.action<>'INICIAR_SESION' ORDER BY a.id DESC LIMIT 20",[storeId]);
  const requests=await db.query(`SELECT r.id,r.client_id,r.package_id,r.purchase_date,r.months,r.mode,r.grace,r.frequency,r.status,r.credit_id,r.note,
      r.created_at,r.resolved_at,r.review_issue,r.quote_snapshot,c.name client_name,
      COALESCE(r.quote_snapshot->>'packageName',p.name) package_name,
      COALESCE(r.quote_snapshot#>>'{schedule,input,amount}',p.amount::text) amount,
      COALESCE(r.quote_snapshot#>>'{schedule,input,currency}',p.currency) currency
      FROM purchase_requests r JOIN clients c ON c.id=r.client_id JOIN packages p ON p.id=r.package_id
      WHERE r.store_id=$1 AND ($2::uuid IS NULL OR r.client_id=$2) ORDER BY (r.status='PENDIENTE') DESC,r.created_at DESC`,[storeId,clientId]);
  // Al invitado no se le entregan datos personales: documento enmascarado, sin teléfono ni dirección.
  const clientRows=actor.readOnly?clients.rows.map(c=>({...c,document:"•".repeat(Math.max(0,String(c.document).length-3))+String(c.document).slice(-3),phone:"",address:""})):clients.rows;
  return {actor,stores:stores.rows,storeId,clients:clientRows,packages:packages.rows,credits,audit:trail.rows,requests:requests.rows};
}
