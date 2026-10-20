import {madridParts,madridToIso} from '../domain/datetime';
import {useAppState} from '@/lib/AppStateContext';
import {useIsFocused} from 'expo-router';
import {useFilters} from '@/lib/FilterContext';
import {useEvents} from '@/lib/EventContext';
import {useAuth} from '@/lib/AuthContext';
import {NotificationBell} from '@/components/NotificationBell';
import {SportsStats} from '@/components/rondiqo/SportsStats';
import {useRouter,useLocalSearchParams} from 'expo-router';
import {spaceTabs,sectionFor,pathFor} from '../domain/navigation';
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
const sportOptions=Object.entries(sports).map(([value,label])=>({value,label}));
const levelOptions=[{value:'beginner',label:'Iniciación'},{value:'intermediate',label:'Intermedio'},{value:'advanced',label:'Avanzado'},{value:'open',label:'Todos'}];
const stateEmpty={agenda:[],organizer:null,competitions:[],registrations:[],teams:[],organizations:[],orgMembers:[],notifications:[],admin:null,user:null,paymentMode:'simulated'};
export default function SportsApp({space,section,competitionId}:{space:'player'|'organizer';section:string;competitionId?:string}){
  const focused=useIsFocused();
  const router=useRouter(),params=useLocalSearchParams<{competition?:string}>(),organizer=space==='organizer';
  const tab=sectionFor(space,section);
  const setTab=(id:string)=>router.push(pathFor(space,id) as any);
  const {isDesktop,width}=useResponsive();
  const {state:sharedState,loading,refresh:refreshState}=useAppState();
  const {events}=useEvents(); const {signOut}=useAuth();
  const state:Row={...sharedState,competitions:events};
  const [selected,setSelected]=useState<string|null>(competitionId||null),[detail,setDetail]=useState<Row|null>(null);
  const [form,setForm]=useState<FormConfig|null>(null),[message,setMessage]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const {filters,update}=useFilters(); const {sport,query,city,level,kind}=filters;
  const setSport=(sport:string)=>update({sport}),setQuery=(query:string)=>update({query}),setCity=(city:string)=>update({city}),setLevel=(level:string)=>update({level}),setKind=(kind:string)=>update({kind});
  const [detailTab,setDetailTab]=useState('overview'),[pass,setPass]=useState<Row|null>(null);
  const [scanCompetition,setScanCompetition]=useState<string|null>(null);
  const user=state.user;
  const [orgFilter,setOrgFilter]=useState('all'),[statusFilter,setStatusFilter]=useState('all');
  const managed=state.competitions.filter((x:Row)=>state.organizations.some((o:Row)=>o.id===x.org_id));
  const workspace=state.organizer || {registrations:[],agenda:[],metrics:[]};
  const ownCompetitions=managed.filter((x:Row)=>orgFilter==='all'||x.org_id===orgFilter);
  const canEdit=(orgId:string)=>user?.role==='admin'||state.organizations.some((o:Row)=>o.id===orgId&&['owner','manager'].includes(o.role));
  const canScan=(orgId:string)=>user?.role==='admin'||state.organizations.some((o:Row)=>o.id===orgId&&['owner','manager','checkin'].includes(o.role));
  function switchSpace(){
    setSelected(null);
    router.push(pathFor(organizer?'player':'organizer',organizer?'discover':'dashboard') as any);
  }
  async function refresh(){const next=await refreshState(true);if(selected)setDetail(await api(`/competitions/${selected}`));return next;}
  useEffect(()=>{setSelected(competitionId||params.competition||null);setDetail(null);setForm(null);setPass(null);setScanCompetition(null);setError('');},[user?.id,competitionId,params.competition]);
  useEffect(()=>{let current=true;if(selected){setDetail(null);api(`/competitions/${selected}`).then(value=>{if(current)setDetail(value);}).catch(e=>{if(current)setError(e.message);});}return()=>{current=false;};},[selected,user?.id]);
  async function act(fn:()=>Promise<any>,success='Cambios guardados.'){
    if(busy)return;
    setBusy(true);setError('');setMessage('');
    try{const result=await fn();await refresh();setMessage(success);return result;}catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  function openCompetition(id:string){setSelected(id);setDetailTab('overview');setError('');setMessage('');}
  function navigate(t:string){setTab(t);setSelected(null);setError('');setMessage('');}
  function authForm(register=false){router.push({pathname:register?'/(auth)/register':'/(auth)/login',params:{intent:space}} as any);}
  function mustLogin(fn:()=>void){if(user)fn();else authForm();}
  function simple(title:string,fields:Field[],action:string,extra:Row={},initial:Row={},success='Cambios guardados.'){
    setForm({title,fields,initial,run:async v=>{await command(action,{...extra,...v});await refresh();setMessage(success);}});
  }
  function createCompetition(orgId?:string,challenge=false){
    if(!challenge){router.push({pathname:'/(creator)/create-event',params:{org:orgId||''}} as any);return;}
    const next=new Date(Date.now()+7*86400000);next.setUTCHours(17,0,0,0);
    setForm({title:challenge?'Propón un desafío':'Crea una competición',
      intro:challenge?'Desafío gratuito entre dos equipos. Reúne a los jugadores, acuerda la pista y publica las normas.':'Precio total por equipo o participante, sin recargo adicional al jugador. Los pagos de esta demo son simulados.',
      initial:{title:'',sport:'padel',format:challenge?'challenge':'knockout',entry_mode:'team',city:'Sevilla',venue:'',level:'intermediate',capacity:'8',price:'0',starts_at:next.toISOString(),registration_closes_at:new Date(next.getTime()-86400000).toISOString(),rules:'Mayores de 18 años. Pádel: mejor de tres sets, tie-break a 6–6. Fútbol 7: 2 tiempos de 25 minutos; empate permitido en liga, penaltis en eliminatoria. Reembolso íntegro antes del comienzo; después, gestión manual por organización.',description:'Competición amateur. Respeto al rival y juego limpio.'},
      fields:[{key:'title',label:'Nombre de la competición'},{key:'sport',label:'Deporte',type:'select',options:sportOptions},
        ...(!challenge?[{key:'format',label:'Formato',type:'select',options:Object.entries(formats).map(([value,label])=>({value,label}))}]:[]),
        {key:'entry_mode',label:'Participantes',type:'select',options:[{value:'team',label:'Parejas / equipos'},{value:'individual',label:'Individual (tenis)'}]},
        {key:'city',label:'Ciudad'},{key:'venue',label:'Sede / dirección'},{key:'level',label:'Nivel',type:'select',options:levelOptions},
        ...(!challenge?[{key:'capacity',label:'Plazas de equipos o participantes',type:'number'},{key:'price',label:'Precio total por inscripción (€)',type:'number'}]:[]),
        {key:'starts_at',label:'Inicio',hint:'Formato ISO con zona: 2026-11-15T18:00:00+01:00. La app muestra hora de Madrid.'},
        {key:'registration_closes_at',label:'Cierre de inscripciones',hint:'Debe ser anterior o igual al inicio.'},
        {key:'description',label:'Descripción',type:'multiline'},{key:'rules',label:'Reglas y cancelación',type:'multiline'}] as Field[],
      run:async v=>{
        if(!/^\d+([.,]\d{1,2})?$/.test(String(v.price)))throw new Error('Usa un precio con un máximo de dos decimales.');
        const result=await command(challenge?'challenge.create':'competition.create',{...v,...(orgId?{org_id:orgId}:{}),capacity:Number(v.capacity),price_cents:Math.round(Number(String(v.price).replace(',','.'))*100)});
        await refresh();setSelected(result.id);setDetailTab('overview');setMessage('Borrador creado. Revísalo antes de publicar.');
      }});
  }
  function registerCompetition(comp:Row){
    mustLogin(()=>{
      const teams=state.teams.filter((t:Row)=>t.sport===comp.sport && t.captain_id===user.id);
      if(comp.entry_mode==='team'&&!teams.length){setError('Crea un equipo de este deporte e invita a sus jugadores antes de inscribirlo.');return;}
      setForm({title:'Reserva tu próxima ronda',intro:`${comp.title} · ${comp.price_cents?money(comp.price_cents):'Gratis'} por ${comp.entry_mode==='team'?'equipo':'persona'}. ${state.paymentMode==='simulated'?'No se cobrará dinero.':''}\n\n${comp.rules}`,
        initial:{team_id:teams[0]?.id,accept_rules:false},submit:comp.price_cents?'Continuar al pago':'Confirmar inscripción',
        fields:[...(comp.entry_mode==='team'?[{key:'team_id',label:'Tu equipo',type:'select',options:teams.map((t:Row)=>({value:t.id,label:t.name}))}]:[]),{key:'accept_rules',label:'He leído y acepto las reglas y la política de cancelación.',type:'check'}] as Field[],
        run:async v=>{const r=await command('registration.create',{...v,competition_id:comp.id,terms_version:TERMS_VERSION});await refresh();setMessage(r.status==='pending'?'Plaza reservada. Completa el pago en Mi actividad.':r.status==='waitlisted'?'Estás en lista de espera.':'Inscripción confirmada.');setSelected(null);router.push(pathFor('player','activity') as any);}});
    });
  }
  function resultForm(match:Row,resolve=false){
    const racquet=['padel','tennis'].includes(detail?.competition.sport);
    setForm({title:resolve?'Resolver incidencia':'Proponer resultado',intro:racquet?'Formato del piloto: al mejor de tres sets completos, con tie-break a 6–6.':'El rival o una persona autorizada de organización deberá confirmar el resultado.',
      initial:racquet?{sets:'6-4, 6-3'}:{home:'0',away:'0',tiebreak:''},
      fields:[...(racquet?[{key:'sets',label:'Sets (ejemplo: 6-4, 3-6, 7-5)'}]:[{key:'home',label:'Local',type:'number'},{key:'away',label:'Visitante',type:'number'},{key:'tiebreak',label:'Penaltis si hay empate eliminatorio (ejemplo: 4-3)'}]),...(resolve?[{key:'reason',label:'Motivo de la resolución',type:'multiline'}]:[])] as Field[],
      run:async v=>{
        const score=racquet?{sets:String(v.sets).split(',').map(x=>x.trim().split('-').map(Number))}:{home:Number(v.home),away:Number(v.away),...(v.tiebreak?{tiebreak:v.tiebreak.split('-').map(Number)}:{})};
        await command(resolve?'match.resolve':'match.propose',{match_id:match.id,version:match.version,score,...(resolve?{reason:v.reason}:{})});await refresh();setMessage(resolve?'Resultado resuelto.':'Resultado propuesto.');}});
  }
  function scheduleForm(match:Row){
    const local=madridParts(match.starts_at);
    setForm({title:'Editar horario',intro:'Horarios de Madrid. Se comprueba que no coincidan pista ni jugadores.',initial:{date:local.date,time:local.time,court:match.court,duration_minutes:String(match.duration_minutes)},
      fields:[{key:'date',label:'Fecha del partido',hint:'AAAA-MM-DD'},{key:'time',label:'Hora del partido',hint:'HH:MM · hora de Madrid'},{key:'court',label:'Sede y pista'},{key:'duration_minutes',label:'Duración en minutos',type:'number'}],
      run:async v=>{await command('match.schedule',{...v,starts_at:madridToIso(v.date,v.time),match_id:match.id,version:match.version,duration_minutes:Number(v.duration_minutes)});await refresh();setMessage('Horario actualizado.');}});
  }
  const available=state.competitions.filter((x:Row)=>x.status!=='draft' && (sport==='all'||x.sport===sport) && (level==='all'||x.level===level||x.level==='open') && (kind==='all'||x.format===kind) && x.city.toLowerCase().includes(city.toLowerCase()) && `${x.title} ${x.venue}`.toLowerCase().includes(query.toLowerCase()));
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
    <View style={[styles.hero,isDesktop&&{flexDirection:'row',alignItems:'center'}]}>
      <View style={{flex:1,gap:16}}><Text style={s.eyebrow}>SEVILLA · DEPORTE AMATEUR</Text><Text style={[styles.heroTitle,{fontSize:isDesktop?48:38}]}>Menos «a ver si».{'\n'}Más <Text style={{color:c.lime}}>equipo.{'\n'}Más juego.</Text></Text><Text style={[s.body,{maxWidth:420}]}>Tu próxima ronda empieza aquí. Encuentra tu nivel, reúne a tu equipo y sal a jugar.</Text>
        <View style={[s.row,{flexWrap:'wrap',marginTop:4}]}><Button onPress={()=>mustLogin(()=>navigate('teams'))}>Reúne a tu equipo  ↗</Button><Button secondary onPress={()=>mustLogin(()=>createCompetition(undefined,true))}>Crear desafío</Button></View>
      </View>{isDesktop&&<View style={{alignItems:'center',paddingLeft:10}}><Court width={310} height={200}/><Text style={{color:c.muted,fontSize:11,letterSpacing:3}}>UNA RONDA. MUCHAS HISTORIAS.</Text></View>}
    </View>
    <View style={[s.row,{justifyContent:'space-between',marginTop:30,marginBottom:17,flexWrap:'wrap'}]}><Text style={s.h3}>Encuentra tu próxima competición</Text><Text style={s.caption}>{available.length} resultados · datos de demo</Text></View>
    <View style={[s.row,{flexWrap:'wrap',marginBottom:14}]}>{[{value:'all',label:'Todos'},...sportOptions].map(x=><Pressable accessibilityRole="button" key={x.value} onPress={()=>setSport(x.value)} style={[s.chip,sport===x.value&&s.chipActive]}><Text style={{color:sport===x.value?c.ink:c.text,fontWeight:'600',fontSize:13}}>{x.label}</Text></Pressable>)}</View>
    <View style={[s.row,{marginBottom:14,flexWrap:'wrap'}]}><TextInput accessibilityLabel="Buscar competición" placeholder="Buscar competición o sede" placeholderTextColor={c.muted} style={[s.input,{flexGrow:2,flexBasis:190}]} value={query} onChangeText={setQuery}/><TextInput accessibilityLabel="Ciudad" placeholder="Ciudad" placeholderTextColor={c.muted} style={[s.input,{flexGrow:1,flexBasis:120}]} value={city} onChangeText={setCity}/></View>
    <View style={[s.row,{flexWrap:'wrap',marginBottom:22}]}>
      <Button small secondary onPress={()=>setForm({title:'Filtrar competiciones',initial:{level,kind},fields:[{key:'level',label:'Nivel',type:'select',options:[{value:'all',label:'Cualquier nivel'},...levelOptions.filter(x=>x.value!=='open')]},{key:'kind',label:'Formato',type:'select',options:[{value:'all',label:'Todos'},...Object.entries(formats).map(([value,label])=>({value,label}))]}],run:async v=>{setLevel(v.level);setKind(v.kind);}})}>Filtros · {level==='all'?'cualquier nivel':labels[level]} · {kind==='all'?'todos los formatos':formats[kind as Format]}</Button>
    </View>
    <View style={[s.row,{flexWrap:'wrap',gap:18,alignItems:'stretch'}]}>{available.map(competitionCard)}</View>
    {!available.length&&<Empty title="Todavía no hay una ronda aquí." body="Prueba otro deporte o una ciudad cercana. También puedes proponer un desafío gratuito."/>}
  </>;}
  function activity(){return <>
    <Heading eyebrow="TU TEMPORADA" title="Aquí se juega lo tuyo." subtitle="Inscripciones, pases y avisos, en un mismo lugar."/>
    {!user?<Empty title="Tu próxima ronda te espera" body="Inicia sesión para ver tus inscripciones."><Button onPress={()=>authForm()}>Entrar</Button></Empty>:<>
      {!state.registrations.length&&<Empty title="Aún no tienes inscripciones" body="Elige una competición y apunta a tu equipo."><Button onPress={()=>navigate('discover')}>Ver competiciones</Button></Empty>}
      {state.registrations.map((r:Row)=><View style={[s.panel,{gap:12,marginBottom:14}]} key={r.id}><View style={[s.row,{justifyContent:'space-between',flexWrap:'wrap'}]}><Text style={[s.h3,{flex:1}]}>{r.title}</Text><Badge color={r.status==='confirmed'?c.lime:c.coral}>{labels[r.status]}</Badge></View><Text style={s.body}>{r.display_name} · {money(r.amount_cents)}{r.provider==='simulated'?' · Pago simulado':''}</Text>
        <View style={[s.row,{flexWrap:'wrap'}]}><Button secondary small onPress={()=>openCompetition(r.competition_id)}>Ver competición</Button>
          {r.status==='confirmed'&&<Button small onPress={()=>setPass(r)}>Mi pase QR</Button>}
          {r.status==='pending'&&r.user_id===user.id&&<Button small disabled={busy} onPress={()=>act(async()=>{if(r.provider==='simulated')await command('payment.simulate',{registration_id:r.id});else{const x=await api('/checkout',{registration_id:r.id});await Linking.openURL(x.url);}},r.provider==='simulated'?'Pago simulado confirmado. No se ha cobrado dinero.':'Consulta la confirmación al volver del pago.')}>{r.provider==='simulated'?'Simular pago':'Pagar inscripción'}</Button>}
          {r.status==='waitlisted'&&r.user_id===user.id&&<Button small onPress={()=>act(()=>command('registration.claim',{registration_id:r.id}),'Plaza reclamada. Revisa si queda un pago pendiente.')}>Reclamar plaza</Button>}
          {['pending','confirmed','waitlisted'].includes(r.status)&&r.user_id===user.id&&<Button small secondary onPress={()=>simple('Cancelar inscripción',[{key:'reason',label:'Motivo de cancelación',type:'multiline'}],'registration.cancel',{registration_id:r.id},{reason:'No puedo asistir.'},'Cancelación tramitada.')}>Cancelar</Button>}
        </View></View>)}
      <Text style={[s.h3,{marginTop:22,marginBottom:14}]}>Tus avisos</Text>{state.notifications.length===0&&<Text style={s.body}>Estás al día.</Text>}
      {state.notifications.map((n:Row)=><Pressable key={n.id} onPress={()=>act(()=>command('notification.read',{id:n.id}),'Aviso leído.')} style={[s.panel,{marginBottom:10,opacity:n.read_at?.65:1}]}><Text style={[s.label,{marginBottom:6}]}>{!n.read_at?'● ':''}{n.title}</Text><Text style={s.body}>{n.message}</Text></Pressable>)}
    </>}
  </>;}
  function teams(){return <>
    <Heading eyebrow="JUGAR EN COMPAÑÍA" title="Tu gente. Tu equipo." subtitle="Cada jugador acepta una invitación desde su propia cuenta. La plantilla queda cerrada al inscribirse."/>
    <View style={[s.row,{marginBottom:24,flexWrap:'wrap'}]}><Button onPress={()=>mustLogin(()=>simple('Crea tu equipo',[{key:'name',label:'Nombre del equipo'},{key:'sport',label:'Deporte',type:'select',options:sportOptions}],'team.create',{}, {sport:'padel'},'Equipo creado. Genera una invitación para tus compañeros.'))}>Crear equipo</Button><Button secondary onPress={()=>mustLogin(()=>simple('Únete al equipo',[{key:'invite',label:'Código de invitación'}],'team.join',{}, {},'Ya formas parte del equipo.'))}>Tengo una invitación</Button></View>
    {!state.teams.length&&<Empty title="La primera ronda empieza con tu gente" body="Para pádel, crea una pareja e invita a la otra persona. Para fútbol 7, reúne al menos siete jugadores."/>}
    {state.teams.map((t:Row)=><View key={t.id} style={[s.panel,{marginBottom:16,gap:14}]}><Badge color={sportColors[t.sport]}>{sports[t.sport as Sport]}</Badge><Text style={s.h3}>{t.name}</Text>
      {t.members.map((m:Row)=><View key={m.id} style={s.row}><View style={styles.avatar}><Text style={{color:c.lime,fontWeight:'700'}}>{m.name.slice(0,1)}</Text></View><Text style={s.body}>{m.name}{m.id===t.captain_id?' · Capitán':''}</Text></View>)}
      {t.captain_id===user?.id?<Button secondary small onPress={()=>act(async()=>{const result=await command('team.invite',{team_id:t.id});setForm({title:'Invitación de equipo',intro:'Comparte este código con tu compañero. Renovarlo invalida el anterior.',initial:{invite:result.invite},fields:[{key:'invite',label:'Código de invitación'}],submit:'Listo',run:async()=>{}});},'Invitación renovada.')}>Generar invitación</Button>:<Button secondary small onPress={()=>act(()=>command('team.leave',{team_id:t.id}),'Has salido del equipo.')}>Salir del equipo</Button>}
    </View>)}
  </>;}
  function organize(){return <>
    <Heading eyebrow="TU CLUB" title={state.organizations.length?'Un equipo detrás de cada ronda.':'Tu primera ronda empieza aquí.'} subtitle={state.organizations.length?'Organizaciones, verificación y permisos de tu personal.':'Crea tu club, solicita la verificación y prepara tu primera competición de pádel o fútbol 7.'}/>
    <Button onPress={()=>mustLogin(()=>simple('Solicita un perfil de organizador',[{key:'name',label:'Nombre del club u organización'},{key:'city',label:'Ciudad'}],'organization.create',{}, {city:'Sevilla'},'Organización creada. Administración debe verificarla para publicar torneos de pago.'))}>Crear organización</Button>
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
    return <><Heading eyebrow={forOrganization?'CADA PARTIDO, EN SU SITIO':'TU AGENDA'} title={forOrganization?'Una jornada bajo control.':'Tu próxima cita con el juego.'} subtitle={forOrganization?'Horarios y pistas de tus competiciones. Abre un partido para ajustar su horario o resolver un resultado.':'Los partidos de las inscripciones confirmadas de tus equipos, con hora de Madrid.'}/>{forOrganization&&organizationFilter()}
      {!rows.length&&<Empty title="Todavía no hay partidos en la agenda" body="Aparecerán cuando la organización genere el calendario de una competición en la que participes."/>}
      {Object.entries(groups).map(([day,matches])=><View key={day} style={{gap:12,marginBottom:28}}><Text style={[s.eyebrow,{color:c.blue}]}>{day}</Text>{(matches as Row[]).map((m:Row)=><Pressable key={m.id} accessibilityRole="button" accessibilityLabel={`Abrir partido ${m.home_name} contra ${m.away_name}`} onPress={()=>{openCompetition(m.competition_id);setDetailTab('matches');}} style={[s.panel,{gap:10}]}><View style={[s.row,{justifyContent:'space-between',flexWrap:'wrap'}]}><Badge color={sportColors[m.sport]}>{sports[m.sport as Sport]}</Badge><Text style={s.caption}>{labels[m.status]}</Text></View><Text style={s.h3}>{m.home_name||'Por decidir'} <Text style={{color:c.muted}}>vs.</Text> {m.away_name||'Por decidir'}</Text><Text style={s.body}>{date(m.starts_at)} · {m.court}</Text><Text style={s.caption}>{m.title} · Ronda {m.round} ↗</Text></Pressable>)}</View>)}
    </>;
  }
  function organizerPage(){
    if(tab==='club')return organize();
    if(tab==='stats')return <SportsStats/>;
    if(tab==='admin')return admin();
    if(!state.organizations.length)return organize();
    if(tab==='calendar')return agenda(true);
    if(tab==='competitions')return <><Heading eyebrow="DE LA IDEA A LA FINAL" title="Tus competiciones." subtitle="Borradores, inscripciones y jornadas en juego."/>{organizationFilter()}<View style={[s.row,{flexWrap:'wrap',marginBottom:22}]}><Button onPress={createForOrganization}>Crear competición ↗</Button>{['all','draft','open','running','completed'].map(x=><Button key={x} small secondary={statusFilter!==x} onPress={()=>setStatusFilter(x)}>{x==='all'?'Todas':labels[x]}</Button>)}</View><View style={[s.row,{flexWrap:'wrap',gap:18}]}>{ownCompetitions.filter((x:Row)=>statusFilter==='all'||x.status===statusFilter).map(competitionCard)}</View></>;
    if(tab==='registrations'){
      const rows=workspace.registrations.filter((r:Row)=>orgFilter==='all'||r.org_id===orgFilter);
      return <><Heading eyebrow="PLAZAS Y EQUIPOS" title="Cada inscripción, a mano." subtitle="Consulta los estados y abre una competición para revisar sus participantes."/>{organizationFilter()}{!rows.length&&<Empty title="Sin inscripciones visibles" body="Las inscripciones se muestran según tus permisos en cada organización."/>}{rows.map((r:Row)=><View key={r.id} style={[s.panel,{gap:12,marginBottom:14}]}><View style={[s.row,{justifyContent:'space-between',flexWrap:'wrap'}]}><Text style={s.h3}>{r.display_name}</Text><Badge>{labels[r.status]}</Badge></View><Text style={s.body}>{r.title}</Text><Text style={s.caption}>{r.amount_cents!==undefined?money(r.amount_cents)+' · ':''}{r.checked_in_at?'Acceso validado':'Sin validar'}{r.provider==='simulated'?' · Pago simulado':''}</Text><Button secondary small onPress={()=>{openCompetition(r.competition_id);setDetailTab('roster');}}>Ver inscritos</Button></View>)}</>;
    }
    if(tab==='access'){
      const rows=ownCompetitions.filter((x:Row)=>canScan(x.org_id)&&['open','running'].includes(x.status));
      return <><Heading eyebrow="BIENVENIDOS A LA RONDA" title="Acceso a pista." subtitle="Selecciona la competición y valida el pase de cada pareja o equipo. Cada pase admite un solo uso."/>{organizationFilter()}{!rows.length&&<Empty title="No tienes accesos pendientes" body="Necesitas permiso de acceso QR y una competición abierta o en juego."/>}{rows.map((x:Row)=><View key={x.id} style={[s.panel,{gap:12,marginBottom:16}]}><Badge color={sportColors[x.sport]}>{sports[x.sport as Sport]}</Badge><Text style={s.h3}>{x.title}</Text><Text style={s.body}>{x.confirmed_count} inscripciones confirmadas · {x.venue}</Text><Button onPress={()=>setScanCompetition(x.id)}>Abrir lector QR</Button></View>)}</>;
    }
    const metrics=workspace.metrics.filter((m:Row)=>orgFilter==='all'||m.org_id===orgFilter);
    const total=(key:string)=>metrics.reduce((sum:number,m:Row)=>sum+Number(m[key]||0),0);
    const upcoming=workspace.agenda.filter((m:Row)=>(orgFilter==='all'||m.org_id===orgFilter)&&!['confirmed','bye'].includes(m.status)).slice(0,4);
    return <><View style={[styles.hero,{gap:18}]}><Text style={[s.eyebrow,{color:c.blue}]}>ESPACIO ORGANIZADOR · SEVILLA</Text><Text style={[styles.heroTitle,{fontSize:isDesktop?46:34}]}>Tú haces que pase.{'\n'}<Text style={{color:c.lime}}>Nosotros, que ruede.</Text></Text><Text style={[s.body,{maxWidth:550}]}>Hola, {user.name.split(' ')[0]}. Tus competiciones, tu equipo y cada jornada, en un mismo lugar.</Text><View style={[s.row,{flexWrap:'wrap'}]}><Button onPress={createForOrganization}>Crear competición ↗</Button><Button secondary onPress={()=>navigate('access')}>Validar accesos</Button></View></View>
      <View style={{marginTop:24}}>{organizationFilter()}</View>
      <View style={[s.row,{flexWrap:'wrap',alignItems:'stretch',gap:12,marginBottom:28}]}>{[{label:'Competiciones',value:ownCompetitions.length,detail:'de tus organizaciones'},{label:'Inscripciones',value:total('confirmed'),detail:'confirmadas · gestión autorizada'},{label:'Accesos validados',value:total('checked_in'),detail:'de inscripciones confirmadas'},...(metrics.length?[{label:'Importe confirmado',value:money(total('amount_cents')),detail:state.paymentMode==='simulated'?'simulado · sin cobros reales':state.paymentMode==='stripe_test'?'pruebas · antes de comisiones':'antes de comisiones'}]:[])].map(x=><View key={x.label} style={[s.panel,{flexGrow:1,flexBasis:isDesktop?175:135,gap:8}]}><Text style={s.caption}>{x.label}</Text><Text style={{color:c.lime,fontSize:30,fontWeight:'800'}}>{x.value}</Text><Text style={{color:c.muted,fontSize:11,lineHeight:16}}>{x.detail}</Text></View>)}</View>
      <View style={[s.row,{flexWrap:'wrap',marginBottom:24}]}><Button small secondary onPress={()=>navigate('registrations')}>Ver inscripciones</Button><Button small secondary onPress={()=>navigate('stats')}>Ver estadísticas</Button>{user.role==='admin'&&<Button small secondary onPress={()=>navigate('admin')}>Administración</Button>}</View>
      <View style={[s.row,{justifyContent:'space-between',marginBottom:16}]}><Text style={s.h3}>En el calendario</Text><Button small secondary onPress={()=>navigate('calendar')}>Ver agenda</Button></View>
      {!upcoming.length&&<Empty title="Todo al día" body="Los próximos partidos aparecerán aquí al generar tus calendarios."/>}
      {upcoming.map((m:Row)=><Pressable key={m.id} accessibilityRole="button" onPress={()=>{openCompetition(m.competition_id);setDetailTab('matches');}} style={[s.panel,{gap:8,marginBottom:12}]}><Text style={s.label}>{m.home_name||'Por decidir'} — {m.away_name||'Por decidir'}</Text><Text style={s.caption}>{m.title} · {date(m.starts_at)} · {m.court}</Text></Pressable>)}
      <Text style={[s.h3,{marginTop:20,marginBottom:16}]}>Pádel y fútbol 7 desde la primera ronda.</Text><Text style={s.body}>Parejas, plantillas, calendarios y resultados adaptados a cada deporte.</Text>
    </>;
  }
  function profile(){return <>
    <Heading eyebrow="A TU MANERA" title={user?`Hola, ${user.name.split(' ')[0]}.`:'Sal a jugar.'} subtitle="Un perfil, todos tus equipos y competiciones."/>
    {!user?<View style={[s.panel,{gap:18}]}><Text style={s.body}>Crea tu cuenta para guardar tus equipos, inscripciones y resultados.</Text><Button onPress={()=>authForm(true)}>Crear cuenta</Button><Button secondary onPress={()=>authForm()}>Ya tengo cuenta</Button></View>:<View style={[s.panel,{gap:18}]}><Text style={s.h3}>{user.name}</Text><Text style={s.body}>{user.email} · {user.city} · {labels[user.level]}</Text><Button secondary onPress={()=>simple('Tu perfil',[{key:'name',label:'Nombre visible'},{key:'city',label:'Ciudad'},{key:'level',label:'Nivel',type:'select',options:levelOptions.filter(x=>x.value!=='open')},{key:'marketing_opt_in',label:'Quiero recibir novedades (opcional).',type:'check'}],'profile.update',{},user)}>Editar perfil</Button><Button secondary onPress={()=>setForm({title:'Cambiar contraseña',fields:[{key:'current_password',label:'Contraseña actual',type:'password'},{key:'password',label:'Nueva contraseña (12 caracteres o más)',type:'password'}],run:async v=>{await api('/auth/password',v);await signOut();router.replace('/login');}})}>Cambiar contraseña</Button><Button secondary onPress={()=>setForm({title:'Solicitar eliminación de cuenta',intro:'Cerraremos tu acceso y retiraremos el consentimiento comercial inmediatamente. Administración tramitará la eliminación de tus datos y resolverá las competiciones o pagos pendientes. Los datos necesarios por obligaciones legales se conservarán según la política de privacidad.',fields:[{key:'password',label:'Confirma tu contraseña',type:'password'}],submit:'Solicitar eliminación',run:async v=>{await api('/auth/delete-account',v);await signOut();router.replace('/welcome');}})}>Eliminar mi cuenta</Button><Button secondary onPress={()=>act(async()=>{await signOut();router.replace('/welcome');},'Sesión cerrada.')}>Cerrar sesión</Button></View>}
    <View style={[s.panel,{marginTop:22,gap:12}]}><Text style={s.h3}>Tu cuenta RONDIQO</Text><Button secondary onPress={()=>router.push('/notifications')}>Notificaciones</Button><Button secondary onPress={()=>router.push('/legal/terminos')}>Condiciones y privacidad</Button><Text style={s.body}>Tu perfil de jugador también te permite organizar competiciones. Esta versión de prueba utiliza datos de demostración y pagos simulados.</Text><Text style={s.body}>Acceso para mayores de 18 años por declaración del usuario. No acredita identidad, seguro, reserva de pista ni licencia federativa. Las condiciones comerciales y de privacidad definitivas deben aprobarse antes de aceptar jugadores reales.</Text><Text style={s.caption}>El nombre y los identificadores de la app están pendientes de comprobación de disponibilidad.</Text></View>
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
    if(!detail)return <Loading/>;
    const comp=detail.competition,canManage=organizer&&(state.organizations.some((o:Row)=>o.id===comp.org_id&&['owner','manager'].includes(o.role))||user?.role==='admin');
    const staff=organizer&&(state.organizations.some((o:Row)=>o.id===comp.org_id&&['owner','manager','referee'].includes(o.role))||user?.role==='admin');
    const myRegs=state.registrations.filter((r:Row)=>r.competition_id===comp.id&&r.user_id===user?.id);
    const name=(id:string)=>detail.entrants.find((x:Row)=>x.id===id)?.display_name || 'Por decidir';
    const matchCard=(m:Row)=><View key={m.id} style={[s.panel,{gap:12,marginBottom:12}]}>
      <View style={[s.row,{justifyContent:'space-between'}]}><Text style={s.caption}>Ronda {m.round} · Partido {m.position+1}</Text><Badge color={m.status==='confirmed'?c.lime:m.status==='disputed'?c.coral:c.blue}>{labels[m.status]}</Badge></View>
      <View style={[s.row,{justifyContent:'space-between'}]}><Text style={[s.label,{flex:1}]}>{name(m.home)}</Text><Text style={{fontSize:22,fontWeight:'800',color:c.text}}>{m.score?.home ?? '–'}</Text></View>
      <View style={[s.row,{justifyContent:'space-between'}]}><Text style={[s.label,{flex:1}]}>{m.status==='bye'?'Pase directo':name(m.away)}</Text><Text style={{fontSize:22,fontWeight:'800',color:c.text}}>{m.score?.away ?? '–'}</Text></View>
      {m.score?.sets&&<Text style={s.caption}>Sets: {m.score.sets.map((p:number[])=>p.join('–')).join(' / ')}</Text>}{m.score?.tiebreak&&<Text style={s.caption}>Penaltis: {m.score.tiebreak.join('–')}</Text>}
      {m.starts_at&&<Text style={s.caption}>{date(m.starts_at)} · {m.court}</Text>}
      {comp.status==='running'&&<View style={[s.row,{flexWrap:'wrap'}]}>
        {canManage&&m.status!=='confirmed'&&m.status!=='bye'&&<Button small secondary onPress={()=>scheduleForm(m)}>Horario</Button>}
        {(staff||myRegs.some((r:Row)=>r.id===m.home||r.id===m.away))&&<>
          {m.status==='scheduled'&&m.home&&m.away&&<Button small onPress={()=>resultForm(m)}>Resultado</Button>}
          {m.status==='proposed'&&<><Button small onPress={()=>act(()=>command('match.confirm',{match_id:m.id,version:m.version}),'Resultado confirmado.')}>Confirmar</Button><Button small secondary onPress={()=>simple('Abrir incidencia',[{key:'reason',label:'Explica la incidencia',type:'multiline'}],'match.dispute',{match_id:m.id,version:m.version})}>Disputar</Button></>}
          {m.status==='disputed'&&staff&&<Button small onPress={()=>resultForm(m,true)}>Resolver</Button>}
        </>}
      </View>}
    </View>;
    return <>
      <Button small secondary onPress={()=>setSelected(null)}>← Volver</Button>
      <View style={{marginTop:24,gap:14}}><View style={[s.row,{flexWrap:'wrap'}]}><Badge color={sportColors[comp.sport]}>{sports[comp.sport as Sport]}</Badge><Badge color={c.blue}>{formats[comp.format as Format]}</Badge><Text style={s.caption}>{labels[comp.status]}</Text></View>
        <Heading title={comp.title} subtitle={`${comp.city} · ${comp.venue} · ${date(comp.starts_at)} (Madrid)`}/>
      </View>
      <View style={[s.row,{flexWrap:'wrap',marginBottom:22}]}>
        {!organizer&&comp.status==='open'&&<Button onPress={()=>registerCompetition(comp)}>{comp.price_cents?`Inscribirme · ${money(comp.price_cents)}`:'Inscribirme gratis'}</Button>}
        <Button secondary onPress={()=>Linking.openURL(`${base || (Platform.OS==='web'?window.location.origin:'http://127.0.0.1:4173')}/api/competitions/${comp.id}/calendar.ics`)}>Calendario .ics</Button>
        <Button secondary onPress={()=>{const root=Platform.OS==='web'?window.location.origin:'http://127.0.0.1:4173';Share.share({message:`${comp.title} · RONDIQO (demo local): ${root}/event/${comp.id}`});}}>Compartir</Button>
        {canManage&&comp.status==='draft'&&<Button secondary onPress={()=>router.push({pathname:'/(creator)/create-event',params:{edit:comp.id}})}>Editar borrador</Button>}
        {canManage&&comp.status==='draft'&&<Button onPress={()=>act(()=>command('competition.publish',{competition_id:comp.id}),'Competición publicada.')}>Publicar</Button>}
        {canManage&&comp.status==='open'&&<Button onPress={()=>setForm({title:'Cerrar inscripciones y generar calendario',intro:'Se cerrarán las inscripciones y se generarán cruces por orden de inscripción. Los pases directos se reparten en la primera ronda. Revisa los horarios propuestos antes de comunicarlos.',fields:[],submit:'Generar y comenzar',run:async()=>{await command('competition.start',{competition_id:comp.id});await refresh();setMessage('Calendario generado.');}})}>Generar calendario</Button>}
        {organizer&&detail.canCheckin&&['open','running'].includes(comp.status)&&<Button secondary onPress={()=>setScanCompetition(comp.id)}>Validar QR</Button>}
        {canManage&&['open','running','draft'].includes(comp.status)&&<Button secondary onPress={()=>simple('Cancelar competición',[{key:'reason',label:'Motivo (se notificará a los participantes)',type:'multiline'}],'competition.cancel',{competition_id:comp.id},{},'Competición cancelada. Revisa los reembolsos en administración.')}>Cancelar competición</Button>}
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{marginBottom:24}} contentContainerStyle={{gap:10}}>
        {[['overview','Información'],['matches',comp.format==='knockout'?'Cuadro y partidos':'Partidos'],['ranking','Clasificación'],...(organizer&&detail.manager?[['roster','Inscritos']]:[])].map(([key,label])=><Pressable key={key} accessibilityRole="tab" accessibilityState={{selected:detailTab===key}} onPress={()=>setDetailTab(key)} style={[s.chip,detailTab===key&&s.chipActive]}><Text style={{color:detailTab===key?c.ink:c.text,fontWeight:'600'}}>{label}</Text></Pressable>)}
      </ScrollView>
      {detailTab==='overview'&&<View style={{gap:18}}><View style={s.panel}><Text style={[s.h3,{marginBottom:10}]}>La próxima ronda</Text><Text style={s.body}>{comp.description}</Text><Text style={[s.body,{marginTop:14}]}>Organiza: {comp.organizer}{comp.verified?' · Verificado en la demo':''}{'\n'}Cierre: {date(comp.registration_closes_at)}{'\n'}{comp.capacity} plazas de {comp.entry_mode==='team'?'equipos':'jugadores'} · Nivel {labels[comp.level]||'abierto'}{'\n'}Precio total: {comp.price_cents?money(comp.price_cents):'gratis'} por inscripción</Text></View><View style={s.panel}><Text style={[s.h3,{marginBottom:10}]}>Reglas y cancelación</Text><Text style={s.body}>{comp.rules}</Text></View></View>}
      {detailTab==='matches'&&(detail.matches.length?comp.format==='knockout'?<ScrollView horizontal contentContainerStyle={{gap:16}}>{[...new Set<number>(detail.matches.map((m:Row)=>m.round))].map(round=><View key={round} style={{width:Math.min(330,width-70)}}><Text style={[s.eyebrow,{marginBottom:14}]}>{round===Math.max(...detail.matches.map((m:Row)=>m.round))?'FINAL':`RONDA ${round}`}</Text>{detail.matches.filter((m:Row)=>m.round===round).map(matchCard)}</View>)}</ScrollView>:detail.matches.map(matchCard):<Empty title="El calendario todavía no está listo" body="La organización lo generará cuando termine de confirmar las inscripciones."/> )}
      {detailTab==='ranking'&&<View style={s.panel}><Text style={[s.caption,{marginBottom:18}]}>{comp.format==='knockout'?'El cuadro determina el campeón. Esta tabla resume el rendimiento.':'3 puntos por victoria · 1 por empate · 0 por derrota.'} Desempate: diferencia de marcador, tantos a favor y nombre.</Text>{detail.standings.map((r:Row,i:number)=><View key={r.id} style={[s.row,{paddingVertical:14,borderBottomWidth:1,borderBottomColor:c.line}]}><Text style={{color:i===0?c.lime:c.muted,fontWeight:'900',fontSize:22,width:25}}>{i+1}</Text><View style={{flex:1}}><Text style={s.label}>{r.name}</Text><Text style={s.caption}>{r.played} PJ · {r.won} G · {r.drawn} E · {r.lost} P · {r.for-r.against>0?'+':''}{r.for-r.against} dif.</Text></View><Text style={{color:c.lime,fontWeight:'800',fontSize:21}}>{r.points}</Text></View>)}{!detail.standings.length&&<Text style={s.body}>Sin participantes confirmados.</Text>}</View>}
      {detailTab==='roster'&&detail.roster.map((r:Row)=><View key={r.id} style={[s.panel,{marginBottom:10,gap:8}]}><Text style={s.label}>{r.display_name}</Text><Text style={s.body}>{labels[r.status]} · {r.amount_cents!==undefined?money(r.amount_cents)+' · ':''}{r.checked_in_at?'Acceso validado':'Sin validar'}</Text></View>)}
    </>;
  }
  useEffect(()=>{if(Platform.OS==='web'){const p=new URLSearchParams(window.location.search).get('competition');if(p&&/^[0-9a-f-]{36}$/.test(p))setSelected(p);}},[]);
  if(!focused)return null;
  return <SafeAreaView edges={['top','left','right']} style={{flex:1,backgroundColor:c.bg}}><View style={{flex:1,flexDirection:'row'}}>
    {isDesktop&&<View style={styles.sidebar}><Logo/><Text style={[s.eyebrow,{marginTop:18,marginBottom:26,color:organizer?c.blue:c.lime}]}>{organizer?'ESPACIO ORGANIZADOR':'ESPACIO JUGADOR'}</Text><View style={{gap:7}}>{tabs.map(t=>tabButton(t))}</View><View style={{flex:1}}/><View style={[s.panel,{padding:17,gap:10}]}><Text style={s.eyebrow}>{organizer?'TÚ HACES QUE PASE':'HECHO PARA JUGAR'}</Text><Text style={s.body}>{organizer?'Tu club. Tus reglas.\nLa próxima gran ronda.':'El rival cambia.\nLas ganas, no.'}</Text><Button secondary small onPress={switchSpace}>{organizer?'Ir a jugador':'Soy organizador'}</Button><Text style={s.caption}>SEVILLA / 01</Text></View><Text style={[s.caption,{marginTop:20}]}>RONDIQO · Versión 0.4</Text></View>}
    <View style={{flex:1}}><View style={[styles.topbar,{paddingHorizontal:isDesktop?36:20}]}>
      {isDesktop?<Text style={s.caption}>Sevilla <Text style={{color:c.lime}}>↗</Text>  /  {selected?'Competición':tabs.find(t=>t.id===tab)?.label}</Text>:<View style={{gap:4}}><Logo small/><Text style={{fontSize:9,fontWeight:'800',letterSpacing:1,color:organizer?c.blue:c.lime}}>{organizer?'ORGANIZADOR':'JUGADOR'}</Text></View>}
      <View style={[s.row,{gap:isDesktop?12:8}]}>{user&&<NotificationBell/>}{!isDesktop&&<Pressable accessibilityRole="button" accessibilityLabel={organizer?'Ir al espacio jugador':'Ir al espacio organizador'} onPress={switchSpace}><Ionicons name="swap-horizontal-outline" size={23} color={organizer?c.blue:c.lime}/></Pressable>}{isDesktop&&<Pressable accessibilityRole="button" accessibilityLabel="Actualizar datos" onPress={()=>act(refresh,'Datos actualizados.')}><Ionicons name="refresh-outline" size={21} color={c.muted}/></Pressable>}{isDesktop&&<Badge color={c.coral}>{state.release==='production'?'RONDIQO':state.release==='beta'?'BETA PRIVADA':state.database==='appfest'?'DEMO CONECTADA':'DEMO LOCAL'}</Badge>}<Pressable accessibilityRole="button" accessibilityLabel={user?'Abrir mi perfil':'Iniciar sesión'} onPress={()=>user?router.push('/profile'):authForm()} style={styles.avatar}><Text style={{color:c.lime,fontWeight:'800'}}>{user?.name.slice(0,1)||'↗'}</Text></Pressable></View>
    </View>
    <ScrollView contentContainerStyle={{padding:isDesktop?36:20,paddingBottom:40,maxWidth:1280,width:'100%',alignSelf:'center'}} keyboardShouldPersistTaps="handled">
      {error&&<Pressable onPress={()=>setError('')} style={[styles.notice,{backgroundColor:'#452825'}]}><Text accessibilityRole="alert" style={{color:c.danger,lineHeight:21}}>{error}  ×</Text></Pressable>}
      {message&&<Pressable onPress={()=>setMessage('')} style={styles.notice}><Text accessibilityRole="alert" style={{color:c.lime,lineHeight:21}}>{message}  ×</Text></Pressable>}
      {loading?<Loading/>:organizer&&!user?<Empty title="Organiza la próxima gran ronda." body="Entra con tu cuenta para gestionar competiciones, inscripciones y personal."><Button onPress={()=>authForm()}>Entrar como organizador</Button><Button secondary onPress={()=>authForm(true)}>Crear cuenta</Button></Empty>:selected?competitionDetail():organizer?organizerPage():tab==='discover'?discover():tab==='activity'?activity():tab==='teams'?teams():tab==='calendar'?agenda(false):profile()}
      <View style={{borderTopWidth:1,borderTopColor:c.line,paddingTop:24,marginTop:36,gap:5}}><Text style={s.caption}>Mayores de 18 años · {state.paymentMode==='simulated'?'Pagos simulados':state.paymentMode==='stripe_test'?'Stripe en pruebas':'Cobro seguro con Stripe'}</Text><Text style={s.caption}>Nombre provisional pendiente de disponibilidad. Horarios en Europe/Madrid.</Text></View>
    </ScrollView>
    </View>
  </View><FormDialog form={form} close={()=>setForm(null)}/>
    {scanCompetition&&<ScanDialog close={()=>setScanCompetition(null)} validate={async token=>{const r=await command('checkin',{competition_id:scanCompetition,token});await refresh();return `Acceso validado: ${r.name}. El pase ya no puede reutilizarse.`;}}/>}
    <Modal visible={!!pass} transparent animationType="fade" onRequestClose={()=>setPass(null)}><View style={s.overlay}><View style={[s.dialog,{padding:28,gap:20,alignItems:'center',maxWidth:400}]}><Logo/><Text style={[s.h3,{textAlign:'center'}]}>{pass?.title}</Text><Text style={s.body}>{pass?.display_name}</Text>{pass&&<View style={{padding:20,backgroundColor:'white',borderRadius:15}}><QRCode value={`rondiqo:${pass.qr_token}`} size={220} backgroundColor="white" color="#0C1718"/></View>}<Text style={s.caption}>Un uso por inscripción. La organización validará el pase.</Text><Text selectable style={{color:c.muted,fontSize:10,textAlign:'center'}}>{pass?`rondiqo:${pass.qr_token}`:''}</Text><Button secondary onPress={()=>setPass(null)}>Cerrar pase</Button></View></View></Modal>
  </SafeAreaView>;
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
