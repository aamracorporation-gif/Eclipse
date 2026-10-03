import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/lib/supabase';

// Nearby events check — notifications are server-side only, no local Expo notifications
export async function checkNearbyEvents(_userId: string) {
  // no-op: nearby event push is handled server-side
}

export async function registerForPushNotifications(userId: string | null) {
  if (!userId) return;

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;
  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  if (finalStatus !== 'granted') {
    await AsyncStorage.setItem('remote_push_enabled', '0');
    return;
  }



  let token;
  try {
    // Check if we are in a physical device context where push tokens are supported
    // Note: Expo Go no longer supports remote notifications in SDK 53+
    const projectId =
      (Constants as any)?.easConfig?.projectId ||
      (Constants as any)?.expoConfig?.extra?.eas?.projectId ||
      (Constants as any)?.expoConfig?.extra?.projectId ||
      (Constants as any)?.expoConfig?.extra?.expoProjectId;

    if (!projectId) {
      await AsyncStorage.setItem('remote_push_enabled', '0');
      return;
    }

    const tokenData = await Notifications.getExpoPushTokenAsync({ projectId } as any);
    token = tokenData.data;
  } catch {
    await AsyncStorage.setItem('remote_push_enabled', '0');
    return;
  }

  const platform = Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'web';

  try {
    const { error: rpcError } = await supabase.rpc('upsert_user_push_token', {
      p_token: token,
      p_platform: platform,
    });

    if (rpcError) {
      const { error: upsertError } = await supabase
        .from('user_push_tokens')
        .upsert(
          {
            user_id: userId,
            token,
            platform,
            is_active: true,
          },
          { onConflict: 'token' }
        );
      if (upsertError) {
        await AsyncStorage.setItem('remote_push_enabled', '0');
        return;
      }
    }

    await AsyncStorage.setItem('remote_push_enabled', '1');
  } catch (e) {
    console.warn('Push token registration exception:', e);
    await AsyncStorage.setItem('remote_push_enabled', '0');
  }
}

export async function initNotifications() {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#FF231F7C',
      sound: 'default',
    });
  }
}

// Local notifications disabled — all push notifications are sent server-side only
 
export async function scheduleLocalNotification(_title: string, _body: string, _data: any = {}, _delaySeconds: number = 0) {
  // no-op
}
