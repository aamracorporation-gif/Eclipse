import { profileAppearance } from '@/theme/profileAppearance';
import { LAUNCH_FEATURES } from '@/lib/launchFeatures';
import { View, Text, StyleSheet, TouchableOpacity, Platform, ScrollView, Image, RefreshControl, StatusBar, Modal, TextInput, KeyboardAvoidingView, Switch, Alert, useWindowDimensions, Pressable } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { router, useSegments } from 'expo-router';
import { useAuth } from '@/lib/AuthContext';
import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { User, Ticket, ChevronRight, Tag, TrendingUp, UserPlus, Calendar, Sparkles, ShieldCheck, Wallet, QrCode, Clock, MapPin, Pencil, X, FileText, LogOut, Eye, EyeOff, MessageCircle } from '@/lib/icons';
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
import { useCredit } from '@/lib/WalletContext';
import { useTranslation } from 'react-i18next';
import { useI18n } from '@/lib/I18nContext';
import { invokeEdgeFunction } from '@/lib/edgeFunctions';
import { useAppDialog } from '@/components/ui/AppDialog';
import { isSafeAddressText, isSafeOrgText, isValidIbanES, isValidPersonName, normalizeWhitespace, normalizeWhitespaceForInput } from '@/lib/validators';
import * as Location from 'expo-location';

export default function ProfileScreen() {
  const { user, signOut, workerProfile } = useAuth();
  const { events, refreshEvents } = useEvents();
  const { balanceReal, refreshCredit } = useCredit();
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

  // ── Support modal ─────────────────────────────────────────────────────────
  const [supportOpen,      setSupportOpen]      = useState(false);
  const [supportCategory,  setSupportCategory]  = useState('Problema técnico');
  const [supportMessage,   setSupportMessage]   = useState('');
  const [supportSending,   setSupportSending]   = useState(false);


  const handleSendSupport = async () => {
    if (!supportMessage.trim()) {
      Alert.alert('Mensaje vacío', 'Escribe tu mensaje antes de enviar.');
      return;
    }
    setSupportSending(true);
    try {
      const { data, error } = await supabase.functions.invoke('send-support-email', {
        body: { category: supportCategory, message: supportMessage.trim() },
      });

      if (error) throw error;
      if (data && !data.ok) {
        console.error('[Support] Email service rejected the request');
        Alert.alert('Error al enviar', 'No se pudo enviar el mensaje. Inténtalo de nuevo.');
        return;
      }

      setSupportOpen(false);
      setSupportMessage('');
      setSupportCategory('Problema técnico');
      Alert.alert('¡Mensaje enviado!', 'Hemos recibido tu consulta. Te responderemos lo antes posible.');
    } catch (e: any) {
      console.error('[Support] send error:', e);
      Alert.alert('Error al enviar', 'No se pudo enviar el mensaje. Inténtalo de nuevo o escríbenos a ' + SUPPORT_EMAIL);
    } finally {
      setSupportSending(false);
    }
  };

  // ── Change password modal ───────────────────────────────────────────────────
  const [changePwdOpen,    setChangePwdOpen]    = useState(false);
  const [pwdStep,          setPwdStep]          = useState<'verify' | 'change' | 'done'>('verify');
  const [pwdCurrent,       setPwdCurrent]       = useState('');
  const [pwdNew,           setPwdNew]           = useState('');
  const [pwdConfirm,       setPwdConfirm]       = useState('');
  const [pwdError,         setPwdError]         = useState('');
  const [pwdLoading,       setPwdLoading]       = useState(false);
  const [pwdShowCurrent,   setPwdShowCurrent]   = useState(false);
  const [pwdShowNew,       setPwdShowNew]       = useState(false);
  const [pwdShowConfirm,   setPwdShowConfirm]   = useState(false);
  const [resaleListings, setResaleListings] = useState<any[]>([]);
  const [resaleTransactions, setResaleTransactions] = useState<any[]>([]);
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
    birthdate: '',          // ISO date string YYYY-MM-DD for all users
  });
  const [showDatePicker, setShowDatePicker] = useState(false);

  const profileEditModalHeight = useMemo(() => {
    const available = Math.max(0, windowHeight - 32);
    return Math.min(760, available);
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
      if (!Number.isFinite(n) || n < 16 || n > 120) errors.age = t('profile.edit.errors.invalid_age', { defaultValue: 'La edad mínima es 16 años.' });
    }

    const phone = normalizeWhitespace(profileDraft.phone);
    if (nonEmpty(phone) && !(/^[+]?[0-9\s()-]{6,24}$/.test(phone) && /[0-9]{6,}/.test(phone.replace(/[^0-9]/g, '')))) errors.phone = t('profile.edit.errors.invalid_phone', { defaultValue: 'Teléfono inválido.' });

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
      birthdate: String(draft.birthdate || '').trim(),
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
          'full_name, first_name, last_name, phone, city, country, gender, age, birthdate, club_name, business_email, instagram_account, address, organizer_venue_address, organizer_fiscal_address, organizer_postal_code, organizer_responsible_name, organizer_responsible_birthdate, organizer_iban'
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
        birthdate: String((data as any)?.birthdate ?? ''),
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
      const birthdateStr = String(profileDraft.birthdate || '').trim();
      // Derive age from birthdate if provided, otherwise use manual age field
      let ageNum: number | null = null;
      if (birthdateStr) {
        const bd = new Date(birthdateStr);
        if (!isNaN(bd.getTime())) {
          const today = new Date();
          let years = today.getFullYear() - bd.getFullYear();
          const m = today.getMonth() - bd.getMonth();
          if (m < 0 || (m === 0 && today.getDate() < bd.getDate())) years--;
          ageNum = years;
        }
      } else if (String(profileDraft.age || '').trim().length) {
        ageNum = Number(profileDraft.age);
        if (!Number.isFinite(ageNum)) ageNum = null;
      }

      const payload: any = {
        full_name: normalizeOrNull(profileDraft.full_name) || normalizeOrNull(`${profileDraft.first_name} ${profileDraft.last_name}`),
        first_name: normalizeOrNull(profileDraft.first_name),
        last_name: normalizeOrNull(profileDraft.last_name),
        phone: normalizeTrimOrNull(profileDraft.phone),
        city: normalizeOrNull(profileDraft.city),
        country: normalizeOrNull(profileDraft.country),
        gender: normalizeOrNull(profileDraft.gender),
        age: ageNum != null && Number.isFinite(ageNum) ? ageNum : null,
        birthdate: birthdateStr || null,
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
    if (tab === 'resale' && !LAUNCH_FEATURES.resale) return;
    Haptics.selectionAsync();
    // LayoutAnimation can conflict with Reanimated on some devices, removing for stability
    // LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); 
    setActiveTab(tab);
  };

  useEffect(() => {
    if (profileRole === 'organizer' && !inCreator && activeTab === 'profile') {
      setActiveTab('panel');
    }
  }, [activeTab, inCreator, profileRole]);

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

  // Fetch Resale Listings + Transaction History
  const fetchResales = useCallback(async () => {
    if (!LAUNCH_FEATURES.resale || !user) return;
    try {
      setLoadingResales(true);

      const [listingsRes, txRes] = await Promise.all([
        supabase
          .from('resale_listings')
          .select(`
            id, status, price, created_at, ticket_id,
            tickets (
              id,
              events (
                id, title, event_date, poster_url
              )
            )
          `)
          .eq('seller_id', user.id)
          .order('created_at', { ascending: false }),
        supabase
          .from('resale_transactions')
          .select(`
            id, seller_id, buyer_id, price, seller_amount, created_at,
            tickets (
              id,
              events (
                id, title, event_date, poster_url
              )
            )
          `)
          .or(`seller_id.eq.${user.id},buyer_id.eq.${user.id}`)
          .order('created_at', { ascending: false })
          .limit(50),
      ]);

      if (listingsRes.error) throw listingsRes.error;
      setResaleListings(listingsRes.data || []);
      setResaleTransactions(txRes.data || []);
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
    if (!LAUNCH_FEATURES.resale || !user) return;

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
      refreshCredit();
    }
  }, [activeTab, fetchResales, refreshCredit]);

  const onRefresh = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setRefreshing(true);
    if (activeTab === 'resale') {
      fetchResales();
      refreshCredit();
    } else {
      refreshEvents()
        .catch(() => null)
        .finally(() => setRefreshing(false));
    }
  }, [activeTab, fetchResales, refreshCredit, refreshEvents]);

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

  const openChangePwd = () => {
    setPwdStep('verify');
    setPwdCurrent('');
    setPwdNew('');
    setPwdConfirm('');
    setPwdError('');
    setPwdShowCurrent(false);
    setPwdShowNew(false);
    setPwdShowConfirm(false);
    setChangePwdOpen(true);
  };

  const handleVerifyPassword = async () => {
    if (!pwdCurrent.trim()) { setPwdError('Introduce tu contraseña actual.'); return; }
    setPwdLoading(true);
    setPwdError('');
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: user!.email!,
        password: pwdCurrent,
      });
      if (error) throw error;
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setPwdStep('change');
    } catch {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setPwdError('Contraseña incorrecta. Inténtalo de nuevo.');
    } finally {
      setPwdLoading(false);
    }
  };

  const handleChangePassword = async () => {
    if (pwdNew.length < 8) { setPwdError('La contraseña debe tener al menos 8 caracteres.'); return; }
    if (!/[A-Z]/.test(pwdNew)) { setPwdError('Debe contener al menos una letra mayúscula.'); return; }
    if (!/[0-9]/.test(pwdNew)) { setPwdError('Debe contener al menos un número.'); return; }
    if (pwdNew !== pwdConfirm) { setPwdError('Las contraseñas no coinciden.'); return; }
    if (pwdNew === pwdCurrent) { setPwdError('La nueva contraseña debe ser diferente a la actual.'); return; }
    setPwdLoading(true);
    setPwdError('');
    try {
      const { error } = await supabase.auth.updateUser({ password: pwdNew });
      if (error) throw error;
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setPwdStep('done');
    } catch (e: any) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setPwdError(String(e?.message || 'No se pudo cambiar la contraseña.'));
    } finally {
      setPwdLoading(false);
    }
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
            paddingBottom: 24,
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
        <View style={[styles.perfilContainer, { maxWidth: Math.min(760, maxContentWidth), width: '100%' }]}>
          
          <GlassView intensity={14} style={[styles.headerCard, profileAppearance.headerCard]} contentContainerStyle={{ padding: 0 }}>
            <View style={[styles.headerRow, profileAppearance.headerRow]}>
              <View style={[styles.avatarRingWrap, profileAppearance.avatarRingWrap]}>
                <LinearGradient
                  colors={['rgba(124,58,237,0.85)', 'rgba(6,182,212,0.55)', 'rgba(255,255,255,0.10)']}
                  style={[styles.avatarRing, profileAppearance.avatarRing]}
                >
                  <View style={[styles.avatarRingInner, profileAppearance.avatarRingInner]}>
                    {user.user_metadata?.avatar_url ? (
                      <Image source={{ uri: user.user_metadata.avatar_url }} style={[styles.avatarImage, { width: '100%', height: '100%' }]} />
                    ) : (
                      <View style={[styles.avatarImage, profileAppearance.avatarFallback, { width: '100%', height: '100%' }]}>
                        <Text style={[styles.avatarFallbackText, profileAppearance.avatarFallbackText]}>
                          {(displayName || 'U').charAt(0).toUpperCase()}
                        </Text>
                      </View>
                    )}
                  </View>
                </LinearGradient>
              </View>

              <View style={{ flex: 1 }}>
                <Text style={[styles.headerName, profileAppearance.headerName]} numberOfLines={1}>{displayName}</Text>
                <Text style={[styles.headerEmail, profileAppearance.headerEmail]} numberOfLines={1}>{user.email}</Text>
                <View style={[styles.headerMetaRow, profileAppearance.headerMetaRow]}>
                  <View style={[styles.memberBadge, profileAppearance.memberBadge]}>
                    <Text style={[styles.memberBadgeText, profileAppearance.memberBadgeText]}>{t('profile.member_since', { year: new Date(user.created_at).getFullYear() })}</Text>
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

                {profileRole === 'organizer' && (
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
                    {LAUNCH_FEATURES.resale && (<TouchableOpacity
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
                    </TouchableOpacity>)}
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
                {LAUNCH_FEATURES.resale && (<TouchableOpacity 
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
                </TouchableOpacity>)}
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
                        <GlassView intensity={14} style={[styles.iosGroupContainer, profileAppearance.card]}>
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
                            style={[styles.iosButtonRow, profileAppearance.actionRow]}
                          >
                            <View style={[styles.iosIcon, { backgroundColor: '#28243D' }]}>
                              <Calendar size={16} color="#F4F0FF" />
                            </View>
                            <Text style={styles.iosButtonText}>{t('profile.organizer.menu.create_event')}</Text>
                            <ChevronRight size={16} color="#C4C4D4" />
                          </TouchableOpacity>
                          <View style={styles.iosDivider} />
                          <TouchableOpacity activeOpacity={0.75} onPress={() => router.push('/(creator)/manage-events')} style={[styles.iosButtonRow, profileAppearance.actionRow]}>
                            <View style={[styles.iosIcon, { backgroundColor: '#28243D' }]}>
                              <MapPin size={16} color="#F4F0FF" />
                            </View>
                            <Text style={styles.iosButtonText}>{t('profile.organizer.menu.my_events')}</Text>
                            <ChevronRight size={16} color="#C4C4D4" />
                          </TouchableOpacity>
                          <View style={styles.iosDivider} />
                          <TouchableOpacity activeOpacity={0.75} onPress={() => router.push('/(creator)/scan')} style={[styles.iosButtonRow, profileAppearance.actionRow]}>
                            <View style={[styles.iosIcon, { backgroundColor: '#28243D' }]}>
                              <QrCode size={16} color="#F4F0FF" />
                            </View>
                            <Text style={styles.iosButtonText}>{t('profile.organizer.menu.scan')}</Text>
                            <ChevronRight size={16} color="#C4C4D4" />
                          </TouchableOpacity>
                          <View style={styles.iosDivider} />
                          <TouchableOpacity activeOpacity={0.75} onPress={() => router.push('/(creator)/workers')} style={[styles.iosButtonRow, profileAppearance.actionRow]}>
                            <View style={[styles.iosIcon, { backgroundColor: '#28243D' }]}>
                              <UserPlus size={16} color="#F4F0FF" />
                            </View>
                            <Text style={styles.iosButtonText}>{t('profile.organizer.menu.staff')}</Text>
                            <ChevronRight size={16} color="#C4C4D4" />
                          </TouchableOpacity>
                          <View style={styles.iosDivider} />
                          <TouchableOpacity activeOpacity={0.75} onPress={() => router.push('/(creator)/stats')} style={[styles.iosButtonRow, profileAppearance.actionRow]}>
                            <View style={[styles.iosIcon, { backgroundColor: '#28243D' }]}>
                              <TrendingUp size={16} color="#F4F0FF" />
                            </View>
                            <Text style={styles.iosButtonText}>{t('profile.organizer.menu.stats')}</Text>
                            <ChevronRight size={16} color="#C4C4D4" />
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
                        <GlassView intensity={14} style={[styles.iosGroupContainer, profileAppearance.card]}>
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
                                    <ChevronRight size={16} color="#C4C4D4" />
                                  </TouchableOpacity>
                                  {idx < upcomingOrganizerEvents.length - 1 && <View style={styles.iosDivider} />}
                                </View>
                              );
                            })
                          ) : (
                            <View style={{ paddingVertical: 6 }}>
                              <Text style={{ color: 'rgba(255,255,255,0.70)', fontWeight: '700' }}>{t('profile.organizer.no_upcoming_title')}</Text>
                              <Text style={{ color: '#C4C4D4', marginTop: 4 }}>
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
                            <GlassView intensity={14} style={[styles.iosGroupContainer, profileAppearance.card]}>
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
                            <GlassView intensity={14} style={[styles.iosGroupContainer, profileAppearance.card]}>
                              <TouchableOpacity onPress={openProfileEdit} activeOpacity={0.7} style={[styles.iosButtonRow, profileAppearance.actionRow]}>
                                <View style={[styles.iosIcon, { backgroundColor: '#28243D' }]}>
                                  <Pencil size={16} color="#F4F0FF" />
                                </View>
                                <Text style={styles.iosButtonText}>{t('profile.edit_profile')}</Text>
                                <ChevronRight size={16} color="#C4C4D4" />
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
                            <GlassView intensity={14} style={[styles.iosGroupContainer, profileAppearance.card]}>
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
                        <GlassView intensity={14} style={[styles.iosGroupContainer, profileAppearance.card]}>
                          <TouchableOpacity onPress={() => router.push('/(creator)/verification')} activeOpacity={0.7} style={[styles.iosButtonRow, profileAppearance.actionRow]}>
                            <View style={[styles.iosIcon, { backgroundColor: '#28243D' }]}>
                              <ShieldCheck size={16} color="#F4F0FF" />
                            </View>
                            <Text style={styles.iosButtonText}>{t('profile.organizer.settings.verification_payments')}</Text>
                            <ChevronRight size={16} color="#C4C4D4" />
                          </TouchableOpacity>
                          <View style={styles.iosDivider} />
                          <TouchableOpacity onPress={openLanguagePicker} activeOpacity={0.7} style={[styles.iosButtonRow, profileAppearance.actionRow]}>
                            <View style={[styles.iosIcon, { backgroundColor: '#28243D' }]}>
                              <User size={16} color="#F4F0FF" />
                            </View>
                            <Text style={styles.iosButtonText}>{t('profile.change_language')}</Text>
                            <Text style={[styles.iosValue, { marginRight: 8 }]}>{language.toUpperCase()}</Text>
                            <ChevronRight size={16} color="#C4C4D4" />
                          </TouchableOpacity>
                          <View style={styles.iosDivider} />
                          <TouchableOpacity onPress={() => router.push('/notification-preferences')} activeOpacity={0.7} style={[styles.iosButtonRow, profileAppearance.actionRow]}>
                            <View style={[styles.iosIcon, { backgroundColor: '#28243D' }]}>
                              <Sparkles size={16} color="#F4F0FF" />
                            </View>
                            <Text style={styles.iosButtonText}>{t('profile.notification_preferences')}</Text>
                            <ChevronRight size={16} color="#C4C4D4" />
                          </TouchableOpacity>
                          <View style={styles.iosDivider} />
                          <TouchableOpacity onPress={() => router.push('/notifications')} activeOpacity={0.7} style={[styles.iosButtonRow, profileAppearance.actionRow]}>
                            <View style={[styles.iosIcon, { backgroundColor: '#28243D' }]}>
                              <Clock size={16} color="#F4F0FF" />
                            </View>
                            <Text style={styles.iosButtonText}>{t('profile.notification_center')}</Text>
                            <ChevronRight size={16} color="#C4C4D4" />
                          </TouchableOpacity>
                          <View style={styles.iosDivider} />
                          <TouchableOpacity onPress={() => router.push('/legal')} activeOpacity={0.7} style={[styles.iosButtonRow, profileAppearance.actionRow]}>
                            <View style={[styles.iosIcon, { backgroundColor: '#28243D' }]}>
                              <FileText size={16} color="#F4F0FF" />
                            </View>
                            <Text style={styles.iosButtonText}>{t('profile.legal_info')}</Text>
                            <ChevronRight size={16} color="#C4C4D4" />
                          </TouchableOpacity>
                          <View style={styles.iosDivider} />
                          <TouchableOpacity onPress={handleSignOut} activeOpacity={0.7} style={[styles.iosButtonRow, profileAppearance.actionRow]}>
                            <View style={[styles.iosIcon, { backgroundColor: '#28243D' }]}>
                              <LogOut size={16} color="#F4F0FF" />
                            </View>
                            <Text style={styles.iosButtonText}>{t('profile.logout')}</Text>
                            <ChevronRight size={16} color="#C4C4D4" />
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
                    <GlassView intensity={14} style={[styles.iosGroupContainer, profileAppearance.card]}>
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
                      <TouchableOpacity onPress={openProfileEdit} activeOpacity={0.7} style={[styles.iosButtonRow, profileAppearance.actionRow]}>
                        <View style={[styles.iosIcon, { backgroundColor: '#28243D' }]}>
                          <Pencil size={16} color="#F4F0FF" />
                        </View>
                        <Text style={styles.iosButtonText}>{t('profile.edit_profile')}</Text>
                        <ChevronRight size={16} color="#C4C4D4" />
                      </TouchableOpacity>
                    </GlassView>
                  </View>

                  <Text style={styles.sectionHeader}>{t('profile.section_management')}</Text>
                  <View style={styles.iosGroup}>
                    <GlassView intensity={14} style={[styles.iosGroupContainer, profileAppearance.card]}>
                      {LAUNCH_FEATURES.walletCredit && (<><TouchableOpacity onPress={() => router.push('/wallet')} activeOpacity={0.7} style={[styles.iosButtonRow, profileAppearance.actionRow]}>
                        <View style={[styles.iosIcon, { backgroundColor: '#28243D' }]}>
                          <Wallet size={16} color="#F4F0FF" />
                        </View>
                        <Text style={styles.iosButtonText}>{t('profile.wallet')}</Text>
                        <ChevronRight size={16} color="#C4C4D4" />
                      </TouchableOpacity>
                      <View style={styles.iosDivider} /></>)}
                      <TouchableOpacity onPress={() => router.push('/(tabs)/tickets')} activeOpacity={0.7} style={[styles.iosButtonRow, profileAppearance.actionRow]}>
                        <View style={[styles.iosIcon, { backgroundColor: '#28243D' }]}>
                          <Ticket size={16} color="#F4F0FF" />
                        </View>
                        <Text style={styles.iosButtonText}>{t('tickets.my_tickets')}</Text>
                        <ChevronRight size={16} color="#C4C4D4" />
                      </TouchableOpacity>
                      <View style={styles.iosDivider} />
                      <TouchableOpacity onPress={() => router.push('/notification-preferences')} activeOpacity={0.7} style={[styles.iosButtonRow, profileAppearance.actionRow]}>
                        <View style={[styles.iosIcon, { backgroundColor: '#28243D' }]}>
                          <Sparkles size={16} color="#F4F0FF" />
                        </View>
                        <Text style={styles.iosButtonText}>{t('profile.notification_preferences')}</Text>
                        <ChevronRight size={16} color="#C4C4D4" />
                      </TouchableOpacity>
                      <View style={styles.iosDivider} />
                      <TouchableOpacity onPress={() => router.push('/notifications')} activeOpacity={0.7} style={[styles.iosButtonRow, profileAppearance.actionRow]}>
                        <View style={[styles.iosIcon, { backgroundColor: '#28243D' }]}>
                          <Clock size={16} color="#F4F0FF" />
                        </View>
                        <Text style={styles.iosButtonText}>{t('profile.notification_center')}</Text>
                        <ChevronRight size={16} color="#C4C4D4" />
                      </TouchableOpacity>
                      <View style={styles.iosDivider} />
                      <TouchableOpacity onPress={() => router.push('/legal')} activeOpacity={0.7} style={[styles.iosButtonRow, profileAppearance.actionRow]}>
                        <View style={[styles.iosIcon, { backgroundColor: '#28243D' }]}>
                          <FileText size={16} color="#F4F0FF" />
                        </View>
                        <Text style={styles.iosButtonText}>{t('profile.legal_info')}</Text>
                        <ChevronRight size={16} color="#C4C4D4" />
                      </TouchableOpacity>
                      {profileRole === 'admin' && (
                        <>
                          <View style={styles.iosDivider} />
                          <TouchableOpacity onPress={() => router.push('/(creator)/admin-verification')} activeOpacity={0.7} style={[styles.iosButtonRow, profileAppearance.actionRow]}>
                            <View style={[styles.iosIcon, { backgroundColor: '#28243D' }]}>
                              <ShieldCheck size={16} color="#F4F0FF" />
                            </View>
                            <Text style={styles.iosButtonText}>{t('profile.review_organizers')}</Text>
                            <ChevronRight size={16} color="#C4C4D4" />
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
                    <GlassView intensity={14} style={[styles.iosGroupContainer, profileAppearance.card]}>
                       <TouchableOpacity onPress={() => router.push('/(worker)')} activeOpacity={0.7} style={[styles.iosButtonRow, profileAppearance.actionRow]}>
                        <View style={[styles.iosIcon, { backgroundColor: '#28243D' }]}>
                          <QrCode size={16} color="#F4F0FF" />
                        </View>
                        <Text style={styles.iosButtonText}>{t('profile.scan_tickets')}</Text>
                        <ChevronRight size={16} color="#C4C4D4" />
                      </TouchableOpacity>
                    </GlassView>
                  </View>
                </>
              )}

              {/* Security — visible to all users */}
              <Text style={styles.sectionHeader}>Seguridad</Text>
              <View style={styles.iosGroup}>
                <GlassView intensity={14} style={[styles.iosGroupContainer, profileAppearance.card]}>
                  <TouchableOpacity
                    activeOpacity={0.75}
                    onPress={openChangePwd}
                    style={[styles.iosButtonRow, profileAppearance.actionRow]}
                  >
                    <View style={[styles.iosIcon, { backgroundColor: '#28243D' }]}>
                      <ShieldCheck size={16} color="#F4F0FF" />
                    </View>
                    <Text style={styles.iosButtonText}>Cambiar contraseña</Text>
                    <ChevronRight size={16} color="#C4C4D4" />
                  </TouchableOpacity>
                </GlassView>
              </View>

              {/* Support — visible to all users */}
              <Text style={styles.sectionHeader}>Ayuda y Soporte</Text>
              <View style={styles.iosGroup}>
                <GlassView intensity={14} style={[styles.iosGroupContainer, profileAppearance.card]}>
                  <TouchableOpacity
                    activeOpacity={0.75}
                    onPress={() => setSupportOpen(true)}
                    style={[styles.iosButtonRow, profileAppearance.actionRow]}
                  >
                    <View style={[styles.iosIcon, { backgroundColor: '#28243D' }]}>
                      <MessageCircle size={16} color="#F4F0FF" />
                    </View>
                    <Text style={styles.iosButtonText}>Contactar con soporte</Text>
                    <ChevronRight size={16} color="#C4C4D4" />
                  </TouchableOpacity>
                </GlassView>
              </View>

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
               {/* Resale Tab */}
               {loadingResales ? (
                 <View style={{ padding: 40, alignItems: 'center' }}>
                   <DiscoLoader label={t('profile.resale.loading_title')} subLabel={t('profile.resale.loading_subtitle')} size={130} />
                 </View>
               ) : (
                 <View style={{ gap: 24, paddingBottom: 40 }}>

                   {/* ── Earnings balance card ── */}
                   <GlassView intensity={18} style={{ borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(48,209,88,0.25)' }}>
                     <LinearGradient
                       colors={['rgba(48,209,88,0.12)', 'rgba(6,182,212,0.06)', 'transparent']}
                       style={{ padding: 20, flexDirection: 'row', alignItems: 'center', gap: 14 }}
                     >
                       <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(48,209,88,0.15)', alignItems: 'center', justifyContent: 'center' }}>
                         <Wallet size={22} color="#30D158" />
                       </View>
                       <View style={{ flex: 1 }}>
                         <Text style={{ color: '#C4C4D4', fontSize: 12, fontWeight: '500', marginBottom: 2 }}>Ganancias de reventa</Text>
                         <Text style={{ color: '#30D158', fontSize: 26, fontWeight: '700' }}>{balanceReal.toFixed(2)} €</Text>
                         <Text style={{ color: '#C4C4D4', fontSize: 11, marginTop: 2 }}>Disponibles en tu wallet</Text>
                       </View>
                     </LinearGradient>
                   </GlassView>

                   {/* ── Active Listings ── */}
                   <View>
                     <View style={[styles.premiumHeaderRow, { marginTop: 0 }]}>
                       <View style={styles.premiumIconWrap}>
                         <LinearGradient colors={['rgba(124,58,237,0.85)', 'rgba(6,182,212,0.55)', 'rgba(255,255,255,0.10)']} style={styles.premiumIconRing}>
                           <View style={styles.premiumIconInner}><Tag size={16} color="white" /></View>
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
                               onPress={() => { const eid = listing.tickets?.events?.id; if (eid) router.push(`/(tabs)/event/${eid}`); }}
                               style={styles.resaleHeader}
                             >
                               <View style={{ flex: 1 }}>
                                 <Text style={styles.resaleEventTitle}>{listing.tickets?.events?.title || t('home.unknown_event')}</Text>
                                 <Text style={styles.resaleDate}>
                                   {listing.tickets?.events?.event_date ? new Date(listing.tickets.events.event_date).toLocaleDateString(localeTag, { year: 'numeric', month: 'short', day: 'numeric' }) : t('profile.unknown_date')}
                                 </Text>
                               </View>
                               <View style={styles.resalePriceTag}><Text style={styles.resalePrice}>{listing.price}€</Text></View>
                             </TouchableOpacity>
                             <View style={styles.resaleActions}>
                               <TouchableOpacity style={styles.cancelButton} onPress={() => handleCancelResale(listing.id, listing.ticket_id)} disabled={isCancelling}>
                                 <Text style={styles.cancelButtonText}>{t('profile.resale.withdraw')}</Text>
                               </TouchableOpacity>
                             </View>
                           </GlassView>
                         </View>
                       ))
                     ) : (
                       <View style={styles.emptyResaleState}>
                         <GlassView intensity={14} style={[styles.emptyResaleCard, styles.premiumCard]}>
                           <View style={styles.emptyResaleIcon}><Tag size={28} color="#C4C4D4" /></View>
                           <Text style={styles.emptyResaleText}>{t('profile.resale.empty_active')}</Text>
                         </GlassView>
                       </View>
                     )}
                   </View>

                   {/* ── Transaction History ── */}
                   <View>
                     <View style={[styles.premiumHeaderRow, { marginTop: 0 }]}>
                       <View style={styles.premiumIconWrap}>
                         <LinearGradient colors={['rgba(124,58,237,0.85)', 'rgba(6,182,212,0.55)', 'rgba(255,255,255,0.10)']} style={styles.premiumIconRing}>
                           <View style={styles.premiumIconInner}><TrendingUp size={16} color="white" /></View>
                         </LinearGradient>
                       </View>
                       <View style={{ flex: 1 }}>
                         <Text style={styles.premiumTitle}>Historial de transacciones</Text>
                         <Text style={styles.premiumSubtitle}>Tus compras y ventas en reventa</Text>
                       </View>
                     </View>
                     {resaleTransactions.length > 0 ? (
                       resaleTransactions.map((tx) => {
                         const isSeller = tx.seller_id === user?.id;
                         const eventTitle = tx.tickets?.events?.title || t('home.unknown_event');
                         const eventDate = tx.tickets?.events?.event_date
                           ? new Date(tx.tickets.events.event_date).toLocaleDateString(localeTag, { year: 'numeric', month: 'short', day: 'numeric' })
                           : t('profile.unknown_date');
                         const txDate = new Date(tx.created_at).toLocaleDateString(localeTag, { day: 'numeric', month: 'short', year: 'numeric' });
                         const amount = isSeller ? (tx.seller_amount ?? tx.price) : tx.price;
                         return (
                           <View key={tx.id} style={styles.resaleItem}>
                             <GlassView intensity={14} style={[styles.resaleCard, styles.premiumCard, { borderColor: isSeller ? 'rgba(48,209,88,0.2)' : 'rgba(255,159,64,0.2)' }]}>
                               <View style={[styles.resaleHeader, { paddingBottom: 10 }]}>
                                 <View style={{ flex: 1 }}>
                                   <Text style={styles.resaleEventTitle}>{eventTitle}</Text>
                                   <Text style={styles.resaleDate}>{eventDate}</Text>
                                 </View>
                                 <View style={{ alignItems: 'flex-end', gap: 4 }}>
                                   <Text style={{ color: isSeller ? '#30D158' : '#FF9F40', fontSize: 16, fontWeight: '700' }}>
                                     {isSeller ? '+' : '-'}{Number(amount).toFixed(2)}€
                                   </Text>
                                   <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                                     {isSeller ? <TrendingUp size={11} color="#30D158" /> : <Tag size={11} color="#FF9F40" />}
                                     <Text style={{ color: isSeller ? '#30D158' : '#FF9F40', fontSize: 11, fontWeight: '600' }}>
                                       {isSeller ? 'Vendida' : 'Comprada'}
                                     </Text>
                                   </View>
                                 </View>
                               </View>
                               <Text style={{ color: '#C4C4D4', fontSize: 11, paddingHorizontal: 14, paddingBottom: 12 }}>{txDate}</Text>
                             </GlassView>
                           </View>
                         );
                       })
                     ) : (
                       <View style={styles.emptyResaleState}>
                         <GlassView intensity={14} style={[styles.emptyResaleCard, styles.premiumCard]}>
                           <View style={styles.emptyResaleIcon}><TrendingUp size={28} color="#C4C4D4" /></View>
                           <Text style={styles.emptyResaleText}>Aún no tienes transacciones de reventa</Text>
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


      {/* ── Support Modal ── */}
      <Modal visible={supportOpen} transparent animationType="slide" statusBarTranslucent onRequestClose={() => setSupportOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1, justifyContent: 'flex-end' }}>
          <TouchableOpacity style={StyleSheet.absoluteFillObject} activeOpacity={1} onPress={() => setSupportOpen(false)} />
          <View style={supportStyles.sheet}>
            <LinearGradient colors={['rgba(5,30,60,0.99)', 'rgba(3,3,14,0.99)']} style={StyleSheet.absoluteFillObject} />

            {/* Handle */}
            <View style={supportStyles.handle} />

            {/* Header */}
            <View style={supportStyles.header}>
              <View style={supportStyles.headerIcon}>
                <MessageCircle size={20} color="#0EA5E9" />
              </View>
              <Text style={supportStyles.headerTitle}>Contactar con soporte</Text>
              <TouchableOpacity onPress={() => setSupportOpen(false)} style={supportStyles.closeBtn} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
                <X size={20} color="#A1A1AA" />
              </TouchableOpacity>
            </View>

            {/* Body */}
            <ScrollView
              style={supportStyles.body}
              contentContainerStyle={{ paddingBottom: 24 }}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <Text style={supportStyles.label}>Categoría</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 20 }}>
                {SUPPORT_CATEGORIES.map((cat) => (
                  <TouchableOpacity
                    key={cat}
                    activeOpacity={0.75}
                    onPress={() => setSupportCategory(cat)}
                    style={[supportStyles.chip, supportCategory === cat && supportStyles.chipActive]}
                  >
                    <Text style={[supportStyles.chipTxt, supportCategory === cat && supportStyles.chipTxtActive]}>{cat}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              <Text style={supportStyles.label}>Mensaje</Text>
              <TextInput
                value={supportMessage}
                onChangeText={setSupportMessage}
                placeholder="Describe tu problema o pregunta con el mayor detalle posible..."
                placeholderTextColor="rgba(255,255,255,0.35)"
                multiline
                numberOfLines={6}
                textAlignVertical="top"
                style={supportStyles.textarea}
              />

              <Text style={supportStyles.hint}>
                Tu mensaje llegará a {SUPPORT_EMAIL} junto con tu nombre, email e ID para que podamos atenderte rápido.
              </Text>

              <TouchableOpacity
                activeOpacity={0.8}
                onPress={handleSendSupport}
                disabled={supportSending || !supportMessage.trim()}
                style={[supportStyles.sendBtn, (supportSending || !supportMessage.trim()) && { opacity: 0.4 }]}
              >
                <MessageCircle size={16} color="#FFF" />
                <Text style={supportStyles.sendTxt}>{supportSending ? 'Abriendo correo...' : 'Enviar mensaje'}</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── Change Password Modal ── */}
      <Modal visible={changePwdOpen} transparent animationType="slide" onRequestClose={() => setChangePwdOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
          <View style={pwdStyles.backdrop}>
            <TouchableOpacity style={StyleSheet.absoluteFillObject} activeOpacity={1} onPress={() => setChangePwdOpen(false)} />
            <View style={pwdStyles.sheet}>
              <LinearGradient colors={['rgba(30,20,70,0.99)', 'rgba(5,5,16,0.99)']} style={StyleSheet.absoluteFillObject} />

              {/* Handle */}
              <View style={pwdStyles.handle} />

              {/* Header */}
              <View style={pwdStyles.header}>
                <View style={pwdStyles.headerIcon}>
                  <ShieldCheck size={20} color="#F59E0B" />
                </View>
                <Text style={pwdStyles.headerTitle}>
                  {pwdStep === 'done' ? '¡Contraseña actualizada!' : 'Cambiar contraseña'}
                </Text>
                <TouchableOpacity onPress={() => setChangePwdOpen(false)} style={pwdStyles.closeBtn} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
                  <X size={20} color="#A1A1AA" />
                </TouchableOpacity>
              </View>

              {pwdStep === 'done' ? (
                /* ── Success ── */
                <View style={pwdStyles.doneWrap}>
                  <LinearGradient colors={['#22c55e', '#16a34a']} style={pwdStyles.doneIcon}>
                    <ShieldCheck size={36} color="white" />
                  </LinearGradient>
                  <Text style={pwdStyles.doneTitle}>Contraseña cambiada</Text>
                  <Text style={pwdStyles.doneBody}>Tu contraseña se ha actualizado correctamente. La próxima vez que inicies sesión deberás usar la nueva.</Text>
                  <TouchableOpacity onPress={() => setChangePwdOpen(false)} style={pwdStyles.doneBtn} activeOpacity={0.85}>
                    <LinearGradient colors={['#22c55e', '#16a34a']} style={pwdStyles.doneBtnGrad}>
                      <Text style={pwdStyles.doneBtnTxt}>Entendido</Text>
                    </LinearGradient>
                  </TouchableOpacity>
                </View>
              ) : (
                <ScrollView contentContainerStyle={pwdStyles.body} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>

                  {pwdStep === 'verify' ? (
                    /* ── Step 1: verify current password ── */
                    <>
                      <Text style={pwdStyles.stepLabel}>PASO 1 DE 2</Text>
                      <Text style={pwdStyles.stepTitle}>Verifica tu identidad</Text>
                      <Text style={pwdStyles.stepDesc}>Por seguridad, introduce tu contraseña actual antes de cambiarla.</Text>

                      <Text style={pwdStyles.fieldLabel}>Contraseña actual</Text>
                      <View style={pwdStyles.inputWrap}>
                        <TextInput
                          style={pwdStyles.input}
                          placeholder="Tu contraseña actual"
                          placeholderTextColor="rgba(161,161,170,0.5)"
                          secureTextEntry={!pwdShowCurrent}
                          value={pwdCurrent}
                          onChangeText={t => { setPwdCurrent(t); setPwdError(''); }}
                          autoCapitalize="none"
                          autoCorrect={false}
                        />
                        <TouchableOpacity onPress={() => setPwdShowCurrent(v => !v)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                          {pwdShowCurrent ? <EyeOff size={18} color="#A1A1AA" /> : <Eye size={18} color="#A1A1AA" />}
                        </TouchableOpacity>
                      </View>

                      {!!pwdError && <View style={pwdStyles.errorBox}><Text style={pwdStyles.errorTxt}>{pwdError}</Text></View>}

                      <TouchableOpacity
                        onPress={handleVerifyPassword}
                        style={[pwdStyles.primaryBtn, pwdLoading && { opacity: 0.6 }]}
                        disabled={pwdLoading}
                        activeOpacity={0.85}
                      >
                        <LinearGradient colors={['#F59E0B', '#D97706']} style={pwdStyles.primaryBtnGrad} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}>
                          {pwdLoading
                            ? <DiscoLoader size={22} />
                            : <Text style={pwdStyles.primaryBtnTxt}>Verificar identidad</Text>}
                        </LinearGradient>
                      </TouchableOpacity>
                    </>
                  ) : (
                    /* ── Step 2: enter new password ── */
                    <>
                      <Text style={pwdStyles.stepLabel}>PASO 2 DE 2</Text>
                      <Text style={pwdStyles.stepTitle}>Nueva contraseña</Text>
                      <Text style={pwdStyles.stepDesc}>Elige una contraseña segura: mínimo 8 caracteres, una mayúscula y un número.</Text>

                      {/* Requirements */}
                      <View style={pwdStyles.reqBox}>
                        {[
                          { ok: pwdNew.length >= 8,          label: 'Mínimo 8 caracteres' },
                          { ok: /[A-Z]/.test(pwdNew),        label: 'Una letra mayúscula' },
                          { ok: /[0-9]/.test(pwdNew),        label: 'Un número' },
                          { ok: pwdNew === pwdConfirm && pwdNew.length > 0, label: 'Las contraseñas coinciden' },
                        ].map(r => (
                          <View key={r.label} style={pwdStyles.reqRow}>
                            <Text style={[pwdStyles.reqDot, r.ok && pwdStyles.reqDotOk]}>{r.ok ? '✓' : '○'}</Text>
                            <Text style={[pwdStyles.reqTxt, r.ok && pwdStyles.reqTxtOk]}>{r.label}</Text>
                          </View>
                        ))}
                      </View>

                      <Text style={pwdStyles.fieldLabel}>Nueva contraseña</Text>
                      <View style={pwdStyles.inputWrap}>
                        <TextInput
                          style={pwdStyles.input}
                          placeholder="Nueva contraseña"
                          placeholderTextColor="rgba(161,161,170,0.5)"
                          secureTextEntry={!pwdShowNew}
                          value={pwdNew}
                          onChangeText={t => { setPwdNew(t); setPwdError(''); }}
                          autoCapitalize="none"
                          autoCorrect={false}
                        />
                        <TouchableOpacity onPress={() => setPwdShowNew(v => !v)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                          {pwdShowNew ? <EyeOff size={18} color="#A1A1AA" /> : <Eye size={18} color="#A1A1AA" />}
                        </TouchableOpacity>
                      </View>

                      <Text style={pwdStyles.fieldLabel}>Confirmar contraseña</Text>
                      <View style={pwdStyles.inputWrap}>
                        <TextInput
                          style={pwdStyles.input}
                          placeholder="Repite la nueva contraseña"
                          placeholderTextColor="rgba(161,161,170,0.5)"
                          secureTextEntry={!pwdShowConfirm}
                          value={pwdConfirm}
                          onChangeText={t => { setPwdConfirm(t); setPwdError(''); }}
                          autoCapitalize="none"
                          autoCorrect={false}
                        />
                        <TouchableOpacity onPress={() => setPwdShowConfirm(v => !v)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                          {pwdShowConfirm ? <EyeOff size={18} color="#A1A1AA" /> : <Eye size={18} color="#A1A1AA" />}
                        </TouchableOpacity>
                      </View>

                      {!!pwdError && <View style={pwdStyles.errorBox}><Text style={pwdStyles.errorTxt}>{pwdError}</Text></View>}

                      <TouchableOpacity
                        onPress={handleChangePassword}
                        style={[pwdStyles.primaryBtn, pwdLoading && { opacity: 0.6 }]}
                        disabled={pwdLoading}
                        activeOpacity={0.85}
                      >
                        <LinearGradient colors={['#7C3AED', '#5B21B6']} style={pwdStyles.primaryBtnGrad} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}>
                          {pwdLoading
                            ? <DiscoLoader size={22} />
                            : <Text style={pwdStyles.primaryBtnTxt}>Guardar nueva contraseña</Text>}
                        </LinearGradient>
                      </TouchableOpacity>
                    </>
                  )}
                </ScrollView>
              )}
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={profileEditOpen} transparent animationType="slide" onRequestClose={closeProfileEdit}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1 }}
        >
          <View style={styles.modalBackdrop}>
            <GlassView
              intensity={14}
              style={[styles.modalCard, styles.premiumCard, { height: profileEditModalHeight, paddingBottom: insets.bottom + 12 }]}
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
                        maxLength={80}
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
                        <Text style={styles.modalLabel}>Fecha de nacimiento</Text>
                        <TouchableOpacity
                          activeOpacity={0.7}
                          onPress={() => setShowDatePicker(true)}
                          style={[styles.modalInput, { justifyContent: 'center', height: 48 }]}
                        >
                          <Text style={{ color: profileDraft.birthdate ? 'white' : 'rgba(255,255,255,0.4)', fontSize: 15, fontWeight: '600' }}>
                            {profileDraft.birthdate
                              ? new Date(profileDraft.birthdate + 'T12:00:00').toLocaleDateString(localeTag, { day: '2-digit', month: 'long', year: 'numeric' })
                              : 'Seleccionar fecha'}
                          </Text>
                        </TouchableOpacity>
                        {profileDraft.birthdate ? (
                          <Text style={{ color: '#C4C4D4', fontSize: 12, marginTop: 4 }}>
                            {(() => {
                              const bd = new Date(profileDraft.birthdate + 'T12:00:00');
                              const today = new Date();
                              let y = today.getFullYear() - bd.getFullYear();
                              const m = today.getMonth() - bd.getMonth();
                              if (m < 0 || (m === 0 && today.getDate() < bd.getDate())) y--;
                              return `${y} años`;
                            })()}
                          </Text>
                        ) : null}
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
          </View>
        </KeyboardAvoidingView>

        {/* ── Fecha de nacimiento: Android native dialog ── */}
        {showDatePicker && Platform.OS === 'android' && (
          <DateTimePicker
            value={profileDraft.birthdate ? new Date(profileDraft.birthdate + 'T12:00:00') : new Date(new Date().setFullYear(new Date().getFullYear() - 18))}
            mode="date"
            display="default"
            maximumDate={new Date(new Date().setFullYear(new Date().getFullYear() - 16))}
            minimumDate={new Date(new Date().setFullYear(new Date().getFullYear() - 100))}
            onChange={(_, date) => {
              setShowDatePicker(false);
              if (date) {
                const y = date.getFullYear();
                const mo = String(date.getMonth() + 1).padStart(2, '0');
                const d = String(date.getDate()).padStart(2, '0');
                setProfileField('birthdate', `${y}-${mo}-${d}`);
              }
            }}
          />
        )}

        {/* ── Fecha de nacimiento: iOS bottom sheet ── */}
        {Platform.OS === 'ios' && showDatePicker && (
          <Modal visible transparent animationType="slide" statusBarTranslucent onRequestClose={() => setShowDatePicker(false)}>
            <Pressable style={dobStyles.backdrop} onPress={() => setShowDatePicker(false)}>
              <Pressable style={dobStyles.sheet} onPress={e => e.stopPropagation()}>
                <LinearGradient colors={['#1e1440', '#05050F']} style={StyleSheet.absoluteFillObject} />
                <View style={dobStyles.sheetHeader}>
                  <Text style={dobStyles.sheetTitle}>Fecha de nacimiento</Text>
                  <TouchableOpacity onPress={() => setShowDatePicker(false)} style={dobStyles.doneBtn}>
                    <Text style={dobStyles.doneTxt}>Listo</Text>
                  </TouchableOpacity>
                </View>
                <DateTimePicker
                  value={profileDraft.birthdate ? new Date(profileDraft.birthdate + 'T12:00:00') : new Date(new Date().setFullYear(new Date().getFullYear() - 18))}
                  mode="date"
                  display="spinner"
                  textColor="white"
                  themeVariant="dark"
                  maximumDate={new Date(new Date().setFullYear(new Date().getFullYear() - 16))}
                  minimumDate={new Date(new Date().setFullYear(new Date().getFullYear() - 100))}
                  style={dobStyles.picker}
                  onChange={(_, date) => {
                    if (date) {
                      const y = date.getFullYear();
                      const mo = String(date.getMonth() + 1).padStart(2, '0');
                      const d = String(date.getDate()).padStart(2, '0');
                      setProfileField('birthdate', `${y}-${mo}-${d}`);
                    }
                  }}
                />
              </Pressable>
            </Pressable>
          </Modal>
        )}
      </Modal>
    </View>
  );
}

// ── Support constants (module-level) ──────────────────────────────────────────
const SUPPORT_CATEGORIES = ['Problema técnico', 'Pago / tickets', 'Cuenta', 'Evento', 'Otro'];
const SUPPORT_EMAIL = 'soporte@weareeclipseoficial.com';

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
    backgroundColor: '#1C1C2E',
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
    color: '#C4C4D4',
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
    color: '#C4C4D4',
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
    color: '#C4C4D4',
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
    color: '#C4C4D4',
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
    color: '#C4C4D4',
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
    color: '#C4C4D4',
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
    color: '#C4C4D4',
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
    color: '#C4C4D4',
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
    color: '#C4C4D4',
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
    color: '#C4C4D4',
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
    color: '#A8A8BE',
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
    color: '#C4C4D4',
    fontSize: 16,
    fontWeight: '600',
  },
});

// ── Support modal styles ──────────────────────────────────────────────────────
const supportStyles = StyleSheet.create({
  sheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    overflow: 'hidden',
    maxHeight: '88%',
  },
  handle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignSelf: 'center', marginTop: 12, marginBottom: 4,
  },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 20, paddingVertical: 16,
    borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.07)',
  },
  headerIcon: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: 'rgba(14,165,233,0.18)',
    alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { flex: 1, color: 'white', fontSize: 17, fontWeight: '800' },
  closeBtn: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.07)',
    alignItems: 'center', justifyContent: 'center',
  },
  body: {
    paddingHorizontal: 20,
    paddingTop: 20,
  },
  label: {
    color: '#C4C4D4',
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    marginRight: 8,
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  chipActive: {
    borderColor: '#0EA5E9',
    backgroundColor: 'rgba(14,165,233,0.18)',
  },
  chipTxt: {
    color: '#C4C4D4',
    fontSize: 13,
    fontWeight: '500',
  },
  chipTxtActive: {
    color: '#0EA5E9',
    fontWeight: '700',
  },
  textarea: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    borderRadius: 12,
    padding: 14,
    color: '#fff',
    fontSize: 15,
    minHeight: 130,
    marginBottom: 12,
  },
  hint: {
    color: '#C4C4D4',
    fontSize: 12,
    lineHeight: 17,
    marginBottom: 20,
  },
  sendBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.dark.primarySoft,
    borderRadius: 14,
    paddingVertical: 14,
  },
  sendTxt: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
});

// ── Birthdate picker modal styles ─────────────────────────────────────────────
const dobStyles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: 'hidden',
    paddingBottom: 32,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  sheetTitle: { color: 'white', fontSize: 16, fontWeight: '700' },
  doneBtn: { paddingVertical: 6, paddingHorizontal: 4 },
  doneTxt: { color: '#C4B5FD', fontSize: 16, fontWeight: '800' },
  picker: { width: '100%', height: 220 },
});

// ── Change-password modal styles ──────────────────────────────────────────────
const pwdStyles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  sheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    overflow: 'hidden',
    maxHeight: '92%',
  },
  handle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignSelf: 'center', marginTop: 12, marginBottom: 4,
  },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 20, paddingVertical: 16,
    borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.07)',
  },
  headerIcon: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: 'rgba(245,158,11,0.15)',
    alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { flex: 1, color: 'white', fontSize: 17, fontWeight: '800' },
  closeBtn: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.07)',
    alignItems: 'center', justifyContent: 'center',
  },
  body: { padding: 20, paddingBottom: 36, gap: 4 },
  stepLabel: {
    color: '#F59E0B', fontSize: 11, fontWeight: '800', letterSpacing: 1.2,
    marginBottom: 4,
  },
  stepTitle: { color: 'white', fontSize: 20, fontWeight: '900', marginBottom: 6 },
  stepDesc: { color: '#C4C4D4', fontSize: 14, lineHeight: 20, marginBottom: 20 },
  fieldLabel: { color: '#C4C4D4', fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 8, marginTop: 12 },
  inputWrap: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: 14, paddingHorizontal: 16, paddingVertical: 14,
    gap: 10,
  },
  input: { flex: 1, color: 'white', fontSize: 16, padding: 0 },
  reqBox: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
    padding: 14, gap: 8, marginBottom: 4,
  },
  reqRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  reqDot: { color: 'rgba(255,255,255,0.3)', fontSize: 14, fontWeight: '700', width: 18 },
  reqDotOk: { color: '#22c55e' },
  reqTxt: { color: '#C4C4D4', fontSize: 13 },
  reqTxtOk: { color: 'rgba(255,255,255,0.8)' },
  errorBox: {
    marginTop: 10,
    backgroundColor: 'rgba(239,68,68,0.12)',
    borderRadius: 12, borderWidth: 1, borderColor: 'rgba(239,68,68,0.25)',
    padding: 12,
  },
  errorTxt: { color: '#EF4444', fontSize: 13, fontWeight: '600' },
  primaryBtn: { borderRadius: 16, overflow: 'hidden', marginTop: 20 },
  primaryBtnGrad: { paddingVertical: 16, alignItems: 'center', justifyContent: 'center', minHeight: 52 },
  primaryBtnTxt: { color: 'white', fontSize: 16, fontWeight: '800' },
  // Done screen
  doneWrap: { alignItems: 'center', padding: 32, gap: 16 },
  doneIcon: { width: 80, height: 80, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  doneTitle: { color: 'white', fontSize: 22, fontWeight: '900', textAlign: 'center' },
  doneBody: { color: '#C4C4D4', fontSize: 14, textAlign: 'center', lineHeight: 21 },
  doneBtn: { borderRadius: 16, overflow: 'hidden', width: '100%', marginTop: 8 },
  doneBtnGrad: { paddingVertical: 16, alignItems: 'center' },
  doneBtnTxt: { color: 'white', fontSize: 16, fontWeight: '800' },
});

