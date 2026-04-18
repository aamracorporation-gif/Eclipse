import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { Colors } from '@/constants/Colors';
import { GlassView } from '@/components/ui/GlassView';
import { useEvents } from '@/lib/EventContext';
import { useAuth } from '@/lib/AuthContext';
import { useResponsive } from '@/lib/responsive';
import { supabase } from '@/lib/supabase';
import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowUpRight, ArrowDownRight, Download, Filter, LineChart, BarChart2, PieChart, Activity } from 'lucide-react-native';

type TimeFilter = 'today' | 'week' | 'month' | 'custom';

export default function OrganizerStatsScreen() {
  const router = useRouter();
  const { events } = useEvents();
  const { user } = useAuth();
  const { isTablet, isDesktop, isSmallPhone, horizontalPadding, maxContentWidth } = useResponsive();

  const safeBack = () => {
    const canGoBack = (router as any)?.canGoBack?.();
    if (canGoBack) router.back();
    else router.replace('/(creator)');
  };

  const myEvents = useMemo(() => events.filter((e) => e.creatorId === user?.id), [events, user?.id]);
  const myEventIdsKey = useMemo(() => myEvents.map((e) => e.id).filter(Boolean).sort().join('|'), [myEvents]);
  const myEventIds = useMemo(() => (myEventIdsKey ? myEventIdsKey.split('|') : []), [myEventIdsKey]);

  const [totals, setTotals] = useState<{ revenue: number; tickets: number }>({ revenue: 0, tickets: 0 });

  useEffect(() => {
    if (!user?.id) {
      setTotals({ revenue: 0, tickets: 0 });
      return;
    }

    let cancelled = false;
    (async () => {
      if (!myEventIds.length) {
        if (!cancelled) setTotals({ revenue: 0, tickets: 0 });
        return;
      }

      try {
        const { data, error } = await supabase
          .from('tickets')
          .select('total_price, quantity, event_id')
          .in('event_id', myEventIds);
        if (error) throw error;

        const rows = (data ?? []) as any[];
        const revenue = rows.reduce((acc, r) => acc + (Number(r.total_price) || 0), 0);
        const tickets = rows.reduce((acc, r) => acc + (Number(r.quantity) || 0), 0);
        if (!cancelled) setTotals({ revenue, tickets });
      } catch {
        if (!cancelled) setTotals({ revenue: 0, tickets: 0 });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [myEventIdsKey, user?.id]);

  const totalTicketsSold = totals.tickets;
  const totalRevenue = totals.revenue;
  const uniqueAttendees = totalTicketsSold;

  const StatChange = ({ value, positive }: { value: string; positive: boolean }) => (
    <View style={styles.changeRow}>
      {positive ? (
        <ArrowUpRight size={14} color={Colors.dark.success} />
      ) : (
        <ArrowDownRight size={14} color={Colors.dark.error} />
      )}
      <Text style={[styles.changeText, { color: positive ? Colors.dark.success : Colors.dark.error }]}>
        {value}
      </Text>
    </View>
  );

  const metricCols = isDesktop ? 4 : isTablet ? 2 : 1;
  const metricsGap = 20;
  const metricCardWidth = metricCols > 1 ? (maxContentWidth - metricsGap * (metricCols - 1)) / metricCols : undefined;

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={['#020617', '#0f172a', '#1e1b4b']}
        style={StyleSheet.absoluteFill}
      />

      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <TouchableOpacity onPress={safeBack} style={styles.backButton}>
            <GlassView intensity={20} style={styles.backButtonContainer}>
              <ArrowLeft size={22} color={Colors.dark.text} />
            </GlassView>
          </TouchableOpacity>
          <View style={styles.headerTextBlock}>
            <Text style={styles.headerTitle}>Estadísticas</Text>
            <Text style={styles.headerSubtitle}>Visión avanzada de tus eventos</Text>
          </View>
          <TouchableOpacity style={styles.exportButton} activeOpacity={0.8}>
            <GlassView intensity={20} style={styles.exportButtonInner}>
              <Download size={18} color={Colors.dark.text} />
              <Text style={styles.exportText}>Exportar PDF</Text>
            </GlassView>
          </TouchableOpacity>
        </View>

        <ScrollView
          contentContainerStyle={[
            styles.content,
            { paddingHorizontal: horizontalPadding, alignItems: 'center' },
          ]}
          showsVerticalScrollIndicator={false}
        >
          <View style={[styles.innerContent, { maxWidth: maxContentWidth, width: '100%' }]}>
          <View style={styles.filtersRow}>
            <GlassView intensity={18} style={styles.filterPill}>
              <Filter size={16} color={Colors.dark.textSecondary} />
              <Text style={styles.filterLabel}>Hoy</Text>
            </GlassView>
            <GlassView intensity={18} style={styles.filterPill}>
              <Text style={styles.filterLabel}>Semana</Text>
            </GlassView>
            <GlassView intensity={22} style={[styles.filterPill, styles.filterPillActive]}>
              <Text style={styles.filterLabelActive}>Mes</Text>
            </GlassView>
            <GlassView intensity={18} style={styles.filterPill}>
              <Text style={styles.filterLabel}>Personalizado</Text>
            </GlassView>
          </View>

          <GlassView intensity={22} style={styles.totalHero}>
            <LinearGradient
              colors={['rgba(255,255,255,0.08)', 'rgba(48, 209, 88, 0.16)', 'transparent']}
              style={StyleSheet.absoluteFill}
            />
            <Text style={styles.totalHeroLabel}>Total generado</Text>
            <Text style={styles.totalHeroValue} numberOfLines={1} adjustsFontSizeToFit>
              {new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(Number(totalRevenue) || 0)}
            </Text>
          </GlassView>

          <View style={styles.cardsGrid}>
            <GlassView
              intensity={22}
              style={[
                styles.metricCard,
                { width: '100%' },
              ]}
            >
              <Text style={styles.metricLabel}>Entradas vendidas</Text>
              <Text style={styles.metricValue}>{totalTicketsSold}</Text>
            </GlassView>

            <GlassView
              intensity={22}
              style={[
                styles.metricCard,
                { width: '100%' },
              ]}
            >
              <Text style={styles.metricLabel}>Eventos activos</Text>
              <Text style={styles.metricValue}>{myEvents.length}</Text>
            </GlassView>

            <GlassView
              intensity={22}
              style={[
                styles.metricCard,
                { width: '100%' },
              ]}
            >
              <Text style={styles.metricLabel}>Asistentes estimados</Text>
              <Text style={styles.metricValue}>{uniqueAttendees}</Text>
            </GlassView>
          </View>

          <View style={styles.sectionRow}>
            <GlassView
              intensity={18}
              style={[
                styles.chartCard,
                !isTablet && !isDesktop && { width: '100%' },
                (isTablet || isDesktop) && styles.chartCardLarge,
              ]}
            >
              <View style={styles.chartHeader}>
                <View style={styles.chartTitleRow}>
                  <LineChart size={18} color={Colors.dark.primary} />
                  <Text style={styles.chartTitle}>Evolución de Ventas</Text>
                </View>
                <Text style={styles.chartSubtitle}>Últimos 7 días · vs semana anterior</Text>
              </View>
              <View style={styles.lineChartMock}>
                <View style={styles.lineChartBackground}>
                  {Array.from({ length: 6 }).map((_, idx) => (
                    <View key={idx} style={styles.lineChartGridLine} />
                  ))}
                </View>
                <View style={styles.lineChartOverlay}>
                  <View style={[styles.lineDot, { left: '5%', bottom: '20%' }]} />
                  <View style={[styles.lineDot, { left: '20%', bottom: '35%' }]} />
                  <View style={[styles.lineDot, { left: '40%', bottom: '65%' }]} />
                  <View style={[styles.lineDot, { left: '60%', bottom: '45%' }]} />
                  <View style={[styles.lineDot, { left: '80%', bottom: '80%' }]} />
                </View>
              </View>
            </GlassView>

            <GlassView
              intensity={18}
              style={[
                styles.chartCard,
                !isTablet && !isDesktop && { width: '100%' },
                (isTablet || isDesktop) && styles.chartCardSmall,
              ]}
            >
              <View style={styles.chartHeader}>
                <View style={styles.chartTitleRow}>
                  <BarChart2 size={18} color={Colors.dark.secondary} />
                  <Text style={styles.chartTitle}>Ventas por Evento</Text>
                </View>
                <Text style={styles.chartSubtitle}>Top eventos</Text>
              </View>
              <View style={styles.barChartMock}>
                {myEvents.slice(0, 4).map((event, index) => {
                  const sold = Math.max(
                    event.ticketTypes?.reduce((acc, t) => acc + t.sold, 0) || 0,
                    event.sold || 0
                  );
                  const widthPercent = totalTicketsSold > 0 ? (sold / totalTicketsSold) * 100 : 0;
                  return (
                    <View key={event.id || index} style={styles.barRow}>
                      <Text numberOfLines={1} style={styles.barLabel}>{event.title}</Text>
                      <View style={styles.barBackground}>
                        <View style={[styles.barFill, { width: `${widthPercent}%` }]} />
                      </View>
                      <Text style={styles.barValue}>{sold}</Text>
                    </View>
                  );
                })}
              </View>
            </GlassView>
          </View>

          <View style={styles.sectionRow}>
            <GlassView
              intensity={18}
              style={[
                styles.chartCard,
                !isTablet && !isDesktop && { width: '100%' },
                (isTablet || isDesktop) && styles.chartCardSmall,
              ]}
            >
              <View style={styles.chartHeader}>
                <View style={styles.chartTitleRow}>
                  <PieChart size={18} color="#f97316" />
                  <Text style={styles.chartTitle}>Ingresos por Tipo</Text>
                </View>
                <Text style={styles.chartSubtitle}>VIP / General / Early</Text>
              </View>
              <View
                style={[
                  styles.donutContainer,
                  isSmallPhone && { flexDirection: 'column', alignItems: 'flex-start' },
                ]}
              >
                <View style={styles.donutOuter}>
                  <View style={styles.donutInner} />
                </View>
                <View style={styles.donutLegend}>
                  <View style={styles.legendRow}>
                    <View style={[styles.legendDot, { backgroundColor: '#a855f7' }]} />
                    <Text style={styles.legendLabel}>VIP</Text>
                    <Text style={styles.legendValue}>38%</Text>
                  </View>
                  <View style={styles.legendRow}>
                    <View style={[styles.legendDot, { backgroundColor: '#22c55e' }]} />
                    <Text style={styles.legendLabel}>General</Text>
                    <Text style={styles.legendValue}>44%</Text>
                  </View>
                  <View style={styles.legendRow}>
                    <View style={[styles.legendDot, { backgroundColor: '#f97316' }]} />
                    <Text style={styles.legendLabel}>Early</Text>
                    <Text style={styles.legendValue}>18%</Text>
                  </View>
                </View>
              </View>
            </GlassView>

            <GlassView
              intensity={18}
              style={[
                styles.chartCard,
                !isTablet && !isDesktop && { width: '100%' },
                (isTablet || isDesktop) && styles.chartCardLarge,
              ]}
            >
              <View style={styles.chartHeader}>
                <View style={styles.chartTitleRow}>
                  <Activity size={18} color="#22c55e" />
                  <Text style={styles.chartTitle}>Stats Avanzadas</Text>
                </View>
                <Text style={styles.chartSubtitle}>Visión PRO de tu audiencia</Text>
              </View>

              <View style={styles.advancedGrid}>
                <View style={styles.advancedItem}>
                  <Text style={styles.advancedLabel}>Eventos totales</Text>
                  <Text style={styles.advancedValue}>{myEvents.length}</Text>
                </View>
                <View style={styles.advancedItem}>
                  <Text style={styles.advancedLabel}>Capacidad total</Text>
                  <Text style={styles.advancedValue}>
                    {myEvents.reduce((acc, e) => acc + (e.capacity || 0), 0)}
                  </Text>
                </View>
                <View style={styles.advancedItem}>
                  <Text style={styles.advancedLabel}>Ocupación media</Text>
                  <Text style={styles.advancedValue}>
                    {myEvents.length
                      ? Math.round(
                          myEvents.reduce((acc, e) => acc + ((e.sold || 0) / (e.capacity || 1)), 0) /
                            myEvents.length *
                            100
                        )
                      : 0}
                    %
                  </Text>
                </View>
              </View>
            </GlassView>
          </View>

          <View style={styles.footerSpacer} />
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
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 4,
    paddingBottom: 12,
  },
  backButton: {
    borderRadius: 12,
    overflow: 'hidden',
  },
  backButtonContainer: {
    padding: 8,
    backgroundColor: 'rgba(15,23,42,0.6)',
  },
  headerTextBlock: {
    flex: 1,
    marginLeft: 12,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: Colors.dark.text,
    fontFamily: 'RussoOne_400Regular',
  },
  headerSubtitle: {
    fontSize: 12,
    color: Colors.dark.textSecondary,
  },
  exportButton: {
    marginLeft: 8,
  },
  exportButtonInner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
  },
  exportText: {
    marginLeft: 6,
    fontSize: 12,
    color: Colors.dark.text,
  },
  content: {
    paddingHorizontal: 20,
    paddingBottom: 40,
    paddingTop: 12,
    gap: 20,
  },
  innerContent: {
    width: '100%',
  },
  filtersRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 10,
  },
  filterPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(15,23,42,0.6)',
  },
  filterPillActive: {
    borderWidth: 1,
    borderColor: Colors.dark.primary,
  },
  filterLabel: {
    fontSize: 12,
    color: Colors.dark.textSecondary,
    marginLeft: 6,
  },
  filterLabelActive: {
    fontSize: 12,
    color: Colors.dark.text,
  },
  cardsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 20,
  },
  cardsGridTablet: {
    justifyContent: 'space-between',
  },
  metricCard: {
    padding: 16,
    borderRadius: 12,
    backgroundColor: 'rgba(15,23,42,0.7)',
  },
  metricLabel: {
    fontSize: 12,
    color: Colors.dark.textSecondary,
    marginBottom: 6,
  },
  metricValue: {
    fontSize: 22,
    color: Colors.dark.text,
    fontWeight: 'bold',
    marginBottom: 8,
    fontFamily: 'RussoOne_400Regular',
  },
  totalHero: {
    padding: 20,
    borderRadius: 30,
    overflow: 'hidden',
    backgroundColor: 'rgba(15,23,42,0.62)',
    marginTop: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.25,
    shadowRadius: 22,
    elevation: 12,
  },
  totalHeroLabel: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.6,
    color: 'rgba(255,255,255,0.65)',
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  totalHeroValue: {
    fontSize: 34,
    fontFamily: 'RussoOne_400Regular',
    color: Colors.dark.text,
  },
  totalHeroRow: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  totalHeroHint: {
    fontSize: 12,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.45)',
  },
  changeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  changeText: {
    fontSize: 12,
  },
  sectionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 14,
  },
  chartCard: {
    flex: 1,
    minHeight: 180,
    padding: 16,
    borderRadius: 20,
    backgroundColor: 'rgba(15,23,42,0.7)',
  },
  chartCardLarge: {
    minWidth: '58%',
  },
  chartCardSmall: {
    minWidth: '38%',
  },
  chartHeader: {
    marginBottom: 12,
  },
  chartTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 2,
  },
  chartTitle: {
    fontSize: 14,
    color: Colors.dark.text,
    fontWeight: '600',
  },
  chartSubtitle: {
    fontSize: 11,
    color: Colors.dark.textSecondary,
  },
  lineChartMock: {
    marginTop: 8,
    height: 120,
    borderRadius: 16,
    overflow: 'hidden',
  },
  lineChartBackground: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'space-between',
  },
  lineChartGridLine: {
    height: 1,
    backgroundColor: 'rgba(148,163,184,0.15)',
  },
  lineChartOverlay: {
    flex: 1,
  },
  lineDot: {
    position: 'absolute',
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.dark.primary,
  },
  barChartMock: {
    marginTop: 8,
    gap: 8,
  },
  barRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  barLabel: {
    flex: 1,
    fontSize: 11,
    color: Colors.dark.textSecondary,
  },
  barBackground: {
    flex: 2,
    height: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(15,23,42,0.9)',
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: Colors.dark.primary,
  },
  barValue: {
    width: 32,
    fontSize: 11,
    color: Colors.dark.text,
    textAlign: 'right',
  },
  donutContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    gap: 16,
  },
  donutOuter: {
    width: 96,
    height: 96,
    borderRadius: 48,
    borderWidth: 10,
    borderColor: '#a855f7',
    justifyContent: 'center',
    alignItems: 'center',
  },
  donutInner: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'rgba(15,23,42,0.9)',
  },
  donutLegend: {
    flex: 1,
    gap: 6,
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 8,
  },
  legendLabel: {
    flex: 1,
    fontSize: 11,
    color: Colors.dark.textSecondary,
  },
  legendValue: {
    fontSize: 11,
    color: Colors.dark.text,
    fontWeight: '600',
  },
  advancedGrid: {
    marginTop: 8,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  advancedItem: {
    width: '100%',
    padding: 10,
    borderRadius: 12,
    backgroundColor: 'rgba(15,23,42,0.9)',
  },
  advancedItemHalf: {
    width: '48%',
  },
  advancedLabel: {
    fontSize: 11,
    color: Colors.dark.textSecondary,
    marginBottom: 4,
  },
  advancedValue: {
    fontSize: 13,
    color: Colors.dark.text,
    fontWeight: '600',
  },
  curiositiesCard: {
    marginTop: 4,
    padding: 16,
    borderRadius: 22,
    backgroundColor: 'rgba(24,24,46,0.9)',
  },
  curiositiesHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  curiositiesTitle: {
    fontSize: 14,
    color: Colors.dark.text,
    fontWeight: '600',
  },
  curiositiesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  curiosityItem: {
    width: '100%',
    padding: 10,
    borderRadius: 12,
    backgroundColor: 'rgba(15,23,42,0.9)',
  },
  curiosityLabel: {
    fontSize: 11,
    color: Colors.dark.textSecondary,
    marginBottom: 4,
  },
  curiosityValue: {
    fontSize: 14,
    color: Colors.dark.text,
    fontWeight: '600',
  },
  footerSpacer: {
    height: 32,
  },
});
