import pg, { type PoolClient } from "pg";
pg.types.setTypeParser(1082,(v:string)=>v);
const globalDb=globalThis as unknown as {vidraPool?:pg.Pool};
export const pool=globalDb.vidraPool??new pg.Pool({connectionString:process.env.DATABASE_URL,max:10});
if(process.env.NODE_ENV!=="production") globalDb.vidraPool=pool;
export type DB=Pick<PoolClient,"query">;
export async function transaction<T>(fn:(db:PoolClient)=>Promise<T>):Promise<T> {
  for(let attempt=0;attempt<3;attempt++) {
    const db=await pool.connect();
    try { await db.query("BEGIN ISOLATION LEVEL SERIALIZABLE");const result=await fn(db);await db.query("COMMIT");return result; }
    catch(e) { await db.query("ROLLBACK");if((e as {code?:string}).code!=="40001"||attempt===2) throw e; }
    finally {db.release();}
  }
  throw new Error("Transacción no completada.");
}
