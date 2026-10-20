import test from 'node:test';
import assert from 'node:assert/strict';
import Stripe from 'stripe';
import {openDatabase} from '../server/db.ts';
import {createApp} from '../server/index.ts';
import {Payments} from '../server/payments.ts';
import {TERMS_VERSION} from '../src/domain/model.ts';
test('HTTP auth, cookie flags, origins, malformed bodies, anonymous permissions and logout',async()=>{
  const db=await openDatabase(':memory:');const app=await createApp(db,{origin:'http://127.0.0.1:4173'});
  await new Promise<void>(r=>app.server.listen(0,'127.0.0.1',r));const port=(app.server.address() as any).port,root=`http://127.0.0.1:${port}`;
  const post=(path:string,p:unknown,headers:Record<string,string>={})=>fetch(root+path,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(p)});
  try{
    const blocked=await post('/api/auth/register',{}, {Origin:'https://attacker.invalid'});assert.equal(blocked.status,403);
    assert.equal((await post('/api/command',{action:'admin.verify',input:{}})).status,401);
    const signup=await post('/api/auth/register',{name:'HTTP User',email:'http@example.test',password:'A strong password here',adult:true,terms_version:TERMS_VERSION},{Origin:'http://127.0.0.1:4173'});
    assert.equal(signup.status,200);const cookie=signup.headers.get('set-cookie')!;assert.ok(cookie.includes('HttpOnly'));assert.ok(cookie.includes('SameSite=Strict'));
    const data=await signup.json();assert.ok(!data.token);
    const state=await fetch(root+'/api/state',{headers:{Cookie:cookie}});assert.equal((await state.json()).user.name,'HTTP User');
    const tamper=await post('/api/command',{action:'admin.verify',input:{org_id:'x',verified:true}},{Cookie:cookie});assert.equal(tamper.status,400);
    const wrong=await post('/api/auth/login',{email:'http@example.test',password:'wrong'});assert.equal(wrong.status,401);
    const malformed=await fetch(root+'/api/command',{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie},body:'{'});assert.equal(malformed.status,400);
    const large=await post('/api/command',{padding:'x'.repeat(70000)},{Cookie:cookie});assert.equal(large.status,413);
    await post('/api/auth/logout',{}, {Cookie:cookie});
    assert.equal((await (await fetch(root+'/api/state',{headers:{Cookie:cookie}})).json()).user,null);
  }finally{await new Promise<void>(r=>app.server.close(()=>r()));await db.close();}
});
test('Stripe signature verification rejects tampering and stale signatures without network calls',async()=>{
  const db=await openDatabase(':memory:'),stripe=new Stripe('rk_test_fixture'),wh='whsec_fixture';
  const p=new Payments(db,{origin:'http://localhost',client:stripe,webhookSecret:wh});
  try{
    const raw=JSON.stringify({id:'evt_signature',livemode:false,type:'example',data:{object:{}}});
    const header=stripe.webhooks.generateTestHeaderString({payload:raw,secret:wh});
    assert.equal(p.verify(Buffer.from(raw),header).id,'evt_signature');
    assert.throws(()=>p.verify(Buffer.from(raw+' '),header));
    const stale=stripe.webhooks.generateTestHeaderString({payload:raw,secret:wh,timestamp:Math.floor(Date.now()/1000)-600});
    assert.throws(()=>p.verify(Buffer.from(raw),stale));
    assert.throws(()=>new Payments(db,{origin:'http://localhost',key:'sk_live_forbidden'}),/pruebas/);
  }finally{await db.close();}
});
