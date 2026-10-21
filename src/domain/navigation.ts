export type Space='player'|'organizer';
const player=[
  {id:'home',slug:'inicio',label:'Inicio',icon:'home-outline'},
  {id:'discover',slug:'explorar',label:'Explorar',icon:'compass-outline'},
  {id:'teams',slug:'equipos',label:'Mis equipos',icon:'people-outline'},
  {id:'activity',slug:'actividad',label:'Mi actividad',icon:'ticket-outline'},
  {id:'profile',slug:'perfil',label:'Perfil',icon:'person-outline'},
];
const organizer=[
  {id:'dashboard',slug:'panel',label:'Panel',icon:'grid-outline'},
  {id:'competitions',slug:'competiciones',label:'Competiciones',icon:'trophy-outline'},
  {id:'calendar',slug:'calendario',label:'Calendario',icon:'calendar-outline'},
  {id:'access',slug:'accesos',label:'Accesos',icon:'qr-code-outline'},
  {id:'club',slug:'club',label:'Mi club',icon:'business-outline'},
];
const secondary:Record<Space,{id:string;slug:string;label:string;icon:string}[]>={
 player:[{id:'calendar',slug:'agenda',label:'Mi agenda',icon:'calendar-outline'}],
 organizer:[{id:'registrations',slug:'inscripciones',label:'Inscripciones',icon:'people-outline'},{id:'stats',slug:'estadisticas',label:'Estadísticas',icon:'bar-chart-outline'},{id:'profile',slug:'perfil',label:'Mi cuenta',icon:'person-outline'},{id:'admin',slug:'administracion',label:'Administración',icon:'shield-checkmark-outline'}]
};
export function spaceTabs(space:Space,_admin=false){
 return space==='player'?player:organizer;
}
export function sectionFor(space:Space,slug:string){
 const aliases:Record<string,string>={descubrir:'discover',inscripciones:space==='player'?'activity':'registrations',tickets:'activity'};
 const value=aliases[slug]||slug;
 return [...spaceTabs(space),...secondary[space]].find(x=>x.slug===value||x.id===value)?.id||(space==='player'?'home':'dashboard');
}
export function pathFor(space:Space,id:string){
 const target=[...spaceTabs(space),...secondary[space]].find(x=>x.id===id)||spaceTabs(space)[0];
 return `/${space==='player'?'jugador':'organizador'}/${target.slug}`;
}
export function competitionPath(space:Space,id:string){return `/${space==='player'?'jugador':'organizador'}/competicion/${encodeURIComponent(id)}`;}
export function sectionLabel(space:Space,id:string){return [...spaceTabs(space),...secondary[space]].find(x=>x.id===id)?.label||'Inicio';}
export function safeReturnPath(value:unknown,space:Space){
 return typeof value==='string'&&new RegExp(`^/${space==='player'?'jugador':'organizador'}/[a-z0-9/-]+$`,'i').test(value)?value:pathFor(space,space==='player'?'home':'dashboard');
}
