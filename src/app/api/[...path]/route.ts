import {NextRequest,NextResponse} from "next/server";
import {randomBytes} from "node:crypto";
import {ZodError} from "zod";
import {pool,transaction} from "@/lib/db";
import {hashToken,sessionActor,verifyPassword,actorFromRow,audit} from "@/lib/security";
import {RuleError} from "@/lib/finance";
import {bootstrap,getQuote,quoteSchema,registerCredit,registerPayment,saveEntity} from "@/lib/service";
export const runtime="nodejs";
export const dynamic="force-dynamic";
async function handle(req:NextRequest,context:{params:Promise<{path:string[]}>}) {
  try {
    const path=(await context.params).path.join("/");
    if(req.method!=="GET") {
      const origin=req.headers.get("origin");
      if(origin&&origin!==req.nextUrl.origin&&origin!==process.env.APP_ORIGIN)throw new RuleError("Origen no permitido.","general",403);
      if(Number(req.headers.get("content-length")??0)>20000)throw new RuleError("Solicitud demasiado grande.","general",413);
    }
    if(path==="auth/login"&&req.method==="POST") {
      const body=await req.json();const email=String(body.email??"").trim().toLowerCase(),password=String(body.password??"");
      if(email.length>120||password.length>128)throw new RuleError("Credenciales inválidas.","general",401);
      const key=hashToken(email),attempt=await pool.query("SELECT attempts,last_attempt FROM login_attempts WHERE key_hash=$1",[key]);
      if(attempt.rows[0]?.attempts>=8&&Date.now()-attempt.rows[0].last_attempt.getTime()<900000)throw new RuleError("Espere 15 minutos antes de volver a intentar.","general",429);
      const result=await pool.query("SELECT u.* FROM users u LEFT JOIN stores s ON s.id=u.store_id LEFT JOIN clients c ON c.id=u.client_id WHERE lower(u.email)=$1 AND u.active AND (u.role='SISTEMA' OR s.active) AND (u.role<>'CLIENTE' OR c.active)",[email]);
      const user=result.rows[0];
      const valid=verifyPassword(password,user?.password_hash??("0".repeat(32)+":"+"0".repeat(128)));
      if(!user||!valid) {
        await pool.query("INSERT INTO login_attempts(key_hash,attempts) VALUES($1,1) ON CONFLICT(key_hash) DO UPDATE SET attempts=CASE WHEN login_attempts.last_attempt<now()-interval '15 minutes' THEN 1 ELSE login_attempts.attempts+1 END,last_attempt=now()",[key]);
        throw new RuleError("Correo o contraseña incorrectos.","general",401);
      }
      const token=randomBytes(32).toString("hex"),actor=actorFromRow(user);
      await transaction(async db=>{
        await db.query("DELETE FROM login_attempts WHERE key_hash=$1",[key]);
        await db.query("DELETE FROM sessions WHERE expires_at<now()");
        await db.query("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '8 hours')",[hashToken(token),user.id]);
        await audit(db,actor,"INICIAR_SESION",user.id);
      });
      const res=NextResponse.json({actor});res.cookies.set("vidra_session",token,{httpOnly:true,sameSite:"strict",secure:req.nextUrl.protocol==="https:",maxAge:28800,path:"/"});return res;
    }
    const actor=await sessionActor(req.cookies.get("vidra_session")?.value);
    if(!actor)throw new RuleError("Inicie sesión para continuar.","general",401);
    if(path==="auth/logout"&&req.method==="POST") {
      await pool.query("DELETE FROM sessions WHERE token_hash=$1",[hashToken(req.cookies.get("vidra_session")!.value)]);
      const res=NextResponse.json({ok:true});res.cookies.delete("vidra_session");return res;
    }
    if(path==="bootstrap"&&req.method==="GET")return NextResponse.json(await bootstrap(actor,req.nextUrl.searchParams.get("storeId")??undefined));
    if(path==="simulate"&&req.method==="POST")return NextResponse.json(await getQuote(pool,actor,quoteSchema.parse(await req.json())));
    if(path==="credits"&&req.method==="POST")return NextResponse.json(await registerCredit(actor,await req.json()),{status:201});
    if(path==="payments"&&req.method==="POST")return NextResponse.json(await registerPayment(actor,await req.json()),{status:201});
    if(["stores","clients","packages"].includes(path)&&req.method==="POST")return NextResponse.json(await saveEntity(actor,path,await req.json()));
    throw new RuleError("Ruta no disponible.","general",404);
  } catch(e) {
    if(e instanceof RuleError)return NextResponse.json({error:e.message,field:e.field},{status:e.status});
    if(e instanceof ZodError)return NextResponse.json({error:e.issues[0]?.message??"Revise los campos.",field:String(e.issues[0]?.path[0]??"general")},{status:422});
    if((e as {code?:string}).code==="23505")return NextResponse.json({error:"Este registro ya existe. Revise documento, correo o pago duplicado.",field:"general"},{status:409});
    if(e instanceof SyntaxError)return NextResponse.json({error:"Solicitud JSON inválida.",field:"general"},{status:400});
    console.error("VidraCred API",e);
    return NextResponse.json({error:"No se pudo completar la operación. Verifique la conexión con la base de datos.",field:"general"},{status:500});
  }
}
export const GET=handle;
export const POST=handle;
