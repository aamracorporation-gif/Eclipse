import { Text, View, TouchableOpacity, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { Ticket, ChevronRight } from '@/lib/icons';

export function SubscriptionShortcut() {
  return <TouchableOpacity accessibilityRole="button" accessibilityLabel="Mi suscripción, Taquilla Premium. Ver plan y gestionar" onPress={() => router.push('/(creator)/box-office')} style={s.card}>
    <View style={s.icon}><Ticket size={24} color="#F4F0FF" /></View>
    <View style={s.copy}><Text style={s.title}>Mi suscripción</Text><Text style={s.detail}>Taquilla Premium · 50 €/mes</Text><Text style={s.link}>Ver plan y gestionar</Text></View>
    <ChevronRight size={22} color="#F4F0FF" />
  </TouchableOpacity>;
}
const s = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 18, borderRadius: 20, borderWidth: 1, borderColor: '#75609D', backgroundColor: '#20192E', marginVertical: 14, minHeight: 96 },
  icon: { padding: 10, borderRadius: 12, backgroundColor: '#38294D' },
  copy: { flex: 1, gap: 5 }, title: { color: '#FFFFFF', fontSize: 18, fontWeight: '700' },
  detail: { color: '#E0D6EE', fontSize: 14, lineHeight: 21 }, link: { color: '#D5BCFF', fontSize: 14, lineHeight: 21, fontWeight: '600' },
});
