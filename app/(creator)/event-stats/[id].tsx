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
    totalRevenue: 0,
    totalUnitsSold: 0,
    totalCapacityUnits: 0,
    general: {
      unitsSold: 0,
      capacityUnits: 0,
      revenue: 0,
      types: [] as any[],
    },
    vip: {
      tablesSold: 0,
      capacityTables: 0,
      revenue: 0,
      types: [] as any[],
    },
  });

  useEffect(() => {
    if (!event?.id) return;

    // Initial fetch to ensure accuracy
    const fetchFreshStats = async () => {
      try {
        const [{ data: typesData, error: typesErr }, { data: ticketsData, error: ticketsErr }, { data: vipData, error: vipErr }] = await Promise.all([
          supabase
            .from('event_ticket_types')
            .select('id, name, price, quantity, is_active, deleted_at')
            .eq('event_id', event.id),
          supabase
            .from('tickets')
            .select('ticket_type_id, quantity, total_price, status, ticket_status, payment_transaction_id')
            .eq('event_id', event.id),
          supabase
            .from('reservados_vip')
            .select('id, name, base_price, capacity_people, quantity_available')
            .eq('event_id', event.id),
        ]);

        if (typesErr) throw typesErr;
        if (ticketsErr) throw ticketsErr;
        if (vipErr) throw vipErr;

        const types = (typesData || []).filter((t: any) => !t?.deleted_at && (t?.is_active ?? true));

        const tickets = (ticketsData || []) as any[];
        const validTickets = tickets.filter((t) => !(t?.status === 'cancelled' || t?.ticket_status === 'invalidated'));

        const parseQty = (value: any): number => {
          if (value == null) return 1;
          const n = Number(value);
          if (!Number.isFinite(n)) return 1;
          if (n <= 0) return 0;
          return n;
        };

        const parsePrice = (value: any): number => {
          if (value == null) return 0;
          if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
          const s = String(value).trim().replace(',', '.');
          const n = Number(s);
          return Number.isFinite(n) ? n : 0;
        };

        const vipOptions = (vipData || []) as any[];
        const vipById = new Map<string, any>(vipOptions.map((v) => [String(v.id), v]));
        const vipCandidates = vipOptions.map((v) => ({
          id: String(v.id),
          base: parsePrice(v?.base_price),
          cap: Math.max(1, Number(v?.capacity_people) || 1),
        }));
        const hasVip = vipOptions.length > 0;

        const paymentTxIds = Array.from(
          new Set(validTickets.map((r) => String(r?.payment_transaction_id || '')).filter((s) => s && s !== 'null' && s !== 'undefined'))
        );
        const paymentTxMap = new Map<string, any>();
        if (paymentTxIds.length) {
          const { data: txRows, error: txErr } = await supabase
            .from('payment_transactions')
            .select('id, kind, metadata')
            .in('id', paymentTxIds);
          if (txErr) throw txErr;
          for (const r of (txRows ?? []) as any[]) {
            const rid = String(r?.id || '');
            if (rid) paymentTxMap.set(rid, r);
          }
        }

        const totalRevenue = validTickets.reduce((acc, t) => acc + parsePrice(t?.total_price), 0);

        const soldByType = new Map<string, number>();
        const revenueByType = new Map<string, number>();
        let soldTypedUnits = 0;
        let revenueTyped = 0;

        let soldVipTables = 0;
        let soldVipPeople = 0;
        let revenueVip = 0;
        const vipSoldById = new Map<string, { soldTables: number; soldPeople: number; revenue: number }>();
        let vipUnmappedTables = 0;
        let vipUnmappedPeople = 0;
        let vipUnmappedRevenue = 0;

        let soldUntypedUnits = 0;
        let revenueUntyped = 0;

        for (const row of validTickets) {
          const tid = row?.ticket_type_id ? String(row.ticket_type_id) : null;
          const qty = parseQty(row?.quantity);
          const rowRevenue = parsePrice(row?.total_price);

          if (tid) {
            soldTypedUnits += qty;
            revenueTyped += rowRevenue;
            soldByType.set(tid, (soldByType.get(tid) || 0) + qty);
            revenueByType.set(tid, (revenueByType.get(tid) || 0) + rowRevenue);
            continue;
          }

          let vipId: string | null = null;
          const txId = String(row?.payment_transaction_id || '');
          const tx = txId ? paymentTxMap.get(txId) : null;
          const txKind = String(tx?.kind || '');
          const txMeta = (tx?.metadata ?? null) as any;

          if (hasVip && txKind === 'vip_table') {
            const metaVipId = String(txMeta?.vip_reservado_id || txMeta?.vipReservadoId || txMeta?.reference_id || txMeta?.referenceId || '');
            if (metaVipId && vipById.has(metaVipId)) vipId = metaVipId;
          }

          if (hasVip && !vipId) {
            const price = rowRevenue;
            const candidate = vipCandidates.find((c) => Math.abs(c.base - price) <= 0.01 && c.cap === Math.max(1, qty));
            if (candidate) vipId = candidate.id;
          }

          if (vipId) {
            soldVipTables += 1;
            soldVipPeople += qty;
            revenueVip += rowRevenue;
            const prev = vipSoldById.get(vipId) || { soldTables: 0, soldPeople: 0, revenue: 0 };
            prev.soldTables += 1;
            prev.soldPeople += qty;
            prev.revenue += rowRevenue;
            vipSoldById.set(vipId, prev);
          } else {
            soldUntypedUnits += qty;
            revenueUntyped += rowRevenue;
          }
        }

        const generalTypes = types.map((t: any) => ({
          id: t.id,
          name: t.name,
          price: parsePrice(t.price),
          quantity: Number(t.quantity) || 0,
          sold: soldByType.get(String(t.id)) || 0,
          revenue: revenueByType.get(String(t.id)) || 0,
        }));

        const baseEventUnitPrice = parsePrice(event?.price);
        const baseEventCapacity = (Number((event as any)?.capacity) || 0) + (Number((event as any)?.sold) || 0);

        if (!generalTypes.length && baseEventCapacity > 0) {
          generalTypes.push({
            id: 'general',
            name: 'General',
            price: baseEventUnitPrice,
            quantity: baseEventCapacity,
            sold: soldUntypedUnits,
            revenue: revenueUntyped,
          } as any);
        } else if (soldUntypedUnits > 0) {
          generalTypes.push({
            id: 'sin_tipo',
            name: 'Sin tipo',
            price: soldUntypedUnits > 0 ? revenueUntyped / soldUntypedUnits : baseEventUnitPrice,
            quantity: soldUntypedUnits,
            sold: soldUntypedUnits,
            revenue: revenueUntyped,
          } as any);
        }

        const vipTypes = vipOptions.map((v) => {
          const id = String(v.id);
          const agg = vipSoldById.get(id) || { soldTables: 0, soldPeople: 0, revenue: 0 };
          const available = Number(v?.quantity_available) || 0;
          const capacityTables = available + agg.soldTables;
          const basePrice = parsePrice(v?.base_price);
          return {
            id,
            name: String(v?.name || 'VIP'),
            basePrice,
            capacity_people: Math.max(1, Number(v?.capacity_people) || 1),
            soldTables: agg.soldTables,
            soldPeople: agg.soldPeople,
            revenue: agg.revenue,
            capacityTables,
          };
        });

        const mappedVipTables = vipTypes.reduce((acc, v) => acc + (Number(v.soldTables) || 0), 0);
        const mappedVipPeople = vipTypes.reduce((acc, v) => acc + (Number(v.soldPeople) || 0), 0);
        const mappedVipRevenue = vipTypes.reduce((acc, v) => acc + (Number(v.revenue) || 0), 0);
        vipUnmappedTables = Math.max(0, soldVipTables - mappedVipTables);
        vipUnmappedPeople = Math.max(0, soldVipPeople - mappedVipPeople);
        vipUnmappedRevenue = Math.max(0, revenueVip - mappedVipRevenue);
        if (hasVip && vipUnmappedTables > 0) {
          vipTypes.push({
            id: 'vip_unmapped',
            name: 'VIP (sin detalle)',
            basePrice: vipUnmappedTables > 0 ? vipUnmappedRevenue / vipUnmappedTables : 0,
            capacity_people: vipUnmappedTables > 0 ? Math.max(1, Math.round(vipUnmappedPeople / vipUnmappedTables)) : 1,
            soldTables: vipUnmappedTables,
            soldPeople: vipUnmappedPeople,
            revenue: vipUnmappedRevenue,
            capacityTables: vipUnmappedTables,
          } as any);
        }

        const generalCapacityUnits = generalTypes.reduce((acc: number, tt: any) => acc + (Number(tt.quantity) || 0), 0);
        const vipCapacityTables = vipTypes.reduce((acc: number, v: any) => acc + (Number(v.capacityTables) || 0), 0);
        const totalUnitsSold = soldTypedUnits + soldUntypedUnits + soldVipTables;
        const totalCapacityUnits = generalCapacityUnits + vipCapacityTables;

        setStats({
          totalRevenue,
          totalUnitsSold,
          totalCapacityUnits,
          general: {
            unitsSold: soldTypedUnits + soldUntypedUnits,
            capacityUnits: generalCapacityUnits,
            revenue: revenueTyped + revenueUntyped,
            types: generalTypes,
          },
          vip: {
            tablesSold: soldVipTables,
            capacityTables: vipCapacityTables,
            revenue: revenueVip,
            types: vipTypes,
          },
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
          event: '*',
          schema: 'public',
          table: 'reservados_vip',
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
  const totalRevenue = stats.totalRevenue;
  const totalCapacity = stats.totalCapacityUnits;
  const totalTicketsSold = stats.totalUnitsSold;
  
  const percentageSold = totalCapacity > 0 ? Math.round((totalTicketsSold / totalCapacity) * 100) : 0;

  const displayGeneralTypes = stats.general.types;
  const displayVipTypes = stats.vip.types;

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
              <Text style={styles.statLabel}>{t('creator.event_stats.tickets_sold', { defaultValue: 'Unidades vendidas' })}</Text>
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
               <Text style={styles.progressText}>{t('creator.event_stats.remaining', { count: Math.max(0, totalCapacity - totalTicketsSold), defaultValue: 'Restantes: {{count}}' })}</Text>
             </View>
          </GlassView>

          <Text style={[styles.sectionTitle, { fontSize: scaleFont(20) }]}>{t('creator.event_stats.breakdown_title', { defaultValue: 'Desglose de ventas' })}</Text>
          <Text style={styles.sectionSubtitle}>{t('creator.event_stats.breakdown_subtitle', { defaultValue: 'Entradas generales y VIP' })}</Text>

          <Text style={[styles.sectionTitle, { fontSize: scaleFont(16), marginTop: 10 }]}>{t('creator.event_stats.general', { defaultValue: 'Entradas generales' })}</Text>
          {displayGeneralTypes.map((ticket: any) => (
            <GlassView key={ticket.id} intensity={15} style={styles.ticketRow}>
              <View style={styles.ticketInfo}>
                <Text style={styles.ticketName}>{ticket.name}</Text>
                <Text style={styles.ticketPrice}>
                  {t('creator.event_stats.price_per_unit', { price: ticket.price, defaultValue: 'Precio: {{price}} €' })}
                </Text>
                <View style={styles.miniProgressBarContainer}>
                   <View style={[styles.miniProgressBar, { width: `${ticket.quantity > 0 ? Math.min((ticket.sold / ticket.quantity) * 100, 100) : 0}%`, backgroundColor: ticket.sold >= ticket.quantity && ticket.quantity > 0 ? Colors.dark.error : Colors.dark.success }]} />
                </View>
              </View>
              <View style={styles.ticketRight}>
                <Text style={styles.ticketSoldText}>{ticket.sold} / {ticket.quantity}</Text>
                <Text style={styles.ticketRevenueText}>
                    {new Intl.NumberFormat(localeTag, { style: 'currency', currency: 'EUR' }).format(Number(ticket.revenue) || 0)}
                </Text>
              </View>
            </GlassView>
          ))}

          {displayGeneralTypes.length === 0 && (
          <Text style={styles.noTicketsText}>No hay tipos de entradas definidos para este evento.</Text>
          )}

          {displayVipTypes.length > 0 && (
            <>
              <Text style={[styles.sectionTitle, { fontSize: scaleFont(16), marginTop: 18 }]}>{t('creator.event_stats.vip', { defaultValue: 'VIP' })}</Text>
              {displayVipTypes.map((vip: any) => (
                <GlassView key={vip.id} intensity={15} style={styles.ticketRow}>
                  <View style={styles.ticketInfo}>
                    <Text style={styles.ticketName}>{vip.name}</Text>
                    <Text style={styles.ticketPrice}>
                      {t('creator.event_stats.vip_price', { defaultValue: 'Precio: {{price}} € · {{cap}} personas', price: vip.basePrice, cap: vip.capacity_people })}
                    </Text>
                    <View style={styles.miniProgressBarContainer}>
                      <View
                        style={[
                          styles.miniProgressBar,
                          {
                            width: `${vip.capacityTables > 0 ? Math.min((vip.soldTables / vip.capacityTables) * 100, 100) : 0}%`,
                            backgroundColor: vip.soldTables >= vip.capacityTables && vip.capacityTables > 0 ? Colors.dark.error : Colors.dark.secondary,
                          },
                        ]}
                      />
                    </View>
                  </View>
                  <View style={styles.ticketRight}>
                    <Text style={styles.ticketSoldText}>{vip.soldTables} / {vip.capacityTables}</Text>
                    <Text style={styles.ticketRevenueText}>
                      {new Intl.NumberFormat(localeTag, { style: 'currency', currency: 'EUR' }).format(Number(vip.revenue) || 0)}
                    </Text>
                  </View>
                </GlassView>
              ))}
            </>
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
