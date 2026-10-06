import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { supabase } from '@/lib/supabase';
import { calculateDiscountCents, discountSelectionKey, type DiscountProductKind } from '@/supabase/functions/_shared/discountPolicy';

export type AppliedDiscount = {
  id: string;
  type: 'percentage' | 'fixed';
  value: number;
  label: string;
  selectionKey: string;
};

type Props = {
  eventId: string;
  kind: DiscountProductKind;
  productId: string | null;
  quantity: number;
  value: AppliedDiscount | null;
  disabled?: boolean;
  onChange: (discount: AppliedDiscount | null) => void;
  onCheckingChange: (checking: boolean) => void;
};

/** Both checkouts use the same control. Late responses cannot authorize a different selection. */
export function DiscountCodeField({ eventId, kind, productId, quantity, value, disabled, onChange, onCheckingChange }: Props) {
  const [code, setCode] = useState('');
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');
  const key = discountSelectionKey(eventId, kind, productId, quantity);
  const liveKey = useRef(key);
  liveKey.current = key;
  const sequence = useRef(0);
  const callbacks = useRef({ onChange, onCheckingChange });
  callbacks.current = { onChange, onCheckingChange };
  useEffect(() => {
    sequence.current++;
    setCode(''); setError(''); setChecking(false);
    callbacks.current.onChange(null);
    callbacks.current.onCheckingChange(false);
    return () => { sequence.current++; callbacks.current.onCheckingChange(false); };
  }, [key]);

  const apply = async () => {
    if (disabled || checking || !code.trim()) return;
    const request = ++sequence.current;
    const selectedKey = key;
    setChecking(true); setError('');
    callbacks.current.onCheckingChange(true);
    try {
      const { data, error: rpcError } = await supabase.rpc('validate_discount_code_for_product', {
        p_code: code.trim().toUpperCase(), p_event_id: eventId, p_quantity: quantity,
        p_ticket_type_id: kind === 'event_ticket' ? productId : null,
        p_vip_reservado_id: kind === 'vip_table' ? productId : null,
      });
      if (request !== sequence.current || selectedKey !== liveKey.current) return;
      if (rpcError) throw rpcError;
      const row = Array.isArray(data) ? data[0] : data;
      if (!row?.id) throw new Error('Código no válido.');
      calculateDiscountCents(100, row);
      const amount = Number(row.discount_value);
      callbacks.current.onChange({ id: row.id, type: row.discount_type, value: amount, selectionKey: selectedKey,
        label: row.discount_type === 'percentage' ? `${amount}% de descuento` : `${amount.toFixed(2)} € de descuento` });
    } catch (failure: any) {
      if (request !== sequence.current || selectedKey !== liveKey.current) return;
      callbacks.current.onChange(null);
      setError(failure?.code === 'PGRST202' ? 'Los descuentos por producto todavía no están disponibles en este entorno.'
        : failure?.message || 'No se pudo validar el código. Inténtalo de nuevo.');
    } finally {
      if (request === sequence.current && selectedKey === liveKey.current) {
        setChecking(false); callbacks.current.onCheckingChange(false);
      }
    }
  };
  const applied = value?.selectionKey === key ? value : null;
  return <View style={styles.container}>
    <Text style={styles.label}>Código de descuento</Text>
    {applied ? <View style={styles.row}>
      <Text accessibilityLiveRegion="polite" style={styles.success}>{applied.label}</Text>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="Quitar código de descuento" disabled={disabled}
        onPress={() => { sequence.current++; callbacks.current.onChange(null); setCode(''); setError(''); }} style={styles.button}>
        <Text style={styles.buttonText}>Quitar</Text>
      </TouchableOpacity>
    </View> : <View style={styles.row}>
      <TextInput accessibilityLabel="Código de descuento" value={code} editable={!disabled && !checking} maxLength={64}
        style={styles.input} placeholder="Introduce tu código" placeholderTextColor="#93899F" autoCapitalize="characters"
        autoCorrect={false} onChangeText={text => { setCode(text.toUpperCase()); setError(''); }}
        returnKeyType="done" onSubmitEditing={() => void apply()} />
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="Aplicar código de descuento"
        disabled={disabled || checking || !code.trim()} onPress={() => void apply()}
        style={[styles.button, (disabled || checking || !code.trim()) && styles.disabled]}>
        {checking ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.buttonText}>Aplicar</Text>}
      </TouchableOpacity>
    </View>}
    {!!error && <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.error}>{error}</Text>}
    <Text style={styles.hint}>Se aplica al producto seleccionado. La tasa de servicio se muestra por separado.</Text>
  </View>;
}
const styles = StyleSheet.create({
  container: { gap: 8, marginVertical: 14 }, label: { color: '#E8DFF2', fontWeight: '700', fontSize: 13 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  input: { flex: 1, minWidth: 0, borderRadius: 12, borderWidth: 1, borderColor: '#514262', padding: 12, color: '#FFFFFF', backgroundColor: '#1B1524' },
  button: { minWidth: 80, minHeight: 46, paddingHorizontal: 14, borderRadius: 12, backgroundColor: '#6D28D9', alignItems: 'center', justifyContent: 'center' },
  buttonText: { color: '#FFFFFF', fontWeight: '700' }, disabled: { opacity: 0.45 },
  success: { color: '#86EFAC', flex: 1, fontWeight: '700' }, error: { color: '#FCA5A5', fontSize: 12 },
  hint: { color: '#ADA0BD', fontSize: 11, lineHeight: 16 },
});
