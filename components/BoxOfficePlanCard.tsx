import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { QrCode, Ticket, Users, Check, ArrowRight, Sparkles } from '@/lib/icons';
import type { BoxOfficeAccess } from '@/hooks/useBoxOfficeAccess';

type Props = { access: BoxOfficeAccess; busy?: boolean; onSubscribe: () => void; onManage: () => void };
export function BoxOfficePlanCard({ access, busy, onSubscribe, onManage }: Props) {
  const active = access.enabled;
  const manageable = !['inactive', 'canceled', 'incomplete_expired'].includes(access.status);
  return <View style={s.card}>
    <LinearGradient colors={['#292039', '#12101B', '#181023']} style={StyleSheet.absoluteFill} />
    <View pointerEvents="none" style={s.orbit} /><View pointerEvents="none" style={s.orbitInner} />
    <View style={s.top}><Text style={s.eyebrow}>MI SUSCRIPCIÓN</Text><View style={s.badge}><Sparkles size={12} color="#DDC296"/><Text style={s.badgeText}>{active ? 'ACTIVA' : access.status === 'past_due' ? 'PAGO PENDIENTE' : 'SIN ACTIVAR'}</Text></View></View>
    <Text style={s.title}>Taquilla Premium</Text>
    <Text style={s.description}>Vende entradas en la puerta desde la app, con los trabajadores que tú autorices.</Text>
    <View style={s.priceRow}><Text style={s.price}>50 €</Text><Text style={s.period}>/ mes{ '\n' }por organizador</Text></View>
    <View style={s.divider}/>
    <View style={s.feature}><Ticket size={18} color="#DDC296"/><Text style={s.featureText}>Venta de entradas y mesas en taquilla</Text></View>
    <View style={s.feature}><Users size={18} color="#DDC296"/><Text style={s.featureText}>Tu equipo autorizado, sin coste por trabajador</Text></View>
    <View style={s.feature}><Check size={18} color="#DDC296"/><Text style={s.featureText}>Emisión de QR y registro de cada venta</Text></View>
    {active && access.paid_through && <Text style={s.status}>{access.cancel_at_period_end ? 'Disponible hasta el ' : 'Próxima renovación: '}{new Date(access.paid_through).toLocaleDateString('es-ES')}</Text>}
    {!active && access.status === 'past_due' && <Text style={s.status}>Pago pendiente. Actualiza el método de pago para volver a vender.</Text>}
    <TouchableOpacity accessibilityRole="button" accessibilityState={{ disabled: !!busy, busy: !!busy }} disabled={busy} onPress={active || manageable ? onManage : onSubscribe} style={[s.button, busy && { opacity: .5 }]}>
      <Text style={s.buttonText}>{busy ? 'Conectando…' : active || manageable ? 'Gestionar suscripción' : 'Activar por 50 €/mes'}</Text><ArrowRight size={18} color="#15101C"/>
    </TouchableOpacity>
    <Text style={s.terms}>Renovación mensual automática. Cancela cuando quieras; mantienes el acceso hasta el final del periodo pagado.</Text>
    <View style={s.free}><QrCode size={18} color="#BDB0D7"/><Text style={s.freeText}>Escanear entradas está incluido siempre.{ '\n' }La suscripción solo desbloquea la venta en taquilla.</Text></View>
  </View>;
}
const s = StyleSheet.create({
 card:{padding:20,borderRadius:26,borderWidth:1,borderColor:'#51405D',overflow:'hidden',gap:14},
 orbit:{position:'absolute',width:240,height:240,borderRadius:120,borderWidth:1,borderColor:'#847057',right:-150,top:18,transform:[{scaleX:1.4}]},
 orbitInner:{position:'absolute',width:210,height:210,borderRadius:105,borderWidth:1,borderColor:'#493657',right:-115,top:38},
 top:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:8,flexWrap:'wrap'},eyebrow:{color:'#B8A5D1',fontSize:12,letterSpacing:1,fontWeight:'700'},
 badge:{flexDirection:'row',alignItems:'center',gap:5,paddingVertical:5,paddingHorizontal:8,borderRadius:20,backgroundColor:'#DDC29618'},badgeText:{color:'#DDC296',fontSize:12,fontWeight:'800',letterSpacing:1},
 title:{color:'#FFF9EF',fontSize:30,lineHeight:36,fontWeight:'800',letterSpacing:-1},description:{color:'#E0D6EE',fontSize:16,lineHeight:24,maxWidth:350},
 priceRow:{flexDirection:'row',alignItems:'center',gap:12,marginTop:8},price:{color:'#E4C99E',fontSize:48,fontWeight:'800',letterSpacing:-2},period:{fontSize:15,lineHeight:22,color:'#E0D6EE'},
 divider:{height:1,backgroundColor:'#FFFFFF14',marginVertical:4},feature:{flexDirection:'row',gap:10,alignItems:'center'},featureText:{color:'#E7DEEF',fontSize:15,flex:1,lineHeight:23},
 status:{fontSize:15,color:'#F3DDAF',lineHeight:23},button:{minHeight:52,padding:17,borderRadius:15,backgroundColor:'#DFBF89',flexDirection:'row',alignItems:'center',justifyContent:'center',gap:12,marginTop:8},buttonText:{color:'#15101C',fontSize:16,fontWeight:'800',flexShrink:1,textAlign:'center'},
 terms:{fontSize:14,lineHeight:22,color:'#D4C9E2'},free:{paddingTop:16,borderTopWidth:1,borderColor:'#FFFFFF14',flexDirection:'row',gap:12,alignItems:'center'},freeText:{fontSize:14,lineHeight:22,color:'#D4C9E2',flex:1},
});
