import {madridParts,madridToIso} from './datetime.ts';
export type CompetitionDraft={org_id:string;title:string;sport:'padel'|'football7';format:'knockout'|'league'|'challenge';city:string;venue:string;level:string;capacity:string;price:string;startDate:string;startTime:string;closeDate:string;closeTime:string;description:string;rules:string};
export function newCompetitionDraft(org_id=''):CompetitionDraft{
 const start=madridParts(new Date(Date.now()+14*864e5)),close=madridParts(new Date(Date.now()+13*864e5));
 return {org_id,title:'',sport:'padel',format:'knockout',city:'Sevilla',venue:'',level:'intermediate',capacity:'8',price:'0',startDate:start.date,startTime:'18:00',closeDate:close.date,closeTime:'20:00',description:'Competición amateur para mayores de 18 años. Respeto al rival y juego limpio.',rules:'Mayores de 18 años. Pádel: al mejor de tres sets completos, tie-break a 6–6. Fútbol 7: dos tiempos de 25 minutos; empate permitido en liga, penaltis en eliminatoria. Cancelación con reembolso íntegro antes del inicio; después, gestión por la organización.'};
}
export function competitionPayload(d:CompetitionDraft,now=Date.now()){
 if(!d.org_id)throw new Error('Selecciona la organización que organiza la competición.');
 if(d.title.trim().length<4||d.title.length>100)throw new Error('El nombre debe tener entre 4 y 100 caracteres.');
 if(d.city.trim().length<2||d.venue.trim().length<2)throw new Error('Indica la ciudad y la sede.');
 if(!['padel','football7'].includes(d.sport)||!['knockout','league','challenge'].includes(d.format))throw new Error('Revisa el deporte y el formato.');
 if(!/^\d+$/.test(d.capacity))throw new Error('Las plazas deben ser un número entero.');
 const capacity=d.format==='challenge'?2:Number(d.capacity);
 if(capacity<2||capacity>(d.format==='league'?32:128))throw new Error(d.format==='league'?'La liga admite de 2 a 32 equipos.':'El torneo admite de 2 a 128 equipos.');
 if(!/^\d+([.,]\d{1,2})?$/.test(d.price))throw new Error('El precio debe tener como máximo dos decimales.');
 const price_cents=Math.round(Number(d.price.replace(',','.'))*100);
 if(price_cents>100000||(price_cents>0&&price_cents<50))throw new Error('Usa entrada gratuita o un precio entre 0,50 € y 1.000 €.');
 const starts_at=madridToIso(d.startDate,d.startTime),registration_closes_at=madridToIso(d.closeDate,d.closeTime);
 if(Date.parse(registration_closes_at)<=now||Date.parse(registration_closes_at)>Date.parse(starts_at))throw new Error('El cierre de inscripciones debe ser futuro y anterior al inicio.');
 if(d.rules.trim().length<20||d.rules.length>3000)throw new Error('Escribe las reglas y la política de cancelación (20–3.000 caracteres).');
 if(d.description.trim().length<10||d.description.length>2000)throw new Error('La descripción debe tener entre 10 y 2.000 caracteres.');
 return {org_id:d.org_id,title:d.title.trim(),sport:d.sport,format:d.format,city:d.city.trim(),venue:d.venue.trim(),level:d.level,capacity,price_cents,entry_mode:'team',starts_at,registration_closes_at,description:d.description.trim(),rules:d.rules.trim()};
}
