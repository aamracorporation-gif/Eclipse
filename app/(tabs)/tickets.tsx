﻿import { View, Text, StyleSheet, FlatList, Image, TouchableOpacity, RefreshControl, Platform, Modal, KeyboardAvoidingView, Animated, Easing, Alert } from 'react-native';
import { useState, useEffect, useCallback, useRef } from 'react';
import { router } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { supabase, Ticket } from '@/lib/supabase';
import { useAuth } from '@/lib/AuthContext';
import { useCredit } from '@/lib/WalletContext';
import { Ticket as TicketIcon, LogIn, DollarSign, X, Download, ChevronRight, Sparkles, CreditCard } from '@/lib/icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Colors } from '@/constants/Colors';
import { GlassView } from '@/components/ui/GlassView';
import { ThemedButton } from '@/components/ui/ThemedButton';
import { ThemedInput } from '@/components/ui/ThemedInput';
import { DiscoLoader } from '@/components/ui/DiscoLoader';
import { AuthRequiredScreen } from '@/components/ui/AuthRequiredScreen';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import QRCode from 'react-native-qrcode-svg';
import * as Print from 'expo-print';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as Haptics from 'expo-haptics';
import * as Linking from 'expo-linking';
import { addPassToWallet, canAddPasses, isPassLibraryAvailable, reportWalletDebug } from '@/lib/passkite';
import { useResponsive } from '@/lib/responsive';
import { invokeEdgeFunction } from '@/lib/edgeFunctions';
import { useTranslation } from 'react-i18next';
import { useI18n } from '@/lib/I18nContext';
import { useAppDialog } from '@/components/ui/AppDialog';
import Constants from 'expo-constants';

type ExtendedTicket = Ticket & { 
  status?: string;
  wallet_added?: boolean;
  wallet_pass_id?: string | null;
  resale_listings?: { id: string; status: string; price: number }[];
};

export default function TicketsScreen() {
  const { t } = useTranslation();
  const { language } = useI18n();
  const { user } = useAuth();
  const { show: showDialog } = useAppDialog();
  const insets = useSafeAreaInsets();
  const { horizontalPadding, maxContentWidth } = useResponsive();
  const { createResaleListing, cancelResaleListing } = useCredit();
  const [tickets, setTickets] = useState<ExtendedTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const isEmptyState = !loading && tickets.length === 0;
  const emptyFloat = useRef(new Animated.Value(0)).current;
  const emptyPulse = useRef(new Animated.Value(0)).current;
  const emptyEnter = useRef(new Animated.Value(0)).current;
  const emptyDrift = useRef(new Animated.Value(0)).current;
  const shimmer = useRef(new Animated.Value(0)).current;
  const localeTag = language === 'en' ? 'en-US' : language === 'fr' ? 'fr-FR' : 'es-ES';
  
  // Resale Modal State
  const [sellModalVisible, setSellModalVisible] = useState(false);
  const [selectedTicket, setSelectedTicket] = useState<ExtendedTicket | null>(null);
  const [resalePrice, setResalePrice] = useState('');
  const [resaleSubmitAttempted, setResaleSubmitAttempted] = useState(false);
  const [resaleTouched, setResaleTouched] = useState(false);
  const [selling, setSelling] = useState(false);
  const [addingToWallet, setAddingToWallet] = useState<string | null>(null);

  const resalePriceError = useCallback(() => {
    const normalized = String(resalePrice || '').trim().replace(',', '.');
    if (!normalized) return 'Obligatorio.';
    const price = Number(normalized);
    if (!Number.isFinite(price)) return 'Introduce un numero valido.';
    if (price < 1) return 'Precio minimo 1,00 EUR.';

    const rawOriginal = selectedTicket ? (typeof selectedTicket.total_price === 'string' ? Number(selectedTicket.total_price) : (selectedTicket as any).total_price) : 0;
    const originalPrice = typeof rawOriginal === 'number' && Number.isFinite(rawOriginal) ? rawOriginal : 0;
    const minResalePrice = Math.max(originalPrice, 1);
    const maxResalePrice = originalPrice > 0 ? originalPrice * 1.2 : 0;

    if (Number.isFinite(minResalePrice) && price < minResalePrice) {
      return `Precio minimo: ${(minResalePrice || 0).toFixed(2)} EUR`;
    }
    if (Number.isFinite(maxResalePrice) && price > maxResalePrice) {
      return `Precio maximo: ${(maxResalePrice || 0).toFixed(2)} EUR`;
    }
    return null;
  }, [resalePrice, selectedTicket]);

  useEffect(() => {
    const enabledEmpty = !loading && tickets.length === 0;
    if (!enabledEmpty) {
      emptyEnter.stopAnimation();
      emptyDrift.stopAnimation();
      emptyFloat.stopAnimation();
      emptyPulse.stopAnimation();
      emptyEnter.setValue(0);
      return;
    }

    const floatAnim = Animated.loop(
      Animated.sequence([
        Animated.timing(emptyFloat, { toValue: 1, duration: 2100, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(emptyFloat, { toValue: 0, duration: 2100, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ])
    );
    const pulseAnim = Animated.loop(
      Animated.sequence([
        Animated.timing(emptyPulse, { toValue: 1, duration: 2600, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(emptyPulse, { toValue: 0, duration: 2600, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ])
    );
    const driftAnim = Animated.loop(
      Animated.sequence([
        Animated.timing(emptyDrift, { toValue: 1, duration: 5200, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(emptyDrift, { toValue: 0, duration: 5200, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ])
    );

    floatAnim.start();
    pulseAnim.start();
    driftAnim.start();
    emptyEnter.setValue(0);
    Animated.spring(emptyEnter, { toValue: 1, speed: 14, bounciness: 6, useNativeDriver: true }).start();

    return () => {
      floatAnim.stop();
      pulseAnim.stop();
      driftAnim.stop();
    };
  }, [emptyDrift, emptyEnter, emptyFloat, emptyPulse, loading, tickets.length]);

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(shimmer, { toValue: 1, duration: 2800, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(shimmer, { toValue: 0, duration: 2800, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ])
    ).start();
  }, [shimmer]);

  const refreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchTickets = useCallback(async () => {
    if (!user) return;

    try {
      // 1. Fetch tickets without the nested relation to avoid PGRST200 error
      // Using range 0-99 to fetch up to 100 tickets initially, can be paginated later if needed
      const { data: ticketsData, error: ticketsError } = await supabase
        .from('tickets')
        .select(`
          *,
          events (
            *,
            venues (*),
            event_ticket_types (id, name, category, metadata)
          )
        `)
        .eq('user_id', user.id)
        .order('purchase_date', { ascending: false, nullsFirst: true })
        .limit(100); // Increase limit to show more tickets

      if (ticketsError) {
        console.error('Error fetching tickets query:', ticketsError);
        throw ticketsError;
      }

      // 2. Fetch resale listings manually for these tickets
      let processedTickets = ticketsData || [];
      const creatorIds = [...new Set(processedTickets
        .map((ticket: any) => ticket.events?.creator_id)
        .filter(Boolean))];
      const creatorProfiles = new Map<string, any>();
      if (creatorIds.length > 0) {
        const cardsResult = await (supabase as any)
          .from('public_profile_cards')
          .select('id, full_name, club_name')
          .in('id', creatorIds);
        if (cardsResult.error) throw cardsResult.error;
        for (const card of cardsResult.data || []) creatorProfiles.set(card.id, card);
      }
      processedTickets = processedTickets.map((ticket: any) => ({
        ...ticket,
        events: ticket.events
          ? { ...ticket.events, profiles: creatorProfiles.get(ticket.events.creator_id) ?? null }
          : ticket.events,
      }));

      // Filter out tickets for events that have already ended.
      const now = Date.now();
      processedTickets = processedTickets.filter((t: any) => {
        if (!t.events) return true;
        const endMs = t.events.end_datetime
          ? new Date(t.events.end_datetime).getTime()
          : t.events.event_date
          ? new Date(t.events.event_date).getTime() + 5 * 60 * 60 * 1000
          : null;
        return endMs === null || endMs > now;
      });
      
      if (processedTickets.length > 0) {
        const ticketIds = processedTickets.map((t: any) => t.id);
        const { data: resaleData, error: resaleError } = await supabase
          .from('resale_listings')
          .select('ticket_id, status, price')
          .in('ticket_id', ticketIds)
          .eq('status', 'active');
          
        if (!resaleError && resaleData) {
          // Map resale info to tickets
          const resaleMap = new Map(resaleData.map((r: any) => [r.ticket_id, r]));
          
          processedTickets = processedTickets.map((ticket: any) => {
            const activeListing = resaleMap.get(ticket.id);
            return {
              ...ticket,
              status: activeListing ? 'resale' : ticket.status,
              resale_listings: activeListing ? [activeListing] : []
            };
          });
        }
      }

      console.log('Tickets fetched:', processedTickets.length);
      setTickets(processedTickets);
    } catch (error) {
      console.error('Error fetching tickets:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user]);

  const scheduleRefresh = useCallback(() => {
    if (!user) return;
    if (refreshTimeoutRef.current) clearTimeout(refreshTimeoutRef.current);
    refreshTimeoutRef.current = setTimeout(() => {
      fetchTickets();
    }, 250);
  }, [fetchTickets, user]);

  useFocusEffect(
    useCallback(() => {
      if (user) {
        fetchTickets();
      } else {
        setLoading(false);
      }

      return () => {
        if (refreshTimeoutRef.current) {
          clearTimeout(refreshTimeoutRef.current);
          refreshTimeoutRef.current = null;
        }
      };
    }, [fetchTickets, user])
  );

  useEffect(() => {
    if (!user) return;

    const channel = supabase
      .channel(`tickets_realtime_${user.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'tickets', filter: `user_id=eq.${user.id}` },
        () => scheduleRefresh()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'resale_listings', filter: `seller_id=eq.${user.id}` },
        () => scheduleRefresh()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current);
        refreshTimeoutRef.current = null;
      }
    };
  }, [scheduleRefresh, user]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchTickets();
  };

  const handleSellPress = async (ticket: ExtendedTicket) => {
    if (new Date(ticket.events?.event_date || (ticket as any).event_date) < new Date()) {
      showDialog({ title: 'Evento finalizado', message: 'No puedes revender entradas de eventos que ya han tenido lugar.' });
      return;
    }

    const originalPrice = typeof (ticket as any).total_price === 'string' ? Number((ticket as any).total_price) : ((ticket as any).total_price ?? 0);
    if (originalPrice === 0) {
      showDialog({ title: 'Entrada gratuita', message: 'Las entradas gratuitas no se pueden revender.' });
      return;
    }

    const allowResaleForEvent = (ticket as any)?.events?.allow_resale ?? true;
    if (!allowResaleForEvent) {
      showDialog({ title: t('tickets.action_not_allowed_title'), message: t('tickets.resale_disabled_event') });
      return;
    }

    if (ticket.wallet_added) {
      showDialog({ title: 'Reventa no disponible', message: 'Esta entrada ya fue añadida a tu cartera digital. Las entradas añadidas a la cartera no se pueden revender.' });
      return;
    }

    if (ticket.scanned_at || ticket.validation_status === 'used' || ticket.status === 'used') {
      showDialog({ title: t('tickets.action_not_allowed_title'), message: t('tickets.used_ticket_cannot_resell') });
      return;
    }

    if (user?.id) {
      try {
        const { data: fresh, error } = await supabase
          .from('tickets')
          .select('status, scanned_at, validation_status')
          .eq('id', ticket.id)
          .eq('user_id', user.id)
          .maybeSingle();

        if (!error && fresh) {
          const isUsed = !!fresh.scanned_at || fresh.validation_status === 'used' || fresh.status === 'used';
          if (isUsed) {
            setTickets((prev) => prev.map((t) => (t.id === ticket.id ? { ...t, ...fresh } : t)));
            showDialog({ title: t('tickets.action_not_allowed_title'), message: t('tickets.used_ticket_cannot_resell') });
            return;
          }
        }
      } catch {}
    }
    
    setSelectedTicket(ticket);
    setResalePrice('');
    setResaleSubmitAttempted(false);
    setResaleTouched(false);
    setSellModalVisible(true);
  };

  const handleCancelResale = async (ticket: ExtendedTicket) => {
    showDialog({
      title: t('tickets.cancel_sale_title'),
      message: t('tickets.cancel_sale_body'),
      actions: [
        { label: t('common.no'), variant: 'outline' },
        {
          label: t('tickets.cancel_sale_confirm'),
          variant: 'primary',
          onPress: async () => {
            const originalTickets = [...tickets];
            setTickets((prev) =>
              prev.map((t) => {
                if (t.id === ticket.id) {
                  return { ...t, status: 'valid', resale_listings: [] };
                }
                return t;
              })
            );

            try {
              await cancelResaleListing(ticket.id);
              await fetchTickets();
              showDialog({ title: t('common.success'), message: t('tickets.cancel_sale_success') });
            } catch (error: any) {
              console.error(error);
              setTickets(originalTickets);
              showDialog({ title: t('common.error'), message: t('tickets.cancel_sale_error') });
            }
          },
        },
      ],
    });
  };

  const handleAddToWallet = async (ticket: ExtendedTicket) => {
    if (addingToWallet) return;
    
    // Warn user that adding to wallet blocks resale
    const allowResale = (ticket as any)?.events?.allow_resale ?? true;
    const originalPrice = typeof (ticket as any).total_price === 'string' ? Number((ticket as any).total_price) : ((ticket as any).total_price ?? 0);
    const canResell = allowResale && originalPrice > 0;
    if (canResell) {
      const confirmed = await new Promise<boolean>((resolve) => {
        Alert.alert(
          '¿Añadir a la cartera?',
          'Si añades esta entrada a tu cartera digital no podrás ponerla en reventa. Esta acción no se puede deshacer.',
          [
            { text: 'Cancelar', style: 'cancel', onPress: () => resolve(false) },
            { text: 'Añadir igualmente', onPress: () => resolve(true) },
          ]
        );
      });
      if (!confirmed) return;
    }

    setAddingToWallet(ticket.id);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    try {
      if (Platform.OS === 'ios') {
        // #region debug-point A:wallet-flow-start
        reportWalletDebug('A', 'Starting iOS wallet flow', {
          ticketId: ticket.id,
          walletAdded: !!ticket.wallet_added,
          walletPassId: ticket.wallet_pass_id || null,
          executionEnvironment: Constants.executionEnvironment ?? null,
          nativeAppVersion: Constants.nativeAppVersion ?? null,
          nativeBuildVersion: Constants.nativeBuildVersion ?? null,
        });
        // #endregion
        
        const { data, error } = await invokeEdgeFunction<{ base64: string }>('apple-wallet-generator', { ticket_id: ticket.id });
        // #region debug-point A:wallet-edge-response
        reportWalletDebug('A', 'Received apple-wallet-generator response', {
          ticketId: ticket.id,
          hasError: !!error,
          status: error ? 'error' : 'ok',
          hasBase64: !!data?.base64,
          base64Prefix: data?.base64 ? String(data.base64).slice(0, 8) : null,
          base64Length: data?.base64 ? String(data.base64).length : 0,
        });
        // #endregion
        if (error) throw new Error(String(error?.message || error));
        if (!data?.base64) throw new Error('No pass data received from server');
        if (!String(data.base64).startsWith('UEsD')) throw new Error('El pase generado no parece un .pkpass valido.');

        const libraryAvailable = await isPassLibraryAvailable();
        const walletAvailable = await canAddPasses();
        // #region debug-point C:wallet-availability-results
        reportWalletDebug('C', 'Resolved wallet availability checks', {
          ticketId: ticket.id,
          libraryAvailable,
          walletAvailable,
        });
        // #endregion
        if (!libraryAvailable || !walletAvailable) {
          throw new Error('Apple Wallet no esta disponible en este build. Instala un development build o TestFlight con PassKit.');
        }

        const result = await addPassToWallet(data.base64);
        // #region debug-point D:wallet-native-result
        reportWalletDebug('D', 'Native addPassToWallet completed', {
          ticketId: ticket.id,
          success: !!result?.success,
          error: result?.error || null,
        });
        // #endregion
        if (!result?.success) {
          throw new Error(result?.error || 'No se pudo abrir Apple Wallet.');
        }

        await supabase.from('tickets').update({ wallet_added: true, wallet_pass_id: ticket.id }).eq('id', ticket.id);
        setTickets((prev) => prev.map((t) => (t.id === ticket.id ? { ...t, wallet_added: true, wallet_pass_id: ticket.id } : t)));
      } else {
        // Android Google Wallet handling
        const { data, error } = await invokeEdgeFunction<{ url?: string; objectId?: string }>('generate-wallet-pass', { ticket_id: ticket.id, platform: 'android' });
        if (error) throw new Error(String(error?.message || error));
        if (!data?.url) throw new Error('No se recibio el enlace de Google Wallet.');
        if (!String(data.url).startsWith('https://pay.google.com/gp/v/save/')) throw new Error('Enlace de Google Wallet invalido.');
        await Linking.openURL(data.url);

        // Igual que en iOS, abrir Google Wallet no garantiza que el usuario complete el guardado.
        showDialog({
          title: t('tickets.add_to_wallet'),
          message: 'Se ha abierto Google Wallet. Si no se ha guardado la entrada, puedes volver a intentarlo.',
        });
      }
    } catch (err: any) {
      // #region debug-point E:wallet-flow-error
      reportWalletDebug('E', 'Wallet flow failed', {
        ticketId: ticket.id,
        platform: Platform.OS,
        message: String(err?.message || err),
      });
      // #endregion
      console.error('Wallet error:', err);
      const msg = err.message || t('errors.generic');
      showDialog({ title: t('common.error'), message: `${msg}\n${t('tickets.wallet_install_hint')}` });
    } finally {
      setAddingToWallet(null);
    }
  };

  const getOriginalTicketPrice = (ticket: ExtendedTicket | null | undefined) => {
    if (!ticket) return 0;
    const raw = typeof ticket.total_price === 'string' ? Number(ticket.total_price) : ticket.total_price;
    return typeof raw === 'number' && Number.isFinite(raw) ? raw : 0;
  };

  const confirmSell = async () => {
    if (!selectedTicket || !resalePrice) return;
    setResaleSubmitAttempted(true);
    setResaleTouched(true);
    
    const normalized = resalePrice.replace(',', '.');
    const price = Number(normalized);
    const err = resalePriceError();
    if (err) {
      showDialog({ title: 'Precio invalido', message: err });
      return;
    }

    const originalPrice = getOriginalTicketPrice(selectedTicket);
    const minResalePrice = Math.max(originalPrice, 1);
    const maxResalePrice = originalPrice > 0 ? originalPrice * 1.2 : 0;

    if (Number.isFinite(minResalePrice) && price < minResalePrice) {
      showDialog({
        title: t('tickets.action_not_allowed_title'),
        message: t('tickets.resale_min_price_body', { price: (minResalePrice || 0).toFixed(2) }),
      });
      return;
    }

    if (Number.isFinite(maxResalePrice) && price > maxResalePrice) {
      showDialog({
        title: t('tickets.action_not_allowed_title'),
        message: t('tickets.resale_max_price_body', { price: (maxResalePrice || 0).toFixed(2) }),
      });
      return;
    }

    // 1. Optimistic Update & Close Modal Immediately
    const originalTickets = [...tickets]; // Backup for rollback
    const tempId = Math.random().toString(); // Temporary ID

    // Update UI immediately
    setTickets(prevTickets => prevTickets.map(t => {
      if (t.id === selectedTicket.id) {
          return {
              ...t,
              status: 'resale',
              resale_listings: [{ id: tempId, status: 'active', price }]
          };
      }
      return t;
    }));

    setSellModalVisible(false);
    showDialog({ title: t('tickets.processing_title'), message: t('tickets.processing_body') });

    // 2. Perform operation in background
    try {
      setSelling(true);
      await createResaleListing(selectedTicket.id, price);
      // Success - Silent refresh to sync data
      fetchTickets();
    } catch (error: any) {
      // 3. Revert on failure
      console.error("Resale failed:", error);
      setTickets(originalTickets); // Revert UI
      showDialog({
        title: t('common.error'),
        message: t('tickets.put_on_sale_failed', { error: String(error?.message || t('errors.generic')) }),
      });
    } finally {
      setSelling(false);
    }
  };

  const handleDownloadPDF = async (ticket: ExtendedTicket) => {
    const isOnResale =
      ticket.status === 'resale' ||
      ticket.ticket_status === 'reselling' ||
      (Array.isArray(ticket.resale_listings) && ticket.resale_listings.some((l) => l?.status === 'active'));

    if (isOnResale) {
      showDialog({ title: t('tickets.pdf_disabled_resale_title'), message: t('tickets.pdf_disabled_resale_body') });
      return;
    }

    try {
      // Helper to get organizer name safely
      const organizerProfile = Array.isArray(ticket.events?.profiles) 
        ? ticket.events?.profiles[0] 
        : (ticket.events?.profiles as any);
        
      const organizerName = organizerProfile?.club_name || organizerProfile?.full_name || 'Organizador';
      const dateTimeText = ticket.events?.event_date
        ? `${new Date(ticket.events.event_date).toLocaleDateString(localeTag, { year: 'numeric', month: 'long', day: 'numeric' })} ${new Date(ticket.events.event_date).toLocaleTimeString(localeTag, { hour: '2-digit', minute: '2-digit' })}`
        : 'N/A';
      const qrValue = encodeURIComponent(String(ticket.qr_token || ticket.qr_code || ''));

      const html = `
        <html>
          <head>
            <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, minimum-scale=1.0, user-scalable=no" />
            <style>
              body { font-family: 'Helvetica', sans-serif; padding: 20px; background-color: #f4f4f4; -webkit-print-color-adjust: exact; }
              .ticket { 
                border: 1px solid #ddd; 
                background: white;
                padding: 0; 
                border-radius: 16px; 
                max-width: 600px; 
                margin: 0 auto; 
                overflow: hidden;
                box-shadow: 0 4px 6px rgba(0,0,0,0.1);
              }
              .header { 
                background-color: #000; 
                color: #fff; 
                padding: 24px; 
                text-align: center;
              }
              .title { 
                font-size: 28px; 
                font-weight: bold; 
                margin: 0;
                text-transform: uppercase;
                letter-spacing: 1px;
              }
              .poster {
                width: 100%;
                height: 200px;
                object-fit: cover;
                background-color: #eee;
              }
              .info-container {
                padding: 24px;
              }
              .info-row {
                margin-bottom: 16px;
                border-bottom: 1px dashed #eee;
                padding-bottom: 16px;
              }
              .info-label {
                font-size: 12px;
                color: #666;
                text-transform: uppercase;
                letter-spacing: 0.5px;
                margin-bottom: 4px;
              }
              .info-value {
                font-size: 18px;
                font-weight: bold;
                color: #000;
              }
              .qr-section { 
                background-color: #f9f9f9;
                padding: 30px;
                text-align: center;
                border-top: 1px solid #eee;
              }
              .footer { 
                font-size: 10px; 
                color: #999; 
                text-align: center;
                padding: 16px;
                background: #fff;
              }
            </style>
          </head>
          <body>
            <div class="ticket">
              <div class="header">
                <div class="title">${ticket.events?.title || t('tickets_pdf.ticket_title')}</div>
              </div>
              ${ticket.events?.poster_url ? `<img src="${ticket.events.poster_url}" class="poster" />` : ''}
              <div class="info-container">
                <div class="info-row">
                  <div class="info-label">${t('tickets_pdf.organizer')}</div>
                  <div class="info-value">${organizerName}</div>
                </div>
                <div class="info-row">
                  <div class="info-label">${t('tickets_pdf.event')}</div>
                  <div class="info-value">${ticket.events?.title}</div>
                </div>
                <div class="info-row">
                  <div class="info-label">${t('tickets_pdf.date_time')}</div>
                  <div class="info-value">${dateTimeText}</div>
                </div>
                <div class="info-row">
                  <div class="info-label">${t('tickets_pdf.location')}</div>
                  <div class="info-value">${ticket.events?.venues?.name || t('tickets_pdf.location_tbd')}</div>
                </div>
                <div class="info-row">
                  <div class="info-label">${t('tickets_pdf.holder')}</div>
                  <div class="info-value">${ticket.buyer_name || t('tickets_pdf.guest')}</div>
                </div>
                <div class="info-row">
                  <div class="info-label">${t('tickets_pdf.ticket_id')}</div>
                  <div class="info-value">#${ticket.id.slice(0, 8).toUpperCase()}</div>
                </div>
              </div>
            </div>
            
            <div class="qr-section">
              <div class="qr-container">
                <img src="https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${qrValue}" style="width: 200px; height: 200px;" />
              </div>
              ${(ticket as any).short_code ? `<div style="margin-top:12px;font-size:11px;color:#999;text-transform:uppercase;letter-spacing:0.5px;">Código de entrada</div><div style="font-size:22px;font-weight:bold;color:#000;letter-spacing:4px;margin-top:2px;">${(ticket as any).short_code}</div>` : ''}
              <div class="qr-help">${t('tickets_pdf.present_code')}</div>
            </div>
        </body>
      </html>
    `;

      if (Platform.OS === 'web') {
        const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `ticket-${ticket.id}.html`;
        link.click();
        URL.revokeObjectURL(url);
      } else {
        const { uri } = await Print.printToFileAsync({ html });
        const canShare = await Sharing.isAvailableAsync();
        if (canShare) {
          await Sharing.shareAsync(uri, { UTI: '.pdf', mimeType: 'application/pdf' });
        } else {
          await Print.printAsync({ html });
        }
      }
    } catch (error) {
      console.error('Error downloading ticket:', error);
      showDialog({ title: 'Error', message: 'No se pudo descargar la entrada' });
    }
  };

  const renderTicket = ({ item }: { item: ExtendedTicket }) => {
    const isResale = item.status === 'resale';
    const isUsed = !!(item.scanned_at || item.validation_status === 'used');
    const eventDate = item.events?.event_date ? new Date(item.events.event_date) : null;
    const eventId = item.events?.id;
    // ── Proper ticket-type detection ──────────────────────────────────────────
    // event_ticket_types lives under events (not directly on tickets)
    const ticketTypeRecord = item.ticket_type_id
      ? ((item.events as any)?.event_ticket_types ?? []).find((t: any) => t.id === item.ticket_type_id)
      : null;
    const ticketTypeName: string = ticketTypeRecord?.name ?? '';
    const ticketCategory: string = (ticketTypeRecord?.category ?? '').toLowerCase();
    const nameLower = ticketTypeName.toLowerCase();
    const isFastlane  = nameLower.includes('fast') || nameLower.includes('lane') || nameLower.includes('express') || ticketCategory.includes('fast');
    const isBackstage = ticketCategory.includes('gold') || ticketCategory.includes('backstage') || nameLower.includes('backstage') || nameLower.includes('back stage');
    const isVipTier   = ticketCategory.includes('vip') || nameLower.includes('vip');
    const visualTier  = isFastlane ? 'fastlane' : isBackstage ? 'backstage' : isVipTier ? 'vip' : 'general';

    // ── Per-tier visual config ────────────────────────────────────────────────
    const tierConfig = {
      general: {
        label: '◇ GENERAL',
        accent: '#00DCFF',
        labelColor: '#00DCFF',
        grad: ['#001830', '#000C18', '#000508'] as const,
        spotGrad: ['#00DCFF25', '#00DCFF00'] as const,
        borderColor: 'rgba(0,220,255,0.18)',
      },
      vip: {
        label: '★ VIP',
        accent: '#FFCD00',
        labelColor: '#FFCD00',
        grad: ['#1A1100', '#0D0900', '#050300'] as const,
        spotGrad: ['#FFCD0040', '#FFCD0000'] as const,
        borderColor: 'rgba(255,205,0,0.28)',
      },
      backstage: {
        label: '✦ BACKSTAGE',
        accent: '#FF7319',
        labelColor: '#FF7319',
        grad: ['#1C0800', '#0D0400', '#050200'] as const,
        spotGrad: ['#FF731940', '#FF731900'] as const,
        borderColor: 'rgba(255,115,25,0.28)',
      },
      fastlane: {
        label: '⚡ FASTLANE',
        accent: '#A855F7',
        labelColor: '#D8B4FE',
        grad: ['#0D0020', '#060010', '#020005'] as const,
        spotGrad: ['#A855F740', '#A855F700'] as const,
        borderColor: 'rgba(168,85,247,0.28)',
      },
    }[visualTier];

    const shortDate = eventDate
      ? `${eventDate.toLocaleDateString(localeTag, { weekday: 'short' })} · ${eventDate.getDate()} ${eventDate.toLocaleDateString(localeTag, { month: 'short' })}`
      : '—';
    const time = eventDate ? eventDate.toLocaleTimeString(localeTag, { hour: '2-digit', minute: '2-digit' }) : '—';
    const eventYear = eventDate ? eventDate.getFullYear() : new Date().getFullYear();
    const ticketShort = item.id.slice(0, 4).toUpperCase();
    const sectionLabel = (ticketTypeName || tierConfig.label.replace(/^[^\s]+\s/, '')).replace(/^Premium · /, '');
    const rowLabel = '—';
    const seatLabel = `${(item as any).quantity ?? 1}P`;
    const ticketCode = `ECL-${eventYear}-${ticketShort}-${visualTier.toUpperCase()}`;

    // Single shared shimmer translateX — runs on native thread, zero JS cost
    const shimmerX = shimmer.interpolate({ inputRange: [0, 1], outputRange: [-420, 420] });

    return (
      <View style={styles.ticketContainer}>
        {/* Tier-coloured outer shadow wrapper */}
        <View style={[styles.tcCard, { shadowColor: tierConfig.accent }]}>

          {/* ══ POSTER ═══════════════════════════════════════════════════ */}
          <TouchableOpacity activeOpacity={0.96} disabled={!eventId}
            onPress={() => { if (eventId) router.push(`/(tabs)/event/${eventId}`); }}
            style={styles.tcPoster}>

            {/* Base tier gradient */}
            <LinearGradient colors={[...tierConfig.grad]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />

            {/* Poster at 75% — visible, the hero */}
            {item.events?.poster_url
              ? <Image source={{ uri: item.events.poster_url }} style={[StyleSheet.absoluteFill, { opacity: 0.75 }]} resizeMode="cover" />
              : <LinearGradient colors={[tierConfig.grad[0], tierConfig.grad[1], tierConfig.grad[2]]} style={StyleSheet.absoluteFill} />
            }

            {/* Tier colour tint — makes photo feel "owned" by the tier */}
            <LinearGradient
              colors={[`${tierConfig.accent}3A`, 'transparent', `${tierConfig.grad[2]}BB`]}
              locations={[0, 0.55, 1]} start={{ x: 0.1, y: 0 }} end={{ x: 0.9, y: 1 }}
              style={[StyleSheet.absoluteFill, { opacity: 0.55 }]} />

            {/* Tier glow from a corner — unique per tier */}
            <LinearGradient
              colors={[`${tierConfig.accent}60`, `${tierConfig.accent}15`, 'transparent']}
              start={
                visualTier === 'vip'       ? { x: 1, y: 0 } :
                visualTier === 'backstage' ? { x: 0, y: 1 } :
                visualTier === 'fastlane'  ? { x: 1, y: 0.5 } :
                                             { x: 0, y: 0.5 }}
              end={{ x: 0.4, y: 0.4 }}
              style={StyleSheet.absoluteFill} />

            {/* Single smooth shimmer sweep — all tiers, native thread only */}
            <Animated.View pointerEvents="none"
              style={[StyleSheet.absoluteFill, { transform: [{ translateX: shimmerX }, { rotate: '-18deg' }] }]}>
              <LinearGradient
                colors={['transparent', `${tierConfig.accent}28`, `${tierConfig.accent}12`, 'transparent']}
                start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                style={{ flex: 1, width: 200 }} />
            </Animated.View>

            {/* Top scrim — badge legibility */}
            <LinearGradient colors={['rgba(0,0,0,0.60)', 'rgba(0,0,0,0.10)', 'transparent']}
              start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }}
              style={[StyleSheet.absoluteFill, { height: 80 }]} />

            {/* Bottom scrim — text legibility */}
            <LinearGradient
              colors={['transparent', 'rgba(0,0,0,0.15)', 'rgba(0,0,0,0.70)', 'rgba(0,0,0,0.97)']}
              locations={[0, 0.40, 0.70, 1]} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }}
              style={StyleSheet.absoluteFill} />

            {/* Tier accent bar — left edge, full height */}
            <View style={[styles.tcAccentBar, { backgroundColor: tierConfig.accent }]} />

            {/* ── Badge top-left ── */}
            <View style={[styles.tcBadge, { backgroundColor: `${tierConfig.accent}22`, borderColor: `${tierConfig.accent}88` }]}>
              <View style={[styles.tcBadgeDot, { backgroundColor: tierConfig.accent }]} />
              <Text style={[styles.tcBadgeText, { color: tierConfig.labelColor }]}>{tierConfig.label}</Text>
            </View>

            {/* ── Status stamp top-right ── */}
            {(isResale || isUsed) && (
              <View style={[styles.tcStamp, isUsed ? styles.tcStampUsed : styles.tcStampResale]}>
                <Text style={[styles.tcStampText, { color: isUsed ? '#ef4444' : '#fbbf24' }]}>
                  {isUsed ? 'USADO' : 'EN VENTA'}
                </Text>
              </View>
            )}

            {/* ── Event info bottom ── */}
            <View style={styles.tcPosterInfo}>
              <Text style={styles.tcEventName} numberOfLines={2}>{item.events?.title || '—'}</Text>
              <View style={styles.tcMetaRow}>
                <Text style={styles.tcMetaText} numberOfLines={1}>
                  {item.events?.venues?.name || t('tickets_pdf.location_tbd')}
                </Text>
                <View style={[styles.tcMetaDot, { backgroundColor: tierConfig.accent }]} />
                <Text style={styles.tcMetaText}>{shortDate}</Text>
                <View style={[styles.tcMetaDot, { backgroundColor: tierConfig.accent }]} />
                <Text style={styles.tcMetaText}>{time}</Text>
              </View>
            </View>
          </TouchableOpacity>

          {/* ══ TEAR LINE ════════════════════════════════════════════════ */}
          <View style={[styles.tcTearRow, { backgroundColor: '#07070F' }]}>
            <View style={[styles.tcNotch, styles.tcNotchL, { borderColor: tierConfig.accent + '30', backgroundColor: Colors.dark.background }]} />
            <View style={styles.tcTearDashes}>
              {Array.from({ length: 26 }).map((_, i) => (
                <View key={i} style={[styles.tcTearDash, { backgroundColor: tierConfig.accent + '50' }]} />
              ))}
            </View>
            <View style={[styles.tcNotch, styles.tcNotchR, { borderColor: tierConfig.accent + '30', backgroundColor: Colors.dark.background }]} />
          </View>

          {/* ══ PERFORATED TEAR LINE ══════════════════════════════════ */}
          <View style={[styles.tcTearRow, { backgroundColor: '#0A0A10' }]}>
            <View style={[styles.tcTearCircle, styles.tcTearCircleLeft, { borderColor: `${tierConfig.accent}30` }]} />
            <View style={styles.tcTearDashes}>
              {Array.from({ length: 22 }).map((_, i) => (
                <View key={i} style={[styles.tcTearDash, { backgroundColor: `${tierConfig.accent}45` }]} />
              ))}
            </View>
            <View style={[styles.tcTearCircle, styles.tcTearCircleRight, { borderColor: `${tierConfig.accent}30` }]} />
          </View>

          {/* ══ LOWER BODY ════════════════════════════════════════════ */}
          <View style={[styles.tcBody, { backgroundColor: '#07070F' }]}>
            {/* Left accent bar continued */}
            <View style={[styles.tcAccentBar, { backgroundColor: tierConfig.accent, opacity: 0.35 }]} />

            {/* Fields */}
            <View style={styles.tcFields}>
              <View style={styles.tcField}>
                <Text style={[styles.tcFieldLabel, { color: tierConfig.accent }]}>TIPO DE ENTRADA</Text>
                <Text style={styles.tcFieldValue}>{sectionLabel || 'GENERAL'}</Text>
              </View>
              <View style={styles.tcField}>
                <Text style={[styles.tcFieldLabel, { color: tierConfig.accent }]}>CANTIDAD</Text>
                <Text style={styles.tcFieldValue}>{seatLabel}</Text>
              </View>
              {(item as any).short_code ? (
                <View style={styles.tcField}>
                  <Text style={[styles.tcFieldLabel, { color: tierConfig.accent }]}>CÓDIGO</Text>
                  <Text style={[styles.tcFieldMono, { color: 'rgba(255,255,255,0.70)' }]}>{(item as any).short_code}</Text>
                </View>
              ) : null}
            </View>

            {/* Divider */}
            <View style={[styles.tcVertDivider, { backgroundColor: `${tierConfig.accent}30` }]} />

            {/* QR */}
            <View style={styles.tcQrWrap}>
              {!isResale ? (
                <View style={[styles.tcQrBox, { borderColor: `${tierConfig.accent}55` }]}>
                  <QRCode value={item.qr_token || item.qr_code || item.id} size={106} color="#07070F" backgroundColor="white" />
                  {isUsed && (
                    <View style={styles.tcQrOverlay}>
                      <Text style={styles.tcQrOverlayText}>USADO</Text>
                    </View>
                  )}
                </View>
              ) : (
                <View style={[styles.tcQrBox, { alignItems: 'center', justifyContent: 'center' }]}>
                  <Text style={{ fontSize: 9, color: 'rgba(255,255,255,0.35)', textAlign: 'center', fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                    {t('tickets.qr_disabled_resale')}
                  </Text>
                </View>
              )}
              <Text style={[styles.tcScanHint, { color: `${tierConfig.accent}90` }]}>{t('tickets.card.scan_at_entry')}</Text>
            </View>
          </View>

          {/* ══ ACTION ROW ════════════════════════════════════════════ */}
          {/* Avisos de restricciones */}
          {(item.wallet_added || (item as any)?.events?.allow_resale === false) && !isUsed && !isResale && (
            <View style={{ paddingHorizontal: 12, paddingTop: 8, gap: 4 }}>
              {item.wallet_added && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' }}>
                  <Text style={{ fontSize: 10, color: 'rgba(255,255,255,0.38)', fontWeight: '600', letterSpacing: 0.2 }}>🔒 Añadida a cartera — reventa no disponible</Text>
                </View>
              )}
              {(item as any)?.events?.allow_resale === false && !item.wallet_added && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' }}>
                  <Text style={{ fontSize: 10, color: 'rgba(255,255,255,0.38)', fontWeight: '600', letterSpacing: 0.2 }}>🔒 El organizador ha prohibido la reventa</Text>
                </View>
              )}
            </View>
          )}

          <View style={[styles.tcActions, { borderTopColor: `${tierConfig.accent}20`, backgroundColor: '#050510' }]}>
            <TouchableOpacity style={[styles.tcActionBtn, isResale && styles.tcActionBtnDim]} onPress={() => handleDownloadPDF(item)} disabled={isResale}>
              <Download size={13} color={isResale ? '#374151' : '#6b7280'} />
              <Text style={[styles.tcActionBtnTxt, isResale && { color: '#374151' }]}>{t('tickets.download')}</Text>
            </TouchableOpacity>

            {!isUsed && !isResale && (
              <TouchableOpacity
                style={[styles.tcActionBtn, item.wallet_added && { borderColor: `${Colors.dark.success}60`, backgroundColor: `${Colors.dark.success}0D` }]}
                onPress={() => !item.wallet_added && void handleAddToWallet(item)}
                disabled={!!item.wallet_added || addingToWallet === item.id}
              >
                <CreditCard size={13} color={item.wallet_added ? Colors.dark.success : '#6b7280'} />
                <Text style={[styles.tcActionBtnTxt, item.wallet_added && { color: Colors.dark.success }]} numberOfLines={1}>
                  {item.wallet_added ? '✓ Cartera' : addingToWallet === item.id ? '...' : t('tickets.add_to_wallet')}
                </Text>
              </TouchableOpacity>
            )}

            {(() => {
              const resaleBlocked = isUsed || !!item.wallet_added || (item as any)?.events?.allow_resale === false;
              return !isResale ? (
                <TouchableOpacity
                  style={[styles.tcActionBtn, { borderColor: resaleBlocked ? '#1f2937' : `${tierConfig.accent}45`, backgroundColor: resaleBlocked ? 'transparent' : `${tierConfig.accent}0F` }, resaleBlocked && styles.tcActionBtnDim]}
                  onPress={() => !resaleBlocked && void handleSellPress(item)}
                  disabled={resaleBlocked}
                >
                  <DollarSign size={13} color={resaleBlocked ? '#374151' : tierConfig.accent} />
                  <Text style={[styles.tcActionBtnTxt, { color: resaleBlocked ? '#374151' : tierConfig.accent }]}>
                    {isUsed ? t('tickets.used') : t('tickets.sell')}
                  </Text>
                </TouchableOpacity>
              ) : (
              <TouchableOpacity style={[styles.tcActionBtn, { borderColor: 'rgba(239,68,68,0.35)', backgroundColor: 'rgba(239,68,68,0.07)' }]} onPress={() => handleCancelResale(item)}>
                <X size={13} color="#ef4444" />
                <Text style={[styles.tcActionBtnTxt, { color: '#ef4444' }]}>{t('common.cancel')}</Text>
              </TouchableOpacity>
              );
            })()}
          </View>

        </View>
      </View>
    );
  };

  if (!user) {
    return (
      <AuthRequiredScreen
        title={t('auth.login')}
        subtitle={t('tickets.login_required_body')}
        ctaLabel={t('auth.login')}
        secondaryCtaLabel={t('auth.register')}
        Icon={LogIn}
        variant="resaleCard"
        eyebrow={`ECLIPSE | ${String(t('tickets.my_tickets')).toUpperCase()}`}
      />
    );
  }

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={[Colors.dark.background, '#0f172a']}
        style={StyleSheet.absoluteFill}
      />
      
      <View
        style={[
          styles.header,
          {
            paddingTop: insets.top + 20,
            paddingHorizontal: horizontalPadding,
            width: '100%',
            maxWidth: maxContentWidth,
            alignSelf: 'center',
          },
        ]}
      >
        <Text style={styles.headerTitle}>{t('tickets.my_tickets')}</Text>
        <Text style={styles.headerSubtitle}>
          {tickets.length} {tickets.length === 1 ? t('tickets.ticket') : t('tickets.tickets_count')}
        </Text>
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <DiscoLoader label={t('common.loading')} size={150} />
        </View>
      ) : (
        <FlatList
          data={tickets}
          renderItem={renderTicket}
          keyExtractor={(item) => item.id}
          contentContainerStyle={
            isEmptyState
              ? styles.listContentEmpty
              : styles.listContent
          }
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            refreshing ? (
              <View style={{ paddingTop: 14, paddingBottom: 10, alignItems: 'center' }}>
                <DiscoLoader size={46} />
              </View>
            ) : null
          }
          refreshControl={
            <RefreshControl
              refreshing={false}
              onRefresh={onRefresh}
              tintColor="transparent"
              colors={['transparent']}
              progressBackgroundColor="transparent"
              progressViewOffset={-10000}
              title=""
              titleColor="transparent"
              style={{ opacity: 0, height: 0, transform: [{ scaleX: 0.01 }, { scaleY: 0.01 }] }}
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyScreen}>
              <Animated.View style={[styles.emptyHeroWrap, { opacity: emptyEnter, transform: [{ scale: emptyEnter.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) }] }]}>
                <LinearGradient
                  colors={[Colors.dark.primary, Colors.dark.secondary, 'rgba(255,255,255,0.10)']}
                  start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                  style={styles.emptyCardBorder}
                >
                  <View style={styles.emptyHeroCard}>
                    <LinearGradient colors={['#1E1040', '#0F0A22', '#0A0618']} locations={[0, 0.5, 1]} style={StyleSheet.absoluteFill} />
                    <Animated.View pointerEvents="none" style={[styles.emptyOrb, styles.emptyOrbA, {
                      opacity: emptyPulse.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }),
                      transform: [
                        { translateX: emptyDrift.interpolate({ inputRange: [0, 1], outputRange: [-12, 12] }) },
                        { translateY: emptyDrift.interpolate({ inputRange: [0, 1], outputRange: [8, -8] }) },
                        { scale: emptyPulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.1] }) },
                      ],
                    }]} />
                    <Animated.View pointerEvents="none" style={[styles.emptyOrb, styles.emptyOrbB, {
                      opacity: emptyPulse.interpolate({ inputRange: [0, 1], outputRange: [0.3, 0.6] }),
                      transform: [
                        { translateX: emptyDrift.interpolate({ inputRange: [0, 1], outputRange: [10, -10] }) },
                        { translateY: emptyDrift.interpolate({ inputRange: [0, 1], outputRange: [-8, 8] }) },
                        { scale: emptyPulse.interpolate({ inputRange: [0, 1], outputRange: [1.05, 0.97] }) },
                      ],
                    }]} />

                    <Text style={styles.emptyEyebrow}>✦ ECLIPSE ✦</Text>

                    <Animated.View style={[styles.emptyIconFloat, { transform: [{ translateY: emptyFloat.interpolate({ inputRange: [0, 1], outputRange: [0, -8] }) }] }]}>
                      <Animated.View style={{ transform: [{ scale: emptyPulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.05] }) }] }}>
                        <LinearGradient colors={[Colors.dark.primary, Colors.dark.secondary]} style={styles.emptyIconRing}>
                          <View style={styles.emptyIconInner}>
                            <TicketIcon size={28} color="white" />
                          </View>
                        </LinearGradient>
                      </Animated.View>
                    </Animated.View>

                    <Text style={styles.emptyTitle}>{t('tickets.no_tickets')}</Text>
                    <Text style={styles.emptySubtitle}>{t('tickets.empty_subtitle')}</Text>

                    <TouchableOpacity
                      activeOpacity={0.85}
                      onPress={() => { Haptics.selectionAsync(); router.push('/(tabs)'); }}
                      style={styles.emptyCtaOuter}
                    >
                      <LinearGradient
                        colors={[Colors.dark.primary, Colors.dark.secondary]}
                        start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                        style={styles.emptyCtaInner}
                      >
                        <Text style={styles.emptyCtaText}>{t('tickets.buy_tickets')}</Text>
                        <ChevronRight size={16} color="white" />
                      </LinearGradient>
                    </TouchableOpacity>
                    <TouchableOpacity
                      activeOpacity={0.75}
                      onPress={() => { Haptics.selectionAsync(); router.push('/(tabs)/resale'); }}
                      style={styles.emptyCtaSecondary}
                    >
                      <Text style={styles.emptyCtaSecondaryText}>{t('tickets.empty.view_resale')}</Text>
                    </TouchableOpacity>
                  </View>
                </LinearGradient>
              </Animated.View>
            </View>
          }
        />
      )}
      {/* Sell Modal */}
      <Modal
        visible={sellModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setSellModalVisible(false)}
      >
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={insets.top + 40}
        >
          <GlassView intensity={40} style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{t('tickets.sell_modal.title')}</Text>
              <TouchableOpacity onPress={() => setSellModalVisible(false)}>
                <X size={24} color={Colors.dark.text} />
              </TouchableOpacity>
            </View>
            
            <Text style={styles.modalText}>
              {t('tickets.sell_modal.body', { event: selectedTicket?.events?.title || '' })}
              {"\n"}
              <Text style={{ fontSize: 12, color: Colors.dark.textSecondary }}>
                {t('tickets.sell_modal.original_price', { price: getOriginalTicketPrice(selectedTicket).toFixed(2) })}
                {"\n"}
                {t('tickets.sell_modal.min_price', { price: getOriginalTicketPrice(selectedTicket).toFixed(2) })}
                {"\n"}
                {t('tickets.sell_modal.max_price', { price: (getOriginalTicketPrice(selectedTicket) * 1.2).toFixed(2) })}
              </Text>
            </Text>

            <View style={styles.inputContainer}>
              <ThemedInput
                label={t('tickets.sell_modal.price_label')}
                value={resalePrice}
                onChangeText={setResalePrice}
                onBlur={() => setResaleTouched(true)}
                error={((resaleSubmitAttempted || resaleTouched) && (resalePriceError() || undefined)) || undefined}
                keyboardType="numeric"
                placeholder="0.00"
              />
            </View>

            <ThemedButton 
              title={selling ? t('tickets.sell_modal.processing') : t('tickets.sell_modal.confirm')}
              onPress={confirmSell}
              disabled={selling || !!resalePriceError()}
              variant="primary"
              style={{ marginTop: 20 }}
            />
          </GlassView>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.dark.background,
  },
  header: {
    paddingBottom: 20,
    paddingHorizontal: 20,
  },
  headerTitle: {
    fontSize: 32,
    fontWeight: 'bold',
    color: Colors.dark.text,
    marginBottom: 4,
  },
  headerSubtitle: {
    fontSize: 16,
    color: Colors.dark.textSecondary,
  },
  listContent: {
    paddingHorizontal: 14,
    paddingTop: 0,
    paddingBottom: 120,
    flexGrow: 1,
  },
  listContentEmpty: {
    padding: 20,
    paddingTop: 10,
    paddingBottom: 120,
    flexGrow: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: Colors.dark.textSecondary,
    marginTop: 12,
    fontSize: 16,
  },

  // ── TICKET CARD ───────────────────────────────────────────
  ticketContainer: {
    marginBottom: 24,
    width: '100%',
  },
  tcCard: {
    borderRadius: 22,
    overflow: 'hidden',
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.75,
    shadowRadius: 28,
    elevation: 16,
    backgroundColor: '#07070F',
  },

  // Poster
  tcPoster: {
    height: 310,
    overflow: 'hidden',
    backgroundColor: '#07070F',
  },
  tcAccentBar: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 3,
    zIndex: 10,
  },
  tcBadge: {
    position: 'absolute',
    top: 14,
    left: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 11,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    zIndex: 10,
  },
  tcBadgeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  tcBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  tcStamp: {
    position: 'absolute',
    top: 14,
    right: 14,
    borderWidth: 1.5,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 5,
    backgroundColor: 'rgba(0,0,0,0.60)',
    transform: [{ rotate: '-6deg' }],
    zIndex: 10,
  },
  tcStampResale: { borderColor: '#fbbf24' },
  tcStampUsed:   { borderColor: '#ef4444' },
  tcStampText: {
    fontWeight: '800',
    fontSize: 9,
    textTransform: 'uppercase',
    letterSpacing: 1.8,
  },
  tcPosterInfo: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    paddingBottom: 16,
    zIndex: 5,
  },
  tcEventName: {
    fontSize: 22,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.4,
    lineHeight: 27,
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 6,
  },
  tcMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 6,
  },
  tcMetaText: {
    fontSize: 12,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.78)',
    textShadowColor: 'rgba(0,0,0,0.7)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  tcMetaDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    opacity: 0.80,
  },

  // Perforated tear line
  tcTearRow: {
    height: 26,
    flexDirection: 'row',
    alignItems: 'center',
    overflow: 'visible',
  },
  tcNotch: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    position: 'absolute',
    top: -1,
    zIndex: 2,
  },
  tcNotchL: { left: -14 },
  tcNotchR: { right: -14 },
  // keep old names as aliases to not break anything
  tcTearCircle:      { width: 28, height: 28, borderRadius: 14, borderWidth: 1, position: 'absolute', top: -1, zIndex: 2 },
  tcTearCircleLeft:  { left: -14 },
  tcTearCircleRight: { right: -14 },
  tcTearDashes: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-evenly',
    alignItems: 'center',
    paddingHorizontal: 18,
  },
  tcTearDash: {
    width: 5,
    height: 1.5,
    borderRadius: 1,
  },

  // Lower body
  tcBody: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 18,
    gap: 14,
    alignItems: 'center',
  },
  tcFields: {
    flex: 1,
    gap: 12,
  },
  tcField: {},
  tcFieldLabel: {
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    marginBottom: 3,
  },
  tcFieldValue: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: -0.2,
  },
  tcFieldMono: {
    fontSize: 11,
    fontWeight: '600',
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
    letterSpacing: 0.5,
  },
  tcVertDivider: {
    width: 1,
    height: 120,
    borderRadius: 1,
  },
  tcQrWrap: {
    alignItems: 'center',
    gap: 8,
  },
  tcQrBox: {
    width: 116,
    height: 116,
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    padding: 8,
  },
  tcQrOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255,255,255,0.90)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tcQrOverlayText: {
    color: '#ef4444',
    fontWeight: '900',
    fontSize: 14,
    letterSpacing: 2,
    transform: [{ rotate: '-45deg' }],
    borderWidth: 2,
    borderColor: '#ef4444',
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 3,
  },
  tcScanHint: {
    fontSize: 9,
    fontWeight: '600',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },

  // Actions
  tcActions: {
    flexDirection: 'row',
    paddingHorizontal: 8,
    paddingVertical: 9,
    gap: 6,
    borderTopWidth: 1,
  },
  tcActionBtn: {
    flex: 1,
    height: 38,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 4,
    minWidth: 0,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  tcActionBtnDim: {
    opacity: 0.38,
  },
  tcActionBtnTxt: {
    fontSize: 10,
    fontWeight: '600',
    color: '#6b7280',
    letterSpacing: 0,
    flexShrink: 1,
  },

  // ── Legacy placeholders (kept to avoid ref errors) ────────
  eclipseActionBtnDisabled: {
    opacity: 0.4,
  },
  eclipseActionBtnText: {
    color: '#9ca3af',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    flexShrink: 1,
  },

  // Modal and Auth Styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    padding: 20,
  },
  modalContent: {
    padding: 24,
    borderRadius: 20,
    backgroundColor: 'rgba(15, 23, 42, 0.96)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
    elevation: 14,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: 'white',
  },
  modalText: {
    color: Colors.dark.textSecondary,
    marginBottom: 20,
    lineHeight: 20,
  },
  inputContainer: {
    marginBottom: 10,
  },
  inputLabel: {
    color: Colors.dark.text,
    marginBottom: 8,
    fontWeight: '600',
  },
  priceInput: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 12,
    padding: 16,
    color: 'white',
    fontSize: 24,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  emptyScreen: { flex: 1, justifyContent: 'center', paddingHorizontal: 24, paddingTop: 32, paddingBottom: 60 },
  emptyHeroWrap: { width: '100%' },
  emptyCardBorder: { borderRadius: 28, padding: 1.5 },
  emptyHeroCard: { borderRadius: 26, overflow: 'hidden', alignItems: 'center', paddingTop: 28, paddingBottom: 32, paddingHorizontal: 24 },
  emptyOrb: { position: 'absolute', borderRadius: 999 },
  emptyOrbA: { width: 200, height: 200, top: -80, left: -70, backgroundColor: 'rgba(124,58,237,0.28)' },
  emptyOrbB: { width: 240, height: 240, bottom: -120, right: -100, backgroundColor: 'rgba(10,132,255,0.18)' },
  emptyEyebrow: { fontSize: 11, fontWeight: '700', color: 'rgba(255,255,255,0.40)', letterSpacing: 3, textTransform: 'uppercase', marginBottom: 20 },
  emptyIconFloat: { marginBottom: 4 },
  emptyIconRing: { width: 80, height: 80, borderRadius: 40, alignItems: 'center', justifyContent: 'center' },
  emptyIconInner: { width: 64, height: 64, borderRadius: 32, backgroundColor: 'rgba(0,0,0,0.40)', alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { fontSize: 22, fontWeight: '900', color: '#FFFFFF', marginTop: 20, textAlign: 'center', letterSpacing: -0.5 },
  emptySubtitle: { fontSize: 14, color: 'rgba(255,255,255,0.60)', marginTop: 10, textAlign: 'center', lineHeight: 21, maxWidth: 300 },
  browseButton: {
    width: '100%',
  },
  emptyCtaOuter: { marginTop: 28, borderRadius: 16, overflow: 'hidden', alignSelf: 'center', minWidth: 200 },
  emptyCtaInner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 14, paddingHorizontal: 24, gap: 6 },
  emptyCtaText: { color: 'white', fontSize: 15, fontWeight: '800', letterSpacing: -0.2 },
  emptyCtaSecondary: { marginTop: 14, alignSelf: 'center', padding: 8 },
  emptyCtaSecondaryText: { color: 'rgba(255,255,255,0.50)', fontSize: 14, fontWeight: '600', textDecorationLine: 'underline' },
  authPrompt: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  authCard: {
    padding: 20,
    alignItems: 'center',
    borderRadius: 24,
    width: '100%',
    maxWidth: 500,
    alignSelf: 'center',
  },
  iconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(124, 58, 237, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  authPromptTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: 'white',
    marginBottom: 12,
  },
  authPromptText: {
    fontSize: 16,
    color: Colors.dark.textSecondary,
    textAlign: 'center',
    marginBottom: 32,
    lineHeight: 24,
  },
  authButton: {
    marginBottom: 12,
    width: '100%',
  },
});
