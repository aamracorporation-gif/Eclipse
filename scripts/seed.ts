if(process.env.RELEASE_MODE&&process.env.RELEASE_MODE!=='local')throw new Error('Demo seed is disabled outside local mode.');
import { mkdir } from 'node:fs/promises';
import { openDatabase,one } from '../server/db.ts';
import { Auth } from '../server/auth.ts';
import { Service } from '../server/service.ts';
import { TERMS_VERSION } from '../src/domain/model.ts';
import type { Actor,Row } from '../src/domain/model.ts';
if(process.env.DATABASE_URL)throw new Error('Demo seeding is forbidden for remote databases.');
await mkdir('data',{recursive:true});
const db=await openDatabase(),auth=new Auth(db),service=new Service(db);
try{
  if(await one(db,'SELECT id FROM rondiqo.profiles LIMIT 1')){console.log('La base de datos ya contiene usuarios. No se modifica.');}
  else{
    const users:Actor[]=[];
    const accounts=[
      ['Admin Demo','admin@rondiqo.test'],['Club Demo','organiza@rondiqo.test'],['Alex Demo','jugador@rondiqo.test'],
      ['Noa Demo','pareja@rondiqo.test'],['Lola Demo','lola@rondiqo.test'],['Dani Demo','dani@rondiqo.test'],
      ['Cris Demo','cris@rondiqo.test'],['Nico Demo','nico@rondiqo.test'],['Sam Demo','sam@rondiqo.test'],['Vera Demo','vera@rondiqo.test'],
      ['Árbitro Demo','arbitro@rondiqo.test'],['Acceso Demo','acceso@rondiqo.test'],
    ];
    for(const [name,email] of accounts){
      const r=await auth.register({name,email,password:'RondaLocal2026!',adult:true,terms_version:TERMS_VERSION});
      users.push(r.user);
    }
    await db.query("UPDATE rondiqo.profiles SET role='admin' WHERE id=$1",[users[0].id]);users[0].role='admin';
    const org=await service.execute(users[1],'organization.create',{name:'Club RONDIQO · Demo',city:'Sevilla'});
    await service.execute(users[0],'admin.verify',{org_id:org.id,verified:true});
    await service.execute(users[1],'organization.member',{org_id:org.id,email:accounts[10][1],role:'referee'});
    await service.execute(users[1],'organization.member',{org_id:org.id,email:accounts[11][1],role:'checkin'});
    const teams:Row[]=[];
    for(let i=2;i<10;i+=2){
      const t=await service.execute(users[i],'team.create',{name:['Los del Martes','Punto y Seguido','La Otra Pista','Doble Rebote'][(i-2)/2],sport:'padel'});
      await service.execute(users[i+1],'team.join',{invite:t.invite});teams.push({...t,captain:users[i]});
    }
    const starts=new Date(Date.now()+14*86400000);starts.setUTCHours(17,0,0,0);
    const base={org_id:org.id,city:'Sevilla',venue:'Pista de demostración · sin reserva real',level:'intermediate',capacity:8,starts_at:starts.toISOString(),registration_closes_at:new Date(starts.getTime()-86400000).toISOString(),rules:'Solo mayores de 18 años. Mejor de tres sets, tie-break a 6–6. Cancelación con reembolso íntegro antes del comienzo; después, revisión manual. No incluye reserva real de pista ni seguro. Datos ficticios.',description:'Competición de demostración. Las plazas, jugadores y cobros de esta app son ficticios.'};
    const open=await service.execute(users[1],'competition.create',{...base,title:'La primera ronda · Open de pádel',sport:'padel',format:'knockout',entry_mode:'team',price_cents:2400});
    await service.execute(users[1],'competition.publish',{competition_id:open.id});
    for(const t of teams.slice(1,3)){
      const r=await service.execute(t.captain,'registration.create',{competition_id:open.id,team_id:t.id,accept_rules:true,terms_version:TERMS_VERSION});
      await service.execute(t.captain,'payment.simulate',{registration_id:r.id});
    }
    const league=await service.execute(users[1],'competition.create',{...base,title:'Liga del Río · Temporada demo',sport:'padel',format:'league',entry_mode:'team',price_cents:0});
    await service.execute(users[1],'competition.publish',{competition_id:league.id});
    for(const t of teams)await service.execute(t.captain,'registration.create',{competition_id:league.id,team_id:t.id,accept_rules:true,terms_version:TERMS_VERSION});
    await service.execute(users[1],'competition.start',{competition_id:league.id});
    let match=(await service.detail(league.id,users[1])).matches[0];
    await service.execute(users[1],'match.propose',{match_id:match.id,version:match.version,score:{sets:[[6,4],[6,3]]}});
    match=(await service.detail(league.id,users[1])).matches[0];
    await service.execute(users[1],'match.confirm',{match_id:match.id,version:match.version});
    const knockout=await service.execute(users[1],'competition.create',{...base,title:'Copa de parejas · Cuadro demo',sport:'padel',format:'knockout',entry_mode:'team',price_cents:0});
    await service.execute(users[1],'competition.publish',{competition_id:knockout.id});
    for(const t of teams)await service.execute(t.captain,'registration.create',{competition_id:knockout.id,team_id:t.id,accept_rules:true,terms_version:TERMS_VERSION});
    await service.execute(users[1],'competition.start',{competition_id:knockout.id});
    for(const [title,sport,format,entry,price] of [
      ['Siete contra siete · Liga demo','football7','league','team',7000],
      ['Nos vemos en la pista · Desafío','padel','challenge','team',0],
      ['Un set más · Tenis abierto','tennis','knockout','individual',1200],
      ['Media pista, todo el juego · 3×3','basket3x3','knockout','team',1800],
    ]){
      const comp=await service.execute(users[1],'competition.create',{...base,title,sport,format,entry_mode:entry,price_cents:price});
      await service.execute(users[1],'competition.publish',{competition_id:comp.id});
    }
    await db.query('DELETE FROM rondiqo.sessions');
    console.log('Demo creada: 12 cuentas ficticias, 4 parejas y 7 competiciones. Contraseña local: RondaLocal2026!');
  }
}finally{await db.close();}
