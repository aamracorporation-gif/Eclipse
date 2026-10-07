'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), ts = require('typescript');
function load(relative) { const source = path.resolve(__dirname, relative); const m = new Module(source, module); m.filename = source; m.paths = module.paths; m.require = name => name === './notificationDelivery.ts' ? load('../../supabase/functions/_shared/notificationDelivery.ts') : require(name);
 m._compile(ts.transpileModule(fs.readFileSync(source, 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText, source); return m.exports; }
const worker = load('../../supabase/functions/_shared/notificationWorkerHealth.ts'), health = load('../../lib/notificationHealth.ts');
const project = '90000000-0000-4000-8000-000000000001';
const environment = extra => key => ({NOTIFICATIONS_V2_SEND_ENABLED:'false', NOTIFICATIONS_EXPO_PROJECT_ID:project, SUPABASE_URL:'https://fixture.supabase.co', ...extra})[key];
test('disabled dispatch writes running/disabled heartbeat without network or claim',async()=>{
 const calls=[]; const result=await worker.runNotificationDispatchWithHealth(async(name,args)=>{calls.push({name,args});return{error:null,data:name==='prepare_notifications_v2'?{prepared:0}:null};},environment({}),()=>{throw Error('NO NETWORK');});
 assert.equal(result.dispatch,'disabled');assert.deepEqual(calls.map(c=>c.name),['record_notification_worker_tick_v2','prepare_notifications_v2','record_notification_worker_tick_v2']);
 assert.equal(calls[2].args.p_status,'disabled');assert.equal(calls[2].args.p_processed,0);assert.equal(calls[2].args.p_push_configured,true);assert.equal(calls[2].args.p_email_configured,false);
});
test('heartbeat only stores booleans, not credential values',async()=>{
 const ticks=[]; await worker.runNotificationDispatchWithHealth(async(name,args)=>{if(name.includes('worker_tick'))ticks.push(args);return{error:null,data:{prepared:0}};},environment({RESEND_API_KEY:'PRIVATE_FIXTURE_VALUE',NOTIFICATIONS_FROM_EMAIL:'Eclipse <hidden@example.invalid>'}),()=>{throw Error('NO NETWORK');});
 assert.equal(ticks[0].p_email_configured,true); assert.ok(!JSON.stringify(ticks).includes('PRIVATE_FIXTURE_VALUE')&&!JSON.stringify(ticks).includes('@'));
});
test('failure in preparation is recorded as failed, not successful delivery',async()=>{
 const ticks=[];await assert.rejects(worker.runNotificationDispatchWithHealth(async(name,args)=>{if(name==='prepare_notifications_v2')return{data:null,error:'SIMULATED'};ticks.push(args.p_status);return{data:null,error:null};},environment({})),/prepare_notifications_v2/);
 assert.deepEqual(ticks,['running','failed']);
});
test('failed error heartbeat does not conceal original preparation error',async()=>{
 await assert.rejects(worker.runNotificationDispatchWithHealth(async(name,args)=>name==='prepare_notifications_v2'||args?.p_status==='failed'?{data:null,error:'FAILED'}:{data:null,error:null},environment({})),/prepare_notifications_v2/);
});
test('enabled empty worker reports counts but never fabricates a provider send',async()=>{
 let last;const result=await worker.runNotificationDispatchWithHealth(async(name,args)=>{if(name.includes('worker_tick'))last=args;return{data:name==='prepare_notifications_v2'?{prepared:0}:[],error:null};},environment({NOTIFICATIONS_V2_SEND_ENABLED:'true'}),()=>{throw Error('NO NETWORK');});
 assert.equal(result.processed,0);assert.equal(last.p_status,'processed');assert.equal(last.p_receipts,0);
});
test('malformed provider settings are not labeled configured',async()=>{
 let tick;await worker.runNotificationDispatchWithHealth(async(name,args)=>{if(name.includes('worker_tick'))tick=args;return{data:[],error:null};},environment({NOTIFICATIONS_EXPO_PROJECT_ID:'invalid',RESEND_API_KEY:'fixture',NOTIFICATIONS_FROM_EMAIL:'x\r\ninvalid'}));
 assert.equal(tick.p_push_configured,false);assert.equal(tick.p_email_configured,false);
});
function snapshot(extra={}) {return {checked_at:'2026-10-08T12:00:00Z',capture_enabled:true,operations_enabled:true,live_delivery_enabled:true,allow_all_recipients:false,pilot_recipient_count:1,outbox_pending:0,sales_pending:0,active_installations:1,oldest_due_seconds:null,expired_leases:0,delayed_receipts:0,worker:{last_status:'processed',last_started_at:'2026-10-08T11:59:50Z',last_completed_at:'2026-10-08T11:59:55Z',last_failed_at:null,push_configured:true,email_configured:false},by_channel:[],errors_24h:[],...extra};}
for (const [label,change,expected] of [
 ['closed capture',{capture_enabled:false},'Sistema sin activar'],
 ['closed deliveries',{live_delivery_enabled:false},'Envíos externos desactivados'],
 ['empty pilot',{pilot_recipient_count:0},'Faltan destinatarios de prueba'],
 ['worker never invoked',{worker:{last_status:'never'}},'Sin ejecución registrada'],
 ['worker gate disabled',{worker:{last_status:'disabled'}},'Proceso con envíos desactivados'],
 ['failed worker',{worker:{last_status:'failed'}},'Revisar el proceso de envío'],
 ['stale heartbeat',{worker:{last_status:'processed',last_completed_at:'2026-10-08T11:40:00Z'}},'Revisar planificación y cola'],
 ['expired lease',{expired_leases:1},'Revisar planificación y cola'],
 ['old queue',{oldest_due_seconds:700},'Revisar planificación y cola'],
 ['delayed receipt',{delayed_receipts:2},'Recibos pendientes de comprobar'],
 ['restricted healthy pilot',{},'Piloto restringido'],
 ['all-recipient gate',{allow_all_recipients:true},'Proceso activo'],
]) test(`admin summary: ${label}`,()=>assert.equal(health.notificationHealthSummary(snapshot(change)).title,expected));
test('acceptance, provider confirmation and unknown stay distinct, none say user read',()=>{
 const labels=health.NOTIFICATION_DELIVERY_LABELS; assert.notEqual(labels.accepted,labels.confirmed);assert.notEqual(labels.unknown,labels.failed);assert.ok(!Object.values(labels).some(v=>/le[ií]d|recibid/i.test(v)));
});
