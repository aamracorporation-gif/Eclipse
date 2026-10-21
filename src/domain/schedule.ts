import {ensure,integer,isoDate} from './model.ts';
import type {Row} from './model.ts';
import type {Pair} from './competition.ts';
import {madridParts,madridToIso} from './datetime.ts';

export type ScheduleOptions={starts_at:string;courts:number;duration_minutes:number;break_minutes:number;day_start:string;day_end:string;round_interval_days:number};
export type BusySlot={starts_at:string;duration_minutes:number;court:string;players:string[]};
export type ScheduledPair=Pair&{starts_at:string|null;court:string;duration_minutes:number;status:'bye'|'scheduled';winner:string|null};
const minutes=(value:unknown)=>{ensure(typeof value==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(value),'SCHEDULE','Usa horas en formato HH:MM.');const [h,m]=value.split(':').map(Number);return h*60+m;};
const addDays=(date:string,days:number)=>new Date(Date.parse(date+'T12:00:00Z')+days*864e5).toISOString().slice(0,10);
const key=(court:string)=>court.trim().toLowerCase();

export function scheduleOptions(competition:Row,input:Row={}):ScheduleOptions{
 const requested=input.starts_at??competition.starts_at;
 const result={starts_at:isoDate(requested instanceof Date?requested.toISOString():requested),courts:integer(input.courts??1,'Pistas o campos',1,12),duration_minutes:integer(input.duration_minutes??(competition.sport==='football7'?60:75),'Duración',15,240),break_minutes:integer(input.break_minutes??15,'Descanso',0,60),day_start:input.day_start||'09:00',day_end:input.day_end||'23:00',round_interval_days:integer(input.round_interval_days??(competition.format==='league'?7:0),'Días entre jornadas',0,30)};
 ensure(minutes(result.day_end)-minutes(result.day_start)>=result.duration_minutes,'SCHEDULE','La franja diaria debe permitir al menos un partido completo.');
 // Daytime windows avoid repeated/nonexistent overnight hours at DST transitions.
 ensure(minutes(result.day_start)>=4*60,'SCHEDULE','El inicio de la jornada debe ser a partir de las 04:00.');
 return result;
}

export function planSchedule(pairs:Pair[],registrations:Row[],competition:Row,options:ScheduleOptions,busy:BusySlot[]=[]):ScheduledPair[]{
 const start=Date.parse(options.starts_at),duration=options.duration_minutes*60000,gap=options.break_minutes*60000;
 const first=madridParts(options.starts_at),courtName=(i:number)=>`${competition.venue} · ${competition.sport==='football7'?'Campo':'Pista'} ${i+1}`;
 const courts=Array.from({length:options.courts},()=>start),playersReady=new Map<string,number>(),potential=new Map<string,string[]>();
 type Interval={start:number;end:number};
 const courtBusy=new Map<string,Interval[]>(),playerBusy=new Map<string,Interval[]>();
 function index(map:Map<string,Interval[]>,id:string,slot:Interval){const list=map.get(id)||[];list.push(slot);map.set(id,list);}
 for(const item of busy){const instant=new Date(item.starts_at).getTime(),interval={start:instant,end:instant+item.duration_minutes*60000};index(courtBusy,key(item.court),interval);for(const player of item.players)index(playerBusy,player,interval);}
 const fit=(candidate:number)=>{for(let i=0;i<400;i++){const local=madridParts(new Date(candidate)),opening=Date.parse(madridToIso(local.date,options.day_start)),closing=Date.parse(madridToIso(local.date,options.day_end));candidate=Math.max(candidate,opening);if(candidate+duration<=closing)return candidate;candidate=Date.parse(madridToIso(addDays(local.date,1),options.day_start));}throw new Error('No hay una franja diaria disponible.');};
 const result:ScheduledPair[]=[];
 let currentRound=0,barrier=start,roundEnd=start;
 for(const pair of pairs){
  if(pair.round!==currentRound){
   const preferred=Date.parse(madridToIso(addDays(first.date,(pair.round-1)*options.round_interval_days),first.time<options.day_start?options.day_start:first.time));
   barrier=Math.max(preferred,currentRound?roundEnd+gap:start);currentRound=pair.round;
  }
  const players=[...new Set<string>([pair.home,pair.away].filter(Boolean).flatMap(id=>registrations.find(r=>r.id===id)?.roster||[]).concat(pair.round>1&&competition.format==='knockout'?[...(potential.get(`${pair.round-1}:${pair.position*2}`)||[]),...(potential.get(`${pair.round-1}:${pair.position*2+1}`)||[])]:[]))];
  potential.set(`${pair.round}:${pair.position}`,players);
  const bye=pair.round===1&&!pair.away;
  if(bye){result.push({...pair,starts_at:null,court:courtName(0),duration_minutes:options.duration_minutes,status:'bye',winner:pair.home});continue;}
  let best:{start:number;court:number}|null=null;
  for(let court=0;court<courts.length;court++){
   let candidate=fit(Math.max(courts[court],barrier,...players.map(id=>playersReady.get(id)||start)));
   const conflicts=[...new Set([...(courtBusy.get(key(courtName(court)))||[]),...players.flatMap(id=>playerBusy.get(id)||[])])].sort((a,b)=>a.start-b.start);
   let advances=0;
   for(;;){const conflict=conflicts.find(slot=>candidate<slot.end+gap&&candidate+duration+gap>slot.start);if(!conflict)break;ensure(++advances<=5000,'SCHEDULE','No hay hueco disponible. Cambia la fecha o la franja.');candidate=fit(conflict.end+gap);}
   if(!best||candidate<best.start)best={start:candidate,court};
  }
  ensure(best,'SCHEDULE','No hay pistas disponibles.');
  const chosen=best!,end=chosen.start+duration;
  ensure(chosen.start-start<400*864e5,'SCHEDULE','El calendario supera un año. Amplía la franja o añade pistas.');
  courts[chosen.court]=end+gap;for(const player of players)playersReady.set(player,end+gap);roundEnd=Math.max(roundEnd,end);
  result.push({...pair,starts_at:new Date(chosen.start).toISOString(),court:courtName(chosen.court),duration_minutes:options.duration_minutes,status:'scheduled',winner:null});
 }
 return result;
}
