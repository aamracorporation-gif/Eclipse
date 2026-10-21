import {OrganizerHome} from '@/components/rondiqo/OrganizerHome';
import {TeamsPanel} from '@/components/rondiqo/TeamsPanel';
import {registrationGuide} from '../domain/registrationGuide';
import {WorkspaceShell} from '@/components/rondiqo/WorkspaceShell';
import {PlayerHome} from '@/components/rondiqo/PlayerHome';
import {madridParts,madridToIso} from '../domain/datetime';
import {useAppState} from '@/lib/AppStateContext';
import {useIsFocused} from 'expo-router';
import {useFilters} from '@/lib/FilterContext';
import {useEvents} from '@/lib/EventContext';
import {useAuth} from '@/lib/AuthContext';
import {NotificationBell} from '@/components/NotificationBell';
import {SportsStats} from '@/components/rondiqo/SportsStats';
import {useRouter,useLocalSearchParams} from 'expo-router';
import {spaceTabs,sectionFor,pathFor,competitionPath} from '../domain/navigation';
import React,{useEffect,useState} from 'react';
import {View,Text,ScrollView,Pressable,TextInput,StyleSheet,Platform,Linking,Share,Modal} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import QRCode from 'react-native-qrcode-svg';
import {Ionicons} from '@expo/vector-icons';
import {useResponsive} from '../../lib/responsive';
import {api,command,base} from '../api';
import {colors as c,sportColors} from '../ui/theme';
import {Logo,Court,Button,Badge,Heading,Empty,FormDialog,Loading,s} from '../ui/components';
import type {FormConfig,Field} from '../ui/components';
import {ScanDialog} from '../ui/ScanDialog';
import {sports,formats,TERMS_VERSION} from '../domain/model';
import type {Row,Sport,Format} from '../domain/model';
const money=(n:number)=>new Intl.NumberFormat('es-ES',{style:'currency',currency:'EUR'}).format(n/100);
const date=(v:string)=>new Intl.DateTimeFormat('es-ES',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',timeZone:'Europe/Madrid'}).format(new Date(v));
const labels:Record<string,string>={draft:'Borrador',open:'Inscripción abierta',running:'En juego',completed:'Finalizada',cancelled:'Cancelada',confirmed:'Confirmada',pending:'Pendiente de pago',waitlisted:'Lista de espera',refunded:'Reembolsada',refund_pending:'Reembolso pendiente',expired:'Reserva caducada',scheduled:'Por jugar',proposed:'Por confirmar',disputed:'En revisión',bye:'Pase directo',owner:'Propietario',manager:'Gestión',referee:'Resultados',checkin:'Acceso QR',beginner:'Iniciación',intermediate:'Intermedio',advanced:'Avanzado'};
const sportOptions=Object.entries(sports).filter(([value])=>['padel','football7'].includes(value)).map(([value,label])=>({value,label}));
const levelOptions=[{value:'beginner',label:'Iniciación'},{value:'intermediate',label:'Intermedio'},{value:'advanced',label:'Avanzado'},{value:'open',label:'Todos'}];
const stateEmpty={agenda:[],organizer:null,competitions:[],registrations:[],teams:[],organizations:[],orgMembers:[],notifications:[],admin:null,user:null,paymentMode:'simulated'};
export default function SportsApp({space,section,competitionId}:{space:'player'|'organizer';section:string;competitionId?:string}){
  const focused=useIsFocused();
  const router=useRouter(),params=useLocalSearchParams<{competition?:string;view?:string;competitionToJoin?:string}>(),organizer=space==='organizer';
  const tab=sectionFor(space,section);
  const setTab=(id:string)=>router.replace(pathFor(space,id) as any);
  const {isDesktop,width}=useResponsive();
  const {state:sharedState,loading,refresh:refreshState}=useAppState();
  const {events}=useEvents(); const {signOut}=useAuth();
  const state:Row={...sharedState,competitions:events};
  const [selected,setSelected]=useState<string|null>(competitionId||null),[detail,setDetail]=useState<Row|null>(null);
  const [form,setForm]=useState<FormConfig|null>(null),[message,setMessage]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const {filters,update}=useFilters(); const {sport,query,city,level,kind}=filters;
  const setSport=(sport:string)=>update({sport}),setQuery=(query:string)=>update({query}),setCity=(city:string)=>update({city}),setLevel=(level:string)=>update({level}),setKind=(kind:string)=>update({kind});
  const [detailTab,setDetailTab]=useState(params.view||'overview'),[pass,setPass]=useState<Row|null>(null);
  const [scanCompetition,setScanCompetition]=useState<string|null>(null),[schedulePreview,setSchedulePreview]=useState<Row|null>(null);
  const user=state.user;
  const [orgFilter,setOrgFilter]=useState('all'),[statusFilter,setStatusFilter]=useState('all');
  const managed=state.competitions.filter((x:Row)=>state.organizations.some((o:Row)=>o.id===x.org_id));
  const workspace=state.organizer || {registrations:[],agenda:[],metrics:[]};
  const ownCompetitions=managed.filter((x:Row)=>orgFilter==='all'||x.org_id===orgFilter);
  const canEdit=(orgId:string)=>user?.role==='admin'||state.organizations.some((o:Row)=>o.id===orgId&&['owner','manager'].includes(o.role));
  const canScan=(orgId:string)=>user?.role==='admin'||state.organizations.some((o:Row)=>o.id===orgId&&['owner','manager','checkin'].includes(o.role));
  useEffect(()=>{setDetailTab(['overview','matches','ranking','roster'].includes(params.view||'')?params.view!:'overview');},[competitionId,params.view]);
  async function refresh(){const next=await refreshState(true);if(selected)setDetail(await api(`/competitions/${selected}`));return next;}
  useEffect(()=>{setSelected(competitionId||params.competition||null);setDetail(null);setForm(null);setPass(null);setScanCompetition(null);setSchedulePreview(null);setError('');},[user?.id,competitionId,params.competition]);
  useEffect(()=>{let current=true;if(selected){setDetail(null);api(`/competitions/${selected}`).then(value=>{if(current)setDetail(value);}).catch(e=>{if(current)setError(e.message);});}return()=>{current=false;};},[selected,user?.id]);
  async function act(fn:()=>Promise<any>,success='Cambios guardados.'){
    if(busy)return;
    setBusy(true);setError('');setMessage('');
    try{const result=await fn();await refresh();setMessage(success);return result;}catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  function openCompetition(id:string,view='overview'){router.push((competitionPath(space,id)+(view==='overview'?'':'?view='+view)) as any);}
  function navigate(t:string){setTab(t);setSelected(null);setError('');setMessage('');}
  function authForm(register=false){router.push({pathname:register?'/(auth)/register':'/(auth)/login',params:{intent:space,...(selected?{next:competitionPath(space,selected)}:{})}} as any);}
  function mustLogin(fn:()=>void){if(user)fn();else authForm();}
  function simple(title:string,fields:Field[],action:string,extra:Row={},initial:Row={},success='Cambios guardados.'){
    setForm({title,fields,initial,run:async v=>{await command(action,{...extra,...v});await refresh();setMessage(success);}});
  }
  function createCompetition(orgId?:string,challenge=false){
    if(!challenge){router.push({pathname:'/(creator)/create-event',params:{org:orgId||''}} as any);return;}
    const next=madridParts(new Date(Date.now()+7*86400000)),close=madridParts(new Date(Date.now()+6*86400000));
    setForm({title:'Crea un desafío gratuito',intro:'Un partido entre dos parejas o equipos. Indica cuándo y dónde jugar. Guardaremos un borrador para que lo revises y lo publiques desde tu espacio organizador.',
      initial:{sport:'padel',city:'Sevilla',level:'intermediate',date:next.date,time:'18:00',closeDate:close.date,closeTime:'20:00',description:'Partido amateur para mayores de 18 años. Respeto al rival y juego limpio.',rules:'Mayores de 18 años. Pádel: mejor de tres sets completos, tie-break a 6–6. Fútbol 7: dos tiempos de 25 minutos y penaltis si hay empate. Participación gratuita. La organización debe confirmar la disponibilidad de la sede.'},
      fields:[{key:'title',label:'Nombre del desafío'},{key:'sport',label:'Deporte',type:'select',options:sportOptions},{key:'city',label:'Ciudad'},{key:'venue',label:'Club, sede y dirección'},{key:'level',label:'Nivel',type:'select',options:levelOptions},{key:'date',label:'Día del partido',type:'date'},{key:'time',label:'Hora del partido',hint:'HH:MM · hora de Madrid'},{key:'closeDate',label:'Día de cierre de inscripciones',type:'date'},{key:'closeTime',label:'Hora de cierre',hint:'HH:MM · hora de Madrid'},{key:'description',label:'Descripción',type:'multiline'},{key:'rules',label:'Reglas',type:'multiline'}],submit:'Guardar y revisar desafío',
      run:async v=>{const result=await command('challenge.create',{...v,entry_mode:'team',starts_at:madridToIso(v.date,v.time),registration_closes_at:madridToIso(v.closeDate,v.closeTime)});await refresh();router.push(competitionPath('organizer',result.id) as any);}});
  }

  function registerCompetition(comp:Row){
    mustLogin(()=>{
      const guide=registrationGuide(comp,user,state.teams,state.registrations);const teams=guide.teams;
      if(guide.kind==='existing'){navigate('activity');return;}
      if(guide.kind!=='ready'){setError(guide.body);return;}
      if(comp.entry_mode==='team'&&!teams.length){setError('Crea un equipo de este deporte e invita a sus jugadores antes de inscribirlo.');return;}
      setForm({title:'Confirma tu inscripción',intro:`${comp.title} · ${comp.price_cents?money(comp.price_cents):'Gratis'} por ${comp.entry_mode==='team'?'equipo':'persona'}. ${state.paymentMode==='simulated'?'No se cobrará dinero.':''}\n\n${comp.rules}`,
        initial:{team_id:teams[0]?.id,accept_rules:false},submit:comp.price_cents?'Continuar al pago':'Confirmar inscripción',
        fields:[...(comp.entry_mode==='team'?[{key:'team_id',label:'Tu equipo',type:'select',options:teams.map((t:Row)=>({value:t.id,label:t.name+' · '+t.members.length+' jugadores'}))}]:[]),{key:'accept_rules',label:'He leído y acepto las reglas y la política de cancelación.',type:'check'}] as Field[],
        run:async v=>{const r=await command('registration.create',{...v,competition_id:comp.id,terms_version:TERMS_VERSION});await refresh();setMessage(r.status==='pending'?'Plaza reservada. Completa el pago en Mi actividad.':r.status==='waitlisted'?'Estás en lista de espera.':'Inscripción confirmada.');setSelected(null);router.push(pathFor('player','activity') as any);}});
    });
  }
  function resultForm(match:Row,resolve=false){
    const racquet=['padel','tennis'].includes(detail?.competition.sport);
    setForm({title:resolve?'Resolver incidencia':'Proponer resultado',intro:racquet?'Al mejor de tres sets completos, con tie-break a 6–6.':'El rival o una persona autorizada de organización deberá confirmar el resultado.',
      initial:racquet?{sets:'6-4, 6-3'}:{home:'0',away:'0',tiebreak:''},
      fields:[...(racquet?[{key:'sets',label:'Sets (ejemplo: 6-4, 3-6, 7-5)'}]:[{key:'home',label:'Local',type:'number'},{key:'away',label:'Visitante',type:'number'},{key:'tiebreak',label:'Penaltis si hay empate eliminatorio (ejemplo: 4-3)'}]),...(resolve?[{key:'reason',label:'Motivo de la resolución',type:'multiline'}]:[])] as Field[],
      run:async v=>{
        const score=racquet?{sets:String(v.sets).split(',').map(x=>x.trim().split('-').map(Number))}:{home:Number(v.home),away:Number(v.away),...(v.tiebreak?{tiebreak:v.tiebreak.split('-').map(Number)}:{})};
        await command(resolve?'match.resolve':'match.propose',{match_id:match.id,version:match.version,score,...(resolve?{reason:v.reason}:{})});await refresh();setMessage(resolve?'Resultado resuelto.':'Resultado propuesto.');}});
  }
  function prepareSchedule(comp:Row,previous?:Row){
    const start=madridParts(previous?.starts_at|| (Date.parse(comp.starts_at)>Date.now()?comp.starts_at:new Date(Date.now()+864e5).toISOString()));
    setSchedulePreview(null);setError('');
    setForm({title:'Prepara el calendario',intro:'Elige las pistas y la franja diaria. Primero verás los partidos propuestos; las inscripciones seguirán abiertas hasta que publiques el calendario.',
      initial:{date:start.date,time:start.time,courts:String(previous?.courts||1),duration_minutes:String(previous?.duration_minutes||(comp.sport==='football7'?60:75)),break_minutes:String(previous?.break_minutes??15),day_start:previous?.day_start||'09:00',day_end:previous?.day_end||'23:00',round_interval_days:String(previous?.round_interval_days??(comp.format==='league'?7:0))},
      fields:[{key:'date',label:'Fecha del primer partido',type:'date'},{key:'time',label:'Hora del primer partido',hint:'HH:MM · hora de Madrid'},{key:'courts',label:comp.sport==='football7'?'Número de campos disponibles':'Número de pistas disponibles',type:'number',hint:'De 1 a 12. Se numerarán dentro de la sede.'},{key:'duration_minutes',label:'Duración de cada partido (minutos)',type:'number'},{key:'break_minutes',label:'Descanso entre partidos (minutos)',type:'number'},{key:'day_start',label:'Hora de apertura cada día',hint:'HH:MM'},{key:'day_end',label:'Hora de cierre cada día',hint:'HH:MM. Ningún partido terminará después.'},{key:'round_interval_days',label:comp.format==='league'?'Días entre jornadas de liga':'Días entre rondas',type:'number',hint:comp.format==='league'?'7 para una jornada semanal. 0 para disputar todo seguido.':'0 para disputar las rondas seguidas dentro de la franja diaria.'}],submit:'Revisar calendario',
      run:async values=>{const schedule={starts_at:madridToIso(values.date,values.time),courts:Number(values.courts),duration_minutes:Number(values.duration_minutes),break_minutes:Number(values.break_minutes),day_start:values.day_start,day_end:values.day_end,round_interval_days:Number(values.round_interval_days)};const preview=await command('competition.preview',{competition_id:comp.id,schedule});setSchedulePreview({...preview,competition_id:comp.id,title:comp.title});}});
  }
  function scheduleForm(match:Row){
    const local=madridParts(match.starts_at);
    setForm({title:'Editar horario',intro:'Horarios de Madrid. Se comprueba que no coincidan pista ni jugadores.',initial:{date:local.date,time:local.time,court:match.court,duration_minutes:String(match.duration_minutes)},
      fields:[{key:'date',label:'Fecha del partido',type:'date'},{key:'time',label:'Hora del partido',hint:'HH:MM · hora de Madrid'},{key:'court',label:'Sede y pista'},{key:'duration_minutes',label:'Duración en minutos',type:'number'}],
      run:async v=>{await command('match.schedule',{...v,starts_at:madridToIso(v.date,v.time),match_id:match.id,version:match.version,duration_minutes:Number(v.duration_minutes)});await refresh();setMessage('Horario actualizado.');}});
  }
  const available=state.competitions.filter((x:Row)=>!['draft','cancelled','completed'].includes(x.status) && (sport==='all'||x.sport===sport) && (level==='all'||x.level===level||x.level==='open') && (kind==='all'||x.format===kind) && x.city.toLowerCase().includes(city.toLowerCase()) && `${x.title} ${x.venue}`.toLowerCase().includes(query.toLowerCase()));
  const tabs=spaceTabs(space,user?.role==='admin');
  const tabButton=(item:Row,mobile=false)=><Pressable key={item.id} accessibilityRole="tab" accessibilityState={{selected:tab===item.id&&!selected}} onPress={()=>navigate(item.id)} style={[mobile?styles.mobileTab:styles.navItem,tab===item.id&&!selected&&{backgroundColor:c.lime+'15'}]}>
    <Ionicons name={item.icon as any} size={mobile?21:20} color={tab===item.id?c.lime:c.muted}/><Text style={{fontSize:mobile?10:14,fontWeight:'600',color:tab===item.id?c.lime:c.muted}}>{item.label}</Text>
  </Pressable>;
  function competitionCard(comp:Row){
    const accent=sportColors[comp.sport],ratio=Math.min(100,comp.occupied/comp.capacity*100);
    return <Pressable key={comp.id} accessibilityRole="button" accessibilityLabel={`Ver ${comp.title}`} onPress={()=>openCompetition(comp.id)} style={({pressed})=>[styles.card,{width:isDesktop?'48.5%':'100%',opacity:pressed?.8:1}]}>
      <View style={{backgroundColor:accent+'0B',padding:20,overflow:'hidden',height:148}}>
        <View style={[s.row,{justifyContent:'space-between'}]}><Badge color={accent}>{sports[comp.sport as Sport].toUpperCase()}</Badge><Text style={s.caption}>{formats[comp.format as Format]}</Text></View>
        <View style={{position:'absolute',right:-5,top:24,transform:[{rotate:'-9deg'}]}}><Court color={accent} width={210} height={130}/></View>
        <Text style={{color:c.text,fontSize:35,fontWeight:'800',marginTop:24,letterSpacing:-1}}>{new Date(comp.starts_at).getDate().toString().padStart(2,'0')}<Text style={{fontSize:14,color:c.muted}}> / {new Intl.DateTimeFormat('es',{month:'short'}).format(new Date(comp.starts_at))}</Text></Text>
      </View>
      <View style={{padding:20,gap:11}}><Text style={s.h3}>{comp.title}</Text><Text style={s.caption}>{comp.city} · {comp.venue}</Text><View style={[s.row,{justifyContent:'space-between'}]}><Text style={{color:accent,fontWeight:'600',fontSize:12}}>{labels[comp.status]}</Text><Text style={s.caption}>{comp.level==='open'?'Todos los niveles':labels[comp.level]}</Text></View>
        <View style={{height:3,backgroundColor:c.line,borderRadius:3}}><View style={{height:3,width:`${ratio}%`,backgroundColor:accent,borderRadius:3}}/></View>
        <View style={[s.row,{justifyContent:'space-between'}]}><Text style={s.caption}>{comp.occupied}/{comp.capacity} plazas de {comp.entry_mode==='team'?'equipos':'jugadores'}</Text><Text style={{color:c.text,fontWeight:'800',fontSize:18}}>{comp.price_cents?money(comp.price_cents):'Gratis'} <Text style={s.caption}>↗</Text></Text></View>
      </View>
    </Pressable>;
  }
  function discover(){return <>
    <Heading eyebrow="PÁDEL Y FÚTBOL 7" title="Explorar competiciones" subtitle="Elige tu deporte, ciudad y nivel. Abre una competición para ver las plazas, las reglas y cómo inscribirte."/>
    <View style={[s.row,{justifyContent:'space-between',flexWrap:'wrap',marginBottom:20}]}><Text style={s.caption}>{available.length} competiciones</Text><Button small secondary onPress={()=>mustLogin(()=>createCompetition(undefined,true))}>Crear desafío gratuito</Button></View>
    <View style={[s.row,{flexWrap:'wrap',marginBottom:14}]}>{[{value:'all',label:'Todos'},...sportOptions].map(x=><Pressable accessibilityRole="button" key={x.value} onPress={()=>setSport(x.value)} style={[s.chip,sport===x.value&&s.chipActive]}><Text style={{color:sport===x.value?c.ink:c.text,fontWeight:'600',fontSize:13}}>{x.label}</Text></Pressable>)}</View>
    <View style={[s.row,{marginBottom:14,flexWrap:'wrap'}]}><TextInput accessibilityLabel="Buscar competición" placeholder="Buscar competición o sede" placeholderTextColor={c.muted} style={[s.input,{flexGrow:2,flexBasis:190}]} value={query} onChangeText={setQuery}/><TextInput accessibilityLabel="Ciudad" placeholder="Ciudad" placeholderTextColor={c.muted} style={[s.input,{flexGrow:1,flexBasis:120}]} value={city} onChangeText={setCity}/></View>
    <View style={[s.row,{flexWrap:'wrap',marginBottom:22}]}>
      <Button small secondary onPress={()=>setForm({title:'Filtrar competiciones',initial:{level,kind},fields:[{key:'level',label:'Nivel',type:'select',options:[{value:'all',label:'Cualquier nivel'},...levelOptions.filter(x=>x.value!=='open')]},{key:'kind',label:'Formato',type:'select',options:[{value:'all',label:'Todos'},...Object.entries(formats).map(([value,label])=>({value,label}))]}],run:async v=>{setLevel(v.level);setKind(v.kind);}})}>Filtros · {level==='all'?'cualquier nivel':labels[level]} · {kind==='all'?'todos los formatos':formats[kind as Format]}</Button>
    </View>
    <View style={[s.row,{flexWrap:'wrap',gap:18,alignItems:'stretch'}]}>{available.map(competitionCard)}</View>
    {!available.length&&<Empty title="Todavía no hay una ronda aquí." body="Prueba otro deporte o una ciudad cercana. También puedes proponer un desafío gratuito."/>}
  </>;}
  function activity(){return <>
    <Heading eyebrow="TU TEMPORADA" title="Mi actividad" subtitle="Tus inscripciones, partidos y pases de acceso."/>
    <View style={[s.row,{marginBottom:20,flexWrap:'wrap'}]}><Button secondary onPress={()=>navigate('calendar')}>Ver mi agenda de partidos</Button></View>
    {!user?<Empty title="Tu próxima ronda te espera" body="Inicia sesión para ver tus inscripciones."><Button onPress={()=>authForm()}>Entrar</Button></Empty>:<>
      {!state.registrations.length&&<Empty title="Aún no tienes inscripciones" body="Elige una competición y apunta a tu equipo."><Button onPress={()=>navigate('discover')}>Ver competiciones</Button></Empty>}
      {state.registrations.map((r:Row)=><View style={[s.panel,{gap:12,marginBottom:14}]} key={r.id}><View style={[s.row,{justifyContent:'space-between',flexWrap:'wrap'}]}><Text style={[s.h3,{flex:1}]}>{r.title}</Text><Badge color={r.status==='confirmed'?c.lime:c.coral}>{labels[r.status]}</Badge></View><Text style={s.body}>{r.display_name} · {money(r.amount_cents)}{r.provider==='simulated'?' · Pago simulado':''}</Text>
        <View style={[s.row,{flexWrap:'wrap'}]}><Button secondary small onPress={()=>openCompetition(r.competition_id)}>Ver competición</Button>
          {r.status==='confirmed'&&!r.checked_in_at&&['open','running'].includes(state.competitions.find((x:Row)=>x.id===r.competition_id)?.status)&&<Button small onPress={()=>setPass(r)}>Mi pase QR</Button>}{r.checked_in_at&&<Badge color={c.blue}>Acceso validado</Badge>}
          {r.status==='pending'&&r.user_id===user.id&&<Button small disabled={busy} onPress={()=>act(async()=>{if(r.provider==='simulated')await command('payment.simulate',{registration_id:r.id});else{const x=await api('/checkout',{registration_id:r.id});await Linking.openURL(x.url);}},r.provider==='simulated'?'Pago simulado confirmado. No se ha cobrado dinero.':'Consulta la confirmación al volver del pago.')}>{r.provider==='simulated'?'Simular pago':'Pagar inscripción'}</Button>}
          {r.status==='waitlisted'&&r.user_id===user.id&&<Button small onPress={()=>act(()=>command('registration.claim',{registration_id:r.id}),'Plaza reclamada. Revisa si queda un pago pendiente.')}>Reclamar plaza</Button>}
          {['pending','confirmed','waitlisted'].includes(r.status)&&r.user_id===user.id&&state.competitions.find((x:Row)=>x.id===r.competition_id)?.status==='open'&&<Button small secondary onPress={()=>simple('Cancelar inscripción',[{key:'reason',label:'Motivo de cancelación',type:'multiline'}],'registration.cancel',{registration_id:r.id},{reason:'No puedo asistir.'},'Cancelación tramitada.')}>Cancelar</Button>}
        </View></View>)}
      <Text style={[s.h3,{marginTop:22,marginBottom:14}]}>Tus avisos</Text>{state.notifications.length===0&&<Text style={s.body}>Estás al día.</Text>}
      {state.notifications.map((n:Row)=><Pressable key={n.id} onPress={()=>act(()=>command('notification.read',{id:n.id}),'Aviso leído.')} style={[s.panel,{marginBottom:10,opacity:n.read_at?.65:1}]}><Text style={[s.label,{marginBottom:6}]}>{!n.read_at?'● ':''}{n.title}</Text><Text style={s.body}>{n.message}</Text></Pressable>)}
    </>}
  </>;}
  function teams(){return <>{params.competitionToJoin&&/^[0-9a-f-]{36}$/.test(params.competitionToJoin)&&<View style={{marginBottom:18}}><Button secondary onPress={()=>openCompetition(params.competitionToJoin!)}>Volver a la competición para inscribirme</Button></View>}<TeamsPanel state={state} refresh={refresh} login={()=>authForm()} explore={()=>navigate('discover')}/></>;}
  function organize(){return <>
    <Heading eyebrow="TU CLUB" title={state.organizations.length?'Mi club y personal':'Crea tu club'} subtitle={state.organizations.length?'Organizaciones, verificación y permisos de tu personal.':'Crea tu club, solicita la verificación y prepara tu primera competición de pádel o fútbol 7.'}/>
    <Button onPress={()=>mustLogin(()=>simple('Solicita un perfil de organizador',[{key:'name',label:'Nombre del club u organización'},{key:'city',label:'Ciudad'}],'organization.create',{}, {city:'Sevilla'},'Organización creada. Ya puedes preparar borradores. Administración debe verificarla antes de publicar torneos o ligas.'))}>Crear organización</Button>
    {state.organizations.map((o:Row)=><View key={o.id} style={[s.panel,{marginTop:18,gap:14}]}>
      <View style={[s.row,{justifyContent:'space-between',flexWrap:'wrap'}]}><Text style={s.h3}>{o.name}</Text><Badge color={o.verified?c.lime:c.coral}>{o.verified?'Verificado':'Pendiente de revisión'}</Badge></View><Text style={s.caption}>{o.city} · {labels[o.role] || 'Administración'}</Text>
      <View style={[s.row,{flexWrap:'wrap'}]}>{['owner','manager'].includes(o.role)||user?.role==='admin'?<Button small onPress={()=>createCompetition(o.id)}>Crear competición</Button>:null}
      {o.role==='owner'||user?.role==='admin'?<Button small secondary onPress={()=>simple('Gestiona los permisos',[{key:'email',label:'Email de una cuenta registrada'},{key:'role',label:'Permiso',type:'select',options:[{value:'manager',label:'Gestión'},{value:'referee',label:'Resultados'},{value:'checkin',label:'Acceso QR'},{value:'remove',label:'Retirar acceso'}]}],'organization.member',{org_id:o.id},{role:'checkin'})}>Añadir / cambiar personal</Button>:null}</View>
      {state.orgMembers.filter((m:Row)=>m.org_id===o.id).map((m:Row)=><Text key={m.user_id} style={s.caption}>{m.name} · {labels[m.role]}</Text>)}
      {state.competitions.filter((x:Row)=>x.org_id===o.id).map((x:Row)=><Pressable key={x.id} accessibilityRole="button" onPress={()=>openCompetition(x.id)} style={{paddingVertical:14,borderTopColor:c.line,borderTopWidth:1}}><Text style={s.label}>{x.title}  ↗</Text><Text style={s.caption}>{labels[x.status]} · {x.confirmed_count} confirmaciones</Text></Pressable>)}
    </View>)}
  </>;}

  function organizationFilter(){return state.organizations.length>1?<ScrollView horizontal contentContainerStyle={{gap:8,paddingBottom:18}}>{[{id:'all',name:'Todas mis organizaciones'},...state.organizations].map((o:Row)=><Button key={o.id} small secondary={orgFilter!==o.id} onPress={()=>setOrgFilter(o.id)}>{o.name}</Button>)}</ScrollView>:null;}
  function createForOrganization(){
    const editable=state.organizations.filter((o:Row)=>canEdit(o.id));
    if(!editable.length){navigate('club');return;}
    const chosen=editable.find((o:Row)=>o.id===orgFilter);
    if(chosen||editable.length===1){createCompetition((chosen||editable[0]).id);return;}
    setForm({title:'Elige la organización',initial:{org_id:editable[0].id},fields:[{key:'org_id',label:'Organiza',type:'select',options:editable.map((o:Row)=>({value:o.id,label:o.name}))}],submit:'Continuar',run:async v=>{setTimeout(()=>createCompetition(v.org_id),0);}});
  }
  function agenda(forOrganization:boolean){
    const rows=(forOrganization?workspace.agenda:state.agenda).filter((m:Row)=>!forOrganization||orgFilter==='all'||m.org_id===orgFilter);
    const groups=rows.reduce((acc:Record<string,Row[]>,m:Row)=>{const key=new Intl.DateTimeFormat('es-ES',{weekday:'long',day:'numeric',month:'long',timeZone:'Europe/Madrid'}).format(new Date(m.starts_at));(acc[key]||=[]).push(m);return acc;},{});
    return <><Heading eyebrow={forOrganization?'CADA PARTIDO, EN SU SITIO':'TU AGENDA'} title={forOrganization?'Calendario de mis competiciones':'Mi agenda de partidos'} subtitle={forOrganization?'Horarios y pistas de tus competiciones. Abre un partido para ajustar su horario o resolver un resultado.':'Los partidos de las inscripciones confirmadas de tus equipos, con hora de Madrid.'}/>{forOrganization&&organizationFilter()}
      {!rows.length&&<Empty title="Todavía no hay partidos en la agenda" body="Aparecerán cuando la organización genere el calendario de una competición en la que participes."/>}
      {Object.entries(groups).map(([day,matches])=><View key={day} style={{gap:12,marginBottom:28}}><Text style={[s.eyebrow,{color:c.blue}]}>{day}</Text>{(matches as Row[]).map((m:Row)=><Pressable key={m.id} accessibilityRole="button" accessibilityLabel={`Abrir partido ${m.home_name} contra ${m.away_name}`} onPress={()=>{openCompetition(m.competition_id,'matches');}} style={[s.panel,{gap:10}]}><View style={[s.row,{justifyContent:'space-between',flexWrap:'wrap'}]}><Badge color={sportColors[m.sport]}>{sports[m.sport as Sport]}</Badge><Text style={s.caption}>{labels[m.status]}</Text></View><Text style={s.h3}>{m.home_name||'Por decidir'} <Text style={{color:c.muted}}>vs.</Text> {m.away_name||'Por decidir'}</Text><Text style={s.body}>{date(m.starts_at)} · {m.court}</Text><Text style={s.caption}>{m.title} · Ronda {m.round} ↗</Text></Pressable>)}</View>)}
    </>;
  }
  function organizerPage(){
    if(tab==='profile')return profile();
    if(tab==='club')return organize();
    if(tab==='stats')return <SportsStats/>;
    if(tab==='admin')return admin();
    if(!state.organizations.length)return <><Heading eyebrow="ESPACIO ORGANIZADOR" title={tab==='dashboard'?'Empieza a organizar':tab==='calendar'?'Calendario':tab==='access'?'Accesos QR':tab==='registrations'?'Inscripciones':'Mis competiciones'} subtitle="Necesitas un club propio o acceso a una organización para gestionar competiciones."/><Empty title="Primero, tu club" body="Crea el perfil de tu organización. Después podrás preparar la competición y solicitar la verificación para publicarla. Si colaboras con un club, su responsable puede añadirte desde Mi club."><Button onPress={()=>navigate('club')}>Crear mi club</Button></Empty></>;
    if(tab==='calendar')return agenda(true);
    if(tab==='competitions')return <><Heading eyebrow="DE LA IDEA A LA FINAL" title="Mis competiciones" subtitle="Borradores, inscripciones y jornadas en juego."/>{organizationFilter()}<View style={[s.row,{flexWrap:'wrap',marginBottom:22}]}><Button onPress={createForOrganization}>Crear competición ↗</Button>{['all','draft','open','running','completed'].map(x=><Button key={x} small secondary={statusFilter!==x} onPress={()=>setStatusFilter(x)}>{x==='all'?'Todas':labels[x]}</Button>)}</View><View style={[s.row,{flexWrap:'wrap',gap:18}]}>{ownCompetitions.filter((x:Row)=>statusFilter==='all'||x.status===statusFilter).map(competitionCard)}</View></>;
    if(tab==='registrations'){
      const rows=workspace.registrations.filter((r:Row)=>orgFilter==='all'||r.org_id===orgFilter);
      return <><Heading eyebrow="PLAZAS Y EQUIPOS" title="Inscripciones" subtitle="Consulta los estados y abre una competición para revisar sus participantes."/>{organizationFilter()}{!rows.length&&<Empty title="Sin inscripciones visibles" body="Las inscripciones se muestran según tus permisos en cada organización."/>}{rows.map((r:Row)=><View key={r.id} style={[s.panel,{gap:12,marginBottom:14}]}><View style={[s.row,{justifyContent:'space-between',flexWrap:'wrap'}]}><Text style={s.h3}>{r.display_name}</Text><Badge>{labels[r.status]}</Badge></View><Text style={s.body}>{r.title}</Text><Text style={s.caption}>{r.amount_cents!==undefined?money(r.amount_cents)+' · ':''}{r.checked_in_at?'Acceso validado':'Sin validar'}{r.provider==='simulated'?' · Pago simulado':''}</Text><Button secondary small onPress={()=>{openCompetition(r.competition_id,'roster');}}>Ver inscritos</Button></View>)}</>;
    }
    if(tab==='access'){
      const rows=ownCompetitions.filter((x:Row)=>canScan(x.org_id)&&['open','running'].includes(x.status));
      return <><Heading eyebrow="BIENVENIDOS A LA RONDA" title="Validar accesos QR" subtitle="Selecciona la competición y valida el pase de cada pareja o equipo. Cada pase admite un solo uso."/>{organizationFilter()}{!rows.length&&<Empty title="No tienes accesos pendientes" body="Necesitas permiso de acceso QR y una competición abierta o en juego."/>}{rows.map((x:Row)=><View key={x.id} style={[s.panel,{gap:12,marginBottom:16}]}><Badge color={sportColors[x.sport]}>{sports[x.sport as Sport]}</Badge><Text style={s.h3}>{x.title}</Text><Text style={s.body}>{x.confirmed_count} inscripciones confirmadas · {x.venue}</Text><Button onPress={()=>setScanCompetition(x.id)}>Abrir lector QR</Button></View>)}</>;
    }
    return <OrganizerHome state={state} competitions={ownCompetitions} orgFilter={orgFilter} filter={organizationFilter()} create={createForOrganization} navigate={navigate} openCompetition={openCompetition} canEdit={canEdit}/>;
  }

  function profile(){return <>
    <Heading eyebrow="A TU MANERA" title={user?`Hola, ${user.name.split(' ')[0]}.`:'Sal a jugar.'} subtitle="Un perfil, todos tus equipos y competiciones."/>
    {!user?<View style={[s.panel,{gap:18}]}><Text style={s.body}>Crea tu cuenta para guardar tus equipos, inscripciones y resultados.</Text><Button onPress={()=>authForm(true)}>Crear cuenta</Button><Button secondary onPress={()=>authForm()}>Ya tengo cuenta</Button></View>:<View style={[s.panel,{gap:18}]}><Text style={s.h3}>{user.name}</Text><Text style={s.body}>{user.email} · {user.city} · {labels[user.level]}</Text><Button secondary onPress={()=>simple('Tu perfil',[{key:'name',label:'Nombre visible'},{key:'city',label:'Ciudad'},{key:'level',label:'Nivel',type:'select',options:levelOptions.filter(x=>x.value!=='open')},{key:'marketing_opt_in',label:'Quiero recibir novedades (opcional).',type:'check'}],'profile.update',{},user)}>Editar perfil</Button><Button secondary onPress={()=>setForm({title:'Cambiar contraseña',fields:[{key:'current_password',label:'Contraseña actual',type:'password'},{key:'password',label:'Nueva contraseña (12 caracteres o más)',type:'password'}],run:async v=>{await api('/auth/password',v);await signOut();router.replace('/login');}})}>Cambiar contraseña</Button><Button secondary onPress={()=>setForm({title:'Solicitar eliminación de cuenta',intro:'Cerraremos tu acceso y retiraremos el consentimiento comercial inmediatamente. Administración tramitará la eliminación de tus datos y resolverá las competiciones o pagos pendientes. Los datos necesarios por obligaciones legales se conservarán según la política de privacidad.',fields:[{key:'password',label:'Confirma tu contraseña',type:'password'}],submit:'Solicitar eliminación',run:async v=>{await api('/auth/delete-account',v);await signOut();router.replace('/welcome');}})}>Eliminar mi cuenta</Button><Button secondary onPress={()=>act(async()=>{await signOut();router.replace('/welcome');},'Sesión cerrada.')}>Cerrar sesión</Button></View>}
    <View style={[s.panel,{marginTop:22,gap:12}]}><Text style={s.h3}>Tu cuenta RONDIQO</Text><Button secondary onPress={()=>router.push('/notifications')}>Notificaciones</Button><Button secondary onPress={()=>router.push('/legal/terminos')}>Condiciones y privacidad</Button><Text style={s.body}>Puedes jugar y organizar con la misma cuenta. Utiliza «Cambiar a jugador» o «Cambiar a organizador» para elegir tu espacio.</Text><Text style={s.body}>Acceso para mayores de 18 años por declaración del usuario. No acredita identidad, seguro, reserva de pista ni licencia federativa. Las condiciones comerciales y de privacidad definitivas deben aprobarse antes de aceptar jugadores reales.</Text><Text style={s.caption}>El nombre y los identificadores de la app están pendientes de comprobación de disponibilidad.</Text></View>
  </>;}
  function admin(){return state.admin?<>
    <Heading eyebrow="CONTROL Y TRAZABILIDAD" title="Administración" subtitle="Las decisiones sensibles se registran en el historial de auditoría."/>
    <Text style={[s.h3,{marginBottom:12}]}>Organizadores</Text>{state.organizations.map((o:Row)=><View key={o.id} style={[s.panel,{gap:12,marginBottom:12}]}><Text style={s.label}>{o.name}</Text><Text style={s.caption}>{o.verified?'Verificado':'Pendiente'}</Text><Button secondary small onPress={()=>act(()=>command('admin.verify',{org_id:o.id,verified:!o.verified}),'Verificación actualizada.')}>{o.verified?'Retirar verificación':'Verificar organización'}</Button>{state.paymentMode!=='simulated'&&o.verified&&<Button secondary small onPress={()=>setForm({title:'Vincular cuenta de cobros',intro:'Indica la cuenta Stripe ya conectada de esta organización. Comprueba antes la identidad y titularidad del organizador. No se creará una cuenta nueva.',fields:[{key:'account_id',label:'Cuenta conectada (acct_...)'},{key:'password',label:'Tu contraseña de administrador',type:'password'}],run:async v=>{await api('/admin/payment-account',{...v,org_id:o.id});await refresh();}})}>Vincular Stripe existente</Button>}</View>)}
    <Text style={[s.h3,{marginVertical:18}]}>Cuentas</Text>{state.admin.users.map((u:Row)=><View key={u.id} style={[s.row,{paddingVertical:10,borderBottomWidth:1,borderBottomColor:c.line,justifyContent:'space-between',flexWrap:'wrap'}]}><View><Text style={s.label}>{u.name}</Text><Text style={s.caption}>{u.email}</Text></View>{u.id!==user.id&&<Button small secondary onPress={()=>act(()=>command('admin.suspend',{user_id:u.id,suspended:!u.suspended}),'Estado de cuenta actualizado.')}>{u.suspended?'Reactivar':'Suspender'}</Button>}</View>)}
    <Text style={[s.h3,{marginVertical:18}]}>Reembolsos</Text>{state.admin.refunds.length===0?<Text style={s.body}>Sin reembolsos pendientes.</Text>:state.admin.refunds.map((f:Row)=><Text key={f.id} style={s.body}>{money(f.amount_cents)} · {f.status} · {f.provider}</Text>)}
    {state.paymentMode!=='simulated'&&<Button secondary onPress={()=>act(()=>api('/reconcile',{}),'Conciliación ejecutada.')}>Conciliar pagos</Button>}
    <Text style={[s.h3,{marginVertical:18}]}>Solicitudes de eliminación</Text>{(state.admin.deletions||[]).length===0?<Text style={s.body}>Sin solicitudes.</Text>:(state.admin.deletions||[]).map((d:Row)=><View key={d.user_id} style={[s.panel,{gap:8,marginBottom:12}]}><Text style={s.label}>{d.name}</Text><Text style={s.caption}>{d.email} · {date(d.created_at)} · {d.status}</Text><Text style={s.body}>Tramitar la eliminación y revisar pagos y competiciones pendientes. El acceso ya está cerrado.</Text></View>)}
    <Text style={[s.h3,{marginVertical:18}]}>Últimas operaciones</Text>{state.admin.audit.map((a:Row)=><View key={a.id} style={{paddingVertical:10,borderBottomWidth:1,borderBottomColor:c.line}}><Text style={s.label}>{a.action}</Text><Text style={s.caption}>{date(a.created_at)} · {a.resource_id.slice(0,8)}</Text></View>)}
  </>:<Empty title="Acceso restringido" body="Esta sección requiere una cuenta de administración."/>;}
  function competitionDetail(){
    if(!detail)return error?<Empty title="No hemos podido abrir la competición" body={error}><Button onPress={()=>void act(refresh,'Competición actualizada.')}>Volver a intentarlo</Button><Button secondary onPress={()=>navigate(organizer?'competitions':'discover')}>Volver a competiciones</Button></Empty>:<Loading/>;
    const comp=detail.competition,canManage=organizer&&(state.organizations.some((o:Row)=>o.id===comp.org_id&&['owner','manager'].includes(o.role))||user?.role==='admin');
    const staff=organizer&&(state.organizations.some((o:Row)=>o.id===comp.org_id&&['owner','manager','referee'].includes(o.role))||user?.role==='admin');
    const guide=registrationGuide(comp,user,state.teams,state.registrations);
    const myRegs=state.registrations.filter((r:Row)=>r.competition_id===comp.id&&r.user_id===user?.id);
    const name=(id:string)=>detail.entrants.find((x:Row)=>x.id===id)?.display_name || 'Por decidir';
    const matchCard=(m:Row)=><View key={m.id} style={[s.panel,{gap:12,marginBottom:12}]}>
      <View style={[s.row,{justifyContent:'space-between'}]}><Text style={s.caption}>Ronda {m.round} · Partido {m.position+1}</Text><Badge color={m.status==='confirmed'?c.lime:m.status==='disputed'?c.coral:c.blue}>{labels[m.status]}</Badge></View>
      <View style={[s.row,{justifyContent:'space-between'}]}><Text style={[s.label,{flex:1}]}>{name(m.home)}</Text><Text style={{fontSize:22,fontWeight:'800',color:c.text}}>{m.score?.home ?? '–'}</Text></View>
      <View style={[s.row,{justifyContent:'space-between'}]}><Text style={[s.label,{flex:1}]}>{m.status==='bye'?'Pase directo':name(m.away)}</Text><Text style={{fontSize:22,fontWeight:'800',color:c.text}}>{m.score?.away ?? '–'}</Text></View>
      {m.score?.sets&&<Text style={s.caption}>Sets: {m.score.sets.map((p:number[])=>p.join('–')).join(' / ')}</Text>}{m.score?.tiebreak&&<Text style={s.caption}>Penaltis: {m.score.tiebreak.join('–')}</Text>}
      {m.starts_at&&<Text style={s.caption}>{date(m.starts_at)} · {m.court}</Text>}
      <View style={[s.row,{flexWrap:'wrap'}]}>
        {organizer&&m.actions?.schedule&&<Button small secondary onPress={()=>scheduleForm(m)}>Editar horario</Button>}
        {m.actions?.propose&&(organizer||myRegs.some((r:Row)=>r.id===m.home||r.id===m.away))&&<Button small onPress={()=>resultForm(m)}>Proponer resultado</Button>}
        {m.actions?.confirm&&(organizer||myRegs.some((r:Row)=>r.id===m.home||r.id===m.away))&&<Button small onPress={()=>act(()=>command('match.confirm',{match_id:m.id,version:m.version}),'Resultado confirmado.')}>Confirmar resultado</Button>}
        {m.actions?.dispute&&(organizer||myRegs.some((r:Row)=>r.id===m.home||r.id===m.away))&&<Button small secondary onPress={()=>simple('Abrir incidencia',[{key:'reason',label:'Explica la incidencia',type:'multiline'}],'match.dispute',{match_id:m.id,version:m.version})}>Hay un error</Button>}
        {organizer&&m.actions?.resolve&&<Button small onPress={()=>resultForm(m,true)}>Resolver incidencia</Button>}
      </View>
      {m.status==='proposed'&&!m.actions?.confirm&&<Text style={s.caption}>Pendiente de confirmación por el rival o la organización.</Text>}

    </View>;
    return <>
      <Button small secondary onPress={()=>router.canGoBack()?router.back():navigate(organizer?'competitions':'discover')}>← Volver</Button>
      <View style={{marginTop:24,gap:14}}><View style={[s.row,{flexWrap:'wrap'}]}><Badge color={sportColors[comp.sport]}>{sports[comp.sport as Sport]}</Badge><Badge color={c.blue}>{formats[comp.format as Format]}</Badge><Text style={s.caption}>{labels[comp.status]}</Text></View>
        <Heading title={comp.title} subtitle={`${comp.city} · ${comp.venue} · ${date(comp.starts_at)} (Madrid)`}/>
      </View>
      <View style={[s.row,{flexWrap:'wrap',marginBottom:22}]}>
        {detail.matches.length>0&&<Button secondary onPress={()=>Linking.openURL(`${base || (Platform.OS==='web'?window.location.origin:'http://127.0.0.1:4173')}/api/competitions/${comp.id}/calendar.ics`)}>Añadir al calendario</Button>}
        {comp.status!=='draft'&&<Button secondary onPress={()=>{const root=Platform.OS==='web'?window.location.origin:base;Share.share({message:`${comp.title} · RONDIQO: ${root}${competitionPath('player',comp.id)}`});}}>Compartir</Button>}
        {canManage&&comp.status==='draft'&&<Button secondary onPress={()=>router.push({pathname:'/(creator)/create-event',params:{edit:comp.id}})}>Editar borrador</Button>}
        {canManage&&comp.status==='draft'&&<Button onPress={()=>act(()=>command('competition.publish',{competition_id:comp.id}),'Competición publicada.')}>Publicar</Button>}
        {canManage&&comp.status==='open'&&<Button onPress={()=>prepareSchedule(comp)}>Preparar calendario</Button>}
        {organizer&&detail.canCheckin&&['open','running'].includes(comp.status)&&<Button secondary onPress={()=>setScanCompetition(comp.id)}>Validar QR</Button>}
        {canManage&&['open','running','draft'].includes(comp.status)&&<Button secondary onPress={()=>simple('Cancelar competición',[{key:'reason',label:'Motivo (se notificará a los participantes)',type:'multiline'}],'competition.cancel',{competition_id:comp.id},{},'Competición cancelada. Revisa los reembolsos en administración.')}>Cancelar competición</Button>}
      </View>
      {!organizer&&<View style={[s.panel,{gap:12,marginBottom:22,borderColor:guide.kind==='ready'?c.lime:c.line}]}><Text style={s.h3}>{guide.title}</Text><Text style={s.body}>{guide.body}</Text>{guide.action&&<Button onPress={()=>{if(guide.kind==='ready')registerCompetition(comp);else if(guide.kind==='login')authForm();else if(guide.kind==='existing')navigate('activity');else router.push(('/jugador/equipos?competitionToJoin='+comp.id) as any);}}>{guide.action}{guide.kind==='ready'?' · '+(comp.price_cents?money(comp.price_cents):'Gratis'):''}</Button>}</View>}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{marginBottom:24}} contentContainerStyle={{gap:10}}>
        {[['overview','Información'],['matches',comp.format==='knockout'?'Cuadro y partidos':'Partidos'],['ranking','Clasificación'],...(organizer&&detail.manager?[['roster','Inscritos']]:[])].map(([key,label])=><Pressable key={key} accessibilityRole="tab" accessibilityState={{selected:detailTab===key}} onPress={()=>{setDetailTab(key);router.setParams({view:key});}} style={[s.chip,detailTab===key&&s.chipActive]}><Text style={{color:detailTab===key?c.ink:c.text,fontWeight:'600'}}>{label}</Text></Pressable>)}
      </ScrollView>
      {detailTab==='overview'&&<View style={{gap:18}}><View style={s.panel}><Text style={[s.h3,{marginBottom:10}]}>La próxima ronda</Text><Text style={s.body}>{comp.description}</Text><Text style={[s.body,{marginTop:14}]}>Organiza: {comp.organizer}{comp.verified?' · Organizador verificado':''}{'\n'}Cierre: {date(comp.registration_closes_at)}{'\n'}{comp.capacity} plazas de {comp.entry_mode==='team'?'equipos':'jugadores'} · Nivel {labels[comp.level]||'abierto'}{'\n'}Precio total: {comp.price_cents?money(comp.price_cents):'gratis'} por inscripción</Text></View><View style={s.panel}><Text style={[s.h3,{marginBottom:10}]}>Reglas y cancelación</Text><Text style={s.body}>{comp.rules}</Text></View></View>}
      {detailTab==='matches'&&(detail.matches.length?comp.format==='knockout'?<ScrollView horizontal contentContainerStyle={{gap:16}}>{[...new Set<number>(detail.matches.map((m:Row)=>m.round))].map(round=><View key={round} style={{width:Math.min(330,width-70)}}><Text style={[s.eyebrow,{marginBottom:14}]}>{round===Math.max(...detail.matches.map((m:Row)=>m.round))?'FINAL':`RONDA ${round}`}</Text>{detail.matches.filter((m:Row)=>m.round===round).map(matchCard)}</View>)}</ScrollView>:detail.matches.map(matchCard):<Empty title="El calendario todavía no está listo" body="La organización lo generará cuando termine de confirmar las inscripciones."/> )}
      {detailTab==='ranking'&&<View style={s.panel}><Text style={[s.caption,{marginBottom:18}]}>{comp.format==='knockout'?'El cuadro determina el campeón. Esta tabla resume el rendimiento.':'3 puntos por victoria · 1 por empate · 0 por derrota.'} Desempate: diferencia de marcador, tantos a favor y nombre.</Text>{detail.standings.map((r:Row,i:number)=><View key={r.id} style={[s.row,{paddingVertical:14,borderBottomWidth:1,borderBottomColor:c.line}]}><Text style={{color:i===0?c.lime:c.muted,fontWeight:'900',fontSize:22,width:25}}>{i+1}</Text><View style={{flex:1}}><Text style={s.label}>{r.name}</Text><Text style={s.caption}>{r.played} PJ · {r.won} G · {r.drawn} E · {r.lost} P · {r.for-r.against>0?'+':''}{r.for-r.against} dif.</Text></View><Text style={{color:c.lime,fontWeight:'800',fontSize:21}}>{r.points}</Text></View>)}{!detail.standings.length&&<Text style={s.body}>Sin participantes confirmados.</Text>}</View>}
      {detailTab==='roster'&&<><Text style={[s.body,{marginBottom:18}]}>{detail.entrants.length} inscripciones confirmadas de {comp.capacity} plazas. {detail.canManage?'Puedes consultar la plantilla y gestionar cancelaciones antes del comienzo.':'Los datos visibles corresponden a tus permisos.'}</Text>{!detail.roster.length&&<Empty title="Todavía no hay inscripciones" body="Comparte la competición una vez publicada para que los capitanes inscriban a sus equipos."/>}{detail.roster.map((r:Row)=><View key={r.id} style={[s.panel,{marginBottom:12,gap:10}]}><View style={[s.row,{justifyContent:'space-between',flexWrap:'wrap'}]}><Text style={s.h3}>{r.display_name}</Text><Badge color={r.status==='confirmed'?c.lime:c.coral}>{labels[r.status]}</Badge></View><Text style={s.body}>{r.amount_cents!==undefined?(r.amount_cents?money(r.amount_cents):'Gratis')+' · ':''}{r.checked_in_at?'Acceso validado':'Sin validar'}</Text>{r.contact&&<Text selectable style={s.body}>Responsable: {r.contact.name} · {r.contact.email}</Text>}{r.members&&<View style={{gap:6}}><Text style={s.label}>Plantilla inscrita</Text>{r.members.map((member:Row)=><Text key={member.id} style={s.caption}>{member.name}{member.id===r.user_id?' · Capitán':''}</Text>)}</View>}{detail.canManage&&comp.status==='open'&&['pending','confirmed','waitlisted'].includes(r.status)&&<Button small secondary onPress={()=>setForm({title:'Cancelar inscripción',intro:`${r.display_name} dejará de participar. Se notificará al equipo y se tramitará el reembolso que corresponda según el estado del pago.`,fields:[{key:'reason',label:'Motivo de la cancelación',type:'multiline'}],submit:'Confirmar cancelación',run:async values=>{await command('registration.cancel',{registration_id:r.id,reason:values.reason});await refresh();setMessage('Inscripción cancelada. El equipo recibirá un aviso.');}})}>Cancelar inscripción</Button>}</View>)}</>}
    </>;
  }
  useEffect(()=>{if(Platform.OS==='web'){const p=new URLSearchParams(window.location.search).get('competition');if(p&&/^[0-9a-f-]{36}$/.test(p))setSelected(p);}},[]);
  if(!focused)return null;
  return <><WorkspaceShell space={space} section={tab} detail={!!selected} onRefresh={()=>void act(refresh,'Datos actualizados.')} refreshing={busy}>

      {error&&<Pressable onPress={()=>setError('')} style={[styles.notice,{backgroundColor:'#452825'}]}><Text accessibilityRole="alert" style={{color:c.danger,lineHeight:21}}>{error}  ×</Text></Pressable>}
      {message&&<Pressable onPress={()=>setMessage('')} style={styles.notice}><Text accessibilityRole="alert" style={{color:c.lime,lineHeight:21}}>{message}  ×</Text></Pressable>}
      {loading?<Loading/>:organizer&&!user?<Empty title="Organiza la próxima gran ronda." body="Entra con tu cuenta para gestionar competiciones, inscripciones y personal."><Button onPress={()=>authForm()}>Entrar como organizador</Button><Button secondary onPress={()=>authForm(true)}>Crear cuenta</Button></Empty>:selected?competitionDetail():organizer?organizerPage():tab==='home'?<PlayerHome state={state} navigate={navigate} openCompetition={openCompetition} login={()=>authForm()}/>:tab==='discover'?discover():tab==='activity'?activity():tab==='teams'?teams():tab==='calendar'?agenda(false):profile()}
    </WorkspaceShell><FormDialog form={form} close={()=>setForm(null)}/>
    <Modal visible={!!schedulePreview} transparent animationType="fade" onRequestClose={()=>{if(!busy)setSchedulePreview(null);}}><View style={s.overlay}><View style={[s.dialog,{maxWidth:760,padding:22,gap:14}]}><Text style={s.h3}>Revisa el calendario</Text><Text style={s.body}>{schedulePreview?.title} · {schedulePreview?.matches.filter((m:Row)=>m.status!=='bye').length} partidos. Horas de Madrid.</Text><Text style={s.caption}>Al publicar, se cierran las inscripciones y se avisa a los participantes. Los cruces siguen el orden de inscripción. Comprueba la disponibilidad real de la sede.</Text>
      <ScrollView contentContainerStyle={{gap:12}}>{schedulePreview?.matches.map((match:Row)=><View key={`${match.round}-${match.position}`} style={{paddingVertical:10,borderBottomWidth:1,borderBottomColor:c.line,gap:5}}><Text style={s.label}>Ronda {match.round} · {match.home_name} — {match.away_name}</Text><Text style={s.caption}>{match.starts_at?`${date(match.starts_at)} · ${match.court} · ${match.duration_minutes} min`:'Pase directo a la siguiente ronda'}</Text></View>)}</ScrollView>
      {!!error&&<Text accessibilityRole="alert" style={{color:c.danger}}>{error}</Text>}
      <View style={[s.row,{flexWrap:'wrap'}]}><Button disabled={busy} onPress={()=>void act(async()=>{await command('competition.start',{competition_id:schedulePreview!.competition_id,schedule:schedulePreview!.options,preview_token:schedulePreview!.preview_token});setSchedulePreview(null);setDetailTab('matches');router.setParams({view:'matches'});},'Calendario publicado. Inscripciones cerradas.')}>{busy?'Publicando…':'Publicar calendario'}</Button><Button secondary disabled={busy} onPress={()=>prepareSchedule(detail!.competition,schedulePreview!.options)}>Cambiar opciones</Button><Button secondary disabled={busy} onPress={()=>setSchedulePreview(null)}>Seguir revisando después</Button></View>
    </View></View></Modal>
    {scanCompetition&&<ScanDialog close={()=>setScanCompetition(null)} validate={async token=>{const r=await command('checkin',{competition_id:scanCompetition,token});await refresh();return `Acceso validado: ${r.name}. El pase ya no puede reutilizarse.`;}}/>}
    <Modal visible={!!pass} transparent animationType="fade" onRequestClose={()=>setPass(null)}><View style={s.overlay}><View style={[s.dialog,{padding:28,gap:20,alignItems:'center',maxWidth:400}]}><Logo/><Text style={[s.h3,{textAlign:'center'}]}>{pass?.title}</Text><Text style={s.body}>{pass?.display_name}</Text>{pass&&<View style={{padding:20,backgroundColor:'white',borderRadius:15}}><QRCode value={`rondiqo:${pass.qr_token}`} size={220} backgroundColor="white" color="#0C1718"/></View>}<Text style={s.caption}>Un uso por inscripción. La organización validará el pase.</Text><Text selectable style={{color:c.muted,fontSize:10,textAlign:'center'}}>{pass?`rondiqo:${pass.qr_token}`:''}</Text><Button secondary onPress={()=>setPass(null)}>Cerrar pase</Button></View></View></Modal>
  </>;
}
const styles=StyleSheet.create({
  sidebar:{width:240,padding:25,borderRightWidth:1,borderRightColor:c.line,backgroundColor:'#101E20'},
  navItem:{flexDirection:'row',alignItems:'center',gap:13,paddingVertical:15,paddingHorizontal:13,borderRadius:10},
  mobileTab:{minHeight:52,alignItems:'center',gap:4,padding:8,borderRadius:8,minWidth:65},
  topbar:{height:80,flexShrink:0,borderBottomWidth:1,borderBottomColor:c.line,flexDirection:'row',alignItems:'center',justifyContent:'space-between'},
  hero:{padding:26,borderRadius:22,borderWidth:1,borderColor:c.line,backgroundColor:c.surface,overflow:'hidden'},
  heroTitle:{fontWeight:'900',letterSpacing:-1.8,color:c.text,lineHeight:undefined},
  card:{borderRadius:18,borderColor:c.line,borderWidth:1,overflow:'hidden',backgroundColor:c.surface},
  avatar:{width:36,height:36,borderRadius:12,backgroundColor:c.lime+'18',alignItems:'center',justifyContent:'center'},
  notice:{padding:15,borderRadius:12,backgroundColor:'#263522',marginBottom:20},
});
