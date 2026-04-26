import { View, Text, StyleSheet, FlatList, Image, TouchableOpacity, Alert, RefreshControl, ScrollView, Platform, StatusBar, Animated, Easing } from 'react-native';
import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { Colors } from '@/constants/Colors';
import { LinearGradient } from 'expo-linear-gradient';
import { GlassView } from '@/components/ui/GlassView';
import { ThemedButton } from '@/components/ui/ThemedButton';
import { ThemedInput } from '@/components/ui/ThemedInput';
import { DiscoLoader } from '@/components/ui/DiscoLoader';
import { useCredit } from '@/lib/WalletContext';
import { Calendar, MapPin, Tag, Filter, X, Search, User, Clock, ChevronDown, SlidersHorizontal, ChevronRight, Users, Sparkles } from 'lucide-react-native';
import { useAuth } from '@/lib/AuthContext';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
// import Animated, { FadeInDown, FadeInUp } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { usePaymentSheetHandler } from '@/components/PaymentSheetHandler';
import { PurchaseConfirmation } from '@/components/PurchaseConfirmation';
import { useTranslation } from 'react-i18next';
import { useI18n } from '@/lib/I18nContext';

type VipReservado = {
  id: string;
  name: string;
  base_price: number;
  capacity_people: number;
  included_bottles: number;
  extra_bottle_price: number | null;
};

type ResaleListing = {
  id: string;
  price: number;
  seller_id: string;
  seller?: {
    full_name: string;
    email: string;
  };
  ticket: {
    id: string;
    type: string;
    ticket_type_id?: string | null;
    quantity?: number | null;
    total_price?: number | null;
    vip?: VipReservado | null;
    event: {
      id: string;
      title: string;
      date: string;
      time: string;
      location: string;
      imageUrl: string;
      reservados_vip?: VipReservado[] | null;
    }
  }
};

export default function ResaleScreen() {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const { language } = useI18n();
  const localeTag = language === 'en' ? 'en-US' : language === 'fr' ? 'fr-FR' : 'es-ES';
  const [allListings, setAllListings] = useState<ResaleListing[]>([]);
  const [listings, setListings] = useState<ResaleListing[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [purchaseSuccess, setPurchaseSuccess] = useState<{ title: string; message: string } | null>(null);
  const refreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const emptyFloat = useRef(new Animated.Value(0)).current;
  const emptyPulse = useRef(new Animated.Value(0)).current;
  const emptyEnter = useRef(new Animated.Value(0)).current;
  const emptyDrift = useRef(new Animated.Value(0)).current;
  
  // Filter State
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState({
    event: '',
    minPrice: '',
    maxPrice: '',
    date: '',
    type: ''
  });
  const hasActiveFilters = !!(filters.event || filters.minPrice || filters.maxPrice || filters.date || filters.type);

  const { creditBalance, buyResaleTicketWithCredit } = useCredit();
  const { user } = useAuth();
  const router = useRouter();
  const { present } = usePaymentSheetHandler();

  useEffect(() => {
    const enabledEmpty = !loading && listings.length === 0;
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
  }, [emptyDrift, emptyEnter, emptyFloat, emptyPulse, listings.length, loading]);

  useEffect(() => {
    applyFilters();
  }, [filters, allListings]);

  const applyFilters = () => {
    let result = [...allListings];

    if (filters.event) {
      const term = filters.event.toLowerCase();
      result = result.filter(item => 
        item.ticket.event.title.toLowerCase().includes(term) || 
        item.ticket.event.location.toLowerCase().includes(term)
      );
    }

    if (filters.date) {
      result = result.filter(item => 
        item.ticket.event.date.includes(filters.date)
      );
    }

    if (filters.type) {
      result = result.filter(item => 
        item.ticket.type.toLowerCase().includes(filters.type.toLowerCase())
      );
    }

    if (filters.minPrice) {
      const min = parseFloat(filters.minPrice);
      if (!isNaN(min)) {
        result = result.filter(item => item.price >= min);
      }
    }

    if (filters.maxPrice) {
      const max = parseFloat(filters.maxPrice);
      if (!isNaN(max)) {
        result = result.filter(item => item.price <= max);
      }
    }

    setListings(result);
  };

  const clearFilters = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setFilters({
      event: '',
      minPrice: '',
      maxPrice: '',
      date: '',
      type: ''
    });
  };

  const normalizeNumber = (value: unknown): number | null => {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim().length > 0) {
      const n = Number(value);
      if (Number.isFinite(n)) return n;
    }
    return null;
  };

  const getVipMatch = (ticket: any, event: any): VipReservado | null => {
    const vipList: VipReservado[] | null | undefined = event?.reservados_vip;
    if (!vipList || vipList.length === 0) return null;

    const ticketTotal = normalizeNumber(ticket?.total_price);
    const ticketQty = normalizeNumber(ticket?.quantity);

    let best: { score: number; vip: VipReservado } | null = null;
    for (const vip of vipList) {
      const vipPrice = normalizeNumber(vip.base_price);
      const vipCap = normalizeNumber(vip.capacity_people);
      let score = 0;

      if (ticketQty !== null && vipCap !== null && ticketQty === vipCap) score += 3;
      if (ticketTotal !== null && vipPrice !== null && Math.abs(ticketTotal - vipPrice) <= 0.01) score += 3;
      if (ticketQty !== null && ticketQty > 1) score += 1;

      if (!best || score > best.score) best = { score, vip };
    }

    if (!best || best.score < 4) return null;
    return best.vip;
  };

  const fetchListings = useCallback(async () => {
    try {
      setLoading(true);
      
      const { data, error } = await supabase
        .from('resale_listings')
        .select(`
          id,
          price,
          seller_id,
          created_at,
          ticket:tickets (
            id,
            ticket_type_id,
            quantity,
            total_price,
            event:events (
              id,
              title,
              event_date,
              description,
              reservados_vip (
                id,
                name,
                base_price,
                capacity_people,
                included_bottles,
                extra_bottle_price
              ),
              poster_url
            )
          )
        `)
        .eq('status', 'active')
        .order('created_at', { ascending: false });

      if (error) {
        throw error;
      }
      
      // FETCH PROFILES MANUALLY
      const sellerIds = [...new Set((data || []).map((item: any) => item.seller_id))];
      let profilesMap: Record<string, any> = {};
      
      if (sellerIds.length > 0) {
        const { data: profilesData } = await supabase
          .from('profiles')
          .select('id, full_name, email')
          .in('id', sellerIds);
          
        if (profilesData) {
          profilesData.forEach((p: any) => {
            profilesMap[p.id] = p;
          });
        }
      }

      const formattedData = (data || []).map((item: any) => {
        const ticket = Array.isArray(item.ticket) ? item.ticket[0] : item.ticket;
        const sellerProfile = profilesMap[item.seller_id];
        
        if (!ticket) return null;

        const event = Array.isArray(ticket?.event) ? ticket.event[0] : ticket?.event;
        
        if (!event) return null;

        let eventDate = new Date();
        if (event.event_date) {
            try {
                eventDate = new Date(event.event_date);
            } catch (e) {
                console.warn('Invalid date format:', event.event_date);
            }
        }
        
        const dateStr = eventDate.toLocaleDateString();
        const timeStr = eventDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const vipMatch = getVipMatch(ticket, event);

        return {
          ...item,
          seller: sellerProfile,
          ticket: {
            ...ticket,
            type: vipMatch ? 'VIP' : t('tickets.ticket'),
            vip: vipMatch,
            event: {
              ...event,
              title: event.title || t('home.unknown_event'),
              imageUrl: event.poster_url || 'https://via.placeholder.com/150',
              date: dateStr,
              time: timeStr,
              location: event.description || t('home.unknown_location')
            }
          }
        };
      })
      .filter((item): item is ResaleListing => item !== null);

      setAllListings(formattedData);
      setListings(formattedData);
    } catch (error) {
      console.error('Error fetching resale listings:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const scheduleRefresh = useCallback(() => {
    if (refreshTimeoutRef.current) clearTimeout(refreshTimeoutRef.current);
    refreshTimeoutRef.current = setTimeout(() => {
      fetchListings();
    }, 250);
  }, [fetchListings]);

  useFocusEffect(
    useCallback(() => {
      fetchListings();

      return () => {
        if (refreshTimeoutRef.current) {
          clearTimeout(refreshTimeoutRef.current);
          refreshTimeoutRef.current = null;
        }
      };
    }, [fetchListings])
  );

  useEffect(() => {
    const channel = supabase
      .channel('resale_listings_realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'resale_listings' },
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
  }, [scheduleRefresh]);

  const handleBuy = async (listing: ResaleListing) => {
    Haptics.selectionAsync();
    
    if (!user) {
      Alert.alert(t('resale.login_required_title'), t('resale.login_required_body'));
      return;
    }

    if (listing.seller_id === user.id) {
      Alert.alert(t('common.error'), t('resale.cannot_buy_own'));
      return;
    }

    const formattedPrice = new Intl.NumberFormat(localeTag, { style: 'currency', currency: 'EUR' }).format(listing.price);
    Alert.alert(
      t('resale.confirm_purchase_title'),
      t('resale.confirm_purchase_body', { price: formattedPrice }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('resale.pay_card'),
          onPress: async () => {
            try {
              const result = await present({
                kind: 'resale_ticket',
                listing_id: listing.id,
              });

              if (result.status === 'canceled') return;
              if (result.status !== 'succeeded') {
                throw new Error(result.message || t('resale.payment_failed'));
              }

              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              setPurchaseSuccess({
                title: t('resale.purchase_success_title'),
                message: t('resale.purchase_success_body', { tickets: t('tickets.my_tickets') }),
              });
              fetchListings();
            } catch (error: any) {
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
              Alert.alert(t('common.error'), error.message || t('errors.generic'));
            }
          },
        },
        {
          text: t('resale.pay_wallet'),
          onPress: async () => {
            try {
              if (creditBalance < listing.price) {
                throw new Error(t('resale.wallet_insufficient'));
              }
              await buyResaleTicketWithCredit(listing.id);
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              setPurchaseSuccess({
                title: t('resale.purchase_success_title'),
                message: t('resale.purchase_success_body', { tickets: t('tickets.my_tickets') }),
              });
              fetchListings();
            } catch (error: any) {
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
              Alert.alert(t('common.error'), error.message || t('errors.generic'));
            }
          },
        },
      ]
    );
  };

  const renderItem = ({ item, index }: { item: ResaleListing, index: number }) => (
    <TouchableOpacity
      activeOpacity={0.92}
      onPress={() => {
        const eventId = item.ticket?.event?.id;
        if (!eventId) return;
        router.push(`/(tabs)/event/${eventId}`);
      }}
      style={styles.cardContainer}
    >
      {/* Wallet Pass Style Card */}
      <View style={[styles.walletPass, item.ticket.vip ? styles.walletPassVip : null]}>
        {item.ticket.vip ? (
          <LinearGradient
            colors={['rgba(212,175,55,0.14)', 'rgba(6,182,212,0.08)', 'rgba(0,0,0,0)']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
        ) : null}
        {/* Top Section - Event Image & Header */}
        <View style={styles.walletHeader}>
            <Image 
              source={{ uri: item.ticket.event.imageUrl }} 
              style={styles.walletImage} 
              resizeMode="cover"
            />
            <LinearGradient
              colors={['rgba(0,0,0,0.6)', 'transparent']}
              style={styles.walletHeaderOverlay}
            />
            <View style={styles.walletHeaderText}>
              <Text style={styles.walletEventTitle} numberOfLines={2}>{item.ticket.event.title}</Text>
              <Text style={styles.walletLocation} numberOfLines={1}>{item.ticket.event.location}</Text>
            </View>

            {item.ticket.vip ? (
              <View style={styles.vipBadgeWrap}>
                <LinearGradient
                  colors={['rgba(212,175,55,0.96)', 'rgba(245,158,11,0.88)']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.vipBadge}
                >
                  <Sparkles size={14} color="#0b0b10" />
                  <Text style={styles.vipBadgeText} numberOfLines={1}>
                    VIP · {item.ticket.vip.name || 'LUXURY'}
                  </Text>
                </LinearGradient>
              </View>
            ) : null}
            
            <View style={styles.priceTag}>
              <Text style={styles.priceTagText}>{item.price}€</Text>
            </View>
        </View>

        {/* Divider with Notches */}
        <View style={styles.passDividerContainer}>
            <View style={styles.passNotchLeft} />
            <View style={styles.passDividerLine} />
            <View style={styles.passNotchRight} />
        </View>

        {/* Middle Section - Details */}
        <View style={styles.walletBody}>
            <View style={styles.walletRow}>
              <View style={styles.infoItem}>
                  <Calendar size={14} color="#8E8E93" />
                  <Text style={styles.infoText}>{item.ticket.event.date}</Text>
              </View>
              <View style={styles.infoItem}>
                  <Clock size={14} color="#8E8E93" />
                  <Text style={styles.infoText}>{item.ticket.event.time}</Text>
              </View>
            </View>

            {item.ticket.vip ? (
              <View style={styles.vipPillsRow}>
                <View style={styles.vipPill}>
                  <Users size={14} color="rgba(255,255,255,0.92)" />
                  <Text style={styles.vipPillText}>{item.ticket.vip.capacity_people} personas</Text>
                </View>
                <View style={styles.vipPill}>
                  <Sparkles size={14} color="rgba(255,255,255,0.92)" />
                  <Text style={styles.vipPillText}>{item.ticket.vip.included_bottles} botellas</Text>
                </View>
                {item.ticket.vip.extra_bottle_price !== null && item.ticket.vip.extra_bottle_price !== undefined ? (
                  <View style={styles.vipPill}>
                    <Text style={styles.vipPillText}>
                      Extra {Number(item.ticket.vip.extra_bottle_price).toFixed(2)}€
                    </Text>
                  </View>
                ) : null}
              </View>
            ) : null}
            
            <View style={styles.divider} />
            
            <View style={styles.sellerRow}>
                <View style={styles.sellerInfo}>
                   <View style={styles.sellerAvatar}>
                      <User size={12} color="#FFF"/>
                   </View>
                   <Text style={styles.sellerName}>
                      {item.seller?.full_name || t('resale.seller')}
                   </Text>
                </View>
                
                <TouchableOpacity 
                   onPress={() => handleBuy(item)}
                   style={[styles.buyButton, item.ticket.vip ? styles.buyButtonVip : null]}
                   activeOpacity={0.8}
                >
                   <Text style={[styles.buyButtonText, item.ticket.vip ? styles.buyButtonTextVip : null]}>{t('resale.buy')}</Text>
                </TouchableOpacity>
            </View>
        </View>
      </View>
    </TouchableOpacity>
  );

  if (purchaseSuccess) {
    return (
      <PurchaseConfirmation
        title={purchaseSuccess.title}
        message={purchaseSuccess.message}
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

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />
      <LinearGradient
        colors={['#000000', '#050505', '#0a0a0a']}
        style={StyleSheet.absoluteFill}
      />
      
      {/* Subtle Ambient Glow */}
      <View style={styles.ambientGlowTop} />
      
      <View style={[styles.headerContainer, { paddingTop: insets.top + 10 }]}>
        <View style={styles.headerTop}>
          <Text style={styles.headerTitle}>{t('tabs.resale')}</Text>
          <TouchableOpacity 
            style={[styles.filterButton, showFilters && styles.filterButtonActive]}
            onPress={() => {
              Haptics.selectionAsync();
              setShowFilters(!showFilters);
            }}
          >
            <SlidersHorizontal size={20} color={showFilters ? '#FFF' : '#8E8E93'} />
          </TouchableOpacity>
        </View>
        <Text style={styles.headerSubtitle}>{t('resale.subtitle')}</Text>

        {showFilters && (
          <View style={styles.filtersContainer}>
            <GlassView intensity={20} style={styles.glassFilters}>
              <View style={styles.filterHeader}>
                <Text style={styles.filterTitle}>{t('resale.filter_title')}</Text>
                <TouchableOpacity onPress={clearFilters}>
                  <Text style={styles.clearFilterText}>{t('home.clear_filters')}</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.filterRow}>
                <ThemedInput
                  placeholder={t('resale.filter_event_placeholder')}
                  value={filters.event}
                  onChangeText={(text) => setFilters(prev => ({ ...prev, event: text }))}
                  containerStyle={styles.filterInput}
                  style={styles.inputInner}
                  inputStyle={styles.inputText}
                  icon={<Search size={14} color="#8E8E93" />}
                />
              </View>

              <View style={styles.filterRow}>
                <ThemedInput
                  placeholder={t('resale.filter_min_price')}
                  value={filters.minPrice}
                  onChangeText={(text) => setFilters(prev => ({ ...prev, minPrice: text }))}
                  keyboardType="numeric"
                  containerStyle={[styles.filterInput, { flex: 1 }]}
                  style={styles.inputInner}
                  inputStyle={styles.inputText}
                />
                <View style={{width: 10}} />
                <ThemedInput
                  placeholder={t('resale.filter_max_price')}
                  value={filters.maxPrice}
                  onChangeText={(text) => setFilters(prev => ({ ...prev, maxPrice: text }))}
                  keyboardType="numeric"
                  containerStyle={[styles.filterInput, { flex: 1 }]}
                  style={styles.inputInner}
                  inputStyle={styles.inputText}
                />
              </View>
            </GlassView>
          </View>
        )}
      </View>

      <FlatList
        data={listings}
        renderItem={renderItem}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.listContent}
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
            onRefresh={() => {
              setRefreshing(true);
              fetchListings();
            }}
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
          loading ? (
            <View style={{ paddingVertical: 44, alignItems: 'center' }}>
              <DiscoLoader label="Cargando reventa…" subLabel="Buscando entradas disponibles" size={140} />
            </View>
          ) : (
            <View style={styles.emptyScreen}>
              <Animated.View style={[styles.emptyHeroWrap, { opacity: emptyEnter, transform: [{ scale: emptyEnter.interpolate({ inputRange: [0, 1], outputRange: [0.98, 1] }) }] }]}>
                <GlassView intensity={28} style={styles.emptyHeroCard}>
                  <LinearGradient
                    colors={['rgba(6,182,212,0.18)', 'rgba(124,58,237,0.12)', 'rgba(255,255,255,0.02)', 'transparent']}
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
                    <Text style={styles.emptyEyebrow}>{`ECLIPSE · ${String(t('tabs.resale')).toUpperCase()}`}</Text>
                  </View>

                  <Animated.View style={[styles.emptyIconFloat, { transform: [{ translateY: emptyFloat.interpolate({ inputRange: [0, 1], outputRange: [0, -7] }) }] }]}>
                    <Animated.View style={{ transform: [{ scale: emptyPulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.04] }) }] }}>
                      <LinearGradient colors={[Colors.dark.secondary, Colors.dark.primary, 'rgba(255,255,255,0.10)']} style={styles.emptyIconRing}>
                        <View style={styles.emptyIconInner}>
                          <Tag size={26} color="white" />
                        </View>
                      </LinearGradient>
                    </Animated.View>
                  </Animated.View>

                  <Text style={styles.emptyTitle}>
                    {hasActiveFilters ? t('resale.empty_no_results') : t('resale.empty_no_listings')}
                  </Text>
                  <Text style={styles.emptySubtitle}>
                    {hasActiveFilters
                      ? t('resale.empty_no_results_subtitle')
                      : t('resale.empty_no_listings_subtitle')}
                  </Text>
                  <View style={styles.emptyActions}>
                  {hasActiveFilters ? (
                    <TouchableOpacity
                      activeOpacity={0.88}
                      onPress={() => {
                        Haptics.selectionAsync();
                        clearFilters();
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
                            <Text style={styles.emptyCtaText}>{t('home.clear_filters')}</Text>
                            <ChevronRight size={18} color="rgba(255,255,255,0.85)" />
                          </View>
                        </View>
                      </LinearGradient>
                    </TouchableOpacity>
                  ) : (
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
                  )}
                  <View style={{ height: 10 }} />
                  <TouchableOpacity
                    activeOpacity={0.88}
                    onPress={() => {
                      Haptics.selectionAsync();
                      router.push('/(tabs)/tickets');
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
                          <Text style={styles.emptyCtaTextSecondary}>{t('resale.view_my_tickets')}</Text>
                          <ChevronRight size={18} color="rgba(255,255,255,0.55)" />
                        </View>
                      </View>
                    </LinearGradient>
                  </TouchableOpacity>
                </View>
                </GlassView>
              </Animated.View>
            </View>
          )
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  headerContainer: {
    paddingHorizontal: 20,
    paddingBottom: 10,
    zIndex: 10,
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  headerTitle: {
    fontSize: 34,
    fontWeight: '800',
    color: '#FFF',
    letterSpacing: -1,
  },
  headerSubtitle: {
    fontSize: 15,
    color: '#8E8E93',
    marginBottom: 10,
  },
  filterButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  filterButtonActive: {
    backgroundColor: Colors.dark.primary,
  },
  
  // Filters
  filtersContainer: {
    marginTop: 10,
  },
  glassFilters: {
    padding: 16,
    borderRadius: 16,
    backgroundColor: 'rgba(28, 28, 30, 0.6)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  filterHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  filterTitle: {
    color: '#FFF',
    fontWeight: '600',
    fontSize: 14,
  },
  clearFilterText: {
    color: Colors.dark.primary,
    fontSize: 12,
    fontWeight: '600',
  },
  filterRow: {
    flexDirection: 'row',
    marginBottom: 10,
  },
  filterInput: {
    marginBottom: 0,
    width: '100%',
  },
  inputInner: {
    backgroundColor: 'rgba(0,0,0,0.3)',
    borderColor: 'rgba(255,255,255,0.1)',
    height: 36,
    minHeight: 36,
    borderRadius: 8,
  },
  inputText: {
    fontSize: 14,
    height: 36,
    paddingVertical: 0,
  },

  // List
  listContent: {
    padding: 20,
    paddingTop: 10,
    paddingBottom: 120, // Increased padding for tab bar visibility
    flexGrow: 1,
  },
  cardContainer: {
    marginBottom: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.5,
    shadowRadius: 12,
    elevation: 8,
  },
  
  // Wallet Pass Style
  walletPass: {
    backgroundColor: '#1C1C1E',
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  walletPassVip: {
    borderColor: 'rgba(212,175,55,0.45)',
    shadowColor: 'rgba(212,175,55,0.35)',
    shadowOpacity: 0.6,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 10 },
    elevation: 10,
  },
  walletHeader: {
    height: 140,
    position: 'relative',
  },
  walletImage: {
    width: '100%',
    height: '100%',
  },
  walletHeaderOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 80,
  },
  walletHeaderText: {
    position: 'absolute',
    top: 16,
    left: 16,
    right: 80, // Space for price tag
  },
  walletEventTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#FFF',
    textShadowColor: 'rgba(0,0,0,0.7)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
    marginBottom: 4,
  },
  walletLocation: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.9)',
    fontWeight: '500',
    textShadowColor: 'rgba(0,0,0,0.7)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  vipBadgeWrap: {
    position: 'absolute',
    left: 16,
    bottom: 12,
    right: 92,
  },
  vipBadge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  vipBadgeText: {
    color: '#0b0b10',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.3,
    textTransform: 'uppercase',
    maxWidth: 220,
  },
  priceTag: {
    position: 'absolute',
    top: 16,
    right: 16,
    backgroundColor: '#FFF',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  priceTagText: {
    fontSize: 16,
    fontWeight: '800',
    color: '#000',
  },
  
  // Pass Divider & Notches
  passDividerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1C1C1E',
    height: 20,
    overflow: 'hidden',
  },
  passNotchLeft: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#000',
    marginLeft: -10,
  },
  passNotchRight: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#000',
    marginRight: -10,
  },
  passDividerLine: {
    flex: 1,
    height: 1,
    borderWidth: 1,
    borderColor: '#3A3A3C',
    borderStyle: 'dashed',
    borderRadius: 1,
  },
  
  // Wallet Body
  walletBody: {
    padding: 16,
    backgroundColor: '#1C1C1E',
  },
  walletRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  vipPillsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: -4,
    marginBottom: 12,
  },
  vipPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(212,175,55,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(212,175,55,0.22)',
  },
  vipPillText: {
    color: 'rgba(255,255,255,0.92)',
    fontSize: 13,
    fontWeight: '700',
  },
  infoItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  infoText: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '500',
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.1)',
    marginBottom: 16,
  },
  sellerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sellerInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sellerAvatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#3A3A3C',
    justifyContent: 'center',
    alignItems: 'center',
  },
  sellerName: {
    color: '#8E8E93',
    fontSize: 13,
  },
  buyButton: {
    backgroundColor: '#FFF',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  buyButtonVip: {
    backgroundColor: 'rgba(212,175,55,0.92)',
  },
  buyButtonText: {
    color: '#000',
    fontWeight: '700',
    fontSize: 13,
  },
  buyButtonTextVip: {
    color: '#0b0b10',
    fontWeight: '900',
  },

  // Empty State
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
    width: '100%',
    maxWidth: 560,
    paddingVertical: 24,
    paddingHorizontal: 18,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(255,255,255,0.04)',
    alignItems: 'center',
    overflow: 'hidden',
    alignSelf: 'center',
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
    backgroundColor: 'rgba(10,132,255,0.16)',
  },
  emptyOrbB: {
    width: 260,
    height: 260,
    bottom: -140,
    right: -120,
    backgroundColor: 'rgba(191,90,242,0.14)',
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
  emptyButton: {
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

  // Ambient Glow
  ambientGlowTop: {
    position: 'absolute',
    top: -100,
    right: -100,
    width: 300,
    height: 300,
    borderRadius: 150,
    backgroundColor: 'rgba(10, 132, 255, 0.1)',
  },
});
