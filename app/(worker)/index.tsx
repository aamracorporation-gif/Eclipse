import { View, Text, StyleSheet, TouchableOpacity, ScrollView, RefreshControl, Platform } from 'react-native';
import { useState, useEffect } from 'react';
import { useRouter } from 'expo-router';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/lib/supabase';
import { QrCode, Ticket, Calendar, LogOut, MapPin, Filter } from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Colors } from '@/constants/Colors';
import { GlassView } from '@/components/ui/GlassView';
import { DiscoLoader } from '@/components/ui/DiscoLoader';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { useResponsive } from '@/lib/responsive';

// Helper to calculate distance in km
function getDistanceFromLatLonInKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371; // Radius of the earth in km
  const dLat = deg2rad(lat2-lat1);  // deg2rad below
  const dLon = deg2rad(lon2-lon1); 
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) * 
    Math.sin(dLon/2) * Math.sin(dLon/2)
    ; 
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)); 
  return R * c; // Distance in km
}

function deg2rad(deg: number) {
  return deg * (Math.PI/180)
}

export default function WorkerDashboard() {
  const { user, workerProfile, signOut } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [stats, setStats] = useState({ tickets_sold: 0, unpaid_amount: 0 });
  const [assignedEvents, setAssignedEvents] = useState<any[]>([]);
  const [location, setLocation] = useState<{latitude: number, longitude: number} | null>(null);
  const [radius, setRadius] = useState<number | null>(null); // null means "All"
  const { horizontalPadding, maxContentWidth, scaleFont } = useResponsive();

  useEffect(() => {
    fetchDashboardData();
    requestLocation();
  }, []);

  const requestLocation = async () => {
    if (Platform.OS === 'web') return;
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      
      const loc = await Location.getCurrentPositionAsync({});
      setLocation({
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude
      });
    } catch (e) {
      console.log('Error getting location:', e);
    }
  };

  const fetchDashboardData = async () => {
    if (!workerProfile) return;
    
    try {
      setLoading(true);
      
      // 1. Fetch Stats (Only Ticket Count)
      const { count } = await supabase
        .from('tickets')
        .select('*', { count: 'exact', head: true })
        .eq('sold_by_worker_id', workerProfile.id);
      
      setStats(prev => ({ ...prev, tickets_sold: count || 0 }));

      // 2. Fetch ALL Organizer Events (Active/Future) instead of assigned only
      const { data: eventsData, error: eventsError } = await supabase
        .from('events')
        .select(`
          id, title, event_date, 
          venues (name, latitude, longitude)
        `)
        .eq('creator_id', workerProfile.organizer_id)
        // Show only future or today's events
        .gte('event_date', new Date().toISOString())
        .order('event_date', { ascending: true });

      if (eventsError) throw eventsError;

      if (eventsData) {
        setAssignedEvents(eventsData);
      }

    } catch (error) {
      console.error('Error fetching worker dashboard:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut();
      router.replace('/(auth)/login');
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  const onRefresh = () => {
    setRefreshing(true);
    fetchDashboardData();
  };

  const filteredEvents = assignedEvents.filter(event => {
    if (radius === null || !location || !event.venues?.latitude) return true;
    
    const dist = getDistanceFromLatLonInKm(
      location.latitude, 
      location.longitude, 
      event.venues.latitude, 
      event.venues.longitude
    );
    
    return dist <= radius;
  });

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={[Colors.dark.background, '#1e1b4b']}
        style={StyleSheet.absoluteFill}
      />

      <ScrollView 
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 20, paddingHorizontal: horizontalPadding, alignItems: 'center' }]}
        refreshControl={
          <RefreshControl
            refreshing={false}
            onRefresh={onRefresh}
            tintColor="transparent"
            colors={['transparent']}
            progressBackgroundColor="transparent"
            title=""
            titleColor="transparent"
            style={{ opacity: 0 }}
          />
        }
      >
        {refreshing ? (
          <View style={{ paddingTop: 6, paddingBottom: 10, alignItems: 'center' }}>
            <DiscoLoader size={46} />
          </View>
        ) : null}
        {/* Header */}
        <View style={[styles.header, { width: '100%', maxWidth: maxContentWidth }]}>
          <View style={{ flex: 1, paddingRight: 12 }}>
            <Text
              style={[styles.welcomeText, { fontSize: scaleFont(24) }]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.8}
            >
              Hola, {workerProfile?.name}
            </Text>
            <Text style={[styles.roleText, { fontSize: scaleFont(16) }]} numberOfLines={1}>
              Panel de Staff
            </Text>
          </View>
          <TouchableOpacity onPress={handleLogout} style={styles.logoutButton}>
            <LogOut size={20} color="white" />
          </TouchableOpacity>
        </View>

        {/* Stats Cards */}
        <View style={[styles.statsContainer, { width: '100%', maxWidth: maxContentWidth }]}>
          <GlassView intensity={20} style={styles.statCard}>
            <Ticket size={24} color={Colors.dark.primary} style={{ marginBottom: 8 }} />
            <Text
              style={[styles.statValue, { fontSize: scaleFont(28) }]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.8}
            >
              {stats.tickets_sold}
            </Text>
            <Text style={[styles.statLabel, { fontSize: scaleFont(13) }]} numberOfLines={1}>
              Entradas Vendidas
            </Text>
          </GlassView>

          <GlassView intensity={20} style={styles.statCard}>
            <Calendar size={24} color="#3b82f6" style={{ marginBottom: 8 }} />
            <Text
              style={[styles.statValue, { color: '#3b82f6', fontSize: scaleFont(28) }]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.8}
            >
              {assignedEvents.length}
            </Text>
            <Text style={[styles.statLabel, { fontSize: scaleFont(13) }]} numberOfLines={1}>
              Eventos Activos
            </Text>
          </GlassView>
        </View>

        {/* Main Actions */}
        <Text style={[styles.sectionTitle, { fontSize: scaleFont(20), width: '100%', maxWidth: maxContentWidth }]}>Acciones Rápidas</Text>
        <View style={[styles.actionsContainer, { width: '100%', maxWidth: maxContentWidth }]}>
          <TouchableOpacity 
            style={styles.actionButton} 
            onPress={() => router.push('/(worker)/scan')}
            activeOpacity={0.8}
          >
            <LinearGradient
              colors={[Colors.dark.primary, Colors.dark.secondary]}
              style={styles.actionGradient}
            >
              <QrCode size={32} color="white" />
              <Text style={[styles.actionText, { fontSize: scaleFont(16) }]} numberOfLines={1} adjustsFontSizeToFit>
                Escanear Entradas
              </Text>
            </LinearGradient>
          </TouchableOpacity>

          <TouchableOpacity 
            style={styles.actionButton}
            onPress={() => router.push('/(worker)/sell')}
            activeOpacity={0.8}
          >
            <GlassView intensity={30} style={styles.actionGlass}>
              <Ticket size={32} color="white" />
              <Text style={[styles.actionText, { fontSize: scaleFont(16) }]} numberOfLines={1} adjustsFontSizeToFit>
                Venta Manual
              </Text>
            </GlassView>
          </TouchableOpacity>
        </View>

        {/* Assigned Events */}
        <View style={[styles.eventsHeader, { width: '100%', maxWidth: maxContentWidth }]}>
          <Text style={[styles.sectionTitle, { fontSize: scaleFont(20) }]} numberOfLines={1}>
            Mis Eventos Asignados
          </Text>
          {location && (
            <View style={styles.filterContainer}>
              <Filter size={14} color={Colors.dark.textSecondary} />
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.radiusScroll}>
                {[null, 5, 10, 25, 50].map((r) => (
                  <TouchableOpacity 
                    key={r || 'all'} 
                    onPress={() => setRadius(r)}
                    style={[
                      styles.radiusBadge, 
                      radius === r && styles.radiusBadgeActive
                    ]}
                    activeOpacity={0.85}
                  >
                    <Text
                      style={[
                        styles.radiusText,
                        { fontSize: scaleFont(12) },
                        radius === r && styles.radiusTextActive,
                      ]}
                      numberOfLines={1}
                    >
                      {r ? `${r}km` : 'Todos'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          )}

        </View>
        {filteredEvents.length === 0 ? (
          <GlassView intensity={10} style={[styles.emptyState, { width: '100%', maxWidth: maxContentWidth }]}>
            <Calendar size={40} color={Colors.dark.textSecondary} />
            <Text style={[styles.emptyText, { fontSize: scaleFont(16) }]} numberOfLines={2} adjustsFontSizeToFit>
              No tienes eventos asignados
            </Text>
            {radius && (
              <Text style={[styles.emptySubtext, { fontSize: scaleFont(12) }]} numberOfLines={2} adjustsFontSizeToFit>
                Prueba a ampliar el radio de búsqueda
              </Text>
            )}
          </GlassView>
        ) : (
          filteredEvents.map((event) => {
            let distance = null;
            if (location && event.venues?.latitude) {
              distance = getDistanceFromLatLonInKm(
                location.latitude,
                location.longitude,
                event.venues.latitude,
                event.venues.longitude
              );
            }

            const eventDate = new Date(event.event_date);
            return (
              <GlassView key={event.id} intensity={15} style={[styles.eventCard, { width: '100%', maxWidth: maxContentWidth }]}>
                <View style={styles.eventInfo}>
                  <Text
                    style={[styles.eventTitle, { fontSize: scaleFont(18) }]}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.85}
                  >
                    {event.title}
                  </Text>
                  <Text style={[styles.eventDate, { fontSize: scaleFont(13) }]} numberOfLines={1}>
                    {eventDate.toLocaleDateString()} • {eventDate.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                  </Text>
                  <View style={styles.locationRow}>
                    <MapPin size={12} color={Colors.dark.textSecondary} />
                    <Text
                      style={[styles.eventLocation, { fontSize: scaleFont(13) }]}
                      numberOfLines={1}
                      adjustsFontSizeToFit
                      minimumFontScale={0.85}
                    >
                      {event.venues?.name || 'Ubicación desconocida'}
                      {distance !== null && ` • ${distance.toFixed(1)} km`}
                    </Text>
                  </View>
                </View>
                <View style={styles.eventStatus}>
                   <View style={styles.activeBadge}>
                      <Text style={[styles.activeText, { fontSize: scaleFont(12) }]} numberOfLines={1}>
                        ACTIVO
                      </Text>
                   </View>
                </View>
              </GlassView>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingBottom: 40,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 30,
  },
  welcomeText: {
    color: 'white',
    fontSize: 24,
    fontWeight: 'bold',
  },
  roleText: {
    color: Colors.dark.textSecondary,
    fontSize: 16,
  },
  logoutButton: {
    padding: 10,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 12,
  },
  statsContainer: {
    flexDirection: 'row',
    gap: 15,
    marginBottom: 30,
  },
  statCard: {
    flex: 1,
    padding: 18,
    borderRadius: 20,
    alignItems: 'center',
  },
  statValue: {
    color: 'white',
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 5,
  },
  statLabel: {
    color: Colors.dark.textSecondary,
    fontSize: 14,
  },
  sectionTitle: {
    color: 'white',
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 15,
  },
  actionsContainer: {
    flexDirection: 'row',
    gap: 15,
    marginBottom: 30,
  },
  actionButton: {
    flex: 1,
    height: 140,
    borderRadius: 20,
    overflow: 'hidden',
  },
  actionGradient: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  actionGlass: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  actionText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
    marginTop: 10,
    textAlign: 'center',
  },
  emptyState: {
    padding: 40,
    alignItems: 'center',
    borderRadius: 20,
  },
  emptyText: {
    color: Colors.dark.textSecondary,
    marginTop: 10,
    fontSize: 16,
  },
  emptySubtext: {
    color: Colors.dark.textSecondary,
    fontSize: 12,
    marginTop: 5,
  },
  eventCard: {
    padding: 20,
    borderRadius: 16,
    marginBottom: 15,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  eventInfo: {
    flex: 1,
  },
  eventTitle: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  eventDate: {
    color: Colors.dark.textSecondary,
    fontSize: 14,
    marginBottom: 4,
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  eventLocation: {
    color: Colors.dark.textSecondary,
    fontSize: 14,
  },
  eventStatus: {
    marginLeft: 10,
  },
  activeBadge: {
    backgroundColor: 'rgba(74, 222, 128, 0.2)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  activeText: {
    color: '#4ade80',
    fontSize: 12,
    fontWeight: 'bold',
  },
  eventsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 15,
    flexWrap: 'wrap',
  },
  filterContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginLeft: 10,
  },
  radiusScroll: {
    flexGrow: 0,
  },
  radiusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.1)',
    marginLeft: 5,
  },
  radiusBadgeActive: {
    backgroundColor: Colors.dark.primary,
  },
  radiusText: {
    color: Colors.dark.textSecondary,
    fontSize: 12,
  },
  radiusTextActive: {
    color: 'white',
    fontWeight: 'bold',
  },
});
