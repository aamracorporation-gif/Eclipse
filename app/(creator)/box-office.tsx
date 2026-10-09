import { useCallback, useState } from 'react';
import { Text, ScrollView, TouchableOpacity, StyleSheet, Platform, Linking } from 'react-native';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as WebBrowser from 'expo-web-browser';
import { useAuth } from '@/lib/AuthContext';
import { invokeEdgeFunctionStrict } from '@/lib/edgeFunctions';
import { useBoxOfficeAccess } from '@/hooks/useBoxOfficeAccess';
import { BoxOfficePlanCard } from '@/components/BoxOfficePlanCard';
import { ChevronLeft } from '@/lib/icons';

export default function BoxOfficeScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const access = useBoxOfficeAccess(user?.id);
  const { refresh } = access;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const sync = useCallback(async () => {
    try { await invokeEdgeFunctionStrict('box-office-billing', { action: 'refresh' }); setError(''); }
    catch { setError('No se pudo actualizar la facturación. Puedes volver a intentarlo.'); }
    finally { await refresh(); }
  }, [refresh]);
  useFocusEffect(useCallback(() => { void sync(); }, [sync]));
  const openBilling = async (action: 'checkout' | 'portal') => {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const data = await invokeEdgeFunctionStrict<{ url: string }>('box-office-billing', { action });
      const destination = new URL(data.url);
      if (destination.protocol !== 'https:' || !['checkout.stripe.com', 'billing.stripe.com'].includes(destination.hostname)) throw new Error('Invalid billing URL');
      if (Platform.OS === 'web') await Linking.openURL(data.url);
      else await WebBrowser.openBrowserAsync(data.url);
      await sync();
    } catch { setError('No se pudo abrir la facturación. Inténtalo de nuevo.'); }
    finally { setBusy(false); }
  };
  return <SafeAreaView style={s.page}><ScrollView contentContainerStyle={s.content}>
    <TouchableOpacity accessibilityRole="button" accessibilityLabel="Volver" onPress={()=>router.canGoBack()?router.back():router.replace('/(creator)/workers')} style={s.back}><ChevronLeft size={22} color="white"/><Text style={s.heading}>Taquilla Premium</Text></TouchableOpacity>
    <BoxOfficePlanCard access={access} busy={busy || access.checking} onSubscribe={()=>void openBilling('checkout')} onManage={()=>void openBilling('portal')}/>
    {!!(error || access.error) && <Text accessibilityRole="alert" style={s.error}>{error || access.error}</Text>}
    <TouchableOpacity accessibilityRole="button" onPress={()=>void sync()} style={s.refresh}><Text style={s.link}>Actualizar estado del pago</Text></TouchableOpacity>
    <Text style={s.note}>Al activar la suscripción podrás dar permiso de venta a tus trabajadores desde Mi equipo. Los trabajadores sin permiso seguirán utilizando el escáner.</Text>
  </ScrollView></SafeAreaView>;
}
const s=StyleSheet.create({page:{flex:1,backgroundColor:'#0C0913'},content:{padding:20,paddingBottom:110,maxWidth:540,width:'100%',alignSelf:'center',gap:22},back:{flexDirection:'row',alignItems:'center',gap:12},heading:{color:'white',fontSize:18,fontWeight:'700'},error:{color:'#FFAEAE',fontSize:13,lineHeight:20},refresh:{padding:12,alignItems:'center'},link:{color:'#C8AAF1',fontSize:13,fontWeight:'600'},note:{color:'#A293B5',fontSize:12,lineHeight:19}});
