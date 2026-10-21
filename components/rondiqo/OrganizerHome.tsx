import React from 'react';
import {View,Text} from 'react-native';
import {Button,Badge,Heading,Empty,s} from '@/src/ui/components';
import {colors as c} from '@/src/ui/theme';
import type {Row} from '@/src/domain/model';

export function OrganizerHome({state,competitions,orgFilter,filter,create,navigate,openCompetition,canEdit}:{state:Row;competitions:Row[];orgFilter:string;filter:React.ReactNode;create:()=>void;navigate:(section:string)=>void;openCompetition:(id:string,view?:string)=>void;canEdit:(id:string)=>boolean}){
 const workspace=state.organizer||{agenda:[],metrics:[],registrations:[]};
 const visible=(row:Row)=>orgFilter==='all'||row.org_id===orgFilter;
 const agenda=workspace.agenda.filter(visible),metrics=workspace.metrics.filter(visible);
 const total=(key:string)=>metrics.reduce((sum:number,m:Row)=>sum+Number(m[key]||0),0);
 const tasks: {key:string;title:string;body:string;action:string;run:()=>void;color?:string}[]=[];
 const disputes=agenda.filter((m:Row)=>m.status==='disputed');
 const proposals=agenda.filter((m:Row)=>m.status==='proposed');
 const drafts=competitions.filter(x=>x.status==='draft'&&canEdit(x.org_id));
 const ready=competitions.filter(x=>x.status==='open'&&Date.parse(x.registration_closes_at)<=Date.now()&&canEdit(x.org_id));
 if(disputes.length)tasks.push({key:'disputes',title:`${disputes.length} resultado${disputes.length===1?'':'s'} en revisión`,body:'Revisa la incidencia y resuelve el marcador del partido.',action:'Revisar resultados',run:()=>openCompetition(disputes[0].competition_id,'matches'),color:c.coral});
 if(proposals.length)tasks.push({key:'proposals',title:`${proposals.length} resultado${proposals.length===1?'':'s'} por confirmar`,body:'Comprueba las propuestas antes de cerrar la jornada.',action:'Ver propuestas',run:()=>openCompetition(proposals[0].competition_id,'matches'),color:c.blue});
 if(ready.length)tasks.push({key:'calendar',title:'Prepara la siguiente jornada',body:`${ready[0].title}: las inscripciones están cerradas. Revisa los equipos y genera los cruces.`,action:'Preparar calendario',run:()=>openCompetition(ready[0].id)});
 if(drafts.length)tasks.push({key:'drafts',title:drafts.length===1?'Tienes un borrador por revisar':`Tienes ${drafts.length} borradores`,body:drafts[0].title,action:'Continuar borrador',run:()=>openCompetition(drafts[0].id)});
 const upcoming=agenda.filter((m:Row)=>Date.parse(m.starts_at)>=Date.now()-3*3600000&&!['confirmed','bye'].includes(m.status)).slice(0,4);
 return <><Heading eyebrow="TU ESPACIO ORGANIZADOR" title={`Hola, ${state.user.name.split(' ')[0]}`} subtitle="Lo que necesita tu atención y los próximos partidos de tus competiciones."/>
 <View style={[s.row,{flexWrap:'wrap',marginBottom:20}]}><Button onPress={create}>Crear competición</Button><Button secondary onPress={()=>navigate('registrations')}>Ver inscripciones</Button></View>{filter}
 {tasks.length?<View style={{gap:12,marginBottom:24}}><Text style={s.h3}>Para hacer ahora</Text>{tasks.map(task=><View key={task.key} style={[s.panel,{gap:12,borderColor:task.color||c.line}]}><Badge color={task.color||c.lime}>{task.title}</Badge><Text style={s.body}>{task.body}</Text><View style={s.row}><Button small onPress={task.run}>{task.action}</Button></View></View>)}</View>:<View style={{marginBottom:24}}><Empty title={competitions.length?'No hay tareas pendientes':'Publica tu primera competición'} body={competitions.length?'Consulta la agenda y las inscripciones para preparar la siguiente jornada.':'Elige pádel o fútbol 7, define las plazas y revisa las reglas antes de abrir las inscripciones.'}>{!competitions.length&&<Button onPress={create}>Empezar competición</Button>}</Empty></View>}
 <View style={[s.row,{flexWrap:'wrap',alignItems:'stretch',marginBottom:24}]}>{[{label:'Competiciones activas',value:competitions.filter(x=>['open','running'].includes(x.status)).length},{label:'Inscripciones confirmadas',value:total('confirmed')},{label:'Accesos validados',value:total('checked_in')}].map(item=><View key={item.label} style={[s.panel,{flexGrow:1,flexBasis:160,gap:8}]}><Text style={s.caption}>{item.label}</Text><Text style={{color:c.lime,fontSize:28,fontWeight:'800'}}>{item.value}</Text></View>)}</View>
 <View style={[s.row,{justifyContent:'space-between',flexWrap:'wrap',marginBottom:14}]}><Text style={s.h3}>Próximos partidos</Text><Button small secondary onPress={()=>navigate('calendar')}>Ver calendario</Button></View>
 {!upcoming.length&&<Empty title="Sin próximos partidos" body="Cuando generes el calendario de una competición, aquí verás las próximas citas."/>}
 {upcoming.map((m:Row)=><View key={m.id} style={[s.panel,{gap:10,marginBottom:12}]}><Text style={s.label}>{m.home_name||'Por decidir'} — {m.away_name||'Por decidir'}</Text><Text style={s.body}>{new Intl.DateTimeFormat('es-ES',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',timeZone:'Europe/Madrid'}).format(new Date(m.starts_at))} · {m.court}</Text><Text style={s.caption}>{m.title}</Text><View style={s.row}><Button small secondary onPress={()=>openCompetition(m.competition_id,'matches')}>Abrir partido</Button></View></View>)}
 <View style={[s.row,{flexWrap:'wrap',marginTop:20}]}><Button small secondary onPress={()=>navigate('stats')}>Estadísticas</Button><Button small secondary onPress={()=>navigate('club')}>Club y personal</Button>{state.user.role==='admin'&&<Button small secondary onPress={()=>navigate('admin')}>Administración</Button>}</View></>;
}
