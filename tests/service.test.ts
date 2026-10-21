import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase,one} from '../server/db.ts';
import type {Database} from '../server/db.ts';
import {Auth} from '../server/auth.ts';
import {Service} from '../server/service.ts';
import {Payments} from '../server/payments.ts';
import type {PaymentClient} from '../server/payments.ts';
import {TERMS_VERSION} from '../src/domain/model.ts';
import type {Actor,Row} from '../src/domain/model.ts';
let db:Database,auth:Auth,svc:Service,admin:Actor,owner:Actor,other:Actor,player:Actor,ref:Actor,checkin:Actor,org:string,org2:string;
const future=(days:number)=>new Date(Date.now()+days*86400000).toISOString();
async function user(name:string){return (await auth.register({name,email:`${name.toLowerCase()}@example.test`,password:'A long test password!',adult:true,terms_version:TERMS_VERSION})).user;}
async function competition(extra:Row={}){
  const r=await svc.execute(owner,'competition.create',{org_id:org,title:'Test competition',sport:'tennis',format:'knockout',entry_mode:'individual',city:'Sevilla',venue:'Test court',capacity:4,price_cents:0,starts_at:future(10),registration_closes_at:future(9),level:'open',rules:'Reembolso íntegro antes de inicio. Al mejor de tres sets.',description:'A complete competition for tests.',...extra});
  await svc.execute(owner,'competition.publish',{competition_id:r.id});return r.id;
}
const reg=(a:Actor,c:string,extra:Row={})=>svc.execute(a,'registration.create',{competition_id:c,accept_rules:true,terms_version:TERMS_VERSION,...extra});
test('draft editing enforces organization, version and publication boundary',async()=>{
  const payload={org_id:org,title:'Draft editable',sport:'football7',format:'league',entry_mode:'team',city:'Sevilla',venue:'Demo field',capacity:8,price_cents:1200,starts_at:future(10),registration_closes_at:future(9),level:'open',rules:'Dos tiempos de 25 minutos. Reembolso completo antes del inicio.',description:'Liga de demostración con equipos.'};
  const c=await svc.execute(owner,'competition.create',payload);
  const edit={...payload,competition_id:c.id,version:1,title:'Draft revised',price_cents:1500};
  await assert.rejects(svc.execute(other,'competition.update',edit),/permiso/);
  await assert.rejects(svc.execute(checkin,'competition.update',edit),/permiso/);
  await svc.execute(owner,'competition.update',edit);
  const changed=await one(db,'SELECT * FROM rondiqo.competitions WHERE id=$1',[c.id]);
  assert.equal(changed?.title,'Draft revised');assert.equal(changed?.price_cents,1500);assert.equal(changed?.min_roster,7);assert.equal(changed?.version,2);
  await assert.rejects(svc.execute(owner,'competition.update',edit),/ha cambiado/);
  await assert.rejects(svc.execute(owner,'competition.update',{...edit,version:2,org_id:org2}),/organización/);
  await svc.execute(owner,'competition.publish',{competition_id:c.id});
  await assert.rejects(svc.execute(owner,'competition.update',{...edit,version:2}),/borrador/);
});
before(async()=>{
  db=await openDatabase(':memory:');auth=new Auth(db);svc=new Service(db);
  [admin,owner,other,player,ref,checkin]=await Promise.all(['Admin','Owner','Other','Player','Referee','Checkin'].map(user));
  await db.query("UPDATE rondiqo.profiles SET role='admin' WHERE id=$1",[admin.id]);admin.role='admin';
  org=(await svc.execute(owner,'organization.create',{name:'Test Organization',city:'Sevilla'})).id;
  org2=(await svc.execute(other,'organization.create',{name:'Other Organization',city:'Sevilla'})).id;
  await svc.execute(admin,'admin.verify',{org_id:org,verified:true});
  await svc.execute(owner,'organization.member',{org_id:org,email:'referee@example.test',role:'referee'});
  await svc.execute(owner,'organization.member',{org_id:org,email:'checkin@example.test',role:'checkin'});
});
after(async()=>{await db.close();});
test('users cannot grant themselves admin or publish as a foreign organization',async()=>{
  await svc.execute(player,'profile.update',{name:'Player',city:'Sevilla',level:'beginner',role:'admin'});
  assert.equal((await one(db,'SELECT role FROM rondiqo.profiles WHERE id=$1',[player.id]))?.role,'player');
  await assert.rejects(svc.execute(player,'admin.verify',{org_id:org2,verified:true}),/Solo administración/);
  await assert.rejects(svc.execute(other,'organization.member',{org_id:org,email:'player@example.test',role:'manager'}),/permiso/);
});
test('unverified organizers cannot publish tournaments',async()=>{
  const x=await svc.execute(other,'competition.create',{org_id:org2,title:'Unverified event',sport:'tennis',format:'league',entry_mode:'individual',city:'Sevilla',venue:'Test court',capacity:4,price_cents:0,starts_at:future(10),registration_closes_at:future(9),level:'open',rules:'Pruebas de permiso y reglas de participación completas.'});
  await assert.rejects(svc.execute(other,'competition.publish',{competition_id:x.id}),/verificar/);
  await assert.rejects(svc.detail(x.id,player),/no encontrada/);
});
test('concurrent registrations respect capacity and create a waitlist',async()=>{
  const c=await competition({capacity:2});
  const registrations=await Promise.all([owner,other,player].map(a=>reg(a,c)));
  assert.equal(registrations.filter(r=>r.status==='confirmed').length,2);
  assert.equal(registrations.filter(r=>r.status==='waitlisted').length,1);
  const waiter=registrations[2];
  await assert.rejects(svc.execute(player,'registration.claim',{registration_id:waiter.id}),/no hay plazas/);
  await svc.execute(owner,'registration.cancel',{registration_id:registrations[0].id,reason:'Cancel test'});
  await svc.execute(player,'registration.claim',{registration_id:waiter.id});
  assert.equal((await one(db,'SELECT status FROM rondiqo.registrations WHERE id=$1',[waiter.id]))?.status,'confirmed');
});
test('registration requires rules, is duplicate safe and idempotency cannot change payload',async()=>{
  const c=await competition();
  await assert.rejects(svc.execute(player,'registration.create',{competition_id:c}),/aceptar/);
  const p={competition_id:c,accept_rules:true,terms_version:TERMS_VERSION};
  const a=await svc.execute(player,'registration.create',p,'registration-key-1');
  const b=await svc.execute(player,'registration.create',p,'registration-key-1');assert.equal(a.id,b.id);
  await assert.rejects(reg(player,c),/ya está inscrito/);
  await assert.rejects(svc.execute(player,'registration.create',{...p,accept_rules:false},'registration-key-1'),/otra operación/);
});
test('team membership needs a valid invitation, complete roster and captain',async()=>{
  const t=await svc.execute(player,'team.create',{name:'Pair test',sport:'padel'});
  const c=await competition({sport:'padel',entry_mode:'team'});
  await assert.rejects(reg(player,c,{team_id:t.id}),/al menos 2/);
  await assert.rejects(svc.execute(other,'team.join',{invite:'x'.repeat(43)}),/no válida/);
  await svc.execute(other,'team.join',{invite:t.invite});
  await assert.rejects(reg(other,c,{team_id:t.id}),/capitán/);
  await reg(player,c,{team_id:t.id});
  await assert.rejects(svc.execute(ref,'team.join',{invite:t.invite}),/cerrada/);
  await assert.rejects(svc.execute(other,'team.leave',{team_id:t.id}),/activas/);
});
test('checkin is scoped to organizer and competition, single use, payment required',async()=>{
  const c=await competition({price_cents:2400}),r=await reg(player,c);
  const raw=await one(db,'SELECT qr_token FROM rondiqo.registrations WHERE id=$1',[r.id]);
  await assert.rejects(svc.execute(checkin,'checkin',{competition_id:c,token:`rondiqo:${raw!.qr_token}`}),/no válido/);
  await svc.execute(player,'payment.simulate',{registration_id:r.id});
  await assert.rejects(svc.execute(other,'checkin',{competition_id:c,token:raw!.qr_token}),/permiso/);
  await assert.rejects(svc.execute(ref,'checkin',{competition_id:c,token:raw!.qr_token}),/permiso/);
  await svc.execute(checkin,'checkin',{competition_id:c,token:raw!.qr_token});
  await assert.rejects(svc.execute(checkin,'checkin',{competition_id:c,token:raw!.qr_token}),/utilizado/);
  await svc.execute(player,'registration.cancel',{registration_id:r.id,reason:'Cancel and refund'});
  assert.equal((await one(db,'SELECT status FROM rondiqo.registrations WHERE id=$1',[r.id]))?.status,'refunded');
});
test('QR, payment identifiers, personal roster and emails never leak publicly',async()=>{
  const c=await competition(),r=await reg(player,c);
  const publicData=await svc.detail(c,null),str=JSON.stringify(publicData);
  assert.ok(!str.includes('qr_token'));assert.ok(!str.includes('payment_intent'));assert.ok(!str.includes('player@example.test'));
  assert.deepEqual(publicData.roster,[]);
  const anon=await svc.snapshot(null);assert.deepEqual(anon.registrations,[]);assert.deepEqual(anon.teams,[]);
});
test('knockout byes advance and result confirmation is opponent/staff only',async()=>{
  const c=await competition();
  const regs=await Promise.all([owner,other,player].map(a=>reg(a,c)));
  await svc.execute(owner,'competition.start',{competition_id:c});
  let d=await svc.detail(c,owner);
  assert.equal(d.matches.filter(m=>m.status==='bye').length,1);
  const final=d.matches.find(m=>m.round===2)!;assert.ok(final.home);
  let m=d.matches.find(m=>m.round===1&&m.away)!;
  const h=(await one(db,'SELECT user_id FROM rondiqo.registrations WHERE id=$1',[m.home]))!.user_id;
  const a=(await one(db,'SELECT user_id FROM rondiqo.registrations WHERE id=$1',[m.away]))!.user_id;
  const ha=[owner,other,player].find(x=>x.id===h)!,aa=[owner,other,player].find(x=>x.id===a)!;
  await svc.execute(ha,'match.propose',{match_id:m.id,version:m.version,score:{sets:[[6,4],[6,4]]}});
  await assert.rejects(svc.execute(aa,'match.confirm',{match_id:m.id,version:m.version}),/ha cambiado/);
  m=(await svc.detail(c,ha)).matches.find(x=>x.id===m.id)!;
  if(ha.id!==owner.id)await assert.rejects(svc.execute(ha,'match.confirm',{match_id:m.id,version:m.version}),/confirmar el rival/);
  await svc.execute(aa,'match.dispute',{match_id:m.id,version:m.version,reason:'El resultado no coincide con el acta.'});
  m=(await svc.detail(c,ref)).matches.find(x=>x.id===m.id)!;
  await svc.execute(ref,'match.resolve',{match_id:m.id,version:m.version,score:{sets:[[4,6],[3,6]]},reason:'Acta revisada con ambos participantes.'});
  d=await svc.detail(c,owner);const f=d.matches.find(x=>x.round===2)!;assert.equal(f.away,m.away);
  await svc.execute(ref,'match.propose',{match_id:f.id,version:f.version,score:{sets:[[6,4],[6,4]]}});
  const f2=(await svc.detail(c,ref)).matches.find(x=>x.id===f.id)!;
  await svc.execute(ref,'match.confirm',{match_id:f2.id,version:f2.version});
  assert.equal((await svc.detail(c,owner)).competition.status,'completed');
});
test('pending payment blocks draw generation, expired simulated holds release capacity',async()=>{
  const c=await competition({price_cents:1000,capacity:2}),r=await reg(player,c);
  await reg(other,c);
  await assert.rejects(svc.execute(owner,'competition.start',{competition_id:c}),/reservas/);
  await db.query("UPDATE rondiqo.registrations SET expires_at=now()-interval '1 minute' WHERE id=$1",[r.id]);
  await svc.snapshot(player);
  assert.equal((await one(db,'SELECT status FROM rondiqo.registrations WHERE id=$1',[r.id]))?.status,'expired');
  await assert.rejects(svc.execute(player,'payment.simulate',{registration_id:r.id}),/no admite/);
});
test('schedule changes enforce conflicts and notify participants',async()=>{
  const c=await competition({format:'league'});
  await Promise.all([owner,other,player].map(a=>reg(a,c)));
  await svc.execute(owner,'competition.start',{competition_id:c});
  const d=await svc.detail(c,owner),a=d.matches[0],b=d.matches[1];
  await assert.rejects(svc.execute(owner,'match.schedule',{match_id:b.id,version:b.version,starts_at:new Date(a.starts_at).toISOString(),court:a.court,duration_minutes:60}),/solapa/);
  await assert.rejects(svc.execute(ref,'match.schedule',{match_id:b.id,version:b.version,starts_at:future(14),court:'New court',duration_minutes:60}),/permiso/);
  await svc.execute(owner,'match.schedule',{match_id:b.id,version:b.version,starts_at:future(14),court:'New court',duration_minutes:60});
  assert.ok((await one(db,"SELECT count(*) n FROM rondiqo.notifications WHERE title='Cambio de horario'"))!.n>=1);
});
test('signed Stripe sandbox events are amount-checked and replay-safe; late payments refund',async()=>{
  const c=await competition({price_cents:2400});
  const remote=new Service(db,'stripe_test'),r=await remote.execute(player,'registration.create',{competition_id:c,accept_rules:true,terms_version:TERMS_VERSION});
  const payments=new Payments(db,{origin:'http://localhost:4173'});
  const session={id:'cs_test_one',client_reference_id:r.id,currency:'eur',amount_total:2400,payment_status:'paid',payment_intent:'pi_test_one',metadata:{registration_id:r.id,app:'rondiqo'}};
  const event={id:'evt_test_one',type:'checkout.session.completed',livemode:false,data:{object:session}};
  await assert.rejects(payments.apply({...event,livemode:true}),/reales/);
  await assert.rejects(payments.apply({...event,data:{object:{...session,amount_total:1}}}),/Importe/);
  await payments.apply({...event,id:'evt_unpaid',data:{object:{...session,payment_status:'unpaid'}}});
  assert.equal((await one(db,'SELECT status FROM rondiqo.registrations WHERE id=$1',[r.id]))?.status,'pending');
  await payments.apply(event);assert.deepEqual(await payments.apply(event),{duplicate:true});
  assert.equal((await one(db,'SELECT status FROM rondiqo.registrations WHERE id=$1',[r.id]))?.status,'confirmed');
  await assert.rejects(remote.execute(player,'payment.simulate',{registration_id:r.id}),/desactivados/);
  const r2=await remote.execute(other,'registration.create',{competition_id:c,accept_rules:true,terms_version:TERMS_VERSION});
  await remote.execute(other,'registration.cancel',{registration_id:r2.id,reason:'Cancel before payment'});
  await payments.apply({...event,id:'evt_late',data:{object:{...session,id:'cs_test_two',client_reference_id:r2.id,payment_intent:'pi_test_two',metadata:{registration_id:r2.id,app:'rondiqo'}}}});
  assert.equal((await one(db,'SELECT status FROM rondiqo.registrations WHERE id=$1',[r2.id]))?.status,'refund_pending');
  assert.equal((await one(db,'SELECT status FROM rondiqo.refunds WHERE registration_id=$1',[r2.id]))?.status,'pending');
});
test('RLS and schema grants prevent data access by unprivileged database roles',async()=>{
  await db.query('CREATE ROLE rondiqo_client NOLOGIN');
  await assert.rejects(db.transaction(async tx=>{await tx.query('SET LOCAL ROLE rondiqo_client');await tx.query('SELECT * FROM rondiqo.profiles');}),/permission denied/);
  await db.query('GRANT USAGE ON SCHEMA rondiqo TO rondiqo_client');
  await db.query('GRANT SELECT ON rondiqo.profiles TO rondiqo_client');
  const hidden=await db.transaction(async tx=>{await tx.query('SET LOCAL ROLE rondiqo_client');return tx.query('SELECT * FROM rondiqo.profiles');});
  assert.equal(hidden.rows.length,0);
  await assert.rejects(db.transaction(async tx=>{await tx.query('SET LOCAL ROLE rondiqo_client');await tx.query("UPDATE rondiqo.profiles SET role='admin'");}),/permission denied/);
});
test('suspension invalidates existing local sessions and stored claims are rechecked',async()=>{
  const u=await user('Suspended'),login=await auth.login('suspended@example.test','A long test password!');
  assert.ok(await auth.resolve(login.token));
  await svc.execute(admin,'admin.suspend',{user_id:u.id,suspended:true});
  assert.equal(await auth.resolve(login.token),null);
  await assert.rejects(svc.execute({...u,role:'admin'},'profile.update',{name:'No access',city:'Sevilla',level:'beginner'}),/no disponible/);
});
test('schedules detect the same player across competitions and automatic draws avoid overlap',async()=>{
  const first=await competition({venue:'North',starts_at:future(20)});
  await reg(player,first);await reg(other,first);await svc.execute(owner,'competition.start',{competition_id:first});
  const a=(await svc.detail(first,owner)).matches[0];
  const second=await competition({venue:'South',starts_at:future(20)});
  await reg(player,second);await reg(ref,second);await svc.execute(owner,'competition.start',{competition_id:second});
  const b=(await svc.detail(second,owner)).matches[0];
  assert.ok(Date.parse(b.starts_at)>=Date.parse(a.starts_at)+75*60000);
  await assert.rejects(svc.execute(owner,'match.schedule',{match_id:b.id,version:b.version,starts_at:new Date(a.starts_at).toISOString(),court:'Another venue',duration_minutes:60}),/solapa/);
});
test('refund delivered before payment confirmation never restores a valid QR',async()=>{
  const c=await competition({price_cents:2500}),remote=new Service(db,'stripe_test');
  const r=await remote.execute(player,'registration.create',{competition_id:c,accept_rules:true,terms_version:TERMS_VERSION});
  const payments=new Payments(db,{origin:'http://localhost:4173'});
  const metadata={registration_id:r.id,app:'rondiqo'};
  await payments.apply({id:'evt_refund_first',livemode:false,type:'charge.refunded',data:{object:{payment_intent:'pi_refund_first',metadata,currency:'eur',amount:2500,amount_refunded:2500}}});
  await payments.apply({id:'evt_success_after_refund',livemode:false,type:'checkout.session.completed',data:{object:{id:'cs_refund_first',payment_intent:'pi_refund_first',metadata,client_reference_id:r.id,currency:'eur',amount_total:2500,payment_status:'paid'}}});
  const saved=await one(db,'SELECT * FROM rondiqo.registrations WHERE id=$1',[r.id]);
  assert.equal(saved?.status,'refunded');
  await payments.apply({id:'evt_older_partial',livemode:false,type:'charge.refunded',data:{object:{payment_intent:'pi_refund_first',metadata,currency:'eur',amount:2500,amount_refunded:500}}});
  assert.equal((await one(db,'SELECT status FROM rondiqo.registrations WHERE id=$1',[r.id]))?.status,'refunded','An older partial-refund event cannot downgrade a full refund.');
  await assert.rejects(svc.execute(checkin,'checkin',{competition_id:c,token:saved!.qr_token}),/no válido/);
});

test('refund worker completes only the remaining amount, tracks pending refunds and reuses idempotency',async()=>{
 const c=await competition({price_cents:3500}),remote=new Service(db,'stripe_test');
 const r=await remote.execute(player,'registration.create',{competition_id:c,accept_rules:true,terms_version:TERMS_VERSION});
 const metadata={registration_id:r.id,app:'rondiqo'},payments=new Payments(db,{origin:'https://app.example.com'});
 await payments.apply({id:'evt_partial_worker',livemode:false,type:'charge.refunded',data:{object:{payment_intent:'pi_partial_worker',metadata,currency:'eur',amount:3500,amount_refunded:500}}});
 let creates=0,retrieves=0,status='pending';const calls:any[]=[];
 payments.client={charges:{list:async()=>({data:[{paid:true,status:'succeeded',currency:'eur',amount:3500,amount_refunded:500}]})},refunds:{create:async(p:any,o:any)=>{creates++;calls.push({p,o});return {id:'re_remaining',status};},retrieve:async()=>{retrieves++;return {id:'re_remaining',status};}}} as unknown as PaymentClient;
 await payments.processRefunds();assert.equal(creates,1);assert.equal(calls[0].p.amount,3000);assert.equal(calls[0].p.reverse_transfer,true);assert.equal(calls[0].p.refund_application_fee,true);assert.ok(calls[0].o.idempotencyKey);
 assert.equal((await one(db,'SELECT status FROM rondiqo.registrations WHERE id=$1',[r.id]))?.status,'refund_pending');
 status='succeeded';await payments.processRefunds();assert.equal(creates,1);assert.equal(retrieves,1);
 assert.equal((await one(db,'SELECT status FROM rondiqo.registrations WHERE id=$1',[r.id]))?.status,'refunded');
});

test('abandoned Stripe reservations release capacity; a late successful payment creates a refund',async()=>{
 const c=await competition({price_cents:1700}),remote=new Service(db,'stripe_test');
 const r=await remote.execute(player,'registration.create',{competition_id:c,accept_rules:true,terms_version:TERMS_VERSION});
 await db.query("UPDATE rondiqo.registrations SET expires_at=now()-interval '1 minute' WHERE id=$1",[r.id]);
 await remote.snapshot(player);
 assert.equal((await one(db,'SELECT status FROM rondiqo.registrations WHERE id=$1',[r.id]))?.status,'expired');
 const payments=new Payments(db,{origin:'https://app.example.com'});
 await payments.apply({id:'evt_abandoned_late',livemode:false,type:'checkout.session.completed',data:{object:{id:'cs_abandoned_late',payment_intent:'pi_abandoned_late',client_reference_id:r.id,currency:'eur',amount_total:1700,payment_status:'paid',metadata:{registration_id:r.id,app:'rondiqo'}}}});
 assert.equal((await one(db,'SELECT status FROM rondiqo.registrations WHERE id=$1',[r.id]))?.status,'refund_pending');
});

test('live payment path rejects test events and simulated payment; account linking is admin-only and verified',async()=>{
 const c=await competition({price_cents:1900}),liveService=new Service(db,'stripe_live');
 const r=await liveService.execute(player,'registration.create',{competition_id:c,accept_rules:true,terms_version:TERMS_VERSION});
 assert.throws(()=>new Payments(db,{origin:'https://app.example.com',mode:'stripe_live'}),/explícita/);
 const payments=new Payments(db,{origin:'https://app.example.com',mode:'stripe_live',liveEnabled:true});
 const e={id:'evt_live_fixture',livemode:true,type:'checkout.session.completed',data:{object:{id:'cs_live_fixture',payment_intent:'pi_live_fixture',client_reference_id:r.id,currency:'eur',amount_total:1900,payment_status:'paid',metadata:{registration_id:r.id,app:'rondiqo'}}}};
 await assert.rejects(payments.apply({...e,livemode:false}));await assert.rejects(liveService.execute(player,'payment.simulate',{registration_id:r.id}));
 await payments.apply(e);assert.equal((await one(db,'SELECT status FROM rondiqo.registrations WHERE id=$1',[r.id]))?.status,'confirmed');
 payments.client={accounts:{retrieve:async(id:string)=>({id,charges_enabled:true,payouts_enabled:true})}} as unknown as PaymentClient;
 await assert.rejects(payments.linkAccount({...player,role:'admin'},org2,'acct_fixture'),/administración/);
 await assert.rejects(payments.linkAccount(admin,org2,'acct_fixture'),/Verifica/);
 await svc.execute(admin,'admin.verify',{org_id:org2,verified:true});
 await payments.linkAccount(admin,org2,'acct_fixture');
 assert.equal((await one(db,'SELECT stripe_account FROM rondiqo.organizations WHERE id=$1',[org2]))?.stripe_account,'acct_fixture');
 await assert.rejects(payments.linkAccount(admin,org,'acct_fixture'),/otra organización/);
 await assert.rejects(payments.linkAccount(admin,org,'acct_new'),/inscripciones/);
});
test('football 7 needs seven consenting members and supports drawn league results',async()=>{
  const c=await competition({sport:'football7',format:'league',entry_mode:'team',venue:'Football Test',starts_at:future(30)});
  const captains:Actor[]=[],members:Actor[]=[];
  for(let t=0;t<2;t++){
    const captain=await user(`Football${t}Captain`);captains.push(captain);
    const team=await svc.execute(captain,'team.create',{name:`Football Team ${t}`,sport:'football7'});
    await assert.rejects(reg(captain,c,{team_id:team.id}),/al menos 7/);
    for(let n=1;n<7;n++){const member=await user(`Football${t}Member${n}`);members.push(member);await svc.execute(member,'team.join',{invite:team.invite});}
    await reg(captain,c,{team_id:team.id});
  }
  await svc.execute(owner,'competition.start',{competition_id:c});
  let m=(await svc.detail(c,owner)).matches[0];
  await svc.execute(captains[0],'match.propose',{match_id:m.id,version:m.version,score:{home:2,away:2}});
  m=(await svc.detail(c,owner)).matches[0];
  await svc.execute(captains[1],'match.confirm',{match_id:m.id,version:m.version});
  const detail=await svc.detail(c,owner);
  assert.equal(detail.competition.status,'completed');
  assert.deepEqual(detail.standings.map(r=>r.points),[1,1]);
  for(const member of members){const notices=(await svc.snapshot(member)).notifications;assert.ok(notices.some(n=>n.title==='Calendario disponible'));assert.ok(notices.some(n=>n.title==='Resultado confirmado'));}
  const team=await one(db,'SELECT id FROM rondiqo.teams WHERE captain_id=$1',[captains[0].id]);
  const invite=await svc.execute(captains[0],'team.invite',{team_id:team!.id});
  await svc.execute(player,'team.join',{invite:invite.invite});
  assert.equal(Number((await one(db,'SELECT count(*) n FROM rondiqo.team_members WHERE team_id=$1',[team!.id]))?.n),8);
  const frozen=await one(db,'SELECT roster FROM rondiqo.registrations WHERE team_id=$1 AND competition_id=$2',[team!.id,c]);
  assert.equal(frozen?.roster.length,7,'Completed seasons keep their original roster snapshot.');
});
