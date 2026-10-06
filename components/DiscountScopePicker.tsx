import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { supabase } from '@/lib/supabase';
import type { DiscountScope } from '@/supabase/functions/_shared/discountPolicy';

type Product = { id: string; name: string; price: number; is_active: boolean };
type Props = {
  eventId: string; scope: DiscountScope; ticketIds: string[]; vipIds: string[]; disabled?: boolean;
  onScope: (scope: DiscountScope) => void; onTickets: (ids: string[]) => void; onVips: (ids: string[]) => void;
  onReady: (ready: boolean) => void;
};
const scopes: { value: DiscountScope; label: string }[] = [
  { value: 'tickets', label: 'Todas las entradas' }, { value: 'vip_tables', label: 'Todas las mesas VIP' },
  { value: 'all', label: 'Entradas y mesas VIP' }, { value: 'selected', label: 'Productos concretos' },
];
export function DiscountScopePicker({ eventId, scope, ticketIds, vipIds, disabled, onScope, onTickets, onVips, onReady }: Props) {
  const [tickets, setTickets] = useState<Product[]>([]);
  const [vips, setVips] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    void Promise.all([
      supabase.from('event_ticket_types').select('id,name,price,is_active').eq('event_id', eventId).is('deleted_at', null).order('created_at'),
      supabase.from('reservados_vip').select('id,name,base_price,is_active').eq('event_id', eventId).is('deleted_at', null).order('created_at'),
    ]).then(([admissions, tables]) => {
      if (!active) return;
      if (admissions.error || tables.error) { setError('No se pudieron cargar los productos. Reintenta antes de guardar una selección.'); return; }
      setTickets((admissions.data ?? []) as Product[]);
      setVips((tables.data ?? []).map(row => ({ ...row, price: row.base_price })) as Product[]);
    }).catch(() => { if (active) setError('No se pudieron cargar los productos.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [eventId, reload]);
  const missingTickets = ticketIds.filter(id => !tickets.some(row => row.id === id));
  const missingVips = vipIds.filter(id => !vips.some(row => row.id === id));
  const ready = scope !== 'selected' || (!loading && !error && ticketIds.length + vipIds.length > 0
    && missingTickets.length + missingVips.length === 0);
  useEffect(() => { onReady(!!ready); }, [ready, onReady]);
  const toggle = useCallback((ids: string[], id: string, setter: (ids: string[]) => void) => {
    setter(ids.includes(id) ? ids.filter(value => value !== id) : [...ids, id]);
  }, []);
  const group = (title: string, products: Product[], ids: string[], setter: (ids: string[]) => void) => <View style={styles.group}>
    <Text style={styles.groupTitle}>{title}</Text>
    {products.length === 0 ? <Text style={styles.hint}>No hay productos de este tipo configurados.</Text>
      : products.map(product => <TouchableOpacity key={product.id} accessibilityRole="checkbox"
        accessibilityState={{ checked: ids.includes(product.id), disabled: !!disabled }} disabled={disabled}
        accessibilityLabel={`${title}: ${product.name}`} onPress={() => toggle(ids, product.id, setter)}
        style={[styles.product, ids.includes(product.id) && styles.selected]}>
        <Text style={styles.check}>{ids.includes(product.id) ? '✓' : '○'}</Text>
        <View style={styles.productInfo}><Text style={styles.productName}>{product.name}</Text>
          <Text style={styles.hint}>{Number(product.price).toFixed(2)} €{!product.is_active ? ' · inactivo' : ''}</Text></View>
      </TouchableOpacity>)}
  </View>;
  return <View style={styles.container}>
    <Text style={styles.title}>¿A qué se aplica el código?</Text>
    <View style={styles.scopes}>{scopes.map(option => <TouchableOpacity key={option.value} accessibilityRole="radio"
      accessibilityState={{ selected: scope === option.value, disabled: !!disabled }} disabled={disabled}
      onPress={() => onScope(option.value)} style={[styles.scope, scope === option.value && styles.selected]}>
      <Text style={styles.productName}>{scope === option.value ? '● ' : '○ '}{option.label}</Text>
    </TouchableOpacity>)}</View>
    <Text style={styles.hint}>{scope === 'tickets' ? 'Incluye todos los tipos de entrada del evento, pero no las mesas VIP.'
      : scope === 'vip_tables' ? 'Incluye los reservados completos, pero no las entradas individuales.'
      : scope === 'all' ? 'Incluye los productos actuales y los que añadas después al evento.'
      : 'Selecciona uno o varios productos. Los nuevos productos no se incluirán automáticamente.'}</Text>
    {scope === 'selected' && <>
      {loading ? <ActivityIndicator color="#A78BFA" /> : error ? <>
        <Text accessibilityRole="alert" style={styles.error}>{error}</Text>
        <TouchableOpacity accessibilityRole="button" onPress={() => setReload(value => value + 1)}><Text style={styles.productName}>Reintentar</Text></TouchableOpacity>
      </> : <>
        {group('Entradas', tickets, ticketIds, onTickets)}
        {group('Mesas VIP', vips, vipIds, onVips)}
        {missingTickets.length + missingVips.length > 0 && <TouchableOpacity accessibilityRole="button" disabled={disabled}
          onPress={() => { onTickets(ticketIds.filter(id => !missingTickets.includes(id))); onVips(vipIds.filter(id => !missingVips.includes(id))); }}>
          <Text style={styles.error}>Hay productos eliminados en la selección. Pulsa para retirarlos.</Text>
        </TouchableOpacity>}
        <Text accessibilityLiveRegion="polite" style={styles.hint}>{ticketIds.length + vipIds.length} productos seleccionados</Text>
      </>}
    </>}
  </View>;
}
const styles = StyleSheet.create({
  container: { gap: 12, marginVertical: 16 }, title: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  scopes: { gap: 8 }, scope: { borderRadius: 12, borderWidth: 1, borderColor: '#44394F', padding: 13, minHeight: 46 },
  selected: { backgroundColor: '#302040', borderColor: '#A78BFA' }, productName: { color: '#EEE6F5', fontSize: 13 },
  hint: { color: '#AA9BB7', fontSize: 12, lineHeight: 18 }, group: { gap: 8 },
  groupTitle: { color: '#C8ADF8', fontWeight: '700', marginTop: 6 }, product: { flexDirection: 'row', alignItems: 'center', gap: 12,
    borderRadius: 12, borderWidth: 1, borderColor: '#44394F', padding: 12, minHeight: 56 },
  check: { color: '#C8ADF8', fontSize: 22 }, productInfo: { flex: 1 }, error: { color: '#FCA5A5', fontSize: 12 },
});
