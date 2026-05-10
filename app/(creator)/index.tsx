import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, StatusBar, AppState, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Calendar, Plus, Ticket, BarChart3, LogOut, ScanLine, Users, CreditCard, ArrowUpRight, Flame, ChevronRight, Menu, Activity, Trash2, FileText } from '@/lib/icons';
import { router, useFocusEffect } from 'expo-router';
import { useAuth } from '@/lib/AuthContext';
import { useEvents } from '@/lib/EventContext';
import { Colors } from '@/constants/Colors';
import { GlassView } from '@/components/ui/GlassView';
import { useResponsive } from '@/lib/responsive';
import { supabase } from '@/lib/supabase';
import { TimeFilter, TimeRange } from '@/components/dashboard/TimeFilter';
import { RevenueChart } from '@/components/dashboard/RevenueChart';
import { ThemedButton } from '@/components/ui/ThemedButton';
import { DiscoLoader } from '@/components/ui/DiscoLoader';
import * as Notifications from 'expo-notifications';
import * as ExpoLinking from 'expo-linking';
import { scheduleLocalNotification, registerForPushNotifications } from '@/lib/notifications';



import { getStripeAccountStats, StripeAccountStats, createStripeConnectOnboardingLink, createStripeConnectAccount } from '@/lib/payments/api';
import { invokeEdgeFunction } from '@/lib/edgeFunctions';
import { useTranslation } from 'react-i18next';

export default function CreatorDashboard() {
  const { signOut, user } = useAuth();
  const { events, refreshEvents } = useEvents();
  const { t, i18n } = useTranslation();
  const localeTag = i18n.language === 'en' ? 'en-US' : i18n.language === 'fr' ? 'fr-FR' : 'es-ES';
  const {
    horizontalPadding,
    maxContentWidth,
    isTablet,
    isDesktop,
    isSmallPhone,
    scaleFont,
  } = useResponsive();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [timeRange, setTimeRange] = useState<TimeRange>('month');
  const [salesData, setSalesData] = useState<{ date: string; amount: number; qty: number }[]>([]);
  const [loadingStats, setLoadingStats] = useState(true);
  const [verificationStatus, setVerificationStatus] = useState<'pending_verification' | 'verified' | 'rejected' | 'needs_correction' | null>(null);
  const [profileRole, setProfileRole] = useState<'organizer' | 'attendee' | 'admin' | null>(null);
  const [stripeStats, setStripeStats] = useState<StripeAccountStats | null>(null);
  const [stripeAccountId, setStripeAccountId] = useState<string | null>(null);
  const [onboardingCompleted, setOnboardingCompleted] = useState(false);
  const [loadingOnboarding, setLoadingOnboarding] = useState(false);
  const [loadingAdminSummary, setLoadingAdminSummary] = useState(false);
  const [pendingOrganizersCount, setPendingOrganizersCount] = useState(0);
  const [verifiedOrganizersCount, setVerifiedOrganizersCount] = useState(0);
  const [rejectedOrganizersCount, setRejectedOrganizersCount] = useState(0);
  const [loadingAdminOverview, setLoadingAdminOverview] = useState(false);
  const [cleaningSystem, setCleaningSystem] = useState(false);
  const [bootstrappingAdmin, setBootstrappingAdmin] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const pendingStripeReturnRef = useRef(false);
  const [adminOverview, setAdminOverview] = useState<{
    users: number;
    organizers: number;
    pending: number;
    needsCorrection: number;
    verified: number;
    rejected: number;
    suspended: number;
    eventsTotal: number;
    upcomingEvents: number;
    ticketsSold30d: number;
    estRevenue30d: number;
    activeResales: number;
    auditActions7d: number;
    reports7d: number | null;
  }>({
    users: 0,
    organizers: 0,
    pending: 0,
    needsCorrection: 0,
    verified: 0,
    rejected: 0,
    suspended: 0,
    eventsTotal: 0,
    upcomingEvents: 0,
    ticketsSold30d: 0,
    estRevenue30d: 0,
    activeResales: 0,
    auditActions7d: 0,
    reports7d: null,
  });

  const adminEmail = ((process.env.EXPO_PUBLIC_ADMIN_EMAIL as any) ?? '').toString().trim().toLowerCase() || 'aamracorporation@gmail.com';
  const isAdminEmail = !!user?.email && user.email.toLowerCase() === adminEmail;

  const canCreateEvents = profileRole === 'organizer' && verificationStatus === 'verified';
  const isAdmin = profileRole === 'admin' || isAdminEmail;

  useEffect(() => {
    if (!user?.id) return;
    // Force token sync for organizer sessions to avoid missing sale push notifications.
    registerForPushNotifications(user.id).catch(() => {});

    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        registerForPushNotifications(user.id).catch(() => {});
        if (pendingStripeReturnRef.current) {
          pendingStripeReturnRef.current = false;
          fetchMyProfile();
        }
      }
    });
    return () => sub.remove();
  }, [user?.id]);

  // Function to fetch stats
  const fetchStats = async () => {
    if (!user) return;
    setLoadingStats(true);
    try {
      const myEvents = events.filter(e => e.creatorId === user.id);
      const myEventIds = myEvents.map(e => e.id);
      
      if (myEventIds.length === 0) {
        setSalesData([]);
        setLoadingStats(false);
        return;
      }

      const { data, error } = await supabase
        .from('tickets')
        .select('purchase_date, total_price, quantity')
        .in('event_id', myEventIds);

      if (error) throw error;

      if (data) {
        setSalesData(data.map(t => ({
          date: t.purchase_date,
          amount: Number(t.total_price) || 0,
          qty: Number((t as any).quantity) || 0,
        })));
      }
    } catch (error) {
      console.error('Error fetching sales stats:', error);
    } finally {
      setLoadingStats(false);
    }
  };

  const creatingStripeRef = useRef(false);

  const fetchMyProfile = async () => {
    if (!user) return;
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('verification_status, role, stripe_account_id, stripe_onboarding_completed, stripe_charges_enabled')
        .eq('id', user.id)
        .maybeSingle();
      if (error) throw error;

      setVerificationStatus((data?.verification_status as any) ?? null);
      const role = (data?.role as any) ?? (user.user_metadata?.role as any) ?? null;
      setProfileRole(role);
      setStripeAccountId(data?.stripe_account_id || null);
      
      // Consideramos onboarding completado si ya lo estaba o si charges_enabled es true
      const isComplete = !!data?.stripe_onboarding_completed || !!data?.stripe_charges_enabled;
      setOnboardingCompleted(isComplete);

      // AUTO-REFRESH STRIPE STATUS IF NOT COMPLETE
      if (role === 'organizer' && data?.stripe_account_id && !isComplete) {
        console.log('[DEBUG] Checking real Stripe status...');
        try {
          const { refreshStripeConnectStatus } = await import('@/lib/payments/api');
          const status = await refreshStripeConnectStatus();
          console.log('[DEBUG] Stripe real status:', status);
          
          // Consideramos OK si charges_enabled es true
          if (status.stripe_charges_enabled || status.stripe_onboarding_completed) {
            console.log('[DEBUG] Stripe status is now COMPLETED/ENABLED');
            setOnboardingCompleted(true);
            // Re-fetch everything after status change to ensure consistency
            setTimeout(() => fetchMyProfile(), 500);
          }
        } catch (e) {
          console.error('[DEBUG] Failed to auto-refresh Stripe status:', e);
        }
      }

      // FETCH REAL STRIPE STATS - Only if onboarding is completed
      if (role === 'organizer' && data?.stripe_account_id && (isComplete || !!data?.stripe_charges_enabled)) {
        try {
          console.log('[DEBUG] Fetching Stripe stats...');
          const stats = await getStripeAccountStats();
          console.log('[DEBUG] Stripe stats received:', stats);
          setStripeStats(stats);
        } catch (e) {
          console.error('[DEBUG] Error fetching Stripe stats:', e);
        }
      }
    } catch (e) {
      console.error('Error in fetchMyProfile:', e);
    }
  };

  const handleStripeOnboarding = async () => {
    if (loadingOnboarding) return;
    setLoadingOnboarding(true);
    try {
      console.log('[DEBUG] Generating Stripe onboarding link...');

      if (!stripeAccountId) {
        const created = await createStripeConnectAccount();
        if (!created?.stripe_account_id) {
          throw new Error(t('creator.stripe.create_account_failed'));
        }
        setStripeAccountId(created.stripe_account_id);
      }
      
      // Usamos URLs de retorno dinámicas
      const return_url = ExpoLinking.createURL('/(creator)/verification', { queryParams: { stripe: 'return' } });
      const refresh_url = ExpoLinking.createURL('/(creator)/verification', { queryParams: { stripe: 'refresh' } });
      
      const res = await createStripeConnectOnboardingLink({
        return_url,
        refresh_url,
      });
      
      console.log('[DEBUG] Stripe response:', res);
      
      if (!res?.url) {
        throw new Error(t('creator.stripe.invalid_url'));
      }

      console.log('[DEBUG] Opening browser with URL:', res.url);
      pendingStripeReturnRef.current = true;
      const can = await Linking.canOpenURL(res.url);
      if (!can) throw new Error(t('creator.stripe.cannot_open_link'));
      await Linking.openURL(res.url);
    } catch (e: any) {
      console.error('[DEBUG] Onboarding error:', e);
      Alert.alert(t('common.error'), e.message || t('creator.stripe.link_failed'));
    } finally {
      setLoadingOnboarding(false);
    }
  };

  const bootstrapAdminRole = useCallback(async () => {
    if (!isAdminEmail) return;
    if (bootstrappingAdmin) return;
    try {
      setBootstrappingAdmin(true);
      const { error } = await supabase.rpc('bootstrap_set_me_admin', { p_admin_email: adminEmail });
      if (error) throw error;
      await fetchMyProfile();
      Alert.alert(t('common.ok'), t('creator.admin.admin_enabled'));
    } catch {
      Alert.alert(t('common.error'), t('creator.admin.admin_enable_failed'));
    } finally {
      setBootstrappingAdmin(false);
    }
  }, [adminEmail, bootstrappingAdmin, fetchMyProfile, isAdminEmail]);

  const fetchAdminSummary = async () => {
    if (!user) return;
    setLoadingAdminSummary(true);
    try {
      const [{ count: pendingCount }, { count: verifiedCount }, { count: rejectedCount }] = await Promise.all([
        supabase
          .from('profiles')
          .select('id', { count: 'exact', head: true })
          .or('role.eq.organizer,club_name.not.is.null,business_email.not.is.null,instagram_account.not.is.null')
          .eq('verification_status', 'pending_verification'),
        supabase
          .from('profiles')
          .select('id', { count: 'exact', head: true })
          .or('role.eq.organizer,club_name.not.is.null,business_email.not.is.null,instagram_account.not.is.null')
          .eq('verification_status', 'verified'),
        supabase
          .from('profiles')
          .select('id', { count: 'exact', head: true })
          .or('role.eq.organizer,club_name.not.is.null,business_email.not.is.null,instagram_account.not.is.null')
          .eq('verification_status', 'rejected'),
      ]);

      setPendingOrganizersCount(pendingCount ?? 0);
      setVerifiedOrganizersCount(verifiedCount ?? 0);
      setRejectedOrganizersCount(rejectedCount ?? 0);
    } catch {
      setPendingOrganizersCount(0);
      setVerifiedOrganizersCount(0);
      setRejectedOrganizersCount(0);
    } finally {
      setLoadingAdminSummary(false);
    }
  };

  const fetchAdminOverview = async () => {
    setLoadingAdminOverview(true);
    try {
      const now = new Date();
      const since30d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const since7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

      const [
        users,
        organizers,
        pending,
        needsCorrection,
        verified,
        rejected,
        suspended,
        eventsTotal,
        upcomingEvents,
        eventsForSales,
        activeResales,
        auditActions7d,
      ] = await Promise.all([
        supabase.from('profiles').select('id', { count: 'exact', head: true }),
        supabase.from('profiles').select('id', { count: 'exact', head: true }).or('role.eq.organizer,club_name.not.is.null,business_email.not.is.null,instagram_account.not.is.null'),
        supabase.from('profiles').select('id', { count: 'exact', head: true }).or('role.eq.organizer,club_name.not.is.null,business_email.not.is.null,instagram_account.not.is.null').eq('verification_status', 'pending_verification'),
        supabase.from('profiles').select('id', { count: 'exact', head: true }).or('role.eq.organizer,club_name.not.is.null,business_email.not.is.null,instagram_account.not.is.null').eq('verification_status', 'needs_correction'),
        supabase.from('profiles').select('id', { count: 'exact', head: true }).or('role.eq.organizer,club_name.not.is.null,business_email.not.is.null,instagram_account.not.is.null').eq('verification_status', 'verified'),
        supabase.from('profiles').select('id', { count: 'exact', head: true }).or('role.eq.organizer,club_name.not.is.null,business_email.not.is.null,instagram_account.not.is.null').eq('verification_status', 'rejected'),
        supabase.from('profiles').select('id', { count: 'exact', head: true }).or('role.eq.organizer,club_name.not.is.null,business_email.not.is.null,instagram_account.not.is.null').eq('is_suspended', true),
        supabase.from('events').select('id', { count: 'exact', head: true }),
        supabase.from('events').select('id', { count: 'exact', head: true }).gte('event_date', now.toISOString()),
        supabase.from('events').select('sold_tickets, ticket_price, event_date').gte('event_date', since30d),
        supabase.from('resale_listings').select('id', { count: 'exact', head: true }).eq('status', 'active'),
        supabase.from('admin_audit_logs').select('id', { count: 'exact', head: true }).gte('created_at', since7d),
      ]);

      const salesRows = (eventsForSales.data ?? []) as any[];
      const ticketsSold30d = salesRows.reduce((acc, r) => acc + (Number(r.sold_tickets) || 0), 0);
      const estRevenue30d = salesRows.reduce((acc, r) => acc + (Number(r.sold_tickets) || 0) * (Number(r.ticket_price) || 0), 0);

      let reports7d: number | null = null;
      try {
        const res = await supabase.from('event_reports').select('id', { count: 'exact', head: true }).gte('created_at', since7d);
        reports7d = res.count ?? 0;
      } catch {
        reports7d = null;
      }

      setAdminOverview({
        users: users.count ?? 0,
        organizers: organizers.count ?? 0,
        pending: pending.count ?? 0,
        needsCorrection: needsCorrection.count ?? 0,
        verified: verified.count ?? 0,
        rejected: rejected.count ?? 0,
        suspended: suspended.count ?? 0,
        eventsTotal: eventsTotal.count ?? 0,
        upcomingEvents: upcomingEvents.count ?? 0,
        ticketsSold30d,
        estRevenue30d,
        activeResales: activeResales.count ?? 0,
        auditActions7d: auditActions7d.count ?? 0,
        reports7d,
      });
    } catch {
      setAdminOverview({
        users: 0,
        organizers: 0,
        pending: 0,
        needsCorrection: 0,
        verified: 0,
        rejected: 0,
        suspended: 0,
        eventsTotal: 0,
        upcomingEvents: 0,
        ticketsSold30d: 0,
        estRevenue30d: 0,
        activeResales: 0,
        auditActions7d: 0,
        reports7d: null,
      });
    } finally {
      setLoadingAdminOverview(false);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut();
      router.replace('/(auth)/login');
    } catch (error) {
      console.error('Error logging out:', error);
    }
  };

  const handleDeleteAccount = () => {
    if (deletingAccount) return;
    Alert.alert(
      t('profile.delete_account_title'),
      t('profile.delete_account_body'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('profile.delete_account_confirm'),
          style: 'destructive',
          onPress: async () => {
            try {
              setDeletingAccount(true);
              const { error } = await invokeEdgeFunction('delete-account', {});
              if (error) throw new Error(String(error.message || t('profile.delete_account_failed')));
              await signOut();
              router.replace('/(auth)/login');
            } catch (e: any) {
              Alert.alert(t('common.error'), String(e?.message || t('profile.delete_account_failed')));
            } finally {
              setDeletingAccount(false);
            }
          },
        },
      ]
    );
  };

  const runSystemCleanup = async () => {
    if (cleaningSystem) return;
    if (isAdminEmail && profileRole !== 'admin') {
      Alert.alert(t('creator.admin.insufficient_permissions_title'), t('creator.admin.insufficient_permissions_body'));
      return;
    }
    Alert.alert(
      t('creator.admin.cleanup_title'),
      t('creator.admin.cleanup_body'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('creator.admin.cleanup_confirm'),
          style: 'destructive',
          onPress: async () => {
            try {
              setCleaningSystem(true);
              const { error } = await supabase.rpc('cleanup_old_events');
              if (error) throw error;
              await Promise.all([fetchAdminOverview(), refreshEvents()]);
              Alert.alert(t('common.ok'), t('creator.admin.cleanup_done'));
            } catch {
              Alert.alert(t('common.error'), t('creator.admin.cleanup_failed'));
            } finally {
              setCleaningSystem(false);
            }
          },
        },
      ]
    );
  };

  // Force refresh when screen comes into focus
  useFocusEffect(
    useCallback(() => {
      refreshEvents();
      if (!isAdmin) fetchStats();
      fetchMyProfile();
    }, [isAdmin, user]) // Refresh when user changes
  );

  // Initial fetch
  useEffect(() => {
    if (!isAdmin) fetchStats();
    fetchMyProfile();
  }, [isAdmin, user]);

  // AUTO-REFRESH WHEN APP COMES FROM BACKGROUND (Stripe browser return)
  useEffect(() => {
    const subscription = AppState.addEventListener('change', nextAppState => {
      if (nextAppState === 'active') {
        console.log('[DEBUG] App returned to active state, refreshing profile...');
        fetchMyProfile();
      }
    });

    return () => {
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    if (!user) return;
    if (isAdmin) {
      fetchAdminSummary();
      fetchAdminOverview();
    }
  }, [isAdmin, user]);

  // Request notification permissions
  useEffect(() => {
    if (isAdmin) return;
    async function requestPermissions() {
      const { status } = await Notifications.requestPermissionsAsync();
      if (status !== 'granted') {
        console.log('Notification permissions not granted');
      }
    }
    requestPermissions();
  }, [isAdmin]);

  // Realtime subscription for new sales
  useEffect(() => {
    if (!user || isAdmin) return;

    // Filter events created by me
    // IMPORTANT: Keep myEvents and myEventIds in sync with the subscription
    const myEvents = events.filter(e => e.creatorId === user.id);
    const myEventIds = myEvents.map(e => e.id);

    if (myEventIds.length === 0) return;

    console.log('Subscribing to sales for events:', myEventIds);

    const channel = supabase
      .channel('tickets-realtime-dashboard')
      .on(
        'postgres_changes',
        {
          event: '*', // Listen for ALL events (INSERT, UPDATE)
          schema: 'public',
          table: 'tickets',
        },
        async (payload) => {
          // Check if the new/updated ticket belongs to one of my events
          // For INSERT/UPDATE, we check payload.new.event_id
          const ticket = payload.new as any;
          if (ticket && myEventIds.includes(ticket.event_id)) {
             console.log('Ticket update received:', ticket);
             
             // Refresh stats completely to ensure accuracy
             fetchStats();

             if (payload.eventType === 'INSERT') {
               const revenue = Number(ticket.total_price || 0);
               const totalRevenue = salesData.reduce((acc, curr) => acc + curr.amount, 0) + revenue;
               if (totalRevenue >= 1000 && totalRevenue - revenue < 1000) {
                 await scheduleLocalNotification(
                  t('creator.notifications.milestone_title'),
                  t('creator.notifications.milestone_body', { amount: 1000 }),
                   { type: 'milestone', amount: 1000 },
                   2
                 );
               }
             }
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [events, isAdmin, user]);

  useEffect(() => {
    if (!user || isAdmin) return;

    const channel = supabase
      .channel(`organizer-notifications-${user.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${user.id}`,
        },
        async (payload) => {
          const n = payload.new as any;
          if (!n || n.role !== 'organizer' || (n.type !== 'organizer_realtime_sale' && n.type !== 'NEW_SALE')) return;
          const title = String(n.title || t('creator.notifications.new_sale_title'));
          const body = String(n.body || n.message || '');
          await scheduleLocalNotification(title, body, n.data || {}, 1);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [isAdmin, user]);

  const myEvents = events.filter(e => e.creatorId === user?.id);
  
  // Calculate aggregated stats based on time filter
  const stats = useMemo(() => {
    const now = new Date();
    let filteredSales = [...salesData];
    
    if (timeRange === 'day') {
      const startOfDay = new Date(now.setHours(0,0,0,0));
      filteredSales = salesData.filter(d => new Date(d.date) >= startOfDay);
    } else if (timeRange === 'week') {
      const startOfWeek = new Date(now);
      startOfWeek.setDate(now.getDate() - 7);
      filteredSales = salesData.filter(d => new Date(d.date) >= startOfWeek);
    } else if (timeRange === 'month') {
      const startOfMonth = new Date(now);
      startOfMonth.setMonth(now.getMonth() - 1);
      filteredSales = salesData.filter(d => new Date(d.date) >= startOfMonth);
    }

    const revenue = filteredSales.reduce((acc, curr) => acc + curr.amount, 0);
    const tickets = filteredSales.reduce((acc, curr) => acc + (curr.qty || 0), 0);

    return { revenue, tickets };
  }, [salesData, timeRange]);

  const totalRevenueAllTime = useMemo(() => {
    return salesData.reduce((acc, curr) => acc + curr.amount, 0);
  }, [salesData]);

  // Total stats (always all time for other cards if needed, or consistent)
  // For "Tickets Sold" card, maybe we want to keep it "Total" or match filter?
  // Let's match filter for consistency across dashboard
  
  const topEvent = myEvents.reduce<{ title: string; sold: number } | null>((best, event) => {
    const soldCount = event.ticketTypes?.reduce((tAcc, ticket) => tAcc + ticket.sold, 0) || event.sold || 0;
    if (!best || soldCount > best.sold) {
      return { title: event.title, sold: soldCount };
    }
    return best;
  }, null);

  const isMobile = !isTablet && !isDesktop;

  const showStripeOnboardingBlocker = profileRole === 'organizer' && verificationStatus === 'verified' && !onboardingCompleted && !isAdmin;

  const MetricCard = ({ title, value, icon: Icon, color, subtext, gradientColors }: any) => (
    <GlassView intensity={25} style={[
      styles.metricCard, 
      isSmallPhone && { width: 130, height: 130, padding: 12 },
      isTablet && { width: 180, height: 160, padding: 20 }
    ]}>
      <View style={styles.metricHeader}>
        <View style={[styles.metricIconBox, { backgroundColor: color + '20' }]}>
          <Icon size={isSmallPhone ? 18 : isTablet ? 24 : 20} color={color} />
        </View>
        {subtext && (
            <View style={[styles.trendBadge, { backgroundColor: 'rgba(34, 197, 94, 0.15)' }]}>
                <ArrowUpRight size={isSmallPhone ? 8 : 10} color="#4ade80" />
                <Text style={[styles.trendText, { fontSize: isSmallPhone ? 8 : 9 }]}>{subtext}</Text>
            </View>
        )}
      </View>
      <View style={styles.metricContent}>
        <Text style={[
          styles.metricValue, 
          isSmallPhone && { fontSize: 18 },
          isTablet && { fontSize: 28 }
        ]} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
        <Text style={[
          styles.metricLabel, 
          isSmallPhone && { fontSize: 11 },
          isTablet && { fontSize: 14 }
        ]} numberOfLines={1}>{title}</Text>
      </View>
      {gradientColors && (
          <LinearGradient
            colors={gradientColors}
            style={[StyleSheet.absoluteFill, { opacity: 0.05 }]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
          />
      )}
    </GlassView>
  );

  const ActionCard = ({ title, description, icon: Icon, color, onPress, style }: any) => (
    <TouchableOpacity 
      activeOpacity={0.7} 
      onPress={onPress}
      style={[styles.actionWrapper, style]}
    >
      <GlassView intensity={20} style={[
        styles.actionCard, 
        isSmallPhone && { padding: 12, minHeight: 100 },
        isTablet && { padding: 24, minHeight: 140 }
      ]}>
        <View style={[
          styles.actionIcon, 
          { backgroundColor: color + '20' }, 
          isSmallPhone && { width: 36, height: 36 },
          isTablet && { width: 56, height: 56 }
        ]}>
          <Icon size={isSmallPhone ? 20 : isTablet ? 28 : 24} color={color} />
        </View>
        <View style={styles.actionContent}>
          <Text style={[
            styles.actionTitle, 
            isSmallPhone && { fontSize: 13 },
            isTablet && { fontSize: 18 }
          ]} numberOfLines={2}>{title}</Text>
          <Text style={[
            styles.actionDescription, 
            isSmallPhone && { fontSize: 10 },
            isTablet && { fontSize: 13 }
          ]} numberOfLines={2}>{description}</Text>
        </View>
        <ChevronRight size={isSmallPhone ? 14 : 16} color="rgba(255,255,255,0.3)" style={styles.actionArrow} />
        
        {/* Subtle gradient overlay */}
        <LinearGradient
            colors={[color, 'transparent']}
            style={[StyleSheet.absoluteFill, { opacity: 0.03 }]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
        />
      </GlassView>
    </TouchableOpacity>
  );

  const AdminKpiCard = ({ label, value, tint, icon: Icon, style }: any) => (
    <GlassView intensity={18} style={[styles.adminKpiCard, style]}>
      <View style={styles.adminKpiTopRow}>
        <View style={[styles.adminKpiIcon, { backgroundColor: `${tint}22` }]}>
          <Icon size={16} color={tint} />
        </View>
        <Text style={styles.adminKpiLabel} numberOfLines={1}>{label}</Text>
      </View>
      <Text style={styles.adminKpiValue} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
      <LinearGradient
        colors={[`${tint}22`, 'transparent']}
        style={[StyleSheet.absoluteFill, { opacity: 0.55 }]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      />
    </GlassView>
  );

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />
      <LinearGradient
        colors={['#000000', '#111827', '#000000']}
        locations={[0, 0.5, 1]}
        style={StyleSheet.absoluteFill}
      />
      
      <SafeAreaView style={styles.content}>
        <ScrollView 
            contentContainerStyle={[
                styles.scrollContent, 
                { paddingHorizontal: horizontalPadding, maxWidth: maxContentWidth, width: '100%', alignSelf: 'center' }
            ]}
            showsVerticalScrollIndicator={false}
        >
          {/* Header */}
          <View style={styles.header}>
            <View>
                <Text style={styles.dateText}>
                    {new Date().toLocaleDateString(localeTag, { weekday: 'long', day: 'numeric', month: 'long' })}
                </Text>
                <Text style={styles.greeting}>
                  {t('creator.dashboard.hello', {
                    name:
                      user?.user_metadata?.full_name?.split(' ')[0] ||
                      (isAdmin ? t('creator.dashboard.role_admin') : t('creator.dashboard.role_organizer')),
                  })}
                </Text>
            </View>
            <TouchableOpacity onPress={handleLogout} style={styles.profileButton}>
                <LinearGradient
                    colors={['#8b5cf6', '#ec4899']}
                    style={styles.profileGradient}
                >
                    <Text style={styles.profileInitial}>
                        {user?.email?.charAt(0).toUpperCase()}
                    </Text>
                </LinearGradient>
            </TouchableOpacity>
          </View>

          {showStripeOnboardingBlocker ? (
            <View style={{ paddingHorizontal: horizontalPadding, marginTop: 40, alignItems: 'center' }}>
              <GlassView intensity={40} style={{ padding: 30, borderRadius: 32, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.2)', width: '100%', alignItems: 'center' }}>
                <View style={{ backgroundColor: Colors.dark.primary, padding: 20, borderRadius: 24, marginBottom: 24, shadowColor: Colors.dark.primary, shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.3, shadowRadius: 20 }}>
                  <CreditCard size={48} color="white" />
                </View>
                
                <Text style={{ color: 'white', fontSize: 26, fontWeight: '900', textAlign: 'center', marginBottom: 12, letterSpacing: -0.5 }}>
                  {t('creator.stripe.blocker_title')}
                </Text>
                
                <Text style={{ color: Colors.dark.textSecondary, fontSize: 16, textAlign: 'center', lineHeight: 24, marginBottom: 32 }}>
                  {t('creator.stripe.blocker_body')}
                </Text>

                <ThemedButton 
                  title={loadingOnboarding ? t('creator.stripe.generating_link') : t('creator.stripe.configure_now')}
                  onPress={handleStripeOnboarding} 
                  disabled={loadingOnboarding}
                  style={{ width: '100%', height: 64, borderRadius: 20 }}
                  icon={!loadingOnboarding ? <ArrowUpRight size={22} color="white" /> : undefined}
                  iconPosition="right"
                />

                <TouchableOpacity 
                  onPress={handleLogout}
                  style={{ marginTop: 24, padding: 12 }}
                >
                  <Text style={{ color: 'rgba(255,255,255,0.4)', fontWeight: '600' }}>{t('profile.logout')}</Text>
                </TouchableOpacity>
              </GlassView>
              
              <View style={{ marginTop: 40, opacity: 0.5 }}>
                <Text style={{ color: 'white', fontSize: 12, fontWeight: '700', letterSpacing: 2 }}>POWERED BY STRIPE</Text>
              </View>
            </View>
          ) : isAdmin ? (
            <>
              <View style={[styles.adminHeader, { marginTop: 6 }]}>
                <Text style={[styles.adminTitle, { fontSize: scaleFont(28) }]}>{t('creator.admin.title')}</Text>
                <View style={styles.adminHeaderRight}>
                  <TouchableOpacity
                    activeOpacity={0.8}
                    onPress={() => {
                      fetchAdminSummary();
                      fetchAdminOverview();
                    }}
                    style={styles.adminRefreshButton}
                  >
                    <GlassView intensity={22} style={styles.adminRefreshInner}>
                      <Text style={styles.adminRefreshText}>
                        {(loadingAdminSummary || loadingAdminOverview) ? t('creator.admin.refreshing') : t('creator.admin.refresh')}
                      </Text>
                    </GlassView>
                  </TouchableOpacity>
                </View>
              </View>

              <Text style={styles.adminSubtitle}>
                {t('creator.admin.subtitle')}
              </Text>

              {isAdminEmail && profileRole !== 'admin' && (
                <GlassView intensity={18} style={{ padding: 16, borderRadius: 18, marginTop: 14, borderWidth: 1, borderColor: 'rgba(96, 165, 250, 0.28)' }}>
                  <Text style={{ color: 'white', fontSize: 14, fontWeight: '800' }}>{t('creator.admin.pending_permissions_title')}</Text>
                  <Text style={{ color: Colors.dark.textSecondary, marginTop: 6, fontSize: 13, lineHeight: 18 }}>
                    {t('creator.admin.pending_permissions_body')}
                  </Text>
                  <View style={{ marginTop: 12 }}>
                    <ThemedButton
                      title={bootstrappingAdmin ? t('creator.admin.activating') : t('creator.admin.activate')}
                      onPress={bootstrapAdminRole}
                      disabled={bootstrappingAdmin}
                    />
                  </View>
                </GlassView>
              )}

              <View style={styles.adminKpiGrid}>
                <AdminKpiCard label={t('creator.admin.kpi.users')} value={adminOverview.users} tint="#60a5fa" icon={Users} />
                <AdminKpiCard label={t('creator.admin.kpi.organizers')} value={adminOverview.organizers} tint="#a78bfa" icon={Users} />
                <AdminKpiCard label={t('creator.admin.kpi.pending')} value={adminOverview.pending} tint="#f59e0b" icon={Activity} />
                <AdminKpiCard label={t('creator.admin.kpi.needs_correction')} value={adminOverview.needsCorrection} tint="#fb7185" icon={Activity} />
                <AdminKpiCard label={t('creator.admin.kpi.suspended')} value={adminOverview.suspended} tint="#ef4444" icon={Activity} />
                <AdminKpiCard label={t('creator.admin.kpi.events')} value={adminOverview.eventsTotal} tint="#22c55e" icon={Calendar} />
                <AdminKpiCard label={t('creator.admin.kpi.upcoming')} value={adminOverview.upcomingEvents} tint="#38bdf8" icon={Calendar} />
                <AdminKpiCard label={t('creator.admin.kpi.sales_30d')} value={adminOverview.ticketsSold30d} tint="#f472b6" icon={Ticket} />
                <AdminKpiCard
                  label={t('creator.admin.kpi.revenue_30d')}
                  value={adminOverview.estRevenue30d.toLocaleString(localeTag, { style: 'currency', currency: 'EUR' })}
                  tint="#34d399"
                  icon={CreditCard}
                  style={{ flexBasis: '100%' }}
                />
                <AdminKpiCard label={t('creator.admin.kpi.active_resale')} value={adminOverview.activeResales} tint="#eab308" icon={CreditCard} />
                <AdminKpiCard label={t('creator.admin.kpi.audit_7d')} value={adminOverview.auditActions7d} tint="#94a3b8" icon={Activity} />
                {adminOverview.reports7d !== null && (
                  <AdminKpiCard label={t('creator.admin.kpi.reports_7d')} value={adminOverview.reports7d} tint="#f97316" icon={Activity} />
                )}
              </View>

              <View style={styles.sectionContainer}>
                <Text style={styles.sectionTitle}>{t('creator.admin.actions_title')}</Text>
                <View style={styles.gridRow}>
                  <ActionCard
                    title={t('creator.admin.actions.review_organizers_title')}
                    description={t('creator.admin.actions.review_organizers_desc')}
                    icon={Activity}
                    color="#f59e0b"
                    onPress={() => router.push('/(creator)/admin-verification')}
                    style={{ flex: 1 }}
                  />
                  <ActionCard
                    title={t('creator.admin.actions.events_title')}
                    description={t('creator.admin.actions.events_desc')}
                    icon={Calendar}
                    color="#22c55e"
                    onPress={() => router.push('/(creator)/manage-events')}
                    style={{ flex: 1 }}
                  />
                </View>
                <View style={styles.gridRow}>
                  <ActionCard
                    title={t('creator.admin.actions.cleanup_title')}
                    description={cleaningSystem ? t('creator.admin.actions.cleanup_running') : t('creator.admin.actions.cleanup_desc')}
                    icon={Trash2}
                    color="#ef4444"
                    onPress={runSystemCleanup}
                    style={{ flex: 1 }}
                  />
                </View>
              </View>
            </>
          ) : (
            <>
              {!isAdminEmail && profileRole === 'organizer' && (
                <View style={{ gap: 12, marginTop: 12 }}>
                  {verificationStatus !== 'verified' && (
                    <GlassView intensity={15} style={{ padding: 16, borderRadius: 18 }}>
                      <Text style={{ color: 'white', fontSize: 14, fontWeight: '700' }}>
                        {verificationStatus === 'needs_correction'
                          ? t('creator.organizer.verification.needs_correction_title')
                          : verificationStatus === 'rejected'
                            ? t('creator.organizer.verification.rejected_title')
                            : t('creator.organizer.verification.pending_title')}
                      </Text>
                      <Text style={{ color: Colors.dark.textSecondary, marginTop: 6, fontSize: 13, lineHeight: 18 }}>
                        {verificationStatus === 'needs_correction'
                          ? t('creator.organizer.verification.needs_correction_body')
                          : verificationStatus === 'rejected'
                            ? t('creator.organizer.verification.rejected_body')
                            : t('creator.organizer.verification.pending_body')}
                      </Text>
                      {(verificationStatus === 'pending_verification' || verificationStatus === 'needs_correction') && (
                        <View style={{ marginTop: 12 }}>
                          <ThemedButton title={t('creator.organizer.verification.complete_button')} onPress={() => router.push('/(creator)/verification')} />
                        </View>
                      )}
                    </GlassView>
                  )}
                </View>
              )}

              <GlassView intensity={20} style={styles.totalHero}>
                <LinearGradient
                  colors={['rgba(255,255,255,0.08)', 'rgba(48, 209, 88, 0.16)', 'transparent']}
                  style={StyleSheet.absoluteFill}
                />
                <Text style={styles.totalHeroLabel}>{t('creator.organizer.balance_available')}</Text>
                <Text style={[styles.totalHeroValue, isSmallPhone && { fontSize: 30 }]} numberOfLines={1} adjustsFontSizeToFit>
                  {stripeStats 
                    ? (stripeStats.available_balance / 100).toLocaleString(localeTag, { style: 'currency', currency: 'EUR' })
                    : (0).toLocaleString(localeTag, { style: 'currency', currency: 'EUR' })
                  }
                </Text>
                {stripeStats && stripeStats.pending_balance > 0 && (
                  <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, marginTop: 4 }}>
                    {t('creator.organizer.pending_payouts', { amount: (stripeStats.pending_balance / 100).toLocaleString(localeTag, { style: 'currency', currency: 'EUR' }) })}
                  </Text>
                )}
              </GlassView>

              <TimeFilter value={timeRange} onChange={setTimeRange} />

              <GlassView intensity={15} style={styles.chartSection}>
                <View style={styles.chartHeader}>
                    <View>
                        <Text style={styles.chartLabel}>{t('creator.organizer.revenue_real_30d')}</Text>
                        <Text style={[styles.chartValue, isSmallPhone && { fontSize: 28 }]}>
                          {stripeStats 
                            ? (stripeStats.revenue_30d / 100).toLocaleString(localeTag, { style: 'currency', currency: 'EUR' })
                            : (0).toLocaleString(localeTag, { style: 'currency', currency: 'EUR' })
                          }
                        </Text>
                    </View>
                    <View style={[styles.trendBadge, { backgroundColor: 'rgba(139, 92, 246, 0.15)' }]}>
                        <BarChart3 size={14} color="#a78bfa" />
                        <Text style={[styles.trendText, { color: '#a78bfa' }]}>Stripe</Text>
                    </View>
                </View>
                
                {loadingStats ? (
                  <View style={{ height: isSmallPhone ? 180 : 220, alignItems: 'center', justifyContent: 'center' }}>
                      <DiscoLoader size={56} />
                  </View>
                ) : (
                  <RevenueChart data={salesData} timeRange={timeRange} color="#8b5cf6" height={isSmallPhone ? 180 : 220} />
                )}
              </GlassView>

              <ScrollView 
                horizontal 
                showsHorizontalScrollIndicator={false} 
                contentContainerStyle={styles.metricsScroll}
                style={styles.metricsContainer}
              >
                <MetricCard 
                    title={t('creator.organizer.metrics.tickets_sold')} 
                    value={stats.tickets.toString()} 
                    icon={Ticket} 
                    color="#ec4899" 
                    gradientColors={['#ec4899', '#db2777']}
                />
                <MetricCard 
                    title={t('creator.organizer.metrics.active_events')} 
                    value={myEvents.length.toString()} 
                    icon={Calendar} 
                    color="#3b82f6" 
                    subtext={t('creator.organizer.metrics.total')}
                    gradientColors={['#3b82f6', '#2563eb']}
                />
                 <MetricCard 
                    title={t('creator.organizer.metrics.top_event')} 
                    value={topEvent?.title || t('creator.organizer.metrics.na')} 
                    icon={Flame} 
                    color="#f97316" 
                    subtext={topEvent ? t('creator.organizer.metrics.sales_count', { count: topEvent.sold }) : ''}
                    gradientColors={['#f97316', '#ea580c']}
                />
              </ScrollView>

              <View style={styles.sectionContainer}>
                <Text style={styles.sectionTitle}>{t('creator.organizer.control_center_title')}</Text>
                
                <View style={styles.gridRow}>
                  <ActionCard 
                      title={t('creator.organizer.actions.create_event_title')} 
                      description={t('creator.organizer.actions.create_event_desc')}
                      icon={Plus} 
                      color="#8b5cf6" 
                      onPress={() => {
                        if (!canCreateEvents) {
                          let alertTitle = t('creator.organizer.verification.pending_title');
                          let alertMsg = t('creator.organizer.verification.pending_body');
                          
                          if (verificationStatus === 'needs_correction') {
                            alertTitle = t('creator.organizer.verification.needs_correction_title');
                            alertMsg = t('creator.organizer.verification.needs_correction_body');
                          } else if (verificationStatus === 'rejected') {
                            alertTitle = t('creator.organizer.verification.rejected_title');
                            alertMsg = t('creator.organizer.verification.rejected_create_event_body');
                          }
                          
                          Alert.alert(alertTitle, alertMsg);
                          router.push('/(creator)/verification');
                          return;
                        }
                        router.push('/(creator)/create-event');
                      }}
                      style={{ flex: 1 }}
                  />
                   <ActionCard 
                      title={t('creator.organizer.actions.validate_title')} 
                      description={t('creator.organizer.actions.validate_desc')}
                      icon={ScanLine} 
                      color="#4ade80" 
                      onPress={() => router.push('/(creator)/scan')}
                      style={{ flex: 1 }}
                  />
                </View>

                <View style={styles.gridRow}>
                  <ActionCard 
                      title={t('creator.organizer.actions.staff_title')} 
                      description={t('creator.organizer.actions.staff_desc')}
                      icon={Users} 
                      color="#3b82f6" 
                      onPress={() => router.push('/(creator)/workers')}
                      style={{ flex: 1 }}
                  />
                   <ActionCard 
                      title={t('creator.organizer.actions.my_events_title')} 
                      description={t('creator.organizer.actions.my_events_desc')}
                      icon={Calendar} 
                      color="#f43f5e" 
                      onPress={() => router.push('/(creator)/manage-events')}
                      style={{ flex: 1 }}
                  />
                </View>

              </View>

              <View style={styles.sectionContainer}>
                <Text style={styles.sectionTitle}>{t('creator.organizer.account_section_title')}</Text>
                <View style={styles.gridRow}>
                  <ActionCard
                    title={t('profile.legal_info')}
                    description={t('creator.organizer.legal_desc')}
                    icon={FileText}
                    color="#34d399"
                    onPress={() => router.push('/legal')}
                    style={{ flex: 1 }}
                  />
                  <ActionCard
                    title={deletingAccount ? t('profile.deleting') : t('profile.delete_my_account')}
                    description={t('profile.delete_my_account')}
                    icon={Trash2}
                    color="#ef4444"
                    onPress={handleDeleteAccount}
                    style={{ flex: 1 }}
                  />
                </View>
              </View>
            </>
          )}

        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  content: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 40,
    paddingTop: 10,
  },
  glowTopLeft: {
    position: 'absolute',
    top: -100,
    left: -100,
    width: 300,
    height: 300,
    borderRadius: 150,
    backgroundColor: '#8b5cf6',
    opacity: 0.15,
    transform: [{ scale: 1.5 }],
  },
  glowBottomRight: {
    position: 'absolute',
    bottom: -100,
    right: -100,
    width: 300,
    height: 300,
    borderRadius: 150,
    backgroundColor: '#ec4899',
    opacity: 0.15,
    transform: [{ scale: 1.5 }],
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  dateText: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 13,
    fontWeight: '500',
    textTransform: 'capitalize',
    marginBottom: 4,
  },
  greeting: {
    fontSize: 28,
    fontWeight: '700',
    color: '#fff',
    letterSpacing: -0.5,
  },
  profileButton: {
    shadowColor: '#8b5cf6',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  profileGradient: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  profileInitial: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
  },
  totalHero: {
    borderRadius: 30,
    padding: 20,
    marginTop: 14,
    marginBottom: 18,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.28,
    shadowRadius: 22,
    elevation: 12,
  },
  totalHeroLabel: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.6,
    color: 'rgba(255,255,255,0.65)',
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  totalHeroValue: {
    fontSize: 34,
    fontWeight: '800',
    color: '#fff',
    letterSpacing: -0.8,
  },
  totalHeroRow: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  totalHeroHint: {
    fontSize: 12,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.45)',
  },
  chartSection: {
    borderRadius: 24,
    padding: 20,
    marginBottom: 24,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  chartHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 10,
  },
  chartLabel: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 14,
    marginBottom: 4,
  },
  chartValue: {
    fontSize: 32,
    fontWeight: '700',
    color: '#fff',
    letterSpacing: -1,
  },
  metricsContainer: {
    marginBottom: 24,
    marginHorizontal: -20, // Negative margin to allow full-width scroll
  },
  metricsScroll: {
    paddingHorizontal: 20, // Padding to start content
    paddingRight: 10,
    gap: 12,
  },
  metricCard: {
    width: 150,
    height: 140,
    borderRadius: 20,
    padding: 16,
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
    overflow: 'hidden',
  },
  metricHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  metricIconBox: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  trendBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    gap: 2,
  },
  trendText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#4ade80',
  },
  metricContent: {
    gap: 2,
  },
  metricValue: {
    fontSize: 22,
    fontWeight: '700',
    color: '#fff',
  },
  metricLabel: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.6)',
  },
  sectionContainer: {
    gap: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 8,
    marginLeft: 4,
  },
  gridRow: {
    flexDirection: 'row',
    gap: 12,
  },
  actionWrapper: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  actionCard: {
    borderRadius: 20,
    padding: 16,
    minHeight: 110,
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
    overflow: 'hidden',
  },
  totalRevenueSubtext: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.5)',
    marginTop: 4,
  },
  actionIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  actionContent: {
    gap: 2,
  },
  actionTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
  },
  actionDescription: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.5)',
  },
  actionArrow: {
    position: 'absolute',
    top: 16,
    right: 16,
  },
  adminHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    gap: 12,
  },
  adminTitle: {
    color: 'white',
    fontWeight: '800',
    letterSpacing: -0.8,
  },
  adminHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  adminRefreshButton: {
    borderRadius: 999,
    overflow: 'hidden',
  },
  adminRefreshInner: {
    paddingHorizontal: 14,
    height: 34,
    borderRadius: 999,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  adminRefreshText: {
    color: 'rgba(255,255,255,0.92)',
    fontWeight: '800',
    fontSize: 12,
  },
  adminSubtitle: {
    marginTop: 8,
    color: 'rgba(255,255,255,0.62)',
    fontWeight: '600',
    lineHeight: 18,
  },
  adminKpiGrid: {
    marginTop: 14,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  adminKpiCard: {
    flexBasis: '48%',
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    overflow: 'hidden',
    minHeight: 94,
  },
  adminKpiTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  adminKpiIcon: {
    width: 28,
    height: 28,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  adminKpiLabel: {
    flex: 1,
    color: 'rgba(255,255,255,0.72)',
    fontWeight: '800',
    fontSize: 12,
  },
  adminKpiValue: {
    marginTop: 12,
    color: 'white',
    fontWeight: '900',
    fontSize: 22,
    letterSpacing: -0.6,
  },
});
