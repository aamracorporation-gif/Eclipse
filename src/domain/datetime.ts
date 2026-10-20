const madrid=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
export function madridParts(value:Date|string){const parts=Object.fromEntries(madrid.formatToParts(new Date(value)).map(p=>[p.type,p.value]));return {date:parts.year+'-'+parts.month+'-'+parts.day,time:parts.hour+':'+parts.minute};}
export function madridToIso(date:string,time:string){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!/^\d{2}:\d{2}$/.test(time))throw new Error('Usa una fecha AAAA-MM-DD y una hora HH:MM.');
 const naive=Date.parse(date+'T'+time+':00Z');
 if(!Number.isFinite(naive)||new Date(naive).toISOString().slice(0,16)!==date+'T'+time)throw new Error('Revisa la fecha y la hora.');
 const candidates=[60,120].map(offset=>new Date(naive-offset*60000)).filter(d=>{const p=madridParts(d);return p.date===date&&p.time===time;});
 if(candidates.length!==1)throw new Error(candidates.length?'Esa hora se repite por el cambio de horario. Elige otra hora.':'Esa hora no existe por el cambio de horario. Elige otra hora.');
 return candidates[0].toISOString();
}
