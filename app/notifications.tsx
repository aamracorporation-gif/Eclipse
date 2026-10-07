import React,{useCallback,useEffect,useRef,useState} from 'react';
import {View,Text,StyleSheet,FlatList,TouchableOpacity,ScrollView,ActivityIndicator,Modal} from 'react-native';
import {useLocalSearchParams,useRouter} from 'expo-router';
import {SafeAreaView} from 'react-native-safe-area-context';
import {LinearGradient} from 'expo-linear-gradient';
import {ArrowLeft,Bell,LogIn} from '@/lib/icons';
import {useNotifications,type Notification} from '@/lib/NotificationContext';
import {useAuth} from '@/lib/AuthContext';
import {useAppDialog} from '@/components/ui/AppDialog';
import {AuthRequiredScreen} from '@/components/ui/AuthRequiredScreen';
import {supabase} from '@/lib/supabase';
import {normalizeNotificationRow} from '@/lib/notificationSchema';
import {NOTIFICATION_UUID,NOTIFICATION_ROLE_LABELS,isSafeNotificationDestination} from '@/lib/notificationNavigation';

export default function NotificationsScreen(){
 const router=useRouter();const {user}=useAuth();const uid=user?.id??'';const owner=useRef(uid);owner.current=uid;
 const {notification_id}=useLocalSearchParams<{notification_id?:string}>();const handled=useRef('');
 const {show}=useAppDialog();const inbox=useNotifications();const {fetchNotifications}=inbox;
 const [detail,setDetail]=useState<{owner:string;row:Notification}|null>(null),[opening,setOpening]=useState(false),[acting,setActing]=useState(false);
 useEffect(()=>{setOpening(false);setActing(false);setDetail(null);handled.current='';},[uid]);
 const open=useCallback(async(id:string)=>{
  if(!uid||!NOTIFICATION_UUID.test(id))return;
  setOpening(true);
  try{
   const {data,error}=await supabase.rpc('notification_detail_v2',{p_id:id});
   if(owner.current!==uid)return;
   if(error||!data||data.user_id!==uid)throw new Error('Esta notificación ya no está disponible para tu cuenta.');
   setDetail({owner:uid,row:normalizeNotificationRow(data)});
   const read=await supabase.rpc('notification_inbox_action_v2',{p_action:'read',p_ids:[id],p_expected_user:uid});
   if(read.error)throw new Error('Se abrió el aviso, pero no se pudo marcar como leído.');
   if(owner.current===uid)await fetchNotifications();
  }catch(e){if(owner.current===uid)show({title:'Notificaciones',message:e instanceof Error?e.message:'No se pudo abrir el aviso.'});}
  finally{if(owner.current===uid)setOpening(false);}
 },[uid,fetchNotifications,show]);
 useEffect(()=>{
  const id=String(notification_id??'');const key=`${uid}:${id}`;
  if(uid&&id&&handled.current!==key){handled.current=key;void open(id);}
 },[uid,notification_id,open]);
 const visibleDetail=detail?.owner===uid?detail.row:null;
 const action=async(work:()=>Promise<void>)=>{
  setActing(true);try{await work();if(owner.current===uid)setDetail(null);}catch(e){if(owner.current===uid)show({title:'No se pudo guardar',message:e instanceof Error?e.message:'Vuelve a intentarlo.'});}finally{if(owner.current===uid)setActing(false);}
 };
 const follow=async()=>{
  if(!visibleDetail||acting)return;setActing(true);
  try{
   const {data,error}=await supabase.rpc('notification_destination_v2',{p_id:visibleDetail.id});
   if(owner.current!==uid)return;
   if(error||!isSafeNotificationDestination(data))throw new Error('El contenido ya no está disponible para tu cuenta.');
   if(data==='/notifications'){show({title:'Información del aviso',message:'Este aviso no tiene otra pantalla disponible. Puedes conservarlo en tu historial.'});return;}
   setDetail(null);router.push(data as any);
  }catch(e){if(owner.current===uid)show({title:'Destino no disponible',message:e instanceof Error?e.message:'Vuelve a intentarlo.'});}finally{if(owner.current===uid)setActing(false);}
 };
 if(!user)return <AuthRequiredScreen title="Notificaciones" subtitle="Inicia sesión para consultar tus avisos." ctaLabel="Iniciar sesión" Icon={LogIn}/>;
 const chip=(text:string,selected:boolean,press:()=>void)=><TouchableOpacity key={text} accessibilityRole="button" accessibilityState={{selected}} onPress={press} style={[styles.chip,selected&&styles.chipActive]}><Text style={styles.chipText}>{text}</Text></TouchableOpacity>;
 return <View style={styles.page}><LinearGradient colors={['#0F0F1A','#1A1025','#0F0F1A']} style={StyleSheet.absoluteFill}/><SafeAreaView style={styles.safe}>
  <View style={styles.header}><TouchableOpacity accessibilityLabel="Volver" onPress={()=>router.back()} style={styles.icon}><ArrowLeft color="white" size={24}/></TouchableOpacity><View style={styles.grow}><Text style={styles.title}>Notificaciones</Text><Text style={styles.muted}>{inbox.unreadCount} sin leer</Text></View><TouchableOpacity accessibilityRole="button" onPress={()=>router.push('/notification-preferences')}><Text style={styles.link}>Ajustes</Text></TouchableOpacity></View>
  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipBar} contentContainerStyle={styles.chipContent}>{chip('Todos los perfiles',inbox.selectedRole===null,()=>inbox.setSelectedRole(null))}{inbox.roles.map(role=>chip(NOTIFICATION_ROLE_LABELS[role],inbox.selectedRole===role,()=>inbox.setSelectedRole(role)))}</ScrollView>
  <View style={styles.filters}>{chip('Todas',inbox.filter==='all',()=>inbox.setFilter('all'))}{chip('No leídas',inbox.filter==='unread',()=>inbox.setFilter('unread'))}{chip('Importantes',inbox.filter==='important',()=>inbox.setFilter('important'))}</View>
  <View style={styles.actions}><TouchableOpacity onPress={()=>inbox.setShowArchived(!inbox.showArchived)}><Text style={styles.link}>{inbox.showArchived?'Volver a recibidas':'Ver archivo'}</Text></TouchableOpacity><TouchableOpacity disabled={acting||inbox.unreadCount===0} onPress={()=>void action(inbox.markAllAsRead)}><Text style={[styles.link,(acting||inbox.unreadCount===0)&&styles.disabled]}>Marcar todo leído</Text></TouchableOpacity></View>
  {inbox.error?<View style={styles.notice}><Text accessibilityRole="alert" style={styles.body}>{inbox.error}</Text><TouchableOpacity onPress={()=>void inbox.fetchNotifications()}><Text style={styles.link}>Reintentar</Text></TouchableOpacity></View>:null}
  {opening?<ActivityIndicator accessibilityLabel="Abriendo notificación" color="#C5ABFF"/>:null}
  <FlatList data={inbox.notifications} keyExtractor={item=>item.id} refreshing={inbox.loading&&inbox.notifications.length>0} onRefresh={()=>void inbox.fetchNotifications()} contentContainerStyle={styles.list}
    renderItem={({item})=><TouchableOpacity accessibilityRole="button" accessibilityLabel={`${item.read?'Leída':'No leída'}. ${item.title||'Notificación'}`} onPress={()=>void open(item.id)} style={[styles.card,!item.read&&styles.unread]}>
      <View style={styles.cardHeading}><View style={[styles.dot,item.read&&styles.readDot]}/><Text style={styles.cardTitle}>{item.title||'Notificación'}</Text>{item.priority==='high'?<Text style={styles.important}>Importante</Text>:null}</View>
      <Text style={styles.body} numberOfLines={3}>{item.body||item.message}</Text><View style={styles.cardFooter}><Text style={styles.muted}>{item.role?NOTIFICATION_ROLE_LABELS[item.role]:''}</Text><Text style={styles.muted}>{Number.isFinite(Date.parse(item.created_at))?new Date(item.created_at).toLocaleString('es-ES',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}):''}</Text></View>
    </TouchableOpacity>}
    ListEmptyComponent={!inbox.loading&&!inbox.error?<View style={styles.empty}><Bell size={38} color="#C5ABFF"/><Text style={styles.emptyTitle}>{inbox.showArchived?'No hay avisos archivados':'Todo al día'}</Text><Text style={styles.muted}>Aquí aparecerán los avisos que correspondan a tu actividad.</Text></View>:null}
    ListFooterComponent={inbox.loading?<ActivityIndicator color="#C5ABFF"/>:inbox.hasMore?<TouchableOpacity style={styles.more} onPress={()=>void inbox.loadMore()}><Text style={styles.link}>Cargar más</Text></TouchableOpacity>:null}/>
  <Modal visible={!!visibleDetail} transparent animationType="slide" onRequestClose={()=>setDetail(null)}><View style={styles.scrim}><SafeAreaView style={styles.modal}><ScrollView contentContainerStyle={styles.modalContent}>
    <Text style={styles.muted}>ECLIPSE · {visibleDetail?.role?NOTIFICATION_ROLE_LABELS[visibleDetail.role]:''}</Text><Text style={styles.detailTitle}>{visibleDetail?.title}</Text><Text style={styles.detailBody}>{visibleDetail?.body||visibleDetail?.message}</Text>
    <TouchableOpacity disabled={acting} accessibilityRole="button" style={styles.primary} onPress={()=>void follow()}><Text style={styles.primaryText}>Ver en Eclipse</Text></TouchableOpacity>
    <TouchableOpacity disabled={acting} style={styles.more} onPress={()=>visibleDetail&&void action(()=>visibleDetail.archived_at?inbox.restoreNotification(visibleDetail.id):inbox.deleteNotification(visibleDetail.id))}><Text style={styles.link}>{visibleDetail?.archived_at?'Restaurar aviso':'Archivar aviso'}</Text></TouchableOpacity>
    <TouchableOpacity style={styles.more} onPress={()=>setDetail(null)}><Text style={styles.body}>Cerrar</Text></TouchableOpacity>
  </ScrollView></SafeAreaView></View></Modal>
 </SafeAreaView></View>;
}
const styles=StyleSheet.create({page:{flex:1,backgroundColor:'#0F0F1A'},safe:{flex:1},header:{flexDirection:'row',alignItems:'center',padding:20,gap:14},icon:{padding:8},grow:{flex:1},title:{color:'white',fontSize:26,fontWeight:'700'},muted:{color:'#AFA9BD',fontSize:12,lineHeight:18},link:{color:'#CDB8FF',fontWeight:'600',fontSize:14},chipBar:{maxHeight:52},chipContent:{paddingHorizontal:20,gap:8,alignItems:'center'},chip:{paddingVertical:9,paddingHorizontal:12,borderRadius:20,backgroundColor:'#241E33',borderWidth:1,borderColor:'#352C48'},chipActive:{backgroundColor:'#49336A',borderColor:'#BB95EE'},chipText:{color:'#F0EAF9',fontSize:13},filters:{flexDirection:'row',gap:8,padding:20,paddingBottom:12},actions:{flexDirection:'row',justifyContent:'space-between',paddingHorizontal:20,paddingBottom:12},disabled:{opacity:0.4},list:{padding:20,paddingTop:8,paddingBottom:48},card:{backgroundColor:'#201A2D',borderRadius:18,padding:18,borderWidth:1,borderColor:'#352D45',marginBottom:12},unread:{borderColor:'#9570C5',backgroundColor:'#2B203B'},cardHeading:{flexDirection:'row',alignItems:'center',gap:8,marginBottom:9},dot:{height:7,width:7,borderRadius:4,backgroundColor:'#C9A5FF'},readDot:{backgroundColor:'transparent'},cardTitle:{color:'white',fontSize:16,fontWeight:'700',flex:1},important:{color:'#EDCD8F',fontSize:10,fontWeight:'700'},body:{color:'#DDD7E7',fontSize:14,lineHeight:21},cardFooter:{flexDirection:'row',justifyContent:'space-between',marginTop:13},notice:{margin:20,padding:18,gap:12,backgroundColor:'#312336',borderRadius:14},empty:{alignItems:'center',gap:12,paddingTop:70},emptyTitle:{color:'white',fontSize:21,fontWeight:'600'},more:{padding:16,alignItems:'center'},scrim:{flex:1,backgroundColor:'#00000099',justifyContent:'flex-end'},modal:{maxHeight:'80%',backgroundColor:'#211A2F',borderTopLeftRadius:24,borderTopRightRadius:24},modalContent:{padding:26},detailTitle:{color:'white',fontSize:26,lineHeight:33,fontWeight:'700',marginVertical:18},detailBody:{color:'#E1DBE9',fontSize:17,lineHeight:26,marginBottom:28},primary:{padding:16,backgroundColor:'#8F65CD',borderRadius:14,alignItems:'center'},primaryText:{color:'white',fontSize:16,fontWeight:'700'}});
