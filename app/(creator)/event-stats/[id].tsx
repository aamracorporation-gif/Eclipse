import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { ArrowLeft, DollarSign, Ticket } from '@/lib/icons';
import { useEvents } from '@/lib/EventContext';
import { useState, useEffect } from 'react';
import { Colors } from '@/constants/Colors';
import { GlassView } from '@/components/ui/GlassView';
import { ThemedButton } from '@/components/ui/ThemedButton';
import { useResponsive } from '@/lib/responsive';
import { supabase } from '@/lib/supabase';
import { useTranslation } from 'react-i18next';
import { useI18n } from '@/lib/I18nContext';

export default function EventStatsScreen() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const { getEventById } = useEvents();
  const event = getEventById(id as string);
  const { horizontalPadding, maxContentWidth, scaleFont } = useResponsive();
  const { t } = useTranslation();
  const { language } = useI18n();
  const localeTag = language === 'en' ? 'en-US' : language === 'fr' ? 'fr-FR' : 'es-ES';

  const safeBack = () => {
    const canGoBack = (router as any)?.canGoBack?.();
    if (canGoBack) router.back();
    else router.replace('/(creator)');
  };

  const [stats, setStats] = useState({
    sold: event?.sold || 0,
    revenue: 0,
    ticketTypes: event?.ticketTypes || []
  });

  useEffect(() => {
    if (!event?.id) return;

    // Initial fetch to ensure accuracy
    const fetchFreshStats = async () => {
      try {
        const [{ data: typesData, error: typesErr }, { data: ticketsData, error: ticketsErr }] = await Promise.all([
          supabase
            .from('event_ticket_types')
            .select('id, name, price, quantity, is_active, deleted_at')
            .eq('event_id', event.id),
          supabase
            .from('tickets')
            .select('ticket_type_id, quantity, total_price, status, ticket_status')
            .eq('event_id', event.id),
        ]);

        if (typesErr) throw typesErr;
        if (ticketsErr) throw ticketsErr;

        const types = (typesData || []).filter((t: any) => !t?.deleted_at && (t?.is_active ?? true));

        const tickets = (ticketsData || []) as any[];
        const validTickets = tickets.filter((t) => !(t?.status === 'cancelled' || t?.ticket_status === 'invalidated'));
        const totalSoldUnits = validTickets.reduce((acc, t) => acc + (Number(t?.quantity) || 1), 0);
        const totalRevenue = validTickets.reduce((acc, t) => acc + (Number(t?.total_price) || 0), 0);

        const soldByType = new Map<string, number>();
        for (const row of validTickets) {
          const tid = row?.ticket_type_id ? String(row.ticket_type_id) : null;
          if (!tid) continue;
          soldByType.set(tid, (soldByType.get(tid) || 0) + (Number(row?.quantity) || 1));
        }

        setStats({
          sold: totalSoldUnits,
          revenue: totalRevenue,
          ticketTypes: types.map((t: any) => ({
            id: t.id,
            name: t.name,
            price: Number(t.price) || 0,
            quantity: Number(t.quantity) || 0,
            sold: soldByType.get(String(t.id)) || 0,
          })),
        });
      } catch (e) {
        console.error("Error fetching stats:", e);
      }
    };

    fetchFreshStats();

    // Subscribe to changes
    const subscription = supabase
      .channel(`event_stats_realtime_${event.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'tickets',
          filter: `event_id=eq.${event.id}`,
        },
        (payload) => {
            // On any ticket change, re-fetch stats to be 100% accurate
            // We could increment locally but re-fetching ensures consistency with DB triggers
            fetchFreshStats();
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'event_ticket_types',
          filter: `event_id=eq.${event.id}`,
        },
        () => fetchFreshStats()
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'events',
          filter: `id=eq.${event.id}`,
        },
        () => fetchFreshStats()
      )
      .subscribe();

    return () => {
      subscription.unsubscribe();
    };
  }, [event?.id]);

  if (!event) {
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
          </View>
          <View style={styles.centerContent}>
            <Text style={styles.errorText}>Evento no encontrado</Text>
            <ThemedButton title="Volver" onPress={safeBack} style={{ marginTop: 20 }} />
          </View>
        </SafeAreaView>
      </View>
    );
  }

  // Use stats from state
  const totalRevenue = stats.revenue;
  const totalCapacity = stats.ticketTypes.reduce((acc, t: any) => acc + (Number(t.quantity) || 0), 0);
  const totalTicketsSold = stats.sold; // Use DB source of truth
  
  const percentageSold = totalCapacity > 0 ? Math.round((totalTicketsSold / totalCapacity) * 100) : 0;

  const displayTicketTypes = stats.ticketTypes;

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
          <Text style={styles.headerTitle}>Estadísticas</Text>
        </View>
        
        <ScrollView contentContainerStyle={[styles.content, { paddingHorizontal: horizontalPadding, alignItems: 'center' }]}>
          <View style={{ width: '100%', maxWidth: maxContentWidth }}>
          <View style={styles.eventInfo}>
            <Text style={styles.eventTitle}>{event.title}</Text>
            <Text style={styles.eventDate}>{event.date} • {event.location}</Text>
          </View>
          
          <View style={styles.statsGrid}>
            <GlassView intensity={15} style={styles.statCard}>
              <View style={[styles.iconBg, { backgroundColor: 'rgba(16, 185, 129, 0.2)' }]}>
                 <DollarSign size={24} color={Colors.dark.success} />
              </View>
              <Text style={styles.statLabel}>Ingresos Totales</Text>
              <Text style={styles.statValue}>
                {new Intl.NumberFormat(localeTag, { style: 'currency', currency: 'EUR' }).format(totalRevenue)}
              </Text>
            </GlassView>
            
            <GlassView intensity={15} style={styles.statCard}>
              <View style={[styles.iconBg, { backgroundColor: 'rgba(245, 158, 11, 0.2)' }]}>
                 <Ticket size={24} color="#F59E0B" />
              </View>
              <Text style={styles.statLabel}>{t('creator.event_stats.tickets_sold')}</Text>
              <Text style={styles.statValue}>{totalTicketsSold} / {totalCapacity}</Text>
            </GlassView>
          </View>

          <GlassView intensity={10} style={styles.progressBarCard}>
             <View style={styles.progressBarContainer}>
               <LinearGradient
                 colors={[Colors.dark.primary, Colors.dark.secondary]}
                 start={{ x: 0, y: 0 }}
                 end={{ x: 1, y: 0 }}
                 style={[styles.progressBar, { width: `${percentageSold}%` }]} 
               />
             </View>
             <View style={styles.progressLabels}>
               <Text style={styles.progressText}>{t('creator.event_stats.percent_sold', { percent: percentageSold })}</Text>
               <Text style={styles.progressText}>{t('creator.event_stats.remaining', { count: totalCapacity - totalTicketsSold })}</Text>
             </View>
          </GlassView>

          <Text style={[styles.sectionTitle, { fontSize: scaleFont(20) }]}>{t('creator.event_stats.breakdown_title')}</Text>
          <Text style={styles.sectionSubtitle}>{t('creator.event_stats.breakdown_subtitle')}</Text>

          {displayTicketTypes.map(ticket => (
            <GlassView key={ticket.id} intensity={15} style={styles.ticketRow}>
              <View style={styles.ticketInfo}>
                <Text style={styles.ticketName}>{ticket.name}</Text>
                <Text style={styles.ticketPrice}>{t('creator.event_stats.price_per_unit', { price: ticket.price })}</Text>
                <View style={styles.miniProgressBarContainer}>
                   <View style={[styles.miniProgressBar, { width: `${Math.min((ticket.sold / ticket.quantity) * 100, 100)}%`, backgroundColor: ticket.sold >= ticket.quantity ? Colors.dark.error : Colors.dark.success }]} />
                </View>
              </View>
              <View style={styles.ticketRight}>
                <Text style={styles.ticketSoldText}>{ticket.sold} / {ticket.quantity}</Text>
                <Text style={styles.ticketRevenueText}>
                    {new Intl.NumberFormat(localeTag, { style: 'currency', currency: 'EUR' }).format((Number(ticket.sold) || 0) * (Number(ticket.price) || 0))}
                </Text>
              </View>
            </GlassView>
          ))}

          {displayTicketTypes.length === 0 && (
          <Text style={styles.noTicketsText}>No hay tipos de entradas definidos para este evento.</Text>
          )}
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
  centerContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorText: {
    color: Colors.dark.text,
    fontSize: 18,
    fontFamily: 'RussoOne_400Regular',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 24,
    paddingBottom: 12,
  },
  headerTitle: {
    fontSize: 24,
    color: Colors.dark.text,
    fontFamily: 'RussoOne_400Regular',
    marginLeft: 16,
  },
  backButton: {
    // marginRight: 16,
  },
  backButtonContainer: {
    padding: 8,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderWidth: 0,
  },
  content: {
    padding: 24,
    paddingBottom: 100,
  },
  eventInfo: {
    marginBottom: 24,
  },
  eventTitle: {
    fontSize: 28,
    color: Colors.dark.text,
    fontFamily: 'RussoOne_400Regular',
    marginBottom: 4,
  },
  eventDate: {
    fontSize: 14,
    color: Colors.dark.textSecondary,
  },
  statsGrid: {
    flexDirection: 'row',
    gap: 16,
    marginBottom: 16,
  },
  statCard: {
    flex: 1,
    padding: 16,
    borderRadius: 16,
    alignItems: 'flex-start',
  },
  iconBg: {
    padding: 8,
    borderRadius: 12,
    marginBottom: 12,
  },
  statLabel: {
    fontSize: 12,
    color: Colors.dark.textSecondary,
    marginBottom: 4,
  },
  statValue: {
    fontSize: 20,
    color: Colors.dark.text,
    fontFamily: 'RussoOne_400Regular',
  },
  progressBarCard: {
    padding: 20,
    borderRadius: 16,
    marginBottom: 32,
  },
  progressBarContainer: {
    height: 8,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 4,
    marginBottom: 8,
    overflow: 'hidden',
  },
  progressBar: {
    height: '100%',
    borderRadius: 4,
  },
  progressLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  progressText: {
    fontSize: 12,
    color: Colors.dark.textSecondary,
  },
  sectionTitle: {
    fontSize: 20,
    color: Colors.dark.text,
    fontFamily: 'RussoOne_400Regular',
    marginBottom: 4,
  },
  sectionSubtitle: {
    fontSize: 14,
    color: Colors.dark.textSecondary,
    marginBottom: 16,
  },
  ticketRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderRadius: 16,
    marginBottom: 12,
  },
  ticketInfo: {
    flex: 1,
    marginRight: 16,
  },
  ticketName: {
    fontSize: 16,
    color: Colors.dark.text,
    fontFamily: 'RussoOne_400Regular',
    marginBottom: 4,
  },
  ticketPrice: {
    fontSize: 14,
    color: Colors.dark.textSecondary,
    marginBottom: 8,
  },
  miniProgressBarContainer: {
    height: 4,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 2,
    overflow: 'hidden',
  },
  miniProgressBar: {
    height: '100%',
    borderRadius: 2,
  },
  ticketRight: {
    alignItems: 'flex-end',
  },
  ticketSoldText: {
    fontSize: 14,
    color: Colors.dark.text,
    fontFamily: 'RussoOne_400Regular',
    marginBottom: 2,
  },
  ticketRevenueText: {
    fontSize: 12,
    color: Colors.dark.success,
    marginBottom: 8,
  },
  simulateBtn: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  disabledBtn: {
    opacity: 0.5,
  },
  simulateText: {
    color: Colors.dark.text,
    fontSize: 12,
    fontFamily: 'RussoOne_400Regular',
  },
  noTicketsText: {
    color: Colors.dark.textSecondary,
    textAlign: 'center',
    marginTop: 20,
  }
});
