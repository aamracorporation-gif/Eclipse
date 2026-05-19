import { View, Text, StyleSheet, FlatList, Image, TouchableOpacity, RefreshControl, Platform, Modal, KeyboardAvoidingView, Animated, Easing } from 'react-native';
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
import { useResponsive } from '@/lib/responsive';
import { invokeEdgeFunction } from '@/lib/edgeFunctions';
import { useTranslation } from 'react-i18next';
import { useI18n } from '@/lib/I18nContext';
import { useAppDialog } from '@/components/ui/AppDialog';

type ExtendedTicket = Ticket & { 
  status?: string;
  wallet_added?: boolean;
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
  const vipGlow = useRef(new Animated.Value(0)).current;
  const vipShimmer = useRef(new Animated.Value(0)).current;
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
    if (!Number.isFinite(price)) return 'Introduce un número válido.';
    if (price < 1) return 'Precio mínimo 1,00 €.';

    const rawOriginal = selectedTicket ? (typeof selectedTicket.total_price === 'string' ? Number(selectedTicket.total_price) : (selectedTicket as any).total_price) : 0;
    const originalPrice = typeof rawOriginal === 'number' && Number.isFinite(rawOriginal) ? rawOriginal : 0;
    const minResalePrice = Math.max(originalPrice, 1);
    const maxResalePrice = originalPrice * 1.2;

    if (Number.isFinite(minResalePrice) && price < minResalePrice) {
      return `Precio mínimo: ${(minResalePrice || 0).toFixed(2)} €`;
    }
    if (Number.isFinite(maxResalePrice) && price > maxResalePrice) {
      return `Precio máximo: ${(maxResalePrice || 0).toFixed(2)} €`;
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
    const glowAnim = Animated.loop(
      Animated.sequence([
        Animated.timing(vipGlow, { toValue: 1, duration: 2200, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(vipGlow, { toValue: 0, duration: 2200, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ])
    );

    const shimmerAnim = Animated.loop(
      Animated.sequence([
        Animated.timing(vipShimmer, { toValue: 1, duration: 1600, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(vipShimmer, { toValue: 0, duration: 1600, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ])
    );

    glowAnim.start();
    shimmerAnim.start();

    return () => {
      glowAnim.stop();
      shimmerAnim.stop();
    };
  }, [vipGlow, vipShimmer]);

  const refreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchTickets = useCallback(async () => {
    if (!user) return;

    try {
      // Hard-clean expired tickets/resales (event ended >= 5h ago) before loading UI.
      await supabase.rpc('purge_expired_tickets_and_resales');

      // 1. Fetch tickets without the nested relation to avoid PGRST200 error
      // Using range 0-99 to fetch up to 100 tickets initially, can be paginated later if needed
      const { data: ticketsData, error: ticketsError } = await supabase
        .from('tickets')
        .select(`
          *,
          events (
            *,
            venues (*),
            profiles:creator_id (full_name, club_name)
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

      // Filter out tickets for events that ended more than 24 hours ago
      const now = new Date();
      const cutoffTime = now.getTime() - (24 * 60 * 60 * 1000); // 24 hours ago

      processedTickets = processedTickets.filter((t: any) => {
        if (!t.events || !t.events.event_date) return true; // Keep if no date (fallback)
        const eventDate = new Date(t.events.event_date);
        return eventDate.getTime() > cutoffTime;
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
    
    setAddingToWallet(ticket.id);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    try {
      if (Platform.OS === 'ios') {
        console.log('[WALLET] Generating Apple Wallet pass via Edge Function:', ticket.id);
        
        // 1. Invoke the Edge Function (Official Client - Auto Injects JWT)
        const { data, error } = await invokeEdgeFunction<{ base64: string }>('apple-wallet-generator', { ticket_id: ticket.id });
        if (error) throw new Error(String(error?.message || error));
        if (!data?.base64) throw new Error('No pass data received from server');

        const fileUri = FileSystem.documentDirectory + `ticket-${ticket.id}.pkpass`;
        
        // 2. Save the Base64 as a physical file
        await FileSystem.writeAsStringAsync(fileUri, data.base64, {
          encoding: FileSystem.EncodingType.Base64,
        });
        
        // 3. Open native Apple Wallet dialog
        await Sharing.shareAsync(fileUri);
      } else {
        // Android Google Wallet handling
        const { data, error } = await invokeEdgeFunction<{ url?: string }>('generate-wallet-pass', { ticket_id: ticket.id, platform: 'android' });
        if (error) throw new Error(String(error?.message || error));
        if (data?.url) await Linking.openURL(data.url);
      }
          
      // Mark as added in DB
      await supabase
        .from('tickets')
        .update({ wallet_added: true })
        .eq('id', ticket.id);
            
      setTickets(prev => prev.map(t => t.id === ticket.id ? { ...t, wallet_added: true } : t));
    } catch (err: any) {
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
      showDialog({ title: 'Precio inválido', message: err });
      return;
    }

    const originalPrice = getOriginalTicketPrice(selectedTicket);
    const minResalePrice = Math.max(originalPrice, 1);
    const maxResalePrice = originalPrice * 1.2;

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
    const isUsed = item.scanned_at || item.validation_status === 'used';
    const eventDate = item.events?.event_date ? new Date(item.events.event_date) : null;
    const isVip = (item as any)?.ticket_type_id == null;
    const eventId = item.events?.id;
    
    // Ticket Data
    const day = eventDate ? eventDate.getDate() : '??';
    const month = eventDate ? eventDate.toLocaleString(localeTag, { month: 'short' }).toUpperCase() : '???';
    const time = eventDate ? eventDate.toLocaleTimeString(localeTag, { hour: '2-digit', minute: '2-digit' }) : '??:??';
    const year = eventDate ? eventDate.getFullYear() : '2024';
    
    const ticketRef = `#${item.id.substring(0, 8).toUpperCase()}`;
    const passengerName = item.buyer_name || user?.user_metadata?.full_name || 'Invitado';

    return (
      <View style={[styles.ticketContainer, { maxWidth: maxContentWidth }]}>
        {/* Physical Ticket Wrapper with Shadow */}
        <TouchableOpacity
          activeOpacity={0.92}
          disabled={!eventId}
          onPress={() => {
            if (!eventId) return;
            router.push(`/(tabs)/event/${eventId}`);
          }}
          style={[styles.ticketShadow, isVip && styles.ticketShadowVip]}
        >
            <View style={[styles.ticketWrapper, isVip && styles.ticketWrapperVip]}>
                
                {/* 1. Main Ticket Body (Top) */}
                <View style={[styles.ticketMain, isVip && styles.ticketMainVip]}>
                    {isVip && (
                      <LinearGradient
                        colors={['rgba(212,175,55,0.10)', 'rgba(124,58,237,0.10)', 'rgba(0,0,0,0.0)']}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                        style={StyleSheet.absoluteFill}
                      />
                    )}
                    {isVip && (
                      <Animated.View
                        pointerEvents="none"
                        style={[
                          styles.vipTicketGlow,
                          {
                            opacity: vipGlow.interpolate({ inputRange: [0, 1], outputRange: [0.18, 0.55] }),
                            transform: [{ scale: vipGlow.interpolate({ inputRange: [0, 1], outputRange: [1, 1.05] }) }],
                          },
                        ]}
                      >
                        <LinearGradient
                          colors={['rgba(212,175,55,0.20)', 'rgba(255,255,255,0.08)', 'rgba(6,182,212,0.10)']}
                          start={{ x: 0, y: 0 }}
                          end={{ x: 1, y: 1 }}
                          style={StyleSheet.absoluteFill}
                        />
                      </Animated.View>
                    )}
                    {isVip && (
                      <Animated.View
                        pointerEvents="none"
                        style={[
                          styles.vipTicketShimmer,
                          {
                            opacity: vipShimmer.interpolate({ inputRange: [0, 1], outputRange: [0.10, 0.38] }),
                            transform: [
                              { translateX: vipShimmer.interpolate({ inputRange: [0, 1], outputRange: [-160, 280] }) },
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
                    )}
                    {/* Header Image */}
                    <View style={styles.ticketHeaderImage}>
                        {item.events?.poster_url ? (
                            <Image 
                                source={{ uri: item.events.poster_url }} 
                                style={StyleSheet.absoluteFill} 
                                resizeMode="cover"
                            />
                        ) : (
                            <View style={[StyleSheet.absoluteFill, { backgroundColor: '#333' }]} />
                        )}
                        {isVip && (
                          <LinearGradient
                            colors={['rgba(212,175,55,0.35)', 'rgba(0,0,0,0)', 'rgba(255,255,255,0.08)']}
                            style={StyleSheet.absoluteFill}
                          />
                        )}
                        <LinearGradient
                            colors={['transparent', 'rgba(0,0,0,0.8)']}
                            style={StyleSheet.absoluteFill}
                        />
                        
                        {/* Status Stamp */}
                        {(isResale || isUsed) && (
                            <View style={[styles.resaleStamp, isUsed && styles.usedStamp]}>
                                <Text style={[styles.resaleStampText, isUsed && styles.usedStampText]}>
                                    {isUsed ? 'USADO' : 'EN VENTA'}
                                </Text>
                            </View>
                        )}

                        {isVip && (
                          <View style={styles.vipHeaderBadgeWrap}>
                            <LinearGradient
                              colors={['rgba(212,175,55,0.95)', 'rgba(245,158,11,0.85)']}
                              start={{ x: 0, y: 0 }}
                              end={{ x: 1, y: 1 }}
                              style={styles.vipHeaderBadge}
                            >
                              <Sparkles size={14} color="#0b0b10" />
                              <Text style={styles.vipHeaderBadgeText}>VIP · LUXURY ACCESS</Text>
                            </LinearGradient>
                          </View>
                        )}

                        <View style={styles.headerContent}>
                            <Text style={[styles.ticketBrand, isVip && styles.ticketBrandVip]}>{isVip ? 'VIP PASS' : 'OFFICIAL TICKET'}</Text>
                            <Text style={styles.ticketTitle} numberOfLines={2}>
                                {item.events?.title?.toUpperCase()}
                            </Text>
                        </View>
                    </View>

                    {/* Info Grid */}
                    <View style={styles.ticketInfoBody}>
                        <View style={styles.infoRow}>
                            <View style={styles.infoCol}>
                                <Text style={styles.infoLabel}>{t('tickets.card.date')}</Text>
                                <Text style={styles.infoValue}>{day} {month} {year}</Text>
                            </View>
                            <View style={styles.infoColRight}>
                                <Text style={styles.infoLabel}>{t('tickets.card.time')}</Text>
                                <Text style={styles.infoValue}>{time}</Text>
                            </View>
                        </View>

                        <View style={styles.infoRow}>
                            <View style={styles.infoCol}>
                                <Text style={styles.infoLabel}>{t('tickets.card.location')}</Text>
                                <Text style={styles.infoValue} numberOfLines={1}>
                                    {item.events?.venues?.name || t('tickets_pdf.location_tbd')}
                                </Text>
                            </View>
                        </View>

                        <View style={styles.infoRow}>
                            <View style={styles.infoCol}>
                                <Text style={styles.infoLabel}>{t('tickets.card.holder')}</Text>
                                <Text style={styles.infoValue} numberOfLines={1}>{passengerName}</Text>
                            </View>
                            <View style={styles.infoColRight}>
                                <Text style={styles.infoLabel}>{isVip ? t('tickets.card.access') : t('tickets.card.seat')}</Text>
                                <Text style={[styles.infoValue, isVip && styles.infoValueVip]}>
                                  {isVip ? `VIP • ${(item as any).quantity}P` : t('tickets.card.general')}
                                </Text>
                            </View>
                        </View>
                    </View>
                </View>

                {/* 2. Tear Line / Perforation */}
                <View style={[styles.perforationContainer, isVip && styles.perforationContainerVip]}>
                    <View style={styles.notchLeft} />
                    <View style={[styles.dottedLine, isVip && styles.dottedLineVip]} />
                    <View style={styles.notchRight} />
                </View>

                {/* 3. Stub (Bottom) */}
                <View style={[styles.ticketStub, isVip && styles.ticketStubVip]}>
                    {isVip && (
                      <LinearGradient
                        colors={['rgba(212,175,55,0.08)', 'rgba(124,58,237,0.08)', 'rgba(6,182,212,0.05)']}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                        style={StyleSheet.absoluteFill}
                      />
                    )}
                    <View style={styles.stubContent}>
                        <View style={[styles.qrBox, isVip && styles.qrBoxVip]}>
                             {!isResale ? (
                               <QRCode 
                                  value={item.qr_token || item.qr_code || item.id} 
                                  size={120} 
                                  color="black" 
                                  backgroundColor="white" 
                              />
                             ) : (
                               <View style={styles.qrPlaceholder}>
                                 <Text style={styles.qrPlaceholderText}>{t('tickets.qr_disabled_resale')}</Text>
                               </View>
                             )}
                            {isUsed && (
                                <View style={styles.qrOverlay}>
                                    <Text style={styles.qrOverlayText}>{t('tickets.card.used_overlay')}</Text>
                                </View>
                            )}
                        </View>
                        
                        <View style={styles.stubInfo}>
                            <Text style={styles.stubLabel}>{t('tickets.card.scan_at_entry')}</Text>
                            <Text style={styles.stubId}>REF: {ticketRef}</Text>
                            <Text style={styles.stubSmallText}>{t('tickets.card.unique_code_hint')}</Text>
                        </View>
                    </View>
                    
                    {/* New Dedicated Action Row */}
                    <View style={styles.actionRow}>
                        <TouchableOpacity 
                            style={[styles.actionButton, { flex: 1 }, isResale && styles.actionButtonDisabled]} 
                            onPress={() => handleDownloadPDF(item)}
                            disabled={isResale}
                        >
                            <Download size={14} color="#9ca3af" />
                            <Text style={styles.actionButtonText}>{t('tickets.download')}</Text>
                        </TouchableOpacity>

                        {!isUsed && !isResale && (
                        <TouchableOpacity 
                            style={[styles.actionButton, item.wallet_added && styles.actionButtonSuccess, { flex: 1 }]} 
                            onPress={() => !item.wallet_added && handleAddToWallet(item)}
                            disabled={!!item.wallet_added || addingToWallet === item.id}
                        >
                            <CreditCard size={14} color={item.wallet_added ? Colors.dark.success : "#9ca3af"} />
                            <Text
                              style={[
                                styles.actionButtonText,
                                { textTransform: 'none', letterSpacing: 0 },
                                item.wallet_added && { color: Colors.dark.success },
                              ]}
                              numberOfLines={1}
                              ellipsizeMode="tail"
                            >
                                {item.wallet_added ? t('common.ok') : (addingToWallet === item.id ? '...' : t('tickets.add_to_wallet'))}
                            </Text>
                        </TouchableOpacity>
                        )}

                        {!isResale ? (
                        <TouchableOpacity 
                            style={[styles.actionButton, styles.actionButtonPrimary, isUsed && styles.actionButtonDisabled, { flex: 1 }]} 
                            onPress={() => !isUsed && void handleSellPress(item)}
                            disabled={!!isUsed}
                        >
                            <DollarSign size={14} color={isUsed ? '#9ca3af' : "#fbbf24"} />
                            <Text style={[styles.actionButtonText, styles.actionButtonTextPrimary, isUsed && styles.actionButtonTextDisabled]}>
                                {isUsed ? t('tickets.used') : t('tickets.sell')}
                            </Text>
                        </TouchableOpacity>
                        ) : (
                        <TouchableOpacity style={[styles.actionButton, styles.actionButtonDanger, { flex: 1 }]} onPress={() => handleCancelResale(item)}>
                            <X size={14} color="#ef4444" />
                            <Text style={[styles.actionButtonText, styles.actionButtonTextDanger]}>{t('common.cancel')}</Text>
                        </TouchableOpacity>
                        )}
                    </View>

                    {/* Barcode Strip Simulation */}
                    <View style={styles.barcodeStrip}>
                        <Text style={styles.barcodeText}>||| || ||| | |||| ||| || |||||</Text>
                    </View>
                </View>

            </View>
        </TouchableOpacity>
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
        eyebrow={`ECLIPSE · ${String(t('tickets.my_tickets')).toUpperCase()}`}
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
              : [styles.listContent, { paddingHorizontal: horizontalPadding, alignItems: 'center' }]
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
              <Animated.View style={[styles.emptyHeroWrap, { opacity: emptyEnter, transform: [{ scale: emptyEnter.interpolate({ inputRange: [0, 1], outputRange: [0.98, 1] }) }] }]}>
                <GlassView intensity={28} style={styles.emptyHeroCard}>
                  <LinearGradient
                    colors={['rgba(124,58,237,0.22)', 'rgba(6,182,212,0.10)', 'rgba(255,255,255,0.02)', 'transparent']}
                    locations={[0, 0.35, 0.7, 1]}
                    style={StyleSheet.absoluteFill}
                  />
                  <Animated.View
                    pointerEvents="none"
                    style={[
                      styles.emptyOrb,
                      styles.emptyOrbA,
                      {
                        opacity: emptyPulse.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0.95] }),
                        transform: [
                          { translateX: emptyDrift.interpolate({ inputRange: [0, 1], outputRange: [-14, 14] }) },
                          { translateY: emptyDrift.interpolate({ inputRange: [0, 1], outputRange: [10, -10] }) },
                          { scale: emptyPulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.08] }) },
                        ],
                      },
                    ]}
                  />
                  <Animated.View
                    pointerEvents="none"
                    style={[
                      styles.emptyOrb,
                      styles.emptyOrbB,
                      {
                        opacity: emptyPulse.interpolate({ inputRange: [0, 1], outputRange: [0.22, 0.55] }),
                        transform: [
                          { translateX: emptyDrift.interpolate({ inputRange: [0, 1], outputRange: [10, -10] }) },
                          { translateY: emptyDrift.interpolate({ inputRange: [0, 1], outputRange: [-10, 10] }) },
                          { scale: emptyPulse.interpolate({ inputRange: [0, 1], outputRange: [1.04, 0.98] }) },
                        ],
                      },
                    ]}
                  />
                  <View pointerEvents="none" style={styles.emptyHairlineTop} />

                  <View style={styles.emptyHeader}>
                    <Text style={styles.emptyEyebrow}>ECLIPSE · ENTRADAS</Text>
                  </View>

                  <Animated.View style={[styles.emptyIconFloat, { transform: [{ translateY: emptyFloat.interpolate({ inputRange: [0, 1], outputRange: [0, -7] }) }] }]}>
                    <Animated.View style={{ transform: [{ scale: emptyPulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.04] }) }] }}>
                      <LinearGradient colors={[Colors.dark.primary, Colors.dark.secondary, 'rgba(255,255,255,0.10)']} style={styles.emptyIconRing}>
                        <View style={styles.emptyIconInner}>
                          <TicketIcon size={26} color="white" />
                        </View>
                      </LinearGradient>
                    </Animated.View>
                  </Animated.View>

                  <Text style={styles.emptyTitle}>{t('tickets.no_tickets')}</Text>
                  <Text style={styles.emptySubtitle}>
                    {t('tickets.empty_subtitle')}
                  </Text>
                  <View style={styles.emptyActions}>
                  <TouchableOpacity
                    activeOpacity={0.88}
                    onPress={() => {
                      Haptics.selectionAsync();
                      router.push('/(tabs)');
                    }}
                    style={styles.emptyCtaOuter}
                  >
                    <LinearGradient
                      colors={['rgba(124,58,237,0.75)', 'rgba(6,182,212,0.55)']}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={styles.emptyCtaBorder}
                    >
                      <View style={styles.emptyCtaInner}>
                        <LinearGradient
                          colors={['rgba(124,58,237,0.22)', 'rgba(6,182,212,0.10)', 'transparent']}
                          locations={[0, 0.6, 1]}
                          start={{ x: 0, y: 0 }}
                          end={{ x: 1, y: 1 }}
                          style={StyleSheet.absoluteFill}
                        />
                        <View style={styles.emptyCtaRow}>
                          <Text style={styles.emptyCtaText}>{t('tickets.buy_tickets')}</Text>
                          <ChevronRight size={18} color="rgba(255,255,255,0.85)" />
                        </View>
                      </View>
                    </LinearGradient>
                  </TouchableOpacity>
                  <View style={{ height: 10 }} />
                  <TouchableOpacity
                    activeOpacity={0.88}
                    onPress={() => {
                      Haptics.selectionAsync();
                      router.push('/(tabs)/resale');
                    }}
                    style={styles.emptyCtaOuter}
                  >
                    <LinearGradient
                      colors={['rgba(255,255,255,0.16)', 'rgba(255,255,255,0.06)']}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={styles.emptyCtaBorder}
                    >
                      <View style={[styles.emptyCtaInner, { backgroundColor: 'rgba(255,255,255,0.04)' }]}>
                        <View style={styles.emptyCtaRow}>
                          <Text style={styles.emptyCtaTextSecondary}>{t('tickets.empty.view_resale')}</Text>
                          <ChevronRight size={18} color="rgba(255,255,255,0.55)" />
                        </View>
                      </View>
                    </LinearGradient>
                  </TouchableOpacity>
                </View>
                </GlassView>
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
    padding: 20,
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
  
  // Physical Ticket Styles
  ticketContainer: {
    marginBottom: 32,
    paddingHorizontal: 4,
    width: '100%',
    alignSelf: 'center',
  },
  ticketShadow: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.5,
    shadowRadius: 16,
    elevation: 10,
  },
  ticketShadowVip: {
    shadowColor: '#d4af37',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.45,
    shadowRadius: 18,
    elevation: 12,
  },
  ticketWrapper: {
    backgroundColor: '#1c1c1e', // Dark Cardstock
    borderRadius: 16,
    overflow: 'hidden',
  },
  ticketWrapperVip: {
    backgroundColor: '#0b0b10',
    borderWidth: 1,
    borderColor: 'rgba(212,175,55,0.42)',
  },
  ticketMain: {
    backgroundColor: '#1c1c1e',
  },
  ticketMainVip: {
    backgroundColor: '#0b0b10',
  },
  vipTicketGlow: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1,
  },
  vipTicketShimmer: {
    position: 'absolute',
    top: -40,
    left: -220,
    width: 220,
    height: 340,
    zIndex: 2,
  },
  ticketHeaderImage: {
    height: 180,
    width: '100%',
    position: 'relative',
    justifyContent: 'space-between',
    padding: 20,
  },
  headerContent: {
    justifyContent: 'flex-end',
    flex: 1,
    zIndex: 2,
  },
  resaleStamp: {
    position: 'absolute',
    top: 20,
    right: 20,
    borderWidth: 2,
    borderColor: '#fbbf24', // Amber
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 4,
    transform: [{ rotate: '-10deg' }],
    backgroundColor: 'rgba(0,0,0,0.6)',
    zIndex: 10,
  },
  resaleStampText: {
    color: '#fbbf24',
    fontWeight: '900',
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 2,
  },
  vipHeaderBadgeWrap: {
    position: 'absolute',
    top: 18,
    left: 18,
    zIndex: 10,
  },
  vipHeaderBadge: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.35)',
  },
  vipHeaderBadgeText: {
    color: '#0b0b10',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.6,
  },
  ticketBrand: {
    color: '#fbbf24', // Gold/Amber tint for "Official" feel
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 3,
    marginBottom: 8,
    textTransform: 'uppercase',
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  ticketBrandVip: {
    color: '#d4af37',
    letterSpacing: 4,
  },
  ticketTitle: {
    color: 'white',
    fontSize: 28,
    fontWeight: '800',
    lineHeight: 30,
    textTransform: 'uppercase',
    letterSpacing: -0.5,
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
  },
  ticketInfoBody: {
    padding: 24,
    paddingTop: 20,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  infoCol: {
    flex: 2,
    alignItems: 'flex-start',
  },
  infoColRight: {
    flex: 1,
    alignItems: 'flex-end',
  },
  infoLabel: {
    color: '#6b7280', // Gray-500
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.5,
    marginBottom: 4,
    textTransform: 'uppercase',
  },
  infoValue: {
    color: '#e5e7eb', // Gray-200
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  infoValueVip: {
    color: '#fef3c7',
    fontWeight: '800',
  },
  
  // Tear Line
  perforationContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 30,
    backgroundColor: '#1c1c1e',
    zIndex: 10,
    marginHorizontal: -10, // Pull out to cut edges
  },
  perforationContainerVip: {
    backgroundColor: '#0b0b10',
  },
  notchLeft: {
    width: 20,
    height: 30,
    backgroundColor: '#000', // Screen background color
    borderTopRightRadius: 15,
    borderBottomRightRadius: 15,
  },
  dottedLine: {
    flex: 1,
    height: 1,
    borderWidth: 1,
    borderColor: '#4b5563', // Gray-600
    borderStyle: 'dashed',
    borderRadius: 1,
    marginHorizontal: 10,
  },
  dottedLineVip: {
    borderColor: 'rgba(212,175,55,0.50)',
  },
  notchRight: {
    width: 20,
    height: 30,
    backgroundColor: '#000', // Screen background color
    borderTopLeftRadius: 15,
    borderBottomLeftRadius: 15,
  },

  // Stub
  ticketStub: {
    backgroundColor: '#1c1c1e', // Keep unified look
    paddingBottom: 24,
    paddingHorizontal: 24,
    paddingTop: 10,
    alignItems: 'center',
  },
  ticketStubVip: {
    backgroundColor: '#0b0b10',
  },
  stubContent: {
    flexDirection: 'row',
    width: '100%',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  qrBox: {
    padding: 8,
    backgroundColor: 'white',
    borderRadius: 8,
  },
  qrBoxVip: {
    borderWidth: 2,
    borderColor: 'rgba(212,175,55,0.70)',
    shadowColor: '#d4af37',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.28,
    shadowRadius: 10,
    elevation: 8,
  },
  qrPlaceholder: {
    width: 120,
    height: 120,
    borderRadius: 6,
    backgroundColor: '#111827',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  qrPlaceholderText: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 10,
    fontWeight: '700',
    textAlign: 'center',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  stubInfo: {
    flex: 1,
    marginLeft: 20,
    alignItems: 'flex-start', // Left align text for better readability next to QR
    justifyContent: 'center',
    height: 120, // Match QR height approx
  },
  stubLabel: {
    color: '#9ca3af',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  stubId: {
    color: 'white',
    fontSize: 18,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    fontWeight: '700',
    letterSpacing: 2,
    marginBottom: 8,
  },
  stubSmallText: {
    color: '#4b5563', // Darker gray
    fontSize: 9,
    fontWeight: '500',
    lineHeight: 12,
    maxWidth: 160,
  },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    marginTop: 20,
    marginBottom: 8,
    gap: 10,
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 48,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  actionButtonText: {
    color: '#9ca3af',
    fontSize: 11,
    fontWeight: '800',
    marginLeft: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    lineHeight: 14,
    includeFontPadding: false,
    textAlignVertical: 'center',
    flexShrink: 1,
    textAlign: 'center',
  },
  actionButtonPrimary: {
    borderColor: '#fbbf24', // Amber border
    backgroundColor: 'rgba(251, 191, 36, 0.1)',
  },
  actionButtonTextPrimary: {
    color: '#fbbf24',
  },
  actionButtonDanger: {
    borderColor: '#ef4444', // Red border
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
  },
  actionButtonTextDanger: {
    color: '#ef4444',
  },
  actionButtonSuccess: {
    borderColor: Colors.dark.success,
    backgroundColor: 'rgba(16, 185, 129, 0.05)',
  },
  barcodeStrip: {
    width: '100%',
    alignItems: 'center',
    opacity: 0.3,
    marginTop: 8,
  },
  barcodeText: {
    color: '#9ca3af',
    fontSize: 20,
    letterSpacing: 4,
    transform: [{ scaleY: 2 }], // Stretch vertically to look like barcode
  },
  // Used Ticket Styles
  usedStamp: {
    backgroundColor: '#ef4444',
    transform: [{ rotate: '-15deg' }],
  },
  usedStampText: {
    color: 'white',
    fontWeight: '900',
    letterSpacing: 2,
  },
  qrOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 8,
  },
  qrOverlayText: {
    color: '#ef4444',
    fontWeight: '900',
    fontSize: 20,
    transform: [{ rotate: '-45deg' }],
    borderWidth: 2,
    borderColor: '#ef4444',
    padding: 4,
    borderRadius: 4,
  },
  actionButtonDisabled: {
    borderColor: '#374151',
    backgroundColor: 'rgba(55, 65, 81, 0.1)',
    opacity: 0.5,
  },
  actionButtonTextDisabled: {
    color: '#6b7280',
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
  emptyScreen: {
    paddingTop: 10,
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  emptyHeroWrap: {
    alignSelf: 'center',
    width: '100%',
    maxWidth: 560,
  },
  emptyHeroCard: {
    alignItems: 'center',
    width: '100%',
    maxWidth: 560,
    paddingVertical: 24,
    paddingHorizontal: 18,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(255,255,255,0.04)',
    alignSelf: 'center',
    overflow: 'hidden',
  },
  emptyHairlineTop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.10)',
  },
  emptyOrb: {
    position: 'absolute',
    borderRadius: 999,
  },
  emptyOrbA: {
    width: 220,
    height: 220,
    top: -110,
    left: -90,
    backgroundColor: 'rgba(124,58,237,0.18)',
  },
  emptyOrbB: {
    width: 260,
    height: 260,
    bottom: -140,
    right: -120,
    backgroundColor: 'rgba(10,132,255,0.14)',
  },
  emptyHeader: {
    width: '100%',
    alignItems: 'center',
  },
  emptyEyebrow: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 2.2,
    textTransform: 'uppercase',
  },
  emptyIconFloat: {
    marginTop: 18,
  },
  emptyIconRing: {
    width: 76,
    height: 76,
    borderRadius: 38,
    padding: 2,
  },
  emptyIconInner: {
    flex: 1,
    borderRadius: 36,
    backgroundColor: 'rgba(0,0,0,0.38)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: {
    fontSize: 22,
    fontWeight: '900',
    color: 'white',
    marginTop: 18,
    textAlign: 'center',
    letterSpacing: -0.4,
  },
  emptySubtitle: {
    fontSize: 14,
    color: Colors.dark.textSecondary,
    marginTop: 10,
    textAlign: 'center',
    maxWidth: 380,
    lineHeight: 20,
  },
  emptyActions: {
    width: '100%',
    marginTop: 18,
  },
  browseButton: {
    width: '100%',
  },
  emptyCtaOuter: {
    width: '100%',
    borderRadius: 18,
    shadowColor: '#000',
    shadowOpacity: 0.28,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 12 },
    elevation: 8,
  },
  emptyCtaBorder: {
    borderRadius: 18,
    padding: 1.5,
  },
  emptyCtaInner: {
    height: 52,
    borderRadius: 16.5,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  emptyCtaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
  },
  emptyCtaText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  emptyCtaTextSecondary: {
    color: 'rgba(255,255,255,0.72)',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
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
