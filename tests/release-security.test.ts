import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runtimeConfig} from '../server/config.ts';
import {openDatabase,one} from '../server/db.ts';
import {Auth} from '../server/auth.ts';
import {Service} from '../server/service.ts';
import {RateLimiter} from '../server/security.ts';
import {DatabaseRateLimiter} from '../server/rateLimit.ts';
import {createApp} from '../server/index.ts';
import {TERMS_VERSION} from '../src/domain/model.ts';

test('release gates reject public local server, missing database, HTTP, unapproved live payments and wrong keys',()=>{
 assert.equal(runtimeConfig({}).release,'local');
 assert.throws(()=>runtimeConfig({HOST:'0.0.0.0'}));
 const beta={RELEASE_MODE:'beta',APP_ORIGIN:'https://app.example.com',DATABASE_URL:'configured',REMOTE_PROJECT_REF:'zurbdrfmwjqbrscairub'};
 assert.equal(runtimeConfig(beta).release,'beta');
 for(const bad of [{DATABASE_URL:''},{APP_ORIGIN:'http://app.example.com'},{APP_ORIGIN:'https://app.example.com/path'},{DEMO_ACCESS:'true'},{REMOTE_PROJECT_REF:'wrong'},{TRUST_PROXY:'*'}])assert.throws(()=>runtimeConfig({...beta,...bad}));
 const live={...beta,RELEASE_MODE:'production',AUTH_MODE:'supabase',AUTH_EMAIL_READY:'verified',PUBLIC_LEGAL_URL:'https://app.example.com/legal',PUBLIC_SUPPORT_URL:'https://app.example.com/support',PAYMENT_MODE:'stripe_live',ENABLE_LIVE_PAYMENTS:'approved',CONNECT_LIABILITY_ACCEPTED:'approved',STRIPE_RESTRICTED_KEY:'rk_live_fixture',STRIPE_WEBHOOK_SECRET:'whsec_fixture'};
 assert.equal(runtimeConfig(live).paymentMode,'stripe_live');
 for(const bad of [{ENABLE_LIVE_PAYMENTS:''},{CONNECT_LIABILITY_ACCEPTED:''},{STRIPE_RESTRICTED_KEY:'rk_test_fixture'},{AUTH_EMAIL_READY:''},{PUBLIC_LEGAL_URL:''},{AUTH_MODE:'local'},{PAYMENT_MODE:'simulated'}])assert.throws(()=>runtimeConfig({...live,...bad}));
});

test('password change revokes every session; deletion reauthenticates and cannot be undone by ordinary suspension controls',async()=>{
 const db=await openDatabase(':memory:'),auth=new Auth(db),svc=new Service(db);
 try{
  const first=await auth.register({name:'Account Security',email:'security@example.com',password:'Original password phrase!',adult:true,terms_version:TERMS_VERSION});
  const second=await auth.login('security@example.com','Original password phrase!');
  await assert.rejects(auth.changePassword(first.user,{current_password:'wrong',password:'Replacement password phrase!'}));
  assert.ok(await auth.resolve(first.token));
  await auth.changePassword(first.user,{current_password:'Original password phrase!',password:'Replacement password phrase!'});
  assert.equal(await auth.resolve(first.token),null);assert.equal(await auth.resolve(second.token),null);
  await assert.rejects(auth.login('security@example.com','Original password phrase!'));
  const current=await auth.login('security@example.com','Replacement password phrase!');
  // A local token cannot become a Supabase or beta session during deployment.
  const beta=new Auth(db,'local',undefined,undefined,{allowDemo:false,sessionScope:'beta'});
  const hosted=new Auth(db,'supabase','https://example.supabase.co','public-test-key',{allowDemo:false});
  assert.equal(await beta.resolve(current.token),null);assert.equal(await hosted.resolve(current.token),null);
  await assert.rejects(auth.requestDeletion(current.user,'wrong'));
  assert.equal(await one(db,'SELECT * FROM rondiqo.deletion_requests'),undefined);
  await auth.requestDeletion(current.user,'Replacement password phrase!');
  assert.equal(await auth.resolve(current.token),null);
  assert.equal((await one(db,'SELECT status FROM rondiqo.deletion_requests'))?.status,'pending');
  assert.equal((await one(db,"SELECT action FROM rondiqo.audit WHERE action='account.deletion_requested'"))?.action,'account.deletion_requested');
  const admin=await auth.register({name:'Admin Security',email:'admin-security@example.com',password:'Admin test password phrase!',adult:true,terms_version:TERMS_VERSION});
  await db.query("UPDATE rondiqo.profiles SET role='admin' WHERE id=$1",[admin.user.id]);
  await assert.rejects(svc.execute({...admin.user,role:'admin'},'admin.suspend',{user_id:current.user.id,suspended:false}),/eliminación/);
 }finally{await db.close();}
});

test('Supabase signup requires verified email, ignores privileged metadata and creates isolated clients',async()=>{
 const db=await openDatabase(':memory:'),auth=new Auth(db,'supabase','https://example.supabase.co','public-test-key',{allowDemo:false});
 try{
  assert.notEqual(auth.remote(),auth.remote());
  await assert.rejects(auth.register({email:'demo@example.test'}),/demostración/);
  let verified=false;
  auth.remote=()=>({auth:{signInWithPassword:async()=>({error:null,data:{user:{id:'ab000000-0000-4000-8000-000000000001',email:'verified@example.com',email_confirmed_at:verified?'2026-01-01':null,user_metadata:{role:'admin',rondiqo_name:'Verified Account',rondiqo_adult:true,rondiqo_terms:TERMS_VERSION}}}})}} as any);
  await assert.rejects(auth.login('verified@example.com','password'),/confirmar/);
  verified=true;const session=await auth.login('verified@example.com','password');
  assert.equal(session.user.role,'player');assert.ok(await auth.resolve(session.token));
  auth.remote=()=>({auth:{signInWithPassword:async()=>({error:null,data:{user:{id:'ab000000-0000-4000-8000-000000000002',email:'eclipse@example.com',email_confirmed_at:'2026-01-01',user_metadata:{role:'admin'}}}})}} as any);
  await assert.rejects(auth.login('eclipse@example.com','password'),/condiciones/);
  const migrated=await auth.login('eclipse@example.com','password',{name:'Existing Eclipse Player',adult:true,terms_version:TERMS_VERSION,role:'admin'});
  assert.equal(migrated.user.role,'player');
  let updated=false,signedOut=false;
  auth.remote=()=>({auth:{verifyOtp:async()=>({error:null,data:{user:{id:session.user.id},session:{access_token:'test'}}}),updateUser:async()=>{updated=true;return {error:null};},signOut:async()=>{signedOut=true;return {error:null};}}} as any);
  await auth.resetPassword({email:'verified@example.com',code:'123456',password:'A changed password phrase!'});
  assert.ok(updated&&signedOut);assert.equal(await auth.resolve(session.token),null);
 }finally{await db.close();}
});

test('rate limits hold across server instances and bounded local buckets recover after expiry',async()=>{
 const local=new RateLimiter();for(let i=0;i<10000;i++)assert.ok(local.allow('ip'+i,1,100,0));
 assert.equal(local.allow('new-ip',1,100,50),false);assert.equal(local.allow('new-ip',1,100,100),true);
 assert.equal(local.buckets.size,1);
 const db=await openDatabase(':memory:');try{
  const a=new DatabaseRateLimiter(db),b=new DatabaseRateLimiter(db);
  const attempts=await Promise.all(Array.from({length:20},(_,i)=>(i%2?a:b).allow('192.0.2.1',5,60000,1000)));
  assert.equal(attempts.filter(Boolean).length,5);
  assert.ok(await b.allow('192.0.2.1',5,60000,61000));
  assert.ok(!(await one(db,'SELECT bucket FROM rondiqo.rate_limits'))?.bucket.includes('192.0.2.1'));
 }finally{await db.close();}
});

test('beta serves nonce-protected HTML, secure cookies and rejects local origins and demo logins',async()=>{
 const db=await openDatabase(':memory:'),dist=await mkdtemp(join(tmpdir(),'rondiqo-http-'));
 await writeFile(join(dist,'index.html'),'<html><script>window.test=true;</script></html>');
 const app=await createApp(db,{origin:'https://app.example.com',release:'beta',dist});
 await new Promise<void>(r=>app.server.listen(0,'127.0.0.1',r));const root=`http://127.0.0.1:${(app.server.address() as any).port}`;
 const post=(path:string,p:unknown,origin='https://app.example.com')=>fetch(root+path,{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify(p)});
 try{
  const html=await fetch(root+'/'),source=await html.text(),csp=html.headers.get('content-security-policy')!;
  const nonce=/nonce="([^"]+)"/.exec(source)![1];assert.ok(csp.includes(`'nonce-${nonce}'`));assert.ok(!csp.split('script-src')[1].split(';')[0].includes('unsafe-inline'));
  assert.equal(html.headers.get('strict-transport-security'),'max-age=31536000');
  assert.notEqual((await fetch(root+'/')).headers.get('content-security-policy'),csp);
  assert.equal((await post('/api/auth/login',{},'http://localhost:8081')).status,403);
  assert.equal((await post('/api/auth/login',{email:'demo@example.test',password:'bad'})).status,403);
  const signup=await post('/api/auth/register',{name:'Beta User',email:'beta@example.com',password:'A beta password phrase!',adult:true,terms_version:TERMS_VERSION});
  assert.equal(signup.status,200);assert.ok(signup.headers.get('set-cookie')?.includes('; Secure'));
  assert.ok(!(await signup.json()).token);
  assert.equal((await (await fetch(root+'/api/health')).json()).environment,'beta');
 }finally{await new Promise<void>(r=>app.server.close(()=>r()));await db.close();await rm(dist,{recursive:true,force:true});}
});
