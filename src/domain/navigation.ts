export type Space='player'|'organizer';
const player=[
  {id:'discover',slug:'descubrir',label:'Descubrir',icon:'compass-outline'},
  {id:'activity',slug:'inscripciones',label:'Mis pases',icon:'ticket-outline'},
  {id:'teams',slug:'equipos',label:'Mis equipos',icon:'people-outline'},
  {id:'calendar',slug:'agenda',label:'Mi agenda',icon:'calendar-outline'},
  {id:'profile',slug:'perfil',label:'Mi perfil',icon:'person-outline'},
];
const organizer=[
  {id:'dashboard',slug:'panel',label:'Panel',icon:'grid-outline'},
  {id:'competitions',slug:'competiciones',label:'Competiciones',icon:'trophy-outline'},
  {id:'registrations',slug:'inscripciones',label:'Inscripciones',icon:'people-outline'},
  {id:'calendar',slug:'calendario',label:'Calendario',icon:'calendar-outline'},
  {id:'access',slug:'accesos',label:'Acceso QR',icon:'qr-code-outline'},
  {id:'stats',slug:'estadisticas',label:'Estadísticas',icon:'bar-chart-outline'},
  {id:'club',slug:'club',label:'Mi club',icon:'business-outline'},
];
export function spaceTabs(space:Space,admin=false){
  return [...(space==='player'?player:organizer),...(space==='organizer'&&admin?[{id:'admin',slug:'administracion',label:'Administración',icon:'shield-checkmark-outline'}]:[])];
}
export function sectionFor(space:Space,slug:string){
  return spaceTabs(space,true).find(x=>x.slug===slug||x.id===slug)?.id||(space==='player'?'discover':'dashboard');
}
const screens:Record<Space,Record<string,string>>={
 player:{discover:'discover',activity:'tickets',teams:'teams',calendar:'agenda',profile:'profile'},
 organizer:{dashboard:'dashboard',competitions:'manage-events',registrations:'registrations',calendar:'calendar',access:'scan',club:'organizer-profile',stats:'stats',admin:'admin-verification'}
};
export function pathFor(space:Space,id:string){return '/'+(space==='player'?'(tabs)':'(creator)')+'/'+(screens[space][id]||screens[space][space==='player'?'discover':'dashboard']);}
