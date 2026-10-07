import { View, Text, Switch, TouchableOpacity, StyleSheet } from 'react-native';

export type OrganizerNotificationSettings = {
  sales_mode: 'grouped' | 'immediate' | 'off';
  vip_sales_immediate: boolean;
  stock_alerts: boolean;
};
type Props = { value: OrganizerNotificationSettings; disabled: boolean; onChange: (patch: Partial<OrganizerNotificationSettings>) => void };
const modes: { value: OrganizerNotificationSettings['sales_mode']; title: string; description: string }[] = [
  { value: 'grouped', title: 'Agrupadas cada 15 minutos', description: 'Un resumen por evento, sin interrumpirte con cada compra.' },
  { value: 'immediate', title: 'Avisar de cada venta', description: 'Entradas y mesas al confirmarse. Invitaciones y taquilla se agrupan.' },
  { value: 'off', title: 'Solo en el historial', description: 'Conserva los resúmenes dentro de Eclipse, sin push de ventas.' },
];
export function OrganizerNotificationPreferences({ value, disabled, onChange }: Props) {
  return <View style={styles.section}>
    <Text style={styles.title}>Ventas de tus eventos</Text>
    <Text style={styles.help}>Se respetan los permisos, el horario de silencio y la opción general de actividad de tu perfil.</Text>
    {modes.map(mode => <TouchableOpacity key={mode.value} accessibilityRole="radio" accessibilityLabel={mode.title}
      accessibilityState={{ selected: value.sales_mode === mode.value, disabled }} disabled={disabled}
      onPress={() => onChange({ sales_mode: mode.value })}
      style={[styles.mode, value.sales_mode === mode.value && styles.selected, disabled && styles.disabled]}>
      <Text style={styles.label}>{value.sales_mode === mode.value ? '● ' : '○ '}{mode.title}</Text>
      <Text style={styles.help}>{mode.description}</Text>
    </TouchableOpacity>)}
    <View style={styles.row}><View style={styles.copy}><Text style={styles.label}>Mesas VIP al momento</Text>
      <Text style={styles.help}>Una reserva cuenta como una mesa, no como una venta por cada invitado.</Text></View>
      <Switch accessibilityLabel="Mesas VIP al momento" disabled={disabled || value.sales_mode === 'off'}
        value={value.vip_sales_immediate} onValueChange={vip_sales_immediate => onChange({ vip_sales_immediate })}
        trackColor={{ false: '#4A4358', true: '#9567CA' }} /></View>
    <View style={styles.row}><View style={styles.copy}><Text style={styles.label}>Alertas de disponibilidad</Text>
      <Text style={styles.help}>Entradas: 20 %, 5 % y agotadas. Mesas: últimas dos, última y agotadas. No avisa por editar el nombre o reponer stock.</Text></View>
      <Switch accessibilityLabel="Alertas de disponibilidad" disabled={disabled} value={value.stock_alerts}
        onValueChange={stock_alerts => onChange({ stock_alerts })} trackColor={{ false: '#4A4358', true: '#9567CA' }} /></View>
    <Text style={styles.help}>Los importes de estos avisos son productos vendidos, no el saldo disponible ni una liquidación bancaria.</Text>
  </View>;
}
const styles = StyleSheet.create({ section: { gap: 12, paddingTop: 20 }, title: { color: '#FAF7FF', fontSize: 19, fontWeight: '700' }, label: { color: '#FAF7FF', fontSize: 15, fontWeight: '600' }, help: { color: '#B7AEC6', fontSize: 13, lineHeight: 20, marginTop: 4 }, mode: { padding: 14, borderWidth: 1, borderColor: '#4A3B5C', borderRadius: 12 }, selected: { backgroundColor: '#413052', borderColor: '#C5ABFF' }, disabled: { opacity: 0.5 }, row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 12 }, copy: { flex: 1 } });
