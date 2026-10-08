import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/lib/supabase';
import { NOTIFICATION_UUID } from './notificationNavigation';

export type PushRegistrationResult='registered'|'permission-required'|'denied'|'unsupported'|'session-changed';
let epoch=0;
const activeRegistrations=new Map<string,Promise<PushRegistrationResult>>();
const storageKey=()=>`eclipse.notification.installation.v2:${String(process.env.EXPO_PUBLIC_SUPABASE_URL||'')}`;
async function channels() {
  if(Platform.OS!=='android')return;
  await Notifications.setNotificationChannelAsync('eclipse-activity',{name:'Compras y cambios importantes',importance:Notifications.AndroidImportance.HIGH,sound:'default'});
  await Notifications.setNotificationChannelAsync('eclipse-reminders',{name:'Recordatorios de eventos',importance:Notifications.AndroidImportance.DEFAULT,sound:'default'});
}
async function currentUser(expected: string): Promise<boolean> {
  const {data}=await supabase.auth.getSession();return data.session?.user?.id===expected;
}
async function register(userId: string,prompt: boolean): Promise<PushRegistrationResult> {
  if(Platform.OS!=='android'&&Platform.OS!=='ios')return 'unsupported';
  const attempt=epoch;
  if(!await currentUser(userId))return 'session-changed';
  await channels(); // Android channel must exist before requesting the push token.
  let permission=await Notifications.getPermissionsAsync();
  if(permission.status!=='granted' && prompt && permission.canAskAgain) permission=await Notifications.requestPermissionsAsync();
  if(permission.status!=='granted')return permission.canAskAgain?'permission-required':'denied';
  if(attempt!==epoch||!await currentUser(userId))return 'session-changed';
  const projectId=Constants.easConfig?.projectId||Constants.expoConfig?.extra?.eas?.projectId;
  if(typeof projectId!=='string'||!NOTIFICATION_UUID.test(projectId))return 'unsupported';
  const token=await Notifications.getExpoPushTokenAsync({projectId});
  if(attempt!==epoch||!await currentUser(userId))return 'session-changed';
  const raw=await AsyncStorage.getItem(storageKey());
  let previous: string|null=null;
  try{const parsed=JSON.parse(raw||'null');if(NOTIFICATION_UUID.test(parsed?.id))previous=parsed.id;}catch{/* Start with a server-generated installation ID. */}
  const {data,error}=await supabase.rpc('register_notification_installation_v2',{
    p_installation_id:previous,p_expected_user:userId,p_token:token.data,p_platform:Platform.OS,p_project_id:projectId,
  });
  if(error)throw new Error('No se pudo registrar este móvil. Actualiza Eclipse o vuelve a intentarlo.');
  if(attempt!==epoch||!await currentUser(userId))return 'session-changed';
  if(typeof data!=='string'||!NOTIFICATION_UUID.test(data))throw new Error('Registro de notificaciones no válido.');
  await AsyncStorage.setItem(storageKey(),JSON.stringify({id:data,user_id:userId}));
  return 'registered';
}
/** Silent unless explicitly called from the user's permission button. */
export async function registerForPushNotifications(userId:string|null,prompt=false):Promise<PushRegistrationResult> {
  if(!userId)return 'session-changed';
  const key=`${userId}:${prompt}`;const existing=activeRegistrations.get(key);if(existing)return existing;
  const task=register(userId,prompt).finally(()=>activeRegistrations.delete(key));activeRegistrations.set(key,task);return task;
}
export async function unregisterPushNotifications(userId:string|null):Promise<void> {
  epoch++;activeRegistrations.clear();
  if(Platform.OS==='web')return;
  await Promise.allSettled([Notifications.dismissAllNotificationsAsync(),Notifications.setBadgeCountAsync(0),Notifications.clearLastNotificationResponseAsync()]);
  if(!userId)return;
  const raw=await AsyncStorage.getItem(storageKey());
  let record: {id?:string;user_id?:string}|null=null;try{record=JSON.parse(raw||'null');}catch{return;}
  if(record?.user_id!==userId||!NOTIFICATION_UUID.test(record.id??''))return;
  const {error}=await supabase.rpc('unregister_notification_installation_v2',{p_installation_id:record.id,p_expected_user:userId});
  if(error)throw new Error('No se pudo desvincular el dispositivo; la sesión se revocará al cerrar sesión.');
}
export async function initNotifications() {
  Notifications.setNotificationHandler({handleNotification:async()=>({
    shouldPlaySound:true,shouldSetBadge:true,shouldShowBanner:true,shouldShowList:true,
  })}); // Present real remote pushes through the OS as well as keeping the in-app inbox.
  await channels();
}
// Compatibility exports. No local schedule or client-side service dispatcher.
export async function checkNearbyEvents(_userId:string) {}
export async function scheduleLocalNotification(_title:string,_body:string,_data:any={},_delaySeconds=0) {}
