import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, FlatList, Image, TouchableOpacity, RefreshControl, Platform, StatusBar, TextInput, Keyboard, Animated, Easing } from 'react-native';
import { useRouter } from 'expo-router';
import * as Location from 'expo-location';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useFocusEffect } from '@react-navigation/native';
import { MapPin, Calendar, Navigation, Map as MapIcon, Search } from '@/lib/icons';

import { Colors } from '@/constants/Colors';
import { useEvents, AppEvent } from '@/lib/EventContext';
import { useResponsive } from '@/lib/responsive';
import { GlassView } from '@/components/ui/GlassView';
import { DiscoLoader } from '@/components/ui/DiscoLoader';
import DateSelector from '@/components/DateSelector';
import AdvancedFilters, { FilterState } from '@/components/AdvancedFilters';

type EventWithDistance = AppEvent & {
  distance?: number;
};

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export default function HomeScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { horizontalPadding, maxContentWidth } = useResponsive();

  const { events: contextEvents, refreshEvents } = useEvents();
  const [refreshing, setRefreshing] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [userLocation, setUserLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [advancedFilters, setAdvancedFilters] = useState<FilterState>({ minAge: null, dressCode: null, musicType: null });

  const emptyFloat = useRef(new Animated.Value(0)).current;
  const emptyEnter = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const permission = await Location.requestForegroundPermissionsAsync();
        if (!mounted) return;
        if (permission.status !== 'granted') return;
        const loc = await Location.getCurrentPositionAsync({});
        if (!mounted) return;
        setUserLocation({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
      } catch {}
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const processedEvents = useMemo(() => {
    let filtered = [...(contextEvents || [])] as EventWithDistance[];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    filtered = filtered.filter((e) => new Date(e.date) >= today);

    filtered = filtered.filter((event) => {
      const eventDate = new Date(event.date);
      return (
        eventDate.getDate() === selectedDate.getDate() &&
        eventDate.getMonth() === selectedDate.getMonth() &&
        eventDate.getFullYear() === selectedDate.getFullYear()
      );
    });

    if (advancedFilters.minAge) {
      filtered = filtered.filter((e) => {
        if (!e.ageRestriction) return false;
        const age = parseInt(e.ageRestriction.replace(/\D/g, '')) || 0;
        return age >= advancedFilters.minAge!;
      });
    }

    if (advancedFilters.dressCode) {
      filtered = filtered.filter((e) => e.dressCode?.toLowerCase().includes(advancedFilters.dressCode!.toLowerCase()));
    }

    if (advancedFilters.musicType) {
      const musicType = advancedFilters.musicType.toLowerCase();
      filtered = filtered.filter((e) => {
        return (
          e.theme?.toLowerCase().includes(musicType) ||
          e.eventType?.toLowerCase().includes(musicType) ||
          e.description?.toLowerCase().includes(musicType) ||
          e.title?.toLowerCase().includes(musicType)
        );
      });
    }

    if (searchQuery) {
      const q = searchQuery.toLowerCase().trim();
      filtered = filtered.filter((e) =>
        (e.title?.toLowerCase() || '').includes(q) ||
        (e.location?.toLowerCase() || '').includes(q) ||
        (e.description?.toLowerCase() || '').includes(q) ||
        (e.eventType?.toLowerCase() || '').includes(q)
      );
    }

    if (userLocation) {
      filtered = filtered.map((e) => {
        if (!e.venues) return e;
        const d = haversineKm(userLocation.latitude, userLocation.longitude, Number(e.venues.latitude), Number(e.venues.longitude));
        return { ...e, distance: d };
      });
      filtered.sort((a, b) => (a.distance || 9999) - (b.distance || 9999));
    }

    return filtered;
  }, [advancedFilters, contextEvents, searchQuery, selectedDate, userLocation]);

  useFocusEffect(
    useCallback(() => {
      refreshEvents().catch(() => null);
    }, [refreshEvents])
  );

  useEffect(() => {
    const enabled = processedEvents.length === 0;
    if (!enabled) {
      emptyEnter.setValue(0);
      emptyFloat.setValue(0);
      return;
    }

    emptyEnter.setValue(0);
    Animated.spring(emptyEnter, { toValue: 1, speed: 14, bounciness: 6, useNativeDriver: true }).start();

    const floatAnim = Animated.loop(
      Animated.sequence([
        Animated.timing(emptyFloat, { toValue: 1, duration: 2200, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(emptyFloat, { toValue: 0, duration: 2200, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ])
    );
    floatAnim.start();

    return () => {
      floatAnim.stop();
    };
  }, [emptyEnter, emptyFloat, processedEvents.length]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    refreshEvents()
      .catch(() => null)
      .finally(() => setRefreshing(false));
  }, [refreshEvents]);

  const resetDiscovery = () => {
    Keyboard.dismiss();
    setSearchQuery('');
    setSelectedDate(new Date());
    setAdvancedFilters({ minAge: null, dressCode: null, musicType: null });
  };

  const renderEventItem = ({ item }: { item: EventWithDistance }) => (
    <TouchableOpacity
      activeOpacity={0.92}
      onPress={() => router.push(`/(tabs)/event/${item.id}`)}
      style={[styles.cardContainer, { width: '100%', maxWidth: maxContentWidth, alignSelf: 'center' }]}
    >
      {!!item.imageUrl && <Image source={{ uri: item.imageUrl }} style={styles.cardImage} resizeMode="cover" />}
      <LinearGradient colors={['transparent', 'rgba(0,0,0,0.30)', 'rgba(0,0,0,0.82)']} locations={[0, 0.6, 1]} style={styles.cardGradient} />

      <View style={styles.cardContent}>
        <View style={styles.cardTopRow}>
          <GlassView intensity={22} style={styles.categoryBadge}>
            <Text style={styles.categoryText}>{item.eventType || t('home.unknown_type')}</Text>
          </GlassView>
          {item.distance != null && (
            <GlassView intensity={22} style={styles.distanceBadge}>
              <Navigation size={12} color={Colors.dark.text} />
              <Text style={styles.distanceText}>{item.distance.toFixed(1)} km</Text>
            </GlassView>
          )}
        </View>

        <View style={styles.cardBottom}>
          <Text style={styles.cardTitle} numberOfLines={2}>{item.title}</Text>

          <View style={styles.cardInfoRow}>
            <View style={styles.infoItem}>
              <Calendar size={14} color="#A1A1AA" />
              <Text style={styles.infoText}>{item.date} • {item.time}</Text>
            </View>
            <View style={[styles.infoItem, { flex: 1, minWidth: 0 }]}>
              <MapPin size={14} color="#A1A1AA" />
              <Text style={[styles.infoText, { flexShrink: 1 }]} numberOfLines={1} ellipsizeMode="tail">
                {item.location}
              </Text>
            </View>
          </View>

          <View style={styles.priceRow}>
            <View>
              <Text style={styles.priceLabel}>{t('home.from')}</Text>
              <Text style={styles.priceValue}>{item.price}€</Text>
            </View>
            <TouchableOpacity activeOpacity={0.9} onPress={() => router.push(`/(tabs)/event/${item.id}`)} style={styles.ctaButton}>
              <LinearGradient colors={[Colors.dark.primary, Colors.dark.secondary]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.ctaGradient}>
                <Text style={styles.ctaText}>{t('home.get_tickets')}</Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />
      <LinearGradient
        colors={[Colors.dark.background, '#1A1025', Colors.dark.background]}
        locations={[0, 0.55, 1]}
        style={StyleSheet.absoluteFill}
      />

      <SafeAreaView style={styles.safeArea}>
        <View style={[styles.header, { paddingTop: Platform.OS === 'android' ? Math.max(10, insets.top) : insets.top, paddingHorizontal: horizontalPadding }]}>
          <View style={styles.headerTopRow}>
            <View>
              <Text style={styles.headerSubtitle}>{t('common.greeting')}</Text>
              <Text style={styles.headerTitle}>{t('common.explore')}</Text>
            </View>
          </View>

          <View style={styles.searchContainer}>
            <View style={styles.searchBar}>
              <Search size={20} color={Colors.dark.primary} />
              <TextInput
                placeholder={t('home.search_placeholder')}
                placeholderTextColor={Colors.dark.textSecondary}
                style={styles.searchInput}
                value={searchQuery}
                onChangeText={setSearchQuery}
                returnKeyType="search"
                onSubmitEditing={Keyboard.dismiss}
              />
            </View>
            <TouchableOpacity style={styles.mapButton} onPress={() => router.push('/(tabs)/party-map')} activeOpacity={0.9}>
              <MapIcon size={20} color="#FFF" />
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.filtersSection}>
          <DateSelector selectedDate={selectedDate} onSelectDate={setSelectedDate} />
          <View style={{ paddingHorizontal: horizontalPadding, marginTop: 14 }}>
            <AdvancedFilters filters={advancedFilters} onFilterChange={setAdvancedFilters} />
          </View>
        </View>

        <FlatList
          data={processedEvents}
          keyExtractor={(item) => item.id}
          renderItem={renderEventItem}
          contentContainerStyle={[styles.listContent, { paddingHorizontal: horizontalPadding }]}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.dark.primary} />
          }
          ListEmptyComponent={
            <View style={[styles.emptyWrap, { maxWidth: maxContentWidth, alignSelf: 'center', width: '100%', paddingHorizontal: horizontalPadding }]}>
              <Animated.View style={{ opacity: emptyEnter, transform: [{ translateY: emptyFloat.interpolate({ inputRange: [0, 1], outputRange: [0, -6] }) }] }}>
                <GlassView intensity={18} style={styles.emptyCard}>
                  <Text style={styles.emptyTitle}>{t('home.empty_title')}</Text>
                  <Text style={styles.emptySubtitle}>{t('home.empty_subtitle')}</Text>
                  <TouchableOpacity activeOpacity={0.9} onPress={resetDiscovery} style={styles.emptyCta}>
                    <LinearGradient colors={[Colors.dark.primary, Colors.dark.secondary]} style={styles.emptyCtaGradient}>
                      <Text style={styles.emptyCtaText}>{t('home.clear_filters')}</Text>
                    </LinearGradient>
                  </TouchableOpacity>
                </GlassView>
              </Animated.View>
            </View>
          }
        />
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.dark.background,
  },
  safeArea: {
    flex: 1,
  },
  header: {
    paddingBottom: 18,
  },
  headerTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginBottom: 14,
  },
  headerSubtitle: {
    color: Colors.dark.textSecondary,
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  headerTitle: {
    color: Colors.dark.text,
    fontSize: 28,
    fontWeight: '900',
    letterSpacing: -0.6,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  searchBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(20, 20, 30, 0.6)',
    borderRadius: 18,
    paddingHorizontal: 16,
    height: 50,
    borderWidth: 1,
    borderColor: 'rgba(124,58,237,0.22)',
  },
  searchInput: {
    flex: 1,
    height: '100%',
    color: Colors.dark.text,
    fontSize: 16,
    marginLeft: 10,
    fontWeight: '400',
  },
  mapButton: {
    width: 50,
    height: 50,
    backgroundColor: 'rgba(124,58,237,0.85)',
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.28,
    shadowRadius: 12,
    elevation: 10,
  },
  filtersSection: {
    marginBottom: 16,
  },
  listContent: {
    paddingBottom: 140,
  },
  cardContainer: {
    aspectRatio: 0.86,
    marginBottom: 22,
    borderRadius: 22,
    overflow: 'hidden',
    backgroundColor: '#1E1E2E',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.42,
    shadowRadius: 16,
    elevation: 10,
    borderWidth: 1,
    borderColor: 'rgba(124,58,237,0.16)',
  },
  cardImage: {
    width: '100%',
    height: '100%',
    opacity: 0.92,
  },
  cardGradient: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '100%',
    zIndex: 1,
  },
  cardContent: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    padding: 22,
    justifyContent: 'space-between',
    zIndex: 2,
  },
  cardTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 6,
  },
  categoryBadge: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.36)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  categoryText: {
    color: 'white',
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  distanceBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.36)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  distanceText: {
    color: 'white',
    fontSize: 12,
    fontWeight: '700',
  },
  cardBottom: {
    gap: 14,
  },
  cardTitle: {
    fontSize: 30,
    fontWeight: '900',
    color: 'white',
    letterSpacing: -0.9,
    lineHeight: 34,
    textShadowColor: 'rgba(0,0,0,0.75)',
    textShadowOffset: { width: 0, height: 4 },
    textShadowRadius: 10,
  },
  cardInfoRow: {
    flexDirection: 'row',
    gap: 14,
    alignItems: 'center',
  },
  infoItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(0,0,0,0.28)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
  },
  infoText: {
    color: '#E4E4E7',
    fontSize: 13,
    fontWeight: '600',
  },
  priceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    gap: 14,
  },
  priceLabel: {
    color: 'rgba(255,255,255,0.60)',
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  priceValue: {
    color: 'white',
    fontSize: 26,
    fontWeight: '900',
    letterSpacing: -0.3,
  },
  ctaButton: {
    borderRadius: 18,
    overflow: 'hidden',
  },
  ctaGradient: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 18,
  },
  ctaText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: -0.2,
  },
  emptyWrap: {
    paddingTop: 20,
    paddingBottom: 40,
  },
  emptyCard: {
    borderRadius: 24,
    paddingVertical: 22,
    paddingHorizontal: 18,
    alignItems: 'center',
  },
  emptyTitle: {
    color: 'white',
    fontSize: 20,
    fontWeight: '900',
    textAlign: 'center',
    letterSpacing: -0.2,
  },
  emptySubtitle: {
    marginTop: 10,
    color: Colors.dark.textSecondary,
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
    lineHeight: 20,
  },
  emptyCta: {
    marginTop: 16,
    borderRadius: 18,
    overflow: 'hidden',
    width: '100%',
  },
  emptyCtaGradient: {
    paddingVertical: 14,
    alignItems: 'center',
    borderRadius: 18,
  },
  emptyCtaText: {
    color: 'white',
    fontSize: 15,
    fontWeight: '900',
    letterSpacing: -0.2,
  },
});

