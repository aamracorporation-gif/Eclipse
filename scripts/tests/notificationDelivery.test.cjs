'use strict';
const test=require('node:test'); const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const ts=require('typescript');
const source=path.resolve(__dirname,'../../supabase/functions/_shared/notificationDelivery.ts');
const output=ts.transpileModule(fs.readFileSync(source,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const loaded=new Module(source,module); loaded.filename=source; loaded.paths=module.paths; loaded._compile(output,source);
const api=loaded.exports;
const id='10000000-0000-4000-8000-000000000001', project='90000000-0000-4000-8000-000000000001';
const make=extra=>({id,notification_id:id,channel:'push',to:'ExponentPushToken['+'fixturetoken'.repeat(2)+']',project_id:project,title:'Private event',body:'PRIVATE CONTENT',category:'purchase',priority:'normal',expires_at:new Date(Date.now()+3600000).toISOString(),attempts:1,...extra});
function environment(extra={}){const values={NOTIFICATIONS_V2_SEND_ENABLED:'true',NOTIFICATIONS_EXPO_PROJECT_ID:project,SUPABASE_URL:'https://stage-fixture.supabase.co',RESEND_API_KEY:'fixture',NOTIFICATIONS_FROM_EMAIL:'Eclipse <test@example.invalid>',...extra};return key=>values[key];}
async function run(delivery,handler,extraEnv={}){
 const calls=[],completed=[];const rpc=async(name,args)=>{calls.push({name,args});let data;
 if(name==='prepare_notifications_v2')data={prepared:1};
 else if(name==='claim_notification_deliveries_v2')data=[{id,lease_token:id}];
 else if(name==='authorize_notification_delivery_v2')data=delivery;
 else if(name==='complete_notification_delivery_v2'){completed.push(args);data=true;}
 else if(name==='notification_receipts_v2')data=[];
 else throw Error(name);return {data,error:null};};
 const result=await api.runNotificationDispatch(rpc,environment(extraEnv),handler);return {calls,completed,result};
}
const json=(obj,status=200)=>new Response(JSON.stringify(obj),{status,headers:{'Content-Type':'application/json'}});
test('worker requires exact service bearer credential',()=>{assert.equal(api.authorizedNotificationWorker('Bearer fixture','fixture'),true);for(const h of [null,'fixture','Bearer other','Bearer fixture '])assert.equal(api.authorizedNotificationWorker(h,'fixture'),false);assert.equal(api.authorizedNotificationWorker('Bearer ',''),false);});
test('push shows the authorized title and body while navigation includes only IDs',()=>{
 const p=api.notificationPush(make({title:'Tus entradas están confirmadas',body:'Tu compra para Noche Eclipse está confirmada.',qr:'secret-qr',buyer_email:'private@example.invalid'}), 'stage-fixture');
 assert.equal(p.title,'Tus entradas están confirmadas');assert.equal(p.body,'Tu compra para Noche Eclipse está confirmada.');
 assert.deepEqual(Object.keys(p.data).sort(),['notification_id','notification_schema','project_ref']);
 assert.ok(!JSON.stringify(p).includes('secret-qr')&&!JSON.stringify(p).includes('private@example.invalid'));
 assert.equal(p.channelId,'eclipse-activity');assert.ok(p.ttl>0&&p.ttl<=3600);
});
test('push previews normalize whitespace and truncate long copy without broken Unicode',()=>{
 const p=api.notificationPush(make({title:'  Cambio\n en tu evento  ',body:'🎉 Música electrónica '.repeat(30)}),'stage-fixture');
 assert.equal(p.title,'Cambio en tu evento');assert.ok(Array.from(p.body).length<=160);assert.ok(p.body.endsWith('…'));assert.ok(!p.body.includes('\uFFFD'));
 assert.ok(Array.from(api.notificationPush(make({title:'🎉'.repeat(100)}),'s').title).length<=80);
});
test('blank preview body falls back to its informative title',()=>{
 assert.equal(api.notificationPush(make({title:'Asignación retirada',body:'  \n '}),'s').body,'Asignación retirada');
 const p=api.notificationPush(make({title:' ',body:''}),'s');assert.equal(p.title,'Eclipse');assert.ok(p.body.length>0);
});
test('reminders have their own Android channel',()=>assert.equal(api.notificationPush(make({category:'reminder'}),'s').channelId,'eclipse-reminders'));
test('email text is escaped and no untrusted href is used',()=>{const h=api.notificationEmail({title:'<script>alert(1)</script>',body:'<a href="javascript:x">click</a>&'});assert.ok(h.includes('&lt;script&gt;'));assert.ok(!h.includes('<script>')&&!h.includes('<a href='));assert.ok(h.includes('&amp;'));});
test('disabled deployment still prepares inbox, but makes no network request or claim',async()=>{const r=await run(make(),()=>{throw Error('NETWORK MUST NOT RUN');},{NOTIFICATIONS_V2_SEND_ENABLED:'false'});assert.equal(r.calls.length,1);assert.equal(r.result.dispatch,'disabled');});
test('absence of deployment flag is fail-closed',async()=>{const r=await run(make(),()=>{throw Error('NETWORK MUST NOT RUN');},{NOTIFICATIONS_V2_SEND_ENABLED:undefined});assert.equal(r.result.processed,0);});
test('Expo receives informative copy and acceptance preserves receipt ID',async()=>{let payload;const d=make({title:'Cambio importante en tu evento',body:'Noche Eclipse: ha cambiado el horario.'});const r=await run(d,async(url,opts)=>{payload=JSON.parse(opts.body);return json({data:{status:'ok',id:'test-receipt'}})});assert.equal(payload.title,d.title);assert.equal(payload.body,d.body);assert.equal(r.completed[0].p_outcome,'accepted');assert.equal(r.completed[0].p_provider_id,'test-receipt');});
test('expired job never reaches a provider',async()=>{let n=0;const r=await run(make({expires_at:'2020-01-01T00:00:00Z'}),async()=>{n++;return json({});});assert.equal(n,0);assert.equal(r.completed[0].p_code,'EXPIRED');});
test('account-bound authorization checked immediately before send',async()=>{let n=0;const r=await run(null,async()=>{n++;return json({});});assert.equal(n,0);assert.equal(r.completed.length,0);});
test('wrong Expo project is blocked',async()=>{const r=await run(make({project_id:id}),async()=>{throw Error('NETWORK MUST NOT RUN');});assert.equal(r.completed[0].p_code,'EXPO_PROJECT_MISMATCH');});
for(const status of [429,500,503])test('transient provider '+status+' retries',async()=>{const r=await run(make(),async()=>json({},status));assert.equal(r.completed[0].p_outcome,'retry');});
test('network-ambiguous push is not blindly sent again',async()=>{const r=await run(make(),async()=>{throw Error('connection lost');});assert.equal(r.completed[0].p_outcome,'unknown');});
test('unregistered token is marked for deactivation',async()=>{const r=await run(make(),async()=>json({data:{status:'error',details:{error:'DeviceNotRegistered'}}}));assert.equal(r.completed[0].p_outcome,'unregistered');});
test('unknown provider error is sanitized',async()=>{const r=await run(make(),async()=>json({data:{status:'error',message:'DO NOT LOG THIS',details:{error:'secret'}}}));assert.equal(r.completed[0].p_code,'EXPO_REJECTED');assert.ok(!JSON.stringify(r.completed).includes('secret'));});
test('email idempotency key and request are stable on retry',async()=>{const sent=[];const d=make({channel:'email',to:'test@example.invalid'});for(let i=0;i<2;i++)await run(d,async(url,opts)=>{sent.push({url,opts});return json({id:'email-fixture'});});assert.equal(sent[0].opts.headers['Idempotency-Key'],`eclipse-notification/${id}`);assert.equal(sent[0].opts.body,sent[1].opts.body);});
test('email transient network errors may retry with idempotency',async()=>{const r=await run(make({channel:'email',to:'test@example.invalid'}),async()=>{throw Error('network');});assert.equal(r.completed[0].p_outcome,'retry');});
test('missing email config excludes channel from claim',async()=>{const r=await run(null,async()=>json({}),{RESEND_API_KEY:undefined});assert.deepEqual(r.calls.find(c=>c.name==='claim_notification_deliveries_v2').args.p_channels,['push']);});
test('malformed token never sent',async()=>{const r=await run(make({to:'not a token'}),async()=>{throw Error('no');});assert.equal(r.completed[0].p_code,'INVALID_TOKEN');});
test('delayed receipt reconciler uses stable per-delivery identifiers',async()=>{const calls=[];const rpc=async(name,args)=>{calls.push({name,args});return {error:null,data:name==='notification_receipts_v2'?[{id,provider_id:'r1'}]:true};};const n=await api.reconcileNotificationReceipts(rpc,environment(),async()=>json({data:{r1:{status:'ok'}}}));assert.equal(n,1);assert.equal(calls[1].args.p_outcome,'confirmed');assert.equal(calls[1].args.p_provider_id,'r1');});
test('receipt missing is deferred, never reported as delivered',async()=>{let state;const rpc=async(name,args)=>{if(name==='complete_notification_receipt_v2')state=args.p_outcome;return {error:null,data:name==='notification_receipts_v2'?[{id,provider_id:'r1'}]:true};};await api.reconcileNotificationReceipts(rpc,environment(),async()=>json({data:{}}));assert.equal(state,'missing');});
