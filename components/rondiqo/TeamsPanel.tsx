import React,{useState} from 'react';
import {View,Text,Share,Modal} from 'react-native';
import {Button,Badge,Heading,Empty,FormDialog,s} from '@/src/ui/components';
import type {FormConfig} from '@/src/ui/components';
import {colors as c,sportColors} from '@/src/ui/theme';
import {sports} from '@/src/domain/model';
import type {Row,Sport} from '@/src/domain/model';
import {command} from '@/src/api';

export function TeamsPanel({state,refresh,login,explore}:{state:Row;refresh:()=>Promise<unknown>;login:()=>void;explore:()=>void}){
 const [form,setForm]=useState<FormConfig|null>(null),[invite,setInvite]=useState<{name:string;code:string}|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
 const user=state.user;
 async function run(action:string,input:Row,message:string){await command(action,input);await refresh();setError('');setNotice(message);}
 function create(){if(!user){login();return;}setForm({title:'Crea tu pareja o equipo',intro:'Tú serás el capitán. Cada compañero se unirá desde su propia cuenta con una invitación.',initial:{sport:'padel'},fields:[{key:'name',label:'Nombre de la pareja o equipo'},{key:'sport',label:'Deporte',type:'select',options:[{value:'padel',label:'Pádel · 2 jugadores'},{value:'football7',label:'Fútbol 7 · mínimo 7'}]}],submit:'Crear equipo',run:async values=>{const result=await command('team.create',values);await refresh();setInvite({name:values.name,code:result.invite});setNotice('Equipo creado. Comparte la invitación para completar la plantilla.');}});}
 function join(){if(!user){login();return;}setForm({title:'Únete a un equipo',intro:'Pide el código al capitán y pégalo aquí. Al unirte podrás ver las inscripciones y partidos del equipo.',fields:[{key:'invite',label:'Código de invitación'}],submit:'Unirme al equipo',run:async values=>run('team.join',{invite:String(values.invite||'').trim()},'Ya formas parte del equipo.')});}
 async function invitation(team:Row){if(busy)return;setBusy(true);setError('');try{const result=await command('team.invite',{team_id:team.id});setInvite({name:team.name,code:result.invite});}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 function manage(team:Row,action:'team.update'|'team.remove'|'team.captain'){
  const people=team.members.filter((m:Row)=>m.id!==user.id);
  const rename=action==='team.update',transfer=action==='team.captain';
  setForm({title:rename?'Cambiar nombre':transfer?'Cambiar capitán':'Retirar jugador',intro:rename?'El nuevo nombre se usará en tus próximas inscripciones.':transfer?'La persona elegida gestionará las invitaciones e inscripciones. Tú seguirás como jugador. La invitación anterior dejará de funcionar.':'El jugador saldrá de la plantilla. La invitación anterior dejará de funcionar y podrás generar otra.',initial:rename?{name:team.name}:{user_id:people[0]?.id},fields:rename?[{key:'name',label:'Nombre del equipo'}]:[{key:'user_id',label:transfer?'Nuevo capitán':'Jugador',type:'select',options:people.map((m:Row)=>({value:m.id,label:m.name}))}],submit:rename?'Guardar nombre':transfer?'Confirmar nuevo capitán':'Retirar del equipo',run:async values=>run(action,{team_id:team.id,...values},'Equipo actualizado.')});
 }
 return <><Heading eyebrow="JUGAR EN COMPAÑÍA" title="Mis equipos" subtitle="Forma tu pareja de pádel o tu plantilla de fútbol 7. El capitán inscribe al equipo completo."/>
 {!!error&&<Text accessibilityRole="alert" style={{color:c.danger,marginBottom:14}}>{error}</Text>}{!!notice&&<Text accessibilityRole="alert" style={{color:c.lime,marginBottom:14}}>{notice}</Text>}
 <View style={[s.row,{flexWrap:'wrap',marginBottom:22}]}><Button onPress={create}>Crear equipo</Button><Button secondary onPress={join}>Tengo una invitación</Button></View>
 {!state.teams.length&&<Empty title="Empieza con tu gente" body={"1. Crea el equipo o acepta una invitación.\n2. Reúne a 2 jugadores de pádel o al menos 7 de fútbol 7.\n3. El capitán elige una competición e inscribe al equipo."}/>}
 {state.teams.map((team:Row)=>{const captain=team.captain_id===user?.id,minimum=team.sport==='football7'?7:team.sport==='basket3x3'?3:2,missing=Math.max(0,minimum-team.members.length);return <View key={team.id} style={[s.panel,{gap:14,marginBottom:18}]}>
  <View style={[s.row,{justifyContent:'space-between',flexWrap:'wrap'}]}><Badge color={sportColors[team.sport]}>{sports[team.sport as Sport]}</Badge><Text style={s.caption}>{captain?'Eres capitán':'Eres jugador'}</Text></View>
  <Text style={s.h3}>{team.name}</Text><Text style={{color:missing?c.coral:c.lime,fontWeight:'600'}}>{missing?`Falta${missing===1?'':'n'} ${missing} jugador${missing===1?'':'es'} para inscribirse`:`Plantilla completa · ${team.members.length} jugadores`}</Text>
  {team.members.map((member:Row)=><View key={member.id} style={[s.row,{paddingVertical:5}]}><View style={{width:34,height:34,borderRadius:12,backgroundColor:c.raised,alignItems:'center',justifyContent:'center'}}><Text style={{color:c.lime,fontWeight:'700'}}>{member.name.slice(0,1)}</Text></View><Text style={[s.body,{flex:1,color:c.text}]}>{member.name}{member.id===team.captain_id?' · Capitán':''}{member.id===user?.id?' (tú)':''}</Text></View>)}
  {team.roster_locked?<View style={{gap:5}}><Badge color={c.blue}>PLANTILLA INSCRITA</Badge><Text style={s.body}>Los jugadores y el capitán se mantienen mientras haya inscripciones activas. Podrás cambiar el equipo al finalizarlas o cancelarlas.</Text></View>:<View style={[s.row,{flexWrap:'wrap'}]}>{captain?<>
   {(team.sport!=='padel'||missing>0)&&<Button small disabled={busy} onPress={()=>void invitation(team)}>Invitar jugadores</Button>}
   <Button small secondary onPress={()=>manage(team,'team.update')}>Editar nombre</Button>
   {team.members.length>1&&<><Button small secondary onPress={()=>manage(team,'team.remove')}>Retirar jugador</Button><Button small secondary onPress={()=>manage(team,'team.captain')}>Cambiar capitán</Button></>}
  </>:<Button small secondary onPress={()=>setForm({title:'Salir del equipo',intro:`Dejarás de formar parte de ${team.name}. Necesitarás una nueva invitación para volver.`,fields:[],submit:'Salir del equipo',run:async()=>run('team.leave',{team_id:team.id},'Has salido del equipo.')})}>Salir del equipo</Button>}</View>}
  {captain&&!missing&&!team.roster_locked&&<Button onPress={explore}>Buscar competición para este equipo</Button>}
 </View>;})}
 <FormDialog form={form} close={()=>setForm(null)}/>
 <Modal visible={!!invite} transparent animationType="fade" onRequestClose={()=>setInvite(null)}><View style={s.overlay}><View style={[s.dialog,{padding:24,gap:18}]}><Badge>INVITACIÓN LISTA</Badge><Text style={s.h3}>{invite?.name}</Text><Text style={s.body}>Tu compañero debe entrar en RONDIQO, abrir «Mis equipos» y pulsar «Tengo una invitación». Comparte este código solo con quienes vayan a jugar.</Text><Text selectable style={[s.body,{color:c.lime,padding:14,borderRadius:10,backgroundColor:c.bg}]}>{invite?.code}</Text><Button onPress={()=>{if(invite)void Share.share({message:`Únete a ${invite.name} en RONDIQO. En Mis equipos → Tengo una invitación, pega este código:\n${invite.code}`}).catch(e=>setError(e.message));}}>Compartir invitación</Button><Text style={s.caption}>Generar otra invitación invalida este código.</Text><Button secondary onPress={()=>setInvite(null)}>Listo</Button></View></View></Modal>
 </>;
}
