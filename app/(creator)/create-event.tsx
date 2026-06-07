import React, { useCallback, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Keyboard, Platform, Modal, Pressable, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { LinearGradient } from 'expo-linear-gradient';

import { Colors } from '@/constants/Colors';
import { GlassView } from '@/components/ui/GlassView';
import { ThemedInput } from '@/components/ui/ThemedInput';
import { ThemedButton } from '@/components/ui/ThemedButton';
import { ArrowLeft, Calendar, Clock, MapPin, Tag, DollarSign, Image as ImageIcon, Lock } from '@/lib/icons';
import { useAuth } from '@/lib/AuthContext';
import { useEvents } from '@/lib/EventContext';

type EventDraft = {
  title: string;
  description: string;
  location: string;
  imageUrl: string;
  venuePlanUrl: string;
  theme: string;
  dressCode: string;
  ageRestriction: string;
  eventType: string;
  allowResale: boolean;
  price: string;
  capacity: string;
  dateTime: Date | null;
};

function pad2(n: number) {
  return String(n).padStart(2, '0');
}

function toYMD(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function toHM(d: Date) {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function nextRoundedDateTime(now: Date) {
  const d = new Date(now);
  d.setSeconds(0, 0);
  const m = d.getMinutes();
  const rounded = Math.ceil(m / 5) * 5;
  d.setMinutes(rounded);
  if (rounded >= 60) d.setHours(d.getHours() + 1, 0, 0, 0);
  return d;
}

function isValidHttpUrl(url: string) {
  const raw = String(url || '').trim();
  if (!raw) return false;
  try {
    const u = new URL(raw);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function parsePositiveInt(text: string) {
  const raw = String(text || '').trim();
  if (!/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.trunc(n);
}

function parsePositiveNumber(text: string) {
  const raw = String(text || '').trim().replace(',', '.');
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

export default function CreateEventScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { addEvent } = useEvents();

  const nowRef = useRef(new Date());
  const minDateTime = useMemo(() => nextRoundedDateTime(new Date()), []);

  const [draft, setDraft] = useState<EventDraft>(() => ({
    title: '',
    description: '',
    location: '',
    imageUrl: '',
    venuePlanUrl: '',
    theme: '',
    dressCode: '',
    ageRestriction: '18',
    eventType: 'party',
    allowResale: true,
    price: '',
    capacity: '',
    dateTime: null,
  }));

  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [loading, setLoading] = useState(false);

  const [showIosDateTime, setShowIosDateTime] = useState(false);
  const [iosDateTimeDraft, setIosDateTimeDraft] = useState<Date>(() => nextRoundedDateTime(new Date()));
  const iosDateTimeDraftRef = useRef<Date>(iosDateTimeDraft);

  const eventTypeOptions = useMemo(
    () => [
      { key: 'party', label: 'Fiesta', Icon: Tag },
      { key: 'concert', label: 'Concierto', Icon: Lock },
      { key: 'festival', label: 'Festival', Icon: Tag },
      { key: 'private', label: 'Privado', Icon: Lock },
      { key: 'other', label: 'Otro', Icon: Tag },
    ],
    []
  );

  const openDateTimePicker = useCallback(() => {
    Keyboard.dismiss();
    const base = draft.dateTime && Number.isFinite(draft.dateTime.getTime()) ? new Date(draft.dateTime) : nextRoundedDateTime(new Date());
    const ensured = base.getTime() < minDateTime.getTime() ? new Date(minDateTime) : base;

    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        value: ensured,
        mode: 'date',
        onChange: (event, selected) => {
          if (event.type !== 'set') return;
          if (!selected || !Number.isFinite(selected.getTime())) return;
          const next = new Date(ensured);
          next.setFullYear(selected.getFullYear(), selected.getMonth(), selected.getDate());
          DateTimePickerAndroid.open({
            value: next,
            mode: 'time',
            is24Hour: true,
            onChange: (event2, selected2) => {
              if (event2.type !== 'set') return;
              if (!selected2 || !Number.isFinite(selected2.getTime())) return;
              next.setHours(selected2.getHours(), selected2.getMinutes(), 0, 0);
              setDraft((prev) => ({ ...prev, dateTime: new Date(next) }));
            },
          });
        },
        minimumDate: minDateTime,
      });
      return;
    }

    if (Platform.OS === 'ios') {
      const next = ensured;
      setIosDateTimeDraft(next);
      iosDateTimeDraftRef.current = next;
      setShowIosDateTime(true);
    }
  }, [draft.dateTime, minDateTime]);

  const onIosDateTimeChange = useCallback((event: any, selected?: Date) => {
    if (event?.type && event.type !== 'set') return;
    if (!selected || !Number.isFinite(selected.getTime())) return;
    const safe = new Date(selected);
    iosDateTimeDraftRef.current = safe;
    setIosDateTimeDraft(safe);
  }, []);

  const confirmIosDateTime = useCallback(() => {
    const picked = iosDateTimeDraftRef.current;
    if (!picked || !Number.isFinite(picked.getTime())) {
      setShowIosDateTime(false);
      return;
    }
    const next = picked.getTime() < minDateTime.getTime() ? new Date(minDateTime) : new Date(picked);
    setDraft((prev) => ({ ...prev, dateTime: next }));
    setShowIosDateTime(false);
  }, [minDateTime]);

  const cancelIosDateTime = useCallback(() => {
    setShowIosDateTime(false);
  }, []);

  const ui = useMemo(() => {
    const dateTimeText = draft.dateTime ? `${draft.dateTime.toLocaleDateString()} • ${toHM(draft.dateTime)}` : 'Seleccionar fecha y hora';
    const ymd = draft.dateTime ? toYMD(draft.dateTime) : '';
    const hm = draft.dateTime ? toHM(draft.dateTime) : '';
    return { dateTimeText, ymd, hm };
  }, [draft.dateTime]);

  const errors = useMemo(() => {
    const e: Record<string, string> = {};
    const title = draft.title.trim();
    const location = draft.location.trim();
    const description = draft.description.trim();

    if (!title) e.title = 'Obligatorio.';
    if (!description) e.description = 'Obligatorio.';
    if (!location) e.location = 'Obligatorio.';
    if (!isValidHttpUrl(draft.imageUrl)) e.imageUrl = 'URL inválida (http/https).';
    if (draft.venuePlanUrl.trim() && !isValidHttpUrl(draft.venuePlanUrl)) e.venuePlanUrl = 'URL inválida (http/https).';

    const cap = parsePositiveInt(draft.capacity);
    if (cap === null) e.capacity = 'Introduce un número entero > 0.';

    const price = parsePositiveNumber(draft.price);
    if (price === null) e.price = 'Introduce un número > 0.';

    const age = parsePositiveInt(draft.ageRestriction);
    if (age === null || age < 1 || age > 99) e.ageRestriction = 'Edad inválida (1–99).';

    if (!draft.dateTime || !Number.isFinite(draft.dateTime.getTime())) {
      e.dateTime = 'Selecciona fecha y hora.';
    } else if (draft.dateTime.getTime() < minDateTime.getTime()) {
      e.dateTime = 'Debe ser una fecha/hora futura.';
    }

    return e;
  }, [draft, minDateTime]);

  const getError = useCallback(
    (k: string) => {
      if (!submitAttempted) return undefined;
      return errors[k];
    },
    [errors, submitAttempted]
  );

  const safeBack = useCallback(() => {
    const canGoBack = (router as any)?.canGoBack?.();
    if (canGoBack) router.back();
    else router.replace('/(creator)');
  }, [router]);

  const submit = useCallback(async () => {
    setSubmitAttempted(true);
    if (Object.keys(errors).length > 0) {
      Alert.alert('Revisa el formulario', 'Hay campos inválidos o incompletos.');
      return;
    }
    if (!user?.id) {
      Alert.alert('Error', 'No se pudo identificar tu usuario.');
      return;
    }
    const dt = draft.dateTime as Date;
    const capacity = parsePositiveInt(draft.capacity) as number;
    const priceNumber = parsePositiveNumber(draft.price) as number;

    setLoading(true);
    try {
      await addEvent({
        title: draft.title.trim(),
        description: draft.description.trim(),
        location: draft.location.trim(),
        imageUrl: draft.imageUrl.trim(),
        venuePlanUrl: draft.venuePlanUrl.trim(),
        theme: draft.theme.trim(),
        dressCode: draft.dressCode.trim(),
        ageRestriction: String(parsePositiveInt(draft.ageRestriction) ?? 18),
        eventType: draft.eventType,
        allowResale: draft.allowResale,
        date: toYMD(dt),
        time: toHM(dt),
        price: String(priceNumber),
        capacity,
        ticketTypes: [],
        creatorId: user.id,
        venues: { latitude: 0, longitude: 0, name: draft.location.trim() },
      });
      setLoading(false);
      Alert.alert('Evento creado', 'Tu evento se ha creado correctamente.', [{ text: 'OK', onPress: safeBack }]);
    } catch (e: any) {
      setLoading(false);
      Alert.alert('Error', String(e?.message || e || 'No se pudo crear el evento'));
    }
  }, [addEvent, draft, errors, safeBack, user?.id]);

  return (
    <View style={styles.container}>
      <LinearGradient colors={[Colors.dark.background, '#1e1b4b']} style={StyleSheet.absoluteFill} />
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <TouchableOpacity onPress={safeBack} style={styles.backButton} activeOpacity={0.8}>
            <GlassView intensity={20} style={styles.backButtonContainer}>
              <ArrowLeft size={24} color={Colors.dark.text} />
            </GlassView>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Crear evento</Text>
          <View style={{ width: 44 }} />
        </View>

        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="always">
          <GlassView intensity={14} style={[styles.card, styles.cardBorder]}>
            <Text style={styles.sectionTitle}>Información básica</Text>
            <ThemedInput
              label="Nombre"
              placeholder="Nombre del evento"
              value={draft.title}
              onChangeText={(t) => setDraft((p) => ({ ...p, title: t }))}
              error={getError('title')}
              icon={<Tag size={20} color={Colors.dark.textSecondary} />}
            />
            <ThemedInput
              label="Descripción"
              placeholder="Describe el evento"
              value={draft.description}
              onChangeText={(t) => setDraft((p) => ({ ...p, description: t }))}
              error={getError('description')}
              multiline
              numberOfLines={4}
              containerStyle={{ height: 120 }}
            />
            <Text style={styles.label}>Tipo de evento</Text>
            <View style={styles.chipsRow}>
              {eventTypeOptions.map(({ key, label, Icon }) => {
                const selected = draft.eventType === key;
                return (
                  <Pressable
                    key={key}
                    onPress={() => setDraft((p) => ({ ...p, eventType: key }))}
                    style={[styles.chip, selected ? styles.chipActive : null]}
                  >
                    <Icon size={16} color={selected ? '#fff' : Colors.dark.textSecondary} />
                    <Text style={[styles.chipText, selected ? styles.chipTextActive : null]}>{label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </GlassView>

          <GlassView intensity={14} style={[styles.card, styles.cardBorder]}>
            <Text style={styles.sectionTitle}>Fecha y hora</Text>
            <Text style={styles.helper}>Selecciona la fecha y la hora desde el selector nativo.</Text>
            <TouchableOpacity onPress={openDateTimePicker} activeOpacity={0.85}>
              <View pointerEvents="none">
                <ThemedInput
                  label="Fecha y hora"
                  value={ui.dateTimeText}
                  editable={false}
                  error={getError('dateTime')}
                  icon={<Calendar size={20} color={Colors.dark.textSecondary} />}
                  rightIcon={<Clock size={18} color={Colors.dark.textSecondary} />}
                />
              </View>
            </TouchableOpacity>
            {Platform.OS === 'ios' ? (
              <Modal visible={showIosDateTime} transparent animationType="slide" onRequestClose={cancelIosDateTime}>
                <View style={styles.modalOverlay}>
                  <View style={styles.modalCard}>
                    <View style={styles.modalHeaderRow}>
                      <TouchableOpacity onPress={cancelIosDateTime}>
                        <Text style={styles.modalActionText}>Cancelar</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={confirmIosDateTime}>
                        <Text style={styles.modalActionText}>Confirmar</Text>
                      </TouchableOpacity>
                    </View>
                    <DateTimePicker
                      value={iosDateTimeDraft}
                      mode="datetime"
                      display="spinner"
                      onChange={onIosDateTimeChange}
                      minimumDate={minDateTime}
                      themeVariant="dark"
                      textColor={Colors.dark.text as any}
                    />
                  </View>
                </View>
              </Modal>
            ) : null}
          </GlassView>

          <GlassView intensity={14} style={[styles.card, styles.cardBorder]}>
            <Text style={styles.sectionTitle}>Ubicación</Text>
            <ThemedInput
              label="Ubicación"
              placeholder="Ej: Calle..., Ciudad..."
              value={draft.location}
              onChangeText={(t) => setDraft((p) => ({ ...p, location: t }))}
              error={getError('location')}
              icon={<MapPin size={20} color={Colors.dark.textSecondary} />}
            />
          </GlassView>

          <GlassView intensity={14} style={[styles.card, styles.cardBorder]}>
            <Text style={styles.sectionTitle}>Entradas</Text>
            <View style={styles.row}>
              <View style={styles.half}>
                <ThemedInput
                  label="Precio base (€)"
                  placeholder="Ej: 10,00"
                  value={draft.price}
                  onChangeText={(t) => setDraft((p) => ({ ...p, price: t }))}
                  error={getError('price')}
                  keyboardType="numeric"
                  icon={<DollarSign size={20} color={Colors.dark.textSecondary} />}
                />
              </View>
              <View style={styles.half}>
                <ThemedInput
                  label="Aforo"
                  placeholder="Ej: 300"
                  value={draft.capacity}
                  onChangeText={(t) => setDraft((p) => ({ ...p, capacity: t }))}
                  error={getError('capacity')}
                  keyboardType="numeric"
                />
              </View>
            </View>
          </GlassView>

          <GlassView intensity={14} style={[styles.card, styles.cardBorder]}>
            <Text style={styles.sectionTitle}>Imágenes</Text>
            <ThemedInput
              label="Cartel (URL)"
              placeholder="https://..."
              value={draft.imageUrl}
              onChangeText={(t) => setDraft((p) => ({ ...p, imageUrl: t }))}
              error={getError('imageUrl')}
              autoCapitalize="none"
              autoCorrect={false}
              icon={<ImageIcon size={20} color={Colors.dark.textSecondary} />}
            />
            <ThemedInput
              label="Plano (URL, opcional)"
              placeholder="https://..."
              value={draft.venuePlanUrl}
              onChangeText={(t) => setDraft((p) => ({ ...p, venuePlanUrl: t }))}
              error={getError('venuePlanUrl')}
              autoCapitalize="none"
              autoCorrect={false}
              icon={<ImageIcon size={20} color={Colors.dark.textSecondary} />}
            />
          </GlassView>

          <GlassView intensity={14} style={[styles.card, styles.cardBorder]}>
            <Text style={styles.sectionTitle}>Detalles</Text>
            <ThemedInput
              label="Música / Tema"
              placeholder="Ej: Techno"
              value={draft.theme}
              onChangeText={(t) => setDraft((p) => ({ ...p, theme: t }))}
              icon={<Tag size={20} color={Colors.dark.textSecondary} />}
            />
            <ThemedInput
              label="Dress code"
              placeholder="Ej: Casual"
              value={draft.dressCode}
              onChangeText={(t) => setDraft((p) => ({ ...p, dressCode: t }))}
              icon={<Tag size={20} color={Colors.dark.textSecondary} />}
            />
            <ThemedInput
              label="Edad mínima"
              placeholder="18"
              value={draft.ageRestriction}
              onChangeText={(t) => setDraft((p) => ({ ...p, ageRestriction: t }))}
              error={getError('ageRestriction')}
              keyboardType="numeric"
              icon={<Lock size={20} color={Colors.dark.textSecondary} />}
            />

            <View style={styles.switchRow}>
              <Text style={styles.switchLabel}>Permitir reventa</Text>
              <Pressable onPress={() => setDraft((p) => ({ ...p, allowResale: !p.allowResale }))} style={[styles.switchPill, draft.allowResale ? styles.switchPillOn : null]}>
                <Text style={styles.switchPillText}>{draft.allowResale ? 'Sí' : 'No'}</Text>
              </Pressable>
            </View>
          </GlassView>

          <View style={{ marginTop: 10 }}>
            <ThemedButton title="Publicar evento" onPress={submit} loading={loading} />
          </View>
          <View style={{ height: 30 }} />
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.dark.background },
  safeArea: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', padding: 24, paddingBottom: 12 },
  backButton: { marginRight: 16 },
  backButtonContainer: { padding: 8, borderRadius: 12, backgroundColor: 'rgba(255, 255, 255, 0.1)', borderWidth: 0 },
  headerTitle: { fontSize: 22, color: Colors.dark.text, fontWeight: '800' },
  content: { padding: 24, paddingBottom: 60 },
  card: { padding: 18, borderRadius: 18, marginBottom: 16 },
  cardBorder: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)', backgroundColor: 'rgba(255,255,255,0.03)' },
  sectionTitle: { fontSize: 16, color: Colors.dark.text, fontWeight: '900', marginBottom: 12 },
  label: { color: Colors.dark.textSecondary, fontSize: 13, marginBottom: 10 },
  helper: { color: Colors.dark.textSecondary, fontSize: 12, marginBottom: 12, opacity: 0.8 },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  chipActive: { borderColor: 'rgba(124,58,237,0.55)', backgroundColor: 'rgba(124,58,237,0.28)' },
  chipText: { color: Colors.dark.textSecondary, fontSize: 13, fontWeight: '700' },
  chipTextActive: { color: '#fff' },
  row: { flexDirection: 'row', gap: 12 },
  half: { flex: 1 },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 },
  switchLabel: { color: Colors.dark.text, fontSize: 14, fontWeight: '800' },
  switchPill: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  switchPillOn: { borderColor: 'rgba(34,197,94,0.55)', backgroundColor: 'rgba(34,197,94,0.18)' },
  switchPillText: { color: Colors.dark.text, fontSize: 13, fontWeight: '900' },
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.55)' },
  modalCard: { backgroundColor: '#1e1b4b', borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingBottom: 26, borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)' },
  modalHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14 },
  modalActionText: { color: Colors.dark.primary, fontSize: 16, fontWeight: '900' },
});

