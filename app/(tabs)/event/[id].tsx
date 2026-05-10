import { View, Text, StyleSheet, ScrollView, Image, TouchableOpacity, Alert, Linking, Platform, KeyboardAvoidingView, Modal, Switch, Animated, Easing, Share } from 'react-native';
import { useState, useEffect, useRef } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { supabase, Event } from '@/lib/supabase';
import { useAuth } from '@/lib/AuthContext';
import { useEvents } from '@/lib/EventContext';
import { useCredit } from '@/lib/WalletContext';
import { getErrorMessage } from '@/lib/errorHelpers';
import { MapPin, Calendar, Ticket, ArrowLeft, Navigation, TrendingUp, User as UserIcon, Shirt, Users, Music, PartyPopper, Clock, Euro, Image as ImageIcon, X, CreditCard, Minus, Plus, Sparkles, Wallet, Share2, Mail } from '@/lib/icons';
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
import * as ExpoLinking from 'expo-linking';
import { useI18n } from '@/lib/I18nContext';
import { useTranslation } from 'react-i18next';
import { scheduleLocalNotification } from '@/lib/notifications';
import { invokeEdgeFunctionStrict } from '@/lib/edgeFunctions';

export default function EventDetailScreen() {
  const { id } = useLocalSearchParams();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { refreshEvents } = useEvents();
  const { creditBalance, loading: creditLoading, buyTicketWithCredit, buyVipWithCredit, refreshCredit } = useCredit();
  const { present, loading: stripeLoading } = usePaymentSheetHandler();
  const { t } = useTranslation();
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

  const translateEventType = (raw: any) => {
    const value = String(raw || '').trim();
    if (!value) return '';
    const slug = value
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
    const translated = t(`event.types.${slug}`);
    return translated === '—' ? value : translated;
  };

  const eventId = Array.isArray(id) ? id[0] : id;

  const safeBack = () => {
    const canGoBack = (router as any)?.canGoBack?.();
    if (canGoBack) router.back();
    else router.replace('/(tabs)');
  };

  useEffect(() => {
    fetchEvent();
    if (user?.user_metadata?.full_name) {
      setBuyerName(user.user_metadata.full_name);
    }
  }, [id, user]);

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
  }, [user?.email]);

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

  const fetchEventQuery = async (includeVerificationStatus: boolean) => {
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
  };

  const fetchEvent = async () => {
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

      setEvent({ ...(data || {}), reservados_vip: vipRows } as any);
    } catch (error) {
      console.error('Error fetching event:', error);
    } finally {
      setLoading(false);
    }
  };

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
    try {
      const result: any = await invokeEdgeFunctionStrict('event-share', { action: 'create', eventId: event.id });
      const url = String(result?.url || '');
      if (!url) throw new Error('No se pudo generar el enlace.');

      await Share.share({ message: url, url });
      return;
    } catch (e: any) {
      Alert.alert('No se pudo compartir', 'No se pudo generar el enlace de compartición. Inténtalo de nuevo.');
    }
  };

  const handlePurchase = async () => {
    if (!user) {
      Alert.alert(
        t('auth.login'),
        t('event.purchase.login_required'),
        [
          {
            text: t('auth.login'),
            onPress: () => router.push('/(auth)/login'),
          },
          { text: t('common.cancel'), style: 'cancel' },
        ]
      );
      return;
    }

    if (!buyerName.trim()) {
      Alert.alert(t('common.error'), t('event.purchase.enter_name'));
      return;
    }

    const qty = parseInt(quantity);
    if (isNaN(qty) || qty < 1) {
      Alert.alert(t('common.error'), t('event.purchase.invalid_quantity'));
      return;
    }

    if (!event || qty > event.available_tickets) {
      Alert.alert(t('common.error'), t('event.purchase.not_enough_tickets'));
      return;
    }

    const selectedType = event.event_ticket_types?.find(t => t.id === selectedTicketType);
    if (event.event_ticket_types?.length && !selectedType) {
        Alert.alert(t('common.error'), t('event.purchase.select_ticket_type'));
        return;
    }

    // Check specific ticket type availability
    if (selectedType) {
        if ((selectedType.quantity - (selectedType.sold || 0)) < qty) {
            Alert.alert(t('common.error'), t('event.purchase.not_enough_of_type'));
            return;
        }
    }

    try {
      if (payWithWallet && creditLoading) {
        Alert.alert(t('common.wallet'), t('event.purchase.wallet_loading'));
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
            Alert.alert(
              t('event.purchase.insufficient_balance_title'),
              t('event.purchase.wallet_split', { wallet: walletDebit.toFixed(2), card: remainder.toFixed(2) }),
              [
                { text: t('event.purchase.use_wallet_card'), onPress: () => resolve('hybrid') },
                { text: t('common.cancel'), style: 'cancel', onPress: () => resolve('cancel') },
              ]
            );
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
        Alert.alert(t('common.session'), msg, [
          { text: t('auth.login'), onPress: () => router.push('/(auth)/login') },
          { text: t('common.cancel'), style: 'cancel' },
        ]);
      } else {
        Alert.alert(t('common.error'), msg);
      }
      // Refresh event data to reflect latest stock if purchase failed (e.g. sold out)
      fetchEvent();
    } finally {
      setPurchasing(false);
    }
  };

  const handleVipPurchase = async () => {
    if (!user) {
      Alert.alert(
        'Inicia sesión',
        'Debes iniciar sesión para comprar reservados VIP',
        [
          { text: 'Iniciar sesión', onPress: () => router.push('/(auth)/login') },
          { text: 'Cancelar', style: 'cancel' },
        ]
      );
      return;
    }

    if (!buyerName.trim()) {
      Alert.alert('Error', 'Por favor completa tu nombre');
      return;
    }

    const vip = event?.reservados_vip?.find((v) => v.id === selectedVipReservadoId);
    if (!event || !vip) {
      Alert.alert('Error', 'Selecciona un reservado VIP.');
      return;
    }

    if ((vip.quantity_available ?? 0) <= 0) {
      Alert.alert(t('event.tickets.sold_out'), t('event.vip.not_available'));
      return;
    }

    setVipPurchasing(true);
    try {
      if (payVipWithWallet && creditLoading) {
        Alert.alert('Cartera', 'Estamos cargando tu saldo. Espera un momento y vuelve a intentarlo.');
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
            Alert.alert(
              t('event.purchase.insufficient_balance_title'),
              t('event.purchase.wallet_split', { wallet: walletDebit.toFixed(2), card: remainder.toFixed(2) }),
              [
                { text: t('event.purchase.use_wallet_card'), onPress: () => resolve('hybrid') },
                { text: t('common.cancel'), style: 'cancel', onPress: () => resolve('cancel') },
              ]
            );
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
        message: 'Tu reservado VIP se ha comprado correctamente.',
        variant: 'vip',
      });
      try {
        await scheduleLocalNotification(
          '¡VIP confirmado!',
          'Tu reservado VIP se ha comprado correctamente.',
          { type: 'vip_purchase', eventId: event?.id },
          1
        );
      } catch {}
    } catch (error) {
      console.error('Error purchasing VIP:', error);
      const msg = getErrorMessage(error);
      if (msg.includes('Tu sesión no es válida') || msg.includes('La sesión ha expirado')) {
        Alert.alert('Sesión', msg, [
          { text: 'Iniciar sesión', onPress: () => router.push('/(auth)/login') },
          { text: 'Cancelar', style: 'cancel' },
        ]);
      } else {
        Alert.alert('Error', msg);
      }
      fetchEvent();
    } finally {
      setVipPurchasing(false);
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString(localeTag, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  };

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleTimeString(localeTag, {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <DiscoLoader label="Cargando evento…" subLabel="Afinando luces y sonido" size={160} />
      </View>
    );
  }

  if (purchaseSuccess) {
    return (
      <PurchaseConfirmation
        title={purchaseSuccess.title}
        message={purchaseSuccess.message}
        variant={purchaseSuccess.variant}
        onPrimaryAction={() => {
          setPurchaseSuccess(null);
          router.push('/(tabs)/tickets');
        }}
        onSecondaryAction={() => {
          setPurchaseSuccess(null);
          router.push('/(tabs)');
        }}
      />
    );
  }

  if (!event) {
    return (
      <View style={styles.loadingContainer}>
        <Text style={styles.errorText}>Evento no encontrado</Text>
        <ThemedButton title="Volver" onPress={safeBack} style={{ marginTop: 20, width: 200 }} />
      </View>
    );
  }

  const selectedType = event.event_ticket_types?.find(t => t.id === selectedTicketType);
  const currentPrice = selectedType ? selectedType.price : event.ticket_price;
  const currentAvailable = selectedType 
    ? (selectedType.quantity - (selectedType.sold || 0))
    : event.available_tickets;

  const safeQty = Math.max(1, parseInt(quantity || '1') || 1);
  const total = currentPrice * safeQty;
  const hasVip = !!(event.reservados_vip && event.reservados_vip.length > 0);
  const selectedVip = event.reservados_vip?.find((v) => v.id === selectedVipReservadoId) ?? null;
  const vipAvailable = selectedVip ? (selectedVip.quantity_available ?? 0) : 0;
  const formatEuro = (value: any): string => {
    if (value === null || value === undefined) return '—';
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(n)) return `${String(value)}€`;
    const decimals = Math.abs(n % 1) < 0.000001 ? 0 : 2;
    return `${n.toFixed(decimals)}€`;
  };

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={[Colors.dark.background, '#0f172a']}
        style={StyleSheet.absoluteFill}
      />
      
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 32 }}>
        {/* Header Image */}
        <View style={styles.imageContainer}>
          <Image
            source={{ uri: event.poster_url || 'https://images.pexels.com/photos/1190298/pexels-photo-1190298.jpeg' }}
            style={styles.posterImage}
          />
          <LinearGradient
            colors={['rgba(15, 23, 42, 0)', 'rgba(15, 23, 42, 0.68)']}
            style={styles.imageOverlay}
          />
          
          <TouchableOpacity 
            style={[styles.backButton, { top: insets.top + 10, left: horizontalPadding }]}
            onPress={safeBack}
            activeOpacity={0.8}>
            <GlassView intensity={40} style={styles.backButtonGlass}>
              <ArrowLeft size={24} color={Colors.dark.text} />
            </GlassView>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.shareButton, { top: insets.top + 10, right: horizontalPadding }]}
            onPress={shareEvent}
            activeOpacity={0.8}
          >
            <GlassView intensity={40} style={styles.backButtonGlass}>
              <Share2 size={22} color={Colors.dark.text} />
            </GlassView>
          </TouchableOpacity>

          {event.available_tickets <= 0 && (
            <View style={[styles.soldBadgeContainer, { right: horizontalPadding }]}>
              <GlassView intensity={40} style={[styles.soldBadge, { backgroundColor: Colors.dark.error }]}>
                <Text style={[styles.soldText, { color: 'white' }]}>SOLD OUT</Text>
              </GlassView>
            </View>
          )}
        </View>

        <View style={[styles.content, { paddingHorizontal: horizontalPadding }]}>
          <View style={{ width: '100%', maxWidth: maxContentWidth, alignSelf: 'center' }}>
          <Text style={[styles.title, { fontSize: scaleFont(32) }]}>{event.title}</Text>
          <Text style={styles.description}>{event.description}</Text>

          {/* Key Info */}
          <GlassView intensity={20} style={styles.infoCard}>
            <View style={styles.infoRow}>
              <View style={styles.iconBox}>
                <Calendar size={20} color={Colors.dark.primary} />
              </View>
              <View style={styles.infoContent}>
                <Text style={styles.infoLabel}>{t('event.details.date')}</Text>
                <Text style={styles.infoValue}>{formatDate(event.event_date)}</Text>
              </View>
            </View>
            
            <View style={styles.divider} />

            <View style={styles.infoRow}>
              <View style={styles.iconBox}>
                <Clock size={20} color={Colors.dark.secondary} />
              </View>
              <View style={styles.infoContent}>
                <Text style={styles.infoLabel}>{t('event.details.time')}</Text>
                <Text style={styles.infoValue}>{formatTime(event.event_date)}</Text>
              </View>
            </View>

            <View style={styles.divider} />

            <View style={styles.infoRow}>
              <View style={styles.iconBox}>
                <MapPin size={20} color={Colors.dark.success} />
              </View>
              <View style={styles.infoContent}>
                <Text style={styles.infoLabel}>{t('event.details.place')}</Text>
                <Text style={styles.infoValue}>{event.venues?.name}</Text>
                <Text style={styles.addressText} numberOfLines={2}>
                  {event.venues?.address}
                </Text>
              </View>
            </View>
          </GlassView>

          {/* Details Grid */}
          <Text style={[styles.sectionTitle, { fontSize: scaleFont(20) }]}>{t('event.details.title')}</Text>
          <View style={styles.detailsGrid}>
            <GlassView intensity={15} style={styles.detailItem}>
              <PartyPopper size={24} color={Colors.dark.primary} style={styles.detailIcon} />
              <Text style={styles.detailLabel}>{t('event.details.type')}</Text>
              <Text style={styles.detailValue}>{translateEventType(event.event_type)}</Text>
            </GlassView>
            
            <GlassView intensity={15} style={styles.detailItem}>
              <Music size={24} color={Colors.dark.secondary} style={styles.detailIcon} />
              <Text style={styles.detailLabel}>{t('event.details.music')}</Text>
              <Text style={styles.detailValue}>{event.theme}</Text>
            </GlassView>
            
            <GlassView intensity={15} style={styles.detailItem}>
              <Users size={24} color={Colors.dark.success} style={styles.detailIcon} />
              <Text style={styles.detailLabel}>{t('event.details.age')}</Text>
              <Text style={styles.detailValue}>
                {event.age_restriction === 0 ? t('common.all') : `${event.age_restriction}+`}
              </Text>
            </GlassView>
            
            <GlassView intensity={15} style={styles.detailItem}>
              <Shirt size={24} color="#F472B6" style={styles.detailIcon} />
              <Text style={styles.detailLabel}>{t('event.details.dress_code')}</Text>
              <Text style={styles.detailValue}>{event.dress_code}</Text>
            </GlassView>
          </View>

          <View style={styles.actionButtons}>
            <ThemedButton
              title={t('event.actions.map')}
              onPress={openMaps}
              variant="outline"
              style={{ flex: 1 }}
              icon={<MapPin size={20} color={Colors.dark.primary} />}
            />
            {event.venue_plan_url && (
              <ThemedButton
                title={t('event.actions.view_plan')}
                onPress={() => setShowVenuePlan(true)}
                variant="outline"
                style={{ flex: 1 }}
                icon={<ImageIcon size={20} color="white" />}
              />
            )}
          </View>

          {/* Purchase Section */}
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <GlassView intensity={22} style={styles.purchaseCard}>
              <LinearGradient
                colors={['rgba(255,255,255,0.06)', 'rgba(124,58,237,0.16)', 'rgba(6,182,212,0.10)']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={StyleSheet.absoluteFill}
              />
              <View style={styles.purchaseHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.purchaseTitle, { fontSize: scaleFont(22) }]}>{t('event.purchase.title')}</Text>
                  <Text style={styles.purchaseSubtitle}>{hasVip ? t('event.purchase.subtitle_tickets_vip') : t('event.purchase.subtitle_tickets')}</Text>
                </View>
                <View style={styles.purchaseHeaderIcon}>
                  <Ticket size={18} color="white" />
                </View>
              </View>

              {!user && (
                <View style={styles.authNotice}>
                  <UserIcon size={16} color="white" />
                  <Text style={styles.authNoticeText}>{t('event.purchase.sign_in_to_buy')}</Text>
                </View>
              )}

              {vipLoadError && (
                <View style={styles.authNotice}>
                  <Text style={styles.authNoticeText}>
                    {vipLoadError.includes('PGRST205')
                      ? t('event.vip.load_failed')
                      : t('event.vip.load_failed')}
                  </Text>
                </View>
              )}

              <View style={styles.segmentWrap}>
                <View style={styles.segment}>
                  <TouchableOpacity
                    style={[styles.segmentItem, purchaseTab === 'tickets' && styles.segmentItemActive]}
                    onPress={() => setPurchaseTab('tickets')}
                    activeOpacity={0.9}
                  >
                    <Text style={[styles.segmentText, purchaseTab === 'tickets' && styles.segmentTextActive]}>{t('event.purchase.tab_tickets')}</Text>
                  </TouchableOpacity>
                  {hasVip && (
                    <TouchableOpacity
                      style={[styles.segmentItem, purchaseTab === 'vip' && styles.segmentItemActive]}
                      onPress={() => setPurchaseTab('vip')}
                      activeOpacity={0.9}
                    >
                      <View style={styles.segmentVipPill}>
                        <Sparkles size={14} color={purchaseTab === 'vip' ? '#0b1020' : '#fef3c7'} />
                        <Text style={[styles.segmentText, purchaseTab === 'vip' && styles.segmentTextActive]}>{t('event.purchase.tab_vip')}</Text>
                      </View>
                    </TouchableOpacity>
                  )}
                </View>
              </View>

              {purchaseTab === 'vip' && hasVip && (
                <View style={styles.vipContainer}>
                  <View style={styles.vipHeaderRow}>
                    <Text style={styles.inputLabel}>{t('event.vip.section_title')}</Text>
                    <View style={styles.vipBadge}>
                      <Text style={styles.vipBadgeText}>PREMIUM</Text>
                    </View>
                  </View>

                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
                    {(event.reservados_vip ?? []).map((vip) => {
                      const isSelected = selectedVipReservadoId === vip.id;
                      const available = vip.quantity_available ?? 0;
                      const showExtraBottle = vip.extra_bottle_price !== null && vip.extra_bottle_price !== undefined;
                      return (
                        <TouchableOpacity
                          key={vip.id}
                          onPress={() => setSelectedVipReservadoId(vip.id)}
                          style={[
                            styles.vipCard,
                            isSelected && styles.vipCardSelected,
                            available <= 0 && styles.vipCardDisabled,
                          ]}
                          disabled={available <= 0}
                          activeOpacity={0.9}
                        >
                          <LinearGradient
                            colors={
                              isSelected
                                ? ['rgba(251,191,36,0.22)', 'rgba(124,58,237,0.18)', 'rgba(6,182,212,0.10)']
                                : ['rgba(124,58,237,0.14)', 'rgba(6,182,212,0.08)', 'rgba(255,255,255,0.04)']
                            }
                            start={{ x: 0, y: 0 }}
                            end={{ x: 1, y: 1 }}
                            style={StyleSheet.absoluteFill}
                          />

                          <View style={styles.vipCardHeaderRow}>
                            <View style={[styles.vipTag, isSelected && styles.vipTagSelected]}>
                              <Sparkles size={12} color={isSelected ? '#0b1020' : '#fef3c7'} />
                              <Text style={[styles.vipTagText, isSelected && styles.vipTagTextSelected]}>VIP</Text>
                            </View>
                            <View
                              style={[
                                styles.vipStockPill,
                                available <= 0 && styles.vipStockPillSoldOut,
                                isSelected && styles.vipStockPillSelected,
                              ]}
                            >
                              <Text
                                style={[
                                  styles.vipStockText,
                                  available <= 0 && styles.vipStockTextSoldOut,
                                  isSelected && styles.vipStockTextSelected,
                                ]}
                              >
                                {available > 0 ? t('event.tickets.available', { count: available }) : t('event.tickets.sold_out')}
                              </Text>
                            </View>
                          </View>

                          <View style={styles.vipCardMainRow}>
                            <View style={{ flex: 1 }}>
                              <Text style={[styles.vipName, isSelected && styles.vipNameSelected]} numberOfLines={1}>
                                {vip.name}
                              </Text>
                              {!!vip.description && (
                                <Text style={[styles.vipDescription, isSelected && styles.vipDescriptionSelected]} numberOfLines={2}>
                                  {vip.description}
                                </Text>
                              )}
                            </View>
                            <View style={styles.vipPriceWrap}>
                              <Text style={styles.vipPriceLabel}>{t('event.purchase.total')}</Text>
                              <Text style={[styles.vipPrice, isSelected && styles.vipPriceSelected]}>{formatEuro(vip.base_price)}</Text>
                            </View>
                          </View>

                          <View style={styles.vipPillsRow}>
                            <View style={[styles.vipPill, isSelected && styles.vipPillSelected]}>
                              <Users size={14} color={isSelected ? '#0b1020' : 'rgba(255,255,255,0.92)'} />
                              <Text style={[styles.vipPillText, isSelected && styles.vipPillTextSelected]}>{vip.capacity_people}p</Text>
                            </View>
                            <View style={[styles.vipPill, isSelected && styles.vipPillSelected]}>
                              <Sparkles size={14} color={isSelected ? '#0b1020' : 'rgba(255,255,255,0.92)'} />
                              <Text style={[styles.vipPillText, isSelected && styles.vipPillTextSelected]}>
                                {t('event.vip.bottles', { count: vip.included_bottles })}
                              </Text>
                            </View>
                            {showExtraBottle && (
                              <View style={[styles.vipPill, isSelected && styles.vipPillSelected]}>
                                <Euro size={14} color={isSelected ? '#0b1020' : 'rgba(255,255,255,0.92)'} />
                                <Text style={[styles.vipPillText, isSelected && styles.vipPillTextSelected]}>
                                  {t('event.vip.extra_bottle', { price: formatEuro(vip.extra_bottle_price) })}
                                </Text>
                              </View>
                            )}
                          </View>
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>

                  <View style={styles.vipCheckoutCard}>
                    <LinearGradient
                      colors={['rgba(255,255,255,0.06)', 'rgba(251,191,36,0.16)', 'rgba(124,58,237,0.10)']}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={StyleSheet.absoluteFill}
                    />
                    <Animated.View
                      pointerEvents="none"
                      style={[
                        styles.vipLuxuryGlow,
                        {
                          opacity: vipGlow.interpolate({ inputRange: [0, 1], outputRange: [0.25, 0.65] }),
                          transform: [{ scale: vipGlow.interpolate({ inputRange: [0, 1], outputRange: [1, 1.06] }) }],
                        },
                      ]}
                    >
                      <LinearGradient
                        colors={['rgba(251,191,36,0.22)', 'rgba(255,255,255,0.08)', 'rgba(6,182,212,0.10)']}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                        style={StyleSheet.absoluteFill}
                      />
                    </Animated.View>
                    <Animated.View
                      pointerEvents="none"
                      style={[
                        styles.vipLuxuryShimmer,
                        {
                          opacity: vipShimmer.interpolate({ inputRange: [0, 1], outputRange: [0.15, 0.45] }),
                          transform: [
                            {
                              translateX: vipShimmer.interpolate({ inputRange: [0, 1], outputRange: [-140, 260] }),
                            },
                            { rotate: '-12deg' },
                          ],
                        },
                      ]}
                    >
                      <LinearGradient
                        colors={['transparent', 'rgba(255,255,255,0.16)', 'transparent']}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 0 }}
                        style={StyleSheet.absoluteFill}
                      />
                    </Animated.View>
                    <View style={styles.vipCheckoutTopRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.vipCheckoutLabel}>{t('event.vip.your_vip')}</Text>
                        <Text style={styles.vipCheckoutName} numberOfLines={1}>
                          {selectedVip?.name || '—'}
                        </Text>
                        {!!selectedVip?.description && (
                          <Text style={styles.vipCheckoutDesc} numberOfLines={2}>
                            {selectedVip.description}
                          </Text>
                        )}
                      </View>
                      <View style={styles.vipCheckoutRight}>
                        <Text style={styles.vipCheckoutLabel}>{t('event.purchase.total')}</Text>
                        <Text style={styles.vipCheckoutPrice}>{selectedVip ? formatEuro(selectedVip.base_price) : '—'}</Text>
                        {!!selectedVip && (
                          <View style={[styles.vipCheckoutStatusPill, vipAvailable > 0 ? null : styles.vipCheckoutStatusPillSoldOut]}>
                            <Text style={[styles.vipCheckoutStatusText, vipAvailable > 0 ? null : styles.vipCheckoutStatusTextSoldOut]}>
                              {vipAvailable > 0 ? t('event.vip.available') : t('event.tickets.sold_out')}
                            </Text>
                          </View>
                        )}
                      </View>
                    </View>

                    {!!selectedVip && (
                      <View style={styles.vipCheckoutPills}>
                        <View style={styles.vipCheckoutPill}>
                          <Users size={14} color="rgba(255,255,255,0.92)" />
                          <Text style={styles.vipCheckoutPillText}>{t('event.vip.people', { count: selectedVip.capacity_people })}</Text>
                        </View>
                        <View style={styles.vipCheckoutPill}>
                          <Sparkles size={14} color="rgba(255,255,255,0.92)" />
                          <Text style={styles.vipCheckoutPillText}>{t('event.vip.bottles_included', { count: selectedVip.included_bottles })}</Text>
                        </View>
                        {(selectedVip.extra_bottle_price !== null && selectedVip.extra_bottle_price !== undefined) && (
                          <View style={styles.vipCheckoutPill}>
                            <Euro size={14} color="rgba(255,255,255,0.92)" />
                            <Text style={styles.vipCheckoutPillText}>{t('event.vip.extra_bottle', { price: formatEuro(selectedVip.extra_bottle_price) })}</Text>
                          </View>
                        )}
                      </View>
                    )}
                  </View>

                  {user && !!selectedVip && (
                    <View style={[styles.walletPayContainer, styles.walletPayContainerVip]}>
                      <View style={styles.walletPayHeader}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                          <Wallet size={18} color={payVipWithWallet ? '#fbbf24' : Colors.dark.textSecondary} />
                          <Text style={styles.walletPayLabel}>{t('event.purchase.pay_with_wallet')}</Text>
                        </View>
                        <Switch
                          value={payVipWithWallet}
                          onValueChange={setPayVipWithWallet}
                          disabled={creditLoading}
                          trackColor={{ false: '#767577', true: '#fbbf24' }}
                          thumbColor={payVipWithWallet ? '#ffffff' : '#f4f3f4'}
                        />
                      </View>
                      <Text style={styles.walletBalanceText}>
                        {creditLoading ? t('event.purchase.balance_loading') : t('event.purchase.balance', { amount: creditBalance.toFixed(2) })}
                      </Text>
                      {payVipWithWallet && creditBalance <= 0 && (
                        <Text style={styles.insufficientFundsText}>{t('event.purchase.no_wallet_balance')}</Text>
                      )}
                      {payVipWithWallet && creditBalance > 0 && creditBalance < selectedVip.base_price && (
                        <Text style={styles.insufficientFundsText}>
                          {t('event.purchase.wallet_split', { wallet: creditBalance.toFixed(2), card: (selectedVip.base_price - creditBalance).toFixed(2) })}
                        </Text>
                      )}
                    </View>
                  )}

                  <ThemedButton
                    title={
                      vipAvailable <= 0
                        ? t('event.tickets.sold_out')
                        : user
                          ? payVipWithWallet
                            ? selectedVip && creditBalance > 0 && creditBalance < selectedVip.base_price
                              ? t('event.purchase.pay_split')
                              : t('event.purchase.pay_wallet')
                            : t('event.purchase.pay_card')
                          : t('auth.login')
                    }
                    onPress={handleVipPurchase}
                    loading={vipPurchasing || stripeLoading}
                    disabled={
                      vipPurchasing ||
                      stripeLoading ||
                      !selectedVipReservadoId ||
                      vipAvailable <= 0
                    }
                    style={styles.vipBuyButton}
                    variant="primary"
                    icon={
                      user && vipAvailable > 0 ? (
                        payVipWithWallet ? <Wallet size={18} color="white" /> : <CreditCard size={18} color="white" />
                      ) : undefined
                    }
                  />
                </View>
              )}

              {/* Ticket Type Selector */}
              {purchaseTab === 'tickets' && event.event_ticket_types && event.event_ticket_types.length > 0 && (
                <View style={styles.ticketTypeContainer}>
                  <Text style={styles.inputLabel}>{t('event.tickets.ticket_type')}</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                    {event.event_ticket_types.map((type) => {
                       const isSelected = selectedTicketType === type.id;
                       const available = type.quantity - (type.sold || 0);
                       return (
                         <TouchableOpacity
                           key={type.id}
                           onPress={() => setSelectedTicketType(type.id)}
                           style={[
                             styles.ticketTypeCard,
                             isSelected && styles.ticketTypeCardSelected,
                             available <= 0 && styles.ticketTypeCardDisabled
                           ]}
                           disabled={available <= 0}
                           activeOpacity={0.9}
                         >
                           <LinearGradient
                             colors={
                               isSelected
                                 ? ['rgba(124,58,237,0.22)', 'rgba(6,182,212,0.10)', 'rgba(255,255,255,0.04)']
                                : ['rgba(255,255,255,0.10)', 'rgba(255,255,255,0.04)', 'rgba(124,58,237,0.06)']
                             }
                             start={{ x: 0, y: 0 }}
                             end={{ x: 1, y: 1 }}
                             style={StyleSheet.absoluteFill}
                           />
                           <View style={styles.ticketTypeTopRow}>
                             <Text style={[styles.ticketTypeName, isSelected && styles.ticketTypeNameSelected]} numberOfLines={1}>
                               {type.name}
                             </Text>
                             <View
                               style={[
                                 styles.ticketTypeAvailPill,
                                 available <= 0 && styles.ticketTypeAvailPillSoldOut,
                                 isSelected && available > 0 && styles.ticketTypeAvailPillSelected,
                               ]}
                             >
                               <Text
                                 style={[
                                   styles.ticketTypeAvailText,
                                   available <= 0 && styles.ticketTypeAvailTextSoldOut,
                                   isSelected && available > 0 && styles.ticketTypeAvailTextSelected,
                                 ]}
                               >
                                 {available <= 0 ? t('event.tickets.sold_out') : t('event.tickets.remaining', { count: available })}
                               </Text>
                             </View>
                           </View>
                           <View style={styles.ticketTypeBottomRow}>
                             <Text style={[styles.ticketTypePrice, isSelected && styles.ticketTypePriceSelected]}>
                               {formatEuro(type.price)}
                             </Text>
                             <Text style={styles.ticketTypeUnit}>{t('event.tickets.per_ticket')}</Text>
                           </View>
                         </TouchableOpacity>
                       );
                    })}
                  </ScrollView>
                </View>
              )}

              {purchaseTab === 'tickets' && (
                <>
                  <View style={styles.priceRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.priceLabel}>{t('event.tickets.price')}</Text>
                      <Text style={[styles.availableText, currentAvailable > 0 ? null : { color: Colors.dark.error }]}>
                        {currentAvailable > 0 ? t('event.tickets.available', { count: currentAvailable }) : t('event.tickets.sold_out')}
                      </Text>
                    </View>
                    <Text style={styles.priceValue}>{formatEuro(currentPrice)}</Text>
                  </View>

                  <View style={styles.inputsContainer}>
                    <ThemedInput
                      placeholder={t('event.tickets.full_name_placeholder')}
                      value={buyerName}
                      onChangeText={setBuyerName}
                      icon={UserIcon}
                      editable={!!user && currentAvailable > 0}
                      style={styles.purchaseInput}
                    />

                    <ThemedInput
                      placeholder={t('event.tickets.email_placeholder')}
                      value={buyerEmail}
                      onChangeText={setBuyerEmail}
                      icon={Mail}
                      keyboardType="email-address"
                      autoCapitalize="none"
                      editable={!!user && currentAvailable > 0}
                      style={styles.purchaseInput}
                    />

                    <View style={styles.stepperRow}>
                      <Text style={styles.stepperLabel}>{t('event.tickets.quantity')}</Text>
                      <View style={styles.stepper}>
                        <TouchableOpacity
                          style={[styles.stepperButton, (safeQty <= 1 || currentAvailable <= 0) && styles.stepperButtonDisabled]}
                          onPress={() => setQuantity(String(Math.max(1, safeQty - 1)))}
                          disabled={safeQty <= 1 || currentAvailable <= 0}
                          activeOpacity={0.85}
                        >
                          <Minus size={16} color="white" />
                        </TouchableOpacity>
                        <View style={styles.stepperValue}>
                          <Text style={styles.stepperValueText}>{safeQty}</Text>
                        </View>
                        <TouchableOpacity
                          style={[styles.stepperButton, (safeQty >= Math.min(10, currentAvailable) || currentAvailable <= 0) && styles.stepperButtonDisabled]}
                          onPress={() => setQuantity(String(Math.min(Math.min(10, currentAvailable), safeQty + 1)))}
                          disabled={safeQty >= Math.min(10, currentAvailable) || currentAvailable <= 0}
                          activeOpacity={0.85}
                        >
                          <Plus size={16} color="white" />
                        </TouchableOpacity>
                      </View>
                    </View>
                  </View>

                  {user && (
                    <View style={styles.walletPayContainer}>
                      <View style={styles.walletPayHeader}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                          <Wallet size={18} color={payWithWallet ? Colors.dark.primary : Colors.dark.textSecondary} />
                          <Text style={styles.walletPayLabel}>{t('event.purchase.pay_with_wallet')}</Text>
                        </View>
                        <Switch
                          value={payWithWallet}
                          onValueChange={setPayWithWallet}
                          disabled={creditLoading}
                          trackColor={{ false: '#767577', true: Colors.dark.primary }}
                          thumbColor={payWithWallet ? '#ffffff' : '#f4f3f4'}
                        />
                      </View>
                      <Text style={styles.walletBalanceText}>
                        {creditLoading ? t('event.purchase.balance_loading') : t('event.purchase.balance', { amount: creditBalance.toFixed(2) })}
                      </Text>
                      {payWithWallet && creditBalance <= 0 && (
                        <Text style={styles.insufficientFundsText}>{t('event.purchase.no_wallet_balance')}</Text>
                      )}
                      {payWithWallet && creditBalance > 0 && creditBalance < total && (
                        <Text style={styles.insufficientFundsText}>
                          {t('event.purchase.wallet_split', { wallet: creditBalance.toFixed(2), card: (total - creditBalance).toFixed(2) })}
                        </Text>
                      )}
                    </View>
                  )}

                  <View style={styles.totalContainer}>
                    <Text style={styles.totalLabel}>{t('event.purchase.total')}</Text>
                    <Text style={styles.totalAmount}>{formatEuro(total)}</Text>
                  </View>

                  <ThemedButton
                    title={
                      currentAvailable <= 0
                        ? t('event.tickets.sold_out')
                        : user
                          ? payWithWallet
                            ? creditBalance > 0 && creditBalance < total
                              ? t('event.purchase.pay_split')
                              : t('event.purchase.pay_wallet')
                            : t('event.purchase.pay_card')
                          : t('auth.login')
                    }
                    onPress={handlePurchase}
                    loading={purchasing || stripeLoading}
                    disabled={purchasing || stripeLoading || currentAvailable <= 0 || (payWithWallet && creditLoading)}
                    style={[styles.confirmButton, currentAvailable <= 0 && { opacity: 0.5 }]}
                    variant={user ? 'secondary' : 'primary'}
                  />
                </>
              )}
            </GlassView>
          </KeyboardAvoidingView>
          </View>
        </View>
      </ScrollView>

      <Modal
        visible={showVenuePlan}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowVenuePlan(false)}
      >
        <View style={styles.modalContainer}>
          <TouchableOpacity 
            style={[styles.modalCloseButton, { top: insets.top + 10 }]} 
            onPress={() => setShowVenuePlan(false)}
          >
            <GlassView intensity={40} style={styles.closeButtonGlass}>
              <X size={24} color="white" />
            </GlassView>
          </TouchableOpacity>
          <Image 
            source={{ uri: event.venue_plan_url }} 
            style={styles.fullScreenImage} 
            resizeMode="contain" 
          />
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
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.dark.background,
  },
  errorText: {
    color: Colors.dark.text,
    fontSize: 18,
    marginBottom: 20,
  },
  imageContainer: {
    height: 400,
    width: '100%',
    position: 'relative',
  },
  posterImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  imageOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 200,
  },
  backButton: {
    position: 'absolute',
    top: 50,
    left: 20,
    zIndex: 10,
  },
  shareButton: {
    position: 'absolute',
    top: 50,
    right: 20,
    zIndex: 10,
  },
  backButtonGlass: {
    borderRadius: 50,
    padding: 12,
    backgroundColor: 'rgba(0,0,0,0.30)',
    borderWidth: 0,
  },
  soldBadgeContainer: {
    position: 'absolute',
    bottom: 40,
    right: 20,
  },
  soldBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
    gap: 8,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  soldText: {
    color: Colors.dark.success,
    fontWeight: 'bold',
    fontSize: 14,
  },
  content: {
    padding: 24,
    marginTop: -40,
  },
  title: {
    fontSize: 32,
    fontWeight: '800',
    color: Colors.dark.text,
    marginBottom: 12,
    letterSpacing: -0.4,
  },
  verifiedRow: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(34, 197, 94, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(34, 197, 94, 0.25)',
    marginBottom: 12,
    maxWidth: '100%',
  },
  verifiedText: {
    color: '#4ade80',
    fontWeight: '800',
    fontSize: 12,
    letterSpacing: 0.2,
  },
  description: {
    fontSize: 16,
    color: Colors.dark.textSecondary,
    lineHeight: 24,
    marginBottom: 24,
  },
  infoCard: {
    marginBottom: 32,
    padding: 0, // Reset padding as inner views handle it
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
  },
  divider: {
    height: 1,
    backgroundColor: Colors.dark.border,
    marginLeft: 56,
  },
  iconBox: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(107, 78, 255, 0.10)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  infoContent: {
    flex: 1,
  },
  infoLabel: {
    fontSize: 12,
    color: Colors.dark.textSecondary,
    marginBottom: 4,
  },
  infoValue: {
    fontSize: 18,
    color: Colors.dark.text,
    fontWeight: 'bold',
    flexWrap: 'wrap',
  },
  addressText: {
    fontSize: 14,
    color: Colors.dark.textSecondary,
    marginTop: 2,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: Colors.dark.text,
    marginBottom: 16,
  },
  detailsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 24,
  },
  detailItem: {
    width: '48%',
    alignItems: 'center',
    padding: 16,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  detailIcon: {
    marginBottom: 8,
  },
  detailLabel: {
    fontSize: 12,
    color: Colors.dark.textSecondary,
    marginBottom: 4,
  },
  detailValue: {
    fontSize: 14,
    color: Colors.dark.text,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  actionButtons: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 32,
  },
  modalContainer: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.9)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalCloseButton: {
    position: 'absolute',
    top: 50,
    right: 20,
    zIndex: 10,
  },
  closeButtonGlass: {
    borderRadius: 50,
    padding: 12,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  fullScreenImage: {
    width: '100%',
    height: '80%',
  },
  vipContainer: {
    marginBottom: 24,
  },
  vipHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  vipBadge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: 'rgba(212,175,55,0.55)',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  vipBadgeText: {
    color: '#fef3c7',
    fontWeight: '900',
    fontSize: 11,
    letterSpacing: 2,
  },
  vipCard: {
    padding: 14,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.05)',
    minWidth: 240,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    overflow: 'hidden',
  },
  vipCardSelected: {
    borderColor: 'rgba(251,191,36,0.55)',
  },
  vipCardDisabled: {
    opacity: 0.5,
  },
  vipCardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 10,
  },
  vipTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.22)',
    borderWidth: 1,
    borderColor: 'rgba(251,191,36,0.38)',
  },
  vipTagSelected: {
    backgroundColor: 'rgba(251,191,36,0.95)',
    borderColor: 'rgba(251,191,36,0.95)',
  },
  vipTagText: {
    color: '#fef3c7',
    fontWeight: '900',
    fontSize: 11,
    letterSpacing: 1.4,
  },
  vipTagTextSelected: {
    color: '#0b1020',
  },
  vipStockPill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  vipStockPillSelected: {
    backgroundColor: 'rgba(0,0,0,0.25)',
    borderColor: 'rgba(0,0,0,0.20)',
  },
  vipStockPillSoldOut: {
    backgroundColor: 'rgba(239,68,68,0.16)',
    borderColor: 'rgba(239,68,68,0.30)',
  },
  vipStockText: {
    color: 'rgba(255,255,255,0.88)',
    fontSize: 12,
    fontWeight: '800',
  },
  vipStockTextSelected: {
    color: 'rgba(255,255,255,0.92)',
  },
  vipStockTextSoldOut: {
    color: '#fecaca',
  },
  vipCardMainRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  vipName: {
    color: 'white',
    fontSize: 16,
    fontWeight: '900',
  },
  vipNameSelected: {
    color: 'white',
  },
  vipDescription: {
    marginTop: 6,
    color: 'rgba(255,255,255,0.74)',
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 16,
  },
  vipDescriptionSelected: {
    color: 'rgba(255,255,255,0.86)',
  },
  vipPriceWrap: {
    alignItems: 'flex-end',
  },
  vipPriceLabel: {
    color: 'rgba(255,255,255,0.70)',
    fontSize: 12,
    fontWeight: '800',
  },
  vipPrice: {
    color: '#fef3c7',
    fontSize: 18,
    fontWeight: '900',
    marginTop: 2,
  },
  vipPriceSelected: {
    color: '#fbbf24',
  },
  vipPillsRow: {
    marginTop: 12,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  vipPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  vipPillSelected: {
    backgroundColor: 'rgba(251,191,36,0.92)',
    borderColor: 'rgba(251,191,36,0.92)',
  },
  vipPillText: {
    color: 'rgba(255,255,255,0.92)',
    fontSize: 12,
    fontWeight: '800',
  },
  vipPillTextSelected: {
    color: '#0b1020',
  },
  vipBuyButton: {
    marginTop: 12,
  },
  vipCheckoutCard: {
    marginTop: 14,
    padding: 16,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
    overflow: 'hidden',
  },
  vipLuxuryGlow: {
    position: 'absolute',
    top: -80,
    left: -80,
    right: -80,
    bottom: -80,
  },
  vipLuxuryShimmer: {
    position: 'absolute',
    top: -40,
    bottom: -40,
    width: 140,
  },
  vipCheckoutTopRow: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'flex-start',
  },
  vipCheckoutRight: {
    alignItems: 'flex-end',
    minWidth: 96,
  },
  vipCheckoutLabel: {
    color: 'rgba(255,255,255,0.78)',
    fontSize: 12,
    fontWeight: '800',
  },
  vipCheckoutName: {
    marginTop: 6,
    color: 'white',
    fontSize: 16,
    fontWeight: '900',
  },
  vipCheckoutDesc: {
    marginTop: 6,
    color: 'rgba(255,255,255,0.70)',
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 16,
  },
  vipCheckoutPrice: {
    marginTop: 6,
    color: '#fef3c7',
    fontSize: 20,
    fontWeight: '900',
  },
  vipCheckoutStatusPill: {
    marginTop: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(16,185,129,0.16)',
    borderWidth: 1,
    borderColor: 'rgba(16,185,129,0.28)',
  },
  vipCheckoutStatusPillSoldOut: {
    backgroundColor: 'rgba(239,68,68,0.16)',
    borderColor: 'rgba(239,68,68,0.30)',
  },
  vipCheckoutStatusText: {
    color: '#bbf7d0',
    fontSize: 12,
    fontWeight: '900',
  },
  vipCheckoutStatusTextSoldOut: {
    color: '#fecaca',
  },
  vipCheckoutPills: {
    marginTop: 14,
    gap: 10,
  },
  vipCheckoutPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  vipCheckoutPillText: {
    flex: 1,
    color: 'rgba(255,255,255,0.90)',
    fontSize: 13,
    fontWeight: '700',
  },
  ticketTypeContainer: {
    marginBottom: 20,
  },
  ticketTypeCard: {
    padding: 14,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.06)',
    minWidth: 190,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    overflow: 'hidden',
  },
  ticketTypeCardSelected: {
    borderColor: Colors.dark.primary,
  },
  ticketTypeCardDisabled: {
    opacity: 0.5,
  },
  ticketTypeTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  ticketTypeAvailPill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  ticketTypeAvailPillSelected: {
    backgroundColor: 'rgba(124,58,237,0.20)',
    borderColor: 'rgba(124,58,237,0.35)',
  },
  ticketTypeAvailPillSoldOut: {
    backgroundColor: 'rgba(239,68,68,0.16)',
    borderColor: 'rgba(239,68,68,0.30)',
  },
  ticketTypeAvailText: {
    color: 'rgba(255,255,255,0.86)',
    fontSize: 12,
    fontWeight: '800',
  },
  ticketTypeAvailTextSelected: {
    color: 'rgba(255,255,255,0.92)',
  },
  ticketTypeAvailTextSoldOut: {
    color: '#fecaca',
  },
  ticketTypeName: {
    color: 'white',
    fontSize: 15,
    fontWeight: '900',
    flex: 1,
  },
  ticketTypeNameSelected: {
    color: 'white',
  },
  ticketTypePrice: {
    color: 'white',
    fontSize: 20,
    fontWeight: '900',
  },
  ticketTypePriceSelected: {
    color: '#c4b5fd',
  },
  ticketTypeBottomRow: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 10,
  },
  ticketTypeUnit: {
    color: 'rgba(255,255,255,0.68)',
    fontSize: 12,
    fontWeight: '700',
    paddingBottom: 3,
  },
  purchaseCard: {
    borderRadius: 24,
    padding: 18,
    marginTop: 18,
    marginBottom: 36,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  purchaseHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  purchaseTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: 'white',
  },
  purchaseSubtitle: {
    marginTop: 6,
    color: 'rgba(255,255,255,0.70)',
    fontSize: 13,
    fontWeight: '600',
  },
  purchaseHeaderIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  authNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.2)',
    padding: 12,
    borderRadius: 12,
    marginBottom: 20,
    gap: 10,
  },
  authNoticeText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '500',
  },
  segmentWrap: {
    marginBottom: 16,
  },
  segment: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 14,
    padding: 4,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  segmentItem: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentItemActive: {
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  segmentText: {
    color: 'rgba(255,255,255,0.72)',
    fontWeight: '800',
    fontSize: 13,
    letterSpacing: 0.2,
  },
  segmentTextActive: {
    color: 'white',
  },
  segmentVipPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  priceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
    backgroundColor: 'rgba(255,255,255,0.06)',
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  priceLabel: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 14,
  },
  inputLabel: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 12,
  },
  availableText: {
    color: Colors.dark.success,
    fontSize: 12,
    fontWeight: 'bold',
    marginTop: 4,
  },
  priceValue: {
    fontSize: 28,
    fontWeight: 'bold',
    color: 'white',
  },
  inputsContainer: {
    marginBottom: 20,
  },
  purchaseInput: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderColor: 'rgba(255,255,255,0.12)',
  },
  stepperRow: {
    marginTop: 14,
    padding: 14,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  stepperLabel: {
    color: 'rgba(255,255,255,0.78)',
    fontSize: 14,
    fontWeight: '700',
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    overflow: 'hidden',
  },
  stepperButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperButtonDisabled: {
    opacity: 0.45,
  },
  stepperValue: {
    width: 46,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  stepperValueText: {
    color: 'white',
    fontWeight: '900',
    fontSize: 14,
  },
  totalContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.2)',
  },
  totalLabel: {
    fontSize: 18,
    color: 'white',
    fontWeight: '600',
  },
  totalAmount: {
    fontSize: 24,
    fontWeight: 'bold',
    color: 'white',
  },
  confirmButton: {
    marginTop: 8,
  },
  walletPayContainer: {
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderRadius: 12,
    padding: 16,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  walletPayContainerVip: {
    borderColor: 'rgba(251,191,36,0.28)',
    backgroundColor: 'rgba(251,191,36,0.08)',
    marginTop: 24,
  },
  walletPayHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  walletPayLabel: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  walletBalanceText: {
    color: Colors.dark.textSecondary,
    fontSize: 14,
  },
  insufficientFundsText: {
    color: Colors.dark.error,
    fontSize: 12,
    marginTop: 8,
  },
});
