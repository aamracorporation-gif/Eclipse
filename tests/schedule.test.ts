import test from 'node:test';
import assert from 'node:assert/strict';
import {fixtures} from '../src/domain/competition.ts';
import {scheduleOptions,planSchedule} from '../src/domain/schedule.ts';
import {madridParts} from '../src/domain/datetime.ts';
import {openDatabase} from '../server/db.ts';
import {Auth} from '../server/auth.ts';
import {Service} from '../server/service.ts';
import {TERMS_VERSION} from '../src/domain/model.ts';
const comp={sport:'padel',format:'knockout',venue:'Club Test',starts_at:'2026-10-24T18:00:00+02:00'};
const regs=Array.from({length:8},(_,i)=>({id:String(i),roster:['player-'+i],display_name:'Pair '+i}));

test('tournament planner respects daily opening, court capacity, rest and knockout dependencies across DST',()=>{
 const options=scheduleOptions(comp,{courts:2,duration_minutes:75,break_minutes:15,day_start:'09:00',day_end:'20:00'});
 const plan=planSchedule(fixtures(regs.map(r=>r.id),'knockout'),regs,comp,options);
 assert.equal(plan[0].starts_at,plan[1].starts_at);
 assert.notEqual(plan[0].court,plan[1].court);
 assert.equal(madridParts(plan[2].starts_at!).date,'2026-10-25');
 assert.equal(madridParts(plan[2].starts_at!).time,'09:00');
 assert.equal(plan[2].starts_at,'2026-10-25T08:00:00.000Z');
 for(const match of plan){const start=Date.parse(match.starts_at!);assert.ok(madridParts(match.starts_at!).time>='09:00');assert.ok(madridParts(new Date(start+75*60000)).time<='20:00');if(match.round>1){const previous=plan.filter(m=>m.round===match.round-1);assert.ok(start>=Math.max(...previous.map(m=>Date.parse(m.starts_at!)+90*60000)));}}
});

test('weekly leagues keep Madrid wall time, avoid occupied courts and participant conflicts',()=>{
 const league={...comp,format:'league',starts_at:'2026-10-24T18:00:00+02:00'};
 const options=scheduleOptions(league,{courts:2}),pairs=fixtures(regs.slice(0,4).map(r=>r.id),'league');
 const clean=planSchedule(pairs,regs,league,options);
 assert.equal(madridParts(clean[0].starts_at!).time,'18:00');
 assert.equal(madridParts(clean[2].starts_at!).date,'2026-10-31');
 assert.equal(madridParts(clean[2].starts_at!).time,'18:00');
 assert.equal(clean[2].starts_at,'2026-10-31T17:00:00.000Z');
 const blocked=planSchedule(pairs,regs,league,options,[{starts_at:clean[0].starts_at!,duration_minutes:75,court:'Another venue',players:['player-0']}]);
 assert.ok(Date.parse(blocked[0].starts_at!)>=Date.parse(clean[0].starts_at!)+90*60000);
 assert.throws(()=>scheduleOptions(comp,{day_start:'22:00',day_end:'23:00',duration_minutes:90}),/franja diaria/);
 assert.throws(()=>scheduleOptions(comp,{courts:0}),/Pistas/);
 assert.throws(()=>scheduleOptions(comp,{day_start:'02:00'}),/04:00/);
});

test('calendar preview has no publication effects and stale previews cannot close registration',async()=>{
 const db=await openDatabase(':memory:');
 try{
  const auth=new Auth(db),svc=new Service(db),people=[];
  for(const name of ['Owner','First','Second'])people.push((await auth.register({name,email:name+'@schedule.test',password:'A complete local password!',adult:true,terms_version:TERMS_VERSION})).user);
  const [owner,first,second]=people;
  const c=await svc.execute(owner,'challenge.create',{title:'Plan a challenge',sport:'tennis',entry_mode:'individual',city:'Sevilla',venue:'Schedule test court',level:'open',starts_at:new Date(Date.now()+10*864e5).toISOString(),registration_closes_at:new Date(Date.now()+9*864e5).toISOString(),rules:'Al mejor de tres sets. Participación gratuita.'});
  await svc.execute(owner,'competition.publish',{competition_id:c.id});
  for(const player of [first,second])await svc.execute(player,'registration.create',{competition_id:c.id,accept_rules:true,terms_version:TERMS_VERSION});
  await assert.rejects(svc.execute(first,'competition.preview',{competition_id:c.id}),/permiso/);
  const preview=await svc.execute(owner,'competition.preview',{competition_id:c.id,schedule:{courts:2}});
  const before=await svc.detail(c.id,owner);assert.equal(before.competition.status,'open');assert.equal(before.matches.length,0);assert.equal(preview.matches.length,1);
  await assert.rejects(svc.execute(owner,'competition.start',{competition_id:c.id,schedule:{...preview.options,duration_minutes:90},preview_token:preview.preview_token}),/han cambiado/);
  assert.equal((await svc.detail(c.id,owner)).competition.status,'open');
  await svc.execute(owner,'competition.start',{competition_id:c.id,schedule:preview.options,preview_token:preview.preview_token});
  const after=await svc.detail(c.id,owner);assert.equal(after.competition.status,'running');assert.equal(new Date(after.matches[0].starts_at).toISOString(),preview.matches[0].starts_at);assert.equal(after.matches[0].duration_minutes,preview.options.duration_minutes);
  assert.equal(new Date(after.competition.starts_at).toISOString(),preview.matches[0].starts_at);
  assert.ok(new Date(after.competition.registration_closes_at).getTime()<=Date.now());
 }finally{await db.close();}
});
