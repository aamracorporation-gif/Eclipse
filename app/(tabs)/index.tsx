import { View, Text, StyleSheet, FlatList, Image, TouchableOpacity, RefreshControl, Platform, StatusBar, Modal, Keyboard, ScrollView, Alert, TextInput, Dimensions, Animated, Easing } from 'react-native';
import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useRouter } from 'expo-router';
import { useEvents, AppEvent } from '@/lib/EventContext';
import { MapPin, Calendar, Star, Ticket, Navigation, Map as MapIcon, Search, X, Locate, Filter, Heart, ArrowRight, ChevronDown, ChevronRight } from 'lucide-react-native';
import * as Location from 'expo-location';
import MapView, { Marker, Callout, Region } from '@/components/ui/Map';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import DateSelector from '@/components/DateSelector';
import AdvancedFilters, { FilterState } from '@/components/AdvancedFilters';
import { Colors } from '@/constants/Colors';
import { GlassView } from '@/components/ui/GlassView';
import { ThemedInput } from '@/components/ui/ThemedInput';
import { ThemedButton } from '@/components/ui/ThemedButton';
import { DiscoLoader } from '@/components/ui/DiscoLoader';
import { useResponsive } from '@/lib/responsive';
import { BlurView } from 'expo-blur';
import { useTranslation } from 'react-i18next';
import { useFocusEffect } from '@react-navigation/native';

type EventWithDistance = AppEvent & {
  distance?: number;
};

const { width: SCREEN_WIDTH } = Dimensions.get('window');

export default function HomeScreen() {
  const { t } = useTranslation();
  const [refreshing, setRefreshing] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [userLocation, setUserLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [advancedFilters, setAdvancedFilters] = useState<FilterState>({
    minAge: null,
    dressCode: null,
    musicType: null
  });

  const { events: contextEvents, refreshEvents } = useEvents();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { horizontalPadding, maxContentWidth, isTablet, scaleFont } = useResponsive();

  // Map State
  const [showMapModal, setShowMapModal] = useState(false);
  const [mapRegion, setMapRegion] = useState<Region>({
    latitude: 40.4168,
    longitude: -3.7038,
    latitudeDelta: 0.1,
    longitudeDelta: 0.1,
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchingMap, setIsSearchingMap] = useState(false);
  const mapRef = useRef<MapView>(null);
  const emptyFloat = useRef(new Animated.Value(0)).current;
  const emptyPulse = useRef(new Animated.Value(0)).current;
  const emptyEnter = useRef(new Animated.Value(0)).current;
  const emptyDrift = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    requestLocationPermission();
  }, []);

  const requestLocationPermission = async () => {
    if (Platform.OS === 'web') return;
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        const location = await Location.getCurrentPositionAsync({});
        const userCoords = {
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
        };
        setUserLocation(userCoords);
        setMapRegion(prev => ({
          ...prev,
          latitude: userCoords.latitude,
          longitude: userCoords.longitude,
        }));
      }
    } catch (error) {
      console.log('Error getting location:', error);
    }
  };

  const handleMapSearch = async () => {
    // Dismiss keyboard first to improve UX
    Keyboard.dismiss();

    if (!searchQuery || searchQuery.trim().length === 0) return;
    
    setIsSearchingMap(true);
    const query = searchQuery.toLowerCase().trim();

    try {
      // 1. First, search within loaded events (Instant & Free)
      // We look for matches in title, location, or description
      const matchingEvent = contextEvents?.find(e => 
        (e.title?.toLowerCase() || '').includes(query) ||
        (e.location?.toLowerCase() || '').includes(query) ||
        (e.description?.toLowerCase() || '').includes(query)
      );

      if (matchingEvent && matchingEvent.venues) {
        const newRegion = {
          latitude: Number(matchingEvent.venues.latitude),
          longitude: Number(matchingEvent.venues.longitude),
          latitudeDelta: 0.02, // Zoom in closer for specific event
          longitudeDelta: 0.02,
        };
        
        // Animate to the found event
        mapRef.current?.animateToRegion(newRegion, 1000);
        setMapRegion(newRegion);
        setIsSearchingMap(false);
        return; // Stop here if we found a local match
      }

      // 2. If no local event found, try Geocoding (Requires API Key or Network)
      // This is wrapped in a specific try/catch to not break the whole flow
      try {
        const geocodedLocation = await Location.geocodeAsync(searchQuery);
        
        if (geocodedLocation && geocodedLocation.length > 0) {
          const { latitude, longitude } = geocodedLocation[0];
          const newRegion = {
            latitude,
            longitude,
            latitudeDelta: 0.05,
            longitudeDelta: 0.05,
          };
          
          mapRef.current?.animateToRegion(newRegion, 1000);
          setMapRegion(newRegion);
        } else {
          Alert.alert(
            t('home.location_not_found_title'),
            t('home.location_not_found_body')
          );
        }
      } catch (geocodeError) {
        console.log('Geocoding failed (likely no API key or network):', geocodeError);
        // If geocoding fails, just show a gentle message
        Alert.alert(
          t('home.search_limited_title'),
          t('home.search_limited_body')
        );
      }

    } catch (error) {
      console.error('Map search error:', error);
      Alert.alert(t('common.error'), t('home.search_error'));
    } finally {
      setIsSearchingMap(false);
    }
  };

  const centerOnUser = () => {
    if (userLocation) {
      const newRegion = {
        latitude: userLocation.latitude,
        longitude: userLocation.longitude,
        latitudeDelta: 0.1,
        longitudeDelta: 0.1,
      };
      setMapRegion(newRegion);
      mapRef.current?.animateToRegion(newRegion, 1000);
    } else {
        requestLocationPermission();
    }
  };

  const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  };

  const processedEvents = useMemo(() => {
    let filtered = [...(contextEvents || [])] as EventWithDistance[];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Basic date filtering
    filtered = filtered.filter(e => new Date(e.date) >= today);

    // Filter by selected date (match day)
    filtered = filtered.filter(event => {
      const eventDate = new Date(event.date);
      return (
        eventDate.getDate() === selectedDate.getDate() &&
        eventDate.getMonth() === selectedDate.getMonth() &&
        eventDate.getFullYear() === selectedDate.getFullYear()
      );
    });

    // Advanced Filtering
    if (advancedFilters.minAge) {
      filtered = filtered.filter(e => {
        if (!e.ageRestriction) return false;
        const age = parseInt(e.ageRestriction.replace(/\D/g, '')) || 0;
        return age >= advancedFilters.minAge!;
      });
    }

    if (advancedFilters.dressCode) {
      filtered = filtered.filter(e => 
        e.dressCode?.toLowerCase().includes(advancedFilters.dressCode!.toLowerCase())
      );
    }

    if (advancedFilters.musicType) {
      const musicType = advancedFilters.musicType.toLowerCase();
      filtered = filtered.filter(e => {
        return (
          e.theme?.toLowerCase().includes(musicType) ||
          e.eventType?.toLowerCase().includes(musicType) ||
          e.description?.toLowerCase().includes(musicType) ||
          e.title?.toLowerCase().includes(musicType)
        );
      });
    }

    // Search Query Filtering
    if (searchQuery) {
        const query = searchQuery.toLowerCase().trim();
        filtered = filtered.filter(e => 
            (e.title?.toLowerCase() || '').includes(query) ||
            (e.location?.toLowerCase() || '').includes(query) ||
            (e.description?.toLowerCase() || '').includes(query) ||
            (e.eventType?.toLowerCase() || '').includes(query)
        );
    }

    // Distance calculation
    if (userLocation) {
      filtered = filtered.map(event => {
        if (event.venues) {
          const distance = calculateDistance(
            userLocation.latitude,
            userLocation.longitude,
            Number(event.venues.latitude),
            Number(event.venues.longitude)
          );
          return { ...event, distance };
        }
        return event;
      });
      // Sort by distance if location available
      filtered.sort((a, b) => (a.distance || 9999) - (b.distance || 9999));
    } else {
      // Sort by date otherwise
      filtered.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    }

    return filtered;
  }, [contextEvents, userLocation, selectedDate, advancedFilters, searchQuery]);

  useEffect(() => {
    const enabledEmpty = processedEvents.length === 0;
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
  }, [emptyDrift, emptyEnter, emptyFloat, emptyPulse, processedEvents.length]);

  const mapEvents = useMemo(() => {
    const now = Date.now();
    return processedEvents.filter((e) => {
      const raw = e.startsAt ? new Date(e.startsAt).getTime() : Number.NaN;
      const fallback = new Date(`${e.date}T${e.time}`).getTime();
      const startAt = Number.isFinite(raw) ? raw : fallback;
      if (!Number.isFinite(startAt)) return false;
      return startAt >= now;
    });
  }, [processedEvents]);

  useFocusEffect(
    useCallback(() => {
      refreshEvents();
    }, [refreshEvents])
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    refreshEvents()
      .catch(() => null)
      .finally(() => setRefreshing(false));
  }, [refreshEvents]);

  const resetDiscovery = () => {
    setSearchQuery('');
    setSelectedDate(new Date());
    setAdvancedFilters({
      minAge: null,
      dressCode: null,
      musicType: null,
    });
  };

  const renderEventItem = ({ item }: { item: EventWithDistance }) => (
    <TouchableOpacity
      activeOpacity={0.9}
      onPress={() => router.push(`/(tabs)/event/${item.id}`)}
      style={[styles.cardContainer, { width: '100%', maxWidth: maxContentWidth, alignSelf: 'center' }]}
    >
        <Image 
          source={{ uri: item.imageUrl }} 
          style={styles.cardImage} 
          resizeMode="cover"
        />
        
        <LinearGradient
          colors={['transparent', 'rgba(0,0,0,0.2)', 'rgba(0,0,0,0.8)', '#000000']}
          locations={[0, 0.4, 0.7, 1]}
          style={styles.cardGradient}
        />

        <View style={styles.cardContent}>
            <View style={styles.cardTopRow}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <GlassView intensity={30} style={styles.categoryBadge}>
                      <Text style={styles.categoryText}>{item.eventType || 'Evento'}</Text>
                  </GlassView>
                </View>
                {item.distance && (
                    <GlassView intensity={30} style={styles.distanceBadge}>
                        <Navigation size={12} color="white" />
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
                        <Text style={[styles.infoText, { flexShrink: 1 }]} numberOfLines={2} ellipsizeMode="tail">
                          {item.location}
                        </Text>
                    </View>
                </View>

                <View style={styles.priceRow}>
                    <View>
                        <Text style={styles.priceLabel}>Desde</Text>
                        <Text style={styles.priceValue}>{item.price}€</Text>
                    </View>
                    <View style={styles.arrowButton}>
                         <ArrowRight size={20} color="black" />
                    </View>
                </View>
            </View>
        </View>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />
      {/* Deep Night Gradient Background */}
      <LinearGradient
        colors={['#0F0F1A', '#1A1025', '#0F0F1A']}
        locations={[0, 0.5, 1]}
        style={StyleSheet.absoluteFill}
      />
      
      {/* Ambient Neon Glow */}
      <View style={styles.ambientGlowTop} />
      <View style={styles.ambientGlowBottom} />

      {/* Header - Nightlife Style */}
        <View style={[styles.header, { paddingTop: Platform.OS === 'android' ? insets.top + 10 : insets.top, paddingHorizontal: horizontalPadding }]}>
          <View style={styles.headerTopRow}>
            <View>
              <Text style={styles.headerSubtitle}>{t('common.greeting')}</Text>
              <Text style={styles.headerTitle}>{t('common.explore')}</Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            </View>
          </View>
          
          <View style={styles.searchContainer}>
            <View style={styles.searchBar}>
              <Search size={20} color={Colors.dark.primary} />
              <TextInput 
                placeholder={t('home.search_placeholder')} 
                placeholderTextColor="rgba(255,255,255,0.4)"
                style={styles.searchInput}
                value={searchQuery}
                onChangeText={setSearchQuery}
              />
            </View>
            <TouchableOpacity 
              style={styles.mapButton}
              onPress={() => setShowMapModal(true)}
            >
              <MapIcon size={20} color="#FFF" />
            </TouchableOpacity>
          </View>
        </View>

      {/* Date Selector & Filters */}
      <View style={[styles.filtersSection]}>
        <DateSelector selectedDate={selectedDate} onSelectDate={setSelectedDate} />
        <View style={[styles.advancedFilterContainer, { paddingHorizontal: horizontalPadding }]}>
            <AdvancedFilters filters={advancedFilters} onFilterChange={setAdvancedFilters} />
        </View>
      </View>

      <FlatList
        data={processedEvents}
        keyExtractor={(item) => item.id}
        renderItem={renderEventItem}
        contentContainerStyle={[styles.listContent, { paddingHorizontal: horizontalPadding }]}
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
          <View style={[styles.emptyScreen, { maxWidth: maxContentWidth, width: '100%', alignSelf: 'center', paddingHorizontal: horizontalPadding }]}>
            <Animated.View style={[styles.emptyHeroWrap, { opacity: emptyEnter, transform: [{ scale: emptyEnter.interpolate({ inputRange: [0, 1], outputRange: [0.98, 1] }) }] }]}>
              <GlassView intensity={28} style={styles.emptyHeroCard}>
                <LinearGradient
                  colors={['rgba(124,58,237,0.18)', 'rgba(6,182,212,0.10)', 'rgba(255,255,255,0.02)', 'transparent']}
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
                  <Text style={styles.emptyEyebrow}>ECLIPSE · DASHBOARD</Text>
                </View>

                <Animated.View style={[styles.emptyIconFloat, { transform: [{ translateY: emptyFloat.interpolate({ inputRange: [0, 1], outputRange: [0, -7] }) }] }]}>
                  <Animated.View style={{ transform: [{ scale: emptyPulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.04] }) }] }}>
                    <LinearGradient colors={[Colors.dark.primary, Colors.dark.secondary, 'rgba(255,255,255,0.10)']} style={styles.emptyIconRing}>
                      <View style={styles.emptyIconInner}>
                        <Search size={24} color="white" />
                      </View>
                    </LinearGradient>
                  </Animated.View>
                </Animated.View>

                <Text style={styles.emptyTitle}>{t('home.empty_title')}</Text>
                <Text style={styles.emptySubtitle}>{t('home.empty_subtitle')}</Text>

                <View style={styles.emptyActions}>
                  <TouchableOpacity activeOpacity={0.88} onPress={resetDiscovery} style={styles.emptyCtaOuter}>
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

                  <View style={{ height: 10 }} />

                  <TouchableOpacity activeOpacity={0.88} onPress={() => setShowMapModal(true)} style={styles.emptyCtaOuter}>
                    <LinearGradient
                      colors={['rgba(255,255,255,0.16)', 'rgba(255,255,255,0.06)']}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={styles.emptyCtaBorder}
                    >
                      <View style={[styles.emptyCtaInner, { backgroundColor: 'rgba(255,255,255,0.04)' }]}>
                        <View style={styles.emptyCtaRow}>
                          <Text style={styles.emptyCtaTextSecondary}>{t('home.view_map')}</Text>
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

      {/* Map Modal */}
      <Modal
        visible={showMapModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowMapModal(false)}
      >
        <View style={{ flex: 1, backgroundColor: '#0F0F1A' }}>
            <MapView
                ref={mapRef}
                style={StyleSheet.absoluteFill}
                initialRegion={mapRegion}
                onRegionChangeComplete={(region) => setMapRegion(region)}
                showsUserLocation
                showsMyLocationButton={false}
            >
                {mapEvents.map(event => (
                    event.venues && (
                        <Marker
                            key={event.id}
                            coordinate={{
                                latitude: Number(event.venues.latitude),
                                longitude: Number(event.venues.longitude)
                            }}
                            title={event.title}
                            description={`${event.date} • ${event.price}€`}
                            onCalloutPress={() => {
                                setShowMapModal(false);
                                router.push(`/(tabs)/event/${event.id}`);
                            }}
                        >
                            <View style={styles.customMarker}>
                                <Image source={{ uri: event.imageUrl }} style={styles.markerImage} />
                            </View>
                        </Marker>
                    )
                ))}
            </MapView>

            {/* Map Search Bar - Safe Area Aware */}
            {/* Using absolute positioning with explicit top/left/right to ensure it stays on top */}
            <View 
                style={[
                    styles.mapSafeArea, 
                    { paddingTop: Platform.OS === 'android' ? insets.top + 20 : insets.top + 10 }
                ]}
                pointerEvents="box-none"
            >
                <View style={styles.floatingSearchBarContainer}>
                    {/* Background Layer */}
                    <View style={[StyleSheet.absoluteFill, styles.floatingSearchBarBg]}>
                        {Platform.OS === 'ios' ? (
                            <BlurView intensity={60} tint="dark" style={StyleSheet.absoluteFill} />
                        ) : (
                            <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(20, 20, 30, 0.95)' }]} />
                        )}
                    </View>

                    {/* Content Layer */}
                    <View style={styles.floatingSearchBarContent}>
                        <TouchableOpacity onPress={() => setShowMapModal(false)} style={styles.iconButton}>
                            <X size={22} color="#FFF" />
                        </TouchableOpacity>
                        
                        <TextInput 
                            value={searchQuery}
                            onChangeText={setSearchQuery}
                            placeholder={t('home.search_city') || "Buscar ciudad o zona..."}
                            placeholderTextColor="#AAA"
                            style={styles.floatingSearchInput}
                            onSubmitEditing={handleMapSearch}
                            returnKeyType="search"
                            autoCorrect={false}
                            blurOnSubmit={true}
                        />
                        
                        {isSearchingMap ? (
                            <View style={{ marginRight: 8 }}>
                                <DiscoLoader size={18} />
                            </View>
                        ) : (
                            <TouchableOpacity onPress={handleMapSearch} style={styles.iconButton}>
                                <Search size={22} color={Colors.dark.primary} />
                            </TouchableOpacity>
                        )}
                    </View>
                </View>
            </View>

            <TouchableOpacity 
                style={[styles.myLocationButton, { bottom: 40, top: undefined }]} 
                onPress={centerOnUser}
            >
                <Locate size={24} color="#000" />
            </TouchableOpacity>
        </View>
      </Modal>

    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F0F1A',
  },
  ambientGlowTop: {
    position: 'absolute',
    top: -100,
    left: -100,
    width: 300,
    height: 300,
    borderRadius: 150,
    backgroundColor: '#6B2CA1',
    opacity: 0.15,
  },
  ambientGlowBottom: {
    position: 'absolute',
    bottom: -50,
    right: -50,
    width: 250,
    height: 250,
    borderRadius: 125,
    backgroundColor: '#9D4EDD',
    opacity: 0.1,
  },
  header: {
    paddingBottom: 20,
  },
  headerTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  headerSubtitle: {
    color: '#A1A1AA',
    fontSize: 14,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  headerTitle: {
    color: '#FFF',
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.5,
    textShadowColor: 'rgba(107, 44, 161, 0.5)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 10,
  },
  profileButton: {
    shadowColor: '#6B2CA1',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 8,
    elevation: 8,
  },
  profileGradient: {
    width: 50,
    height: 50,
    borderRadius: 25,
    padding: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  langModalContent: {
    width: '100%',
    maxWidth: 320,
    borderRadius: 24,
    padding: 24,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    overflow: 'hidden',
  },
  langModalTitle: {
    color: 'white',
    fontSize: 20,
    fontWeight: '800',
    marginBottom: 20,
    textAlign: 'center',
  },
  langOption: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 16,
    marginBottom: 8,
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  langOptionActive: {
    backgroundColor: 'rgba(124,58,237,0.15)',
    borderColor: 'rgba(124,58,237,0.3)',
    borderWidth: 1,
  },
  langOptionFlag: {
    fontSize: 20,
    marginRight: 16,
  },
  langOptionLabel: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 16,
    fontWeight: '600',
    flex: 1,
  },
  langOptionLabelActive: {
    color: 'white',
  },
  activeIndicator: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#7C3AED',
  },
  profileImage: {
    width: '100%',
    height: '100%',
    borderRadius: 24,
    borderWidth: 2,
    borderColor: '#000',
  },
  langButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  langText: {
    color: 'white',
    fontSize: 12,
    fontWeight: 'bold',
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  mapButton: {
    width: 50,
    height: 50,
    backgroundColor: 'rgba(107, 44, 161, 0.8)',
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#9D4EDD',
    shadowColor: '#6B2CA1',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 8,
  },
  searchBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(20, 20, 30, 0.6)',
    borderRadius: 16,
    paddingHorizontal: 16,
    height: 50,
    borderWidth: 1,
    borderColor: 'rgba(107, 44, 161, 0.3)',
  },
  filterButton: {
    width: 50,
    height: 50,
    backgroundColor: 'rgba(30, 30, 45, 0.8)',
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 12,
    borderWidth: 1,
    borderColor: 'rgba(107, 44, 161, 0.5)',
  },
  filterButtonActive: {
    backgroundColor: Colors.dark.primary,
    borderColor: Colors.dark.primary,
    shadowColor: Colors.dark.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 8,
  },
  activeFiltersContainer: {
    paddingHorizontal: 20,
    marginBottom: 16,
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(30, 30, 45, 0.9)',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
    marginRight: 10,
    borderWidth: 1,
    borderColor: 'rgba(107, 44, 161, 0.3)',
  },
  activeFilterChip: {
    backgroundColor: Colors.dark.primary,
    borderColor: Colors.dark.primary,
    shadowColor: Colors.dark.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  },
  filterChipText: {
    color: '#AAA',
    fontSize: 14,
    fontWeight: '500',
  },
  activeFilterChipText: {
    color: '#FFF',
    fontWeight: '600',
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    marginBottom: 16,
    marginTop: 8,
  },
  sectionTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#FFF',
    textShadowColor: 'rgba(107, 44, 161, 0.4)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 8,
  },
  searchInput: {
    flex: 1,
    height: '100%',
    color: 'white',
    fontSize: 17,
    marginLeft: 10,
    fontWeight: '400',
  },
  clearSearchButton: {
    padding: 4,
  },
  clearIconBg: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: 'rgba(255,255,255,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  filtersSection: {
    marginBottom: 24,
  },
  advancedFilterContainer: {
    marginTop: 20,
  },
  listContent: {
    paddingBottom: 140,
  },
  cardContainer: {
    width: '100%',
    aspectRatio: 0.85,
    marginBottom: 24,
    borderRadius: 24,
    overflow: 'hidden',
    backgroundColor: '#1E1E2E',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.5,
    shadowRadius: 16,
    elevation: 10,
    borderWidth: 1,
    borderColor: 'rgba(107, 44, 161, 0.2)',
  },
  cardImage: {
    width: '100%',
    height: '100%',
    opacity: 0.9,
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
    padding: 24,
    justifyContent: 'space-between',
    zIndex: 2,
  },
  cardTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  categoryBadge: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.4)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  categoryText: {
    color: 'white',
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  verifiedBadge: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: 'rgba(34, 197, 94, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(34, 197, 94, 0.25)',
  },
  verifiedText: {
    color: '#4ade80',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  distanceBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.4)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  distanceText: {
    color: 'white',
    fontSize: 13,
    fontWeight: '600',
  },
  cardBottom: {
    gap: 16,
  },
  cardTitle: {
    fontSize: 34,
    fontWeight: '900',
    color: 'white',
    marginBottom: 6,
    letterSpacing: -1,
    lineHeight: 38,
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 0, height: 4 },
    textShadowRadius: 8,
  },
  cardInfoRow: {
    flexDirection: 'row',
    gap: 20,
    alignItems: 'center',
  },
  infoItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(0,0,0,0.3)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  infoText: {
    color: '#E4E4E7',
    fontSize: 14,
    fontWeight: '500',
  },
  priceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginTop: 4,
  },
  priceLabel: {
    color: '#A1A1AA',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 2,
    textTransform: 'uppercase',
  },
  priceValue: {
    color: 'white',
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  arrowButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'white',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: 'black',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  emptyScreen: {
    paddingTop: 18,
    paddingBottom: 44,
  },
  emptyHeroWrap: {
    alignSelf: 'center',
    width: '100%',
  },
  emptyHeroCard: {
    width: '100%',
    paddingVertical: 24,
    paddingHorizontal: 18,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(255,255,255,0.04)',
    overflow: 'hidden',
    alignItems: 'center',
  },
  emptyHairlineTop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.10)',
    opacity: 0.6,
  },
  emptyOrb: {
    position: 'absolute',
    borderRadius: 999,
    filter: 'blur(0px)',
  },
  emptyOrbA: {
    width: 240,
    height: 240,
    top: -130,
    left: -130,
    backgroundColor: 'rgba(6,182,212,0.20)',
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
    marginBottom: 10,
  },
  emptyEyebrow: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.6,
  },
  emptyIconFloat: {
    marginTop: 6,
    marginBottom: 14,
  },
  emptyIconRing: {
    width: 64,
    height: 64,
    borderRadius: 32,
    padding: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyIconInner: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  emptyTitle: {
    color: 'white',
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: -0.3,
    textAlign: 'center',
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
  mapSafeArea: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 100,
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  floatingSearchBarContainer: {
    width: '100%',
    height: 54,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 10,
    borderRadius: 30,
  },
  floatingSearchBarBg: {
    borderRadius: 30,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(107, 44, 161, 0.5)',
  },
  floatingSearchBarContent: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    height: '100%',
    width: '100%',
  },
  floatingSearchInput: {
    flex: 1,
    height: '100%',
    marginLeft: 12,
    fontSize: 16,
    color: '#FFF',
    fontWeight: '500',
  },
  iconButton: {
    padding: 4,
  },
  customMarker: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 2,
    borderColor: Colors.dark.primary,
    overflow: 'hidden',
    backgroundColor: Colors.dark.background,
  },
  markerImage: {
    width: '100%',
    height: '100%',
  },
  myLocationButton: {
    position: 'absolute',
    bottom: 40,
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'white',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
});
