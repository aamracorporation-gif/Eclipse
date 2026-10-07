import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/lib/supabase';

const TOKEN_STORAGE = 'eclipse.core.push.registration';
let generation = 0;
let activeUser: string | null = null;
let queue: Promise<unknown> = Promise.resolve();
function serialize<T>(work: () => Promise<T>): Promise<T> {
  const result = queue.then(work, work);
  queue = result.catch(() => {});
  return result;
}

export function setNotificationUser(userId: string | null) {
  if (activeUser === userId) return;
  const previous = activeUser;
  activeUser = userId;
  generation += 1;
  if (Platform.OS !== 'web' && (previous !== null || userId === null)) {
    void serialize(async () => {
      await Notifications.dismissAllNotificationsAsync().catch(() => {});
      await Notifications.clearLastNotificationResponseAsync().catch(() => {});
      await Notifications.setBadgeCountAsync(0).catch(() => {});
    });
  }
}

async function createChannels() {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('eclipse-activity', {
      name: 'Compras y cambios de Eclipse',
      importance: Notifications.AndroidImportance.DEFAULT,
      sound: 'default',
    });
  }
}

/** Automatic calls only inspect permission; the OS prompt requires an explicit user action. */
export async function registerForPushNotifications(userId: string | null, options: { requestPermission?: boolean } = {}): Promise<boolean> {
  if (!userId || Platform.OS === 'web' || activeUser !== userId) return false;
  const version = generation;
  return serialize(async () => {
    if (version !== generation || activeUser !== userId) return false;
    try {
      await createChannels();
      let permissions = await Notifications.getPermissionsAsync();
      if (!permissions.granted && options.requestPermission && permissions.canAskAgain) {
        permissions = await Notifications.requestPermissionsAsync();
      }
      if (!permissions.granted) return false;
      const projectId = (Constants as any)?.easConfig?.projectId || (Constants as any)?.expoConfig?.extra?.eas?.projectId;
      if (!projectId) return false;
      const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
      const { data } = await supabase.auth.getSession();
      if (version !== generation || activeUser !== userId || data.session?.user.id !== userId) return false;
      const { error } = await supabase.rpc('register_core_push_token', {
        p_user: userId, p_token: token, p_platform: Platform.OS, p_project: projectId,
      });
      if (error || version !== generation || activeUser !== userId) return false;
      await AsyncStorage.setItem(TOKEN_STORAGE, JSON.stringify({ userId, token }));
      return true;
    } catch { return false; } // No tokens or provider exceptions in logs.
  });
}

/** Revoke while the user's session is still available; the server also checks session liveness. */
export async function unregisterForPushNotifications(userId: string | null) {
  setNotificationUser(null);
  if (!userId) return;
  const raw = await AsyncStorage.getItem(TOKEN_STORAGE);
  if (!raw) return;
  try {
    const stored = JSON.parse(raw);
    if (stored.userId !== userId || typeof stored.token !== 'string') return;
    await supabase.rpc('unregister_core_push_token', { p_user: userId, p_token: stored.token });
  } finally {
    const latest = await AsyncStorage.getItem(TOKEN_STORAGE);
    if (latest && JSON.parse(latest)?.userId === userId) await AsyncStorage.removeItem(TOKEN_STORAGE);
  }
}

export async function initNotifications() {
  if (Platform.OS === 'web') return;
  await createChannels();
  Notifications.setNotificationHandler({
    handleNotification: async () => {
      const visible = activeUser !== null;
      return { shouldShowAlert: visible, shouldPlaySound: visible, shouldSetBadge: false,
        shouldShowBanner: visible, shouldShowList: visible };
    },
  });
}

export async function checkNearbyEvents(_userId: string) { /* Not enabled in this release. */ }
export async function scheduleLocalNotification(_title: string, _body: string, _data: any = {}, _delaySeconds = 0) { /* Server scheduling only. */ }

export function observePushTokenChanges(userId: string) {
  if (Platform.OS === 'web') return { remove() {} };
  return Notifications.addPushTokenListener(() => { void registerForPushNotifications(userId); });
}
