import React, { useState } from 'react';
import { Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { Calendar } from '@/lib/icons';
import { Colors } from '@/constants/Colors';
import { theme } from '@/theme/styles';
import { ThemedButton } from './ThemedButton';

/** All date fields display and edit the device's local date/time, storing ISO instants. */
export function FormDateTimeField({ label, value, onChange, hint, error, base, minimumDate, optional = false }: {
  label: string; value?: string; onChange: (value: string) => void;
  hint?: string; error?: string; base?: Date | null; minimumDate?: Date; optional?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(new Date());
  const valid = value && Number.isFinite(Date.parse(value)) ? new Date(value) : null;
  const localValue = (date: Date) => new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  const changeWebDate = (event: any) => {
    const raw = event.currentTarget.value;
    const date = new Date(raw);
    if (!raw) onChange('');
    else if (Number.isFinite(date.getTime())) onChange(date.toISOString());
  };
  const choose = () => {
    const initial = valid || base || new Date();
    setDraft(initial);
    if (Platform.OS !== 'android') { setOpen(true); return; }
    DateTimePickerAndroid.open({ value: initial, mode: 'date', minimumDate, onChange: (event, date) => {
      if (event.type !== 'set' || !date) return;
      const next = new Date(date);
      next.setHours(initial.getHours(), initial.getMinutes(), 0, 0);
      DateTimePickerAndroid.open({ value: next, mode: 'time', is24Hour: true, onChange: (timeEvent, time) => {
        if (timeEvent.type !== 'set' || !time) return;
        next.setHours(time.getHours(), time.getMinutes(), 0, 0);
        onChange(next.toISOString());
      } });
    } });
  };
  return <View style={s.wrapper}>
    <Text style={s.label}>{label}</Text>
    {Platform.OS === 'web' ? React.createElement('input', {
      type: 'datetime-local', 'aria-label': label, 'aria-invalid': !!error,
      value: valid ? localValue(valid) : '', min: minimumDate ? localValue(minimumDate) : undefined,
      onChange: changeWebDate, onInput: changeWebDate,
      style: { width: '100%', minWidth: 0, boxSizing: 'border-box', minHeight: 60, padding: 16, borderRadius: theme.components.input.borderRadius, border: `1px solid ${error ? Colors.dark.error : Colors.dark.border}`, background: Colors.dark.surfaceSubtle, color: Colors.dark.text, font: 'inherit', colorScheme: 'dark' },
    }) : <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${valid ? valid.toLocaleString('es-ES') : 'Sin seleccionar'}`} onPress={choose} style={[s.input, !!error && { borderColor: Colors.dark.error }]}>
      <Calendar size={20} color={Colors.dark.textSecondary}/><Text style={s.value}>{valid ? valid.toLocaleString('es-ES', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Seleccionar fecha y hora'}</Text>
    </Pressable>}
    {!!hint && <Text style={s.hint}>{hint}</Text>}
    {!!error && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}
    {optional && !!value && <Pressable accessibilityRole="button" accessibilityLabel={`Quitar ${label.toLowerCase()}`} onPress={() => onChange('')} style={s.clear}><Text style={s.link}>Quitar horario</Text></Pressable>}
    {Platform.OS === 'ios' && <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}><View style={s.overlay}><View style={s.modal}>
      <Text style={s.label}>{label}</Text><DateTimePicker value={draft} mode="datetime" display="spinner" themeVariant="dark" minimumDate={minimumDate} onChange={(_, date) => date && setDraft(date)}/>
      <ThemedButton title="Confirmar horario" onPress={() => { onChange(draft.toISOString()); setOpen(false); }}/>
      <ThemedButton title="Cancelar" variant="outline" onPress={() => setOpen(false)}/>
    </View></View></Modal>}
  </View>;
}
const s = StyleSheet.create({
  wrapper: { marginBottom: 16, width: '100%' }, label: { color: Colors.dark.text, fontSize: 16, fontWeight: '600', marginBottom: 12 },
  input: { minHeight: 60, borderRadius: 18, borderWidth: 1, borderColor: Colors.dark.border, backgroundColor: Colors.dark.surfaceSubtle, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 12 },
  value: { color: Colors.dark.text, fontSize: 15, flex: 1 }, hint: { color: Colors.dark.textSecondary, fontSize: 12, lineHeight: 18, marginTop: 8 },
  error: { color: Colors.dark.error, fontSize: 14, marginTop: 8 }, clear: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' }, link: { color: Colors.dark.secondary, fontSize: 13 },
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: Colors.dark.overlay }, modal: { backgroundColor: Colors.dark.backgroundElevated, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 24, gap: 12 },
});
