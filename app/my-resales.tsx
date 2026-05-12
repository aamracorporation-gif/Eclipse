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
          <GlassView intensity={15} style={styles.emptyCard}>
            <View style={styles.emptyIcon}>
              <Tag size={28} color={Colors.dark.textSecondary} />
            </View>
            <Text style={styles.emptyText}>{t('resale.my_sales_empty')}</Text>
            <ThemedButton
              title={t('resale.view_my_tickets')}
              onPress={() => router.push('/(tabs)/tickets')}
              style={styles.emptyButton}
            />
          </GlassView>
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
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  emptyCard: {
    width: '100%',
    maxWidth: 520,
    paddingVertical: 22,
    paddingHorizontal: 18,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(255,255,255,0.04)',
    alignItems: 'center',
  },
  emptyIcon: {
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
  },
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
  emptyText: {
    color: Colors.dark.textSecondary,
    fontSize: 16,
    marginTop: 16,
    marginBottom: 18,
    fontWeight: '600',
    textAlign: 'center',
  },
  emptyButton: {
    width: 200,
  },
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
