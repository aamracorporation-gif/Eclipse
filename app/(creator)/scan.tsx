import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Animated, Easing, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, Vibration, useWindowDimensions } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Colors } from '@/constants/Colors';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/lib/supabase';
import { AlertTriangle, Check, ChevronDown, QrCode, Users, X } from '@/lib/icons';
import { useEvents } from '@/lib/EventContext';

type ValidationResult = {
  valid?: boolean;
  message?: string;
  event?: string;
  owner?: string;
  date?: string;
  ticket?: {
    event?: string;
    owner?: string;
    date?: string;
    scanned_at?: string;
  };
};

function alpha(hex: string, a: number) {
  const h = hex.replace('#', '');
  if (h.length !== 6) return `rgba(0,0,0,${a})`;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

function PrimaryButton(props: { label: string; onPress: () => void; disabled?: boolean; accessibilityHint?: string }) {
  return (
    <Pressable
      onPress={props.onPress}
      disabled={!!props.disabled}
      accessibilityRole="button"
      accessibilityLabel={props.label}
      accessibilityHint={props.accessibilityHint}
      style={({ pressed }) => [
        ui.button,
        ui.buttonPrimary,
        (pressed && !props.disabled) ? ui.buttonPressed : null,
        props.disabled ? ui.buttonDisabled : null,
      ]}
    >
      <Text style={ui.buttonText}>{props.label}</Text>
    </Pressable>
  );
}

function SecondaryButton(props: { label: string; onPress: () => void; disabled?: boolean; accessibilityHint?: string }) {
  return (
    <Pressable
      onPress={props.onPress}
      disabled={!!props.disabled}
      accessibilityRole="button"
      accessibilityLabel={props.label}
      accessibilityHint={props.accessibilityHint}
      style={({ pressed }) => [
        ui.button,
        ui.buttonSecondary,
        (pressed && !props.disabled) ? ui.buttonPressed : null,
        props.disabled ? ui.buttonDisabled : null,
      ]}
    >
      <Text style={ui.buttonText}>{props.label}</Text>
    </Pressable>
  );
}

function SectionCard(props: { title: string; subtitle?: string; children: any }) {
  return (
    <View style={ui.card} accessibilityRole="summary" accessibilityLabel={props.title}>
      <Text style={ui.cardTitle}>{props.title}</Text>
      {!!props.subtitle && <Text style={ui.cardSubtitle}>{props.subtitle}</Text>}
      <View style={{ marginTop: 12 }}>{props.children}</View>
    </View>
  );
}

function FieldLabel(props: { label: string; hint?: string }) {
  return (
    <View style={{ marginBottom: 8 }}>
      <Text style={ui.label}>{props.label}</Text>
      {!!props.hint && <Text style={ui.hint}>{props.hint}</Text>}
    </View>
  );
}

export default function ScanScreen() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const [permission, requestPermission] = useCameraPermissions();
  const { events, refreshEvents } = useEvents();

  const [view, setView] = useState<'home' | 'scanner'>('home');
  const [manualToken, setManualToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [result, setResult] = useState<ValidationResult | null>(null);
  const [banner, setBanner] = useState<{ tone: 'ok' | 'warn' | 'error'; text: string } | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [eventPickerOpen, setEventPickerOpen] = useState(false);

  const scannedRef = useRef(false);
  const pulse = useRef(new Animated.Value(0)).current;
  const manualAutoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const frameSize = useMemo(() => {
    const max = 312;
    const min = 220;
    const available = Math.max(0, windowWidth - 32);
    return Math.max(min, Math.min(max, available));
  }, [windowWidth]);
  const frameRadius = useMemo(() => Math.max(18, Math.round(frameSize * 0.085)), [frameSize]);

  const myEvents = useMemo(() => {
    const uid = user?.id;
    if (!uid) return [];
    const now = new Date();
    const graceMs = 6 * 60 * 60 * 1000;
    const cutoff = new Date(now.getTime() - graceMs);
    const filtered = (events || [])
      .filter((e: any) => String(e?.creatorId || '') === uid)
      .filter((e: any) => {
        const startsAt = e?.startsAt ? new Date(String(e.startsAt)) : new Date(`${String(e?.date || '')}T${String(e?.time || '00:00')}`);
        if (Number.isNaN(startsAt.getTime())) return false;
        return startsAt >= cutoff;
      });
    return [...filtered].sort((a: any, b: any) => String(a?.date || '').localeCompare(String(b?.date || '')));
  }, [events, user?.id]);

  const selectedEvent = useMemo(() => {
    if (!selectedEventId) return null;
    return myEvents.find((e: any) => e.id === selectedEventId) || null;
  }, [myEvents, selectedEventId]);

  useEffect(() => {
    if (view !== 'scanner') {
      scannedRef.current = false;
    }
  }, [view]);

  useEffect(() => {
    refreshEvents().catch(() => null);
  }, [refreshEvents]);

  useEffect(() => {
    if (selectedEventId) return;
    if (myEvents.length === 0) return;
    const today = new Date();
    const pad2 = (n: number) => String(n).padStart(2, '0');
    const todayKey = `${today.getFullYear()}-${pad2(today.getMonth() + 1)}-${pad2(today.getDate())}`;
    const todayEvent = myEvents.find((e: any) => String(e?.date || '') === todayKey);
    setSelectedEventId((todayEvent || myEvents[0]).id);
  }, [myEvents, selectedEventId]);

  useEffect(() => {
    if (view !== 'scanner') {
      pulse.stopAnimation();
      pulse.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 900, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 900, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, view]);

  useEffect(() => {
    if (view !== 'home') return;
    if (!selectedEventId) return;
    const raw = manualToken.trim();
    if (raw.length < 6) {
      if (manualAutoTimerRef.current) clearTimeout(manualAutoTimerRef.current);
      manualAutoTimerRef.current = null;
      return;
    }
    if (busy) return;
    if (manualAutoTimerRef.current) clearTimeout(manualAutoTimerRef.current);
    manualAutoTimerRef.current = setTimeout(() => {
      validateToken(raw).catch(() => null);
    }, 650);
    return () => {
      if (manualAutoTimerRef.current) clearTimeout(manualAutoTimerRef.current);
      manualAutoTimerRef.current = null;
    };
  }, [busy, manualToken, selectedEventId, view]);

  const playFeedback = async (ok: boolean) => {
    try {
      await Haptics.notificationAsync(ok ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Error);
    } catch {
      Vibration.vibrate(ok ? 80 : 250);
    }
  };

  const validateToken = async (raw: string) => {
    const token = raw.trim();
    if (!token.length) return;
    if (busy) return;
    if (!user?.id) {
      Alert.alert(t('common.error'), t('errors.session_expired'));
      return;
    }
    if (!selectedEventId) {
      setBanner({ tone: 'error', text: t('creator.scan.select_event_required', { defaultValue: 'Selecciona una fiesta antes de validar.' }) });
      return;
    }

    setBusy(true);
    setBanner(null);
    try {
      let data: any = null;
      let error: any = null;
      {
        const res = await supabase.rpc('validate_ticket_qr_v3', {
          p_qr_token: token,
          p_scanned_by_text: user.id,
          p_event_id: selectedEventId,
        });
        data = res.data as any;
        error = res.error as any;
      }
      if (error && (String(error.code || '') === '42883' || String(error.message || '').toLowerCase().includes('validate_ticket_qr_v3'))) {
        const res = await supabase.rpc('validate_ticket_qr_v2', { p_qr_token: token, p_scanned_by_text: user.id });
        data = res.data as any;
        error = res.error as any;
      }
      if (error) throw error;
      const vr = (data || {}) as ValidationResult;
      setResult(vr);
      setModalOpen(true);
      await playFeedback(!!vr.valid);
      setBanner({
        tone: vr.valid ? 'ok' : 'warn',
        text: vr.valid
          ? (t('creator.scan.valid_title', { defaultValue: 'Entrada válida' }))
          : (t('creator.scan.invalid_title', { defaultValue: 'Entrada no válida' })),
      });
    } catch (e: any) {
      setBanner({ tone: 'error', text: String(e?.message || t('common.error')) });
      Alert.alert(t('common.error'), t('creator.scan.validation_error', { detail: String(e?.message || '') }));
    } finally {
      setBusy(false);
    }
  };

  const openScanner = async () => {
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch {}

    if (!selectedEventId) {
      setBanner({ tone: 'error', text: t('creator.scan.select_event_required', { defaultValue: 'Selecciona una fiesta antes de escanear.' }) });
      return;
    }

    const granted = permission?.granted ? true : (await requestPermission())?.granted;
    if (!granted) {
      setBanner({
        tone: 'error',
        text: t('creator.scan.camera_permission_body', { defaultValue: 'Necesitamos permiso para usar la cámara.' }),
      });
      return;
    }
    setView('scanner');
  };

  const closeResult = () => {
    setModalOpen(false);
    setTimeout(() => {
      scannedRef.current = false;
    }, 250);
  };

  const onBarcodeScanned = async ({ data }: { type: string; data: string }) => {
    if (busy) return;
    if (scannedRef.current) return;
    scannedRef.current = true;
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch {}
    await validateToken(data);
  };

  const bannerStyle = banner?.tone === 'ok' ? ui.bannerOk : banner?.tone === 'warn' ? ui.bannerWarn : ui.bannerError;
  const emptyText = t('creator.scan.na', { defaultValue: 'Sin datos' });
  const pickText = (v: any) => {
    const s = String(v ?? '').trim();
    return s.length ? s : emptyText;
  };
  const eventText = pickText((result as any)?.ticket?.event ?? (result as any)?.event);
  const holderText = pickText((result as any)?.ticket?.owner ?? (result as any)?.owner);
  const dateText = (() => {
    const raw = String((result as any)?.ticket?.date ?? (result as any)?.date ?? '').trim();
    if (!raw.length) return emptyText;
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? raw : d.toLocaleDateString();
  })();

  return (
    <View style={ui.screen}>
      <LinearGradient
        colors={[Colors.dark.background, '#0b1026', '#050510']}
        style={StyleSheet.absoluteFill}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      />
      <View pointerEvents="none" style={ui.glowA} />
      <View pointerEvents="none" style={ui.glowB} />

      {view === 'scanner' && permission?.granted && (
        <CameraView
          style={StyleSheet.absoluteFillObject}
          facing="back"
          onBarcodeScanned={onBarcodeScanned}
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        />
      )}

      <View style={[ui.topBar, { paddingTop: insets.top + 14 }]}>
        {view === 'scanner' ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('common.cancel', { defaultValue: 'Cancelar' })}
            onPress={() => setView('home')}
            style={({ pressed }) => [ui.iconBtn, pressed ? ui.iconBtnPressed : null]}
            hitSlop={12}
          >
            <X size={22} color="white" />
          </Pressable>
        ) : (
          <View style={{ width: 44, height: 44 }} />
        )}
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text style={ui.screenTitle}>{t('creator.scan.title', { defaultValue: 'Acceso' })}</Text>
          <Pressable
            onPress={() => setEventPickerOpen(true)}
            accessibilityRole="button"
            accessibilityLabel={t('creator.scan.select_event', { defaultValue: 'Seleccionar fiesta' })}
            style={({ pressed }) => [ui.eventPill, pressed ? ui.eventPillPressed : null]}
          >
            <Text style={ui.eventPillText} numberOfLines={1}>
              {selectedEvent ? selectedEvent.title : t('creator.scan.select_event_placeholder', { defaultValue: 'Selecciona tu fiesta' })}
            </Text>
            <ChevronDown size={16} color="rgba(255,255,255,0.85)" />
          </Pressable>
        </View>
        <View style={{ width: 44, height: 44 }} />
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={[ui.content, { paddingBottom: insets.bottom + 18 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {banner && (
            <View style={[ui.banner, bannerStyle]} accessibilityRole="alert">
              <Text style={ui.bannerText}>{banner.text}</Text>
            </View>
          )}

          {view === 'scanner' ? (
            <View style={ui.scannerOverlay} pointerEvents="box-none">
              <View style={ui.scannerFrameWrap} pointerEvents="none">
                <Animated.View
                  style={[
                    ui.scannerFrameAnimated,
                    { width: frameSize + 26, height: frameSize + 26, borderRadius: frameRadius + 10 },
                    {
                      opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.25, 0.55] }),
                      transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.985, 1.015] }) }],
                    },
                  ]}
                />
                <View style={ui.scannerGuideRow}>
                  <QrCode size={18} color="white" />
                  <Text style={ui.scannerGuideText}>{t('creator.scan.aim_qr', { defaultValue: 'Apunta al QR dentro del marco' })}</Text>
                </View>
              </View>
            </View>
          ) : (
            <>
              <View style={ui.heroWrap}>
                <LinearGradient
                  colors={['rgba(124,58,237,0.32)', 'rgba(6,182,212,0.18)', 'rgba(255,255,255,0.04)']}
                  style={ui.heroCard}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                >
                  <View style={ui.heroRow}>
                    <View style={ui.heroIconRing}>
                      <LinearGradient colors={['rgba(124,58,237,0.95)', 'rgba(6,182,212,0.55)', 'rgba(255,255,255,0.10)']} style={ui.heroIconRingInner} />
                      <View style={ui.heroIcon}>
                        <QrCode size={20} color="white" />
                      </View>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={ui.heroTitle}>{t('creator.scan.title', { defaultValue: 'Acceso' })}</Text>
                      <Text style={ui.heroSubtitle}>{t('creator.scan.dashboard_subtitle', { defaultValue: 'Valida entradas con QR o mediante código manual.' })}</Text>
                    </View>
                  </View>
                </LinearGradient>
              </View>

              <SectionCard
                title={t('creator.scan.actions.validate', { defaultValue: 'Validar' })}
                subtitle={t('creator.scan.dashboard_subtitle', { defaultValue: 'Valida entradas con QR o mediante código manual.' })}
              >
                <View style={{ gap: 12 }}>
                  <PrimaryButton
                    label={t('creator.scan.dashboard_title', { defaultValue: 'Escanear con cámara' })}
                    onPress={openScanner}
                    disabled={busy}
                    accessibilityHint={t('creator.scan.camera_permission_title', { defaultValue: 'Abre la cámara y escanea un QR.' })}
                  />
                  <Text style={ui.helperText}>
                    {t('creator.scan.helper_camera', { defaultValue: 'Recomendado para accesos rápidos en puerta.' })}
                  </Text>

                  <View style={ui.divider} />

                  <FieldLabel
                    label={t('creator.scan.actions.validate', { defaultValue: 'Código (manual)' })}
                    hint={t('creator.scan.manual_hint', { defaultValue: 'Formato: texto del QR sin espacios. Útil si el QR está dañado o no enfoca.' })}
                  />
                  <TextInput
                    value={manualToken}
                    onChangeText={setManualToken}
                    placeholder={t('creator.scan.manual_placeholder', { defaultValue: 'Pega aquí el código del QR' })}
                    placeholderTextColor="rgba(255,255,255,0.45)"
                    style={ui.input}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="default"
                    accessibilityLabel={t('creator.scan.actions.validate', { defaultValue: 'Código (manual)' })}
                    accessibilityHint={t('creator.scan.manual_hint', { defaultValue: 'Introduce el texto del QR para validar la entrada.' })}
                    onSubmitEditing={() => validateToken(manualToken)}
                  />
                  <View style={{ flexDirection: 'row', gap: 12 }}>
                    <View style={{ flex: 1 }}>
                      <SecondaryButton
                        label={t('common.cancel', { defaultValue: 'Limpiar' })}
                        onPress={() => setManualToken('')}
                        disabled={busy || manualToken.length === 0}
                      />
                    </View>
                  </View>
                  <Text style={ui.helperText}>
                    {t('creator.scan.helper_manual', { defaultValue: 'Se validará automáticamente al pegar un código válido.' })}
                  </Text>
                </View>
              </SectionCard>

              <SectionCard
                title={t('creator.scan.actions.staff', { defaultValue: 'Staff' })}
                subtitle={t('creator.scan.staff_subtitle', { defaultValue: 'Invita y gestiona tu equipo para el control de accesos.' })}
              >
                <PrimaryButton
                  label={t('creator.workers.manage_title', { defaultValue: 'Gestionar staff' })}
                  onPress={() => router.push('/(creator)/workers')}
                  disabled={busy}
                />
              </SectionCard>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      <Modal transparent visible={modalOpen} animationType="fade" onRequestClose={closeResult}>
        <View style={ui.modalBackdrop}>
          <View style={ui.modalCard} accessibilityLabel={t('creator.scan.title', { defaultValue: 'Resultado de validación' })}>
            <View style={[ui.modalIcon, result?.valid ? ui.modalIconOk : ui.modalIconBad]}>
              {result?.valid ? <Check size={34} color="white" /> : <AlertTriangle size={34} color="white" />}
            </View>

            <Text style={ui.modalTitle}>
              {result?.valid ? t('creator.scan.valid_title', { defaultValue: 'Válida' }) : t('creator.scan.invalid_title', { defaultValue: 'No válida' })}
            </Text>
            <Text style={ui.modalBody}>{String(result?.message || t('creator.scan.not_recognized', { defaultValue: 'Código no reconocido.' }))}</Text>

            <View style={ui.detailBox} accessibilityRole="summary" accessibilityLabel={t('creator.scan.labels.event', { defaultValue: 'Detalles' })}>
              <View style={ui.detailRow}>
                <Text style={ui.detailLabel}>{t('creator.scan.labels.event', { defaultValue: 'Evento' })}</Text>
                <Text style={ui.detailValue} numberOfLines={1}>{eventText}</Text>
              </View>
              <View style={ui.detailRow}>
                <Text style={ui.detailLabel}>{t('creator.scan.labels.holder', { defaultValue: 'Titular' })}</Text>
                <Text style={ui.detailValue} numberOfLines={1}>{holderText}</Text>
              </View>
              <View style={ui.detailRow}>
                <Text style={ui.detailLabel}>{t('creator.scan.labels.date', { defaultValue: 'Fecha' })}</Text>
                <Text style={ui.detailValue} numberOfLines={1}>{dateText}</Text>
              </View>
            </View>

            <View style={{ marginTop: 14, flexDirection: 'row', gap: 12 }}>
              <View style={{ flex: 1 }}>
                <SecondaryButton label={t('common.cancel', { defaultValue: 'Cerrar' })} onPress={closeResult} />
              </View>
              <View style={{ flex: 1 }}>
                <PrimaryButton
                  label={t('creator.scan.next_scan', { defaultValue: 'Siguiente' })}
                  onPress={() => {
                    closeResult();
                    if (view === 'scanner') scannedRef.current = false;
                  }}
                />
              </View>
            </View>
          </View>
        </View>
      </Modal>

      <Modal transparent visible={eventPickerOpen} animationType="fade" onRequestClose={() => setEventPickerOpen(false)}>
        <Pressable style={ui.modalBackdrop} onPress={() => setEventPickerOpen(false)}>
          <Pressable style={ui.eventSheet} onPress={() => null}>
            <Text style={ui.eventSheetTitle}>{t('creator.scan.select_event', { defaultValue: 'Selecciona tu fiesta' })}</Text>
            {myEvents.length === 0 ? (
              <Text style={ui.eventSheetEmpty}>
                {t('creator.scan.no_events', { defaultValue: 'No tienes eventos disponibles. Crea una fiesta para empezar a validar.' })}
              </Text>
            ) : (
              <ScrollView contentContainerStyle={{ paddingBottom: 10 }} showsVerticalScrollIndicator={false}>
                {myEvents.map((e: any) => {
                  const active = e.id === selectedEventId;
                  return (
                    <Pressable
                      key={e.id}
                      onPress={() => {
                        setSelectedEventId(e.id);
                        setEventPickerOpen(false);
                      }}
                      style={({ pressed }) => [ui.eventRow, active ? ui.eventRowActive : null, pressed ? ui.eventRowPressed : null]}
                      accessibilityRole="button"
                      accessibilityLabel={e.title}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={ui.eventRowTitle} numberOfLines={1}>{e.title}</Text>
                        <Text style={ui.eventRowMeta} numberOfLines={1}>
                          {String(e.date || '')} · {String(e.location || '')}
                        </Text>
                      </View>
                      {active ? <Check size={18} color="#4ade80" /> : null}
                    </Pressable>
                  );
                })}
              </ScrollView>
            )}
          </Pressable>
        </Pressable>
      </Modal>

      {busy && (
        <View style={ui.busyOverlay} pointerEvents="none" accessibilityRole="progressbar">
          <View style={ui.busyPill}>
            <Text style={ui.busyText}>{t('creator.scan.validating', { defaultValue: 'Validando…' })}</Text>
          </View>
        </View>
      )}
    </View>
  );
}

const ui = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#000' },
  glowA: {
    position: 'absolute',
    top: -90,
    left: -60,
    width: 260,
    height: 260,
    borderRadius: 130,
    backgroundColor: '#8b5cf6',
    opacity: 0.14,
    transform: [{ scale: 1.4 }],
  },
  glowB: {
    position: 'absolute',
    bottom: -120,
    right: -80,
    width: 300,
    height: 300,
    borderRadius: 150,
    backgroundColor: '#06b6d4',
    opacity: 0.12,
    transform: [{ scale: 1.5 }],
  },
  topBar: {
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  iconBtn: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.35)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  iconBtnPressed: { transform: [{ scale: 0.98 }], backgroundColor: 'rgba(0,0,0,0.48)' },
  screenTitle: { color: 'white', fontSize: 18, fontWeight: '900' },
  screenSubtitle: { color: 'rgba(255,255,255,0.70)', fontSize: 12, fontWeight: '700', marginTop: 2 },
  eventPill: {
    marginTop: 8,
    maxWidth: '92%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    height: 34,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.35)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  eventPillPressed: { transform: [{ scale: 0.99 }], backgroundColor: 'rgba(0,0,0,0.48)' },
  eventPillText: { color: 'white', fontWeight: '900', maxWidth: '90%' },
  content: { paddingHorizontal: 16, paddingTop: 16, gap: 12 },
  banner: {
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
  },
  bannerOk: { backgroundColor: 'rgba(34,197,94,0.14)', borderColor: 'rgba(34,197,94,0.35)' },
  bannerWarn: { backgroundColor: 'rgba(245,158,11,0.14)', borderColor: 'rgba(245,158,11,0.35)' },
  bannerError: { backgroundColor: 'rgba(239,68,68,0.14)', borderColor: 'rgba(239,68,68,0.35)' },
  bannerText: { color: 'white', fontWeight: '800' },
  card: {
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    backgroundColor: 'rgba(0,0,0,0.22)',
  },
  cardTitle: { color: 'white', fontWeight: '900', fontSize: 16 },
  cardSubtitle: { color: 'rgba(255,255,255,0.70)', fontWeight: '700', marginTop: 6, lineHeight: 18 },
  helperText: { color: 'rgba(255,255,255,0.58)', fontWeight: '700', lineHeight: 18 },
  divider: { height: 1, backgroundColor: 'rgba(255,255,255,0.10)' },
  label: { color: 'rgba(255,255,255,0.92)', fontWeight: '900', fontSize: 13 },
  hint: { color: 'rgba(255,255,255,0.62)', fontWeight: '700', marginTop: 4, lineHeight: 16 },
  input: {
    height: 50,
    borderRadius: 14,
    paddingHorizontal: 12,
    color: 'white',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    fontWeight: '800',
  },
  button: {
    height: 52,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    alignSelf: 'stretch',
  },
  buttonPrimary: {
    backgroundColor: Colors.dark.primary,
    borderColor: alpha(Colors.dark.primary, 0.35),
  },
  buttonSecondary: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderColor: 'rgba(255,255,255,0.14)',
  },
  buttonPressed: { transform: [{ scale: 0.99 }] },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: Colors.dark.text, fontWeight: '900', fontSize: 14 },
  scannerOverlay: { flex: 1, justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 10 },
  scannerFrameWrap: { alignItems: 'center', marginTop: 30 },
  scannerFrameAnimated: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: alpha(Colors.dark.primary, 0.75),
    backgroundColor: alpha(Colors.dark.primary, 0.08),
  },
  scannerGuideRow: {
    marginTop: 14,
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  scannerGuideText: { color: 'white', fontWeight: '800' },
  heroWrap: { marginBottom: 2 },
  heroCard: {
    borderRadius: 20,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    overflow: 'hidden',
  },
  heroRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  heroIconRing: { width: 54, height: 54, borderRadius: 18, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  heroIconRingInner: { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 },
  heroIcon: {
    width: 44,
    height: 44,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.35)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
  },
  heroTitle: { color: 'white', fontWeight: '900', fontSize: 16 },
  heroSubtitle: { color: 'rgba(255,255,255,0.72)', fontWeight: '700', marginTop: 6, lineHeight: 18 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.78)', justifyContent: 'center', padding: 16 },
  modalCard: {
    borderRadius: 22,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    backgroundColor: '#0b1026',
  },
  modalIcon: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', alignSelf: 'center' },
  modalIconOk: { backgroundColor: '#22c55e' },
  modalIconBad: { backgroundColor: '#ef4444' },
  modalTitle: { color: 'white', fontWeight: '900', fontSize: 20, marginTop: 10, textAlign: 'center' },
  modalBody: { color: 'rgba(255,255,255,0.75)', fontWeight: '700', marginTop: 8, textAlign: 'center', lineHeight: 18 },
  detailBox: {
    marginTop: 14,
    borderRadius: 16,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 10, paddingVertical: 6 },
  detailLabel: { color: 'rgba(255,255,255,0.62)', fontWeight: '800' },
  detailValue: { color: 'white', fontWeight: '900', flex: 1, textAlign: 'right' },
  busyOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 30 },
  busyPill: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  busyText: { color: 'white', fontWeight: '900' },
  eventSheet: {
    borderRadius: 20,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    backgroundColor: '#0b1026',
    maxHeight: '70%',
  },
  eventSheetTitle: { color: 'white', fontWeight: '900', fontSize: 16, marginBottom: 10 },
  eventSheetEmpty: { color: 'rgba(255,255,255,0.70)', fontWeight: '700', lineHeight: 18 },
  eventRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    backgroundColor: 'rgba(255,255,255,0.04)',
    marginBottom: 10,
  },
  eventRowActive: { borderColor: 'rgba(74,222,128,0.35)', backgroundColor: 'rgba(74,222,128,0.08)' },
  eventRowPressed: { transform: [{ scale: 0.99 }] },
  eventRowTitle: { color: 'white', fontWeight: '900' },
  eventRowMeta: { color: 'rgba(255,255,255,0.62)', fontWeight: '700', marginTop: 4 },
});
