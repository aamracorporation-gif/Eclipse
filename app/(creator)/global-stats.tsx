import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { ArrowLeft, DollarSign, Ticket, Users, TrendingUp } from '@/lib/icons';
import { useEvents } from '@/lib/EventContext';
import { useAuth } from '@/lib/AuthContext';
import { Colors } from '@/constants/Colors';
import { GlassView } from '@/components/ui/GlassView';
import { useResponsive } from '@/lib/responsive';

export default function GlobalStatsScreen() {
  const router = useRouter();
  const { events } = useEvents();
  const { user } = useAuth();
  const { horizontalPadding, maxContentWidth, isTablet, isDesktop } = useResponsive();

  const safeBack = () => {
    const canGoBack = (router as any)?.canGoBack?.();
    if (canGoBack) router.back();
    else router.replace('/(creator)');
  };
  
  const myEvents = events.filter(e => e.creatorId === user?.id);

  // Calculate global stats
  const totalRevenue = myEvents.reduce((acc, event) => {
    const ticketTypesRevenue = event.ticketTypes?.reduce((tAcc, ticket) => tAcc + (ticket.sold * ticket.price), 0) || 0;
    
    // Fallback if detailed tracking is 0 but global sold count is > 0
    if (ticketTypesRevenue === 0 && (event.sold || 0) > 0) {
        const price = parseFloat(event.price?.replace(',', '.') || '0');
        return acc + (event.sold * price);
    }
    
    return acc + ticketTypesRevenue;
  }, 0);

  const totalTicketsSold = myEvents.reduce((acc, event) => {
    const typesSold = event.ticketTypes?.reduce((tAcc, ticket) => tAcc + ticket.sold, 0) || 0;
    // Use the maximum of detailed vs global to avoid double counting or undercounting
    return acc + Math.max(typesSold, event.sold || 0);
  }, 0);

  const totalCapacity = myEvents.reduce((acc, event) => acc + (event.capacity || 0), 0);
  const occupancyRate = totalCapacity > 0 ? Math.round((totalTicketsSold / totalCapacity) * 100) : 0;
  
  const bestSellingEvent = [...myEvents].sort((a, b) => {
     const soldA = Math.max((a.ticketTypes?.reduce((acc, t) => acc + t.sold, 0) || 0), a.sold || 0);
     const soldB = Math.max((b.ticketTypes?.reduce((acc, t) => acc + t.sold, 0) || 0), b.sold || 0);
     return soldB - soldA;
  })[0];

  return (
    <View style={styles.container}>
      <LinearGradient colors={[Colors.dark.background, '#1e1b4b']} style={StyleSheet.absoluteFill} />
      
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <TouchableOpacity onPress={safeBack} style={styles.backButton}>
            <GlassView intensity={20} style={styles.backButtonContainer}>
              <ArrowLeft size={24} color={Colors.dark.text} />
            </GlassView>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Estadísticas Globales</Text>
        </View>
        
        <ScrollView
          contentContainerStyle={[
            styles.content,
            { paddingHorizontal: horizontalPadding, alignItems: 'center' },
          ]}
        >
          <View style={{ width: '100%', maxWidth: maxContentWidth }}>
          <View style={styles.statsGrid}>
            <GlassView
              intensity={15}
              style={[
                styles.statCard,
                (isTablet || isDesktop) && { width: '47%' },
              ]}
            >
              <View style={[styles.iconBg, { backgroundColor: 'rgba(16, 185, 129, 0.2)' }]}>
                 <DollarSign size={24} color={Colors.dark.success} />
              </View>
              <Text style={styles.statLabel}>Ingresos Totales</Text>
              <Text style={styles.statValue}>{totalRevenue}€</Text>
            </GlassView>
            
            <GlassView
              intensity={15}
              style={[
                styles.statCard,
                (isTablet || isDesktop) && { width: '47%' },
              ]}
            >
              <View style={[styles.iconBg, { backgroundColor: 'rgba(245, 158, 11, 0.2)' }]}>
                 <Ticket size={24} color="#F59E0B" />
              </View>
              <Text style={styles.statLabel}>Entradas Vendidas</Text>
              <Text style={styles.statValue}>{totalTicketsSold}</Text>
            </GlassView>
            
            <GlassView
              intensity={15}
              style={[
                styles.statCard,
                (isTablet || isDesktop) && { width: '47%' },
              ]}
            >
              <View style={[styles.iconBg, { backgroundColor: 'rgba(59, 130, 246, 0.2)' }]}>
                 <Users size={24} color={Colors.dark.secondary} />
              </View>
              <Text style={styles.statLabel}>Ocupación Media</Text>
              <Text style={styles.statValue}>{occupancyRate}%</Text>
            </GlassView>

             <GlassView
               intensity={15}
               style={[
                 styles.statCard,
                 (isTablet || isDesktop) && { width: '47%' },
               ]}
             >
              <View style={[styles.iconBg, { backgroundColor: 'rgba(139, 92, 246, 0.2)' }]}>
                 <TrendingUp size={24} color={Colors.dark.primary} />
              </View>
              <Text style={styles.statLabel}>Evento Top</Text>
              <Text style={[styles.statValue, {fontSize: 16}]}>
                  {bestSellingEvent?.title || '-'}
              </Text>
            </GlassView>
          </View>
          </View>

        </ScrollView>
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
    paddingHorizontal: 24,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  backButton: {
    borderRadius: 12,
    overflow: 'hidden',
  },
  backButtonContainer: {
    padding: 10,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: Colors.dark.text,
    fontFamily: 'RussoOne_400Regular',
  },
  content: {
    paddingVertical: 24,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
    marginBottom: 32,
  },
  statCard: {
    width: '100%',
    padding: 16,
    borderRadius: 24,
    minHeight: 140,
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  iconBg: {
    width: 48,
    height: 48,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  statLabel: {
    fontSize: 12,
    color: Colors.dark.textSecondary,
    marginBottom: 4,
  },
  statValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: Colors.dark.text,
    fontFamily: 'RussoOne_400Regular',
  },
});
