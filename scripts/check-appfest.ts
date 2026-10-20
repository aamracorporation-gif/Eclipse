import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {openDatabase,one} from '../server/db.ts';
import type {Database} from '../server/db.ts';
import {Auth} from '../server/auth.ts';
import {Service} from '../server/service.ts';
import {TERMS_VERSION} from '../src/domain/model.ts';

if(process.env.REMOTE_PROJECT_REF!=='zurbdrfmwjqbrscairub'||!process.env.DATABASE_URL)
  throw new Error('Requires the explicitly approved AppFest destination.');
const db=await openDatabase(':memory:',process.env.DATABASE_URL);
const result:{checkedAt:string;project:string;checks:string[];rolledBack:boolean}={
  checkedAt:new Date().toISOString(),project:'zurbdrfmwjqbrscairub',checks:[],rolledBack:false
};
const rollback=new Error('ROLLBACK_TEST_COMPLETE');
const prefix=`probe-${randomUUID()}`;
try {
  assert.equal((await one(db,'SELECT current_user name'))?.name,'rondiqo_backend');
  result.checks.push('TLS verified; connected with dedicated backend identity');
  assert.equal((await one(db,"SELECT count(*)::int n FROM pg_tables WHERE schemaname='rondiqo' AND rowsecurity"))?.n,17);
  result.checks.push('17 tables with RLS enabled');
  for(const table of ['public.profiles','public.events','public.tickets','auth.users','storage.objects']){
    await assert.rejects(db.query(`SELECT 1 FROM ${table} LIMIT 1`),(e:any)=>e.code==='42501');
  }
  result.checks.push('Eclipse profiles/events/tickets, auth users and storage access rejected');
  try{
    await db.transaction(async tx=>{
      const scoped:Database={query:(sql,p)=>tx.query(sql,p),transaction:fn=>fn(tx),close:async()=>{}};
      const auth=new Auth(scoped),service=new Service(scoped);
      const people=[];
      for(const name of ['admin','organizer','player','opponent','checkin']){
        people.push((await auth.register({name:`Prueba ${name}`,email:`${prefix}-${name}@rondiqo.test`,password:'Temporary integration test!',adult:true,terms_version:TERMS_VERSION})).user);
      }
      const [admin,owner,player,opponent,checkin]=people;
      await tx.query("UPDATE rondiqo.profiles SET role='admin' WHERE id=$1",[admin.id]);admin.role='admin';
      const org=(await service.execute(owner,'organization.create',{name:'Verificación temporal',city:'Sevilla'})).id;
      await service.execute(admin,'admin.verify',{org_id:org,verified:true});
      await service.execute(owner,'organization.member',{org_id:org,email:checkin.email,role:'checkin'});
      const c=(await service.execute(owner,'competition.create',{org_id:org,title:'Verificación temporal',sport:'tennis',format:'league',entry_mode:'individual',city:'Sevilla',venue:'Pista de prueba',capacity:2,price_cents:1200,level:'open',rules:'Prueba temporal. Reembolso íntegro antes del inicio.',starts_at:new Date(Date.now()+20*864e5).toISOString(),registration_closes_at:new Date(Date.now()+19*864e5).toISOString()})).id;
      await service.execute(owner,'competition.publish',{competition_id:c});
      for(const p of [player,opponent]){
        const reg=await service.execute(p,'registration.create',{competition_id:c,accept_rules:true,terms_version:TERMS_VERSION});
        await service.execute(p,'payment.simulate',{registration_id:reg.id});
      }
      await service.execute(owner,'competition.start',{competition_id:c});
      const own=await service.snapshot(owner),p=await service.snapshot(player),access=await service.snapshot(checkin);
      assert.equal(own.organizer?.metrics.find((m:any)=>m.org_id===org)?.amount_cents,2400);
      assert.equal(p.agenda.length,1);assert.equal(p.organizer,null);
      assert.deepEqual(access.organizer?.metrics,[]);
      assert.equal(access.organizer?.registrations[0].amount_cents,undefined);
      const reg=p.registrations[0];
      await service.execute(checkin,'checkin',{competition_id:c,token:`rondiqo:${reg.qr_token}`});
      result.checks.push('Real PostgreSQL transaction: signup, organization, permissions, competition, enrollment, simulated payment, draw, agenda and QR');
      throw rollback;
    });
  }catch(e){if(e!==rollback)throw e;result.rolledBack=true;}
  assert.equal((await one(db,'SELECT count(*)::int n FROM rondiqo.profiles WHERE email LIKE $1',[`${prefix}%`]))?.n,0);
  result.checks.push('Temporary data rolled back; no test profiles retained');
  await writeFile('evidence/appfest-runtime-check.json',JSON.stringify(result,null,2));
  console.log(JSON.stringify(result,null,2));
}finally{await db.close();}
