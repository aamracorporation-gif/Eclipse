import {createHash,randomBytes} from 'node:crypto';
import {isIP} from 'node:net';
import {runtimeConfig} from './config.ts';
import type {ReleaseMode,PaymentMode} from './config.ts';
import {DatabaseRateLimiter} from './rateLimit.ts';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFile, stat, mkdir } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openDatabase } from './db.ts';
import type { Database } from './db.ts';
import { Auth } from './auth.ts';
import { Service } from './service.ts';
import { Payments } from './payments.ts';
import { DomainError, ensure } from '../src/domain/model.ts';
import type { Row } from '../src/domain/model.ts';
import { RateLimiter } from './security.ts';
export async function createApp(db:Database, options:{origin?:string;mode?:string;paymentMode?:PaymentMode;dist?:string;database?:'local'|'appfest';release?:ReleaseMode;proxy?:'none'|'railway'}={}){
  const origin=options.origin || 'http://127.0.0.1:4173',dist=resolve(options.dist || 'dist');
  const release=options.release||'local';
  const authUrl=process.env.RONDIQO_AUTH_URL||process.env.SUPABASE_URL;
  const authKey=process.env.RONDIQO_AUTH_PUBLISHABLE_KEY||process.env.SUPABASE_PUBLISHABLE_KEY;
  const auth=new Auth(db,options.mode || 'local',authUrl,authKey,{allowDemo:release==='local',origin,sessionScope:release});
  const service=new Service(db,options.paymentMode || 'simulated');
  const payments=new Payments(db,{origin,mode:service.paymentMode,liveEnabled:release==='production'&&process.env.ENABLE_LIVE_PAYMENTS==='approved'&&process.env.CONNECT_LIABILITY_ACCEPTED==='approved',key:service.paymentMode!=='simulated'?process.env.STRIPE_RESTRICTED_KEY:undefined,webhookSecret:process.env.STRIPE_WEBHOOK_SECRET,feeBps:Number(process.env.PLATFORM_FEE_BPS || 500)});
  const limiter=release==='local'?new RateLimiter():new DatabaseRateLimiter(db);
  const origins=new Set(release==='local'?[origin,'http://localhost:8081','http://127.0.0.1:8081']:[origin]);
  const cookie=(token:string,expired=false)=>`rondiqo_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${expired?0:43200}${origin.startsWith('https://')?'; Secure':''}`;
  function json(res:ServerResponse,status:number,value:unknown){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(value));}
  async function body(req:IncomingMessage){
    const chunks:Buffer[]=[];let n=0;
    for await(const chunk of req){n+=chunk.length;ensure(n<=65536,'BODY_SIZE','Petición demasiado grande.',413);chunks.push(Buffer.from(chunk));}
    return Buffer.concat(chunks);
  }
  const server=createServer({maxHeaderSize:16384},async(req,res)=>{
    const nonce=randomBytes(18).toString('base64');
    if(origin.startsWith('https://'))res.setHeader('Strict-Transport-Security','max-age=31536000');
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Permissions-Policy','camera=(self), microphone=(), geolocation=()');
    res.setHeader('Content-Security-Policy',`default-src 'self'; script-src 'self' 'nonce-${nonce}'; object-src 'none'; base-uri 'none'; form-action 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' ${origin} ${authUrl || ''}; frame-ancestors 'none'`);
    res.setHeader('Cache-Control','no-store');
    const requestOrigin=req.headers.origin;
    if(requestOrigin && origins.has(requestOrigin)){res.setHeader('Access-Control-Allow-Origin',requestOrigin);res.setHeader('Access-Control-Allow-Credentials','true');res.setHeader('Vary','Origin');}
    try{
      const url=new URL(req.url || '/',origin),path=url.pathname;
      if(req.method==='OPTIONS'){
        ensure(requestOrigin && origins.has(requestOrigin),'ORIGIN','Origen no autorizado.',403);
        res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');res.setHeader('Access-Control-Allow-Headers','Content-Type,Authorization,Idempotency-Key');res.writeHead(204);res.end();return;
      }
      if(!path.startsWith('/api/')){
        ensure(req.method==='GET'||req.method==='HEAD','METHOD','Método no permitido.',405);
        const requested=resolve(dist,'.'+decodeURIComponent(path));
        ensure(requested.startsWith(dist+sep)||requested===dist,'PATH','Ruta no válida.',403);
        let file=requested;
        try{if(!(await stat(file)).isFile())file=resolve(dist,'index.html');}catch{file=resolve(dist,'index.html');}
        try{
          let content=await readFile(file);
          if(extname(file)==='.html')content=Buffer.from(content.toString().replace(/<script(?=[\s>])/gi,`<script nonce="${nonce}"`));
          const mime:Row={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.ttf':'font/ttf','.ico':'image/x-icon','.json':'application/json'};
          res.setHeader('Content-Type',mime[extname(file)] || 'application/octet-stream');res.writeHead(200);res.end(req.method==='HEAD'?undefined:content);
        }catch{json(res,404,{error:'Compila la app con npm run build:web para verla aquí.'});}
        return;
      }
      const forwarded=options.proxy==='railway'?String(req.headers['x-forwarded-for']||'').split(',').at(-1)?.trim():undefined;
      const ip=forwarded&&isIP(forwarded)?forwarded:req.socket.remoteAddress||'unknown';
      ensure(await limiter.allow(ip,240),'RATE_LIMIT','Demasiadas peticiones. Espera un minuto.',429);
      if(path==='/api/health'){
        await db.query('SELECT 1');
        json(res,200,{ok:true,app:'RONDIQO',environment:release,database:options.database||'local',paymentMode:service.paymentMode,authMode:auth.mode});return;
      }
      if(path==='/api/webhook' && req.method==='POST'){
        const raw=await body(req);
        const event=payments.verify(raw,String(req.headers['stripe-signature'] || ''));
        json(res,200,await payments.apply(event));return;
      }
      if(req.method==='POST'){
        ensure(!requestOrigin || origins.has(requestOrigin),'ORIGIN','Origen no autorizado.',403);
        ensure(req.headers['content-type']?.startsWith('application/json'),'CONTENT_TYPE','Se requiere JSON.',415);
        // Browsers send Origin; native clients must present a bearer token after login.
        if(!requestOrigin && req.headers['sec-fetch-site']) ensure(req.headers['sec-fetch-site']==='same-origin','CSRF','Petición no autorizada.',403);
      }
      const token=req.headers.authorization?.replace(/^Bearer /,'') || /(?:^|; )rondiqo_session=([^;]+)/.exec(req.headers.cookie || '')?.[1];
      const actor=await auth.resolve(token);
      let p:Row={};
      if(req.method==='POST'){try{p=JSON.parse((await body(req)).toString()||'{}');}catch(e){if(e instanceof DomainError)throw e;throw new DomainError('JSON','JSON no válido.');}ensure(p && typeof p==='object' && !Array.isArray(p),'JSON','Objeto JSON obligatorio.');}
      if(path==='/api/auth/register'||path==='/api/auth/login'){
        ensure(req.method==='POST','METHOD','Se requiere POST.',405);
        ensure(await limiter.allow(`${ip}:auth`,12,60000),'RATE_LIMIT','Demasiados intentos de acceso. Espera un minuto.',429);
        ensure(await limiter.allow('email:'+createHash('sha256').update(String(p.email).trim().toLowerCase()).digest('hex'),8,60000),'RATE_LIMIT','Demasiados intentos de acceso.',429);
        const result:Row=path.endsWith('register')?await auth.register(p):await auth.login(p.email,p.password,p.profile);
        if(result.verificationRequired){json(res,200,result);return;}
        res.setHeader('Set-Cookie',cookie(result.token));
        json(res,200,requestOrigin?{user:result.user}:result);return;
      }
      if(['/api/auth/forgot-password','/api/auth/reset-password'].includes(path)&&req.method==='POST'){
        ensure(await limiter.allow(ip+':recovery',5,60000),'RATE_LIMIT','Espera antes de volver a solicitar un código.',429);
        ensure(await limiter.allow('recovery:'+createHash('sha256').update(String(p.email).trim().toLowerCase()).digest('hex'),5,60000),'RATE_LIMIT','Demasiados intentos.',429);
        json(res,200,path.endsWith('forgot-password')?await auth.requestReset(p.email):await auth.resetPassword(p));return;
      }
      if(path==='/api/auth/logout' && req.method==='POST'){await auth.logout(token);res.setHeader('Set-Cookie',cookie('',true));json(res,200,{ok:true});return;}
      if(path==='/api/state' && req.method==='GET'){json(res,200,{...await service.snapshot(actor),database:options.database||'local',release,authMode:auth.mode,supportUrl:process.env.PUBLIC_SUPPORT_URL||null});return;}
      const detail=/^\/api\/competitions\/([0-9a-f-]{36})(\/calendar\.ics)?$/.exec(path);
      if(detail && req.method==='GET'){
        if(detail[2]){res.setHeader('Content-Type','text/calendar; charset=utf-8');res.setHeader('Content-Disposition','attachment; filename="rondiqo.ics"');res.end(await service.exportCalendar(detail[1],actor));}
        else json(res,200,await service.detail(detail[1],actor));return;
      }
      ensure(actor,'AUTH','Inicia sesión para continuar.',401);
      if(path==='/api/auth/password'&&req.method==='POST'){
        ensure(await limiter.allow(actor.id+':reauth',5,60000),'RATE_LIMIT','Demasiados intentos.',429);
        json(res,200,await auth.changePassword(actor,p));return;
      }
      if(path==='/api/auth/delete-account'&&req.method==='POST'){
        ensure(await limiter.allow(actor.id+':reauth',5,60000),'RATE_LIMIT','Demasiados intentos.',429);
        const result=await auth.requestDeletion(actor,p.password);res.setHeader('Set-Cookie',cookie('',true));json(res,200,result);return;
      }
      if(path==='/api/command' && req.method==='POST'){
        ensure(typeof p.action==='string' && p.input && typeof p.input==='object' && !Array.isArray(p.input),'VALIDATION','Acción no válida.');
        for(const [k,v] of Object.entries(p.input))if(k.endsWith('_id') || k==='id')ensure(typeof v==='string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v),'VALIDATION',`${k}: identificador no válido.`);
        ensure(await limiter.allow(`${actor.id}:write`,60),'RATE_LIMIT','Demasiadas operaciones.',429);
        json(res,200,await service.execute(actor,p.action,p.input,req.headers['idempotency-key'] as string|undefined));return;
      }
      if(path==='/api/checkout' && req.method==='POST'){json(res,200,await payments.checkout(actor,p.registration_id));return;}
      if(path==='/api/admin/payment-account'&&req.method==='POST'){
        ensure(actor.role==='admin','FORBIDDEN','Solo administración.',403);
        ensure(await limiter.allow(actor.id+':reauth',5,60000),'RATE_LIMIT','Demasiados intentos.',429);
        const verified=await auth.verifyIdentity(String((actor as Row).email),p.password);
        ensure(verified.id===actor.id,'AUTH','Cuenta no válida.',401);
        json(res,200,await payments.linkAccount(actor,p.org_id,p.account_id));return;
      }
      if(path==='/api/reconcile' && req.method==='POST'){ensure(actor.role==='admin','FORBIDDEN','Solo administración.',403);json(res,200,await payments.reconcile());return;}
      throw new DomainError('NOT_FOUND','Ruta no encontrada.',404);
    }catch(e){
      if(e instanceof DomainError){if(e.status===429)res.setHeader('Retry-After','60');json(res,e.status,{error:e.message,code:e.code});}
      else if((e as any).type==='StripeSignatureVerificationError')json(res,400,{error:'Firma de webhook no válida.',code:'SIGNATURE'});
      else{console.error('[RONDIQO]',(e as any)?.code || (e as any)?.name || 'error');json(res,500,{error:'No se ha podido completar la operación.',code:'INTERNAL'});}
    }
  });
  server.headersTimeout=15000;server.requestTimeout=30000;server.keepAliveTimeout=5000;
  return {server,auth,service,payments};
}
export async function main(){
  const config=runtimeConfig();
  if(config.release==='local')await mkdir('data',{recursive:true});
  const db=await openDatabase('data/postgres',process.env.DATABASE_URL);
  await db.query('SELECT 1');
  if(config.release!=='local')await db.query('SELECT bucket FROM rondiqo.rate_limits LIMIT 0');
  if(config.release==='production'){
    const demo=await db.query("SELECT id FROM rondiqo.profiles WHERE email LIKE '%.test' LIMIT 1");
    ensure(!(await db.query('SELECT user_id FROM rondiqo.credentials LIMIT 1')).rows.length,'LOCAL_CREDENTIALS','Retira las credenciales locales antes de producción.');
    ensure(!demo.rows.length,'DEMO_DATA','La base conserva datos ficticios; separa o retira el piloto antes de producción.');
  }
  const app=await createApp(db,{origin:config.origin,mode:config.authMode,paymentMode:config.paymentMode,release:config.release,proxy:config.proxy,
    database:process.env.DATABASE_URL&&process.env.DATABASE_LABEL==='AppFest'?'appfest':'local'});
  app.server.listen(config.port,config.host,()=>console.log(`RONDIQO ${config.release}: ${config.origin}`));
  let working=false;
  const maintenance=setInterval(async()=>{
    if(working)return;working=true;
    try{
      await db.query('DELETE FROM rondiqo.sessions WHERE expires_at<now()');
      if(config.release!=='local')await db.query('DELETE FROM rondiqo.rate_limits WHERE expires_at<now()');
      if(config.paymentMode!=='simulated')await app.payments.reconcile();
    }catch{console.error('[RONDIQO] MAINTENANCE_FAILED');}finally{working=false;}
  },60000);maintenance.unref();
  const stop=()=>{clearInterval(maintenance);app.server.close(async()=>{await db.close();process.exit(0);});setTimeout(()=>process.exit(1),15000).unref();};
  process.on('SIGINT',stop);process.on('SIGTERM',stop);
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await main();
