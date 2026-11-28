import pg, { type PoolClient } from "pg";
pg.types.setTypeParser(1082,(v:string)=>v);
const globalDb=globalThis as unknown as {vidraPool?:pg.Pool};
export const pool=globalDb.vidraPool??new pg.Pool({connectionString:process.env.DATABASE_URL,max:10});
if(process.env.NODE_ENV!=="production") globalDb.vidraPool=pool;
export type DB=Pick<PoolClient,"query">;
const replayConstraints=new Set([
  "purchase_requests_idempotency_key_key","purchase_requests_resolution_key_key","credits_idempotency_key_key",
  "payments_idempotency_key_key","payments_installment_id_key","entity_saves_pkey","users_signup_key_key"
]);
export async function transaction<T>(
  fn:(db:PoolClient)=>Promise<T>, isolation:"SERIALIZABLE"|"READ COMMITTED"="SERIALIZABLE"
):Promise<T> {
  for(let attempt=0;attempt<3;attempt++) {
    const db=await pool.connect();
    try { await db.query(`BEGIN ISOLATION LEVEL ${isolation}`);const result=await fn(db);await db.query("COMMIT");return result; }
    catch(e) {
      await db.query("ROLLBACK");
      const {code,constraint}=e as {code?:string;constraint?:string};
      if(attempt===2||(code!=="40001"&&!(code==="23505"&&constraint&&replayConstraints.has(constraint))))throw e;
    }
    finally {db.release();}
  }
  throw new Error("Transacción no completada.");
}
