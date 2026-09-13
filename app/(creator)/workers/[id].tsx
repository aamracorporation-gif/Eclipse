import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, RefreshControl } from 'react-native';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { ChevronLeft, ScanLine, ShoppingBag, BarChart2, Calendar, Ticket, Mail, RefreshCw } from '@/lib/icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Colors } from '@/constants/Colors';
import { GlassView } from '@/components/ui/GlassView';
import { DiscoLoader } from '@/components/ui/DiscoLoader';
import { SafeAreaView } from 'react-native-safe-area-context';

interface ScanEntry {
  id: string;
  scanned_at: string;
  events: { title: string } | null;
}

interface SaleEntry {
  id: string;
  purchase_date: string;
  total_price: number;
  events: { title: string } | null;
  ticket_type: string | null;
}

export default function WorkerStatsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [worker, setWorker] = useState<any>(null);
  const [scans, setScans] = useState<ScanEntry[]>([]);
  const [sales, setSales] = useState<SaleEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<'scans' | 'sales'>('scans');
  const channelRef = useRef<any>(null);

  const safeBack = () => {
    const canGoBack = (router as any)?.canGoBack?.();
    if (canGoBack) router.back();
    else router.replace('/(creator)/workers');
  };

  const fetchData = useCallback(async (silent = false) => {
    if (!id) return;
    if (!silent) setLoading(true);
    try {
      const [workerRes, scansRes, salesRes] = await Promise.all([
        supabase.from('workers').select('*').eq('id', id).single(),
        supabase
          .from('tickets')
          .select('id, scanned_at, events(title)')
          .eq('scanned_by_worker_id', id)
          .order('scanned_at', { ascending: false })
          .limit(100),
        supabase
          .from('tickets')
          .select('id, purchase_date, total_price, ticket_type, events(title)')
          .eq('sold_by_worker_id', id)
          .order('purchase_date', { ascending: false })
          .limit(100),
      ]);

      if (workerRes.error) console.error('[worker-stats] worker query error:', workerRes.error);
      if (scansRes.error)  console.error('[worker-stats] scans query error:', scansRes.error);
      if (salesRes.error)  console.error('[worker-stats] sales query error:', salesRes.error);

      if (workerRes.data) setWorker(workerRes.data);
      setScans((scansRes.data as any[]) || []);
      setSales((salesRes.data as any[]) || []);
    } catch (err) {
      console.error('[worker-stats] unexpected error:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [id]);

  // Real-time subscription: re-fetch whenever a ticket changes for this worker
  useEffect(() => {
    if (!id) return;

    fetchData();

    channelRef.current = supabase
      .channel(`worker-stats-${id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'tickets',
          filter: `scanned_by_worker_id=eq.${id}`,
        },
        () => fetchData(true)
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'tickets',
          filter: `sold_by_worker_id=eq.${id}`,
        },
        () => fetchData(true)
      )
      .subscribe();

    return () => {
      if (channelRef.current) supabase.removeChannel(channelRef.current);
    };
  }, [id, fetchData]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchData(true);
  }, [fetchData]);

  const totalRevenue = sales.reduce((sum, s) => sum + Number(s.total_price || 0), 0);

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }) +
      '  ' + d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <View style={styles.container}>
      <LinearGradient colors={[Colors.dark.background, '#1e1b4b']} style={StyleSheet.absoluteFill} />
      <SafeAreaView style={styles.safe}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={safeBack} style={styles.backBtn}>
            <ChevronLeft size={24} color="white" />
          </TouchableOpacity>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {loading || !worker ? 'Estadísticas' : worker.name}
          </Text>
          <TouchableOpacity onPress={onRefresh} style={styles.backBtn} disabled={refreshing}>
            {refreshing
              ? <ActivityIndicator size="small" color="white" />
              : <RefreshCw size={18} color="white" />}
          </TouchableOpacity>
        </View>

        {loading ? (
          <View style={styles.loaderWrap}>
            <DiscoLoader size={90} />
          </View>
        ) : !worker ? (
          <View style={styles.loaderWrap}>
            <Text style={styles.errorText}>No se pudo cargar el trabajador.</Text>
          </View>
        ) : (
          <ScrollView
            contentContainerStyle={styles.scroll}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor="#7C3AED"
                colors={['#7C3AED']}
              />
            }
          >
            {/* Worker info card */}
            <GlassView intensity={14} style={styles.infoCard}>
              <View style={styles.infoRow}>
                <View style={[styles.avatar, { backgroundColor: worker.status === 'active' ? 'rgba(74,222,128,0.2)' : 'rgba(251,191,36,0.2)' }]}>
                  <Text style={styles.avatarText}>{(worker.name || '?')[0].toUpperCase()}</Text>
                </View>
                <View style={{ flex: 1, marginLeft: 14 }}>
                  <Text style={styles.workerName}>{worker.name}</Text>
                  <View style={styles.emailRow}>
                    <Mail size={13} color={Colors.dark.textSecondary} />
                    <Text style={styles.workerEmail}>{worker.email}</Text>
                  </View>
                  <View style={[styles.statusBadge, worker.status === 'active' ? styles.statusActive : styles.statusPending]}>
                    <Text style={styles.statusText}>{worker.status === 'active' ? 'Activo' : 'Pendiente'}</Text>
                  </View>
                </View>
              </View>
            </GlassView>

            {/* Live indicator */}
            <View style={styles.liveRow}>
              <View style={styles.liveDot} />
              <Text style={styles.liveText}>Actualizándose en tiempo real</Text>
            </View>

            {/* Stats summary row */}
            <View style={styles.statsRow}>
              <LinearGradient colors={['rgba(96,165,250,0.18)', 'rgba(96,165,250,0.06)']} style={styles.statCard}>
                <ScanLine size={22} color="#60a5fa" />
                <Text style={[styles.statValue, { color: '#60a5fa' }]}>{scans.length}</Text>
                <Text style={styles.statLabel}>Escaneos</Text>
              </LinearGradient>
              <LinearGradient colors={['rgba(251,191,36,0.18)', 'rgba(251,191,36,0.06)']} style={styles.statCard}>
                <ShoppingBag size={22} color="#fbbf24" />
                <Text style={[styles.statValue, { color: '#fbbf24' }]}>{sales.length}</Text>
                <Text style={styles.statLabel}>Ventas</Text>
              </LinearGradient>
              <LinearGradient colors={['rgba(167,139,250,0.18)', 'rgba(167,139,250,0.06)']} style={styles.statCard}>
                <BarChart2 size={22} color="#a78bfa" />
                <Text style={[styles.statValue, { color: '#a78bfa' }]}>{totalRevenue.toFixed(0)}€</Text>
                <Text style={styles.statLabel}>Recaudado</Text>
              </LinearGradient>
            </View>

            {/* Tab selector */}
            <View style={styles.tabBar}>
              <TouchableOpacity
                style={[styles.tab, activeTab === 'scans' && styles.tabActive]}
                onPress={() => setActiveTab('scans')}
                activeOpacity={0.8}
              >
                <ScanLine size={15} color={activeTab === 'scans' ? 'white' : Colors.dark.textSecondary} />
                <Text style={[styles.tabText, activeTab === 'scans' && styles.tabTextActive]}>
                  Escaneos ({scans.length})
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.tab, activeTab === 'sales' && styles.tabActive]}
                onPress={() => setActiveTab('sales')}
                activeOpacity={0.8}
              >
                <ShoppingBag size={15} color={activeTab === 'sales' ? 'white' : Colors.dark.textSecondary} />
                <Text style={[styles.tabText, activeTab === 'sales' && styles.tabTextActive]}>
                  Ventas ({sales.length})
                </Text>
              </TouchableOpacity>
            </View>

            {/* Activity list */}
            {activeTab === 'scans' ? (
              scans.length === 0 ? (
                <View style={styles.emptyState}>
                  <ScanLine size={36} color={Colors.dark.textSecondary} />
                  <Text style={styles.emptyText}>Sin escaneos registrados</Text>
                </View>
              ) : (
                scans.map((s) => (
                  <GlassView key={s.id} intensity={10} style={styles.row}>
                    <View style={styles.rowIcon}>
                      <ScanLine size={16} color="#60a5fa" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.rowTitle} numberOfLines={1}>
                        {(s.events as any)?.title || 'Evento desconocido'}
                      </Text>
                      <Text style={styles.rowDate}>{formatDate(s.scanned_at)}</Text>
                    </View>
                  </GlassView>
                ))
              )
            ) : (
              sales.length === 0 ? (
                <View style={styles.emptyState}>
                  <ShoppingBag size={36} color={Colors.dark.textSecondary} />
                  <Text style={styles.emptyText}>Sin ventas registradas</Text>
                </View>
              ) : (
                sales.map((s) => (
                  <GlassView key={s.id} intensity={10} style={styles.row}>
                    <View style={styles.rowIcon}>
                      <ShoppingBag size={16} color="#fbbf24" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.rowTitle} numberOfLines={1}>
                        {(s.events as any)?.title || 'Evento desconocido'}
                      </Text>
                      {s.ticket_type && (
                        <Text style={styles.rowSub} numberOfLines={1}>{s.ticket_type}</Text>
                      )}
                      <Text style={styles.rowDate}>{formatDate(s.purchase_date)}</Text>
                    </View>
                    <Text style={styles.rowPrice}>{Number(s.total_price || 0).toFixed(2)}€</Text>
                  </GlassView>
                ))
              )
            )}

            <View style={{ height: 32 }} />
          </ScrollView>
        )}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safe: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    color: 'white',
    fontSize: 20,
    fontWeight: 'bold',
    flex: 1,
    textAlign: 'center',
  },
  loaderWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  errorText: { color: Colors.dark.textSecondary, fontSize: 15 },
  scroll: { paddingHorizontal: 20, paddingBottom: 20 },

  infoCard: { borderRadius: 18, padding: 16, marginBottom: 12 },
  infoRow: { flexDirection: 'row', alignItems: 'center' },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: 'white', fontSize: 22, fontWeight: 'bold' },
  workerName: { color: 'white', fontSize: 17, fontWeight: '700', marginBottom: 4 },
  emailRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 8 },
  workerEmail: { color: Colors.dark.textSecondary, fontSize: 13 },
  statusBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 8,
  },
  statusActive: { backgroundColor: 'rgba(74,222,128,0.2)' },
  statusPending: { backgroundColor: 'rgba(251,191,36,0.2)' },
  statusText: { color: 'white', fontSize: 11, fontWeight: '700' },

  liveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 14,
  },
  liveDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#4ade80',
  },
  liveText: { color: 'rgba(74,222,128,0.8)', fontSize: 11, fontWeight: '600' },

  statsRow: { flexDirection: 'row', gap: 10, marginBottom: 20 },
  statCard: {
    flex: 1,
    borderRadius: 16,
    padding: 14,
    alignItems: 'center',
    gap: 6,
  },
  statValue: { fontSize: 22, fontWeight: '900' },
  statLabel: { color: Colors.dark.textSecondary, fontSize: 11, fontWeight: '600' },

  tabBar: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 14,
    padding: 4,
    marginBottom: 16,
    gap: 4,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 9,
    borderRadius: 10,
  },
  tabActive: { backgroundColor: 'rgba(124,58,237,0.5)' },
  tabText: { color: Colors.dark.textSecondary, fontSize: 13, fontWeight: '600' },
  tabTextActive: { color: 'white' },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    padding: 14,
    marginBottom: 8,
    gap: 12,
  },
  rowIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.07)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowTitle: { color: 'white', fontSize: 14, fontWeight: '600', marginBottom: 2 },
  rowSub: { color: Colors.dark.textSecondary, fontSize: 12, marginBottom: 2 },
  rowDate: { color: Colors.dark.textSecondary, fontSize: 11 },
  rowPrice: { color: '#fbbf24', fontSize: 15, fontWeight: '800' },

  emptyState: { alignItems: 'center', paddingVertical: 40, gap: 12 },
  emptyText: { color: Colors.dark.textSecondary, fontSize: 15 },
});
