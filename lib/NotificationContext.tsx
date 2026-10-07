import React, {createContext,useCallback,useContext,useEffect,useRef,useState} from 'react';
import {AppState,Platform} from 'react-native';
import * as ExpoNotifications from 'expo-notifications';
import {supabase} from './supabase';
import {useAuth} from './AuthContext';
import {normalizeNotificationRow,type NotificationModel} from './notificationSchema';
import {registerForPushNotifications} from './notifications';
import {NOTIFICATION_ROLES,type NotificationRole} from './notificationNavigation';

export type Notification=NotificationModel;
type Filter='all'|'unread'|'important';
type Snapshot={scope:string;items:Notification[];unread:number;roles:NotificationRole[];hasMore:boolean};
type Context={notifications:Notification[];unreadCount:number;loading:boolean;error:string|null;hasMore:boolean;roles:NotificationRole[];
 selectedRole:NotificationRole|null;setSelectedRole:(role:NotificationRole|null)=>void;filter:Filter;setFilter:(filter:Filter)=>void;
 showArchived:boolean;setShowArchived:(value:boolean)=>void;fetchNotifications:()=>Promise<void>;loadMore:()=>Promise<void>;
 markAsRead:(id:string)=>Promise<void>;markAllAsRead:()=>Promise<void>;deleteNotification:(id:string)=>Promise<void>;
 deleteAllNotifications:()=>Promise<void>;restoreNotification:(id:string)=>Promise<void>};
const NotificationContext=createContext<Context|undefined>(undefined);
export function NotificationProvider({children}:{children:React.ReactNode}) {
 const {user}=useAuth();const uid=user?.id??'';
 const [selectedRole,setSelectedRole]=useState<NotificationRole|null>(null);
 const [filter,setFilter]=useState<Filter>('all');const [showArchived,setShowArchived]=useState(false);
 useEffect(()=>{setSelectedRole(null);setFilter('all');setShowArchived(false);},[uid]);
 const scope=`${uid}:${selectedRole??'all'}:${filter}:${showArchived}`;
 const active=useRef(scope);active.current=scope;
 const sequence=useRef(0),busy=useRef(false),snapshotRef=useRef<Snapshot|null>(null);
 const [snapshot,setSnapshot]=useState<Snapshot|null>(null),[loading,setLoading]=useState(false),[failure,setFailure]=useState<{scope:string;message:string}|null>(null);
 const fetchPage=useCallback(async(append=false)=>{
  if(!uid)return;
  if(append&&busy.current)return;
  const current=snapshotRef.current?.scope===scope?snapshotRef.current:null;
  if(append&&!current?.hasMore)return;
  const tail=append?current?.items.at(-1):undefined;
  const call=++sequence.current;busy.current=true;setLoading(true);setFailure(null);
  try {
   const {data,error}=await supabase.rpc('notification_inbox_v2',{p_role:selectedRole,p_archived:showArchived,p_filter:filter,p_limit:50,p_before:tail?.created_at??null,p_before_id:tail?.id??null});
   if(error)throw error;
   if(active.current!==scope||sequence.current!==call)return;
   const rows=(Array.isArray(data?.items)?data.items:[]).map(normalizeNotificationRow).filter((n:Notification)=>n.user_id===uid);
   const items=append?[...(current?.items??[]),...rows]:rows;
   const next:Snapshot={scope,items:[...new Map<string,Notification>(items.map((n:Notification)=>[n.id,n])).values()],unread:Number(data?.unread_count)||0,
    roles:NOTIFICATION_ROLES.filter(r=>data?.roles?.includes(r)),hasMore:rows.length===50};
   snapshotRef.current=next;setSnapshot(next);
  }catch{
   if(active.current===scope&&sequence.current===call){snapshotRef.current=null;setSnapshot(null);setFailure({scope,message:'No se pudieron cargar las notificaciones. Comprueba la conexión y reintenta.'});}
  }finally{if(sequence.current===call){busy.current=false;setLoading(false);}}
 },[uid,scope,selectedRole,showArchived,filter]);
 const fetchNotifications=useCallback(()=>fetchPage(false),[fetchPage]);
 const loadMore=useCallback(()=>fetchPage(true),[fetchPage]);
 const action=useCallback(async(kind:string,ids:string[]|null=null)=>{
  if(!uid)return;
  const {error}=await supabase.rpc('notification_inbox_action_v2',{p_action:kind,p_ids:ids,p_role:selectedRole,p_expected_user:uid});
  if(error)throw new Error('No se pudo guardar el cambio. Vuelve a intentarlo.');
  if(active.current===scope)await fetchNotifications();
 },[uid,scope,selectedRole,fetchNotifications]);
 useEffect(()=>{
  if(!uid){sequence.current++;snapshotRef.current=null;setSnapshot(null);setFailure(null);busy.current=false;setLoading(false);return;}
  void fetchNotifications();
  let timer:ReturnType<typeof setTimeout>|undefined;
  const refresh=()=>{if(timer)clearTimeout(timer);timer=setTimeout(()=>void fetchNotifications(),250);};
  const channel=supabase.channel(`notification-inbox-v2-${uid}`).on('postgres_changes',{event:'*',schema:'public',table:'notifications',filter:`user_id=eq.${uid}`},refresh).subscribe();
  const foreground=AppState.addEventListener('change',state=>{if(state==='active'){void fetchNotifications();void registerForPushNotifications(uid).catch(()=>{});}});
  void registerForPushNotifications(uid).catch(()=>{});
  return()=>{if(timer)clearTimeout(timer);void supabase.removeChannel(channel);foreground.remove();sequence.current++;busy.current=false;};
 },[uid,fetchNotifications]);
 const visible=snapshot?.scope===scope?snapshot:null;
 const unreadCount=visible?.unread??0;
 useEffect(()=>{if(Platform.OS!=='web')void ExpoNotifications.setBadgeCountAsync(unreadCount).catch(()=>{});},[unreadCount,uid]);
 return <NotificationContext.Provider value={{notifications:visible?.items??[],unreadCount,roles:visible?.roles??[],hasMore:visible?.hasMore??false,
 loading:!!uid&&(loading||(!visible&&failure?.scope!==scope)),error:failure?.scope===scope?failure.message:null,
 selectedRole,setSelectedRole,filter,setFilter,showArchived,setShowArchived,fetchNotifications,loadMore,
 markAsRead:id=>action('read',[id]),markAllAsRead:()=>action('read'),deleteNotification:id=>action('archive',[id]),
 deleteAllNotifications:()=>action('archive'),restoreNotification:id=>action('unarchive',[id])}}>{children}</NotificationContext.Provider>;
}
export function useNotifications(){const value=useContext(NotificationContext);if(!value)throw new Error('useNotifications must be used within a NotificationProvider');return value;}
