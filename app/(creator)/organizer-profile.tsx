import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, KeyboardAvoidingView, Modal, Platform, Pressable, RefreshControl, ScrollView, StatusBar, StyleSheet, Switch, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Colors } from '@/constants/Colors';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/lib/supabase';
import { useI18n } from '@/lib/I18nContext';
import { invokeEdgeFunction } from '@/lib/edgeFunctions';
import { ShieldCheck, User, Pencil, ChevronRight, X, Lock, SlidersHorizontal } from '@/lib/icons';
import { isSafeAddressText, isSafeOrgText, isValidIbanES, isValidPersonName, normalizeWhitespace, normalizeWhitespaceForInput } from '@/lib/validators';

type ProfileData = {
  role: 'organizer' | 'attendee' | 'admin' | null;
  verification_status: 'pending_verification' | 'verified' | 'rejected' | 'needs_correction' | null;
  full_name: string | null;
  phone: string | null;
  city: string | null;
  country: string | null;
  gender: string | null;
  age: number | null;
  club_name: string | null;
  business_email: string | null;
  instagram_account: string | null;
  organizer_venue_address: string | null;
  organizer_fiscal_address: string | null;
  organizer_postal_code: string | null;
  organizer_responsible_name: string | null;
  organizer_responsible_birthdate: string | null;
  organizer_iban: string | null;
  is_suspended?: boolean | null;
  suspended_reason?: string | null;
};

function alpha(hex: string, a: number) {
  const h = hex.replace('#', '');
  if (h.length !== 6) return `rgba(0,0,0,${a})`;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

function TitleRow(props: { title: string; subtitle?: string; right?: any }) {
  return (
    <View style={ui.titleRow}>
      <View style={{ flex: 1 }}>
        <Text style={ui.h1}>{props.title}</Text>
        {!!props.subtitle && <Text style={ui.h2}>{props.subtitle}</Text>}
      </View>
      {props.right}
    </View>
  );
}

function Badge(props: { tone: 'ok' | 'warn' | 'error' | 'neutral'; label: string }) {
  const style = props.tone === 'ok' ? ui.badgeOk : props.tone === 'warn' ? ui.badgeWarn : props.tone === 'error' ? ui.badgeError : ui.badgeNeutral;
  const textStyle = props.tone === 'ok' ? ui.badgeOkText : props.tone === 'warn' ? ui.badgeWarnText : props.tone === 'error' ? ui.badgeErrorText : ui.badgeNeutralText;
  return (
    <View style={[ui.badge, style]} accessibilityRole="text">
      <Text style={[ui.badgeText, textStyle]}>{props.label}</Text>
    </View>
  );
}

function Card(props: { title: string; subtitle?: string; icon?: any; actionLabel?: string; onActionPress?: () => void; children?: any }) {
  return (
    <View style={ui.card} accessibilityRole="summary" accessibilityLabel={props.title}>
      <View style={ui.cardHeader}>
        <View style={ui.cardHeaderLeft}>
          {props.icon ? <View style={ui.iconCircle}>{props.icon}</View> : null}
          <View style={{ flex: 1 }}>
            <Text style={ui.cardTitle}>{props.title}</Text>
            {!!props.subtitle && <Text style={ui.cardSubtitle}>{props.subtitle}</Text>}
          </View>
        </View>
        {!!props.actionLabel && !!props.onActionPress && (
          <Pressable
            onPress={props.onActionPress}
            accessibilityRole="button"
            accessibilityLabel={props.actionLabel}
            style={({ pressed }) => [ui.chevronBtn, pressed ? ui.chevronBtnPressed : null]}
            hitSlop={10}
          >
            <ChevronRight size={18} color="rgba(255,255,255,0.75)" />
          </Pressable>
        )}
      </View>
      {!!props.children && <View style={{ marginTop: 12 }}>{props.children}</View>}
    </View>
  );
}

function KeyValue(props: { label: string; value: string }) {
  return (
    <View style={ui.kvRow}>
      <Text style={ui.kvLabel}>{props.label}</Text>
      <Text style={ui.kvValue} numberOfLines={1} adjustsFontSizeToFit>{props.value}</Text>
    </View>
  );
}

function PrimaryButton(props: { label: string; onPress: () => void; disabled?: boolean; tone?: 'primary' | 'danger' }) {
  const isDanger = props.tone === 'danger';
  return (
    <Pressable
      onPress={props.onPress}
      disabled={!!props.disabled}
      accessibilityRole="button"
      accessibilityLabel={props.label}
      style={({ pressed }) => [
        ui.button,
        isDanger ? ui.buttonDanger : ui.buttonPrimary,
        pressed && !props.disabled ? ui.buttonPressed : null,
        props.disabled ? ui.buttonDisabled : null,
      ]}
    >
      <Text style={ui.buttonText}>{props.label}</Text>
    </Pressable>
  );
}

function SecondaryButton(props: { label: string; onPress: () => void; disabled?: boolean; selected?: boolean }) {
  return (
    <Pressable
      onPress={props.onPress}
      disabled={!!props.disabled}
      accessibilityRole="button"
      accessibilityLabel={props.label}
      style={({ pressed }) => [
        ui.button,
        ui.buttonSecondary,
        props.selected ? ui.buttonSelected : null,
        pressed && !props.disabled ? ui.buttonPressed : null,
        props.disabled ? ui.buttonDisabled : null,
      ]}
    >
      <Text style={[ui.buttonText, props.selected ? ui.buttonTextSelected : null]}>{props.label}</Text>
    </Pressable>
  );
}

function InputField(props: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  keyboardType?: 'default' | 'email-address' | 'number-pad';
  autoCapitalize?: 'none' | 'sentences' | 'words';
  secureTextEntry?: boolean;
  error?: string | null;
}) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={ui.label}>{props.label}</Text>
      {!!props.hint && <Text style={ui.hint}>{props.hint}</Text>}
      <TextInput
        value={props.value}
        onChangeText={props.onChange}
        placeholder={props.placeholder}
        placeholderTextColor="rgba(255,255,255,0.45)"
        style={[ui.input, props.error ? ui.inputError : null]}
        autoCapitalize={props.autoCapitalize ?? 'sentences'}
        autoCorrect={false}
        keyboardType={props.keyboardType ?? 'default'}
        secureTextEntry={props.secureTextEntry}
        accessibilityLabel={props.label}
        accessibilityHint={props.hint}
      />
      {!!props.error && <Text style={ui.errorText} accessibilityRole="alert">{props.error}</Text>}
    </View>
  );
}

const EMPTY_DRAFT = {
  full_name: '',
  phone: '',
  city: '',
  country: '',
  gender: '',
  age: '',
  club_name: '',
  business_email: '',
  instagram_account: '',
  organizer_venue_address: '',
  organizer_fiscal_address: '',
  organizer_postal_code: '',
  organizer_responsible_name: '',
  organizer_responsible_birthdate: '',
  organizer_iban: '',
};

export default function OrganizerProfileTab() {
  const { user, signOut } = useAuth();
  const { t } = useTranslation();
  const { language, setLanguage, setDeviceLanguage } = useI18n();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [banner, setBanner] = useState<{ tone: 'ok' | 'warn' | 'error'; text: string } | null>(null);

  const [editOpen, setEditOpen] = useState(false);
  const [draft, setDraft] = useState({ ...EMPTY_DRAFT });
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [autoSave, setAutoSave] = useState(false);
  const [locationChecking, setLocationChecking] = useState(false);
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialKeyRef = useRef('');

  const email = user?.email || '';
  const displayName = useMemo(() => {
    const full = String(profile?.full_name || '').trim();
    const candidate = full.length ? full : '';
    if (candidate.length) return candidate;
    const prefix = email.split('@')[0] || '';
    return prefix.length ? prefix : (t('tabs.profile', { defaultValue: 'Mi perfil' }));
  }, [email, profile?.full_name, t]);
  const initials = useMemo(() => {
    const base = (displayName || email || '').trim();
    const parts = base.split(/\s+/).filter(Boolean);
    const a = parts[0]?.[0] || '?';
    const b = parts.length > 1 ? (parts[1]?.[0] || '') : '';
    return (a + b).toUpperCase();
  }, [displayName, email]);

  const profileKey = (d: typeof draft) =>
    [
      d.full_name,
      d.phone,
      d.city,
      d.country,
      d.gender,
      d.age,
      d.club_name,
      d.business_email,
      d.instagram_account,
      d.organizer_venue_address,
      d.organizer_fiscal_address,
      d.organizer_postal_code,
      d.organizer_responsible_name,
      d.organizer_responsible_birthdate,
      d.organizer_iban,
    ]
      .map((x) => String(x || '').trim())
      .join('|');

  const fetchProfile = useCallback(async () => {
    if (!user?.id) return;
    setBanner(null);
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select(
          'role, verification_status, full_name, phone, city, country, gender, age, club_name, business_email, instagram_account, organizer_venue_address, organizer_fiscal_address, organizer_postal_code, organizer_responsible_name, organizer_responsible_birthdate, organizer_iban, is_suspended, suspended_reason'
        )
        .eq('id', user.id)
        .maybeSingle();
      if (error) throw error;
      setProfile((data as any) ?? null);
    } catch (e: any) {
      setBanner({ tone: 'error', text: String(e?.message || t('common.error')) });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [t, user?.id]);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  const openEdit = useCallback(async () => {
    if (!user?.id) return;
    setBanner(null);
    setTouched({});
    setLocationChecking(false);
    setSaving(false);
    setAutoSave(false);
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select(
          'full_name, phone, city, country, gender, age, club_name, business_email, instagram_account, organizer_venue_address, organizer_fiscal_address, organizer_postal_code, organizer_responsible_name, organizer_responsible_birthdate, organizer_iban'
        )
        .eq('id', user.id)
        .maybeSingle();
      if (error) throw error;
      const next = {
        full_name: String((data as any)?.full_name ?? user.user_metadata?.full_name ?? ''),
        phone: String((data as any)?.phone ?? ''),
        city: String((data as any)?.city ?? ''),
        country: String((data as any)?.country ?? ''),
        gender: String((data as any)?.gender ?? ''),
        age: (data as any)?.age != null ? String((data as any)?.age) : '',
        club_name: String((data as any)?.club_name ?? ''),
        business_email: String((data as any)?.business_email ?? ''),
        instagram_account: String((data as any)?.instagram_account ?? ''),
        organizer_venue_address: String((data as any)?.organizer_venue_address ?? ''),
        organizer_fiscal_address: String((data as any)?.organizer_fiscal_address ?? ''),
        organizer_postal_code: String((data as any)?.organizer_postal_code ?? ''),
        organizer_responsible_name: String((data as any)?.organizer_responsible_name ?? ''),
        organizer_responsible_birthdate: String((data as any)?.organizer_responsible_birthdate ?? ''),
        organizer_iban: String((data as any)?.organizer_iban ?? ''),
      };
      setDraft(next);
      initialKeyRef.current = profileKey(next);
      setEditOpen(true);
    } catch (e: any) {
      Alert.alert(t('common.error'), String(e?.message || t('common.error')));
    }
  }, [t, user?.id, user?.user_metadata?.full_name]);

  const errors = useMemo(() => {
    const e: Record<string, string> = {};
    const reqName = normalizeWhitespace(draft.full_name);
    if (!reqName.length || !isValidPersonName(reqName)) e.full_name = t('profile.edit.errors.full_name_invalid', { defaultValue: 'Nombre no válido.' });
    const city = normalizeWhitespace(draft.city);
    const country = normalizeWhitespace(draft.country);
    if (city.length && !isSafeOrgText(city)) e.city = t('profile.edit.errors.city_invalid', { defaultValue: 'Ciudad no válida.' });
    if (country.length && !isSafeOrgText(country)) e.country = t('profile.edit.errors.country_invalid', { defaultValue: 'País no válido.' });
    const club = normalizeWhitespace(draft.club_name);
    if (club.length && !isSafeOrgText(club)) e.club_name = t('profile.edit.errors.club_invalid', { defaultValue: 'Nombre del club no válido.' });
    const emailBiz = String(draft.business_email || '').trim();
    if (emailBiz.length && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailBiz)) e.business_email = t('profile.edit.errors.email_invalid', { defaultValue: 'Email no válido.' });
    const ig = normalizeWhitespace(draft.instagram_account);
    if (ig.length && !/^[a-zA-Z0-9._]{1,30}$/.test(ig)) e.instagram_account = t('profile.edit.errors.instagram_invalid', { defaultValue: 'Instagram no válido.' });
    const venue = normalizeWhitespace(draft.organizer_venue_address);
    if (venue.length && !isSafeAddressText(venue)) e.organizer_venue_address = t('profile.edit.errors.address_invalid', { defaultValue: 'Dirección no válida.' });
    const fiscal = normalizeWhitespace(draft.organizer_fiscal_address);
    if (fiscal.length && !isSafeAddressText(fiscal)) e.organizer_fiscal_address = t('profile.edit.errors.address_invalid', { defaultValue: 'Dirección no válida.' });
    const postal = String(draft.organizer_postal_code || '').trim();
    if (postal.length && !/^[0-9A-Za-z\- ]{3,12}$/.test(postal)) e.organizer_postal_code = t('profile.edit.errors.postal_invalid', { defaultValue: 'Código postal no válido.' });
    const resp = normalizeWhitespace(draft.organizer_responsible_name);
    if (resp.length && !isValidPersonName(resp)) e.organizer_responsible_name = t('profile.edit.errors.responsible_invalid', { defaultValue: 'Responsable no válido.' });
    const birth = String(draft.organizer_responsible_birthdate || '').trim();
    if (birth.length && !/^\d{4}-\d{2}-\d{2}$/.test(birth)) e.organizer_responsible_birthdate = t('profile.edit.errors.birthdate_invalid', { defaultValue: 'Fecha no válida (YYYY-MM-DD).' });
    const iban = String(draft.organizer_iban || '').trim();
    if (iban.length && !isValidIbanES(iban)) e.organizer_iban = t('profile.edit.errors.iban_invalid', { defaultValue: 'IBAN no válido.' });
    const age = String(draft.age || '').trim();
    if (age.length && (!/^\d{1,3}$/.test(age) || Number(age) < 0 || Number(age) > 120)) e.age = t('profile.edit.errors.age_invalid', { defaultValue: 'Edad no válida.' });
    return e;
  }, [draft, t]);

  const hasErrors = useMemo(() => Object.keys(errors).length > 0, [errors]);
  const dirty = useMemo(() => profileKey(draft) !== initialKeyRef.current, [draft]);
  const editModalHeight = useMemo(() => {
    const available = Math.max(0, windowHeight - 32);
    return Math.max(520, Math.min(860, available));
  }, [windowHeight]);

  const validateCityCountry = useCallback(async () => {
    const city = normalizeWhitespace(draft.city);
    const country = normalizeWhitespace(draft.country);
    if (!city.length && !country.length) return true;
    if (!city.length || !country.length) return false;
    setLocationChecking(true);
    try {
      const query = `${city}, ${country}`;
      const res = await Location.geocodeAsync(query);
      return Array.isArray(res) && res.length > 0;
    } catch {
      return false;
    } finally {
      setLocationChecking(false);
    }
  }, [draft.city, draft.country]);

  const save = useCallback(async () => {
    if (!user?.id) return;
    if (saving) return;
    if (hasErrors) {
      Alert.alert(t('common.error'), t('profile.edit.fix_errors', { defaultValue: 'Corrige los errores antes de guardar.' }));
      return;
    }
    const okLocation = await validateCityCountry();
    if (!okLocation) {
      Alert.alert(t('common.error'), t('profile.edit.errors.location_not_found', { defaultValue: 'No se encontró la ciudad/país. Revisa que sea correcto.' }));
      return;
    }

    setSaving(true);
    try {
      const normalizeOrNull = (v: string) => {
        const s = normalizeWhitespace(v);
        return s.length ? s : null;
      };
      const trimOrNull = (v: string) => {
        const s = String(v || '').trim();
        return s.length ? s : null;
      };
      const toIntOrNull = (v: string) => {
        const s = String(v || '').trim();
        if (!s.length) return null;
        const n = Number(s);
        return Number.isFinite(n) ? n : null;
      };

      const payload: any = {
        full_name: normalizeOrNull(draft.full_name),
        phone: trimOrNull(draft.phone),
        city: normalizeOrNull(draft.city),
        country: normalizeOrNull(draft.country),
        gender: trimOrNull(draft.gender),
        age: toIntOrNull(draft.age),
        club_name: normalizeOrNull(draft.club_name),
        business_email: trimOrNull(draft.business_email),
        instagram_account: trimOrNull(draft.instagram_account),
        organizer_venue_address: normalizeOrNull(draft.organizer_venue_address),
        organizer_fiscal_address: normalizeOrNull(draft.organizer_fiscal_address),
        organizer_postal_code: trimOrNull(draft.organizer_postal_code),
        organizer_responsible_name: normalizeOrNull(draft.organizer_responsible_name),
        organizer_responsible_birthdate: trimOrNull(draft.organizer_responsible_birthdate),
        organizer_iban: trimOrNull(draft.organizer_iban),
      };

      const { error } = await supabase.from('profiles').update(payload).eq('id', user.id);
      if (error) throw error;
      if (payload.full_name) {
        try {
          await supabase.auth.updateUser({ data: { full_name: payload.full_name } });
        } catch {}
      }
      initialKeyRef.current = profileKey(draft);
      setBanner({ tone: 'ok', text: t('profile.edit.saved', { defaultValue: 'Perfil guardado.' }) });
      fetchProfile();
      try {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } catch {}
    } catch (e: any) {
      setBanner({ tone: 'error', text: String(e?.message || t('common.error')) });
      Alert.alert(t('common.error'), String(e?.message || t('common.error')));
    } finally {
      setSaving(false);
    }
  }, [draft, fetchProfile, hasErrors, saving, t, user?.id, validateCityCountry]);

  useEffect(() => {
    if (!editOpen) return;
    if (!autoSave) return;
    if (!dirty) return;
    if (saving) return;
    if (hasErrors) return;
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(() => {
      save().catch(() => null);
    }, 1200);
    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    };
  }, [autoSave, dirty, editOpen, hasErrors, save, saving]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setLoading(true);
    fetchProfile();
  }, [fetchProfile]);

  const verificationTone = profile?.verification_status === 'verified' ? 'ok' : profile?.verification_status === 'rejected' ? 'error' : profile?.verification_status ? 'warn' : 'neutral';
  const verificationLabel =
    profile?.verification_status === 'verified'
      ? t('profile.organizer.verification.status.verified', { defaultValue: 'Verificado' })
      : profile?.verification_status === 'needs_correction'
        ? t('profile.organizer.verification.status.needs_correction', { defaultValue: 'Corrección requerida' })
        : profile?.verification_status === 'rejected'
          ? t('profile.organizer.verification.status.rejected', { defaultValue: 'Verificación rechazada' })
          : profile?.verification_status === 'pending_verification'
            ? t('profile.organizer.verification.status.pending', { defaultValue: 'Verificación pendiente' })
            : t('profile.not_specified', { defaultValue: 'No indicado' });

  const bannerStyle = banner?.tone === 'ok' ? ui.bannerOk : banner?.tone === 'warn' ? ui.bannerWarn : ui.bannerError;

  const safeValue = (v: any) => {
    const s = String(v ?? '').trim();
    return s.length ? s : t('profile.not_specified', { defaultValue: 'No especificado' });
  };

  const doSignOut = useCallback(() => {
    Alert.alert(
      t('profile.logout', { defaultValue: 'Cerrar sesión' }),
      t('profile.logout_confirm', { defaultValue: '¿Estás seguro que deseas cerrar sesión?' }),
      [
        { text: t('common.cancel', { defaultValue: 'Cancelar' }), style: 'cancel' },
        {
          text: t('profile.logout', { defaultValue: 'Cerrar sesión' }),
          style: 'destructive',
          onPress: async () => {
            try {
              await signOut();
            } finally {
              router.replace('/(auth)/login');
            }
          },
        },
      ]
    );
  }, [signOut, t]);

  const doDeleteAccount = useCallback(() => {
    Alert.alert(
      t('profile.delete_account_title', { defaultValue: 'Eliminar cuenta' }),
      t('profile.delete_account_body', { defaultValue: 'Esto eliminará tu cuenta y tus datos. Esta acción no se puede deshacer.' }),
      [
        { text: t('common.cancel', { defaultValue: 'Cancelar' }), style: 'cancel' },
        {
          text: t('profile.delete_my_account', { defaultValue: 'Eliminar mi cuenta y mis datos' }),
          style: 'destructive',
          onPress: async () => {
            try {
              setBanner(null);
              const { error } = await invokeEdgeFunction('delete-account', {});
              if (error) throw new Error(String(error.message || t('profile.delete_account_failed')));
              await signOut();
              router.replace('/(auth)/login');
            } catch (e: any) {
              Alert.alert(t('common.error'), String(e?.message || t('profile.delete_account_failed')));
            }
          },
        },
      ]
    );
  }, [signOut, t]);

  return (
    <View style={ui.screen}>
      <StatusBar barStyle="light-content" />
      <LinearGradient
        colors={[Colors.dark.background, '#1e1b4b', '#050510']}
        style={StyleSheet.absoluteFill}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      />
      <View pointerEvents="none" style={ui.glowA} />
      <View pointerEvents="none" style={ui.glowB} />

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={[ui.content, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 20 }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#fff" />}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={ui.headerCard}>
            <LinearGradient
              colors={['rgba(124,58,237,0.28)', 'rgba(6,182,212,0.14)', 'rgba(255,255,255,0.04)']}
              style={StyleSheet.absoluteFill}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
            />
            <View style={ui.headerRow}>
              <View style={ui.avatarRingWrap} accessibilityRole="image" accessibilityLabel={t('tabs.profile', { defaultValue: 'Avatar' })}>
                <LinearGradient
                  colors={['rgba(124,58,237,0.90)', 'rgba(6,182,212,0.55)', 'rgba(255,255,255,0.10)']}
                  style={ui.avatarRing}
                >
                  <View style={ui.avatarRingInner}>
                    <View style={ui.avatarFallback}>
                      <Text style={ui.avatarFallbackText}>{initials}</Text>
                    </View>
                  </View>
                </LinearGradient>
              </View>

              <View style={{ flex: 1 }}>
                <Text style={ui.headerName} numberOfLines={1}>{displayName}</Text>
                <Text style={ui.headerEmail} numberOfLines={1}>{email}</Text>
                <View style={ui.headerMetaRow}>
                  <View style={ui.memberBadge}>
                    <Text style={ui.memberBadgeText}>
                      {t('profile.member_since', { defaultValue: 'Miembro desde {{year}}', year: new Date(user?.created_at || Date.now()).getFullYear() })}
                    </Text>
                  </View>
                </View>
              </View>

              <View style={{ alignItems: 'flex-end', gap: 8 }}>
                <Badge tone={verificationTone as any} label={verificationLabel} />
              </View>
            </View>
          </View>

          {banner && (
            <View style={[ui.banner, bannerStyle]} accessibilityRole="alert">
              <Text style={ui.bannerText}>{banner.text}</Text>
            </View>
          )}

          {profile?.is_suspended ? (
            <View style={[ui.banner, ui.bannerError]} accessibilityRole="alert">
              <Text style={ui.bannerText}>{t('profile.suspended', { defaultValue: 'Cuenta suspendida' })}</Text>
              <Text style={ui.bannerSubText}>{String(profile?.suspended_reason || '')}</Text>
            </View>
          ) : null}

          <Card
            title={t('profile.edit_profile', { defaultValue: 'Editar perfil' })}
            subtitle={t('profile.section_profile', { defaultValue: 'Actualiza tus datos personales y de organizador.' })}
            icon={<Pencil size={18} color="white" />}
            actionLabel={t('profile.edit_profile', { defaultValue: 'Editar perfil' })}
            onActionPress={openEdit}
          >
            <View style={{ gap: 8 }}>
              <KeyValue label={t('profile.full_name', { defaultValue: 'Nombre' })} value={safeValue(profile?.full_name)} />
              <KeyValue label={t('profile.city', { defaultValue: 'Ciudad' })} value={safeValue(profile?.city)} />
              <KeyValue label={t('profile.country', { defaultValue: 'País' })} value={safeValue(profile?.country)} />
            </View>
          </Card>

          <Card
            title={t('profile.organizer.business_title', { defaultValue: 'Datos de organizador' })}
            subtitle={t('profile.organizer.business_subtitle', { defaultValue: 'Datos públicos y de contacto del organizador.' })}
            icon={<User size={18} color="white" />}
          >
            <View style={{ gap: 8 }}>
              <KeyValue label={t('profile.organizer.business.club_label', { defaultValue: 'Club' })} value={safeValue(profile?.club_name)} />
              <KeyValue label={t('profile.organizer.business.business_email_label', { defaultValue: 'Email de negocio' })} value={safeValue(profile?.business_email)} />
              <KeyValue label={t('profile.organizer.business.instagram_label', { defaultValue: 'Instagram' })} value={safeValue(profile?.instagram_account)} />
            </View>
            {profile?.verification_status !== 'verified' ? (
              <View style={{ marginTop: 12, gap: 10 }}>
                <PrimaryButton
                  label={t('creator.organizer.verification.complete_button', { defaultValue: 'Completar verificación' })}
                  onPress={() => router.push('/(creator)/verification')}
                />
              </View>
            ) : null}
          </Card>

          <Card
            title={t('profile.section_settings', { defaultValue: 'Preferencias de la app' })}
            subtitle={t('profile.section_settings_sub', { defaultValue: 'Idioma y notificaciones.' })}
            icon={<SlidersHorizontal size={18} color="white" />}
          >
            <View style={{ gap: 12 }}>
              <View style={ui.kvRow}>
                <Text style={ui.kvLabel}>{t('common.language', { defaultValue: 'Idioma' })}</Text>
                <Text style={ui.kvValue}>{language === 'en' ? 'English' : language === 'fr' ? 'Français' : 'Español'}</Text>
              </View>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <SecondaryButton label="ES" selected={language === 'es'} onPress={() => setLanguage('es')} />
                <SecondaryButton label="EN" selected={language === 'en'} onPress={() => setLanguage('en')} />
                <SecondaryButton label="FR" selected={language === 'fr'} onPress={() => setLanguage('fr')} />
                <SecondaryButton label={t('profile.device_language', { defaultValue: 'Sistema' })} onPress={setDeviceLanguage} />
              </View>

              <View style={ui.divider} />

              <PrimaryButton label={t('profile.notification_preferences', { defaultValue: 'Preferencias de notificaciones' })} onPress={() => router.push('/notification-preferences')} />
              <SecondaryButton label={t('profile.notification_center', { defaultValue: 'Centro de notificaciones' })} onPress={() => router.push('/notifications')} />
            </View>
          </Card>

          <Card
            title={t('profile.section_privacy', { defaultValue: 'Privacidad y seguridad' })}
            subtitle={t('profile.section_privacy_sub', { defaultValue: 'Información legal y control de datos.' })}
            icon={<Lock size={18} color="white" />}
          >
            <View style={{ gap: 10 }}>
              <PrimaryButton label={t('profile.legal_info', { defaultValue: 'Información legal' })} onPress={() => router.push('/legal')} />
              <SecondaryButton label={t('profile.logout', { defaultValue: 'Cerrar sesión' })} onPress={doSignOut} />
              <PrimaryButton label={t('profile.delete_my_account', { defaultValue: 'Eliminar mi cuenta y mis datos' })} onPress={doDeleteAccount} tone="danger" />
            </View>
          </Card>

          {loading ? (
            <View style={{ paddingVertical: 18 }}>
              <Text style={ui.loadingText}>{t('common.loading', { defaultValue: 'Cargando…' })}</Text>
            </View>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>

      <Modal transparent visible={editOpen} animationType="slide" onRequestClose={() => setEditOpen(false)}>
        <View style={ui.modalBackdrop}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={ui.modalKav}>
            <View
              style={[ui.modalCard, { paddingBottom: insets.bottom + 14, height: editModalHeight }]}
              accessibilityLabel={t('profile.edit_profile', { defaultValue: 'Editar perfil' })}
            >
              <LinearGradient
                colors={['rgba(124,58,237,0.24)', 'rgba(6,182,212,0.10)', 'rgba(255,255,255,0.03)']}
                style={StyleSheet.absoluteFill}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
              />
              <View style={ui.modalTop}>
                <Pressable
                  onPress={() => setEditOpen(false)}
                  accessibilityRole="button"
                  accessibilityLabel={t('common.cancel', { defaultValue: 'Cancelar' })}
                  style={({ pressed }) => [ui.cancelBtn, pressed ? ui.cancelBtnPressed : null]}
                  hitSlop={10}
                >
                  <Text style={ui.cancelBtnText}>{t('common.cancel', { defaultValue: 'Cancelar' })}</Text>
                </Pressable>
                <View style={{ flex: 1 }}>
                  <Text style={ui.modalTitle}>{t('profile.edit_profile', { defaultValue: 'Editar perfil' })}</Text>
                  <Text style={ui.modalSubtitle}>
                    {t('profile.edit.subtitle', { defaultValue: 'Todos los campos están etiquetados. Guarda cuando termines.' })}
                  </Text>
                </View>
                <Pressable
                  onPress={() => setEditOpen(false)}
                  accessibilityRole="button"
                  accessibilityLabel={t('common.cancel', { defaultValue: 'Cerrar' })}
                  style={({ pressed }) => [ui.closeBtn, pressed ? ui.closeBtnPressed : null]}
                  hitSlop={10}
                >
                  <X size={20} color="white" />
                </Pressable>
              </View>

              <ScrollView
                style={{ flex: 1 }}
                contentContainerStyle={[ui.modalContent, { paddingBottom: 24 }]}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'none'}
                showsVerticalScrollIndicator={false}
              >
                <View style={ui.modalSection}>
                  <Text style={ui.sectionTitle}>{t('profile.section_profile', { defaultValue: 'Datos personales' })}</Text>
                  <View style={ui.sectionBody}>
                    <InputField
                      label={t('profile.full_name', { defaultValue: 'Nombre completo' })}
                      hint={t('profile.edit.hints.full_name', { defaultValue: 'Ej: “María López”.' })}
                      value={draft.full_name}
                      onChange={(v) => { setTouched((p) => ({ ...p, full_name: true })); setDraft((p) => ({ ...p, full_name: normalizeWhitespaceForInput(v) })); }}
                      error={touched.full_name ? errors.full_name || null : null}
                    />
                  <InputField
                    label={t('profile.phone', { defaultValue: 'Teléfono' })}
                    hint={t('profile.edit.hints.phone', { defaultValue: 'Formato internacional recomendado.' })}
                    value={draft.phone}
                    onChange={(v) => { setTouched((p) => ({ ...p, phone: true })); setDraft((p) => ({ ...p, phone: v })); }}
                    keyboardType="default"
                  />
                  <View style={{ flexDirection: 'row', gap: 12 }}>
                    <View style={{ flex: 1 }}>
                      <InputField
                        label={t('profile.city', { defaultValue: 'Ciudad' })}
                        hint={t('profile.edit.hints.city', { defaultValue: 'Debe existir.' })}
                        value={draft.city}
                        onChange={(v) => { setTouched((p) => ({ ...p, city: true })); setDraft((p) => ({ ...p, city: normalizeWhitespaceForInput(v) })); }}
                        error={touched.city ? errors.city || null : null}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <InputField
                        label={t('profile.country', { defaultValue: 'País' })}
                        hint={t('profile.edit.hints.country', { defaultValue: 'Debe existir.' })}
                        value={draft.country}
                        onChange={(v) => { setTouched((p) => ({ ...p, country: true })); setDraft((p) => ({ ...p, country: normalizeWhitespaceForInput(v) })); }}
                        error={touched.country ? errors.country || null : null}
                      />
                    </View>
                  </View>
                  <View style={{ flexDirection: 'row', gap: 12 }}>
                    <View style={{ flex: 1 }}>
                      <InputField
                        label={t('profile.gender', { defaultValue: 'Género' })}
                        hint={t('profile.edit.hints.gender', { defaultValue: 'Opcional.' })}
                        value={draft.gender}
                        onChange={(v) => setDraft((p) => ({ ...p, gender: v }))}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <InputField
                        label={t('profile.age', { defaultValue: 'Edad' })}
                        hint={t('profile.edit.hints.age', { defaultValue: '0–120 (opcional).' })}
                        value={draft.age}
                        onChange={(v) => { setTouched((p) => ({ ...p, age: true })); setDraft((p) => ({ ...p, age: v.replace(/[^\d]/g, '').slice(0, 3) })); }}
                        keyboardType="number-pad"
                        error={touched.age ? errors.age || null : null}
                      />
                    </View>
                  </View>
                </View>
              </View>

              <View style={ui.modalSection}>
                <Text style={ui.sectionTitle}>{t('profile.organizer.business_title', { defaultValue: 'Datos de organizador' })}</Text>
                <View style={ui.sectionBody}>
                  <InputField
                    label={t('profile.organizer.business.club_label', { defaultValue: 'Club' })}
                    hint={t('profile.edit.hints.club', { defaultValue: 'Nombre público del organizador.' })}
                    value={draft.club_name}
                    onChange={(v) => { setTouched((p) => ({ ...p, club_name: true })); setDraft((p) => ({ ...p, club_name: normalizeWhitespaceForInput(v) })); }}
                    error={touched.club_name ? errors.club_name || null : null}
                  />
                  <InputField
                    label={t('profile.organizer.business.business_email_label', { defaultValue: 'Email de negocio' })}
                    hint={t('profile.edit.hints.business_email', { defaultValue: 'Usado para contacto.' })}
                    value={draft.business_email}
                    onChange={(v) => { setTouched((p) => ({ ...p, business_email: true })); setDraft((p) => ({ ...p, business_email: v })); }}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    error={touched.business_email ? errors.business_email || null : null}
                  />
                  <InputField
                    label={t('profile.organizer.business.instagram_label', { defaultValue: 'Instagram' })}
                    hint={t('profile.edit.hints.instagram', { defaultValue: 'Solo usuario (sin @).' })}
                    value={draft.instagram_account}
                    onChange={(v) => { setTouched((p) => ({ ...p, instagram_account: true })); setDraft((p) => ({ ...p, instagram_account: v.replace(/^@/, '').trim() })); }}
                    autoCapitalize="none"
                    error={touched.instagram_account ? errors.instagram_account || null : null}
                  />
                </View>
              </View>

              <View style={ui.modalSection}>
                <Text style={ui.sectionTitle}>{t('profile.organizer.legal.title', { defaultValue: 'Datos fiscales (opcional)' })}</Text>
                <View style={ui.sectionBody}>
                  <InputField
                    label={t('profile.organizer.legal.venue_address', { defaultValue: 'Dirección del venue' })}
                    hint={t('profile.edit.hints.venue_address', { defaultValue: 'Ej: Calle, número, ciudad.' })}
                    value={draft.organizer_venue_address}
                    onChange={(v) => { setTouched((p) => ({ ...p, organizer_venue_address: true })); setDraft((p) => ({ ...p, organizer_venue_address: normalizeWhitespaceForInput(v) })); }}
                    error={touched.organizer_venue_address ? errors.organizer_venue_address || null : null}
                  />
                  <InputField
                    label={t('profile.organizer.legal.fiscal_address', { defaultValue: 'Dirección fiscal' })}
                    hint={t('profile.edit.hints.fiscal_address', { defaultValue: 'Para facturación.' })}
                    value={draft.organizer_fiscal_address}
                    onChange={(v) => { setTouched((p) => ({ ...p, organizer_fiscal_address: true })); setDraft((p) => ({ ...p, organizer_fiscal_address: normalizeWhitespaceForInput(v) })); }}
                    error={touched.organizer_fiscal_address ? errors.organizer_fiscal_address || null : null}
                  />
                  <InputField
                    label={t('profile.organizer.legal.postal_code', { defaultValue: 'Código postal' })}
                    hint={t('profile.edit.hints.postal_code', { defaultValue: 'Ej: 28013.' })}
                    value={draft.organizer_postal_code}
                    onChange={(v) => { setTouched((p) => ({ ...p, organizer_postal_code: true })); setDraft((p) => ({ ...p, organizer_postal_code: v })); }}
                    autoCapitalize="none"
                    error={touched.organizer_postal_code ? errors.organizer_postal_code || null : null}
                  />
                  <InputField
                    label={t('profile.organizer.legal.responsible_name', { defaultValue: 'Nombre del responsable' })}
                    hint={t('profile.edit.hints.responsible_name', { defaultValue: 'Nombre y apellidos.' })}
                    value={draft.organizer_responsible_name}
                    onChange={(v) => { setTouched((p) => ({ ...p, organizer_responsible_name: true })); setDraft((p) => ({ ...p, organizer_responsible_name: normalizeWhitespaceForInput(v) })); }}
                    error={touched.organizer_responsible_name ? errors.organizer_responsible_name || null : null}
                  />
                  <InputField
                    label={t('profile.organizer.legal.responsible_birthdate', { defaultValue: 'Fecha de nacimiento del responsable' })}
                    hint={t('profile.edit.hints.birthdate', { defaultValue: 'Formato: YYYY-MM-DD.' })}
                    value={draft.organizer_responsible_birthdate}
                    onChange={(v) => { setTouched((p) => ({ ...p, organizer_responsible_birthdate: true })); setDraft((p) => ({ ...p, organizer_responsible_birthdate: v })); }}
                    autoCapitalize="none"
                    error={touched.organizer_responsible_birthdate ? errors.organizer_responsible_birthdate || null : null}
                  />
                  <InputField
                    label={t('profile.organizer.legal.iban', { defaultValue: 'IBAN' })}
                    hint={t('profile.edit.hints.iban', { defaultValue: 'España (ES…).' })}
                    value={draft.organizer_iban}
                    onChange={(v) => { setTouched((p) => ({ ...p, organizer_iban: true })); setDraft((p) => ({ ...p, organizer_iban: v.replace(/\s+/g, '').toUpperCase() })); }}
                    autoCapitalize="none"
                    error={touched.organizer_iban ? errors.organizer_iban || null : null}
                  />
                </View>
              </View>

              <View style={ui.autoSaveRow}>
                <View style={{ flex: 1 }}>
                  <Text style={ui.label}>{t('profile.edit.autosave', { defaultValue: 'Guardado automático' })}</Text>
                  <Text style={ui.hint}>
                    {t('profile.edit.autosave_hint', { defaultValue: 'Guarda cambios automáticamente cuando no hay errores.' })}
                  </Text>
                  {locationChecking ? (
                    <Text style={ui.hint}>
                      {t('profile.edit.location_checking', { defaultValue: 'Verificando ciudad/país…' })}
                    </Text>
                  ) : null}
                </View>
                <Switch value={autoSave} onValueChange={setAutoSave} />
              </View>
            </ScrollView>

            <View style={ui.modalBottom}>
              <SecondaryButton label={t('common.cancel', { defaultValue: 'Cancelar' })} onPress={() => setEditOpen(false)} disabled={saving} />
              <PrimaryButton label={saving ? t('common.loading', { defaultValue: 'Guardando…' }) : t('common.save', { defaultValue: 'Guardar' })} onPress={() => save()} disabled={saving || !dirty} />
            </View>
          </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </View>
  );
}

const ui = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#000' },
  glowA: {
    position: 'absolute',
    top: -110,
    left: -80,
    width: 320,
    height: 320,
    borderRadius: 160,
    backgroundColor: '#8b5cf6',
    opacity: 0.12,
    transform: [{ scale: 1.3 }],
  },
  glowB: {
    position: 'absolute',
    bottom: -140,
    right: -90,
    width: 360,
    height: 360,
    borderRadius: 180,
    backgroundColor: '#06b6d4',
    opacity: 0.10,
    transform: [{ scale: 1.5 }],
  },
  content: { paddingHorizontal: 16, gap: 12 },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 2 },
  h1: { color: 'white', fontSize: 22, fontWeight: '900' },
  h2: { color: 'rgba(255,255,255,0.70)', fontWeight: '700', marginTop: 6 },
  headerCard: {
    borderRadius: 22,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  avatarRingWrap: { width: 66, height: 66, borderRadius: 22 },
  avatarRing: { width: 66, height: 66, borderRadius: 22, padding: 3 },
  avatarRingInner: { flex: 1, borderRadius: 20, overflow: 'hidden', backgroundColor: 'rgba(0,0,0,0.35)' },
  avatarFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    backgroundColor: 'rgba(0,0,0,0.25)',
  },
  avatarFallbackText: { color: 'white', fontWeight: '900', fontSize: 18 },
  headerName: { color: 'white', fontWeight: '900', fontSize: 18 },
  headerEmail: { color: 'rgba(255,255,255,0.65)', fontWeight: '700', marginTop: 4 },
  headerMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10 },
  memberBadge: {
    height: 24,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  memberBadgeText: { color: 'rgba(255,255,255,0.78)', fontWeight: '800', fontSize: 11 },
  banner: { borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1 },
  bannerOk: { backgroundColor: 'rgba(34,197,94,0.14)', borderColor: 'rgba(34,197,94,0.35)' },
  bannerWarn: { backgroundColor: 'rgba(245,158,11,0.14)', borderColor: 'rgba(245,158,11,0.35)' },
  bannerError: { backgroundColor: 'rgba(239,68,68,0.14)', borderColor: 'rgba(239,68,68,0.35)' },
  bannerText: { color: 'white', fontWeight: '900' },
  bannerSubText: { color: 'rgba(255,255,255,0.70)', fontWeight: '700', marginTop: 4, lineHeight: 18 },
  badge: { borderRadius: 999, paddingHorizontal: 10, height: 24, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  badgeText: { fontWeight: '900', fontSize: 11 },
  badgeOk: { backgroundColor: 'rgba(34,197,94,0.14)', borderColor: 'rgba(34,197,94,0.35)' },
  badgeOkText: { color: '#4ade80' },
  badgeWarn: { backgroundColor: 'rgba(245,158,11,0.14)', borderColor: 'rgba(245,158,11,0.35)' },
  badgeWarnText: { color: '#fbbf24' },
  badgeError: { backgroundColor: 'rgba(239,68,68,0.14)', borderColor: 'rgba(239,68,68,0.35)' },
  badgeErrorText: { color: '#fb7185' },
  badgeNeutral: { backgroundColor: 'rgba(255,255,255,0.06)', borderColor: 'rgba(255,255,255,0.12)' },
  badgeNeutralText: { color: 'rgba(255,255,255,0.75)' },
  card: {
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    backgroundColor: 'rgba(0,0,0,0.22)',
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  cardHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: alpha(Colors.dark.primary, 0.18),
    borderWidth: 1,
    borderColor: alpha(Colors.dark.primary, 0.28),
  },
  cardTitle: { color: 'white', fontWeight: '900', fontSize: 16 },
  cardSubtitle: { color: 'rgba(255,255,255,0.70)', fontWeight: '700', marginTop: 6, lineHeight: 18 },
  chevronBtn: {
    width: 40,
    height: 40,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  chevronBtnPressed: { transform: [{ scale: 0.98 }], backgroundColor: 'rgba(255,255,255,0.10)' },
  kvRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 10, paddingVertical: 6 },
  kvLabel: { color: 'rgba(255,255,255,0.62)', fontWeight: '800' },
  kvValue: { color: 'white', fontWeight: '900', flex: 1, textAlign: 'right' },
  divider: { height: 1, backgroundColor: 'rgba(255,255,255,0.10)' },
  button: {
    height: 52,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    flex: 1,
  },
  buttonPrimary: { backgroundColor: Colors.dark.primary, borderColor: alpha(Colors.dark.primary, 0.35) },
  buttonDanger: { backgroundColor: '#ef4444', borderColor: 'rgba(239,68,68,0.45)' },
  buttonSecondary: { backgroundColor: 'rgba(255,255,255,0.06)', borderColor: 'rgba(255,255,255,0.14)' },
  buttonSelected: { backgroundColor: alpha(Colors.dark.primary, 0.22), borderColor: alpha(Colors.dark.primary, 0.55) },
  buttonPressed: { transform: [{ scale: 0.99 }] },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: Colors.dark.text, fontWeight: '900', fontSize: 14 },
  buttonTextSelected: { color: 'white' },
  loadingText: { color: 'rgba(255,255,255,0.70)', fontWeight: '800', textAlign: 'center' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.82)', justifyContent: 'center', alignItems: 'center' },
  modalCard: {
    borderRadius: 26,
    backgroundColor: '#0b1026',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    width: '100%',
    maxWidth: 720,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 14,
  },
  modalKav: { width: '100%', flex: 1, justifyContent: 'center', alignItems: 'center', padding: 12 },
  modalTop: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.08)' },
  modalTitle: { color: 'white', fontWeight: '900', fontSize: 18 },
  modalSubtitle: { color: 'rgba(255,255,255,0.68)', fontWeight: '700', marginTop: 6, lineHeight: 18 },
  cancelBtn: {
    height: 40,
    paddingHorizontal: 10,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  cancelBtnPressed: { transform: [{ scale: 0.98 }], backgroundColor: 'rgba(255,255,255,0.10)' },
  cancelBtnText: { color: 'white', fontWeight: '900' },
  closeBtn: {
    width: 40,
    height: 40,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  closeBtnPressed: { transform: [{ scale: 0.98 }], backgroundColor: 'rgba(255,255,255,0.10)' },
  modalContent: { paddingHorizontal: 16, paddingBottom: 14, gap: 14 },
  modalSection: {
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  sectionTitle: { color: 'white', fontWeight: '900', fontSize: 15 },
  sectionBody: { marginTop: 12, gap: 12 },
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
  inputError: { borderColor: 'rgba(239,68,68,0.55)', backgroundColor: 'rgba(239,68,68,0.08)' },
  errorText: { color: '#fb7185', fontWeight: '800' },
  autoSaveRow: {
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    backgroundColor: 'rgba(255,255,255,0.04)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  modalBottom: { flexDirection: 'row', gap: 12, paddingHorizontal: 16, paddingTop: 10 },
});
