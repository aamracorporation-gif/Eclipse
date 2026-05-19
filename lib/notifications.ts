import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { supabase } from '@/lib/supabase';
import * as Location from 'expo-location';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Helper to calculate distance in km
function getDistanceFromLatLonInKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371; // Radius of the earth in km
  const dLat = deg2rad(lat2-lat1);  // deg2rad below
  const dLon = deg2rad(lon2-lon1); 
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) * 
    Math.sin(dLon/2) * Math.sin(dLon/2)
    ; 
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)); 
  return R * c; // Distance in km
}

function deg2rad(deg: number) {
  return deg * (Math.PI/180)
}

export async function checkNearbyEvents(userId: string) {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return;

    const location = await Location.getCurrentPositionAsync({});
    const { latitude, longitude } = location.coords;

    // Get upcoming events with venue details
    const { data: events } = await supabase
      .from('events')
      .select('*, venues(*)')
      .gt('event_date', new Date().toISOString())
      .lt('event_date', new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()); // Next 7 days

    if (!events) return;

    for (const event of events) {
      if (event.venues?.latitude && event.venues?.longitude) {
        const distance = getDistanceFromLatLonInKm(
          latitude,
          longitude,
          event.venues.latitude,
          event.venues.longitude
        );

        // If event is within 10km
        if (distance <= 10) {
          // Check if we already notified about this event recently to avoid spam
          // For now, we'll rely on the backend rate limiting or just schedule local notification
          
          await Notifications.scheduleNotificationAsync({
            content: {
              title: "¡Fiesta cerca de ti! 🎉",
              body: `${event.title} está a solo ${distance.toFixed(1)}km. ¡No te lo pierdas!`,
              data: { eventId: event.id, url: `/(tabs)/event/${event.id}` },
            },
            trigger: null, // Show immediately
          });
        }
      }
    }
  } catch (error) {
    console.log('Error checking nearby events:', error);
  }
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
  } catch (error) {
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

export async function scheduleLocalNotification(title: string, body: string, data: any = {}, delaySeconds: number = 0) {
    const remoteEnabled = await AsyncStorage.getItem('remote_push_enabled');
    if (remoteEnabled === '1') {
      return;
    }
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== 'granted') {
      return;
    }

    // Expo Notifications 'seconds' trigger must be at least 1 if provided, otherwise use null for immediate
    // However, if delaySeconds is 0, passing null as trigger executes immediately.
    // If delaySeconds > 0, we pass { seconds: delaySeconds }
    
    // Safety check: ensure seconds is valid if we use it
    const trigger = delaySeconds > 0 ? { seconds: delaySeconds, channelId: 'default' } : null;

    await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        data,
        sound: true,
      },
      trigger,
    });
}
