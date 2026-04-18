import { View, Text, StyleSheet, TouchableOpacity, Alert, Platform, ScrollView, Image, RefreshControl, StatusBar, Modal, TextInput, KeyboardAvoidingView } from 'react-native';
import { router } from 'expo-router';
import { useAuth } from '@/lib/AuthContext';
import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { User, Ticket, ChevronRight, Tag, TrendingUp, UserPlus, Calendar, Sparkles, CheckCircle2, ShieldCheck, Wallet, QrCode, Clock, MapPin, Pencil, X, FileText } from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Colors } from '@/constants/Colors';
import { GlassView } from '@/components/ui/GlassView';
import { ThemedButton } from '@/components/ui/ThemedButton';
import { DiscoLoader } from '@/components/ui/DiscoLoader';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useResponsive } from '@/lib/responsive';
import * as Haptics from 'expo-haptics';
import { useFocusEffect } from '@react-navigation/native';
import { useEvents } from '@/lib/EventContext';
import { useTranslation } from 'react-i18next';
import { useI18n } from '@/lib/I18nContext';
import { invokeEdgeFunction } from '@/lib/edgeFunctions';
// import Animated, { FadeInDown, FadeInUp, ZoomIn, useSharedValue, useAnimatedStyle, withRepeat, withTiming, Easing, withSequence, withDelay, interpolate, Extrapolate, runOnJS } from 'react-native-reanimated';

// const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export default function ProfileScreen() {
  const { user, signOut, loading, workerProfile } = useAuth();
  const { events, refreshEvents } = useEvents();
  const { t } = useTranslation();
  const { language, setLanguage, setDeviceLanguage } = useI18n();
  const localeTag = language === 'en' ? 'en-US' : language === 'fr' ? 'fr-FR' : 'es-ES';
  const insets = useSafeAreaInsets();
  const { horizontalPadding, maxContentWidth } = useResponsive();
  
  const [activeTab, setActiveTab] = useState<'profile' | 'panel' | 'account' | 'resale'>('profile');
  const [organizerStats, setOrganizerStats] = useState<{ revenue: number; tickets: number }>({ revenue: 0, tickets: 0 });
  const [verificationStatus, setVerificationStatus] = useState<'pending_verification' | 'verified' | 'rejected' | 'needs_correction' | null>(null);
  const [profileRole, setProfileRole] = useState<'organizer' | 'attendee' | 'admin' | null>(null);
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
  const [organizerEventCounts, setOrganizerEventCounts] = useState<{ total: number; upcoming: number }>({ total: 0, upcoming: 0 });
  const [resaleListings, setResaleListings] = useState<any[]>([]);
  const [loadingResales, setLoadingResales] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editDraft, setEditDraft] = useState({
    club_name: '',
    business_email: '',
    instagram_account: '',
    city: '',
    country: '',
    address: '',
    phone: '',
  });

  const activeListings = useMemo(() => resaleListings.filter(l => l.status === 'active'), [resaleListings]);

  useFocusEffect(
    useCallback(() => {
      refreshEvents();
    }, [refreshEvents])
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

  const openLanguagePicker = () => {
    Alert.alert(t('profile.change_language'), undefined, [
      { text: 'Idioma del dispositivo', onPress: () => void setDeviceLanguage() },
      { text: 'Español', onPress: () => void setLanguage('es') },
      { text: 'English', onPress: () => void setLanguage('en') },
      { text: 'Français', onPress: () => void setLanguage('fr') },
      { text: t('common.cancel'), style: 'cancel' },
    ]);
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

  // Fetch Profile Stats
  useEffect(() => {
    if (!user?.id) return;

    const fetchStats = async () => {
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
            const nowIso = new Date().toISOString();
            const [allEvents, upcomingEvents, myEvents] = await Promise.all([
              supabase.from('events').select('id', { count: 'exact', head: true }).eq('creator_id', user.id),
              supabase.from('events').select('id', { count: 'exact', head: true }).eq('creator_id', user.id).gte('event_date', nowIso),
              supabase.from('events').select('id').eq('creator_id', user.id),
            ]);
            setOrganizerEventCounts({
              total: allEvents.count ?? 0,
              upcoming: upcomingEvents.count ?? 0,
            });

            const myEventIds = ((myEvents.data ?? []) as any[]).map((e) => e.id).filter(Boolean);
            if (!myEventIds.length) {
              setOrganizerStats({ revenue: 0, tickets: 0 });
              return;
            }

            const { data: ticketsRows, error: ticketsError } = await supabase
              .from('tickets')
              .select('total_price, quantity, event_id, purchase_date')
              .in('event_id', myEventIds);

            if (ticketsError) throw ticketsError;

            const rows = (ticketsRows ?? []) as any[];
            const revenue = rows.reduce((acc, r) => acc + (Number(r.total_price) || 0), 0);
            const tickets = rows.reduce((acc, r) => acc + (Number(r.quantity) || 0), 0);
            setOrganizerStats({ revenue, tickets });
          } else {
            setOrganizerStats({ revenue: 0, tickets: 0 });
            setVerificationStatus(null);
            setOrganizerMeta(null);
            setOrganizerEventCounts({ total: 0, upcoming: 0 });
          }
        }
      } catch (e) {
        console.error('Error fetching stats:', e);
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
              setOrganizerEventCounts({ total: 0, upcoming: 0 });
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
    if (profileRole === 'organizer' && activeTab === 'profile') setActiveTab('panel');
    if (profileRole !== 'organizer' && activeTab === 'panel') setActiveTab('profile');
    if (profileRole === 'organizer' && activeTab === 'account') return;
    if (profileRole !== 'organizer' && activeTab === 'account') setActiveTab('profile');
  }, [profileRole, activeTab]);

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

  const openEditOrganizer = () => {
    if (!isOrganizer) return;
    setEditDraft({
      club_name: organizerMeta?.club_name ?? '',
      business_email: organizerMeta?.business_email ?? '',
      instagram_account: organizerMeta?.instagram_account ?? '',
      city: organizerMeta?.city ?? '',
      country: organizerMeta?.country ?? '',
      address: (organizerMeta?.address as any) ?? '',
      phone: (organizerMeta?.phone as any) ?? '',
    });
    setEditOpen(true);
  };

  const saveOrganizerEdits = async () => {
    if (!user?.id) return;
    setSavingEdit(true);
    try {
      const normalize = (v: string) => {
        const t = (v || '').trim();
        return t.length ? t : null;
      };

      const payload = {
        club_name: normalize(editDraft.club_name),
        business_email: normalize(editDraft.business_email),
        instagram_account: normalize(editDraft.instagram_account),
        city: normalize(editDraft.city),
        country: normalize(editDraft.country),
        address: normalize(editDraft.address),
        phone: normalize(editDraft.phone),
        updated_at: new Date().toISOString(),
      };

      const { error } = await supabase.from('profiles').update(payload).eq('id', user.id);
      if (error) throw error;
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
      setEditOpen(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      Alert.alert('Error', e?.message ? String(e.message) : 'No se pudo guardar el perfil.');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setSavingEdit(false);
    }
  };

  const handleCancelResale = async (_listingId: string, ticketId: string) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    Alert.alert(
      'Cancelar Venta',
      '¿Estás seguro de que quieres retirar esta entrada de la reventa? Volverá a estar disponible en tus entradas.',
      [
        { text: 'No', style: 'cancel' },
        {
          text: 'Sí, retirar',
          onPress: async () => {
            try {
              setIsCancelling(true);
              
              if (!ticketId) throw new Error('Ticket inválido');

              const { error } = await supabase.rpc('cancel_resale_listing_secure', {
                p_ticket_id: ticketId,
              });

              if (error) throw error;
              
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              fetchResales();
            } catch (error: any) {
              console.error('Cancel Resale Error:', error);
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
              Alert.alert('Error', 'No se pudo cancelar la venta: ' + error.message);
            } finally {
              setIsCancelling(false);
            }
          }
        }
      ]
    );
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
      Alert.alert(
        'Cerrar Sesión',
        '¿Estás seguro que deseas cerrar sesión?',
        [
          { text: 'Cancelar', style: 'cancel' },
          {
            text: 'Cerrar Sesión',
            style: 'destructive',
            onPress: async () => {
              try {
                await signOut();
                router.replace('/(auth)/login');
              } catch (error) {
                Alert.alert('Error', 'No se pudo cerrar sesión');
              }
            },
          },
        ]
      );
    }
  };

  const handleDeleteAccount = () => {
    if (deletingAccount) return;
    Alert.alert(
      'Eliminar cuenta',
      'Esto eliminará tu cuenta y tus datos. Esta acción no se puede deshacer.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar',
          style: 'destructive',
          onPress: async () => {
            try {
              setDeletingAccount(true);
              const { error } = await invokeEdgeFunction('delete-account', {});
              if (error) throw new Error(String(error.message || 'No se pudo eliminar la cuenta.'));
              await signOut();
              router.replace('/(auth)/login');
            } catch (e: any) {
              Alert.alert('Error', String(e?.message || 'No se pudo eliminar la cuenta.'));
            } finally {
              setDeletingAccount(false);
            }
          },
        },
      ]
    );
  };

  const formatDate = (dateString: string) => {
    try {
      return new Date(dateString).toLocaleDateString(localeTag, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
    } catch (e) {
      return t('profile.unknown_date');
    }
  };

  if (!user) {
    return (
      <View style={styles.container}>
        <StatusBar barStyle="light-content" />
        <LinearGradient
          colors={[Colors.dark.background, '#1e1b4b']}
          style={StyleSheet.absoluteFill}
        />
        <View style={styles.ambientGlowTop} />
        <View style={styles.ambientGlowBottom} />

        <View style={styles.authPrompt}>
          <GlassView intensity={40} style={styles.authCard}>
            <View style={styles.iconContainer}>
              <User size={48} color={Colors.dark.primary} />
            </View>
            <Text style={styles.authPromptTitle}>Mi Perfil</Text>
            <Text style={styles.authPromptText}>
              Inicia sesión para acceder a tu perfil y gestionar tus entradas
            </Text>
            
            <ThemedButton 
              title="Iniciar Sesión" 
              onPress={() => router.push('/(auth)/login')} 
              style={styles.authButton}
            />
            
            <ThemedButton 
              title="Crear Cuenta" 
              onPress={() => router.push('/(auth)/register')} 
              variant="outline"
              style={styles.authButton}
            />
          </GlassView>
        </View>
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
      
      {/* Subtle Ambient Glow (Blue/Purple for Night Vibe) */}
      <View style={styles.ambientGlowTop} />
      <View style={styles.ambientGlowBottom} />
      
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
                      Alert.alert('Cuenta suspendida', organizerMeta?.suspended_reason ? organizerMeta.suspended_reason : 'Esta cuenta está suspendida.');
                    }}
                    style={{ marginTop: 10, alignSelf: 'stretch', maxWidth: '100%' }}
                  >
                    <View style={[styles.verificationPill, { backgroundColor: 'rgba(239,68,68,0.12)', borderColor: 'rgba(239,68,68,0.35)' }]}>
                      <ShieldCheck size={14} color="#ef4444" />
                      <Text style={[styles.verificationPillText, { color: '#ef4444' }]} numberOfLines={1}>
                        Cuenta suspendida
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
                        Alert.alert(
                          'Verificación rechazada',
                          reason ? `Motivo: ${reason}\n\nNo puedes volver a enviar la solicitud.` : 'No puedes volver a enviar la solicitud.'
                        );
                        return;
                      }
                      if (verificationStatus === 'needs_correction') {
                        const note = organizerMeta?.verification_rejection_reason?.toString().trim();
                        if (note) {
                          Alert.alert('Corrección requerida', note, [
                            { text: 'Ir a verificación', onPress: () => router.push('/(creator)/verification') },
                            { text: 'Cerrar', style: 'cancel' },
                          ]);
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
                          ? 'Verificado'
                          : verificationStatus === 'needs_correction'
                            ? 'Corrección requerida'
                            : verificationStatus === 'rejected'
                              ? 'Verificación rechazada'
                              : 'Verificación pendiente'}
                      </Text>
                      {verificationStatus !== 'verified' && <ChevronRight size={14} color="rgba(255,255,255,0.55)" />}
                    </View>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          </GlassView>

          {/* Floating Segmented Control - Visible only for Clients */}
          {profileRole && (
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
                          <Text style={styles.alertTitle}>Cuenta suspendida</Text>
                          <Text style={styles.alertText}>{organizerMeta?.suspended_reason ? organizerMeta.suspended_reason : 'Esta cuenta está suspendida.'}</Text>
                        </GlassView>
                      )}

                      {!isOrganizerSuspended && verificationStatus !== 'verified' && (
                        <GlassView intensity={14} style={[styles.alertCard, styles.premiumCard, { borderColor: 'rgba(245,158,11,0.35)' }]}>
                          <Text style={styles.alertTitle}>Verificación pendiente</Text>
                          <Text style={styles.alertText}>Completa la verificación para publicar y editar eventos.</Text>
                          <View style={{ marginTop: 12 }}>
                            <ThemedButton title="Ir a verificación" onPress={() => router.push('/(creator)/verification')} />
                          </View>
                        </GlassView>
                      )}

                      <GlassView intensity={18} style={[styles.organizerHeroCard, styles.premiumCard]}>
                        <LinearGradient
                          colors={['rgba(255,255,255,0.08)', 'rgba(48, 209, 88, 0.16)', 'transparent']}
                          style={StyleSheet.absoluteFill}
                        />
                        <Text style={styles.organizerHeroLabel}>Total generado</Text>
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
                          <Text style={styles.premiumTitle}>Acciones</Text>
                          <Text style={styles.premiumSubtitle}>Atajos rápidos para gestionar.</Text>
                        </View>
                      </View>
                      <View style={styles.iosGroup}>
                        <GlassView intensity={14} style={[styles.iosGroupContainer, styles.premiumCard]}>
                          <TouchableOpacity
                            activeOpacity={0.75}
                            onPress={() => {
                              if (!canOrganizerPublish) {
                                Alert.alert(
                                  'Acción no disponible',
                                  isOrganizerSuspended
                                    ? 'Tu cuenta está suspendida.'
                                    : 'Completa la verificación para poder publicar eventos.'
                                );
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
                            <Text style={styles.iosButtonText}>Crear evento</Text>
                            <ChevronRight size={16} color="#8E8E93" />
                          </TouchableOpacity>
                          <View style={styles.iosDivider} />
                          <TouchableOpacity activeOpacity={0.75} onPress={() => router.push('/(creator)/manage-events')} style={styles.iosButtonRow}>
                            <View style={[styles.iosIcon, { backgroundColor: '#38bdf8' }]}>
                              <MapPin size={16} color="#0B0B0F" />
                            </View>
                            <Text style={styles.iosButtonText}>Mis eventos</Text>
                            <ChevronRight size={16} color="#8E8E93" />
                          </TouchableOpacity>
                          <View style={styles.iosDivider} />
                          <TouchableOpacity activeOpacity={0.75} onPress={() => router.push('/(creator)/scan')} style={styles.iosButtonRow}>
                            <View style={[styles.iosIcon, { backgroundColor: '#0A84FF' }]}>
                              <QrCode size={16} color="#FFF" />
                            </View>
                            <Text style={styles.iosButtonText}>Escanear</Text>
                            <ChevronRight size={16} color="#8E8E93" />
                          </TouchableOpacity>
                          <View style={styles.iosDivider} />
                          <TouchableOpacity activeOpacity={0.75} onPress={() => router.push('/(creator)/workers')} style={styles.iosButtonRow}>
                            <View style={[styles.iosIcon, { backgroundColor: '#a855f7' }]}>
                              <UserPlus size={16} color="#FFF" />
                            </View>
                            <Text style={styles.iosButtonText}>Personal</Text>
                            <ChevronRight size={16} color="#8E8E93" />
                          </TouchableOpacity>
                          <View style={styles.iosDivider} />
                          <TouchableOpacity activeOpacity={0.75} onPress={() => router.push('/(creator)/stats')} style={styles.iosButtonRow}>
                            <View style={[styles.iosIcon, { backgroundColor: '#30D158' }]}>
                              <TrendingUp size={16} color="#0B0B0F" />
                            </View>
                            <Text style={styles.iosButtonText}>Estadísticas</Text>
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
                          <Text style={styles.premiumTitle}>Próximos eventos</Text>
                          <Text style={styles.premiumSubtitle}>Resumen de tus eventos más cercanos.</Text>
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
                                        {e.date} · {e.time} · {pct}% vendido
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
                              <Text style={{ color: 'rgba(255,255,255,0.70)', fontWeight: '700' }}>Sin próximos eventos</Text>
                              <Text style={{ color: 'rgba(255,255,255,0.55)', marginTop: 4 }}>
                                Crea un evento para empezar a vender entradas.
                              </Text>
                            </View>
                          )}
                        </GlassView>
                      </View>
                    </>
                  ) : (
                    <>
                      <View style={styles.iosGroup}>
                        <GlassView intensity={14} style={[styles.iosGroupContainer, styles.premiumCard]}>
                          <TouchableOpacity onPress={openEditOrganizer} activeOpacity={0.7} style={styles.iosButtonRow}>
                            <View style={[styles.iosIcon, { backgroundColor: '#0A84FF' }]}>
                              <Pencil size={16} color="#FFF" />
                            </View>
                            <Text style={styles.iosButtonText}>Editar perfil del club</Text>
                            <ChevronRight size={16} color="#8E8E93" />
                          </TouchableOpacity>
                          <View style={styles.iosDivider} />
                          <TouchableOpacity onPress={() => router.push('/(creator)/verification')} activeOpacity={0.7} style={styles.iosButtonRow}>
                            <View style={[styles.iosIcon, { backgroundColor: '#F59E0B' }]}>
                              <ShieldCheck size={16} color="#000" />
                            </View>
                            <Text style={styles.iosButtonText}>Verificación y pagos</Text>
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
                            <Text style={styles.iosButtonText}>Información legal</Text>
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
                          <Text style={styles.premiumTitle}>Negocio</Text>
                          <Text style={styles.premiumSubtitle}>Información del club.</Text>
                        </View>
                      </View>
                      <View style={styles.iosGroup}>
                        <GlassView intensity={14} style={[styles.iosGroupContainer, styles.premiumCard]}>
                          <View style={styles.iosRow}>
                            <View style={styles.iosLabelContainer}>
                              <Text style={styles.iosLabel}>Club</Text>
                            </View>
                            <View style={styles.iosValueContainer}>
                              <Text style={styles.iosValue} numberOfLines={1}>{organizerMeta?.club_name || 'No especificado'}</Text>
                            </View>
                          </View>
                          <View style={styles.iosDivider} />
                          <View style={styles.iosRow}>
                            <View style={styles.iosLabelContainer}>
                              <Text style={styles.iosLabel}>Email negocio</Text>
                            </View>
                            <View style={styles.iosValueContainer}>
                              <Text style={styles.iosValue} numberOfLines={1}>{organizerMeta?.business_email || 'No especificado'}</Text>
                            </View>
                          </View>
                          <View style={styles.iosDivider} />
                          <View style={styles.iosRow}>
                            <View style={styles.iosLabelContainer}>
                              <Text style={styles.iosLabel}>Instagram</Text>
                            </View>
                            <View style={styles.iosValueContainer}>
                              <Text style={styles.iosValue} numberOfLines={1}>{organizerMeta?.instagram_account || 'No especificado'}</Text>
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
                      <TouchableOpacity onPress={() => router.push('/legal')} activeOpacity={0.7} style={styles.iosButtonRow}>
                        <View style={[styles.iosIcon, { backgroundColor: '#34d399' }]}>
                          <FileText size={16} color="#000" />
                        </View>
                        <Text style={styles.iosButtonText}>Información legal</Text>
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
                   <Text style={[styles.logoutText, { color: '#fff' }]}>{deletingAccount ? 'Eliminando…' : 'Eliminar mi cuenta y mis datos'}</Text>
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

      <Modal visible={editOpen} transparent animationType="fade" onRequestClose={() => setEditOpen(false)}>
        <View style={styles.modalBackdrop}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ width: '100%', maxWidth: 560 }}>
            <GlassView intensity={14} style={[styles.modalCard, styles.premiumCard]}>
              <View style={styles.modalHeaderRow}>
                <Text style={styles.modalTitle}>Editar perfil del club</Text>
                <TouchableOpacity onPress={() => setEditOpen(false)} style={styles.modalClose}>
                  <X size={18} color="white" />
                </TouchableOpacity>
              </View>

              <View style={{ gap: 10 }}>
                <View style={styles.modalField}>
                  <Text style={styles.modalLabel}>Nombre del club</Text>
                  <TextInput value={editDraft.club_name} onChangeText={(v) => setEditDraft((p) => ({ ...p, club_name: v }))} placeholder="Club" placeholderTextColor="rgba(255,255,255,0.4)" style={styles.modalInput} />
                </View>
                <View style={styles.modalField}>
                  <Text style={styles.modalLabel}>Email de negocio</Text>
                  <TextInput value={editDraft.business_email} onChangeText={(v) => setEditDraft((p) => ({ ...p, business_email: v }))} placeholder="contacto@club.com" placeholderTextColor="rgba(255,255,255,0.4)" autoCapitalize="none" keyboardType="email-address" style={styles.modalInput} />
                </View>
                <View style={styles.modalField}>
                  <Text style={styles.modalLabel}>Instagram</Text>
                  <TextInput value={editDraft.instagram_account} onChangeText={(v) => setEditDraft((p) => ({ ...p, instagram_account: v }))} placeholder="@club" placeholderTextColor="rgba(255,255,255,0.4)" autoCapitalize="none" style={styles.modalInput} />
                </View>
                <View style={styles.modalFieldRow}>
                  <View style={[styles.modalField, { flex: 1 }]}>
                    <Text style={styles.modalLabel}>Ciudad</Text>
                    <TextInput value={editDraft.city} onChangeText={(v) => setEditDraft((p) => ({ ...p, city: v }))} placeholder="Ciudad" placeholderTextColor="rgba(255,255,255,0.4)" style={styles.modalInput} />
                  </View>
                  <View style={[styles.modalField, { flex: 1 }]}>
                    <Text style={styles.modalLabel}>País</Text>
                    <TextInput value={editDraft.country} onChangeText={(v) => setEditDraft((p) => ({ ...p, country: v }))} placeholder="País" placeholderTextColor="rgba(255,255,255,0.4)" style={styles.modalInput} />
                  </View>
                </View>
                <View style={styles.modalField}>
                  <Text style={styles.modalLabel}>Dirección</Text>
                  <TextInput value={editDraft.address} onChangeText={(v) => setEditDraft((p) => ({ ...p, address: v }))} placeholder="Dirección" placeholderTextColor="rgba(255,255,255,0.4)" style={styles.modalInput} />
                </View>
                <View style={styles.modalField}>
                  <Text style={styles.modalLabel}>Teléfono</Text>
                  <TextInput value={editDraft.phone} onChangeText={(v) => setEditDraft((p) => ({ ...p, phone: v }))} placeholder="+34..." placeholderTextColor="rgba(255,255,255,0.4)" keyboardType="phone-pad" style={styles.modalInput} />
                </View>
              </View>

              <View style={{ marginTop: 14, flexDirection: 'row', gap: 10 }}>
                <ThemedButton title="Cancelar" variant="outline" onPress={() => setEditOpen(false)} style={{ flex: 1 }} />
                <ThemedButton title={savingEdit ? 'Guardando…' : 'Guardar'} onPress={saveOrganizerEdits} disabled={savingEdit} style={{ flex: 1 }} />
              </View>
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
  },
  perfilContainer: {
    flex: 1,
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
  },
  modalClose: {
    width: 34,
    height: 34,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.10)',
    alignItems: 'center',
    justifyContent: 'center',
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
