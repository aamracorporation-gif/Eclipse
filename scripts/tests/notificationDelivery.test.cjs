const {test}=require('node:test');
const assert=require('node:assert/strict');
const ts=require('typescript');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../../supabase/functions/_shared/notificationDelivery.ts'),'utf8');
const exportsObject={};
vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
 {exports:exportsObject,fetch,Request,Response,AbortSignal,Date,Set,URL,console});
const {createNotificationTransport,notificationEmail}=exportsObject;
function fixture(channel='push') {
 const calls=[],network=[];
 const job={id:'job-fixture',lease:'lease-fixture',notification_id:'notification-fixture',channel,recipient:channel==='push'?'ExpoPushToken['+'fixture'.repeat(3)+']':'recipient@example.invalid',
 title:'Compra confirmada',body:'Tu mesa está lista.',type:'order.vip_confirmed',family:'purchase',attempt:1,expires_at:new Date(Date.now()+3600000).toISOString()};
 let result={data:{status:'ok',id:'receipt-fixture'}},status=200,throwNetwork=false,claim=false,prepare=true,pending=[];
 const rpc=async(name,args)=>{calls.push({name,args});return {error:null,data:name==='claim_core_notification_deliveries'?(claim?[{id:job.id,lease_token:job.lease}]:[]):name==='prepare_core_notification_delivery'?(prepare?job:null):name==='list_core_notification_receipts'?pending:true};};
 const send=async(url,options)=>{network.push({url,options});if(throwNetwork) throw Error('secret network details');return new Response(JSON.stringify(result),{status});};
 const config={projectRef:'fixture-staging',resendKey:'fixture-'+'credential',fromEmail:'Eclipse <notice@example.invalid>'};
 const transport=createNotificationTransport(config,rpc,send);
 return {job,calls,network,transport,config,rpc,send,set:o=>{if('result'in o)result=o.result;if('status'in o)status=o.status;if('throwNetwork'in o)throwNetwork=o.throwNetwork;if('claim'in o)claim=o.claim;if('prepare'in o)prepare=o.prepare;if('pending'in o)pending=o.pending;},last:()=>calls[calls.length-1]};
}
test('push records Expo acceptance, not device delivery',async()=>{const f=fixture();await f.transport.deliver(f.job);assert.equal(f.last().args.p_state,'accepted');assert.equal(f.last().args.p_provider_id,'receipt-fixture');});
test('lock-screen payload has no event title, QR, email or raw route',async()=>{const f=fixture();await f.transport.deliver(f.job);const body=JSON.parse(f.network[0].options.body);assert.deepEqual(body.data,{notification_id:'notification-fixture',notification_version:2});assert.equal(body.title,'Eclipse');assert.ok(!JSON.stringify(body).includes(f.job.body));assert.equal(body.collapseId,f.job.id);assert.equal(body.tag,f.job.id);});
test('push network timeout has uncertain outcome and is not blindly retried',async()=>{const f=fixture();f.set({throwNetwork:true});await f.transport.deliver(f.job);assert.equal(f.last().args.p_state,'uncertain');assert.ok(!JSON.stringify(f.calls).includes('secret network'));});
test('email ambiguous network failure retries with a stable idempotency key',async()=>{const f=fixture('email');f.set({throwNetwork:true});await f.transport.deliver(f.job);await f.transport.deliver(f.job);assert.equal(f.last().args.p_state,'pending');assert.equal(f.network[0].options.headers['Idempotency-Key'],f.network[1].options.headers['Idempotency-Key']);});
test('missing email credentials never contacts provider',async()=>{const f=fixture('email');const transport=createNotificationTransport({projectRef:'fixture'},f.rpc,f.send);await transport.deliver(f.job);assert.equal(f.network.length,0);assert.equal(f.last().args.p_code,'email_not_configured');});
test('email acceptance has provider id but is not claimed delivered',async()=>{const f=fixture('email');f.set({result:{id:'email-fixture'}});await f.transport.deliver(f.job);assert.equal(f.last().args.p_state,'accepted');});
test('HTML escapes source text',()=>{const html=notificationEmail('<script>"x"</script>',"<img src='bad'>&");assert.ok(!html.includes('<script>'));assert.ok(!html.includes('<img'));assert.ok(html.includes('&lt;script&gt;'));assert.ok(html.includes('&amp;'));});
for(const [status,state,code] of [[429,'pending','rate_limited'],[400,'failed','provider_rejected'],[401,'failed','provider_credentials'],[503,'uncertain','provider_rejected']]) test(`push HTTP ${status}`,async()=>{const f=fixture();f.set({status,result:{error:'do not log me'}});await f.transport.deliver(f.job);assert.equal(f.last().args.p_state,state);assert.equal(f.last().args.p_code,code);});
for(const [code,state] of [['DeviceNotRegistered','failed'],['MessageRateExceeded','pending'],['InvalidCredentials','failed']]) test(`Expo ${code}`,async()=>{const f=fixture();f.set({result:{data:{status:'error',details:{error:code},message:'sensitive'}}});await f.transport.deliver(f.job);assert.equal(f.last().args.p_state,state);assert.equal(f.last().args.p_code,code);assert.ok(!JSON.stringify(f.calls).includes('sensitive'));});
test('unknown provider error is not exposed',async()=>{const f=fixture();f.set({result:{data:{status:'error',details:{error:'user@example.invalid'}}}});await f.transport.deliver(f.job);assert.equal(f.last().args.p_code,'provider_rejected');});
test('expired jobs are not sent',async()=>{const f=fixture();f.job.expires_at=new Date(0).toISOString();await f.transport.deliver(f.job);assert.equal(f.network.length,0);assert.equal(f.last().args.p_code,'expired');});
test('disabled rollout / no jobs produces no provider call',async()=>{const f=fixture();const result=await f.transport.run();assert.equal(f.network.length,0);assert.equal(result.processed,0);});
test('preflight revoked authorization skips HTTP',async()=>{const f=fixture();f.set({claim:true,prepare:false});const result=await f.transport.run();assert.equal(f.network.length,0);assert.equal(result.skipped,1);});
test('receipt success confirms provider acceptance only',async()=>{const f=fixture();f.set({pending:[{id:f.job.id,provider_id:'receipt-fixture'}],result:{data:{'receipt-fixture':{status:'ok'}}}});await f.transport.receipts();assert.equal(f.last().name,'finish_core_notification_receipt');assert.equal(f.last().args.p_ok,true);});
test('missing receipt remains pending and does not resend',async()=>{const f=fixture();f.set({pending:[{id:f.job.id,provider_id:'receipt-fixture'}],result:{data:{}}});assert.equal(await f.transport.receipts(),0);assert.equal(f.calls.length,1);assert.ok(f.network[0].url.endsWith('getReceipts'));});
test('receipt unregistered error is mapped to specific device invalidation',async()=>{const f=fixture();f.set({pending:[{id:f.job.id,provider_id:'receipt-fixture'}],result:{data:{'receipt-fixture':{status:'error',details:{error:'DeviceNotRegistered'}}}}});await f.transport.receipts();assert.equal(f.last().args.p_code,'DeviceNotRegistered');});
test('email idempotency conflict is terminal, never switched to a fresh key',async()=>{const f=fixture('email');f.set({status:409,result:{message:'conflict'}});await f.transport.deliver(f.job);assert.equal(f.last().args.p_state,'failed');assert.equal(f.last().args.p_code,'idempotency_conflict');});
