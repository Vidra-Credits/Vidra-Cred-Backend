import {NextRequest,NextResponse} from "next/server";
import {randomBytes} from "node:crypto";
import {ZodError} from "zod";
import {pool,transaction} from "@/lib/db";
import {hashToken,sessionActor,verifyPassword,actorFromRow,audit,GUEST_EMAIL} from "@/lib/security";
import {RuleError,today} from "@/lib/finance";
import {cancelRequest,createRequest,previewRequest,publicStores,registerClient,resolveRequest} from "@/lib/selfservice";
import {bootstrap,getProductImage,getQuote,quoteSchema,registerCredit,registerPayment,saveEntity} from "@/lib/service";
import {MAX_IMAGE_BYTES} from "@/lib/product-image";

async function readProductForm(req:NextRequest,limit:number) {
  const chunks:Uint8Array[]=[];
  let size=0;
  const reader=req.body?.getReader();
  if(!reader)throw new RuleError("Envíe los datos del producto.","image",400);
  try {
    for(;;) {
      const {value,done}=await reader.read();
      if(done)break;
      size+=value.byteLength;
      if(size>limit) {
        void reader.cancel().catch(()=>{});
        throw new RuleError("Suba una imagen de hasta 1 MB.","image",413);
      }
      chunks.push(value);
    }
  } finally {reader.releaseLock();}
  let form:FormData;
  try {
    form=await new Response(new Uint8Array(Buffer.concat(chunks)),{headers:{"Content-Type":req.headers.get("content-type")!}}).formData();
  } catch {throw new RuleError("La imagen no pudo leerse.","image",400);}
  const payload=form.get("payload"),file=form.get("image");
  if(typeof payload!=="string"||form.getAll("payload").length!==1||form.getAll("image").length!==1||!(file instanceof File))
    throw new RuleError("Adjunte una imagen y los datos del producto.","image",400);
  return {payload:JSON.parse(payload) as unknown,file};
}
async function openSession(actor:ReturnType<typeof actorFromRow>,req:NextRequest,key?:string,status=200,hours=8) {
  const token=randomBytes(32).toString("hex");
  await transaction(async db=>{
    if(key)await db.query("DELETE FROM login_attempts WHERE key_hash=$1",[key]);
    await db.query("DELETE FROM sessions WHERE expires_at<now()");
    await db.query("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+make_interval(hours=>$3))",[hashToken(token),actor.id,hours]);
    if(!actor.readOnly)await audit(db,actor,"INICIAR_SESION",actor.id);
  }, "READ COMMITTED");
  const res=NextResponse.json({actor},{status});res.cookies.set("vidra_session",token,{httpOnly:true,sameSite:"strict",secure:req.nextUrl.protocol==="https:",maxAge:hours*3600,path:"/"});return res;
}
export const runtime="nodejs";
export const dynamic="force-dynamic";
async function handle(req:NextRequest,context:{params:Promise<{path:string[]}>}) {
  try {
    const segments=(await context.params).path,path=segments.join("/");
    const upload=path==="packages"&&req.method==="POST"&&/^multipart\/form-data\b/i.test(req.headers.get("content-type")??"");
    const limit=upload?MAX_IMAGE_BYTES+20000:20000;
    if(req.method!=="GET") {
      const origin=req.headers.get("origin");
      const host=req.headers.get("host");
      const incoming=host?req.nextUrl.protocol+"//"+host:null;
      if(origin&&origin!==incoming&&origin!==req.nextUrl.origin&&origin!==process.env.APP_ORIGIN)throw new RuleError("Origen no permitido.","general",403);
      if(Number(req.headers.get("content-length")??0)>limit)throw new RuleError(upload?"Suba una imagen de hasta 1 MB.":"Solicitud demasiado grande.",upload?"image":"general",413);
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
      return await openSession(actorFromRow(user),req,key);
    }
    if(path==="public/stores"&&req.method==="GET")return NextResponse.json(await publicStores());
    // En la demostración pública (PUBLIC_DEMO=1) no hay registro abierto ni se anuncian cuentas de ejemplo.
    if(path==="public/config"&&req.method==="GET") {
      const guest=await pool.query("SELECT 1 FROM users u JOIN stores s ON s.id=u.store_id WHERE lower(u.email)=$1 AND u.read_only AND u.active AND s.active",[GUEST_EMAIL]);
      return NextResponse.json({guest:process.env.PUBLIC_DEMO==="1"&&Boolean(guest.rowCount),registration:process.env.PUBLIC_DEMO!=="1",demoAccounts:process.env.PUBLIC_DEMO!=="1"});
    }
    if(path==="auth/guest"&&req.method==="POST") {
      if(process.env.PUBLIC_DEMO!=="1")throw new RuleError("La instalación del curso requiere usuario y contraseña.","general",404);
      const key=hashToken("guest:"+(req.headers.get("x-forwarded-for")??"local")),attempt=await pool.query("SELECT attempts,last_attempt FROM login_attempts WHERE key_hash=$1",[key]);
      if(attempt.rows[0]?.attempts>=120&&Date.now()-attempt.rows[0].last_attempt.getTime()<900000)throw new RuleError("Demasiados accesos de invitado desde este equipo. Espere 15 minutos.","general",429);
      await pool.query("INSERT INTO login_attempts(key_hash,attempts) VALUES($1,1) ON CONFLICT(key_hash) DO UPDATE SET attempts=CASE WHEN login_attempts.last_attempt<now()-interval '15 minutes' THEN 1 ELSE login_attempts.attempts+1 END,last_attempt=now()",[key]);
      const guest=await pool.query("SELECT u.* FROM users u JOIN stores s ON s.id=u.store_id WHERE lower(u.email)=$1 AND u.read_only AND u.active AND s.active",[GUEST_EMAIL]);
      if(!guest.rows[0])throw new RuleError("El modo invitado no está disponible en esta instalación.","general",404);
      return await openSession(actorFromRow(guest.rows[0]),req,undefined,200,2);
    }
    if(path==="auth/register"&&req.method==="POST") {
      if(process.env.PUBLIC_DEMO==="1")throw new RuleError("El registro está desactivado en la demostración pública. Use «Entrar como invitado».","general",403);
      const key=hashToken("register:"+(req.headers.get("x-forwarded-for")??"local")),attempt=await pool.query("SELECT attempts,last_attempt FROM login_attempts WHERE key_hash=$1",[key]);
      if(attempt.rows[0]?.attempts>=30&&Date.now()-attempt.rows[0].last_attempt.getTime()<900000)throw new RuleError("Demasiados registros desde este equipo. Espere 15 minutos.","general",429);
      await pool.query("INSERT INTO login_attempts(key_hash,attempts) VALUES($1,1) ON CONFLICT(key_hash) DO UPDATE SET attempts=CASE WHEN login_attempts.last_attempt<now()-interval '15 minutes' THEN 1 ELSE login_attempts.attempts+1 END,last_attempt=now()",[key]);
      const actor=await registerClient(await req.json());
      return await openSession(actor,req,undefined,201);
    }
    const actor=await sessionActor(req.cookies.get("vidra_session")?.value);
    if(!actor)throw new RuleError("Inicie sesión para continuar.","general",401);
    // Invitado: solo consulta. Cotizar (no escribe) y cerrar sesión son las únicas operaciones POST permitidas.
    if(actor.readOnly&&req.method!=="GET"&&path!=="simulate"&&path!=="auth/logout")throw new RuleError("Modo invitado: puede explorar y simular, pero no guardar cambios.","general",403);
    if(path==="auth/logout"&&req.method==="POST") {
      await pool.query("DELETE FROM sessions WHERE token_hash=$1",[hashToken(req.cookies.get("vidra_session")!.value)]);
      const res=NextResponse.json({ok:true});res.cookies.delete("vidra_session");return res;
    }
    if(path==="bootstrap"&&req.method==="GET")return NextResponse.json(await bootstrap(actor,req.nextUrl.searchParams.get("storeId")??undefined));
    if(segments.length===3&&segments[0]==="packages"&&segments[2]==="image"&&req.method==="GET") {
      const photo=await getProductImage(actor,segments[1]);
      return new NextResponse(new Uint8Array(photo.data),{headers:{
        "Content-Type":photo.mime,"Content-Length":String(photo.data.byteLength),
        "Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"
      }});
    }
    if(path==="simulate"&&req.method==="POST") {
      const body=await req.json();
      // El cliente solo cotiza para sí mismo y con la fecha de hoy.
      const input=quoteSchema.parse(actor.role==="CLIENTE"?{...body,storeId:actor.storeId,clientId:actor.clientId,purchaseDate:today(),frequency:"MENSUAL",rateSteps:[]}:body);
      return NextResponse.json(await getQuote(pool,actor,input));
    }
    if(path==="requests"&&req.method==="POST")return NextResponse.json(await createRequest(actor,await req.json()),{status:201});
    if(segments.length===3&&segments[0]==="requests"&&segments[2]==="preview"&&req.method==="GET")
      return NextResponse.json(await previewRequest(actor,segments[1]));
    if(path==="requests/cancel"&&req.method==="POST")return NextResponse.json(await cancelRequest(actor,await req.json()));
    if(path==="requests/resolve"&&req.method==="POST")return NextResponse.json(await resolveRequest(actor,await req.json()));
    if(path==="credits"&&req.method==="POST")return NextResponse.json(await registerCredit(actor,await req.json()),{status:201});
    if(path==="payments"&&req.method==="POST")return NextResponse.json(await registerPayment(actor,await req.json()),{status:201});
    if(["stores","clients","packages"].includes(path)&&req.method==="POST") {
      const key=req.headers.get("idempotency-key");
      if(upload) {
        if(actor.role==="CLIENTE")throw new RuleError("No tiene permiso para esta operación.","general",403);
        const {payload,file}=await readProductForm(req,limit);
        return NextResponse.json(await saveEntity(actor,path,payload,file,key));
      }
      return NextResponse.json(await saveEntity(actor,path,await req.json(),undefined,key));
    }
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
