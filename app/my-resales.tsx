import { View, Text, StyleSheet, FlatList, TouchableOpacity, Alert } from 'react-native';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/AuthContext';
import { LinearGradient } from 'expo-linear-gradient';
import { Colors } from '@/constants/Colors';
import { GlassView } from '@/components/ui/GlassView';
import { ThemedButton } from '@/components/ui/ThemedButton';
import { DiscoLoader } from '@/components/ui/DiscoLoader';
import { ArrowLeft, Tag, Calendar, MapPin, Trash2, CheckCircle, Clock, LogIn } from '@/lib/icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useResponsive } from '@/lib/responsive';
import { useTranslation } from 'react-i18next';
import { useI18n } from '@/lib/I18nContext';
import { AuthRequiredScreen } from '@/components/ui/AuthRequiredScreen';
import { getErrorMessage } from '@/lib/errorHelpers';

export default function MyResalesScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { horizontalPadding, maxContentWidth, scaleFont } = useResponsive();
  const { t } = useTranslation();
  const { language } = useI18n();
  const localeTag = language === 'en' ? 'en-US' : language === 'fr' ? 'fr-FR' : 'es-ES';
  const [listings, setListings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isCancelling, setIsCancelling] = useState(false);
  const refreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const userId = user?.id || null;

  const safeBack = () => {
    const canGoBack = (router as any)?.canGoBack?.();
    if (canGoBack) router.back();
    else router.replace('/(tabs)');
  };

  const fetchMyResales = useCallback(async () => {
    if (!userId) return;
    try {
      setLoading(true);
      await supabase.rpc('purge_expired_tickets_and_resales');
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
        .eq('seller_id', userId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setListings(data || []);
    } catch (error) {
      Alert.alert(t('common.error'), getErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [t, userId]);

  const scheduleRefresh = useCallback(() => {
    if (refreshTimeoutRef.current) clearTimeout(refreshTimeoutRef.current);
    refreshTimeoutRef.current = setTimeout(() => {
      fetchMyResales();
    }, 250);
  }, [fetchMyResales]);

  useFocusEffect(
    useCallback(() => {
      fetchMyResales();
      return () => {
        if (refreshTimeoutRef.current) {
          clearTimeout(refreshTimeoutRef.current);
          refreshTimeoutRef.current = null;
        }
      };
    }, [fetchMyResales])
  );

  useEffect(() => {
    if (!userId) return;

    const channel = supabase
      .channel(`my_resales_${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'resale_listings', filter: `seller_id=eq.${userId}` },
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
  }, [scheduleRefresh, user?.id, userId]);

  const cancelResale = async (_listingId: string, ticketId: string) => {
    Alert.alert(
      t('tickets.cancel_sale_title'),
      t('tickets.cancel_sale_body'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('tickets.cancel_sale_confirm'),
          onPress: async () => {
            try {
              setIsCancelling(true);
              
              if (!ticketId) throw new Error('Ticket inválido');

              const { error } = await supabase.rpc('cancel_resale_listing_secure', {
                p_ticket_id: ticketId,
              });

              if (error) throw error;
              
              Alert.alert('Éxito', 'La entrada ha sido retirada de la venta y devuelta a tus entradas.');
              fetchMyResales();
            } catch (error: any) {
              console.error('Cancel Resale Error:', error);
              Alert.alert('Error', 'No se pudo cancelar la venta: ' + error.message);
            } finally {
              setIsCancelling(false);
            }
          }
        }
      ]
    );
  };

  const renderItem = ({ item }: { item: any }) => {
    // Handle case where tickets join failed or returned null
    const ticket = item.tickets;
    const event = ticket?.events;
    const isSold = item.status === 'sold';
    const eventId = event?.id || ticket?.event_id;
    
    // Debug fallback if event is missing
    const shortId = item.ticket_id?.substring(0, 8) || '';
    const eventTitle = event?.title || t('my_resales.event_id', { id: shortId });
    const eventDate = event?.event_date ? new Date(event.event_date).toLocaleDateString(localeTag, { year: 'numeric', month: 'short', day: 'numeric' }) : t('my_resales.date_unavailable');
    const eventLoc = event?.location || t('home.unknown_location');

    return (
      <View style={[styles.rowWrap, { maxWidth: maxContentWidth }]}>
        <TouchableOpacity
          activeOpacity={0.92}
          disabled={!eventId}
          onPress={() => {
            if (!eventId) return;
            router.push(`/(tabs)/event/${eventId}`);
          }}
        >
          <GlassView intensity={20} style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={styles.statusContainer}>
            {isSold ? (
              <View style={[styles.badge, styles.badgeSold]}>
                <CheckCircle size={12} color="#10b981" />
                <Text style={styles.badgeTextSold}>{t('resale.status.sold')}</Text>
              </View>
            ) : (
              <View style={[styles.badge, styles.badgeActive]}>
                <Clock size={12} color="#f59e0b" />
                <Text style={styles.badgeTextActive}>{t('resale.status.on_sale')}</Text>
              </View>
            )}
            <Text style={styles.date}>
              {new Date(item.created_at).toLocaleDateString(localeTag, { year: 'numeric', month: 'short', day: 'numeric' })}
            </Text>
          </View>
          <Text style={styles.price}>{item.price}€</Text>
        </View>

        <View style={styles.divider} />

        <View style={styles.eventInfo}>
          <Text style={styles.eventTitle} numberOfLines={2}>
            {eventTitle}
          </Text>
          <View style={styles.row}>
            <Calendar size={14} color={Colors.dark.textSecondary} />
            <Text style={[styles.infoText, { flex: 1, flexShrink: 1 }]} numberOfLines={1}>
              {eventDate}
            </Text>
          </View>
          <View style={[styles.row, { minWidth: 0 }]}>
            <MapPin size={14} color={Colors.dark.textSecondary} />
            <Text style={[styles.infoText, { flex: 1, flexShrink: 1 }]} numberOfLines={2} ellipsizeMode="tail">
              {eventLoc}
            </Text>
          </View>
          
          {/* Debug Info for missing relations */}
          {!event && (
             <Text style={{color: 'red', fontSize: 10, marginTop: 4}}>
               Error: No se pudieron cargar detalles del evento. (Posible error de permisos)
             </Text>
          )}
        </View>

        {!isSold && (
          <ThemedButton
            title="Cancelar Venta"
            onPress={() => cancelResale(item.id, item.ticket_id)}
            variant="outline"
            style={styles.cancelButton}
            textStyle={styles.cancelButtonText}
            icon={<Trash2 size={16} color="#ef4444" />}
          />
        )}
        </GlassView>
        </TouchableOpacity>
      </View>
    );
  };

  if (!user) {
    return (
      <AuthRequiredScreen
        title={t('auth.login')}
        subtitle={t('profile.sign_in_prompt')}
        ctaLabel={t('auth.login')}
        Icon={LogIn}
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
            paddingTop: insets.top + 10,
            paddingHorizontal: horizontalPadding,
            maxWidth: maxContentWidth,
            width: '100%',
            alignSelf: 'center',
          },
        ]}
      >
        <TouchableOpacity onPress={safeBack} style={styles.backButton}>
          <ArrowLeft size={24} color="white" />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { fontSize: scaleFont(24) }]} numberOfLines={1}>
          {t('resale.my_sales_title')}
        </Text>
      </View>

      {isCancelling && (
        <View style={styles.loadingOverlay}>
          <GlassView intensity={40} style={styles.loadingCard}>
            <DiscoLoader size={74} />
            <Text style={styles.loadingText}>{t('common.loading')}</Text>
          </GlassView>
        </View>
      )}

      {loading ? (
        <View style={styles.center}>
          <DiscoLoader label={t('resale.my_sales_loading')} size={150} />
        </View>
      ) : listings.length === 0 ? (
        <View style={styles.emptyContainer}>
          <LinearGradient
            colors={[Colors.dark.primary, Colors.dark.secondary, 'rgba(255,255,255,0.10)']}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
            style={styles.emptyCardBorder}
          >
            <View style={styles.emptyCard}>
              <LinearGradient colors={['#1E1040', '#0F0A22', '#0A0618']} locations={[0, 0.5, 1]} style={StyleSheet.absoluteFill} />
              <View pointerEvents="none" style={[styles.emptyOrb, styles.emptyOrbA]} />
              <View pointerEvents="none" style={[styles.emptyOrb, styles.emptyOrbB]} />
              <Text style={styles.emptyEyebrow}>✦ ECLIPSE ✦</Text>
              <LinearGradient colors={[Colors.dark.primary, Colors.dark.secondary]} style={styles.emptyIconRing}>
                <View style={styles.emptyIconInner}>
                  <Tag size={28} color="white" />
                </View>
              </LinearGradient>
              <Text style={styles.emptyText}>{t('resale.my_sales_empty')}</Text>
              <Text style={styles.emptySubtext}>{t('resale.my_sales_empty_subtitle', { defaultValue: 'Aquí aparecerán tus entradas en venta.' })}</Text>
              <TouchableOpacity
                activeOpacity={0.85}
                onPress={() => router.push('/(tabs)/tickets')}
                style={styles.emptyCtaOuter}
              >
                <LinearGradient
                  colors={[Colors.dark.primary, Colors.dark.secondary]}
                  start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                  style={styles.emptyCtaInner}
                >
                  <Text style={styles.emptyCtaText}>{t('resale.view_my_tickets')}</Text>
                </LinearGradient>
              </TouchableOpacity>
            </View>
          </LinearGradient>
        </View>
      ) : (
        <FlatList
          data={listings}
          renderItem={renderItem}
          keyExtractor={item => item.id}
          contentContainerStyle={[styles.list, { paddingHorizontal: horizontalPadding, alignItems: 'center' }]}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.dark.background,
  },
  rowWrap: {
    width: '100%',
    alignSelf: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: 20,
  },
  backButton: {
    marginRight: 16,
    padding: 8,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: 'white',
  },
  list: {
    padding: 20,
    paddingBottom: 40,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  emptyContainer: { flex: 1, justifyContent: 'center', paddingHorizontal: 24, paddingVertical: 40 },
  emptyCardBorder: { borderRadius: 28, padding: 1.5, width: '100%', maxWidth: 520, alignSelf: 'center' },
  emptyCard: { borderRadius: 26, overflow: 'hidden', alignItems: 'center', paddingTop: 28, paddingBottom: 32, paddingHorizontal: 24 },
  emptyOrb: { position: 'absolute', borderRadius: 999 },
  emptyOrbA: { width: 200, height: 200, top: -80, left: -70, backgroundColor: 'rgba(124,58,237,0.28)' },
  emptyOrbB: { width: 240, height: 240, bottom: -120, right: -100, backgroundColor: 'rgba(10,132,255,0.18)' },
  emptyEyebrow: { fontSize: 11, fontWeight: '700', color: 'rgba(255,255,255,0.40)', letterSpacing: 3, textTransform: 'uppercase', marginBottom: 20 },
  emptyIconRing: { width: 80, height: 80, borderRadius: 40, alignItems: 'center', justifyContent: 'center' },
  emptyIconInner: { width: 64, height: 64, borderRadius: 32, backgroundColor: 'rgba(0,0,0,0.40)', alignItems: 'center', justifyContent: 'center' },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
  },
  loadingCard: {
    padding: 20,
    borderRadius: 12,
    alignItems: 'center',
    gap: 10,
  },
  loadingText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },
  emptyText: { fontSize: 22, fontWeight: '900', color: '#FFFFFF', marginTop: 20, textAlign: 'center', letterSpacing: -0.5 },
  emptySubtext: { fontSize: 14, color: 'rgba(255,255,255,0.60)', marginTop: 10, textAlign: 'center', lineHeight: 21, maxWidth: 300 },
  emptyCtaOuter: { marginTop: 28, borderRadius: 16, overflow: 'hidden', alignSelf: 'center', minWidth: 200 },
  emptyCtaInner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 14, paddingHorizontal: 24, gap: 6 },
  emptyCtaText: { color: 'white', fontSize: 15, fontWeight: '800', letterSpacing: -0.2 },
  card: {
    marginBottom: 16,
    padding: 16,
    borderRadius: 16,
    width: '100%',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  statusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 4,
  },
  badgeActive: {
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
  },
  badgeSold: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
  },
  badgeTextActive: {
    color: '#f59e0b',
    fontSize: 12,
    fontWeight: '600',
  },
  badgeTextSold: {
    color: '#10b981',
    fontSize: 12,
    fontWeight: '600',
  },
  date: {
    color: Colors.dark.textSecondary,
    fontSize: 12,
  },
  price: {
    fontSize: 18,
    fontWeight: 'bold',
    color: 'white',
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.1)',
    marginBottom: 12,
  },
  eventInfo: {
    gap: 8,
  },
  eventTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: 'white',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  infoText: {
    color: Colors.dark.textSecondary,
    fontSize: 14,
  },
  cancelButton: {
    marginTop: 16,
    borderColor: '#ef4444',
  },
  cancelButtonText: {
    color: '#ef4444',
  },
});
