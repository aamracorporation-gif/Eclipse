import { CustomerPurchasePanel } from '@/components/CustomerPurchasePanel';
import { DiscountCodeField, type AppliedDiscount } from '@/components/DiscountCodeField';
import { calculateDiscountCents, discountSelectionKey } from '@/supabase/functions/_shared/discountPolicy';
import { offerUnavailableReason } from '@/supabase/functions/_shared/ticketProduct';
import { LAUNCH_FEATURES } from '@/lib/launchFeatures';
import { View, Text, StyleSheet, ScrollView, Image, TouchableOpacity, Linking, Platform, KeyboardAvoidingView, Modal, Share, Alert } from 'react-native';
import { useState, useEffect, useRef, useCallback } from 'react';
import { router, useLocalSearchParams, useSegments } from 'expo-router';
import { supabase, Event } from '@/lib/supabase';
import { useAuth } from '@/lib/AuthContext';
import { useEvents } from '@/lib/EventContext';
import { useCredit } from '@/lib/WalletContext';
import { getErrorMessage } from '@/lib/errorHelpers';
import { MapPin, Calendar, ArrowLeft, Shirt, Users, Music, PartyPopper, Clock, Image as ImageIcon, X, Share2 } from '@/lib/icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors } from '@/constants/Colors';
import { GlassView } from '@/components/ui/GlassView';
import { ThemedButton } from '@/components/ui/ThemedButton';
import { DiscoLoader } from '@/components/ui/DiscoLoader';
import { useResponsive } from '@/lib/responsive';
import { usePaymentSheetHandler } from '@/components/PaymentSheetHandler';
import { PurchaseConfirmation } from '@/components/PurchaseConfirmation';
import { useI18n } from '@/lib/I18nContext';
import { useTranslation } from 'react-i18next';
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
  const [countdown, setCountdown] = useState<{ hours: number; minutes: number } | null>(null);
  const [vipLoadError, setVipLoadError] = useState<string | null>(null);
  const [buyerName, setBuyerName] = useState('');
  const [buyerEmail, setBuyerEmail] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [purchasing, setPurchasing] = useState(false);
  const freeClaimRef = useRef<{ signature: string; id: string } | null>(null);
  const [vipPurchasing, setVipPurchasing] = useState(false);
  const [selectedTicketType, setSelectedTicketType] = useState<string | null>(null);
  const [selectedVipReservadoId, setSelectedVipReservadoId] = useState<string | null>(null);
  const [purchaseTab, setPurchaseTab] = useState<'tickets' | 'vip'>('tickets');
  const [showVenuePlan, setShowVenuePlan] = useState(false);
  const [payWithWallet, setPayWithWallet] = useState(false);
  const [payVipWithWallet, setPayVipWithWallet] = useState(false);
  const [checkingCode, setCheckingCode] = useState(false);
  const [discountCandidate, setAppliedDiscount] = useState<AppliedDiscount | null>(null);
  const [vipDiscountCandidate, setVipAppliedDiscount] = useState<AppliedDiscount | null>(null);
  const [purchaseSuccess, setPurchaseSuccess] = useState<{ title: string; message: string; variant?: 'default' | 'vip' } | null>(null);
  const { horizontalPadding, maxContentWidth, scaleFont } = useResponsive();
  const { language } = useI18n();
  const localeTag = language === 'en' ? 'en-US' : language === 'fr' ? 'fr-FR' : 'es-ES';

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
  const ticketDiscountKey = discountSelectionKey(eventId || '', 'event_ticket', selectedTicketType, parseInt(quantity) || 1);
  const vipDiscountKey = discountSelectionKey(eventId || '', 'vip_table', selectedVipReservadoId, 1);
  const appliedDiscount = discountCandidate?.selectionKey === ticketDiscountKey ? discountCandidate : null;
  const vipAppliedDiscount = vipDiscountCandidate?.selectionKey === vipDiscountKey ? vipDiscountCandidate : null;
  const discountedPrice = (price: number, discount: AppliedDiscount | null) => {
    const cents = Math.round(price * 100);
    return (cents - calculateDiscountCents(cents, discount ? {discount_type:discount.type, discount_value:discount.value} : null)) / 100;
  };

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
    setVipAppliedDiscount(null);
    setSelectedTicketType(null);
    setSelectedVipReservadoId(null);
    setPurchaseTab('tickets');
    setAppliedDiscount(null);
  }, [eventId]);

  useEffect(() => {
    // Select first AVAILABLE ticket type by default
    if (event?.event_ticket_types && event.event_ticket_types.length > 0 && !selectedTicketType) {
      // Find the first type that has availability
      const firstAvailable = event.event_ticket_types.find(t => !offerUnavailableReason({...t,event_date:event.event_date},Number((t as any).metadata?.minPerOrder||1)));
      
      if (firstAvailable) {
        setSelectedTicketType(firstAvailable.id);
        setQuantity(String((firstAvailable as any).metadata?.minPerOrder||1));
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
    if (!event.event_ticket_types?.length) setPurchaseTab('vip');
    const firstAvailable = event.reservados_vip.find((v) => (v.quantity_available ?? 0) > 0);
    setSelectedVipReservadoId((firstAvailable || event.reservados_vip[0])?.id ?? null);
  }, [event?.reservados_vip, event?.event_ticket_types?.length, selectedVipReservadoId]);

  useEffect(() => {
    if (purchaseTab !== 'vip') return;
    if (event?.reservados_vip?.length) return;
    setPurchaseTab('tickets');
  }, [event, purchaseTab]);

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
      // Filter out soft-deleted ticket types so the customer never sees them
      if (Array.isArray(normalizedEvent.event_ticket_types)) {
        normalizedEvent.event_ticket_types = normalizedEvent.event_ticket_types.filter(
          (t: any) => !t?.deleted_at && (t?.is_active ?? true)
        );
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

  // ── Realtime: actualiza aforo sin recargar toda la pantalla ──────────────────
  const refreshTicketCounts = useCallback(async () => {
    if (!eventId) return;
    try {
      const [typesRes, eventRes] = await Promise.all([
        supabase
          .from('event_ticket_types')
          .select('id, sold, quantity, is_active, deleted_at')
          .eq('event_id', eventId),
        supabase
          .from('events')
          .select('available_tickets')
          .eq('id', eventId)
          .maybeSingle(),
      ]);
      setEvent(prev => {
        if (!prev) return prev;
        const freshTypes = typesRes.data ?? [];
        const updatedTypes = (prev.event_ticket_types ?? []).map((t: any) => {
          const fresh = freshTypes.find((f: any) => f.id === t.id);
          return fresh ? { ...t, sold: fresh.sold, quantity: fresh.quantity } : t;
        });
        return {
          ...prev,
          event_ticket_types: updatedTypes,
          available_tickets: eventRes.data?.available_tickets ?? prev.available_tickets,
        };
      });
    } catch {}
  }, [eventId]);

  useEffect(() => {
    if (!eventId) return;

    // Realtime subscription (requires supabase_realtime publication on these tables)
    const channel = supabase
      .channel(`event-stock-${eventId}`)
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'event_ticket_types',
        filter: `event_id=eq.${eventId}`,
      }, () => { refreshTicketCounts(); })
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'events',
        filter: `id=eq.${eventId}`,
      }, (payload: any) => {
        setEvent(prev => prev
          ? { ...prev, available_tickets: payload.new.available_tickets ?? prev.available_tickets }
          : prev);
        refreshTicketCounts();
      })
      .subscribe();

    // Polling fallback every 8s — guarantees updates even if realtime isn't firing
    const poll = setInterval(() => { refreshTicketCounts(); }, 8000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(poll);
    };
  }, [eventId, refreshTicketCounts]);

  useEffect(() => {
    if (!event?.event_date) return;

    const calc = () => {
      const now = Date.now();
      const ms = new Date(event.event_date).getTime() - now;
      if (ms > 0 && ms < 24 * 60 * 60 * 1000) {
        // Math.ceil so that "16:50:30 → event at 18:10" shows 1h 20min (same as the phone clock)
        const totalMin = Math.ceil(ms / 60000);
        setCountdown({ hours: Math.floor(totalMin / 60), minutes: totalMin % 60 });
      } else {
        setCountdown(null);
      }
    };

    calc();

    // Sync to the next exact minute boundary so updates happen at :00 seconds,
    // exactly when the phone clock changes minute
    const msToNextMinute = 60000 - (Date.now() % 60000);
    let interval: ReturnType<typeof setInterval>;
    const timeout = setTimeout(() => {
      calc();
      interval = setInterval(calc, 60000);
    }, msToNextMinute);

    return () => {
      clearTimeout(timeout);
      clearInterval(interval);
    };
  }, [event?.event_date]);

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
    const normalizeHttpsBase = (input: string) => {
      const raw = String(input || '').trim().replace(/\/$/, '');
      if (!raw) return '';
      if (/^https:\/\//i.test(raw)) return raw;
      if (/^http:\/\//i.test(raw)) return raw.replace(/^http:\/\//i, 'https://');
      if (/^[a-z0-9.-]+\.[a-z]{2,}(?::\d+)?(\/.*)?$/i.test(raw)) return `https://${raw.replace(/\/$/, '')}`;
      return '';
    };
    const webBaseUrl = normalizeHttpsBase(
      String((process.env.EXPO_PUBLIC_WEB_BASE_URL as any) || (process.env.EXPO_PUBLIC_API_URL as any) || '')
    );
    const supabaseUrl = String(process.env.EXPO_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');

    const sharePayload = async (message: string, primaryUrl?: string) => {
      const url = String(primaryUrl || '').trim();
      const isHttpUrl = /^https?:\/\//i.test(url);
      const payload = Platform.OS === 'ios' && isHttpUrl ? { message, url } : { message };
      await Share.share(payload as any);
    };
    try {
      const result: any = await invokeEdgeFunctionStrict('event-share', { action: 'create', eventId: event.id });
      const token = String(result?.token || '').trim();
      const webUrl =
        token && webBaseUrl
          ? `${webBaseUrl}/evento/${token}`
          : token && supabaseUrl
          ? `${supabaseUrl}/functions/v1/event-share/evento/${token}`
          : String(result?.url || '').trim();
      if (!webUrl) throw new Error('No se pudo generar el enlace.');

      const message = `${title}\n\n${webUrl}`;
      await sharePayload(message, webUrl);
      return;
    } catch (e) {
      try {
        const fallbackWebUrl = webBaseUrl ? `${webBaseUrl}/event/${event.id}` : '';
        const fallbackDeepLink = ExpoLinking.createURL(`event/${event.id}`);
        const url = fallbackWebUrl || fallbackDeepLink;
        const message = `${title}\n\n${url}`;
        await sharePayload(message, fallbackWebUrl || undefined);
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

    // Check event is not in the past
    const eventDateTime = event?.event_date ? new Date(event.event_date) : new Date(NaN);
    if (new Date(event?.end_datetime || new Date(eventDateTime.getTime()+5*3600000).toISOString()) < new Date()) {
      Alert.alert('Evento finalizado', 'No es posible comprar entradas para un evento que ya ha tenido lugar.');
      return;
    }

    // Email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (buyerEmail && !emailRegex.test(buyerEmail.trim())) {
      Alert.alert('Email inválido', 'Introduce un email válido para recibir tu entrada.');
      return;
    }

    if (!buyerName.trim()) {
      showDialog({ title: t('common.error'), message: t('event.purchase.enter_name') });
      return;
    }

    const chosen = event?.event_ticket_types?.find(t => t.id === selectedTicketType);
    const qty = Math.max(Number((chosen as any)?.metadata?.minPerOrder||1), Math.min(Number((chosen as any)?.metadata?.maxPerOrder||10), parseInt(quantity)||1));
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

    const reason = selectedType ? offerUnavailableReason({...selectedType,event_date:event.event_date},qty) : null;
    if (reason) { showDialog({title:"Oferta no disponible",message:reason}); return; }
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
      const baseTotal = pricePerTicket * qty;
      const totalPrice = discountedPrice(baseTotal, appliedDiscount);

      const payTicketsWithCard = async (creditDebitEur?: number) => {
        const result = await present({
          kind: 'event_ticket',
          event_id: event.id,
          ticket_type_id: selectedTicketType,
          quantity: qty,
          buyer_name: buyerName,
          buyer_email: buyerEmail || user.email || '',
          ...(appliedDiscount ? { discount_code_id: appliedDiscount.id, discount_expected_cents: Math.round((baseTotal - totalPrice) * 100) } : {}),
          ...(typeof creditDebitEur === 'number' && Number.isFinite(creditDebitEur) && creditDebitEur > 0
            ? { credit_debit_eur: creditDebitEur }
            : {}),
        });

        if (result.status === 'canceled') return { paid: false as const };
        if (result.status === 'pending') {
          showDialog({ title: 'Compra pendiente', message: result.message });
          return { paid: false as const };
        }
        if (result.status !== 'succeeded') {
          throw new Error(result.message || 'El pago no se pudo completar.');
        }
        return { paid: true as const };
      };

      // Service fee — integer-cent arithmetic, identical to create-payment-intent-v2
      const _totalPriceCents = Math.round(totalPrice * 100);
      const _svcFeeCents = Number(pricePerTicket) === 0 ? 0 : Math.max(Math.round((_totalPriceCents * 0.015 + 25) / 0.985), 50);
      const serviceFeeForPurchase = _svcFeeCents / 100;
      const grandTotalForPurchase = (_totalPriceCents + _svcFeeCents) / 100;

      const payTicketsWithWalletOnly = async () => {
        setPurchasing(true);
        await buyTicketWithCredit({
          p_event_id: event.id,
          p_buyer_name: buyerName,
          p_buyer_email: buyerEmail || user.email || '',
          p_quantity: qty,
          p_ticket_type_id: selectedTicketType,
          p_discount_code_id: appliedDiscount?.id ?? null,
        });
      };

      if (Number(pricePerTicket) === 0) {
        const signature = JSON.stringify([event.id, selectedTicketType, qty, buyerName, user.id]);
        if (freeClaimRef.current?.signature !== signature) freeClaimRef.current = { signature, id: 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const n = Math.floor(Math.random() * 16); return (c === 'x' ? n : (n & 3) | 8).toString(16); }) };
        const { data, error } = await supabase.rpc('claim_free_tickets', {
          p_event_id: event.id, p_ticket_type_id: selectedTicketType,
          p_quantity: qty, p_buyer_name: buyerName, p_request_id: freeClaimRef.current.id,
        });
        if (error) throw error;
        if (!data?.success) throw new Error('No se pudo obtener la entrada gratuita.');
        freeClaimRef.current = null;
      } else if (!LAUNCH_FEATURES.walletCredit || !payWithWallet) {
        const r = await payTicketsWithCard();
        if (!r.paid) return;
      } else {
        // Wallet covers only the ticket price (not service fee) in split payments
        const walletDebit = Math.min(Math.max(creditBalance, 0), totalPrice);

        if (creditBalance >= grandTotalForPurchase) {
          // Full wallet: deducts ticket + service fee from balance
          await payTicketsWithWalletOnly();
        } else if (walletDebit <= 0) {
          // No wallet balance: full card (Edge Function adds service fee)
          const r = await payTicketsWithCard();
          if (!r.paid) return;
        } else {
          // Split: wallet covers part of ticket, card covers rest of ticket + full service fee
          const cardAmount = totalPrice - walletDebit + serviceFeeForPurchase;
          const decision = await new Promise<'hybrid' | 'cancel'>((resolve) => {
            showDialog({
              title: t('event.purchase.insufficient_balance_title'),
              message: t('event.purchase.wallet_split', { wallet: walletDebit.toFixed(2), card: cardAmount.toFixed(2) }),
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

      setAppliedDiscount(null);
  
      const msg =
        qty === 1
          ? t('event.purchase.success_one', { tickets: t('tickets.my_tickets') })
          : t('event.purchase.success_many', { count: qty });

      setPurchaseSuccess({ title: t('event.purchase.success_title'), message: msg });
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

    // Check event is not in the past
    const vipEventDateTime = event?.event_date ? new Date(event.event_date) : new Date(NaN);
    if (new Date(event?.end_datetime || new Date(vipEventDateTime.getTime()+5*3600000).toISOString()) < new Date()) {
      Alert.alert('Evento finalizado', 'No es posible comprar entradas para un evento que ya ha tenido lugar.');
      return;
    }

    // Email format validation
    const vipEmailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (buyerEmail && !vipEmailRegex.test(buyerEmail.trim())) {
      Alert.alert('Email inválido', 'Introduce un email válido para recibir tu entrada.');
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

    if (checkingCode || vipPurchasing || stripeLoading) return;
    setVipPurchasing(true);
    try {
      if (payVipWithWallet && creditLoading) {
        showDialog({ title: 'Cartera', message: 'Estamos cargando tu saldo. Espera un momento y vuelve a intentarlo.' });
        return;
      }
      if (vipAppliedDiscount && LAUNCH_FEATURES.walletCredit && payVipWithWallet) throw new Error('Para aplicar este descuento, selecciona el pago con tarjeta.');
      if (LAUNCH_FEATURES.walletCredit && payVipWithWallet) {
        const vipServiceFee = Math.round(((vip.base_price * 0.015 + 0.25) / 0.985) * 100) / 100;
        const vipGrandTotal = vip.base_price + vipServiceFee;
        const walletDebit = Math.min(Math.max(creditBalance, 0), vip.base_price);

        if (creditBalance >= vipGrandTotal) {
          // Full wallet: deducts VIP price + service fee from balance
          await buyVipWithCredit({
            p_vip_reservado_id: vip.id,
            p_buyer_name: buyerName,
            p_buyer_email: buyerEmail || user.email || '',
            p_service_fee: vipServiceFee,
          });
        } else if (walletDebit <= 0) {
          const result = await present({ kind: 'vip_table', reference_id: vip.id, buyer_name: buyerName, buyer_email: buyerEmail || user.email || '', ...(vipAppliedDiscount ? { discount_code_id: vipAppliedDiscount.id, discount_expected_cents: Math.round((Number(vip.base_price) - discountedPrice(Number(vip.base_price), vipAppliedDiscount)) * 100) } : {}) });
          if (result.status === 'canceled') return;
          if (result.status === 'pending') {
            showDialog({ title: 'Compra pendiente', message: result.message });
            return;
          }
          if (result.status !== 'succeeded') {
            throw new Error(result.message || 'El pago no se pudo completar.');
          }
        } else {
          const cardAmount = vip.base_price - walletDebit + vipServiceFee;
          const decision = await new Promise<'hybrid' | 'cancel'>((resolve) => {
            showDialog({
              title: t('event.purchase.insufficient_balance_title'),
              message: t('event.purchase.wallet_split', { wallet: walletDebit.toFixed(2), card: cardAmount.toFixed(2) }),
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
            ...(vipAppliedDiscount ? { discount_code_id: vipAppliedDiscount.id, discount_expected_cents: Math.round((Number(vip.base_price) - discountedPrice(Number(vip.base_price), vipAppliedDiscount)) * 100) } : {}),
            credit_debit_eur: walletDebit,
            buyer_name: buyerName,
            buyer_email: buyerEmail || user.email || '',
          });
          if (result.status === 'canceled') return;
          if (result.status === 'pending') {
            showDialog({ title: 'Compra pendiente', message: result.message });
            return;
          }
          if (result.status !== 'succeeded') {
            throw new Error(result.message || 'El pago no se pudo completar.');
          }
          await refreshCredit();
        }
      } else {
        const result = await present({ kind: 'vip_table', reference_id: vip.id, buyer_name: buyerName, buyer_email: buyerEmail || user.email || '', ...(vipAppliedDiscount ? { discount_code_id: vipAppliedDiscount.id, discount_expected_cents: Math.round((Number(vip.base_price) - discountedPrice(Number(vip.base_price), vipAppliedDiscount)) * 100) } : {}) });
        if (result.status === 'canceled') return;
          if (result.status === 'pending') {
            showDialog({ title: 'Compra pendiente', message: result.message });
            return;
          }
        if (result.status !== 'succeeded') {
          throw new Error(result.message || 'El pago no se pudo completar.');
        }
      }

      await refreshEvents();
      await fetchEvent();
      setVipAppliedDiscount(null);
      setPurchaseSuccess({
        title: '¡VIP confirmado!',
        message: 'Tu reservado VIP se ha comprado correctamente.',
        variant: 'vip',
      });
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
        <View style={{
          alignItems: 'center',
          paddingHorizontal: 32,
          maxWidth: 340,
        }}>
          <View style={{
            width: 80,
            height: 80,
            borderRadius: 40,
            backgroundColor: 'rgba(255,255,255,0.06)',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 24,
            borderWidth: 1,
            borderColor: 'rgba(255,255,255,0.10)',
          }}>
            <Text style={{ fontSize: 36 }}>🌙</Text>
          </View>
          <Text style={{
            color: '#FFFFFF',
            fontSize: 22,
            fontWeight: '700',
            textAlign: 'center',
            marginBottom: 12,
            letterSpacing: -0.3,
          }}>
            Esta fiesta ya no está disponible
          </Text>
          <Text style={{
            color: 'rgba(255,255,255,0.50)',
            fontSize: 15,
            textAlign: 'center',
            lineHeight: 22,
            marginBottom: 32,
          }}>
            El evento al que intentas acceder ha caducado o ha sido eliminado por el organizador.
          </Text>
          <ThemedButton
            title="Explorar eventos"
            onPress={() => router.replace('/(tabs)')}
            style={{ width: '100%', marginBottom: 12 }}
          />
          <ThemedButton
            title="Volver"
            onPress={safeBack}
            style={{ width: '100%', backgroundColor: 'rgba(255,255,255,0.08)' }}
          />
        </View>
      </View>
    );
  }

  const selectedType = event.event_ticket_types?.find(t => t.id === selectedTicketType);
  const minOrder = Number(selectedType?.metadata?.minPerOrder || 1);
  const maxOrder = Number(selectedType?.metadata?.maxPerOrder || 10);
  const currentPrice = selectedType ? selectedType.price : event.ticket_price;

  const safeQty = Math.max(minOrder, Math.min(maxOrder, parseInt(quantity || String(minOrder)) || minOrder));
  const saleUnavailable = selectedType ? offerUnavailableReason({ ...selectedType, event_date:event.event_date }, safeQty) : null;
  const total = currentPrice * safeQty;
  const discountedTotal = discountedPrice(total, appliedDiscount);
  const discountSaving = total - discountedTotal;

  // Service fee — integer-cent arithmetic, identical to create-payment-intent-v2
  const _discountedCents = Math.round(discountedTotal * 100);
  const _serviceFeeCents = Number(currentPrice) === 0 ? 0 : Math.max(Math.round((_discountedCents * 0.015 + 25) / 0.985), 50);
  const estimatedServiceFee = _serviceFeeCents / 100;
  const grandTotal = (_discountedCents + _serviceFeeCents) / 100;
  const selectedVip = event.reservados_vip?.find((v) => v.id === selectedVipReservadoId) ?? null;
  const vipAvailable = selectedVip ? (selectedVip.quantity_available ?? 0) : 0;
  const vipSaleUnavailable = selectedVip ? offerUnavailableReason({...selectedVip,category:'table',quantity:vipAvailable,sold:0,event_date:event.event_date},1) : null;
  const vipDiscountedTotal = selectedVip ? discountedPrice(Number(selectedVip.base_price), vipAppliedDiscount) : 0;
  const vipSaving = selectedVip ? Number(selectedVip.base_price) - vipDiscountedTotal : 0;
  const vipServiceFee = selectedVip ? Math.max(Math.round((Math.round(vipDiscountedTotal * 100) * .015 + 25) / .985), 50) / 100 : 0;

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={[Colors.dark.background, '#0f172a']}
        style={StyleSheet.absoluteFill}
      />
      
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: insets.bottom + 120 }}>
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

          {event.available_tickets <= 0 && !event.reservados_vip?.some(v=>v.quantity_available>0) && (
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

          {/* ── Countdown banner (< 24 h) ── */}
          {countdown !== null && (
            <View style={styles.countdownCard}>
              <LinearGradient
                colors={['rgba(124,58,237,0.22)', 'rgba(91,33,182,0.14)']}
                style={StyleSheet.absoluteFill}
                start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
              />
              <View style={styles.countdownLeft}>
                <Clock size={18} color="#B39DFF" />
                <Text style={styles.countdownLabel}>El evento empieza en</Text>
              </View>
              <View style={styles.countdownRight}>
                {countdown.hours > 0 && (
                  <>
                    <Text style={styles.countdownNum}>{String(countdown.hours).padStart(2, '0')}</Text>
                    <Text style={styles.countdownSep}>h</Text>
                  </>
                )}
                <Text style={styles.countdownNum}>{String(countdown.minutes).padStart(2, '0')}</Text>
                <Text style={styles.countdownSep}>min</Text>
              </View>
            </View>
          )}

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

            {(event as any).end_datetime ? (
              <>
                <View style={styles.divider} />
                <View style={styles.infoRow}>
                  <View style={styles.iconBox}>
                    <Clock size={20} color="rgba(255,255,255,0.35)" />
                  </View>
                  <View style={styles.infoContent}>
                    <Text style={styles.infoLabel}>Fin del evento</Text>
                    <Text style={styles.infoValue}>
                      {new Date((event as any).end_datetime).toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric' })}
                      {' • '}
                      {new Date((event as any).end_datetime).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
                    </Text>
                  </View>
                </View>
              </>
            ) : null}

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
              <Text style={styles.detailLabel}>{t('event.details.type', { defaultValue: 'Tipo de fiesta' })}</Text>
              <Text style={styles.detailValue}>
                {String(translateEventType(event.event_type) || '').trim() || 'Fiesta'}
              </Text>
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
            <DiscountCodeField
              key={purchaseTab}
              eventId={event.id}
              kind={purchaseTab === 'vip' ? 'vip_table' : 'event_ticket'}
              productId={purchaseTab === 'vip' ? selectedVipReservadoId : selectedTicketType}
              quantity={purchaseTab === 'vip' ? 1 : safeQty}
              value={purchaseTab === 'vip' ? vipAppliedDiscount : appliedDiscount}
              disabled={purchasing || vipPurchasing || stripeLoading}
              onChange={purchaseTab === 'vip' ? setVipAppliedDiscount : setAppliedDiscount}
              onCheckingChange={setCheckingCode}
              render={coupon => <CustomerPurchasePanel
              event={event} tab={purchaseTab} onTab={setPurchaseTab} locale={localeTag}
              selectedId={purchaseTab === 'vip' ? selectedVipReservadoId : selectedTicketType}
              onSelect={id => {
                if (purchaseTab === 'vip') setSelectedVipReservadoId(id);
                else { setSelectedTicketType(id); setQuantity(String(event.event_ticket_types?.find(t => t.id === id)?.metadata?.minPerOrder || 1)); }
              }}
              quantity={safeQty} min={minOrder} max={maxOrder} onQuantity={value => setQuantity(String(value))}
              name={buyerName} email={buyerEmail} onName={setBuyerName} onEmail={setBuyerEmail}
              subtotal={purchaseTab === 'vip' ? Number(selectedVip?.base_price || 0) : total}
              saving={purchaseTab === 'vip' ? vipSaving : discountSaving}
              fee={purchaseTab === 'vip' ? vipServiceFee : estimatedServiceFee}
              total={purchaseTab === 'vip' ? vipDiscountedTotal + vipServiceFee : grandTotal}
              unavailable={purchaseTab === 'vip' ? vipSaleUnavailable : saleUnavailable}
              busy={purchasing || vipPurchasing || stripeLoading} authenticated={!!user}
              onSubmit={purchaseTab === 'vip' ? handleVipPurchase : handlePurchase}
              coupon={coupon}
              wallet={{ enabled: LAUNCH_FEATURES.walletCredit && !!user, selected: purchaseTab === 'vip' ? payVipWithWallet : payWithWallet, onChange: purchaseTab === 'vip' ? setPayVipWithWallet : setPayWithWallet, balance: creditBalance, loading: creditLoading }}
              loadError={vipLoadError}
            />}
            />
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
  description: {
    fontSize: 16,
    color: Colors.dark.textSecondary,
    lineHeight: 24,
    marginBottom: 24,
  },
  countdownCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(124,58,237,0.35)',
    paddingHorizontal: 18,
    paddingVertical: 14,
    marginBottom: 16,
    overflow: 'hidden',
  },
  countdownLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  countdownLabel: { color: '#B39DFF', fontSize: 13, fontWeight: '600' },
  countdownRight: { flexDirection: 'row', alignItems: 'baseline', gap: 3 },
  countdownNum: { color: 'white', fontSize: 26, fontWeight: '800', letterSpacing: -1 },
  countdownSep: { color: '#B39DFF', fontSize: 14, fontWeight: '700', marginRight: 4 },
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
  }
});
