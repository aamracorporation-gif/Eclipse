import { View, Text, StyleSheet, TouchableOpacity, Platform, ScrollView, Image, RefreshControl, StatusBar, Modal, TextInput, KeyboardAvoidingView, Switch, Alert, useWindowDimensions } from 'react-native';
import { router, useSegments } from 'expo-router';
import { useAuth } from '@/lib/AuthContext';
import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { User, Ticket, ChevronRight, Tag, TrendingUp, UserPlus, Calendar, Sparkles, CheckCircle2, ShieldCheck, Wallet, QrCode, Clock, MapPin, Pencil, X, FileText, LogOut } from '@/lib/icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Colors } from '@/constants/Colors';
import { GlassView } from '@/components/ui/GlassView';
import { ThemedButton } from '@/components/ui/ThemedButton';
import { DiscoLoader } from '@/components/ui/DiscoLoader';
import { AuthRequiredScreen } from '@/components/ui/AuthRequiredScreen';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useResponsive } from '@/lib/responsive';
import * as Haptics from 'expo-haptics';
import { useFocusEffect } from '@react-navigation/native';
import { useEvents } from '@/lib/EventContext';
import { useTranslation } from 'react-i18next';
import { useI18n } from '@/lib/I18nContext';
import { invokeEdgeFunction } from '@/lib/edgeFunctions';
import { useAppDialog } from '@/components/ui/AppDialog';
import { isSafeAddressText, isSafeOrgText, isValidIbanES, isValidPersonName, normalizeWhitespace, normalizeWhitespaceForInput } from '@/lib/validators';
import * as Location from 'expo-location';

export default function ProfileScreen() {
  const { user, signOut, workerProfile } = useAuth();
  const { events, refreshEvents } = useEvents();
  const { t } = useTranslation();
  const { language, setLanguage, setDeviceLanguage } = useI18n();
  const { show: showDialog } = useAppDialog();
  const segments = useSegments();
  const inCreator = segments?.[0] === '(creator)';
  const localeTag = language === 'en' ? 'en-US' : language === 'fr' ? 'fr-FR' : 'es-ES';
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const { horizontalPadding, maxContentWidth } = useResponsive();
  
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [activeTab, setActiveTab] = useState<'profile' | 'panel' | 'account' | 'resale'>('profile');
  const [organizerStats, setOrganizerStats] = useState<{ revenue: number; tickets: number }>({ revenue: 0, tickets: 0 });
  const [verificationStatus, setVerificationStatus] = useState<'pending_verification' | 'verified' | 'rejected' | 'needs_correction' | null>(null);
  const [profileRole, setProfileRole] = useState<'organizer' | 'attendee' | 'admin' | null>(
    (user?.user_metadata as any)?.role ?? null
  );
  const resaleRefreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [organizerMeta, setOrganizerMeta] = useState<{
    club_name: string | null;
    instagram_account: string | null;
    business_email: string | null;
    city: string | null;
    country: string | null;
    address?: string | null;
    phone?: string | null;
    is_suspended: boolean;
    suspended_reason: string | null;
    verification_rejection_reason?: string | null;
  } | null>(null);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [resaleListings, setResaleListings] = useState<any[]>([]);
  const [loadingResales, setLoadingResales] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);

  const [profileEditOpen, setProfileEditOpen] = useState(false);
  const [profileEditLoading, setProfileEditLoading] = useState(false);
  const [profileEditSaving, setProfileEditSaving] = useState(false);
  const [profileEditAutoSave, setProfileEditAutoSave] = useState(false);
  const [profileEditShowIban, setProfileEditShowIban] = useState(false);
  const [profileEditTouched, setProfileEditTouched] = useState<Record<string, boolean>>({});
  const [profileEditAsyncErrors, setProfileEditAsyncErrors] = useState<Record<string, string>>({});
  const [profileEditLocationChecking, setProfileEditLocationChecking] = useState(false);
  const profileEditInitialKeyRef = useRef<string>('');
  const profileEditAutoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const profileEditLastPromptKeyRef = useRef<string>('');
  const profileEditLastLocationQueryRef = useRef<string>('');
  const [profileDraft, setProfileDraft] = useState({
    full_name: '',
    first_name: '',
    last_name: '',
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
  });

  const profileEditModalHeight = useMemo(() => {
    const available = Math.max(0, windowHeight - 32);
    return Math.max(420, Math.min(760, available));
  }, [windowHeight]);

  const activeListings = useMemo(() => resaleListings.filter(l => l.status === 'active'), [resaleListings]);

  useFocusEffect(
    useCallback(() => {
      refreshEvents();
      
      if (profileRole === 'organizer' && !inCreator) {
        router.replace('/(creator)');
      }
    }, [refreshEvents, profileRole, inCreator])
  );
  const soldListings = useMemo(() => resaleListings.filter(l => l.status === 'sold'), [resaleListings]);

  const adminEmail = ((process.env.EXPO_PUBLIC_ADMIN_EMAIL as any) ?? '').toString().trim().toLowerCase() || 'aamracorporation@gmail.com';
  const isAdminEmail = !!user?.email && user.email.toLowerCase() === adminEmail;
  const isOrganizer = profileRole === 'organizer';
  const isOrganizerSuspended = !!organizerMeta?.is_suspended;
  const canOrganizerPublish = isOrganizer && verificationStatus === 'verified' && !isOrganizerSuspended;
  const displayName = useMemo(() => {
    if (!user) return 'Usuario';
    if (isOrganizer && organizerMeta?.club_name) return organizerMeta.club_name;
    return user.user_metadata?.full_name || 'Usuario';
  }, [isOrganizer, organizerMeta?.club_name, user]);

  const sanitizeByAllowed = (text: string, allowed: RegExp) => {
    const raw = String(text || '');
    let out = '';
    for (const ch of raw) {
      if (allowed.test(ch)) out += ch;
    }
    return out;
  };

  const setProfileField = (key: keyof typeof profileDraft, value: string) => {
    setProfileEditTouched((prev) => ({ ...prev, [key]: true }));
    if (key === 'first_name' || key === 'last_name' || key === 'organizer_responsible_name') {
      const v = normalizeWhitespaceForInput(sanitizeByAllowed(value, /^[\p{L}\s]$/u));
      setProfileDraft((prev) => ({ ...prev, [key]: v }));
      return;
    }
    if (key === 'city' || key === 'country' || key === 'gender') {
      const v = normalizeWhitespaceForInput(sanitizeByAllowed(value, /^[\p{L}\s]$/u));
      if (key === 'city' || key === 'country') {
        setProfileEditAsyncErrors((prev) => {
          const next = { ...prev };
          delete next.city;
          delete next.country;
          return next;
        });
        profileEditLastLocationQueryRef.current = '';
      }
      setProfileDraft((prev) => ({ ...prev, [key]: v }));
      return;
    }
    if (key === 'club_name') {
      const v = normalizeWhitespaceForInput(sanitizeByAllowed(value, /^[\p{L}\p{N}\s.&'’"\-()/#]$/u));
      setProfileDraft((prev) => ({ ...prev, [key]: v }));
      return;
    }
    if (key === 'organizer_venue_address' || key === 'organizer_fiscal_address') {
      const v = normalizeWhitespaceForInput(sanitizeByAllowed(value, /^[\p{L}\p{N}\s.,'’"\-#/ºª]$/u));
      setProfileDraft((prev) => ({ ...prev, [key]: v }));
      return;
    }
    if (key === 'organizer_postal_code') {
      const v = String(value || '').replace(/[^\d]/g, '').slice(0, 5);
      setProfileDraft((prev) => ({ ...prev, [key]: v }));
      return;
    }
    if (key === 'organizer_iban') {
      const v = String(value || '').replace(/[^0-9A-Za-z]/g, '').toUpperCase();
      setProfileDraft((prev) => ({ ...prev, [key]: v }));
      return;
    }
    if (key === 'business_email') {
      const v = String(value || '').replace(/\s+/g, '').toLowerCase().slice(0, 140);
      setProfileDraft((prev) => ({ ...prev, [key]: v }));
      return;
    }
    if (key === 'instagram_account') {
      const v = String(value || '').replace(/\s+/g, '').slice(0, 60);
      setProfileDraft((prev) => ({ ...prev, [key]: v }));
      return;
    }
    if (key === 'age') {
      const v = String(value || '').replace(/[^\d]/g, '').slice(0, 3);
      setProfileDraft((prev) => ({ ...prev, [key]: v }));
      return;
    }
    if (key === 'organizer_responsible_birthdate') {
      const v = String(value || '').replace(/[^\d-]/g, '').slice(0, 10);
      setProfileDraft((prev) => ({ ...prev, [key]: v }));
      return;
    }
    if (key === 'phone') {
      const v = String(value || '').replace(/[^\d+\s()-]/g, '').slice(0, 24);
      setProfileDraft((prev) => ({ ...prev, [key]: v }));
      return;
    }
    if (key === 'full_name') {
      const v = normalizeWhitespaceForInput(String(value || '')).slice(0, 80);
      setProfileDraft((prev) => ({ ...prev, [key]: v }));
      return;
    }
    setProfileDraft((prev) => ({ ...prev, [key]: String(value || '') }));
  };

  const profileEditErrors = useMemo(() => {
    const errors: Record<string, string> = {};
    const nonEmpty = (s: string) => normalizeWhitespace(s).length > 0;
    const emailOk = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(String(s || ''));
    const dateOk = (s: string) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
      const d = new Date(`${s}T00:00:00.000Z`);
      if (Number.isNaN(d.getTime())) return false;
      if (d.getUTCFullYear() < 1900) return false;
      if (d.getTime() > Date.now()) return false;
      return true;
    };

    const full = normalizeWhitespace(profileDraft.full_name);
    const first = normalizeWhitespace(profileDraft.first_name);
    const last = normalizeWhitespace(profileDraft.last_name);
    if (!full && !(first && last)) errors.full_name = t('profile.edit.errors.name_required', { defaultValue: 'Ingresa tu nombre.' });
    if (nonEmpty(first) && !isValidPersonName(first)) errors.first_name = t('profile.edit.errors.invalid_name', { defaultValue: 'Nombre inválido.' });
    if (nonEmpty(last) && !isValidPersonName(last)) errors.last_name = t('profile.edit.errors.invalid_name', { defaultValue: 'Apellido inválido.' });

    if (nonEmpty(profileDraft.city) && !isValidPersonName(profileDraft.city)) errors.city = t('profile.edit.errors.invalid_city', { defaultValue: 'Ciudad inválida.' });
    if (nonEmpty(profileDraft.country) && !isValidPersonName(profileDraft.country)) errors.country = t('profile.edit.errors.invalid_country', { defaultValue: 'País inválido.' });
    if (nonEmpty(profileDraft.gender) && !isValidPersonName(profileDraft.gender)) errors.gender = t('profile.edit.errors.invalid_gender', { defaultValue: 'Valor inválido.' });

    if (nonEmpty(profileDraft.age)) {
      const n = Number(profileDraft.age);
      if (!Number.isFinite(n) || n < 1 || n > 120) errors.age = t('profile.edit.errors.invalid_age', { defaultValue: 'Edad inválida.' });
    }

    const phone = normalizeWhitespace(profileDraft.phone);
    if (nonEmpty(phone) && !/^[0-9+\s()-]{6,24}$/.test(phone)) errors.phone = t('profile.edit.errors.invalid_phone', { defaultValue: 'Teléfono inválido.' });

    if (nonEmpty(profileDraft.club_name) && !isSafeOrgText(profileDraft.club_name)) errors.club_name = t('profile.edit.errors.invalid_text', { defaultValue: 'No se permiten emojis ni caracteres especiales.' });
    if (nonEmpty(profileDraft.business_email) && !emailOk(profileDraft.business_email)) errors.business_email = t('profile.edit.errors.invalid_email', { defaultValue: 'Email inválido.' });
    if (nonEmpty(profileDraft.instagram_account) && !/^@?[A-Za-z0-9_.]{1,30}$/.test(profileDraft.instagram_account)) errors.instagram_account = t('profile.edit.errors.invalid_instagram', { defaultValue: 'Instagram inválido.' });

    if (nonEmpty(profileDraft.organizer_venue_address) && !isSafeAddressText(profileDraft.organizer_venue_address)) errors.organizer_venue_address = t('profile.edit.errors.invalid_address', { defaultValue: 'Dirección inválida.' });
    if (nonEmpty(profileDraft.organizer_fiscal_address) && !isSafeAddressText(profileDraft.organizer_fiscal_address)) errors.organizer_fiscal_address = t('profile.edit.errors.invalid_address', { defaultValue: 'Dirección inválida.' });
    if (nonEmpty(profileDraft.organizer_postal_code) && profileDraft.organizer_postal_code.length !== 5) errors.organizer_postal_code = t('profile.edit.errors.invalid_postal', { defaultValue: 'Código postal inválido.' });
    if (nonEmpty(profileDraft.organizer_responsible_name) && !isValidPersonName(profileDraft.organizer_responsible_name)) errors.organizer_responsible_name = t('profile.edit.errors.invalid_name', { defaultValue: 'Nombre inválido.' });
    if (nonEmpty(profileDraft.organizer_responsible_birthdate) && !dateOk(profileDraft.organizer_responsible_birthdate)) errors.organizer_responsible_birthdate = t('profile.edit.errors.invalid_birthdate', { defaultValue: 'Fecha inválida (YYYY-MM-DD).' });
    if (nonEmpty(profileDraft.organizer_iban) && !isValidIbanES(profileDraft.organizer_iban)) errors.organizer_iban = t('profile.edit.errors.invalid_iban', { defaultValue: 'IBAN inválido.' });

    return errors;
  }, [profileDraft, t]);

  const buildProfileEditKey = useCallback((draft: typeof profileDraft) => {
    const normalize = (v: string) => normalizeWhitespace(v);
    return JSON.stringify({
      full_name: normalize(draft.full_name),
      first_name: normalize(draft.first_name),
      last_name: normalize(draft.last_name),
      phone: normalize(draft.phone),
      city: normalize(draft.city),
      country: normalize(draft.country),
      gender: normalize(draft.gender),
      age: String(draft.age || '').trim(),
      club_name: normalize(draft.club_name),
      business_email: String(draft.business_email || '').trim().toLowerCase(),
      instagram_account: String(draft.instagram_account || '').trim(),
      organizer_venue_address: normalize(draft.organizer_venue_address),
      organizer_fiscal_address: normalize(draft.organizer_fiscal_address),
      organizer_postal_code: String(draft.organizer_postal_code || '').trim(),
      organizer_responsible_name: normalize(draft.organizer_responsible_name),
      organizer_responsible_birthdate: String(draft.organizer_responsible_birthdate || '').trim(),
      organizer_iban: String(draft.organizer_iban || '').trim().toUpperCase(),
    });
  }, []);

  const profileEditKey = useMemo(() => {
    return buildProfileEditKey(profileDraft);
  }, [buildProfileEditKey, profileDraft]);

  const profileEditDirty = profileEditKey !== profileEditInitialKeyRef.current;
  const profileEditHasErrors = Object.keys(profileEditErrors).length > 0 || Object.keys(profileEditAsyncErrors).length > 0;

  const validateCityCountry = useCallback(async () => {
    const city = normalizeWhitespace(profileDraft.city);
    const country = normalizeWhitespace(profileDraft.country);

    if (!city && !country) {
      setProfileEditAsyncErrors((prev) => {
        const next = { ...prev };
        delete next.city;
        delete next.country;
        return next;
      });
      return true;
    }

    if (!city || !country) {
      setProfileEditAsyncErrors((prev) => ({
        ...prev,
        city: t('profile.edit.errors.location_incomplete', { defaultValue: 'Completa ciudad y país para validar.' }),
        country: t('profile.edit.errors.location_incomplete', { defaultValue: 'Completa ciudad y país para validar.' }),
      }));
      return false;
    }

    const query = `${city}, ${country}`;
    if (profileEditLastLocationQueryRef.current === query) return Object.keys(profileEditAsyncErrors).length === 0;

    setProfileEditLocationChecking(true);
    try {
      const timeoutMs = 6000;
      const timeout = new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), timeoutMs));
      const res = (await Promise.race([Location.geocodeAsync(query), timeout])) as Location.LocationGeocodedLocation[];
      if (!res || !Array.isArray(res) || res.length === 0) {
        setProfileEditAsyncErrors((prev) => ({
          ...prev,
          city: t('profile.edit.errors.location_not_found', { defaultValue: 'No se encontró la ciudad/país. Revisa que sea correcto.' }),
          country: t('profile.edit.errors.location_not_found', { defaultValue: 'No se encontró la ciudad/país. Revisa que sea correcto.' }),
        }));
        profileEditLastLocationQueryRef.current = query;
        return false;
      }

      setProfileEditAsyncErrors((prev) => {
        const next = { ...prev };
        delete next.city;
        delete next.country;
        return next;
      });
      profileEditLastLocationQueryRef.current = query;
      return true;
    } catch {
      setProfileEditAsyncErrors((prev) => ({
        ...prev,
        city: t('profile.edit.errors.location_check_failed', { defaultValue: 'No se pudo validar la ubicación. Revisa tu conexión.' }),
        country: t('profile.edit.errors.location_check_failed', { defaultValue: 'No se pudo validar la ubicación. Revisa tu conexión.' }),
      }));
      profileEditLastLocationQueryRef.current = query;
      return false;
    } finally {
      setProfileEditLocationChecking(false);
    }
  }, [profileDraft.city, profileDraft.country, profileEditAsyncErrors, t]);

  const closeProfileEdit = () => {
    if (!profileEditDirty) {
      setProfileEditOpen(false);
      setProfileEditShowIban(false);
      return;
    }
    Alert.alert(
      t('common.confirm', { defaultValue: 'Confirmar' }),
      t('profile.edit.discard_confirm', { defaultValue: 'Tienes cambios sin guardar. ¿Descartarlos?' }),
      [
        { text: t('common.cancel', { defaultValue: 'Cancelar' }), style: 'cancel' },
        {
          text: t('profile.edit.discard', { defaultValue: 'Descartar' }),
          style: 'destructive',
          onPress: () => {
            setProfileEditOpen(false);
            setProfileEditShowIban(false);
          },
        },
      ],
      { cancelable: true }
    );
  };

  const openProfileEdit = useCallback(async () => {
    if (!user?.id) return;
    setProfileEditOpen(true);
    setProfileEditLoading(true);
    setProfileEditTouched({});
    setProfileEditAsyncErrors({});
    setProfileEditLocationChecking(false);
    profileEditLastLocationQueryRef.current = '';
    setProfileEditShowIban(false);
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select(
          'full_name, first_name, last_name, phone, city, country, gender, age, club_name, business_email, instagram_account, address, organizer_venue_address, organizer_fiscal_address, organizer_postal_code, organizer_responsible_name, organizer_responsible_birthdate, organizer_iban'
        )
        .eq('id', user.id)
        .maybeSingle();
      if (error) throw error;

      const next = {
        full_name: String((data as any)?.full_name ?? user.user_metadata?.full_name ?? ''),
        first_name: String((data as any)?.first_name ?? user.user_metadata?.first_name ?? ''),
        last_name: String((data as any)?.last_name ?? user.user_metadata?.last_name ?? ''),
        phone: String((data as any)?.phone ?? ''),
        city: String((data as any)?.city ?? ''),
        country: String((data as any)?.country ?? ''),
        gender: String((data as any)?.gender ?? ''),
        age: (data as any)?.age != null ? String((data as any).age) : '',
        club_name: String((data as any)?.club_name ?? ''),
        business_email: String((data as any)?.business_email ?? ''),
        instagram_account: String((data as any)?.instagram_account ?? ''),
        organizer_venue_address: String((data as any)?.organizer_venue_address ?? (data as any)?.address ?? ''),
        organizer_fiscal_address: String((data as any)?.organizer_fiscal_address ?? ''),
        organizer_postal_code: String((data as any)?.organizer_postal_code ?? ''),
        organizer_responsible_name: String((data as any)?.organizer_responsible_name ?? ''),
        organizer_responsible_birthdate: String((data as any)?.organizer_responsible_birthdate ?? ''),
        organizer_iban: String((data as any)?.organizer_iban ?? ''),
      };

      setProfileDraft(next);
      profileEditInitialKeyRef.current = buildProfileEditKey(next);
    } catch (e: any) {
      Alert.alert(t('common.error'), String(e?.message || t('common.error')));
    } finally {
      setProfileEditLoading(false);
    }
  }, [buildProfileEditKey, t, user?.id, user?.user_metadata?.first_name, user?.user_metadata?.full_name, user?.user_metadata?.last_name]);

  const doSaveProfileEdit = useCallback(async () => {
    if (!user?.id) return;
    if (profileEditSaving) return;
    if (profileEditHasErrors) {
      Alert.alert(t('common.error'), t('profile.edit.fix_errors', { defaultValue: 'Corrige los errores antes de guardar.' }));
      return;
    }
    const locationOk = await validateCityCountry();
    if (!locationOk) {
      Alert.alert(t('common.error'), t('profile.edit.errors.location_not_found', { defaultValue: 'No se encontró la ciudad/país. Revisa que sea correcto.' }));
      return;
    }
    setProfileEditSaving(true);
    try {
      const normalizeOrNull = (v: string) => {
        const s = normalizeWhitespace(v);
        return s.length ? s : null;
      };
      const normalizeTrimOrNull = (v: string) => {
        const s = String(v || '').trim();
        return s.length ? s : null;
      };
      const ageNum = String(profileDraft.age || '').trim().length ? Number(profileDraft.age) : null;

      const payload: any = {
        full_name: normalizeOrNull(profileDraft.full_name) || normalizeOrNull(`${profileDraft.first_name} ${profileDraft.last_name}`),
        first_name: normalizeOrNull(profileDraft.first_name),
        last_name: normalizeOrNull(profileDraft.last_name),
        phone: normalizeTrimOrNull(profileDraft.phone),
        city: normalizeOrNull(profileDraft.city),
        country: normalizeOrNull(profileDraft.country),
        gender: normalizeOrNull(profileDraft.gender),
        age: ageNum != null && Number.isFinite(ageNum) ? ageNum : null,
        club_name: normalizeOrNull(profileDraft.club_name),
        business_email: normalizeTrimOrNull(profileDraft.business_email)?.toLowerCase() ?? null,
        instagram_account: normalizeTrimOrNull(profileDraft.instagram_account),
        organizer_venue_address: normalizeOrNull(profileDraft.organizer_venue_address),
        organizer_fiscal_address: normalizeOrNull(profileDraft.organizer_fiscal_address),
        organizer_postal_code: normalizeTrimOrNull(profileDraft.organizer_postal_code),
        organizer_responsible_name: normalizeOrNull(profileDraft.organizer_responsible_name),
        organizer_responsible_birthdate: normalizeTrimOrNull(profileDraft.organizer_responsible_birthdate),
        organizer_iban: normalizeTrimOrNull(profileDraft.organizer_iban)?.toUpperCase() ?? null,
        updated_at: new Date().toISOString(),
      };

      if (isOrganizer) {
        payload.address = payload.organizer_venue_address;
      }

      const { error } = await supabase.from('profiles').update(payload).eq('id', user.id);
      if (error) throw error;

      if (payload.full_name) {
        try {
          await supabase.auth.updateUser({ data: { full_name: payload.full_name } });
        } catch {}
      }

      if (isOrganizer) {
        setOrganizerMeta((prev) =>
          prev
            ? {
                ...prev,
                club_name: payload.club_name,
                business_email: payload.business_email,
                instagram_account: payload.instagram_account,
                city: payload.city,
                country: payload.country,
                address: payload.address,
                phone: payload.phone,
              }
            : prev
        );
      }

      profileEditInitialKeyRef.current = profileEditKey;
      setProfileEditOpen(false);
      setProfileEditShowIban(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      Alert.alert(t('common.error'), String(e?.message || t('common.error')));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setProfileEditSaving(false);
    }
  }, [isOrganizer, profileDraft, profileEditHasErrors, profileEditKey, profileEditSaving, t, user?.id, validateCityCountry]);

  const requestSaveProfileEdit = useCallback(
    (reason: 'manual' | 'autosave') => {
      if (!profileEditDirty) return;
      if (profileEditHasErrors) return;
      const message =
        reason === 'autosave'
          ? t('profile.edit.autosave_prompt', { defaultValue: 'Tienes cambios sin guardar. ¿Guardar ahora?' })
          : t('profile.edit.save_confirm', { defaultValue: '¿Guardar los cambios de tu perfil?' });
      Alert.alert(
        t('common.confirm', { defaultValue: 'Confirmar' }),
        message,
        [
          { text: t('common.cancel', { defaultValue: 'Cancelar' }), style: 'cancel' },
          { text: t('common.save', { defaultValue: 'Guardar' }), onPress: () => void doSaveProfileEdit() },
        ],
        { cancelable: true }
      );
    },
    [doSaveProfileEdit, profileEditDirty, profileEditHasErrors, t]
  );

  const openLanguagePicker = () => {
    showDialog({
      title: t('profile.change_language'),
      message: '',
      actions: [
        { label: t('profile.language.device'), onPress: () => void setDeviceLanguage(), variant: 'primary' },
        { label: t('profile.language.es'), onPress: () => void setLanguage('es'), variant: 'outline' },
        { label: t('profile.language.en'), onPress: () => void setLanguage('en'), variant: 'outline' },
        { label: t('profile.language.fr'), onPress: () => void setLanguage('fr'), variant: 'outline' },
        { label: t('common.cancel'), variant: 'secondary' },
      ],
    });
  };

  // Shared Values for Animations (Commented out for debugging)
  // const pulseOpacity = useSharedValue(0.5);
  // const pulseScale = useSharedValue(1);
  // const bgTranslateX = useSharedValue(0);
  // const bgTranslateY = useSharedValue(0);

  /* useEffect(() => {
    // Pulse Effect
    pulseOpacity.value = withRepeat(
      withSequence(
        withTiming(0.3, { duration: 3000, easing: Easing.inOut(Easing.ease) }),
        withTiming(0.6, { duration: 3000, easing: Easing.inOut(Easing.ease) })
      ),
      -1,
      true
    );
    pulseScale.value = withRepeat(
      withSequence(
        withTiming(1.05, { duration: 4000, easing: Easing.inOut(Easing.ease) }),
        withTiming(1, { duration: 4000, easing: Easing.inOut(Easing.ease) })
      ),
      -1,
      true
    );
    
    // Background Floating Effect
    bgTranslateX.value = withRepeat(
      withSequence(
        withTiming(20, { duration: 5000, easing: Easing.inOut(Easing.ease) }),
        withTiming(-20, { duration: 5000, easing: Easing.inOut(Easing.ease) })
      ),
      -1,
      true
    );
    bgTranslateY.value = withRepeat(
      withSequence(
        withTiming(-15, { duration: 6000, easing: Easing.inOut(Easing.ease) }),
        withTiming(15, { duration: 6000, easing: Easing.inOut(Easing.ease) })
      ),
      -1,
      true
    );
  }, []); */

  // const animatedGlowStyle = useAnimatedStyle(() => ({
  //   opacity: pulseOpacity.value,
  //   transform: [
  //     { scale: pulseScale.value },
  //     { translateX: bgTranslateX.value },
  //     { translateY: bgTranslateY.value }
  //   ],
  // }));

  // Animation for tab switching
  const handleTabChange = (tab: 'profile' | 'panel' | 'account' | 'resale') => {
    Haptics.selectionAsync();
    // LayoutAnimation can conflict with Reanimated on some devices, removing for stability
    // LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); 
    setActiveTab(tab);
  };

  useEffect(() => {
    if (profileRole === 'organizer' && !inCreator && activeTab === 'profile') {
      setActiveTab('panel');
    }
  }, []);

  // Fetch Profile Stats
  useEffect(() => {
    if (!user?.id) return;

    const fetchStats = async () => {
      setLoadingProfile(true);
      try {
        const { data } = await supabase
          .from('profiles')
          .select('role, verification_status, verification_rejection_reason, club_name, instagram_account, business_email, city, country, address, phone, is_suspended, suspended_reason')
          .eq('id', user.id)
          .single();
        
        if (data) {
          const nextRole = (data.role as any) ?? null;
          setProfileRole(nextRole);
          if (nextRole === 'organizer') {
            setVerificationStatus((data.verification_status as any) ?? null);
            setOrganizerMeta({
              club_name: (data.club_name as any) ?? null,
              instagram_account: (data.instagram_account as any) ?? null,
              business_email: (data.business_email as any) ?? null,
              city: (data.city as any) ?? null,
              country: (data.country as any) ?? null,
              address: (data.address as any) ?? null,
              phone: (data.phone as any) ?? null,
              is_suspended: !!(data.is_suspended as any),
              suspended_reason: (data.suspended_reason as any) ?? null,
              verification_rejection_reason: (data.verification_rejection_reason as any) ?? null,
            });
            const myEvents = await supabase.from('events').select('id').eq('creator_id', user.id);
            const myEventIds = ((myEvents.data ?? []) as any[]).map((e) => e.id).filter(Boolean);
            if (!myEventIds.length) {
              setOrganizerStats({ revenue: 0, tickets: 0 });
              return;
            }

            const [{ data: ticketsRows, error: ticketsError }, { data: vipRows, error: vipErr }] = await Promise.all([
              supabase
                .from('tickets')
                .select('total_price, quantity, event_id, purchase_date, ticket_type_id')
                .in('event_id', myEventIds),
              supabase
                .from('reservados_vip')
                .select('event_id')
                .in('event_id', myEventIds),
            ]);

            if (ticketsError) throw ticketsError;
            if (vipErr) throw vipErr;

            const eventsWithVip = new Set(((vipRows ?? []) as any[]).map((r) => String(r?.event_id || '')).filter(Boolean));
            const parseQty = (value: any): number => {
              if (value == null) return 1;
              const n = Number(value);
              if (!Number.isFinite(n)) return 1;
              if (n <= 0) return 0;
              return n;
            };
            const parsePrice = (value: any): number => {
              if (value == null) return 0;
              const n = Number(value);
              return Number.isFinite(n) ? n : 0;
            };

            const rows = (ticketsRows ?? []) as any[];
            const revenue = rows.reduce((acc, r) => acc + parsePrice(r.total_price), 0);
            const tickets = rows.reduce((acc, r) => {
              const eventId = String(r?.event_id || '');
              const isUntyped = !r?.ticket_type_id;
              if (isUntyped && eventId && eventsWithVip.has(eventId)) return acc + 1;
              return acc + parseQty(r.quantity);
            }, 0);
            setOrganizerStats({ revenue, tickets });
          } else {
            setOrganizerStats({ revenue: 0, tickets: 0 });
            setVerificationStatus(null);
            setOrganizerMeta(null);
          }
        }
      } catch (e) {
        console.error('Error fetching stats:', e);
      } finally {
        setLoadingProfile(false);
      }
    };

    fetchStats();

    const subscription = supabase
      .channel(`profile_stats_${user.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `id=eq.${user.id}` },
        (payload: any) => {
          if (payload.new) {
            const nextRole = (payload.new.role as any) ?? null;
            setProfileRole(nextRole);
            if (nextRole === 'organizer') {
              setVerificationStatus((payload.new.verification_status as any) ?? null);
              setOrganizerMeta({
                club_name: (payload.new.club_name as any) ?? null,
                instagram_account: (payload.new.instagram_account as any) ?? null,
                business_email: (payload.new.business_email as any) ?? null,
                city: (payload.new.city as any) ?? null,
                country: (payload.new.country as any) ?? null,
                address: (payload.new.address as any) ?? null,
                phone: (payload.new.phone as any) ?? null,
                is_suspended: !!(payload.new.is_suspended as any),
                suspended_reason: (payload.new.suspended_reason as any) ?? null,
                verification_rejection_reason: (payload.new.verification_rejection_reason as any) ?? null,
              });
            } else {
              setOrganizerStats({ revenue: 0, tickets: 0 });
              setVerificationStatus(null);
              setOrganizerMeta(null);
            }
          }
        }
      )
      .subscribe();

    return () => {
      subscription.unsubscribe();
    };
  }, [user]);

  useEffect(() => {
    if (!profileRole) return;
    if (profileRole === 'organizer') {
      if (inCreator && activeTab !== 'profile') setActiveTab('profile');
      if (!inCreator && activeTab === 'profile') setActiveTab('panel');
    }
    if (profileRole !== 'organizer' && activeTab === 'panel') setActiveTab('profile');
    if (profileRole === 'organizer' && activeTab === 'account') return;
    if (profileRole !== 'organizer' && activeTab === 'account') setActiveTab('profile');
  }, [profileRole, activeTab, inCreator]);

  const myOrganizerEvents = useMemo(() => {
    if (!user?.id) return [];
    return events.filter((e) => e.creatorId === user.id);
  }, [events, user?.id]);

  const upcomingOrganizerEvents = useMemo(() => {
    const now = Date.now();
    return [...myOrganizerEvents]
      .map((e) => {
        const starts = e.startsAt ? new Date(e.startsAt).getTime() : new Date(`${e.date}T${e.time}`).getTime();
        return { e, starts };
      })
      .filter((x) => Number.isFinite(x.starts) && x.starts >= now)
      .sort((a, b) => a.starts - b.starts)
      .slice(0, 3)
      .map((x) => x.e);
  }, [myOrganizerEvents]);

  // Fetch Resale Listings
  const fetchResales = useCallback(async () => {
    if (!user) return;
    try {
      setLoadingResales(true);
      const { data, error } = await supabase
        .from('resale_listings')
        .select(`
          *,
          tickets (
            *,
            events (
              id,
              title,
              event_date,
              description,
              poster_url
            )
          )
        `)
        .eq('seller_id', user.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setResaleListings(data || []);
    } catch (error) {
      console.error('Error fetching resales:', error);
    } finally {
      setLoadingResales(false);
      setRefreshing(false);
    }
  }, [user]);

  const scheduleResaleRefresh = useCallback(() => {
    if (!user) return;
    if (resaleRefreshTimeoutRef.current) clearTimeout(resaleRefreshTimeoutRef.current);
    resaleRefreshTimeoutRef.current = setTimeout(() => {
      fetchResales();
    }, 250);
  }, [fetchResales, user]);

  useEffect(() => {
    if (!user) return;

    const channel = supabase
      .channel(`profile_resales_${user.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'resale_listings', filter: `seller_id=eq.${user.id}` },
        () => scheduleResaleRefresh()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
      if (resaleRefreshTimeoutRef.current) {
        clearTimeout(resaleRefreshTimeoutRef.current);
        resaleRefreshTimeoutRef.current = null;
      }
    };
  }, [scheduleResaleRefresh, user]);

  useEffect(() => {
    if (activeTab === 'resale') {
      fetchResales();
    }
  }, [activeTab, fetchResales]);

  const onRefresh = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setRefreshing(true);
    if (activeTab === 'resale') {
      fetchResales();
    } else {
      refreshEvents()
        .catch(() => null)
        .finally(() => setRefreshing(false));
    }
  }, [activeTab, fetchResales, refreshEvents]);

  useEffect(() => {
    if (!profileEditOpen) return;
    if (!profileEditAutoSave) return;
    if (!profileEditDirty) return;
    if (profileEditHasErrors) return;
    if (profileEditAutoSaveTimerRef.current) clearTimeout(profileEditAutoSaveTimerRef.current);
    profileEditAutoSaveTimerRef.current = setTimeout(() => {
      if (!profileEditOpen) return;
      if (!profileEditAutoSave) return;
      if (!profileEditDirty) return;
      if (profileEditHasErrors) return;
      if (profileEditLastPromptKeyRef.current === profileEditKey) return;
      profileEditLastPromptKeyRef.current = profileEditKey;
      requestSaveProfileEdit('autosave');
    }, 1200);
    return () => {
      if (profileEditAutoSaveTimerRef.current) clearTimeout(profileEditAutoSaveTimerRef.current);
      profileEditAutoSaveTimerRef.current = null;
    };
  }, [profileEditAutoSave, profileEditDirty, profileEditHasErrors, profileEditKey, profileEditOpen, requestSaveProfileEdit]);

  const handleCancelResale = async (_listingId: string, ticketId: string) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    showDialog({
      title: t('tickets.cancel_sale_title'),
      message: t('tickets.cancel_sale_body'),
      actions: [
        { label: t('common.no'), variant: 'outline' },
        {
          label: t('tickets.cancel_sale_confirm'),
          variant: 'primary',
          onPress: async () => {
            try {
              setIsCancelling(true);

              if (!ticketId) throw new Error(t('profile.resale.invalid_ticket'));

              const { error } = await supabase.rpc('cancel_resale_listing_secure', {
                p_ticket_id: ticketId,
              });

              if (error) throw error;

              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              fetchResales();
            } catch (error: any) {
              console.error('Cancel Resale Error:', error);
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
              showDialog({ title: t('common.error'), message: t('tickets.cancel_sale_error') });
            } finally {
              setIsCancelling(false);
            }
          },
        },
      ],
    });
  };

  const handleSignOut = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (Platform.OS === 'web') {
      try {
        await signOut();
        router.replace('/(auth)/login');
      } catch (error) {
        console.error('Error signing out:', error);
        router.replace('/(auth)/login');
      }
    } else {
      showDialog({
        title: t('profile.logout'),
        message: t('profile.logout_confirm'),
        actions: [
          { label: t('common.cancel'), variant: 'outline' },
          {
            label: t('profile.logout'),
            variant: 'secondary',
            onPress: async () => {
              try {
                await signOut();
                router.replace('/(auth)/login');
              } catch {
                showDialog({ title: t('common.error'), message: t('profile.logout_failed') });
              }
            },
          },
        ],
      });
    }
  };

  const handleDeleteAccount = () => {
    if (deletingAccount) return;
    showDialog({
      title: t('profile.delete_account_title'),
      message: t('profile.delete_account_body'),
      actions: [
        { label: t('common.cancel'), variant: 'outline' },
        {
          label: t('profile.delete_account_confirm'),
          variant: 'secondary',
          onPress: async () => {
            try {
              setDeletingAccount(true);
              const { error } = await invokeEdgeFunction('delete-account', {});
              if (error) throw new Error(String(error.message || t('profile.delete_account_failed')));
              await signOut();
              router.replace('/(auth)/login');
            } catch (e: any) {
              showDialog({ title: t('common.error'), message: String(e?.message || t('profile.delete_account_failed')) });
            } finally {
              setDeletingAccount(false);
            }
          },
        },
      ],
    });
  };

  if (!user) {
    return (
      <AuthRequiredScreen
        title={t('tabs.profile')}
        subtitle={t('profile.sign_in_prompt')}
        ctaLabel={t('auth.login')}
        secondaryCtaLabel={t('auth.register')}
        Icon={User}
        variant="resaleCard"
        eyebrow={`ECLIPSE · ${String(t('tabs.profile')).toUpperCase()}`}
      />
    );
  }

  if (loadingProfile) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.dark.background }}>
        <DiscoLoader label="Cargando perfil…" size={160} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />
      {/* Deep Night Apple Gradient Background */}
      <LinearGradient
        colors={[Colors.dark.background, '#1e1b4b']}
        style={StyleSheet.absoluteFill}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      />
      
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          {
            paddingTop: insets.top + 10,
            paddingHorizontal: horizontalPadding,
            paddingBottom: 120, // Add substantial padding for tab bar
          },
        ]}
        refreshControl={
          <RefreshControl
            refreshing={false}
            onRefresh={onRefresh}
            tintColor="transparent"
            colors={['transparent']}
            progressBackgroundColor="transparent"
            progressViewOffset={10000}
            title=""
            titleColor="transparent"
            style={{ opacity: 0, transform: [{ scaleX: 0.01 }, { scaleY: 0.01 }] }}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        {refreshing ? (
          <View style={{ paddingTop: 6, paddingBottom: 10, alignItems: 'center' }}>
            <DiscoLoader size={46} />
          </View>
        ) : null}
        <View style={[styles.perfilContainer, { maxWidth: maxContentWidth, width: '100%' }]}>
          
          <GlassView intensity={14} style={[styles.headerCard, styles.premiumCard]}>
            <View style={styles.headerRow}>
              <View style={styles.avatarRingWrap}>
                <LinearGradient
                  colors={['rgba(124,58,237,0.85)', 'rgba(6,182,212,0.55)', 'rgba(255,255,255,0.10)']}
                  style={styles.avatarRing}
                >
                  <View style={styles.avatarRingInner}>
                    {user.user_metadata?.avatar_url ? (
                      <Image source={{ uri: user.user_metadata.avatar_url }} style={styles.avatarImage} />
                    ) : (
                      <View style={[styles.avatarImage, styles.avatarFallback]}>
                        <Text style={styles.avatarFallbackText}>
                          {(displayName || 'U').charAt(0).toUpperCase()}
                        </Text>
                      </View>
                    )}
                  </View>
                </LinearGradient>
              </View>

              <View style={{ flex: 1 }}>
                <Text style={styles.headerName} numberOfLines={1}>{displayName}</Text>
                <Text style={styles.headerEmail} numberOfLines={1}>{user.email}</Text>
                <View style={styles.headerMetaRow}>
                  <View style={styles.memberBadge}>
                    <Text style={styles.memberBadgeText}>{t('profile.member_since', { year: new Date(user.created_at).getFullYear() })}</Text>
                  </View>
                </View>

                {isOrganizer && isOrganizerSuspended && (
                  <TouchableOpacity
                    activeOpacity={0.85}
                    onPress={() => {
                      showDialog({
                        title: t('profile.organizer.suspended_title'),
                        message: organizerMeta?.suspended_reason ? organizerMeta.suspended_reason : t('profile.organizer.suspended_body'),
                      });
                    }}
                    style={{ marginTop: 10, alignSelf: 'stretch', maxWidth: '100%' }}
                  >
                    <View style={[styles.verificationPill, { backgroundColor: 'rgba(239,68,68,0.12)', borderColor: 'rgba(239,68,68,0.35)' }]}>
                      <ShieldCheck size={14} color="#ef4444" />
                      <Text style={[styles.verificationPillText, { color: '#ef4444' }]} numberOfLines={1}>
                        {t('profile.organizer.suspended_title')}
                      </Text>
                      <ChevronRight size={14} color="rgba(255,255,255,0.55)" />
                    </View>
                  </TouchableOpacity>
                )}

                {profileRole === 'organizer' && !isAdminEmail && (
                  <TouchableOpacity
                    activeOpacity={0.85}
                    onPress={() => {
                      if (verificationStatus === 'verified') return;
                      if (verificationStatus === 'rejected') {
                        const reason = organizerMeta?.verification_rejection_reason?.toString().trim();
                        showDialog({
                          title: t('profile.organizer.verification.rejected_title'),
                          message: reason
                            ? t('profile.organizer.verification.rejected_body_with_reason', { reason })
                            : t('profile.organizer.verification.rejected_body'),
                        });
                        return;
                      }
                      if (verificationStatus === 'needs_correction') {
                        const note = organizerMeta?.verification_rejection_reason?.toString().trim();
                        if (note) {
                          showDialog({
                            title: t('profile.organizer.verification.needs_correction_title'),
                            message: note,
                            actions: [
                              {
                                label: t('profile.organizer.verification.go_to_verification'),
                                onPress: () => router.push('/(creator)/verification'),
                                variant: 'primary',
                              },
                              { label: t('common.cancel'), variant: 'outline' },
                            ],
                          });
                          return;
                        }
                      }
                      router.push('/(creator)/verification');
                    }}
                    disabled={verificationStatus === 'verified'}
                    style={{ marginTop: 10, alignSelf: 'stretch', maxWidth: '100%' }}
                  >
                    <View
                      style={[
                        styles.verificationPill,
                        verificationStatus === 'verified'
                          ? styles.verificationPillVerified
                          : verificationStatus === 'rejected'
                            ? styles.verificationPillRejected
                            : styles.verificationPillPending,
                      ]}
                    >
                      <ShieldCheck size={14} color={verificationStatus === 'verified' ? '#4ade80' : verificationStatus === 'rejected' ? '#fb7185' : '#f59e0b'} />
                      <Text
                        style={[
                          styles.verificationPillText,
                          { color: verificationStatus === 'verified' ? '#4ade80' : verificationStatus === 'rejected' ? '#fb7185' : '#f59e0b' },
                        ]}
                        numberOfLines={1}
                      >
                        {verificationStatus === 'verified'
                          ? t('profile.organizer.verification.status.verified')
                          : verificationStatus === 'needs_correction'
                            ? t('profile.organizer.verification.status.needs_correction')
                            : verificationStatus === 'rejected'
                              ? t('profile.organizer.verification.status.rejected')
                              : t('profile.organizer.verification.status.pending')}
                      </Text>
                      {verificationStatus !== 'verified' && <ChevronRight size={14} color="rgba(255,255,255,0.55)" />}
                    </View>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          </GlassView>

          {/* Floating Segmented Control */}
          {profileRole && !(profileRole === 'organizer' && segments?.[0] === '(creator)') && (
            <View style={styles.segmentedControlContainer}>
              <GlassView intensity={14} style={[styles.segmentedControlCard, styles.premiumCard]}>
                <View style={styles.segmentedControl}>
                {profileRole === 'organizer' ? (
                  <>
                    <TouchableOpacity
                      style={styles.segmentButtonWrapper}
                      onPress={() => handleTabChange('panel')}
                      activeOpacity={0.8}
                    >
                      {activeTab === 'panel' && (
                        <LinearGradient
                          colors={['rgba(124,58,237,0.95)', 'rgba(6,182,212,0.60)']}
                          style={styles.activeSegmentBg}
                        />
                      )}
                      <Text style={[styles.segmentText, activeTab === 'panel' && styles.segmentTextActive]}>{t('profile.segment_panel')}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.segmentButtonWrapper}
                      onPress={() => handleTabChange('profile')}
                      activeOpacity={0.8}
                    >
                      {activeTab === 'profile' && (
                        <LinearGradient
                          colors={['rgba(124,58,237,0.95)', 'rgba(6,182,212,0.60)']}
                          style={styles.activeSegmentBg}
                        />
                      )}
                      <Text style={[styles.segmentText, activeTab === 'profile' && styles.segmentTextActive]}>{t('profile.segment_my_profile')}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.segmentButtonWrapper}
                      onPress={() => handleTabChange('resale')}
                      activeOpacity={0.8}
                    >
                      {activeTab === 'resale' && (
                        <LinearGradient
                          colors={['rgba(124,58,237,0.95)', 'rgba(6,182,212,0.60)']}
                          style={styles.activeSegmentBg}
                        />
                      )}
                      <Text style={[styles.segmentText, activeTab === 'resale' && styles.segmentTextActive]}>{t('tabs.resale')}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.segmentButtonWrapper}
                      onPress={() => handleTabChange('account')}
                      activeOpacity={0.8}
                    >
                      {activeTab === 'account' && (
                        <LinearGradient
                          colors={['rgba(124,58,237,0.95)', 'rgba(6,182,212,0.60)']}
                          style={styles.activeSegmentBg}
                        />
                      )}
                      <Text style={[styles.segmentText, activeTab === 'account' && styles.segmentTextActive]}>{t('profile.segment_account')}</Text>
                    </TouchableOpacity>
                  </>
                ) : (
                  <>
                    <TouchableOpacity 
                  style={styles.segmentButtonWrapper}
                  onPress={() => handleTabChange('profile')}
                  activeOpacity={0.8}
                >
                  {activeTab === 'profile' && (
                    <LinearGradient
                      colors={['rgba(124,58,237,0.95)', 'rgba(6,182,212,0.60)']}
                      style={styles.activeSegmentBg}
                    />
                  )}
                  <Text style={[styles.segmentText, activeTab === 'profile' && styles.segmentTextActive]}>{t('tabs.profile')}</Text>
                </TouchableOpacity>
                <TouchableOpacity 
                  style={styles.segmentButtonWrapper}
                  onPress={() => handleTabChange('resale')}
                  activeOpacity={0.8}
                >
                  {activeTab === 'resale' && (
                    <LinearGradient
                      colors={['rgba(124,58,237,0.95)', 'rgba(6,182,212,0.60)']}
                      style={styles.activeSegmentBg}
                    />
                  )}
                  <Text style={[styles.segmentText, activeTab === 'resale' && styles.segmentTextActive]}>{t('tabs.resale')}</Text>
                </TouchableOpacity>
                  </>
                )}
                </View>
              </GlassView>
            </View>
          )}

          {/* Content */}
          {activeTab !== 'resale' ? (
            <View style={styles.content}>
              
              {profileRole === 'organizer' ? (
                <>
                  {activeTab === 'panel' ? (
                    <>
                      {isOrganizerSuspended && (
                        <GlassView intensity={14} style={[styles.alertCard, styles.premiumCard, { borderColor: 'rgba(239,68,68,0.35)' }]}>
                          <Text style={styles.alertTitle}>{t('profile.organizer.suspended_title')}</Text>
                          <Text style={styles.alertText}>
                            {organizerMeta?.suspended_reason ? organizerMeta.suspended_reason : t('profile.organizer.suspended_body')}
                          </Text>
                        </GlassView>
                      )}

                      {!isOrganizerSuspended && verificationStatus !== 'verified' && (
                        <GlassView intensity={14} style={[styles.alertCard, styles.premiumCard, { borderColor: 'rgba(245,158,11,0.35)' }]}>
                          <Text style={styles.alertTitle}>{t('profile.organizer.verification.pending_title')}</Text>
                          <Text style={styles.alertText}>{t('profile.organizer.verification.pending_body')}</Text>
                          <View style={{ marginTop: 12 }}>
                            <ThemedButton title={t('profile.organizer.verification.go_to_verification')} onPress={() => router.push('/(creator)/verification')} />
                          </View>
                        </GlassView>
                      )}

                      <GlassView intensity={18} style={[styles.organizerHeroCard, styles.premiumCard]}>
                        <LinearGradient
                          colors={['rgba(255,255,255,0.08)', 'rgba(48, 209, 88, 0.16)', 'transparent']}
                          style={StyleSheet.absoluteFill}
                        />
                        <Text style={styles.organizerHeroLabel}>{t('profile.organizer.total_generated')}</Text>
                        <Text style={styles.organizerHeroValue} numberOfLines={1} adjustsFontSizeToFit>
                          {new Intl.NumberFormat(localeTag, { style: 'currency', currency: 'EUR' }).format(Number(organizerStats.revenue) || 0)}
                        </Text>
                      </GlassView>

                      <View style={styles.premiumHeaderRow}>
                        <View style={styles.premiumIconWrap}>
                          <LinearGradient
                            colors={['rgba(124,58,237,0.85)', 'rgba(6,182,212,0.55)', 'rgba(255,255,255,0.10)']}
                            style={styles.premiumIconRing}
                          >
                            <View style={styles.premiumIconInner}>
                              <Sparkles size={16} color="white" />
                            </View>
                          </LinearGradient>
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.premiumTitle}>{t('profile.organizer.actions_title')}</Text>
                          <Text style={styles.premiumSubtitle}>{t('profile.organizer.actions_subtitle')}</Text>
                        </View>
                      </View>
                      <View style={styles.iosGroup}>
                        <GlassView intensity={14} style={[styles.iosGroupContainer, styles.premiumCard]}>
                          <TouchableOpacity
                            activeOpacity={0.75}
                            onPress={() => {
                              if (!canOrganizerPublish) {
                                showDialog({
                                  title: t('profile.organizer.action_unavailable_title'),
                                  message: isOrganizerSuspended
                                    ? t('profile.organizer.action_unavailable_suspended')
                                    : t('profile.organizer.action_unavailable_needs_verification'),
                                });
                                router.push('/(creator)/verification');
                                return;
                              }
                              router.push('/(creator)/create-event');
                            }}
                            style={styles.iosButtonRow}
                          >
                            <View style={[styles.iosIcon, { backgroundColor: '#22c55e' }]}>
                              <Calendar size={16} color="#0B0B0F" />
                            </View>
                            <Text style={styles.iosButtonText}>{t('profile.organizer.menu.create_event')}</Text>
                            <ChevronRight size={16} color="#8E8E93" />
                          </TouchableOpacity>
                          <View style={styles.iosDivider} />
                          <TouchableOpacity activeOpacity={0.75} onPress={() => router.push('/(creator)/manage-events')} style={styles.iosButtonRow}>
                            <View style={[styles.iosIcon, { backgroundColor: '#38bdf8' }]}>
                              <MapPin size={16} color="#0B0B0F" />
                            </View>
                            <Text style={styles.iosButtonText}>{t('profile.organizer.menu.my_events')}</Text>
                            <ChevronRight size={16} color="#8E8E93" />
                          </TouchableOpacity>
                          <View style={styles.iosDivider} />
                          <TouchableOpacity activeOpacity={0.75} onPress={() => router.push('/(creator)/scan')} style={styles.iosButtonRow}>
                            <View style={[styles.iosIcon, { backgroundColor: '#0A84FF' }]}>
                              <QrCode size={16} color="#FFF" />
                            </View>
                            <Text style={styles.iosButtonText}>{t('profile.organizer.menu.scan')}</Text>
                            <ChevronRight size={16} color="#8E8E93" />
                          </TouchableOpacity>
                          <View style={styles.iosDivider} />
                          <TouchableOpacity activeOpacity={0.75} onPress={() => router.push('/(creator)/workers')} style={styles.iosButtonRow}>
                            <View style={[styles.iosIcon, { backgroundColor: '#a855f7' }]}>
                              <UserPlus size={16} color="#FFF" />
                            </View>
                            <Text style={styles.iosButtonText}>{t('profile.organizer.menu.staff')}</Text>
                            <ChevronRight size={16} color="#8E8E93" />
                          </TouchableOpacity>
                          <View style={styles.iosDivider} />
                          <TouchableOpacity activeOpacity={0.75} onPress={() => router.push('/(creator)/stats')} style={styles.iosButtonRow}>
                            <View style={[styles.iosIcon, { backgroundColor: '#30D158' }]}>
                              <TrendingUp size={16} color="#0B0B0F" />
                            </View>
                            <Text style={styles.iosButtonText}>{t('profile.organizer.menu.stats')}</Text>
                            <ChevronRight size={16} color="#8E8E93" />
                          </TouchableOpacity>
                        </GlassView>
                      </View>

                      <View style={styles.premiumHeaderRow}>
                        <View style={styles.premiumIconWrap}>
                          <LinearGradient
                            colors={['rgba(124,58,237,0.85)', 'rgba(6,182,212,0.55)', 'rgba(255,255,255,0.10)']}
                            style={styles.premiumIconRing}
                          >
                            <View style={styles.premiumIconInner}>
                              <Calendar size={16} color="white" />
                            </View>
                          </LinearGradient>
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.premiumTitle}>{t('profile.organizer.upcoming_title')}</Text>
                          <Text style={styles.premiumSubtitle}>{t('profile.organizer.upcoming_subtitle')}</Text>
                        </View>
                      </View>
                      <View style={styles.iosGroup}>
                        <GlassView intensity={14} style={[styles.iosGroupContainer, styles.premiumCard]}>
                          {upcomingOrganizerEvents.length ? (
                            upcomingOrganizerEvents.map((e, idx) => {
                              const total = Math.max(1, (e.sold || 0) + (e.capacity || 0));
                              const pct = Math.round(((e.sold || 0) / total) * 100);
                              return (
                                <View key={e.id}>
                                  <TouchableOpacity
                                    activeOpacity={0.8}
                                    onPress={() => router.push({ pathname: '/(creator)/event-stats/[id]', params: { id: e.id } })}
                                    style={styles.eventRow}
                                  >
                                    <Image source={{ uri: e.imageUrl }} style={styles.eventThumb} />
                                    <View style={{ flex: 1 }}>
                                      <Text style={styles.eventTitle} numberOfLines={1}>{e.title}</Text>
                                      <Text style={styles.eventMeta}>
                                        {e.date} · {e.time} · {t('profile.organizer.sold_pct', { pct })}
                                      </Text>
                                    </View>
                                    <ChevronRight size={16} color="#8E8E93" />
                                  </TouchableOpacity>
                                  {idx < upcomingOrganizerEvents.length - 1 && <View style={styles.iosDivider} />}
                                </View>
                              );
                            })
                          ) : (
                            <View style={{ paddingVertical: 6 }}>
                              <Text style={{ color: 'rgba(255,255,255,0.70)', fontWeight: '700' }}>{t('profile.organizer.no_upcoming_title')}</Text>
                              <Text style={{ color: 'rgba(255,255,255,0.55)', marginTop: 4 }}>
                                {t('profile.organizer.no_upcoming_body')}
                              </Text>
                            </View>
                          )}
                        </GlassView>
                      </View>
                    </>
                  ) : activeTab === 'profile' ? (
                    <>
                      {inCreator ? (
                        <>
                          <GlassView intensity={18} style={[styles.organizerHeroCard, styles.premiumCard]}>
                            <LinearGradient
                              colors={['rgba(255,255,255,0.08)', 'rgba(48, 209, 88, 0.16)', 'transparent']}
                              style={StyleSheet.absoluteFill}
                            />
                            <Text style={styles.organizerHeroLabel}>{t('creator.tabs.stats', { defaultValue: 'Estadísticas' })}</Text>
                            <Text style={styles.organizerHeroValue} numberOfLines={1} adjustsFontSizeToFit>
                              {new Intl.NumberFormat(localeTag, { style: 'currency', currency: 'EUR' }).format(Number(organizerStats.revenue) || 0)}
                            </Text>
                          </GlassView>

                          <View style={styles.iosGroup}>
                            <GlassView intensity={14} style={[styles.iosGroupContainer, styles.premiumCard]}>
                              <View style={styles.iosRow}>
                                <View style={styles.iosLabelContainer}>
                                  <Text style={styles.iosLabel}>{t('profile.organizer.total_generated')}</Text>
                                </View>
                                <View style={styles.iosValueContainer}>
                                  <Text style={styles.iosValue} numberOfLines={1}>
                                    {new Intl.NumberFormat(localeTag, { style: 'currency', currency: 'EUR' }).format(Number(organizerStats.revenue) || 0)}
                                  </Text>
                                </View>
                              </View>
                              <View style={styles.iosDivider} />
                              <View style={styles.iosRow}>
                                <View style={styles.iosLabelContainer}>
                                  <Text style={styles.iosLabel}>{t('creator.organizer.metrics.tickets_sold')}</Text>
                                </View>
                                <View style={styles.iosValueContainer}>
                                  <Text style={styles.iosValue} numberOfLines={1}>{String(organizerStats.tickets || 0)}</Text>
                                </View>
                              </View>
                            </GlassView>
                          </View>

                          <View style={{ marginTop: 12 }}>
                            <ThemedButton title={t('creator.tabs.stats', { defaultValue: 'Estadísticas' })} onPress={() => router.push('/(creator)/stats')} />
                          </View>
                        </>
                      ) : (
                        <>
                          <View style={styles.iosGroup}>
                            <GlassView intensity={14} style={[styles.iosGroupContainer, styles.premiumCard]}>
                              <TouchableOpacity onPress={openProfileEdit} activeOpacity={0.7} style={styles.iosButtonRow}>
                                <View style={[styles.iosIcon, { backgroundColor: '#0A84FF' }]}>
                                  <Pencil size={16} color="#FFF" />
                                </View>
                                <Text style={styles.iosButtonText}>{t('profile.edit_profile')}</Text>
                                <ChevronRight size={16} color="#8E8E93" />
                              </TouchableOpacity>
                            </GlassView>
                          </View>

                          <View style={styles.premiumHeaderRow}>
                            <View style={styles.premiumIconWrap}>
                              <LinearGradient
                                colors={['rgba(124,58,237,0.85)', 'rgba(6,182,212,0.55)', 'rgba(255,255,255,0.10)']}
                                style={styles.premiumIconRing}
                              >
                                <View style={styles.premiumIconInner}>
                                  <Tag size={16} color="white" />
                                </View>
                              </LinearGradient>
                            </View>
                            <View style={{ flex: 1 }}>
                              <Text style={styles.premiumTitle}>{t('profile.organizer.business_title')}</Text>
                              <Text style={styles.premiumSubtitle}>{t('profile.organizer.business_subtitle')}</Text>
                            </View>
                          </View>
                          <View style={styles.iosGroup}>
                            <GlassView intensity={14} style={[styles.iosGroupContainer, styles.premiumCard]}>
                              <View style={styles.iosRow}>
                                <View style={styles.iosLabelContainer}>
                                  <Text style={styles.iosLabel}>{t('profile.organizer.business.club_label')}</Text>
                                </View>
                                <View style={styles.iosValueContainer}>
                                  <Text style={styles.iosValue} numberOfLines={1}>{organizerMeta?.club_name || t('profile.not_specified')}</Text>
                                </View>
                              </View>
                              <View style={styles.iosDivider} />
                              <View style={styles.iosRow}>
                                <View style={styles.iosLabelContainer}>
                                  <Text style={styles.iosLabel}>{t('profile.organizer.business.business_email_label')}</Text>
                                </View>
                                <View style={styles.iosValueContainer}>
                                  <Text style={styles.iosValue} numberOfLines={1}>{organizerMeta?.business_email || t('profile.not_specified')}</Text>
                                </View>
                              </View>
                              <View style={styles.iosDivider} />
                              <View style={styles.iosRow}>
                                <View style={styles.iosLabelContainer}>
                                  <Text style={styles.iosLabel}>{t('profile.organizer.business.instagram_label')}</Text>
                                </View>
                                <View style={styles.iosValueContainer}>
                                  <Text style={styles.iosValue} numberOfLines={1}>{organizerMeta?.instagram_account || t('profile.not_specified')}</Text>
                                </View>
                              </View>
                              <View style={styles.iosDivider} />
                              <View style={styles.iosRow}>
                                <View style={styles.iosLabelContainer}>
                                  <Text style={styles.iosLabel}>{t('profile.location_label')}</Text>
                                </View>
                                <View style={styles.iosValueContainer}>
                                  <Text style={styles.iosValue} numberOfLines={1}>
                                    {[organizerMeta?.city, organizerMeta?.country].filter(Boolean).join(', ') || t('profile.not_specified')}
                                  </Text>
                                </View>
                              </View>
                              <View style={styles.iosDivider} />
                              <View style={styles.iosRow}>
                                <View style={styles.iosLabelContainer}>
                                  <Text style={styles.iosLabel}>{t('profile.address_label')}</Text>
                                </View>
                                <View style={styles.iosValueContainer}>
                                  <Text style={styles.iosValue} numberOfLines={2}>{(organizerMeta?.address as any) || t('profile.not_specified')}</Text>
                                </View>
                              </View>
                              <View style={styles.iosDivider} />
                              <View style={styles.iosRow}>
                                <View style={styles.iosLabelContainer}>
                                  <Text style={styles.iosLabel}>{t('profile.phone_label')}</Text>
                                </View>
                                <View style={styles.iosValueContainer}>
                                  <Text style={styles.iosValue} numberOfLines={1}>{(organizerMeta?.phone as any) || t('profile.not_specified')}</Text>
                                </View>
                              </View>
                            </GlassView>
                          </View>
                        </>
                      )}
                    </>
                  ) : (
                    <>
                      <View style={styles.iosGroup}>
                        <GlassView intensity={14} style={[styles.iosGroupContainer, styles.premiumCard]}>
                          <TouchableOpacity onPress={() => router.push('/(creator)/verification')} activeOpacity={0.7} style={styles.iosButtonRow}>
                            <View style={[styles.iosIcon, { backgroundColor: '#F59E0B' }]}>
                              <ShieldCheck size={16} color="#000" />
                            </View>
                            <Text style={styles.iosButtonText}>{t('profile.organizer.settings.verification_payments')}</Text>
                            <ChevronRight size={16} color="#8E8E93" />
                          </TouchableOpacity>
                          <View style={styles.iosDivider} />
                          <TouchableOpacity onPress={openLanguagePicker} activeOpacity={0.7} style={styles.iosButtonRow}>
                            <View style={[styles.iosIcon, { backgroundColor: '#a78bfa' }]}>
                              <User size={16} color="#000" />
                            </View>
                            <Text style={styles.iosButtonText}>{t('profile.change_language')}</Text>
                            <Text style={[styles.iosValue, { marginRight: 8 }]}>{language.toUpperCase()}</Text>
                            <ChevronRight size={16} color="#8E8E93" />
                          </TouchableOpacity>
                          <View style={styles.iosDivider} />
                          <TouchableOpacity onPress={() => router.push('/notification-preferences')} activeOpacity={0.7} style={styles.iosButtonRow}>
                            <View style={[styles.iosIcon, { backgroundColor: '#60a5fa' }]}>
                              <Sparkles size={16} color="#000" />
                            </View>
                            <Text style={styles.iosButtonText}>{t('profile.notification_preferences')}</Text>
                            <ChevronRight size={16} color="#8E8E93" />
                          </TouchableOpacity>
                          <View style={styles.iosDivider} />
                          <TouchableOpacity onPress={() => router.push('/notifications')} activeOpacity={0.7} style={styles.iosButtonRow}>
                            <View style={[styles.iosIcon, { backgroundColor: '#22c55e' }]}>
                              <Clock size={16} color="#000" />
                            </View>
                            <Text style={styles.iosButtonText}>{t('profile.notification_center')}</Text>
                            <ChevronRight size={16} color="#8E8E93" />
                          </TouchableOpacity>
                          <View style={styles.iosDivider} />
                          <TouchableOpacity onPress={() => router.push('/legal')} activeOpacity={0.7} style={styles.iosButtonRow}>
                            <View style={[styles.iosIcon, { backgroundColor: '#34d399' }]}>
                              <FileText size={16} color="#000" />
                            </View>
                            <Text style={styles.iosButtonText}>{t('profile.legal_info')}</Text>
                            <ChevronRight size={16} color="#8E8E93" />
                          </TouchableOpacity>
                          <View style={styles.iosDivider} />
                          <TouchableOpacity onPress={handleSignOut} activeOpacity={0.7} style={styles.iosButtonRow}>
                            <View style={[styles.iosIcon, { backgroundColor: '#ef4444' }]}>
                              <LogOut size={16} color="#FFF" />
                            </View>
                            <Text style={styles.iosButtonText}>{t('profile.logout')}</Text>
                            <ChevronRight size={16} color="#8E8E93" />
                          </TouchableOpacity>
                        </GlassView>
                      </View>
                    </>
                  )}
                </>
              ) : (
                <>
                  <Text style={styles.sectionHeader}>{t('profile.section_account')}</Text>
                  <View style={styles.iosGroup}>
                    <GlassView intensity={14} style={[styles.iosGroupContainer, styles.premiumCard]}>
                      <View style={styles.iosRow}>
                        <View style={styles.iosLabelContainer}>
                          <Text style={styles.iosLabel}>{t('profile.name')}</Text>
                        </View>
                        <View style={styles.iosValueContainer}>
                          <Text style={styles.iosValue}>{user.user_metadata?.full_name || t('profile.not_specified')}</Text>
                        </View>
                      </View>
                      <View style={styles.iosDivider} />
                      <View style={styles.iosRow}>
                        <View style={styles.iosLabelContainer}>
                          <Text style={styles.iosLabel}>{t('profile.email')}</Text>
                        </View>
                        <View style={styles.iosValueContainer}>
                          <Text style={styles.iosValue} numberOfLines={1}>{user.email}</Text>
                        </View>
                      </View>
                      <View style={styles.iosDivider} />
                      <TouchableOpacity onPress={openProfileEdit} activeOpacity={0.7} style={styles.iosButtonRow}>
                        <View style={[styles.iosIcon, { backgroundColor: '#0A84FF' }]}>
                          <Pencil size={16} color="#FFF" />
                        </View>
                        <Text style={styles.iosButtonText}>{t('profile.edit_profile')}</Text>
                        <ChevronRight size={16} color="#8E8E93" />
                      </TouchableOpacity>
                    </GlassView>
                  </View>

                  <Text style={styles.sectionHeader}>{t('profile.section_management')}</Text>
                  <View style={styles.iosGroup}>
                    <GlassView intensity={14} style={[styles.iosGroupContainer, styles.premiumCard]}>
                      <TouchableOpacity onPress={() => router.push('/wallet')} activeOpacity={0.7} style={styles.iosButtonRow}>
                        <View style={[styles.iosIcon, { backgroundColor: '#FFD60A' }]}>
                          <Wallet size={16} color="#000" />
                        </View>
                        <Text style={styles.iosButtonText}>{t('profile.wallet')}</Text>
                        <ChevronRight size={16} color="#8E8E93" />
                      </TouchableOpacity>
                      <View style={styles.iosDivider} />
                      <TouchableOpacity onPress={() => router.push('/(tabs)/tickets')} activeOpacity={0.7} style={styles.iosButtonRow}>
                        <View style={[styles.iosIcon, { backgroundColor: '#BF5AF2' }]}>
                          <Ticket size={16} color="#FFF" />
                        </View>
                        <Text style={styles.iosButtonText}>{t('tickets.my_tickets')}</Text>
                        <ChevronRight size={16} color="#8E8E93" />
                      </TouchableOpacity>
                      <View style={styles.iosDivider} />
                      <TouchableOpacity onPress={() => router.push('/notification-preferences')} activeOpacity={0.7} style={styles.iosButtonRow}>
                        <View style={[styles.iosIcon, { backgroundColor: '#60a5fa' }]}>
                          <Sparkles size={16} color="#000" />
                        </View>
                        <Text style={styles.iosButtonText}>{t('profile.notification_preferences')}</Text>
                        <ChevronRight size={16} color="#8E8E93" />
                      </TouchableOpacity>
                      <View style={styles.iosDivider} />
                      <TouchableOpacity onPress={() => router.push('/notifications')} activeOpacity={0.7} style={styles.iosButtonRow}>
                        <View style={[styles.iosIcon, { backgroundColor: '#22c55e' }]}>
                          <Clock size={16} color="#000" />
                        </View>
                        <Text style={styles.iosButtonText}>{t('profile.notification_center')}</Text>
                        <ChevronRight size={16} color="#8E8E93" />
                      </TouchableOpacity>
                      <View style={styles.iosDivider} />
                      <TouchableOpacity onPress={() => router.push('/legal')} activeOpacity={0.7} style={styles.iosButtonRow}>
                        <View style={[styles.iosIcon, { backgroundColor: '#34d399' }]}>
                          <FileText size={16} color="#000" />
                        </View>
                        <Text style={styles.iosButtonText}>{t('profile.legal_info')}</Text>
                        <ChevronRight size={16} color="#8E8E93" />
                      </TouchableOpacity>
                      {profileRole === 'admin' && (
                        <>
                          <View style={styles.iosDivider} />
                          <TouchableOpacity onPress={() => router.push('/(creator)/admin-verification')} activeOpacity={0.7} style={styles.iosButtonRow}>
                            <View style={[styles.iosIcon, { backgroundColor: '#F59E0B' }]}>
                              <ShieldCheck size={16} color="#000" />
                            </View>
                            <Text style={styles.iosButtonText}>{t('profile.review_organizers')}</Text>
                            <ChevronRight size={16} color="#8E8E93" />
                          </TouchableOpacity>
                        </>
                      )}
                    </GlassView>
                  </View>
                </>
              )}

              {/* Worker Options (if applicable) */}
              {workerProfile && (
                <>
                  <Text style={styles.sectionHeader}>{t('profile.section_staff')}</Text>
                  <View style={styles.iosGroup}>
                    <GlassView intensity={14} style={[styles.iosGroupContainer, styles.premiumCard]}>
                       <TouchableOpacity onPress={() => router.push('/(worker)')} activeOpacity={0.7} style={styles.iosButtonRow}>
                        <View style={[styles.iosIcon, { backgroundColor: '#0A84FF' }]}>
                          <QrCode size={16} color="#FFF" />
                        </View>
                        <Text style={styles.iosButtonText}>{t('profile.scan_tickets')}</Text>
                        <ChevronRight size={16} color="#8E8E93" />
                      </TouchableOpacity>
                    </GlassView>
                  </View>
                </>
              )}

              <View style={styles.logoutContainer}>
                <TouchableOpacity
                  style={[
                    styles.logoutButton,
                    {
                      backgroundColor: 'rgba(239,68,68,0.22)',
                      borderColor: 'rgba(239,68,68,0.55)',
                      borderWidth: 1,
                      borderRadius: 14,
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 10,
                    },
                  ]}
                  onPress={handleDeleteAccount}
                  disabled={deletingAccount}
                >
                   <Text style={[styles.logoutText, { color: '#fff' }]}>
                     {deletingAccount ? t('profile.deleting') : t('profile.delete_my_account')}
                   </Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.logoutButton} onPress={handleSignOut}>
                   <Text style={styles.logoutText}>{t('profile.logout')}</Text>
                </TouchableOpacity>
                <Text style={styles.versionText}>Eclipse v1.0.0 (Beta)</Text>
              </View>

            </View>
          ) : (
            <View style={styles.content}>
               {/* Resale Tab Content for Profile (User's Listings) */}
               {loadingResales ? (
                 <View style={{ padding: 40, alignItems: 'center' }}>
                   <DiscoLoader label={t('profile.resale.loading_title')} subLabel={t('profile.resale.loading_subtitle')} size={130} />
                 </View>
               ) : (
                 <View style={{ gap: 24, paddingBottom: 40 }}>
                    {/* Active Listings */}
                    <View>
                      <View style={[styles.premiumHeaderRow, { marginTop: 0 }]}>
                        <View style={styles.premiumIconWrap}>
                          <LinearGradient
                            colors={['rgba(124,58,237,0.85)', 'rgba(6,182,212,0.55)', 'rgba(255,255,255,0.10)']}
                            style={styles.premiumIconRing}
                          >
                            <View style={styles.premiumIconInner}>
                              <Tag size={16} color="white" />
                            </View>
                          </LinearGradient>
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.premiumTitle}>{t('profile.resale.active_title')}</Text>
                          <Text style={styles.premiumSubtitle}>{t('profile.resale.active_subtitle')}</Text>
                        </View>
                      </View>
                      {activeListings.length > 0 ? (
                        activeListings.map((listing) => (
                           <View key={listing.id} style={styles.resaleItem}>
                              <GlassView intensity={14} style={[styles.resaleCard, styles.premiumCard]}>
                                 <TouchableOpacity
                                   activeOpacity={0.85}
                                   disabled={!listing.tickets?.events?.id}
                                   onPress={() => {
                                     const eventId = listing.tickets?.events?.id;
                                     if (!eventId) return;
                                     router.push(`/(tabs)/event/${eventId}`);
                                   }}
                                   style={styles.resaleHeader}
                                 >
                                    <View>
                                      <Text style={styles.resaleEventTitle}>{listing.tickets?.events?.title || t('home.unknown_event')}</Text>
                                      <Text style={styles.resaleDate}>
                                        {listing.tickets?.events?.event_date ? new Date(listing.tickets.events.event_date).toLocaleDateString(localeTag, { year: 'numeric', month: 'short', day: 'numeric' }) : t('profile.unknown_date')}
                                      </Text>
                                    </View>
                                    <View style={styles.resalePriceTag}>
                                      <Text style={styles.resalePrice}>{listing.price}€</Text>
                                    </View>
                                 </TouchableOpacity>
                                 <View style={styles.resaleActions}>
                                    <TouchableOpacity 
                                      style={styles.cancelButton}
                                      onPress={() => handleCancelResale(listing.id, listing.ticket_id)}
                                      disabled={isCancelling}
                                    >
                                       <Text style={styles.cancelButtonText}>{t('profile.resale.withdraw')}</Text>
                                    </TouchableOpacity>
                                 </View>
                              </GlassView>
                           </View>
                        ))
                      ) : (
                        <View style={styles.emptyResaleState}>
                          <GlassView intensity={14} style={[styles.emptyResaleCard, styles.premiumCard]}>
                            <View style={styles.emptyResaleIcon}>
                              <Tag size={28} color="#8E8E93" />
                            </View>
                            <Text style={styles.emptyResaleText}>{t('profile.resale.empty_active')}</Text>
                          </GlassView>
                        </View>
                      )}
                    </View>

                    {/* Sold Listings */}
                    <View>
                      <View style={[styles.premiumHeaderRow, { marginTop: 0 }]}>
                        <View style={styles.premiumIconWrap}>
                          <LinearGradient
                            colors={['rgba(124,58,237,0.85)', 'rgba(6,182,212,0.55)', 'rgba(255,255,255,0.10)']}
                            style={styles.premiumIconRing}
                          >
                            <View style={styles.premiumIconInner}>
                              <CheckCircle2 size={16} color="white" />
                            </View>
                          </LinearGradient>
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.premiumTitle}>{t('profile.resale.sold_title')}</Text>
                          <Text style={styles.premiumSubtitle}>{t('profile.resale.sold_subtitle')}</Text>
                        </View>
                      </View>
                      {soldListings.length > 0 ? (
                        soldListings.map((listing) => (
                           <View key={listing.id} style={styles.resaleItem}>
                              <GlassView intensity={14} style={[styles.resaleCard, styles.premiumCard, { borderColor: 'rgba(48, 209, 88, 0.3)' }]}>
                                 <TouchableOpacity
                                   activeOpacity={0.85}
                                   disabled={!listing.tickets?.events?.id}
                                   onPress={() => {
                                     const eventId = listing.tickets?.events?.id;
                                     if (!eventId) return;
                                     router.push(`/(tabs)/event/${eventId}`);
                                   }}
                                   style={styles.resaleHeader}
                                 >
                                    <View>
                                      <Text style={styles.resaleEventTitle}>{listing.tickets?.events?.title || t('home.unknown_event')}</Text>
                                      <Text style={styles.resaleDate}>
                                        {listing.tickets?.events?.event_date ? new Date(listing.tickets.events.event_date).toLocaleDateString(localeTag, { year: 'numeric', month: 'short', day: 'numeric' }) : t('profile.unknown_date')}
                                      </Text>
                                    </View>
                                    <View style={[styles.resalePriceTag, { backgroundColor: '#30D158' }]}>
                                      <Text style={[styles.resalePrice, { color: '#FFF' }]}>{listing.price}€</Text>
                                    </View>
                                 </TouchableOpacity>
                                 <View style={[styles.resaleActions, { borderTopColor: 'rgba(48, 209, 88, 0.1)', flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }]}>
                                    <CheckCircle2 size={16} color="#30D158" />
                                    <Text style={{ color: '#30D158', fontWeight: '600', fontSize: 13 }}>{t('profile.resale.sold_badge')}</Text>
                                 </View>
                              </GlassView>
                           </View>
                        ))
                      ) : (
                        <View style={styles.emptyResaleState}>
                          <GlassView intensity={14} style={[styles.emptyResaleCard, styles.premiumCard]}>
                            <View style={styles.emptyResaleIcon}>
                              <Tag size={28} color="#8E8E93" />
                            </View>
                            <Text style={styles.emptyResaleText}>{t('profile.resale.empty_sold')}</Text>
                          </GlassView>
                        </View>
                      )}
                    </View>
                 </View>
               )}
            </View>
          )}
        </View>
      </ScrollView>

      <Modal visible={profileEditOpen} transparent animationType="fade" onRequestClose={closeProfileEdit}>
        <View style={styles.modalBackdrop}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={{ width: '100%', maxWidth: 560, alignSelf: 'center' }}
          >
            <GlassView
              intensity={14}
              style={[styles.modalCard, styles.premiumCard, { maxHeight: profileEditModalHeight, paddingBottom: insets.bottom + 12 }]}
              contentContainerStyle={{ flex: 1 }}
            >
              <View style={styles.modalHeaderRow}>
                <TouchableOpacity onPress={closeProfileEdit} style={styles.modalCancel}>
                  <Text style={styles.modalCancelText}>{t('common.cancel', { defaultValue: 'Cancelar' })}</Text>
                </TouchableOpacity>
                <Text style={styles.modalTitle}>{t('profile.edit.title', { defaultValue: 'Editar perfil' })}</Text>
                <TouchableOpacity onPress={closeProfileEdit} style={styles.modalClose} accessibilityLabel={t('common.cancel', { defaultValue: 'Cerrar' })}>
                  <X size={18} color="white" />
                </TouchableOpacity>
              </View>

              {profileEditLoading ? (
                <View style={{ paddingVertical: 24, alignItems: 'center' }}>
                  <DiscoLoader label={t('common.loading')} size={90} />
                </View>
              ) : (
                <>
                  <ScrollView
                    style={{ flex: 1 }}
                    contentContainerStyle={{ paddingBottom: 16 }}
                    keyboardShouldPersistTaps="handled"
                    keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'none'}
                    showsVerticalScrollIndicator={false}
                  >
                    <Text style={styles.modalSectionTitle}>{t('profile.edit.sections.account', { defaultValue: 'Cuenta' })}</Text>
                    <View style={styles.modalField}>
                      <Text style={styles.modalLabel}>{t('profile.email')}</Text>
                      <View style={[styles.modalInput, { justifyContent: 'center' }]}>
                        <Text style={{ color: 'rgba(255,255,255,0.85)', fontWeight: '800' }} numberOfLines={1}>
                          {user?.email || ''}
                        </Text>
                      </View>
                    </View>

                    <Text style={styles.modalSectionTitle}>{t('profile.edit.sections.personal', { defaultValue: 'Datos personales' })}</Text>
                    <View style={styles.modalField}>
                      <Text style={styles.modalLabel}>{t('profile.edit.fields.full_name', { defaultValue: 'Nombre visible' })}</Text>
                      <TextInput
                        value={profileDraft.full_name}
                        onChangeText={(v) => setProfileField('full_name', v)}
                        placeholder={t('profile.edit.placeholders.full_name', { defaultValue: 'Tu nombre' })}
                        placeholderTextColor="rgba(255,255,255,0.4)"
                        style={[styles.modalInput, profileEditTouched.full_name && profileEditErrors.full_name ? styles.modalInputError : null]}
                        editable={!profileEditSaving}
                        autoCorrect={false}
                        autoCapitalize="words"
                      />
                      {profileEditTouched.full_name && profileEditErrors.full_name ? <Text style={styles.modalErrorText}>{profileEditErrors.full_name}</Text> : null}
                    </View>

                    <View style={styles.modalFieldRow}>
                      <View style={[styles.modalField, { flex: 1 }]}>
                        <Text style={styles.modalLabel}>{t('profile.edit.fields.first_name', { defaultValue: 'Nombre' })}</Text>
                        <TextInput
                          value={profileDraft.first_name}
                          onChangeText={(v) => setProfileField('first_name', v)}
                          placeholder={t('profile.edit.placeholders.first_name', { defaultValue: 'Nombre' })}
                          placeholderTextColor="rgba(255,255,255,0.4)"
                          style={[styles.modalInput, profileEditTouched.first_name && profileEditErrors.first_name ? styles.modalInputError : null]}
                        />
                        {profileEditTouched.first_name && profileEditErrors.first_name ? <Text style={styles.modalErrorText}>{profileEditErrors.first_name}</Text> : null}
                      </View>
                      <View style={[styles.modalField, { flex: 1 }]}>
                        <Text style={styles.modalLabel}>{t('profile.edit.fields.last_name', { defaultValue: 'Apellidos' })}</Text>
                        <TextInput
                          value={profileDraft.last_name}
                          onChangeText={(v) => setProfileField('last_name', v)}
                          placeholder={t('profile.edit.placeholders.last_name', { defaultValue: 'Apellidos' })}
                          placeholderTextColor="rgba(255,255,255,0.4)"
                          style={[styles.modalInput, profileEditTouched.last_name && profileEditErrors.last_name ? styles.modalInputError : null]}
                        />
                        {profileEditTouched.last_name && profileEditErrors.last_name ? <Text style={styles.modalErrorText}>{profileEditErrors.last_name}</Text> : null}
                      </View>
                    </View>

                    <View style={styles.modalFieldRow}>
                      <View style={[styles.modalField, { flex: 1 }]}>
                        <Text style={styles.modalLabel}>{t('profile.edit.fields.gender', { defaultValue: 'Género' })}</Text>
                        <TextInput
                          value={profileDraft.gender}
                          onChangeText={(v) => setProfileField('gender', v)}
                          placeholder={t('profile.edit.placeholders.gender', { defaultValue: 'Opcional' })}
                          placeholderTextColor="rgba(255,255,255,0.4)"
                          style={[styles.modalInput, profileEditTouched.gender && profileEditErrors.gender ? styles.modalInputError : null]}
                        />
                        {profileEditTouched.gender && profileEditErrors.gender ? <Text style={styles.modalErrorText}>{profileEditErrors.gender}</Text> : null}
                      </View>
                      <View style={[styles.modalField, { flex: 1 }]}>
                        <Text style={styles.modalLabel}>{t('profile.edit.fields.age', { defaultValue: 'Edad' })}</Text>
                        <TextInput
                          value={profileDraft.age}
                          onChangeText={(v) => setProfileField('age', v)}
                          placeholder={t('profile.edit.placeholders.age', { defaultValue: 'Opcional' })}
                          placeholderTextColor="rgba(255,255,255,0.4)"
                          keyboardType="number-pad"
                          style={[styles.modalInput, profileEditTouched.age && profileEditErrors.age ? styles.modalInputError : null]}
                        />
                        {profileEditTouched.age && profileEditErrors.age ? <Text style={styles.modalErrorText}>{profileEditErrors.age}</Text> : null}
                      </View>
                    </View>

                    <Text style={styles.modalSectionTitle}>{t('profile.edit.sections.contact', { defaultValue: 'Contacto' })}</Text>
                    <View style={styles.modalField}>
                      <Text style={styles.modalLabel}>{t('profile.phone_label')}</Text>
                      <TextInput
                        value={profileDraft.phone}
                        onChangeText={(v) => setProfileField('phone', v)}
                        placeholder={t('profile.edit.placeholders.phone', { defaultValue: '+34…' })}
                        placeholderTextColor="rgba(255,255,255,0.4)"
                        keyboardType="phone-pad"
                        style={[styles.modalInput, profileEditTouched.phone && profileEditErrors.phone ? styles.modalInputError : null]}
                      />
                      {profileEditTouched.phone && profileEditErrors.phone ? <Text style={styles.modalErrorText}>{profileEditErrors.phone}</Text> : null}
                    </View>
                    <View style={styles.modalFieldRow}>
                      <View style={[styles.modalField, { flex: 1 }]}>
                        <Text style={styles.modalLabel}>{t('profile.edit.fields.city')}</Text>
                        <TextInput
                          value={profileDraft.city}
                          onChangeText={(v) => setProfileField('city', v)}
                          onBlur={() => {
                            setProfileEditTouched((p) => ({ ...p, city: true, country: true }));
                            void validateCityCountry();
                          }}
                          placeholder={t('profile.edit.placeholders.city', { defaultValue: 'Ciudad' })}
                          placeholderTextColor="rgba(255,255,255,0.4)"
                          style={[
                            styles.modalInput,
                            profileEditTouched.city && (profileEditErrors.city || profileEditAsyncErrors.city) ? styles.modalInputError : null,
                          ]}
                        />
                        {profileEditTouched.city && (profileEditErrors.city || profileEditAsyncErrors.city) ? (
                          <Text style={styles.modalErrorText}>{profileEditErrors.city || profileEditAsyncErrors.city}</Text>
                        ) : null}
                      </View>
                      <View style={[styles.modalField, { flex: 1 }]}>
                        <Text style={styles.modalLabel}>{t('profile.edit.fields.country', { defaultValue: 'País' })}</Text>
                        <TextInput
                          value={profileDraft.country}
                          onChangeText={(v) => setProfileField('country', v)}
                          onBlur={() => {
                            setProfileEditTouched((p) => ({ ...p, city: true, country: true }));
                            void validateCityCountry();
                          }}
                          placeholder={t('profile.edit.placeholders.country', { defaultValue: 'País' })}
                          placeholderTextColor="rgba(255,255,255,0.4)"
                          style={[
                            styles.modalInput,
                            profileEditTouched.country && (profileEditErrors.country || profileEditAsyncErrors.country) ? styles.modalInputError : null,
                          ]}
                        />
                        {profileEditTouched.country && (profileEditErrors.country || profileEditAsyncErrors.country) ? (
                          <Text style={styles.modalErrorText}>{profileEditErrors.country || profileEditAsyncErrors.country}</Text>
                        ) : null}
                      </View>
                    </View>

                    {isOrganizer ? (
                      <>
                        <Text style={styles.modalSectionTitle}>{t('profile.edit.sections.organizer', { defaultValue: 'Organizador' })}</Text>
                        <View style={styles.modalField}>
                          <Text style={styles.modalLabel}>{t('profile.edit.fields.club_name', { defaultValue: 'Nombre del local' })}</Text>
                          <TextInput
                            value={profileDraft.club_name}
                            onChangeText={(v) => setProfileField('club_name', v)}
                            placeholder={t('profile.edit.placeholders.club_name', { defaultValue: 'Nombre del local' })}
                            placeholderTextColor="rgba(255,255,255,0.4)"
                            style={[styles.modalInput, profileEditTouched.club_name && profileEditErrors.club_name ? styles.modalInputError : null]}
                          />
                          {profileEditTouched.club_name && profileEditErrors.club_name ? <Text style={styles.modalErrorText}>{profileEditErrors.club_name}</Text> : null}
                        </View>
                        <View style={styles.modalFieldRow}>
                          <View style={[styles.modalField, { flex: 1 }]}>
                            <Text style={styles.modalLabel}>{t('profile.edit.fields.business_email', { defaultValue: 'Email de negocio' })}</Text>
                            <TextInput
                              value={profileDraft.business_email}
                              onChangeText={(v) => setProfileField('business_email', v)}
                              placeholder={t('profile.edit.placeholders.business_email', { defaultValue: 'contacto@…' })}
                              placeholderTextColor="rgba(255,255,255,0.4)"
                              autoCapitalize="none"
                              keyboardType="email-address"
                              style={[styles.modalInput, profileEditTouched.business_email && profileEditErrors.business_email ? styles.modalInputError : null]}
                            />
                            {profileEditTouched.business_email && profileEditErrors.business_email ? <Text style={styles.modalErrorText}>{profileEditErrors.business_email}</Text> : null}
                          </View>
                          <View style={[styles.modalField, { flex: 1 }]}>
                            <Text style={styles.modalLabel}>{t('profile.edit.fields.instagram', { defaultValue: 'Instagram' })}</Text>
                            <TextInput
                              value={profileDraft.instagram_account}
                              onChangeText={(v) => setProfileField('instagram_account', v)}
                              placeholder={t('profile.edit.placeholders.instagram', { defaultValue: '@tu_cuenta' })}
                              placeholderTextColor="rgba(255,255,255,0.4)"
                              autoCapitalize="none"
                              style={[styles.modalInput, profileEditTouched.instagram_account && profileEditErrors.instagram_account ? styles.modalInputError : null]}
                            />
                            {profileEditTouched.instagram_account && profileEditErrors.instagram_account ? <Text style={styles.modalErrorText}>{profileEditErrors.instagram_account}</Text> : null}
                          </View>
                        </View>
                        <View style={styles.modalField}>
                          <Text style={styles.modalLabel}>{t('profile.edit.fields.venue_address', { defaultValue: 'Dirección del local' })}</Text>
                          <TextInput
                            value={profileDraft.organizer_venue_address}
                            onChangeText={(v) => setProfileField('organizer_venue_address', v)}
                            placeholder={t('profile.edit.placeholders.venue_address', { defaultValue: 'Dirección del local' })}
                            placeholderTextColor="rgba(255,255,255,0.4)"
                            style={[styles.modalInput, profileEditTouched.organizer_venue_address && profileEditErrors.organizer_venue_address ? styles.modalInputError : null]}
                          />
                          {profileEditTouched.organizer_venue_address && profileEditErrors.organizer_venue_address ? <Text style={styles.modalErrorText}>{profileEditErrors.organizer_venue_address}</Text> : null}
                        </View>
                        <View style={styles.modalFieldRow}>
                          <View style={[styles.modalField, { flex: 1 }]}>
                            <Text style={styles.modalLabel}>{t('profile.edit.fields.fiscal_address', { defaultValue: 'Dirección fiscal' })}</Text>
                            <TextInput
                              value={profileDraft.organizer_fiscal_address}
                              onChangeText={(v) => setProfileField('organizer_fiscal_address', v)}
                              placeholder={t('profile.edit.placeholders.fiscal_address', { defaultValue: 'Dirección fiscal' })}
                              placeholderTextColor="rgba(255,255,255,0.4)"
                              style={[styles.modalInput, profileEditTouched.organizer_fiscal_address && profileEditErrors.organizer_fiscal_address ? styles.modalInputError : null]}
                            />
                            {profileEditTouched.organizer_fiscal_address && profileEditErrors.organizer_fiscal_address ? <Text style={styles.modalErrorText}>{profileEditErrors.organizer_fiscal_address}</Text> : null}
                          </View>
                          <View style={[styles.modalField, { flex: 1 }]}>
                            <Text style={styles.modalLabel}>{t('profile.edit.fields.postal_code', { defaultValue: 'Código postal' })}</Text>
                            <TextInput
                              value={profileDraft.organizer_postal_code}
                              onChangeText={(v) => setProfileField('organizer_postal_code', v)}
                              placeholder={t('profile.edit.placeholders.postal_code', { defaultValue: '00000' })}
                              placeholderTextColor="rgba(255,255,255,0.4)"
                              keyboardType="number-pad"
                              style={[styles.modalInput, profileEditTouched.organizer_postal_code && profileEditErrors.organizer_postal_code ? styles.modalInputError : null]}
                            />
                            {profileEditTouched.organizer_postal_code && profileEditErrors.organizer_postal_code ? <Text style={styles.modalErrorText}>{profileEditErrors.organizer_postal_code}</Text> : null}
                          </View>
                        </View>
                        <View style={styles.modalFieldRow}>
                          <View style={[styles.modalField, { flex: 1 }]}>
                            <Text style={styles.modalLabel}>{t('profile.edit.fields.responsible_name', { defaultValue: 'Responsable' })}</Text>
                            <TextInput
                              value={profileDraft.organizer_responsible_name}
                              onChangeText={(v) => setProfileField('organizer_responsible_name', v)}
                              placeholder={t('profile.edit.placeholders.responsible_name', { defaultValue: 'Nombre del responsable' })}
                              placeholderTextColor="rgba(255,255,255,0.4)"
                              style={[styles.modalInput, profileEditTouched.organizer_responsible_name && profileEditErrors.organizer_responsible_name ? styles.modalInputError : null]}
                            />
                            {profileEditTouched.organizer_responsible_name && profileEditErrors.organizer_responsible_name ? <Text style={styles.modalErrorText}>{profileEditErrors.organizer_responsible_name}</Text> : null}
                          </View>
                          <View style={[styles.modalField, { flex: 1 }]}>
                            <Text style={styles.modalLabel}>{t('profile.edit.fields.responsible_birthdate', { defaultValue: 'Nacimiento responsable' })}</Text>
                            <TextInput
                              value={profileDraft.organizer_responsible_birthdate}
                              onChangeText={(v) => setProfileField('organizer_responsible_birthdate', v)}
                              placeholder={t('profile.edit.placeholders.responsible_birthdate', { defaultValue: 'YYYY-MM-DD' })}
                              placeholderTextColor="rgba(255,255,255,0.4)"
                              keyboardType="numbers-and-punctuation"
                              style={[styles.modalInput, profileEditTouched.organizer_responsible_birthdate && profileEditErrors.organizer_responsible_birthdate ? styles.modalInputError : null]}
                            />
                            {profileEditTouched.organizer_responsible_birthdate && profileEditErrors.organizer_responsible_birthdate ? <Text style={styles.modalErrorText}>{profileEditErrors.organizer_responsible_birthdate}</Text> : null}
                          </View>
                        </View>
                        <View style={styles.modalField}>
                          <Text style={styles.modalLabel}>{t('profile.edit.fields.iban', { defaultValue: 'IBAN' })}</Text>
                          <View style={styles.modalInputRow}>
                            <TextInput
                              value={profileDraft.organizer_iban}
                              onChangeText={(v) => setProfileField('organizer_iban', v)}
                              placeholder={t('profile.edit.placeholders.iban', { defaultValue: 'ES…' })}
                              placeholderTextColor="rgba(255,255,255,0.4)"
                              autoCapitalize="characters"
                              style={[
                                styles.modalInput,
                                { flex: 1 },
                                profileEditTouched.organizer_iban && profileEditErrors.organizer_iban ? styles.modalInputError : null,
                              ]}
                              secureTextEntry={!profileEditShowIban}
                            />
                            <TouchableOpacity
                              onPress={() => setProfileEditShowIban((v) => !v)}
                              activeOpacity={0.8}
                              style={styles.modalInlineBtn}
                            >
                              <Text style={styles.modalInlineBtnText}>
                                {profileEditShowIban ? t('profile.edit.hide', { defaultValue: 'Ocultar' }) : t('profile.edit.show', { defaultValue: 'Mostrar' })}
                              </Text>
                            </TouchableOpacity>
                          </View>
                          {profileEditTouched.organizer_iban && profileEditErrors.organizer_iban ? <Text style={styles.modalErrorText}>{profileEditErrors.organizer_iban}</Text> : null}
                        </View>
                      </>
                    ) : null}
                  </ScrollView>

                  <View style={styles.modalAutosaveRow}>
                    <Text style={styles.modalAutosaveText}>{t('profile.edit.autosave', { defaultValue: 'Auto-guardado' })}</Text>
                    <Switch
                      value={profileEditAutoSave}
                      onValueChange={setProfileEditAutoSave}
                      trackColor={{ false: 'rgba(255,255,255,0.12)', true: Colors.dark.primary }}
                      thumbColor={'#fff'}
                    />
                  </View>

                  <View style={{ marginTop: 12, flexDirection: 'row', gap: 10 }}>
                    <ThemedButton title={t('common.cancel')} variant="outline" onPress={closeProfileEdit} style={{ flex: 1 }} />
                    <ThemedButton
                      title={profileEditSaving ? t('profile.saving') : t('common.save')}
                      onPress={() => requestSaveProfileEdit('manual')}
                      disabled={profileEditSaving || profileEditHasErrors || profileEditLocationChecking || !profileEditDirty}
                      style={{ flex: 1 }}
                    />
                  </View>
                </>
              )}
            </GlassView>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.dark.background,
  },
  scrollContent: {
    paddingBottom: 100,
    alignItems: 'center',
    flexGrow: 1,
  },
  perfilContainer: {
    width: '100%',
  },
  
  // Ambient Glow
  ambientGlowTop: {
    position: 'absolute',
    top: -100,
    left: -100,
    width: 300,
    height: 300,
    borderRadius: 150,
    backgroundColor: 'rgba(10, 132, 255, 0.15)', // Blue glow
  },
  ambientGlowBottom: {
    position: 'absolute',
    bottom: -50,
    right: -50,
    width: 250,
    height: 250,
    borderRadius: 125,
    backgroundColor: 'rgba(94, 92, 230, 0.15)', // Purple glow
  },

  premiumCard: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    backgroundColor: 'rgba(255,255,255,0.03)',
    shadowColor: '#000',
    shadowOpacity: 0.22,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  headerCard: {
    padding: 20,
    borderRadius: 24,
    marginBottom: 24,
    overflow: 'hidden',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  avatarRingWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    overflow: 'hidden',
  },
  avatarRing: {
    flex: 1,
    padding: 3,
    borderRadius: 36,
  },
  avatarRingInner: {
    flex: 1,
    borderRadius: 33,
    backgroundColor: 'rgba(0,0,0,0.35)',
    overflow: 'hidden',
  },
  avatarFallback: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  avatarFallbackText: {
    color: Colors.dark.text,
    fontSize: 28,
    fontFamily: 'RussoOne_400Regular',
  },
  headerName: {
    fontSize: 22,
    color: Colors.dark.text,
    fontFamily: 'RussoOne_400Regular',
  },
  headerEmail: {
    marginTop: 4,
    fontSize: 12,
    color: Colors.dark.textSecondary,
    opacity: 0.8,
  },
  headerMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 10,
    flexWrap: 'wrap',
  },
  premiumHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
    marginTop: 6,
  },
  premiumTitle: {
    fontSize: 18,
    color: Colors.dark.text,
    fontFamily: 'RussoOne_400Regular',
    marginBottom: 0,
  },
  premiumSubtitle: {
    color: Colors.dark.textSecondary,
    fontSize: 12,
    marginTop: 4,
    opacity: 0.8,
  },
  premiumIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    overflow: 'hidden',
  },
  premiumIconRing: {
    flex: 1,
    padding: 2,
    borderRadius: 20,
  },
  premiumIconInner: {
    flex: 1,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentedControlCard: {
    borderRadius: 24,
    overflow: 'hidden',
  },
  premiumSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
    marginTop: 6,
  },
  premiumIconWrapSmall: {
    width: 34,
    height: 34,
    borderRadius: 17,
    overflow: 'hidden',
  },
  premiumIconRingSmall: {
    flex: 1,
    padding: 2,
    borderRadius: 17,
  },
  premiumIconInnerSmall: {
    flex: 1,
    borderRadius: 15,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  premiumSectionTitle: {
    color: 'white',
    fontWeight: '900',
    fontSize: 13,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  premiumSectionSubtitle: {
    marginTop: 3,
    color: 'rgba(255,255,255,0.65)',
    fontWeight: '700',
    fontSize: 12,
  },

  alertCard: {
    padding: 16,
    borderRadius: 24,
    marginBottom: 14,
  },
  alertTitle: {
    color: 'white',
    fontWeight: '900',
    fontSize: 14,
  },
  alertText: {
    color: 'rgba(255,255,255,0.65)',
    marginTop: 6,
    fontWeight: '600',
    lineHeight: 18,
  },

  eventRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    minHeight: 50,
  },
  eventThumb: {
    width: 46,
    height: 46,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  eventTitle: {
    color: 'white',
    fontWeight: '900',
    fontSize: 13,
  },
  eventMeta: {
    color: 'rgba(255,255,255,0.55)',
    marginTop: 3,
    fontWeight: '700',
    fontSize: 11,
  },

  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.82)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  modalCard: {
    padding: 16,
    borderRadius: 24,
    overflow: 'hidden',
    width: '100%',
    alignSelf: 'center',
  },
  modalHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  modalTitle: {
    color: 'white',
    fontWeight: '900',
    fontSize: 16,
    flex: 1,
    textAlign: 'center',
  },
  modalClose: {
    width: 34,
    height: 34,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.10)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCancel: {
    height: 34,
    width: 88,
    paddingHorizontal: 10,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.10)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCancelText: {
    color: 'rgba(255,255,255,0.90)',
    fontWeight: '900',
    fontSize: 12,
  },
  modalField: {
    gap: 6,
  },
  modalFieldRow: {
    flexDirection: 'row',
    gap: 10,
  },
  modalLabel: {
    color: 'rgba(255,255,255,0.65)',
    fontWeight: '800',
    fontSize: 12,
  },
  modalInput: {
    height: 44,
    borderRadius: 14,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    color: 'white',
    fontWeight: '800',
  },
  modalSectionTitle: {
    marginTop: 12,
    marginBottom: 8,
    color: 'rgba(255,255,255,0.85)',
    fontWeight: '900',
    fontSize: 12,
    letterSpacing: 0.7,
  },
  modalErrorText: {
    color: '#fb7185',
    fontWeight: '800',
    fontSize: 12,
  },
  modalInputError: {
    borderColor: 'rgba(251,113,133,0.65)',
  },
  modalInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  modalInlineBtn: {
    height: 44,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalInlineBtnText: {
    color: 'rgba(255,255,255,0.85)',
    fontWeight: '900',
    fontSize: 12,
  },
  modalAutosaveRow: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
  },
  modalAutosaveText: {
    color: 'rgba(255,255,255,0.80)',
    fontWeight: '900',
    fontSize: 13,
  },

  // Auth Prompt
  authPrompt: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  authCard: {
    width: '100%',
    maxWidth: 350,
    padding: 30,
    alignItems: 'center',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  iconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(10, 132, 255, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  authPromptTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: '#FFF',
    marginBottom: 10,
    textAlign: 'center',
  },
  authPromptText: {
    fontSize: 16,
    color: '#8E8E93',
    textAlign: 'center',
    marginBottom: 30,
    lineHeight: 22,
  },
  authButton: {
    width: '100%',
    marginBottom: 12,
  },

  // Header Card
  profileHeaderCard: {
    marginBottom: 24,
    marginTop: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.5,
    shadowRadius: 15,
    elevation: 10,
  },
  profileHeaderContent: {
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    minHeight: 180,
  },
  profileHeaderTop: {
    padding: 24,
    flexDirection: 'row',
    alignItems: 'center',
    zIndex: 10,
  },
  avatarContainer: {
    marginRight: 20,
    position: 'relative',
  },
  avatarGradient: {
    width: 80,
    height: 80,
    borderRadius: 40,
    padding: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarImage: {
    width: '100%',
    height: '100%',
    borderRadius: 33,
    backgroundColor: '#000',
  },
  onlineBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#30D158',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: '#1c1c1e',
  },
  profileInfo: {
    flex: 1,
  },
  profileName: {
    fontSize: 24,
    fontWeight: '800',
    color: '#FFF',
    marginBottom: 4,
    letterSpacing: -0.5,
  },
  profileEmail: {
    fontSize: 14,
    color: '#8E8E93',
    marginBottom: 8,
  },
  memberBadge: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 100,
    alignSelf: 'flex-start',
  },
  memberBadgeText: {
    fontSize: 10,
    color: '#FFF',
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  verificationPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    maxWidth: '100%',
  },
  verificationPillPending: {
    backgroundColor: 'rgba(245, 158, 11, 0.10)',
    borderColor: 'rgba(245, 158, 11, 0.25)',
  },
  verificationPillVerified: {
    backgroundColor: 'rgba(34, 197, 94, 0.12)',
    borderColor: 'rgba(34, 197, 94, 0.25)',
  },
  verificationPillRejected: {
    backgroundColor: 'rgba(251, 113, 133, 0.10)',
    borderColor: 'rgba(251, 113, 133, 0.25)',
  },
  verificationPillText: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.2,
    flexShrink: 1,
  },
  hologramStrip: {
    position: 'absolute',
    top: 0,
    right: 30,
    width: 40,
    height: '100%',
    backgroundColor: 'rgba(255,255,255,0.03)',
    transform: [{ skewX: '-20deg' }],
  },
  idChip: {
    position: 'absolute',
    bottom: 24,
    right: 24,
    width: 45,
    height: 30,
    borderRadius: 6,
    backgroundColor: '#D4AF37', // Gold chip color
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
    opacity: 0.8,
  },
  idChipInner: {
    width: 30,
    height: 20,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.3)',
    backgroundColor: 'transparent',
  },

  // Segmented Control
  segmentedControlContainer: {
    marginBottom: 24,
    paddingHorizontal: 4,
  },
  segmentedControl: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: 16,
    padding: 3,
    height: 44,
  },
  segmentButtonWrapper: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
    height: '100%',
  },
  activeSegmentBg: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 13,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
  },
  segmentText: {
    fontSize: 13,
    fontFamily: 'RussoOne_400Regular',
    color: Colors.dark.textSecondary,
    opacity: 0.9,
    zIndex: 1,
  },
  segmentTextActive: {
    color: Colors.dark.text,
    opacity: 1,
  },

  // Bento Grid
  bentoGrid: {
    flexDirection: 'row',
    marginBottom: 30,
    gap: 12,
  },
  bentoCard: {
    flex: 1,
    padding: 16,
    minHeight: 100,
    justifyContent: 'space-between',
    borderRadius: 24,
    overflow: 'hidden',
  },
  bentoCardLarge: {
    flex: 1.4,
  },
  bentoIconBg: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(48, 209, 88, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  bentoLabel: {
    fontSize: 12,
    color: Colors.dark.textSecondary,
    fontWeight: '600',
    marginBottom: 4,
  },
  bentoValue: {
    fontSize: 20,
    fontFamily: 'RussoOne_400Regular',
    color: Colors.dark.text,
  },
  organizerHeroCard: {
    padding: 18,
    borderRadius: 28,
    overflow: 'hidden',
    marginBottom: 28,
  },
  organizerHeroTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  organizerHeroLabel: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.6,
    color: 'rgba(255,255,255,0.65)',
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  organizerHeroValue: {
    fontSize: 34,
    fontFamily: 'RussoOne_400Regular',
    color: Colors.dark.text,
  },
  organizerHeroHint: {
    marginTop: 10,
    fontSize: 12,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.45)',
  },
  organizerHeroCtaRow: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  // iOS Settings Group
  sectionHeader: {
    fontSize: 13,
    fontWeight: '600',
    color: '#8E8E93',
    marginBottom: 8,
    marginLeft: 16,
    textTransform: 'uppercase',
  },
  iosGroup: {
    marginBottom: 30,
  },
  iosGroupContainer: {
    borderRadius: 24,
    overflow: 'hidden',
  },
  iosRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    minHeight: 50,
  },
  iosButtonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    minHeight: 50,
  },
  iosDivider: {
    height: 0.5,
    backgroundColor: 'rgba(84, 84, 88, 0.65)',
    marginLeft: 56, // Indent divider
  },
  iosLabelContainer: {
    minWidth: 96,
    maxWidth: 140,
    flexShrink: 0,
    paddingRight: 12,
  },
  iosLabel: {
    fontSize: 16,
    color: '#FFF',
  },
  iosValueContainer: {
    flex: 1,
    alignItems: 'flex-end',
    minWidth: 0,
  },
  iosValue: {
    fontSize: 16,
    color: '#8E8E93',
    textAlign: 'right',
    flexShrink: 1,
  },
  iosIcon: {
    width: 28,
    height: 28,
    borderRadius: 7,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  iosButtonText: {
    fontSize: 16,
    color: '#FFF',
    flex: 1,
  },
  
  // Logout
  logoutContainer: {
    marginTop: 10,
    marginBottom: 40,
    alignItems: 'center',
  },
  logoutButton: {
    paddingVertical: 12,
    paddingHorizontal: 24,
  },
  logoutText: {
    color: '#FF453A', // System Red
    fontSize: 16,
    fontWeight: '600',
  },
  versionText: {
    marginTop: 12,
    fontSize: 12,
    color: '#48484A',
  },

  content: {
    width: '100%',
  },

  // Resale Item Styles (in Profile)
  resaleItem: {
    marginBottom: 16,
  },
  resaleCard: {
    padding: 20,
    borderRadius: 24,
    overflow: 'hidden',
  },
  resaleHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  resaleEventTitle: {
    fontSize: 18,
    fontFamily: 'RussoOne_400Regular',
    color: Colors.dark.text,
    marginBottom: 4,
  },
  resaleDate: {
    fontSize: 14,
    color: Colors.dark.textSecondary,
  },
  resalePriceTag: {
    backgroundColor: '#FFF',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  resalePrice: {
    fontSize: 16,
    fontFamily: 'RussoOne_400Regular',
    color: '#000',
  },
  resaleActions: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.1)',
    paddingTop: 12,
    alignItems: 'flex-end',
  },
  cancelButton: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    backgroundColor: 'rgba(255, 69, 58, 0.1)',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 69, 58, 0.3)',
  },
  cancelButtonText: {
    color: '#FF453A',
    fontSize: 13,
    fontWeight: '600',
  },
  emptyResaleState: {
    alignItems: 'center',
    paddingVertical: 18,
  },
  emptyResaleCard: {
    width: '100%',
    paddingVertical: 22,
    paddingHorizontal: 18,
    borderRadius: 24,
    alignItems: 'center',
  },
  emptyResaleIcon: {
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  emptyResaleText: {
    marginTop: 14,
    color: '#8E8E93',
    fontSize: 16,
    fontWeight: '600',
  },
});
