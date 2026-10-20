import {createClient} from '@supabase/supabase-js';
import type {Database} from './db.ts';
import {one} from './db.ts';
import {randomUUID} from 'node:crypto';
import {ensure,text,TERMS_VERSION} from '../src/domain/model.ts';
import type {Row,Actor} from '../src/domain/model.ts';
import {secret,hash,passwordHash,verifyPassword} from './security.ts';
const publicProfile=(r:Row):Actor&Row=>({id:r.id,name:r.name,role:r.role,city:r.city,level:r.level,email:r.email,marketing_opt_in:r.marketing_opt_in,suspended:r.suspended});
export class Auth{
 db:Database;mode:string;url?:string;key?:string;allowDemo:boolean;origin:string;sessionScope:string;
 constructor(db:Database,mode='local',url?:string,key?:string,options:{allowDemo?:boolean;origin?:string;sessionScope?:string}={}){
  this.db=db;this.mode=mode;this.url=url;this.key=key;this.allowDemo=options.allowDemo??true;this.origin=options.origin||'http://127.0.0.1:4173';this.sessionScope=options.sessionScope||'local';
  ensure(['local','supabase'].includes(mode),'CONFIG','Modo de autenticación no válido.');
  if(mode==='supabase')ensure(url&&key,'CONFIG','Falta configurar Supabase Auth.');
 }
 // A new client for every operation prevents sessions crossing between concurrent users.
 remote(){ensure(this.mode==='supabase'&&this.url&&this.key,'AUTH_MODE','Recuperación por email aún no configurada.',503);return createClient(this.url,this.key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});}
 email(value:unknown){const email=text(value,'Email',5,254).toLowerCase().trim();ensure(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),'EMAIL','Email no válido.');ensure(this.allowDemo||!email.endsWith('.test'),'DEMO_DISABLED','Las cuentas de demostración solo funcionan en la versión local.',403);return email;}
 async register(p:Row):Promise<Row>{
  const email=this.email(p.email);
  ensure(p.adult===true&&p.terms_version===TERMS_VERSION,'CONSENT','Se requiere mayoría de edad y aceptación de condiciones.');
  const name=text(p.name,'Nombre',2,60),pw=await passwordHash(p.password);
  if(this.mode==='supabase'){
   const {error}=await this.remote().auth.signUp({email,password:p.password,options:{data:{rondiqo_name:name,rondiqo_adult:true,rondiqo_terms:TERMS_VERSION},emailRedirectTo:this.origin+'/login'}});
   ensure(!error,'REGISTER','No se ha podido crear la cuenta. Comprueba tus datos o recupera el acceso.',400);
   return {verificationRequired:true,message:'Revisa tu correo, confirma la cuenta y después inicia sesión.'};
  }
  const userId=randomUUID();
  await this.db.transaction(async db=>{
   ensure(!await one(db,'SELECT id FROM rondiqo.profiles WHERE email=$1',[email]),'ACCOUNT','No se puede crear esta cuenta. Prueba a iniciar sesión.',409);
   await db.query('INSERT INTO rondiqo.profiles(id,email,name,adult_attested,terms_version,marketing_opt_in) VALUES($1,$2,$3,true,$4,$5)',[userId,email,name,TERMS_VERSION,p.marketing_opt_in===true]);
   await db.query('INSERT INTO rondiqo.credentials(user_id,password_hash) VALUES($1,$2)',[userId,pw]);
  });return this.session(userId);
 }
 async verifyIdentity(email:string,password:string){
  email=this.email(email);
  if(this.mode==='supabase'){
   const {data,error}=await this.remote().auth.signInWithPassword({email,password});
   ensure(!error&&data.user?.email_confirmed_at,'LOGIN','Email o contraseña incorrectos, o correo sin confirmar.',401);
   return data.user;
  }
  const r=await one(this.db,'SELECT p.*,c.password_hash FROM rondiqo.profiles p JOIN rondiqo.credentials c ON c.user_id=p.id WHERE p.email=$1',[email]);
  const valid=await verifyPassword(password,r?.password_hash??'00000000000000000000000000000000:'+ '00'.repeat(64));
  ensure(r&&valid&&!r.suspended,'LOGIN','Email o contraseña incorrectos.',401);
  return r;
 }
 async login(email:string,password:string,consent?:Row){
  const verified=await this.verifyIdentity(email,password);
  if(this.mode==='supabase'){
   const meta=consent?.adult===true&&consent?.terms_version===TERMS_VERSION?{rondiqo_adult:true,rondiqo_terms:TERMS_VERSION,rondiqo_name:consent.name}:verified.user_metadata||{};
   const existing=await one(this.db,'SELECT * FROM rondiqo.profiles WHERE id=$1',[verified.id]);
   if(!existing){
    ensure(meta.rondiqo_adult===true&&meta.rondiqo_terms===TERMS_VERSION,'CONSENT','Crea primero tu perfil de RONDIQO y acepta sus condiciones.',403);
    await this.db.query('INSERT INTO rondiqo.profiles(id,email,name,adult_attested,terms_version) VALUES($1,$2,$3,true,$4) ON CONFLICT(id) DO NOTHING',[verified.id,verified.email,text(meta.rondiqo_name,'Nombre',2,60),TERMS_VERSION]);
   }
  }
  return this.session(verified.id);
 }
 async session(userId:string){
  const r=await one(this.db,'SELECT * FROM rondiqo.profiles WHERE id=$1',[userId]);
  ensure(r&&!r.suspended,'LOGIN','Cuenta no disponible.',401);this.email(r.email);
  const token=secret();await this.db.query("INSERT INTO rondiqo.sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '12 hours')",[hash(this.sessionScope+':'+this.mode+':'+token),userId]);
  return {token,user:publicProfile(r)};
 }
 async resolve(token?:string):Promise<Actor|null>{
  if(!token||!/^[\w-]{43}$/.test(token))return null;
  const r=await one(this.db,'SELECT p.* FROM rondiqo.sessions s JOIN rondiqo.profiles p ON p.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now() AND NOT p.suspended',[hash(this.sessionScope+':'+this.mode+':'+token)]);
  if(r&&!this.allowDemo&&r.email.endsWith('.test'))return null;
  return r?publicProfile(r):null;
 }
 async requestReset(email:string){
  const normalized=this.email(email);
  const {error}=await this.remote().auth.resetPasswordForEmail(normalized,{redirectTo:this.origin+'/reset-password'});
  // Do not expose existence of a registered email.
  if(error&&error.status&&error.status>=500)ensure(false,'EMAIL_UNAVAILABLE','El correo no está disponible. Inténtalo más tarde.',503);
  return {ok:true,message:'Si la cuenta existe, recibirás un correo para recuperar el acceso.'};
 }
 async resetPassword(p:Row){
  await passwordHash(p.password);
  const email=this.email(p.email),code=text(p.code,'Código',6,12),client=this.remote();
  const {data,error}=await client.auth.verifyOtp({email,token:code,type:'recovery'});
  ensure(!error&&data.user?.id&&data.session,'RESET','Código incorrecto o caducado.',400);
  const changed=await client.auth.updateUser({password:p.password});
  ensure(!changed.error,'RESET','No se ha podido cambiar la contraseña.',400);
  await this.db.query('DELETE FROM rondiqo.sessions WHERE user_id=$1',[data.user.id]);
  await client.auth.signOut({scope:'global'});
  return {ok:true};
 }
 async changePassword(actor:Actor,p:Row){
  const profile=await one(this.db,'SELECT email FROM rondiqo.profiles WHERE id=$1',[actor.id]);ensure(profile,'AUTH','Cuenta no disponible.',401);
  const verified=await this.verifyIdentity(profile.email,p.current_password);ensure(verified.id===actor.id,'AUTH','Cuenta no válida.',401);
  const pw=await passwordHash(p.password);
  if(this.mode==='supabase'){
   const client=this.remote();await client.auth.signInWithPassword({email:profile.email,password:p.current_password});
   const {error}=await client.auth.updateUser({password:p.password});ensure(!error,'PASSWORD','No se pudo cambiar la contraseña.');
   await client.auth.signOut({scope:'global'});
  }else await this.db.query('UPDATE rondiqo.credentials SET password_hash=$1 WHERE user_id=$2',[pw,actor.id]);
  await this.db.query('DELETE FROM rondiqo.sessions WHERE user_id=$1',[actor.id]);return {ok:true};
 }
 async requestDeletion(actor:Actor,password:string){
  const p=await one(this.db,'SELECT email FROM rondiqo.profiles WHERE id=$1',[actor.id]);ensure(p,'AUTH','Cuenta no disponible.',401);
  const verified=await this.verifyIdentity(p.email,password);ensure(verified.id===actor.id,'AUTH','Cuenta no válida.',401);
  await this.db.transaction(async db=>{
   await db.query("INSERT INTO rondiqo.deletion_requests(user_id,status) VALUES($1,'pending') ON CONFLICT(user_id) DO NOTHING",[actor.id]);
   await db.query('UPDATE rondiqo.profiles SET suspended=true,marketing_opt_in=false WHERE id=$1',[actor.id]);
   await db.query('DELETE FROM rondiqo.sessions WHERE user_id=$1',[actor.id]);
   await db.query("INSERT INTO rondiqo.audit(id,actor_id,action,resource_id) VALUES($1,$2,'account.deletion_requested',$3)",[randomUUID(),actor.id,actor.id]);
  });return {ok:true,message:'Solicitud registrada. El acceso queda cerrado. Administración tramitará la eliminación y los pagos o competiciones pendientes.'};
 }
 async logout(token?:string){if(token)await this.db.query('DELETE FROM rondiqo.sessions WHERE token_hash=$1',[hash(this.sessionScope+':'+this.mode+':'+token)]);}
}
