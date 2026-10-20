import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../server/db.ts';
import {Auth} from '../server/auth.ts';
import {Service} from '../server/service.ts';
import {TERMS_VERSION} from '../src/domain/model.ts';
import {spaceTabs,pathFor,sectionFor} from '../src/domain/navigation.ts';

test('separate routes cannot turn player navigation into organizer or admin navigation',()=>{
  assert.equal(pathFor('organizer','dashboard'),'/(creator)/dashboard');
  assert.equal(pathFor('player','calendar'),'/(tabs)/agenda');
  assert.equal(sectionFor('player','administracion'),'discover');
  assert.equal(spaceTabs('player',true).some(x=>x.id==='admin'),false);
  assert.equal(spaceTabs('organizer',false).some(x=>x.id==='admin'),false);
});
test('workspaces scope agendas, metrics and participants by authenticated membership',async()=>{
  const db=await openDatabase(':memory:');
  try{
    const auth=new Auth(db),svc=new Service(db);
    const people=[];
    for(const name of ['Admin','Owner','Player','Rival','Stranger','Checker','Referee']){
      people.push((await auth.register({name,email:`${name}@spaces.test`,password:'A long password 123!',adult:true,terms_version:TERMS_VERSION})).user);
    }
    const [admin,owner,player,rival,stranger,checker,referee]=people;
    await db.query("UPDATE rondiqo.profiles SET role='admin' WHERE id=$1",[admin.id]);admin.role='admin';
    const org=(await svc.execute(owner,'organization.create',{name:'Workspace Club',city:'Sevilla'})).id;
    await svc.execute(admin,'admin.verify',{org_id:org,verified:true});
    for(const [person,role] of [[checker,'checkin'],[referee,'referee']] as const)
      await svc.execute(owner,'organization.member',{org_id:org,email:person.email,role});
    const c=(await svc.execute(owner,'competition.create',{org_id:org,title:'Scoped tennis league',sport:'tennis',format:'league',entry_mode:'individual',city:'Sevilla',venue:'Private court',capacity:2,price_cents:1000,level:'open',rules:'Reglas de prueba. Reembolso íntegro antes del inicio.',starts_at:new Date(Date.now()+10*864e5).toISOString(),registration_closes_at:new Date(Date.now()+9*864e5).toISOString()})).id;
    await svc.execute(owner,'competition.publish',{competition_id:c});
    for(const p of [player,rival]){
      const r=await svc.execute(p,'registration.create',{competition_id:c,accept_rules:true,terms_version:TERMS_VERSION});
      await svc.execute(p,'payment.simulate',{registration_id:r.id});
    }
    await svc.execute(owner,'competition.start',{competition_id:c});
    const p=await svc.snapshot(player),s=await svc.snapshot(stranger),o=await svc.snapshot(owner),k=await svc.snapshot(checker);
    assert.equal(p.agenda.length,1);assert.equal(p.organizer,null);
    assert.equal(s.agenda.length,0);assert.equal(s.organizer,null);
    assert.equal((await svc.snapshot(null)).organizer,null);
    assert.equal(o.organizer?.agenda.length,1);
    assert.equal(o.organizer?.metrics[0].amount_cents,2000);
    assert.equal(o.organizer?.registrations.length,2);
    assert.deepEqual(k.organizer?.metrics,[]);
    assert.equal(k.organizer?.registrations[0].amount_cents,undefined);
    assert.equal(k.organizer?.registrations[0].qr_token,undefined);
    const limited=await svc.detail(c,checker);
    assert.equal(limited.canCheckin,true);assert.equal(limited.canManage,false);
    assert.equal(limited.roster[0].payment_intent,undefined);
    assert.equal(limited.roster[0].roster,undefined);
    assert.equal((await svc.detail(c,referee)).canCheckin,false);
    await svc.execute(owner,'organization.member',{org_id:org,email:checker.email,role:'remove'});
    assert.equal((await svc.snapshot(checker)).organizer,null);
  }finally{await db.close();}
});
