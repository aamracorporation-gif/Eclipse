import type {Row} from './model.ts';
export function registrationGuide(competition:Row,user:Row|null,teams:Row[],registrations:Row[],now=Date.now()){
 const existing=registrations.find(r=>r.competition_id===competition.id&&['pending','confirmed','waitlisted','refund_pending'].includes(r.status));
 if(existing)return {kind:'existing',title:existing.status==='pending'?'Completa tu inscripción':existing.status==='waitlisted'?'Estás en lista de espera':'Tu equipo ya está inscrito',body:'Consulta el estado, los próximos pasos y el pase de acceso en Mi actividad.',action:'Ver mi inscripción',teams:[]};
 if(competition.status!=='open')return {kind:'closed',title:competition.status==='running'?'La competición ya está en juego':competition.status==='completed'?'Competición finalizada':'Inscripciones no disponibles',body:'Puedes consultar la información, los partidos y la clasificación.',teams:[]};
 if(Date.parse(competition.registration_closes_at)<=now)return {kind:'closed',title:'Las inscripciones están cerradas',body:'La organización está preparando la competición. Consulta aquí los horarios cuando estén publicados.',teams:[]};
 if(!user)return {kind:'login',title:'Participa en esta competición',body:'Entra con tu cuenta para apuntarte. Si ya usabas Eclipse, utiliza el mismo correo y contraseña.',action:'Entrar para inscribirme',teams:[]};
 if(competition.entry_mode==='individual')return {kind:'ready',title:'Todo listo para inscribirte',body:'Revisa las reglas y confirma tu inscripción.',action:'Inscribirme',teams:[]};
 const own=teams.filter(t=>t.sport===competition.sport&&t.captain_id===user.id);
 const ready=own.filter(t=>t.members.length>=competition.min_roster&&(competition.sport!=='padel'||t.members.length===2));
 if(ready.length)return {kind:'ready',title:'Tu equipo está listo',body:'Elige el equipo, revisa las reglas y confirma la inscripción completa.',action:'Inscribir a mi equipo',teams:ready};
 if(own.length)return {kind:'team',title:'Completa la plantilla',body:`Necesitas ${competition.sport==='padel'?'una pareja de 2 jugadores':`al menos ${competition.min_roster} jugadores`}. Invita a tus compañeros antes de inscribir al equipo.`,action:'Completar mi equipo',teams:[]};
 const member=teams.some(t=>t.sport===competition.sport);
 return {kind:'team',title:member?'Tu capitán inscribe al equipo':'Primero, crea tu equipo',body:member?'Pide al capitán que inscriba vuestra plantilla. También puedes crear otro equipo del que seas capitán.':`Crea ${competition.sport==='padel'?'tu pareja de pádel':'tu equipo de fútbol 7'} e invita a los jugadores. Después vuelve aquí para inscribiros.`,action:'Ir a mis equipos',teams:[]};
}
