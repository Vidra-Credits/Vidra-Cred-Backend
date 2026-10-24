import {randomBytes,scryptSync,timingSafeEqual,createHash} from "node:crypto";
import {pool,type DB} from "./db";
import {RuleError} from "./finance";
export type Actor={id:string;storeId:string|null;clientId:string|null;role:"SISTEMA"|"NEGOCIO"|"CLIENTE";name:string;email:string};
export const hashToken=(token:string)=>createHash("sha256").update(token).digest("hex");
export function hashPassword(password:string) {const salt=randomBytes(16).toString("hex");return salt+":"+scryptSync(password,salt,64).toString("hex");}
export function verifyPassword(password:string,hash:string) {
  const [salt,key]=hash.split(":");if(!salt||!key||key.length!==128)return false;
  return timingSafeEqual(Buffer.from(key,"hex"),scryptSync(password,salt,64));
}
export const actorFromRow=(r:Record<string,string>):Actor=>({id:r.id,storeId:r.store_id??null,clientId:r.client_id??null,role:r.role as Actor["role"],name:r.name,email:r.email});
export async function sessionActor(token:string|undefined) {
  if(!token)return null;
  const {rows}=await pool.query("SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id LEFT JOIN stores t ON t.id=u.store_id LEFT JOIN clients c ON c.id=u.client_id WHERE s.token_hash=$1 AND s.expires_at>now() AND u.active AND (u.role='SISTEMA' OR t.active) AND (u.role<>'CLIENTE' OR c.active)",[hashToken(token)]);
  return rows[0]?actorFromRow(rows[0]):null;
}
export function requireRole(actor:Actor,roles:Actor["role"][]) {if(!roles.includes(actor.role))throw new RuleError("No tiene permiso para esta operación.","general",403);}
export function requireStore(actor:Actor,storeId:string) {if(actor.role!=="SISTEMA"&&actor.storeId!==storeId)throw new RuleError("Recurso no disponible.","general",404);}
export async function audit(db:DB,actor:Actor,action:string,entityId:string|null,details:unknown={},storeId:string|null=actor.storeId) {
  await db.query("INSERT INTO audit(user_id,store_id,action,entity_id,details) VALUES($1,$2,$3,$4,$5)",[actor.id,storeId,action,entityId,JSON.stringify(details)]);
}
