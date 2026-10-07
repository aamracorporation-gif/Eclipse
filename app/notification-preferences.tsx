import React,{useEffect,useRef,useState} from 'react';
import {View,Text,StyleSheet,Switch,TouchableOpacity,ScrollView,TextInput,ActivityIndicator,Linking} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {useRouter} from 'expo-router';
import {ArrowLeft,LogIn} from '@/lib/icons';
import {useAuth} from '@/lib/AuthContext';
import {useNotifications} from '@/lib/NotificationContext';
import {supabase} from '@/lib/supabase';
import {AuthRequiredScreen} from '@/components/ui/AuthRequiredScreen';
import {registerForPushNotifications} from '@/lib/notifications';
import {NOTIFICATION_ROLE_LABELS,notificationClock,parseNotificationClock,type NotificationRole} from '@/lib/notificationNavigation';
import {LAUNCH_FEATURES} from '@/lib/launchFeatures';
// Legacy contract retained for callers while the v2 interface uses explicit role preferences.
const COMMON_KEYS=(['purchase_updates','event_reminders','resale_updates'] as const).filter(k=>k!=='resale_updates'||LAUNCH_FEATURES.resale);
export function __test_getVisiblePreferenceKeys(role:string|null|undefined):string[]{return String(role||'').toLowerCase()==='organizer'?[...COMMON_KEYS,'stock_alerts','realtime_sales','daily_summary','stock_threshold_alerts']:[...COMMON_KEYS];}
type Preferences={user_id:string;role:NotificationRole;push_enabled:boolean;email_enabled:boolean;purchase_updates:boolean;event_changes:boolean;event_reminders:boolean;operations:boolean;quiet_enabled:boolean;quiet_start:number;quiet_end:number;timezone:string;event_night_override:boolean};
const rows:[keyof Preferences,string,string][]=[
 ['push_enabled','Avisos en el móvil','Se aplican a los dispositivos de este perfil con permiso del sistema.'],
 ['email_enabled','Avisos por correo','Avisos de actividad. No modifica los correos de acceso o recuperación de cuenta.'],
 ['purchase_updates','Compras y reembolsos','Entradas, mesas VIP, invitaciones y estado de los reembolsos.'],
 ['event_changes','Cambios importantes','Fecha, lugar, acceso y cancelación de tus eventos.'],
 ['event_reminders','Recordatorios','24 horas y 2 horas antes; aviso de hora límite cuando corresponda.'],
 ['operations','Actividad de tu perfil','Verificación y asignaciones correspondientes a tu función.'],
 ['quiet_enabled','Horario de silencio','Pausa los push; los avisos seguirán en el historial. Las confirmaciones solicitadas por ti son inmediatas.'],
 ['event_night_override','Avisos del evento durante la noche','Permite avisos pertinentes desde 4 horas antes hasta el final de un evento comprado o asignado. No ignora los controles del móvil.'],
];
export default function NotificationPreferencesScreen(){
 const router=useRouter();const {user}=useAuth();const uid=user?.id??'';const {roles}=useNotifications();
 const [role,setRole]=useState<NotificationRole>('attendee'),[prefs,setPrefs]=useState<Preferences|null>(null),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[message,setMessage]=useState(''),[reload,setReload]=useState(0);
 const [start,setStart]=useState('00:00'),[end,setEnd]=useState('11:00');const scope=`${uid}:${role}`;const current=useRef(scope);current.current=scope;
 useEffect(()=>{setRole('attendee');setBusy(false);setMessage('');},[uid]);
 useEffect(()=>{
  let live=true;setLoading(true);setPrefs(null);setMessage('');
  if(!uid){setLoading(false);return;}
  void Promise.resolve(supabase.rpc('notification_preferences_v2_get',{p_role:role})).then(({data,error})=>{
   if(!live||current.current!==scope)return;
   if(error||!data||data.user_id!==uid){setMessage('No se pudieron cargar las preferencias. Reintenta con la versión actualizada.');return;}
   setPrefs(data as Preferences);setStart(notificationClock(data.quiet_start));setEnd(notificationClock(data.quiet_end));
  }).catch(()=>{if(live)setMessage('No se pudieron cargar las preferencias.');}).finally(()=>{if(live)setLoading(false);});
  return()=>{live=false;};
 },[uid,role,scope,reload]);
 const save=async(patch:Partial<Preferences>)=>{
  if(!prefs||busy)return;setBusy(true);setMessage('');
  try{
   const {data,error}=await supabase.from('notification_preferences_v2').update(patch).eq('user_id',uid).eq('role',role).select('*').single();
   if(current.current!==scope)return;
   if(error||!data)throw new Error('No se guardó el cambio. Reintenta.');setPrefs(data as Preferences);setMessage('Preferencias guardadas.');
  }catch(e){if(current.current===scope)setMessage(e instanceof Error?e.message:'No se guardó el cambio.');}finally{if(current.current===scope)setBusy(false);}
 };
 const activate=async()=>{
  if(busy)return;setBusy(true);
  try{const result=await registerForPushNotifications(uid,true);if(current.current===scope)setMessage(result==='registered'?'Este móvil está registrado. La recepción depende también de los canales habilitados para la prueba.':result==='denied'?'El permiso está desactivado. Abre los ajustes del móvil para cambiarlo.':result==='unsupported'?'Los push requieren una versión nativa configurada de Eclipse.':'No se ha concedido el permiso. Puedes seguir usando Eclipse.');}
  catch(e){if(current.current===scope)setMessage(e instanceof Error?e.message:'No se pudo registrar el móvil.');}finally{if(current.current===scope)setBusy(false);}
 };
 if(!user)return <AuthRequiredScreen title="Preferencias" subtitle="Inicia sesión para configurar tus avisos." ctaLabel="Iniciar sesión" Icon={LogIn}/>;
 const visible=prefs?.user_id===uid&&prefs.role===role?prefs:null;
 return <SafeAreaView style={styles.page}><View style={styles.header}><TouchableOpacity accessibilityLabel="Volver" onPress={()=>router.back()}><ArrowLeft color="white" size={24}/></TouchableOpacity><Text style={styles.title}>Tus notificaciones</Text></View><ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
  <Text style={styles.description}>Controla cómo te avisamos, sin perder el historial de tu actividad.</Text><View style={styles.roles}>{(roles.length?roles:['attendee'] as NotificationRole[]).map(r=><TouchableOpacity disabled={busy} key={r} accessibilityState={{selected:role===r}} style={[styles.chip,role===r&&styles.active]} onPress={()=>setRole(r)}><Text style={styles.label}>{NOTIFICATION_ROLE_LABELS[r]}</Text></TouchableOpacity>)}</View>
  {message?<Text accessibilityLiveRegion="polite" style={styles.message}>{message}</Text>:null}
  {loading?<ActivityIndicator color="#C5ABFF"/>:!visible?<TouchableOpacity style={styles.button} onPress={()=>setReload(n=>n+1)}><Text style={styles.label}>Reintentar</Text></TouchableOpacity>:<View style={styles.card}>
   {rows.filter(([key])=>key!=='operations'||role!=='attendee').map(([key,title,description])=><View key={key} style={styles.row}><View style={styles.rowText}><Text style={styles.label}>{title}</Text><Text style={styles.description}>{description}</Text></View><Switch accessibilityLabel={title} disabled={busy} value={Boolean(visible[key])} onValueChange={v=>void save({[key]:v})} trackColor={{false:'#4A4358',true:'#9567CA'}}/></View>)}
   {visible.quiet_enabled?<View style={styles.schedule}><Text style={styles.label}>Silencio ({visible.timezone})</Text><View style={styles.clockRow}><TextInput accessibilityLabel="Inicio de silencio, hora y minutos" value={start} onChangeText={setStart} placeholder="00:00" placeholderTextColor="#9C95A9" maxLength={5} editable={!busy} style={styles.input}/><Text style={styles.label}>a</Text><TextInput accessibilityLabel="Fin de silencio, hora y minutos" value={end} onChangeText={setEnd} placeholder="11:00" placeholderTextColor="#9C95A9" maxLength={5} editable={!busy} style={styles.input}/></View><TouchableOpacity disabled={busy} style={styles.button} onPress={()=>{const a=parseNotificationClock(start),b=parseNotificationClock(end);if(a===null||b===null||a===b){setMessage('Indica dos horas distintas en formato HH:mm.');return;}void save({quiet_start:a,quiet_end:b});}}><Text style={styles.label}>Guardar horario</Text></TouchableOpacity></View>:null}
  </View>}
  <TouchableOpacity disabled={busy} style={styles.primary} onPress={()=>void activate()}><Text style={styles.label}>{busy?'Guardando…':'Activar avisos en este móvil'}</Text></TouchableOpacity><TouchableOpacity style={styles.button} onPress={()=>void Linking.openSettings().catch(()=>setMessage('Abre los ajustes del sistema manualmente.'))}><Text style={styles.label}>Abrir ajustes del móvil</Text></TouchableOpacity>
  <View style={styles.card}><Text style={styles.label}>Promociones desactivadas</Text><Text style={styles.description}>No se envía publicidad en esta fase. Aceptar avisos de compras no activa promociones. Reventa, saldo y SMS siguen fuera de este lanzamiento.</Text></View>
 </ScrollView></SafeAreaView>;
}
const styles=StyleSheet.create({page:{flex:1,backgroundColor:'#151020'},header:{flexDirection:'row',alignItems:'center',gap:18,padding:22},title:{color:'white',fontSize:24,fontWeight:'700'},content:{padding:22,paddingTop:0,gap:18,paddingBottom:48},description:{color:'#ADA6BA',fontSize:13,lineHeight:20,marginTop:5},roles:{flexDirection:'row',flexWrap:'wrap',gap:8},chip:{padding:10,borderRadius:18,backgroundColor:'#2D233E'},active:{backgroundColor:'#664390'},label:{color:'#FAF7FF',fontWeight:'600',fontSize:15},card:{padding:18,borderRadius:18,backgroundColor:'#251C33',gap:8},row:{flexDirection:'row',alignItems:'center',gap:14,paddingVertical:14,borderBottomWidth:1,borderBottomColor:'#3C304B'},rowText:{flex:1},message:{color:'#D9BDF7',fontSize:14,lineHeight:20},schedule:{gap:12,paddingTop:18},clockRow:{flexDirection:'row',alignItems:'center',gap:12},input:{color:'white',backgroundColor:'#161121',padding:12,borderRadius:9,fontSize:18,minWidth:86,textAlign:'center'},button:{padding:14,alignItems:'center',borderRadius:12,borderWidth:1,borderColor:'#624A7A'},primary:{backgroundColor:'#8558B9',padding:17,borderRadius:12,alignItems:'center'}});
