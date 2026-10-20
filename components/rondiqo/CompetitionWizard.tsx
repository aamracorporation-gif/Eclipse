import React,{useEffect,useRef,useState} from 'react';
import {View,Text,Pressable} from 'react-native';
import {router,useLocalSearchParams} from 'expo-router';
import {useIsFocused} from 'expo-router';
import {madridParts} from '@/src/domain/datetime';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {ThemedInput} from '@/components/ui/ThemedInput';
import {useAppDialog} from '@/components/ui/AppDialog';
import {Screen} from './Screen';
import {useAuth} from '@/lib/AuthContext';
import {useEvents} from '@/lib/EventContext';
import {useAppState} from '@/lib/AppStateContext';
import {useResponsive} from '@/lib/responsive';
import {newCompetitionDraft,competitionPayload} from '@/src/domain/competitionDraft';
import type {CompetitionDraft} from '@/src/domain/competitionDraft';
import {api,command} from '@/src/api';
import {Button,Badge,s,Court,Loading} from '@/src/ui/components';
import {colors as c} from '@/src/ui/theme';
export default function CompetitionWizard(){
 const params=useLocalSearchParams<{org?:string;edit?:string}>(),{user,organizations,loading}=useAuth(),{createCompetition}=useEvents(),{refresh}=useAppState(),{isDesktop}=useResponsive(),dialog=useAppDialog();
 const editable=organizations.filter(o=>user?.role==='admin'||['owner','manager'].includes(o.role));
 const [draft,setDraft]=useState<CompetitionDraft>(()=>newCompetitionDraft(params.org||editable[0]?.id||'')),[step,setStep]=useState(0),[error,setError]=useState(''),[busy,setBusy]=useState(false),[ready,setReady]=useState(false),[created,setCreated]=useState<string|null>(null);
 const focused=useIsFocused(),[version,setVersion]=useState<number|null>(null);
 const saved=useRef(false),key='rondiqo:competition-draft:'+user?.id+(params.edit?':'+params.edit:'');
 useEffect(()=>{
  if(!user||!focused)return;let active=true;setReady(false);setCreated(null);setStep(0);setError('');saved.current=false;
  const initial=newCompetitionDraft(params.org||editable[0]?.id||'');setDraft(initial);
  (async()=>{
   if(params.edit){const result=await api('/competitions/'+params.edit);if(!active)return;const comp=result.competition;if(!result.manager||comp.status!=='draft')throw new Error('Este borrador no se puede editar con tu cuenta.');const start=madridParts(comp.starts_at),close=madridParts(comp.registration_closes_at);setVersion(comp.version);setDraft({...initial,...comp,capacity:String(comp.capacity),price:String(comp.price_cents/100),startDate:start.date,startTime:start.time,closeDate:close.date,closeTime:close.time});}
   else {const raw=await AsyncStorage.getItem(key);if(!active)return;if(raw){try{setDraft({...initial,...JSON.parse(raw),...(params.org?{org_id:params.org}:{})});saved.current=true;}catch{}}}
   if(active)setReady(true);
  })().catch(e=>{if(active)setError(e.message);});return()=>{active=false;};
 },[key,params.org,params.edit,user?.id,focused]);
 useEffect(()=>{if(ready&&!created&&focused&&!params.edit)void AsyncStorage.setItem(key,JSON.stringify(draft)).catch(()=>{});},[draft,ready,key,created,focused,params.edit]);
 useEffect(()=>{if(!draft.org_id&&editable.length)setDraft(d=>({...d,org_id:params.org||editable[0].id}));},[organizations,draft.org_id]);
 const update=(patch:Partial<CompetitionDraft>)=>{setDraft(d=>({...d,...patch}));setError('');};
 const input=(key:keyof CompetitionDraft,label:string,placeholder?:string,multiline=false)=><ThemedInput label={label} accessibilityLabel={label} value={draft[key]} onChangeText={v=>update({[key]:v})} placeholder={placeholder} multiline={multiline} autoCapitalize={['title','venue','city','description','rules'].includes(key)?'sentences':'none'} inputStyle={multiline?{minHeight:120,textAlignVertical:'top'}:{}}/>;
 const choose=(key:keyof CompetitionDraft,options:{value:string;label:string;detail?:string}[]) => <View style={[s.row,{flexWrap:'wrap',alignItems:'stretch'}]}>{options.map(o=><Pressable key={o.value} accessibilityRole="radio" accessibilityState={{checked:draft[key]===o.value,disabled:!!params.edit&&key==='org_id'}} disabled={!!params.edit&&key==='org_id'} onPress={()=>update({[key]:o.value})} style={[s.panel,{flexGrow:1,flexBasis:150,gap:8,borderColor:draft[key]===o.value?c.lime:c.line,backgroundColor:draft[key]===o.value?'#263522':c.surface}]}><Text style={[s.h3,{color:draft[key]===o.value?c.lime:c.text}]}>{o.label}</Text>{o.detail&&<Text style={s.body}>{o.detail}</Text>}</Pressable>)}</View>;
 async function save(){
  setError('');setBusy(true);
  try{const payload=competitionPayload(draft);const result=params.edit?await command('competition.update',{...payload,competition_id:params.edit,version}):await createCompetition(payload);if(params.edit)await refresh(true);setCreated(result.id);void AsyncStorage.removeItem(key).catch(()=>{});}
  catch(e){setError((e as Error).message);}finally{setBusy(false);}
 }
 function next(){
  if(step===0&&!editable.some(o=>o.id===draft.org_id)){setError('Selecciona una organización en la que puedas gestionar competiciones.');return;}
  if(step===1){try{competitionPayload(draft);}catch(e){setError((e as Error).message);return;}}
  setError('');setStep(v=>v+1);
 }
 if(loading)return <Screen><Loading/></Screen>;
 if(!user)return <Screen title="Tu próxima competición"><Text style={s.body}>Inicia sesión con tu cuenta de organizador.</Text><Button onPress={()=>router.replace({pathname:'/(auth)/login',params:{intent:'organizer'}})}>Entrar</Button></Screen>;
 if(!editable.length)return <Screen title="Primero, tu organización"><Text style={s.body}>Crea el perfil de tu club o pide acceso a su responsable para preparar competiciones.</Text><Button onPress={()=>router.replace('/(creator)/organizer-profile')}>Ir a mi club</Button></Screen>;
 if(created)return <Screen title="Tu ronda ya tiene forma."><Badge>BORRADOR GUARDADO</Badge><View style={[s.panel,{gap:18}]}><Court/><Text style={s.h3}>{draft.title}</Text><Text style={s.body}>Revisa los datos antes de abrir las inscripciones. El calendario se generará cuando confirmes los equipos participantes.</Text><Button onPress={()=>router.replace({pathname:'/(creator)/manage-events',params:{competition:created}})}>Revisar competición</Button><Button secondary disabled={busy} onPress={()=>dialog.show({title:'Abrir inscripciones',message:'La competición será visible para los jugadores. Los pagos de esta versión son simulados.',actions:[{label:'Publicar competición',onPress:()=>{setBusy(true);command('competition.publish',{competition_id:created}).then(()=>refresh()).then(()=>router.replace({pathname:'/(creator)/manage-events',params:{competition:created}})).catch(e=>setError(e.message)).finally(()=>setBusy(false));}},{label:'Seguir revisando',variant:'outline'}]})}>Publicar y abrir inscripciones</Button>{error&&<Text accessibilityRole="alert" style={{color:c.danger}}>{error}</Text>}</View></Screen>;
 return <Screen title={params.edit?'Afina tu próxima ronda.':'Crea la próxima gran ronda.'}>
  <Text style={s.body}>Pádel y fútbol 7. Del primer equipo a la final, todo empieza aquí.</Text>
  <View style={[s.row,{alignItems:'stretch'}]}>{['Deporte y formato','Lugar y plazas','Revisar y guardar'].map((label,i)=><View key={label} style={{flex:1,borderTopWidth:3,borderColor:i<=step?c.lime:c.line,paddingTop:12,gap:7}}><Text style={[s.eyebrow,{color:i===step?c.lime:c.muted}]}>0{i+1}</Text><Text style={[s.label,{color:i===step?c.text:c.muted}]}>{label}</Text></View>)}</View>
  {saved.current&&<Text style={s.caption}>Hemos recuperado tu último borrador de este dispositivo.</Text>}
  {step===0&&<View style={{gap:24}}>
   <View style={{gap:12}}><Text style={s.h3}>¿Quién organiza?</Text>{choose('org_id',editable.map(o=>({value:o.id,label:o.name,detail:o.verified?'Organización verificada':'Verificación pendiente para publicar'})))}</View>
   <View style={{gap:12}}><Text style={s.h3}>Elige tu deporte</Text>{choose('sport',[{value:'padel',label:'Pádel',detail:'Parejas de 2 jugadores'},{value:'football7',label:'Fútbol 7',detail:'Equipos con al menos 7 jugadores'}])}</View>
   <View style={{gap:12}}><Text style={s.h3}>El formato de la ronda</Text>{choose('format',[{value:'knockout',label:'Eliminatoria',detail:'Cruces y pases directos hasta la final'},{value:'league',label:'Liga',detail:'Todos contra todos, una vuelta'},{value:'challenge',label:'Desafío',detail:'Un encuentro entre dos equipos'}])}</View>
  </View>}
  {step===1&&<View style={[s.panel,{gap:8}]}>
   {input('title','Nombre de la competición','Ej. Copa Sevilla de pádel')}
   <View style={{flexDirection:isDesktop?'row':'column',gap:18}}><View style={{flex:1}}>{input('city','Ciudad')}{input('venue','Club, sede y dirección','Dónde se juega')}</View><View style={{flex:1}}>{input('startDate','Fecha de inicio','AAAA-MM-DD')}{input('startTime','Hora de inicio','18:00')}</View></View>
   <View style={{flexDirection:isDesktop?'row':'column',gap:18}}><View style={{flex:1}}>{input('closeDate','Fecha de cierre de inscripciones','AAAA-MM-DD')}{input('closeTime','Hora de cierre','20:00')}</View><View style={{flex:1}}>{draft.format!=='challenge'&&input('capacity',draft.sport==='padel'?'Plazas de parejas':'Plazas de equipos','8')}{input('price',draft.sport==='padel'?'Precio total por pareja (€)':'Precio total por equipo (€)','0')}</View></View>
   <Text style={s.caption}>Horas de Madrid. El precio es por inscripción completa. En esta versión no se cobra dinero.</Text>
   <Text style={[s.label,{marginVertical:10}]}>Nivel</Text>{choose('level',[{value:'beginner',label:'Iniciación'},{value:'intermediate',label:'Intermedio'},{value:'advanced',label:'Avanzado'},{value:'open',label:'Abierto'}])}
  </View>}
  {step===2&&<View style={{gap:20}}><View style={[s.panel,{gap:12}]}><Badge>{draft.sport==='padel'?'PÁDEL':'FÚTBOL 7'}</Badge><Text style={s.title}>{draft.title}</Text><Text style={s.body}>{draft.venue} · {draft.city}{'\n'}{draft.startDate} a las {draft.startTime} · hora de Madrid{'\n'}{draft.format==='challenge'?2:draft.capacity} {draft.sport==='padel'?'parejas':'equipos'} · {draft.price} € por inscripción</Text></View><View style={s.panel}>{input('description','Descripción para los jugadores',undefined,true)}{input('rules','Reglas y política de cancelación',undefined,true)}</View><Text style={s.caption}>Los cambios quedan guardados como borrador. Podrás revisarlo y publicar después.</Text></View>}
  {!!error&&<Text accessibilityRole="alert" style={{color:c.danger,lineHeight:22}}>{error}</Text>}
  <View style={[s.row,{justifyContent:'space-between',flexWrap:'wrap'}]}><Button secondary disabled={busy} onPress={()=>step?setStep(v=>v-1):router.replace('/(creator)/manage-events')}>{step?'Anterior':'Salir'}</Button><Button disabled={busy||!ready} onPress={step===2?save:next}>{busy?'Guardando…':step===2?'Guardar borrador':'Continuar'}</Button></View>
 </Screen>;
}
