if(process.env.RELEASE_MODE&&process.env.RELEASE_MODE!=='local')throw new Error('Demo seed is disabled outside local mode.');
import {openDatabase,one} from '../server/db.ts';
import {Auth} from '../server/auth.ts';
import {Service} from '../server/service.ts';
import {TERMS_VERSION} from '../src/domain/model.ts';
import type {Actor,Row} from '../src/domain/model.ts';
if(process.env.DATABASE_URL)throw new Error('Local demo only.');
const db=await openDatabase(),auth=new Auth(db),svc=new Service(db);
try{
  const owner=await one(db,"SELECT * FROM rondiqo.profiles WHERE email='organiza@rondiqo.test'") as Actor|null;
  const org=owner?await one(db,'SELECT id FROM rondiqo.organizations WHERE owner_id=$1',[owner.id]):null;
  if(!owner||!org)throw new Error('Run the main seed first.');
  if(await one(db,"SELECT id FROM rondiqo.teams WHERE name='Los Siete del Sur'"))console.log('La demo de fútbol 7 ya existe.');
  else{
    const teams:Row[]=[];
    for(let t=0;t<2;t++){
      const players:Actor[]=[];
      for(let n=0;n<7;n++){
        const email=n===0?(t===0?'capitan@rondiqo.test':'rival@rondiqo.test'):`futbol${t}-${n}@rondiqo.test`;
        players.push((await auth.register({name:`${t===0?'Sur':'Norte'} ${n===0?'Capitán':`Jugador ${n}`} · Demo`,email,password:'RondaLocal2026!',adult:true,terms_version:TERMS_VERSION})).user);
      }
      const team=await svc.execute(players[0],'team.create',{name:t===0?'Los Siete del Sur':'Barrio Norte FC',sport:'football7'});
      for(const p of players.slice(1))await svc.execute(p,'team.join',{invite:team.invite});
      teams.push({...team,captain:players[0]});
    }
    const league=await one(db,"SELECT * FROM rondiqo.competitions WHERE sport='football7' AND status='open' ORDER BY created_at LIMIT 1");
    if(league)for(const t of teams){
      const r=await svc.execute(t.captain,'registration.create',{competition_id:league.id,team_id:t.id,accept_rules:true,terms_version:TERMS_VERSION});
      await svc.execute(t.captain,'payment.simulate',{registration_id:r.id});
    }
    const start=new Date(Date.now()+15*86400000);start.setUTCHours(17,0,0,0);
    const cup=await svc.execute(owner,'competition.create',{org_id:org.id,title:'Domingo de siete · Copa demo',sport:'football7',format:'knockout',entry_mode:'team',city:'Sevilla',venue:'Campo RONDIQO · Sede ficticia',capacity:8,price_cents:0,starts_at:start.toISOString(),registration_closes_at:new Date(start.getTime()-86400000).toISOString(),level:'open',description:'Copa de demostración con dos equipos ficticios y siete jugadores por equipo.',rules:'Mayores de 18 años. Dos tiempos de 25 minutos. En empate eliminatorio, penaltis. La inscripción no reserva un campo real ni incluye seguro. Cancelación gratuita antes del comienzo.'});
    await svc.execute(owner,'competition.publish',{competition_id:cup.id});
    for(const t of teams)await svc.execute(t.captain,'registration.create',{competition_id:cup.id,team_id:t.id,accept_rules:true,terms_version:TERMS_VERSION});
    await svc.execute(owner,'competition.start',{competition_id:cup.id});
    console.log('Añadidos 14 jugadores ficticios, 2 equipos completos y una copa de fútbol 7.');
  }
}finally{await db.close();}
