import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../server/db.ts';
import {Auth} from '../server/auth.ts';
import {Service} from '../server/service.ts';
import {TERMS_VERSION} from '../src/domain/model.ts';
import {registrationGuide} from '../src/domain/registrationGuide.ts';

test('team ownership, invitations and locked registered rosters remain consistent',async()=>{
 const db=await openDatabase(':memory:');
 try{
  const auth=new Auth(db),svc=new Service(db),people=[];
  for(const name of ['Captain','Mate','Stranger'])people.push((await auth.register({name,email:name+'@teams.test',password:'A safe local password!',adult:true,terms_version:TERMS_VERSION})).user);
  const [captain,mate,stranger]=people;
  const team=await svc.execute(captain,'team.create',{name:'Pareja inicial',sport:'padel'});
  await svc.execute(mate,'team.join',{invite:team.invite});
  await svc.execute(mate,'team.join',{invite:team.invite});
  await assert.rejects(svc.execute(stranger,'team.join',{invite:team.invite}),/dos jugadores/);
  await assert.rejects(svc.execute(mate,'team.update',{team_id:team.id,name:'Intrusión'}),/capitán/);
  await assert.rejects(svc.execute(captain,'team.captain',{team_id:team.id,user_id:stranger.id}),/jugador activo/);
  await svc.execute(captain,'team.update',{team_id:team.id,name:'Pareja renovada'});
  await svc.execute(captain,'team.captain',{team_id:team.id,user_id:mate.id});
  await assert.rejects(svc.execute(captain,'team.invite',{team_id:team.id}),/capitán/);
  await assert.rejects(svc.execute(stranger,'team.join',{invite:team.invite}),/no válida/);
  let snapshot=await svc.snapshot(mate);
  assert.equal(snapshot.teams[0].captain_id,mate.id);assert.equal(snapshot.teams[0].name,'Pareja renovada');
  assert.equal(snapshot.teams[0].roster_locked,false);
  const challenge=await svc.execute(mate,'challenge.create',{title:'Desafío con pareja',sport:'padel',entry_mode:'team',city:'Sevilla',venue:'Pista de prueba',level:'open',starts_at:new Date(Date.now()+10*864e5).toISOString(),registration_closes_at:new Date(Date.now()+9*864e5).toISOString(),rules:'Participación gratuita. Al mejor de tres sets completos.'});
  await svc.execute(mate,'competition.publish',{competition_id:challenge.id});
  const reg=await svc.execute(mate,'registration.create',{competition_id:challenge.id,team_id:team.id,accept_rules:true,terms_version:TERMS_VERSION});
  const memberBefore=await svc.snapshot(captain),memberNotice=memberBefore.notifications.find(n=>n.title==='Inscripción recibida');
  assert.ok(memberNotice,'Every member of the frozen roster receives the registration notice.');
  await svc.execute(stranger,'notification.read',{id:memberNotice.id});
  assert.equal((await svc.snapshot(captain)).notifications.find(n=>n.id===memberNotice.id)?.read_at,null);
  await svc.execute(mate,'notification.read-all',{});
  assert.equal((await svc.snapshot(mate)).notificationUnread,0);
  assert.ok((await svc.snapshot(captain)).notificationUnread>0);
  assert.equal((await svc.snapshot(mate)).teams[0].roster_locked,true);
  for(const action of ['team.update','team.remove','team.captain'])await assert.rejects(svc.execute(mate,action,{team_id:team.id,name:'Otro nombre',user_id:captain.id}),/inscripciones activas/);
  await assert.rejects(svc.execute(captain,'team.leave',{team_id:team.id}),/inscripciones activas/);
  await svc.execute(mate,'registration.cancel',{registration_id:reg.id,reason:'Cancelar para reorganizar la pareja.'});
  const invite=await svc.execute(mate,'team.invite',{team_id:team.id});
  await svc.execute(mate,'team.remove',{team_id:team.id,user_id:captain.id});
  assert.equal((await svc.snapshot(captain)).teams.length,0);
  await assert.rejects(svc.execute(captain,'team.join',{invite:invite.invite}),/no válida/);
  const replacement=await svc.execute(mate,'team.invite',{team_id:team.id});
  await svc.execute(stranger,'team.join',{invite:replacement.invite});
  assert.equal((await svc.snapshot(mate)).teams[0].members.length,2);
 }finally{await db.close();}
});

test('registration guidance directs expired, existing and incomplete entries before payment',()=>{
 const comp={id:'comp',sport:'padel',entry_mode:'team',min_roster:2,status:'open',registration_closes_at:new Date(Date.now()+864e5).toISOString()};
 const user={id:'captain'},team={id:'team',sport:'padel',captain_id:'captain',members:[{id:'captain'}]};
 assert.equal(registrationGuide(comp,null,[],[]).kind,'login');
 assert.equal(registrationGuide(comp,user,[],[]).kind,'team');
 assert.equal(registrationGuide(comp,user,[team],[]).kind,'team');
 const complete={...team,members:[{id:'captain'},{id:'mate'}]};
 assert.equal(registrationGuide(comp,user,[complete],[]).kind,'ready');
 assert.equal(registrationGuide(comp,{id:'mate'},[complete],[]).kind,'team');
 assert.equal(registrationGuide(comp,user,[{...complete,members:[...complete.members,{id:'third'}]}],[]).kind,'team');
 assert.equal(registrationGuide({...comp,registration_closes_at:new Date(0).toISOString()},user,[complete],[]).kind,'closed');
 assert.equal(registrationGuide(comp,user,[complete],[{competition_id:'comp',status:'pending'}]).kind,'existing');
 assert.equal(registrationGuide({...comp,sport:'football7',min_roster:7},user,[{...team,sport:'football7',members:Array.from({length:7},(_,id)=>({id}))}],[]).kind,'ready');
});
