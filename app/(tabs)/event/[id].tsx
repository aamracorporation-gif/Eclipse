import { View, Text, StyleSheet, ScrollView, Image, TouchableOpacity, Linking, Platform, KeyboardAvoidingView, Modal, Switch, Animated, Easing, Share } from 'react-native';
import { useState, useEffect, useRef, useCallback } from 'react';
import { router, useLocalSearchParams, useSegments } from 'expo-router';
import { supabase, Event } from '@/lib/supabase';
import { useAuth } from '@/lib/AuthContext';
import { useEvents } from '@/lib/EventContext';
import { useCredit } from '@/lib/WalletContext';
import { getErrorMessage } from '@/lib/errorHelpers';
import { MapPin, Calendar, Ticket, ArrowLeft, User as UserIcon, Shirt, Users, Music, PartyPopper, Clock, Euro, Image as ImageIcon, X, CreditCard, Minus, Plus, Sparkles, Wallet, Share2, Mail } from '@/lib/icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors } from '@/constants/Colors';
import { GlassView } from '@/components/ui/GlassView';
import { ThemedButton } from '@/components/ui/ThemedButton';
import { ThemedInput } from '@/components/ui/ThemedInput';
import { DiscoLoader } from '@/components/ui/DiscoLoader';
import { useResponsive } from '@/lib/responsive';
import { usePaymentSheetHandler } from '@/components/PaymentSheetHandler';
import { PurchaseConfirmation } from '@/components/PurchaseConfirmation';
import { useI18n } from '@/lib/I18nContext';
import { useTranslation } from 'react-i18next';
import { scheduleLocalNotification } from '@/lib/notifications';
import { invokeEdgeFunctionStrict } from '@/lib/edgeFunctions';
import { useAppDialog } from '@/components/ui/AppDialog';
import { useFocusEffect } from '@react-navigation/native';
import * as ExpoLinking from 'expo-linking';

export default function EventDetailScreen() {
  const { id } = useLocalSearchParams();
  const segments = useSegments();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { refreshEvents } = useEvents();
  const { creditBalance, loading: creditLoading, buyTicketWithCredit, buyVipWithCredit, refreshCredit } = useCredit();
  const { present, loading: stripeLoading } = usePaymentSheetHandler();
  const { t } = useTranslation();
  const { show: showDialog } = useAppDialog();
  const [event, setEvent] = useState<Event | null>(null);
  const [loading, setLoading] = useState(true);
  const [vipLoadError, setVipLoadError] = useState<string | null>(null);
  const [buyerName, setBuyerName] = useState('');
  const [buyerEmail, setBuyerEmail] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [purchasing, setPurchasing] = useState(false);
  const [vipPurchasing, setVipPurchasing] = useState(false);
  const [selectedTicketType, setSelectedTicketType] = useState<string | null>(null);
  const [selectedVipReservadoId, setSelectedVipReservadoId] = useState<string | null>(null);
  const [purchaseTab, setPurchaseTab] = useState<'tickets' | 'vip'>('tickets');
  const [showVenuePlan, setShowVenuePlan] = useState(false);
  const [payWithWallet, setPayWithWallet] = useState(false);
  const [payVipWithWallet, setPayVipWithWallet] = useState(false);
  const [purchaseSuccess, setPurchaseSuccess] = useState<{ title: string; message: string; variant?: 'default' | 'vip' } | null>(null);
  const { horizontalPadding, maxContentWidth, scaleFont } = useResponsive();
  const { language } = useI18n();
  const localeTag = language === 'en' ? 'en-US' : language === 'fr' ? 'fr-FR' : 'es-ES';
  const vipGlow = useRef(new Animated.Value(0)).current;
  const vipShimmer = useRef(new Animated.Value(0)).current;

  const inCreator = segments?.[0] === '(creator)';
  const userRole = (user?.user_metadata as any)?.role ?? null;

  const translateEventType = (raw: any) => {
    const value = String(raw || '').trim();
    if (!value) {
      const fallback = t('event.types.party', { defaultValue: 'Fiesta' });
      const s = String(fallback || '').trim();
      if (!s) return 'Fiesta';
      if (s === 'event.types.party') return 'Fiesta';
      return s;
    }
    const slug = value
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
    const translated = t(`event.types.${slug}`);
    if (!String(translated || '').trim()) return value;
    if (translated === '—') return value;
    if (translated === `event.types.${slug}`) return value;
    return translated;
  };

  const eventId = Array.isArray(id) ? id[0] : id;

  const safeBack = () => {
    const canGoBack = (router as any)?.canGoBack?.();
    if (canGoBack) router.back();
    else router.replace('/(tabs)');
  };

  useFocusEffect(
    useCallback(() => {
      if (userRole === 'organizer' && !inCreator) {
        router.replace('/(creator)');
      }
    }, [userRole, inCreator])
  );

  useEffect(() => {
    setSelectedTicketType(null);
    setSelectedVipReservadoId(null);
    setPurchaseTab('tickets');
  }, [eventId]);

  useEffect(() => {
    // Select first AVAILABLE ticket type by default
    if (event?.event_ticket_types && event.event_ticket_types.length > 0 && !selectedTicketType) {
      // Find the first type that has availability
      const firstAvailable = event.event_ticket_types.find(t => (t.quantity - (t.sold || 0)) > 0);
      
      if (firstAvailable) {
        setSelectedTicketType(firstAvailable.id);
      } else {
        // If ALL are sold out, fallback to the first one (so the user sees "Sold Out")
        setSelectedTicketType(event.event_ticket_types[0].id);
      }
    }
  }, [event, selectedTicketType]);

  useEffect(() => {
    if (user?.email && !buyerEmail) {
      setBuyerEmail(user.email);
    }
  }, [buyerEmail, user?.email]);

  useEffect(() => {
    if (!event?.reservados_vip?.length || selectedVipReservadoId) return;
    const firstAvailable = event.reservados_vip.find((v) => (v.quantity_available ?? 0) > 0);
    setSelectedVipReservadoId((firstAvailable || event.reservados_vip[0])?.id ?? null);
  }, [event?.reservados_vip, selectedVipReservadoId]);

  useEffect(() => {
    if (purchaseTab !== 'vip') return;
    if (event?.reservados_vip?.length) return;
    setPurchaseTab('tickets');
  }, [event, purchaseTab]);

  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(vipGlow, { toValue: 1, duration: 1800, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(vipGlow, { toValue: 0, duration: 1800, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ])
    );
    const shimmer = Animated.loop(
      Animated.sequence([
        Animated.timing(vipShimmer, { toValue: 1, duration: 2200, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(vipShimmer, { toValue: 0, duration: 2200, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ])
    );

    pulse.start();
    shimmer.start();

    return () => {
      pulse.stop();
      shimmer.stop();
    };
  }, [vipGlow, vipShimmer]);

  const fetchEventQuery = useCallback(async (includeVerificationStatus: boolean) => {
    return supabase
      .from('events')
      .select(
        `
          *,
          venues (*),
          event_ticket_types (*),
          profiles!events_creator_id_fkey_profiles (
            id,
            full_name,
            club_name${includeVerificationStatus ? ',\n            verification_status' : ''}
          )
        `
      )
      .eq('id', eventId)
      .maybeSingle();
  }, [eventId]);

  const fetchEvent = useCallback(async () => {
    setLoading(true);
    setVipLoadError(null);
    try {
      if (!eventId) {
        setEvent(null);
        return;
      }

      let data: any = null;
      let error: any = null;

      {
        const res = await fetchEventQuery(true);
        data = res.data as any;
        error = res.error as any;
      }

      if (error?.code === '42703' && String(error?.message || '').includes('verification_status')) {
        const res = await fetchEventQuery(false);
        data = res.data as any;
        error = res.error as any;
      }

      if (error) throw error;

      let vipRows: any[] = [];
      try {
        const fetchVip = async (withSoftDeleteCols: boolean) => {
          const q = supabase
            .from('reservados_vip')
            .select('*')
            .eq('event_id', eventId)
            .order('created_at', { ascending: true });
          return withSoftDeleteCols ? q.eq('is_active', true).is('deleted_at', null) : q;
        };

        let vipRes: any = await fetchVip(true);
        if (vipRes.error?.code === '42703' && String(vipRes.error?.message || '').match(/is_active|deleted_at/i)) {
          vipRes = await fetchVip(false);
        }
        if (vipRes.error) {
          const code = (vipRes.error as any)?.code ? String((vipRes.error as any).code) : '';
          setVipLoadError(`${code ? `${code}: ` : ''}${getErrorMessage(vipRes.error)}`);
          console.error('Error fetching reservados_vip:', vipRes.error);
        } else if (Array.isArray(vipRes.data)) {
          vipRows = vipRes.data as any[];
        }
      } catch (error) {
        const code = (error as any)?.code ? String((error as any).code) : '';
        setVipLoadError(`${code ? `${code}: ` : ''}${getErrorMessage(error)}`);
        console.error('Error fetching reservados_vip:', error);
        vipRows = [];
      }

      const normalizedEvent: any = { ...(data || {}) };
      if (!String(normalizedEvent?.event_type || '').trim()) {
        normalizedEvent.event_type = 'party';
      }

      if (__DEV__) {
        try {
          console.log('[EVENT]', {
            id: String(normalizedEvent?.id || ''),
            event_type: normalizedEvent?.event_type,
            theme: normalizedEvent?.theme,
          });
        } catch {}
      }

      setEvent({ ...normalizedEvent, reservados_vip: vipRows } as any);
    } catch (error) {
      console.error('Error fetching event:', error);
    } finally {
      setLoading(false);
    }
  }, [eventId, fetchEventQuery]);

  useEffect(() => {
    fetchEvent();
    if (user?.user_metadata?.full_name) {
      setBuyerName(user.user_metadata.full_name);
    }
  }, [fetchEvent, user?.user_metadata?.full_name]);

  const openMaps = () => {
    if (!event?.venues) return;

    const { latitude, longitude } = event.venues;
    const label = encodeURIComponent(event.venues.name);

    const url = Platform.select({
      ios: `maps:0,0?q=${label}@${latitude},${longitude}`,
      android: `geo:0,0?q=${latitude},${longitude}(${label})`,
      default: `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`,
    });

    Linking.openURL(url);
  };

  const shareEvent = async () => {
    if (!event?.id) return;
    const title = String(event.title || '').trim() || 'Evento';

    const sharePayload = async (message: string, primaryUrl?: string) => {
      const url = String(primaryUrl || '').trim();
      const isHttpUrl = /^https?:\/\//i.test(url);
      const payload = Platform.OS === 'ios' && isHttpUrl ? { message, url } : { message };
      await Share.share(payload as any);
    };

    try {
      const result: any = await invokeEdgeFunctionStrict('event-share', { action: 'create', eventId: event.id });
      const token = String(result?.token || '').trim();
      
      if (!token) throw new Error('No se pudo generar el enlace.');

      // Usar siempre el dominio HTTPS en todos los entornos
      const webUrl = `https://api.weareeclipseoficial.com/evento/${token}`;
      
      // Deep link para la app (eclipse:// para builds, exp:// para Expo Go)
      const deepLink = Platform.OS === 'ios' || Platform.OS === 'android'
        ? `eclipse://evento/${token}`
        : ExpoLinking.createURL(`evento/${token}`);

      const message = `${title}\n\nAbrir en la app:\n${deepLink}\n\nEnlace:\n${webUrl}`;
      await sharePayload(message, webUrl);
      return;
    } catch (e) {
      // Fallback: usar deep link de Expo
      const fallback = ExpoLinking.createURL(`event/${event.id}`);
      try {
        const message = `${title}\n\nAbrir en la app:\n${fallback}`;
        await sharePayload(message, undefined);
      } catch (inner) {
        const msg = getErrorMessage(inner || e);
        showDialog({
          title: 'No se pudo compartir',
          message: msg || 'No se pudo compartir el evento. Inténtalo de nuevo.',
        });
      }
    }
  };

  const handlePurchase = async () => {
    if (!user) {
      showDialog({
        title: t('auth.login'),
        message: t('event.purchase.login_required'),
        actions: [
          { label: t('auth.login'), onPress: () => router.push('/(auth)/login'), variant: 'primary' },
          { label: t('common.cancel'), variant: 'outline' },
        ],
      });
      return;
    }

    if (!buyerName.trim()) {
      showDialog({ title: t('common.error'), message: t('event.purchase.enter_name') });
      return;
    }

    const qty = parseInt(quantity);
    if (isNaN(qty) || qty < 1) {
      showDialog({ title: t('common.error'), message: t('event.purchase.invalid_quantity') });
      return;
    }

    if (!event || qty > event.available_tickets) {
      showDialog({ title: t('common.error'), message: t('event.purchase.not_enough_tickets') });
      return;
    }

    const selectedType = event.event_ticket_types?.find(t => t.id === selectedTicketType);
    if (event.event_ticket_types?.length && !selectedType) {
      showDialog({ title: t('common.error'), message: t('event.purchase.select_ticket_type') });
      return;
    }

    // Check specific ticket type availability
    if (selectedType) {
        if ((selectedType.quantity - (selectedType.sold || 0)) < qty) {
          showDialog({ title: t('common.error'), message: t('event.purchase.not_enough_of_type') });
          return;
        }
    }

    try {
      if (payWithWallet && creditLoading) {
        showDialog({ title: t('common.wallet'), message: t('event.purchase.wallet_loading') });
        return;
      }
      // 1. RE-FETCH EVENT DATA to ensure stock is up to date (Prevent Overselling)
      const { data: freshEvent, error: freshError } = await supabase
        .from('events')
        .select(`
          *,
          event_ticket_types (*)
        `)
        .eq('id', event.id)
        .single();
      
      if (freshError || !freshEvent) {
        throw new Error(t('event.purchase.verify_failed'));
      }

      const freshAvailable = freshEvent.available_tickets;
      if (freshAvailable < qty) {
        throw new Error(t('event.purchase.sold_out_during'));
      }
      
      if (selectedTicketType) {
        const freshType = freshEvent.event_ticket_types?.find((t: any) => t.id === selectedTicketType);
        if (freshType) {
           const freshTypeAvailable = freshType.quantity - (freshType.sold || 0);
           if (freshTypeAvailable < qty) {
             throw new Error('Lo sentimos, este tipo de entrada se ha agotado.');
           }
        }
      }

      const pricePerTicket = selectedType ? selectedType.price : event.ticket_price;
      const totalPrice = pricePerTicket * qty;

      const payTicketsWithCard = async (creditDebitEur?: number) => {
        const result = await present({
          kind: 'event_ticket',
          event_id: event.id,
          ticket_type_id: selectedTicketType,
          quantity: qty,
          buyer_name: buyerName,
          buyer_email: buyerEmail || user.email || '',
          ...(typeof creditDebitEur === 'number' && Number.isFinite(creditDebitEur) && creditDebitEur > 0
            ? { credit_debit_eur: creditDebitEur }
            : {}),
        });

        if (result.status === 'canceled') return { paid: false as const };
        if (result.status !== 'succeeded') {
          throw new Error(result.message || 'El pago no se pudo completar.');
        }
        return { paid: true as const };
      };

      const payTicketsWithWalletOnly = async () => {
        setPurchasing(true);

        const qrCode = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
          const r = (Math.random() * 16) | 0;
          const v = c === 'x' ? r : (r & 0x3) | 0x8;
          return v.toString(16);
        });

        await buyTicketWithCredit({
          p_event_id: event.id,
          p_buyer_name: buyerName,
          p_buyer_email: buyerEmail || user.email || '',
          p_quantity: qty,
          p_total_price: totalPrice,
          p_qr_code: qrCode,
          p_ticket_type_id: selectedTicketType,
        });
      };

      if (!payWithWallet) {
        const r = await payTicketsWithCard();
        if (!r.paid) return;
      } else {
        const walletDebit = Math.min(Math.max(creditBalance, 0), totalPrice);

        if (walletDebit >= totalPrice) {
          await payTicketsWithWalletOnly();
        } else if (walletDebit <= 0) {
          const r = await payTicketsWithCard();
          if (!r.paid) return;
        } else {
          const remainder = totalPrice - walletDebit;
          const decision = await new Promise<'hybrid' | 'cancel'>((resolve) => {
            showDialog({
              title: t('event.purchase.insufficient_balance_title'),
              message: t('event.purchase.wallet_split', { wallet: walletDebit.toFixed(2), card: remainder.toFixed(2) }),
              actions: [
                { label: t('event.purchase.use_wallet_card'), onPress: () => resolve('hybrid'), variant: 'primary' },
                { label: t('common.cancel'), onPress: () => resolve('cancel'), variant: 'outline' },
              ],
            });
          });
          if (decision === 'cancel') return;
          const r = await payTicketsWithCard(walletDebit);
          if (!r.paid) return;
          await refreshCredit();
        }
      }

      setBuyerName('');
      setBuyerEmail(user?.email || '');
      setQuantity('1');
      await refreshEvents(); // Update global context so dashboards reflect the sale immediately
      await fetchEvent();

      const msg =
        qty === 1
          ? t('event.purchase.success_one', { tickets: t('tickets.my_tickets') })
          : t('event.purchase.success_many', { count: qty });

      setPurchaseSuccess({ title: t('event.purchase.success_title'), message: msg });
      try {
        const notifBody =
          qty === 1
            ? `${t('event.purchase.success_one', { tickets: t('tickets.my_tickets') })} (${event?.title || ''})`
            : `${t('event.purchase.success_many', { count: qty })} (${event?.title || ''})`;
        await scheduleLocalNotification(
          t('event.purchase.success_title'),
          notifBody,
          { type: 'purchase', eventId: event?.id },
          1
        );
      } catch {}
    } catch (error) {
      console.error('Error purchasing ticket:', error);
      const msg = getErrorMessage(error);
      if (msg.includes('Tu sesión no es válida') || msg.includes('La sesión ha expirado')) {
        showDialog({
          title: t('common.session'),
          message: msg,
          actions: [
            { label: t('auth.login'), onPress: () => router.push('/(auth)/login'), variant: 'primary' },
            { label: t('common.cancel'), variant: 'outline' },
          ],
        });
      } else {
        showDialog({ title: t('common.error'), message: msg });
      }
      // Refresh event data to reflect latest stock if purchase failed (e.g. sold out)
      fetchEvent();
    } finally {
      setPurchasing(false);
    }
  };

  const handleVipPurchase = async () => {
    if (!user) {
      showDialog({
        title: 'Inicia sesión',
        message: 'Debes iniciar sesión para comprar reservados VIP',
        actions: [
          { label: 'Iniciar sesión', onPress: () => router.push('/(auth)/login'), variant: 'primary' },
          { label: 'Cancelar', variant: 'outline' },
        ],
      });
      return;
    }

    if (!buyerName.trim()) {
      showDialog({ title: 'Error', message: 'Por favor completa tu nombre' });
      return;
    }

    const vip = event?.reservados_vip?.find((v) => v.id === selectedVipReservadoId);
    if (!event || !vip) {
      showDialog({ title: 'Error', message: 'Selecciona un reservado VIP.' });
      return;
    }

    if ((vip.quantity_available ?? 0) <= 0) {
      showDialog({ title: t('event.tickets.sold_out'), message: t('event.vip.not_available') });
      return;
    }

    setVipPurchasing(true);
    try {
      if (payVipWithWallet && creditLoading) {
        showDialog({ title: 'Cartera', message: 'Estamos cargando tu saldo. Espera un momento y vuelve a intentarlo.' });
        return;
      }
      if (payVipWithWallet) {
        const walletDebit = Math.min(Math.max(creditBalance, 0), vip.base_price);
        if (walletDebit >= vip.base_price) {
          await buyVipWithCredit({
            p_vip_reservado_id: vip.id,
            p_buyer_name: buyerName,
            p_buyer_email: buyerEmail || user.email || '',
          });
        } else if (walletDebit <= 0) {
          const result = await present({ kind: 'vip_table', reference_id: vip.id, buyer_name: buyerName, buyer_email: buyerEmail || user.email || '' });
          if (result.status === 'canceled') return;
          if (result.status !== 'succeeded') {
            throw new Error(result.message || 'El pago no se pudo completar.');
          }
        } else {
          const remainder = vip.base_price - walletDebit;
          const decision = await new Promise<'hybrid' | 'cancel'>((resolve) => {
            showDialog({
              title: t('event.purchase.insufficient_balance_title'),
              message: t('event.purchase.wallet_split', { wallet: walletDebit.toFixed(2), card: remainder.toFixed(2) }),
              actions: [
                { label: t('event.purchase.use_wallet_card'), onPress: () => resolve('hybrid'), variant: 'primary' },
                { label: t('common.cancel'), onPress: () => resolve('cancel'), variant: 'outline' },
              ],
            });
          });
          if (decision === 'cancel') return;

          const result = await present({
            kind: 'vip_table',
            reference_id: vip.id,
            credit_debit_eur: walletDebit,
            buyer_name: buyerName,
            buyer_email: buyerEmail || user.email || '',
          });
          if (result.status === 'canceled') return;
          if (result.status !== 'succeeded') {
            throw new Error(result.message || 'El pago no se pudo completar.');
          }
          await refreshCredit();
        }
      } else {
        const result = await present({ kind: 'vip_table', reference_id: vip.id, buyer_name: buyerName, buyer_email: buyerEmail || user.email || '' });
        if (result.status === 'canceled') return;
        if (result.status !== 'succeeded') {
          throw new Error(result.message || 'El pago no se pudo completar.');
        }
      }

      await refreshEvents();
      await fetchEvent();
      setPurchaseSuccess({
        title: '¡VIP confirmado!',
        message: 'Tu reservado VIP ha sido confirmado. ¡Que disfrutes!',
        variant: 'vip',
      });
      try {
        await scheduleLocalNotification(
          '¡VIP confirmado!',
          `Tu reservado VIP para ${event?.title || ''} ha sido confirmado.`,
          { type: 'vip_purchase', eventId: event?.id },
          1
        );
      } catch {}
    } catch (error) {
      console.error('Error purchasing VIP:', error);
      const msg = getErrorMessage(error);
      if (msg.includes('Tu sesión no es válida') || msg.includes('La sesión ha expirado')) {
        showDialog({
          title: 'Sesión',
          message: msg,
          actions: [
            { label: 'Iniciar sesión', onPress: () => router.push('/(auth)/login'), variant: 'primary' },
            { label: 'Cancelar', variant: 'outline' },
          ],
        });
      } else {
        showDialog({ title: 'Error', message: msg });
      }
      fetchEvent();
    } finally {
      setVipPurchasing(false);
    }
  };

  if (loading) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <DiscoLoader />
      </View>
    );
  }

  if (!event) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={safeBack}>
            <ArrowLeft size={24} color={Colors.light.text} />
          </TouchableOpacity>
        </View>
        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>Evento no encontrado</Text>
        </View>
      </View>
    );
  }

  const eventTypeLabel = translateEventType(event.event_type);
  const creatorName = event.profiles?.club_name || event.profiles?.full_name || 'Organizador';
  const availableTickets = event.available_tickets || 0;
  const isSoldOut = availableTickets <= 0;

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.container}>
      <ScrollView
        style={[styles.scrollView, { paddingTop: insets.top }]}
        contentContainerStyle={{ paddingBottom: insets.bottom + 20 }}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <TouchableOpacity onPress={safeBack}>
            <ArrowLeft size={24} color={Colors.light.text} />
          </TouchableOpacity>
          <TouchableOpacity onPress={shareEvent}>
            <Share2 size={24} color={Colors.light.text} />
          </TouchableOpacity>
        </View>

        {event.image_url && (
          <Image
            source={{ uri: event.image_url }}
            style={styles.eventImage}
            resizeMode="cover"
          />
        )}

        <View style={[styles.content, { paddingHorizontal: horizontalPadding }]}>
          <View style={styles.titleSection}>
            <Text style={styles.eventTitle}>{event.title}</Text>
            <View style={styles.eventTypeBadge}>
              <Text style={styles.eventTypeText}>{eventTypeLabel}</Text>
            </View>
          </View>

          <View style={styles.creatorSection}>
            <View style={styles.creatorInfo}>
              <UserIcon size={16} color={Colors.light.textSecondary} />
              <Text style={styles.creatorName}>{creatorName}</Text>
            </View>
          </View>

          {event.description && (
            <View style={styles.descriptionSection}>
              <Text style={styles.description}>{event.description}</Text>
            </View>
          )}

          <View style={styles.detailsGrid}>
            {event.venues && (
              <TouchableOpacity style={styles.detailItem} onPress={openMaps}>
                <MapPin size={20} color={Colors.light.primary} />
                <View style={styles.detailContent}>
                  <Text style={styles.detailLabel}>Ubicación</Text>
                  <Text style={styles.detailValue}>{event.venues.name}</Text>
                </View>
              </TouchableOpacity>
            )}

            {event.event_date && (
              <View style={styles.detailItem}>
                <Calendar size={20} color={Colors.light.primary} />
                <View style={styles.detailContent}>
                  <Text style={styles.detailLabel}>Fecha</Text>
                  <Text style={styles.detailValue}>
                    {new Date(event.event_date).toLocaleDateString(localeTag, {
                      weekday: 'short',
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric',
                    })}
                  </Text>
                </View>
              </View>
            )}

            {event.event_time && (
              <View style={styles.detailItem}>
                <Clock size={20} color={Colors.light.primary} />
                <View style={styles.detailContent}>
                  <Text style={styles.detailLabel}>Hora</Text>
                  <Text style={styles.detailValue}>{event.event_time}</Text>
                </View>
              </View>
            )}

            {event.ticket_price !== undefined && (
              <View style={styles.detailItem}>
                <Euro size={20} color={Colors.light.primary} />
                <View style={styles.detailContent}>
                  <Text style={styles.detailLabel}>Precio</Text>
                  <Text style={styles.detailValue}>€{event.ticket_price.toFixed(2)}</Text>
                </View>
              </View>
            )}

            {availableTickets > 0 && (
              <View style={styles.detailItem}>
                <Ticket size={20} color={Colors.light.primary} />
                <View style={styles.detailContent}>
                  <Text style={styles.detailLabel}>Disponibles</Text>
                  <Text style={styles.detailValue}>{availableTickets}</Text>
                </View>
              </View>
            )}
          </View>

          {isSoldOut && (
            <View style={styles.soldOutBanner}>
              <Text style={styles.soldOutText}>Entradas agotadas</Text>
            </View>
          )}

          {vipLoadError && (
            <View style={styles.errorBanner}>
              <Text style={styles.errorText}>{vipLoadError}</Text>
            </View>
          )}

          <View style={styles.purchaseSection}>
            <View style={styles.tabButtons}>
              <TouchableOpacity
                style={[styles.tabButton, purchaseTab === 'tickets' && styles.tabButtonActive]}
                onPress={() => setPurchaseTab('tickets')}
              >
                <Text style={[styles.tabButtonText, purchaseTab === 'tickets' && styles.tabButtonTextActive]}>
                  Entradas
                </Text>
              </TouchableOpacity>
              {event.reservados_vip && event.reservados_vip.length > 0 && (
                <TouchableOpacity
                  style={[styles.tabButton, purchaseTab === 'vip' && styles.tabButtonActive]}
                  onPress={() => setPurchaseTab('vip')}
                >
                  <Sparkles size={16} color={purchaseTab === 'vip' ? Colors.light.primary : Colors.light.textSecondary} />
                  <Text style={[styles.tabButtonText, purchaseTab === 'vip' && styles.tabButtonTextActive]}>
                    VIP
                  </Text>
                </TouchableOpacity>
              )}
            </View>

            {purchaseTab === 'tickets' ? (
              <View style={styles.ticketsPurchaseForm}>
                <ThemedInput
                  placeholder="Tu nombre"
                  value={buyerName}
                  onChangeText={setBuyerName}
                  editable={!purchasing}
                />
                <ThemedInput
                  placeholder="Tu email"
                  value={buyerEmail}
                  onChangeText={setBuyerEmail}
                  keyboardType="email-address"
                  editable={!purchasing}
                />

                {event.event_ticket_types && event.event_ticket_types.length > 0 && (
                  <View style={styles.ticketTypeSelector}>
                    <Text style={styles.label}>Tipo de entrada</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.ticketTypeScroll}>
                      {event.event_ticket_types.map((type) => {
                        const available = type.quantity - (type.sold || 0);
                        const isSelected = selectedTicketType === type.id;
                        return (
                          <TouchableOpacity
                            key={type.id}
                            style={[styles.ticketTypeButton, isSelected && styles.ticketTypeButtonSelected]}
                            onPress={() => setSelectedTicketType(type.id)}
                            disabled={purchasing}
                          >
                            <Text style={[styles.ticketTypeButtonText, isSelected && styles.ticketTypeButtonTextSelected]}>
                              {type.name}
                            </Text>
                            <Text style={[styles.ticketTypePrice, isSelected && styles.ticketTypePriceSelected]}>
                              €{type.price.toFixed(2)}
                            </Text>
                            {available <= 0 ? (
                              <Text style={[styles.ticketTypeAvailable, styles.soldOut]}>Agotado</Text>
                            ) : (
                              <Text style={[styles.ticketTypeAvailable, isSelected && styles.ticketTypeAvailableSelected]}>
                                {available} disponibles
                              </Text>
                            )}
                          </TouchableOpacity>
                        );
                      })}
                    </ScrollView>
                  </View>
                )}

                <View style={styles.quantitySection}>
                  <Text style={styles.label}>Cantidad</Text>
                  <View style={styles.quantityControl}>
                    <TouchableOpacity
                      style={styles.quantityButton}
                      onPress={() => setQuantity(Math.max(1, parseInt(quantity) - 1).toString())}
                      disabled={purchasing || parseInt(quantity) <= 1}
                    >
                      <Minus size={20} color={Colors.light.text} />
                    </TouchableOpacity>
                    <TextInput
                      style={styles.quantityInput}
                      value={quantity}
                      onChangeText={(text) => {
                        const num = parseInt(text) || 1;
                        setQuantity(Math.max(1, num).toString());
                      }}
                      keyboardType="number-pad"
                      editable={!purchasing}
                    />
                    <TouchableOpacity
                      style={styles.quantityButton}
                      onPress={() => setQuantity((parseInt(quantity) + 1).toString())}
                      disabled={purchasing}
                    >
                      <Plus size={20} color={Colors.light.text} />
                    </TouchableOpacity>
                  </View>
                </View>

                <View style={styles.walletToggle}>
                  <View style={styles.walletToggleLeft}>
                    <Wallet size={20} color={Colors.light.primary} />
                    <View>
                      <Text style={styles.walletLabel}>Usar cartera</Text>
                      <Text style={styles.walletBalance}>Saldo: €{creditBalance.toFixed(2)}</Text>
                    </View>
                  </View>
                  <Switch
                    value={payWithWallet}
                    onValueChange={setPayWithWallet}
                    disabled={purchasing || creditLoading}
                  />
                </View>

                <ThemedButton
                  title={purchasing ? 'Procesando...' : isSoldOut ? 'Agotado' : 'Comprar entradas'}
                  onPress={handlePurchase}
                  disabled={purchasing || isSoldOut || creditLoading}
                  loading={purchasing}
                />
              </View>
            ) : (
              <View style={styles.vipPurchaseForm}>
                {event.reservados_vip && event.reservados_vip.length > 0 ? (
                  <>
                    <View style={styles.vipSelector}>
                      <Text style={styles.label}>Selecciona tu reservado VIP</Text>
                      <ScrollView style={styles.vipList}>
                        {event.reservados_vip.map((vip) => {
                          const isSelected = selectedVipReservadoId === vip.id;
                          const available = vip.quantity_available ?? 0;
                          return (
                            <TouchableOpacity
                              key={vip.id}
                              style={[styles.vipCard, isSelected && styles.vipCardSelected]}
                              onPress={() => setSelectedVipReservadoId(vip.id)}
                              disabled={vipPurchasing}
                            >
                              <View style={styles.vipCardContent}>
                                <Text style={[styles.vipCardTitle, isSelected && styles.vipCardTitleSelected]}>
                                  {vip.name}
                                </Text>
                                <Text style={[styles.vipCardDescription, isSelected && styles.vipCardDescriptionSelected]}>
                                  {vip.description}
                                </Text>
                                <View style={styles.vipCardFooter}>
                                  <Text style={[styles.vipCardPrice, isSelected && styles.vipCardPriceSelected]}>
                                    €{vip.base_price.toFixed(2)}
                                  </Text>
                                  {available <= 0 ? (
                                    <Text style={[styles.vipCardAvailable, styles.soldOut]}>Agotado</Text>
                                  ) : (
                                    <Text style={[styles.vipCardAvailable, isSelected && styles.vipCardAvailableSelected]}>
                                      {available} disponibles
                                    </Text>
                                  )}
                                </View>
                              </View>
                            </TouchableOpacity>
                          );
                        })}
                      </ScrollView>
                    </View>

                    <ThemedInput
                      placeholder="Tu nombre"
                      value={buyerName}
                      onChangeText={setBuyerName}
                      editable={!vipPurchasing}
                    />
                    <ThemedInput
                      placeholder="Tu email"
                      value={buyerEmail}
                      onChangeText={setBuyerEmail}
                      keyboardType="email-address"
                      editable={!vipPurchasing}
                    />

                    <View style={styles.walletToggle}>
                      <View style={styles.walletToggleLeft}>
                        <Wallet size={20} color={Colors.light.primary} />
                        <View>
                          <Text style={styles.walletLabel}>Usar cartera</Text>
                          <Text style={styles.walletBalance}>Saldo: €{creditBalance.toFixed(2)}</Text>
                        </View>
                      </View>
                      <Switch
                        value={payVipWithWallet}
                        onValueChange={setPayVipWithWallet}
                        disabled={vipPurchasing || creditLoading}
                      />
                    </View>

                    <ThemedButton
                      title={vipPurchasing ? 'Procesando...' : 'Comprar VIP'}
                      onPress={handleVipPurchase}
                      disabled={vipPurchasing || creditLoading}
                      loading={vipPurchasing}
                    />
                  </>
                ) : (
                  <Text style={styles.noVipText}>No hay reservados VIP disponibles</Text>
                )}
              </View>
            )}
          </View>
        </View>
      </ScrollView>

      {purchaseSuccess && (
        <PurchaseConfirmation
          title={purchaseSuccess.title}
          message={purchaseSuccess.message}
          variant={purchaseSuccess.variant}
          onClose={() => setPurchaseSuccess(null)}
        />
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.light.background,
  },
  scrollView: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  eventImage: {
    width: '100%',
    height: 300,
    backgroundColor: Colors.light.cardBackground,
  },
  content: {
    paddingVertical: 20,
  },
  titleSection: {
    marginBottom: 16,
  },
  eventTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: Colors.light.text,
    marginBottom: 12,
  },
  eventTypeBadge: {
    alignSelf: 'flex-start',
    backgroundColor: Colors.light.primary,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  eventTypeText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  creatorSection: {
    marginBottom: 20,
  },
  creatorInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  creatorName: {
    fontSize: 14,
    color: Colors.light.textSecondary,
  },
  descriptionSection: {
    marginBottom: 20,
  },
  description: {
    fontSize: 14,
    color: Colors.light.textSecondary,
    lineHeight: 20,
  },
  detailsGrid: {
    gap: 12,
    marginBottom: 20,
  },
  detailItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    padding: 12,
    backgroundColor: Colors.light.cardBackground,
    borderRadius: 12,
  },
  detailContent: {
    flex: 1,
  },
  detailLabel: {
    fontSize: 12,
    color: Colors.light.textSecondary,
    marginBottom: 4,
  },
  detailValue: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.light.text,
  },
  soldOutBanner: {
    backgroundColor: '#ff4444',
    padding: 12,
    borderRadius: 8,
    marginBottom: 20,
  },
  soldOutText: {
    color: '#fff',
    fontWeight: '600',
    textAlign: 'center',
  },
  errorBanner: {
    backgroundColor: '#ffebee',
    padding: 12,
    borderRadius: 8,
    marginBottom: 20,
    borderLeftWidth: 4,
    borderLeftColor: '#ff4444',
  },
  errorText: {
    color: '#c62828',
    fontSize: 12,
  },
  purchaseSection: {
    gap: 16,
  },
  tabButtons: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  tabButton: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: Colors.light.cardBackground,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  tabButtonActive: {
    backgroundColor: Colors.light.primary,
  },
  tabButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.light.textSecondary,
  },
  tabButtonTextActive: {
    color: '#fff',
  },
  ticketsPurchaseForm: {
    gap: 12,
  },
  ticketTypeSelector: {
    gap: 8,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.light.text,
  },
  ticketTypeScroll: {
    marginHorizontal: -16,
    paddingHorizontal: 16,
  },
  ticketTypeButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: Colors.light.cardBackground,
    marginRight: 8,
    minWidth: 100,
    alignItems: 'center',
  },
  ticketTypeButtonSelected: {
    backgroundColor: Colors.light.primary,
  },
  ticketTypeButtonText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.light.text,
  },
  ticketTypeButtonTextSelected: {
    color: '#fff',
  },
  ticketTypePrice: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.light.primary,
    marginTop: 4,
  },
  ticketTypePriceSelected: {
    color: '#fff',
  },
  ticketTypeAvailable: {
    fontSize: 10,
    color: Colors.light.textSecondary,
    marginTop: 2,
  },
  ticketTypeAvailableSelected: {
    color: 'rgba(255,255,255,0.8)',
  },
  soldOut: {
    color: '#ff4444',
  },
  quantitySection: {
    gap: 8,
  },
  quantityControl: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.light.cardBackground,
    borderRadius: 8,
    paddingHorizontal: 8,
  },
  quantityButton: {
    padding: 8,
  },
  quantityInput: {
    flex: 1,
    textAlign: 'center',
    fontSize: 16,
    fontWeight: '600',
    color: Colors.light.text,
    paddingVertical: 8,
  },
  walletToggle: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
    backgroundColor: Colors.light.cardBackground,
    borderRadius: 8,
  },
  walletToggleLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  walletLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.light.text,
  },
  walletBalance: {
    fontSize: 12,
    color: Colors.light.textSecondary,
    marginTop: 2,
  },
  vipPurchaseForm: {
    gap: 12,
  },
  vipSelector: {
    gap: 8,
  },
  vipList: {
    maxHeight: 300,
  },
  vipCard: {
    padding: 12,
    backgroundColor: Colors.light.cardBackground,
    borderRadius: 8,
    marginBottom: 8,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  vipCardSelected: {
    borderColor: Colors.light.primary,
    backgroundColor: 'rgba(124, 58, 237, 0.1)',
  },
  vipCardContent: {
    gap: 8,
  },
  vipCardTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.light.text,
  },
  vipCardTitleSelected: {
    color: Colors.light.primary,
  },
  vipCardDescription: {
    fontSize: 12,
    color: Colors.light.textSecondary,
  },
  vipCardDescriptionSelected: {
    color: Colors.light.text,
  },
  vipCardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  vipCardPrice: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.light.primary,
  },
  vipCardPriceSelected: {
    color: Colors.light.primary,
  },
  vipCardAvailable: {
    fontSize: 10,
    color: Colors.light.textSecondary,
  },
  vipCardAvailableSelected: {
    color: Colors.light.primary,
  },
  noVipText: {
    textAlign: 'center',
    color: Colors.light.textSecondary,
    fontSize: 14,
    paddingVertical: 20,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 16,
    color: Colors.light.textSecondary,
  },
});

