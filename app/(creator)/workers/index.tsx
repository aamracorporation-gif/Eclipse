import { View, Text, StyleSheet, FlatList, TouchableOpacity, Alert, RefreshControl } from 'react-native';
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'expo-router';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/lib/supabase';
import { Users, Plus, ChevronLeft, Trash2, BarChart2, ScanLine, ShoppingBag } from '@/lib/icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Colors } from '@/constants/Colors';
import { GlassView } from '@/components/ui/GlassView';
import { ThemedButton } from '@/components/ui/ThemedButton';
import { DiscoLoader } from '@/components/ui/DiscoLoader';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

export default function ManageWorkers() {
  const { user } = useAuth();
  const router = useRouter();
  const { t } = useTranslation();
  const [workers, setWorkers] = useState<any[]>([]);
  const [scanCounts, setScanCounts] = useState<Record<string, number>>({});
  const [saleCounts, setSaleCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const safeBack = () => {
    const canGoBack = (router as any)?.canGoBack?.();
    if (canGoBack) router.back();
    else router.replace('/(creator)');
  };

  const fetchWorkers = useCallback(async (silent = false) => {
    if (!user) return;
    try {
      if (!silent) setLoading(true);
      const { data, error } = await supabase
        .from('workers')
        .select('*')
        .eq('organizer_id', user.id)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Workers fetch error:', error.code, error.message);
        setWorkers([]);
        return;
      }
      const list = data || [];
      setWorkers(list);

      // Fetch scan + sale counts for all workers in parallel
      if (list.length > 0) {
        const ids = list.map((w: any) => w.id);
        const [scansRes, salesRes] = await Promise.all([
          supabase
            .from('tickets')
            .select('scanned_by_worker_id')
            .in('scanned_by_worker_id', ids),
          supabase
            .from('tickets')
            .select('sold_by_worker_id')
            .in('sold_by_worker_id', ids)
            .eq('payment_status', 'paid'),
        ]);
        const scans: Record<string, number> = {};
        const sales: Record<string, number> = {};
        (scansRes.data || []).forEach((r: any) => {
          if (r.scanned_by_worker_id) scans[r.scanned_by_worker_id] = (scans[r.scanned_by_worker_id] || 0) + 1;
        });
        (salesRes.data || []).forEach((r: any) => {
          if (r.sold_by_worker_id) sales[r.sold_by_worker_id] = (sales[r.sold_by_worker_id] || 0) + 1;
        });
        setScanCounts(scans);
        setSaleCounts(sales);
      }
    } catch (error) {
      console.error('Error fetching workers:', error);
      setWorkers([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user]);

  useEffect(() => {
    fetchWorkers();
  }, [fetchWorkers]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchWorkers(true);
  }, [fetchWorkers]);

  const handleDeleteWorker = (id: string, name: string) => {
    Alert.alert(
      t('creator.workers.delete_title'),
      t('creator.workers.delete_body', { name }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('profile.delete_account_confirm'),
          style: 'destructive',
          onPress: async () => {
            try {
              const { error } = await supabase.from('workers').delete().eq('id', id);
              if (error) throw error;
              fetchWorkers();
            } catch {
              Alert.alert(t('common.error'), t('creator.workers.delete_failed'));
            }
          },
        },
      ]
    );
  };

  const permissionTags = (permissions: any) => {
    if (!permissions) return [];
    const tags: { label: string; icon: string; color: string }[] = [];
    if (permissions.scan)  tags.push({ label: 'Scan',  icon: '🔍', color: 'rgba(59,130,246,0.22)' });
    if (permissions.sell)  tags.push({ label: 'Venta', icon: '💰', color: 'rgba(245,158,11,0.22)' });
    if (permissions.stats) tags.push({ label: 'Stats', icon: '📊', color: 'rgba(139,92,246,0.22)' });
    return tags;
  };

  const renderWorker = ({ item }: { item: any }) => {
    const tags = permissionTags(item.permissions);
    const scans = scanCounts[item.id] || 0;
    const sales = saleCounts[item.id] || 0;

    return (
      <GlassView intensity={15} style={styles.workerCard}>
        {/* Top row: name + delete */}
        <View style={styles.cardHeader}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{(item.name || '?')[0].toUpperCase()}</Text>
          </View>
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={styles.workerName}>{item.name}</Text>
            <Text style={styles.workerEmail}>{item.email}</Text>
          </View>
          <TouchableOpacity
            onPress={() => handleDeleteWorker(item.id, item.name)}
            style={styles.deleteButton}
          >
            <Trash2 size={18} color="#ef4444" />
          </TouchableOpacity>
        </View>

        {/* Mini stats row */}
        <View style={styles.miniStatsRow}>
          <View style={styles.miniStat}>
            <ScanLine size={13} color="#60a5fa" />
            <Text style={[styles.miniStatVal, { color: '#60a5fa' }]}>{scans}</Text>
            <Text style={styles.miniStatLabel}>escaneos</Text>
          </View>
          <View style={styles.miniStatDivider} />
          <View style={styles.miniStat}>
            <ShoppingBag size={13} color="#fbbf24" />
            <Text style={[styles.miniStatVal, { color: '#fbbf24' }]}>{sales}</Text>
            <Text style={styles.miniStatLabel}>ventas</Text>
          </View>
        </View>

        {/* Permission tags + status */}
        <View style={styles.tagsRow}>
          {tags.map(tag => (
            <View key={tag.label} style={[styles.permTag, { backgroundColor: tag.color }]}>
              <Text style={styles.permTagText}>{tag.icon} {tag.label}</Text>
            </View>
          ))}
          <View style={[styles.statusBadge, item.status === 'active' ? styles.statusActive : styles.statusPending]}>
            <Text style={styles.statusText}>
              {item.status === 'active'
                ? t('creator.workers.status_active')
                : t('creator.workers.status_pending')}
            </Text>
          </View>
        </View>

        {/* Footer: date + stats button */}
        <View style={styles.cardFooter}>
          <Text style={styles.dateText}>
            Añadido: {new Date(item.created_at).toLocaleDateString('es-ES')}
          </Text>
          <TouchableOpacity
            style={styles.statsBtn}
            onPress={() => router.push(`/(creator)/workers/${item.id}` as any)}
            activeOpacity={0.8}
          >
            <BarChart2 size={14} color="white" />
            <Text style={styles.statsBtnText}>Ver estadísticas</Text>
          </TouchableOpacity>
        </View>
      </GlassView>
    );
  };

  return (
    <View style={styles.container}>
      <LinearGradient colors={[Colors.dark.background, '#1e1b4b']} style={StyleSheet.absoluteFill} />
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <TouchableOpacity onPress={safeBack} style={styles.backButton}>
            <ChevronLeft size={24} color="white" />
          </TouchableOpacity>
          <Text style={styles.title}>{t('creator.workers.manage_title')}</Text>
          <View style={{ width: 40 }} />
        </View>

        {loading ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <DiscoLoader size={90} />
          </View>
        ) : (
          <FlatList
            data={workers}
            renderItem={renderWorker}
            keyExtractor={item => item.id}
            contentContainerStyle={styles.listContent}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor="#7C3AED"
                colors={['#7C3AED']}
              />
            }
            ListEmptyComponent={
              <View style={styles.emptyState}>
                <Users size={48} color={Colors.dark.textSecondary} />
                <Text style={styles.emptyText}>{t('creator.workers.empty_title')}</Text>
                <Text style={styles.emptySubtext}>{t('creator.workers.empty_body')}</Text>
              </View>
            }
          />
        )}

        <View style={styles.footer}>
          <ThemedButton
            title={t('creator.workers.add_button')}
            onPress={() => router.push('/(creator)/workers/add')}
            icon={<Plus size={20} color="white" />}
          />
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontSize: 20, fontWeight: 'bold', color: 'white' },
  listContent: { padding: 20, gap: 12 },

  workerCard: { borderRadius: 18, padding: 16 },

  cardHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(124,58,237,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: 'white', fontSize: 18, fontWeight: '700' },
  workerName: { color: 'white', fontSize: 16, fontWeight: '700', marginBottom: 2 },
  workerEmail: { color: Colors.dark.textSecondary, fontSize: 13 },
  deleteButton: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: 'rgba(239,68,68,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  miniStatsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 14,
    marginBottom: 12,
    gap: 0,
  },
  miniStat: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  miniStatVal: { fontSize: 14, fontWeight: '800' },
  miniStatLabel: { color: Colors.dark.textSecondary, fontSize: 11 },
  miniStatDivider: {
    width: 1,
    height: 18,
    backgroundColor: 'rgba(255,255,255,0.12)',
    marginHorizontal: 8,
  },

  tagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 14 },
  permTag: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 8 },
  permTagText: { color: 'white', fontSize: 11, fontWeight: '600' },
  statusBadge: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 8 },
  statusActive: { backgroundColor: 'rgba(74,222,128,0.2)' },
  statusPending: { backgroundColor: 'rgba(251,191,36,0.2)' },
  statusText: { fontSize: 11, fontWeight: '700', color: 'white' },

  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
    paddingTop: 12,
  },
  dateText: { color: Colors.dark.textSecondary, fontSize: 11 },
  statsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(124,58,237,0.35)',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 10,
  },
  statsBtnText: { color: 'white', fontSize: 12, fontWeight: '700' },

  emptyState: { alignItems: 'center', justifyContent: 'center', padding: 40 },
  emptyText: { color: 'white', fontSize: 18, fontWeight: 'bold', marginTop: 16 },
  emptySubtext: { color: Colors.dark.textSecondary, textAlign: 'center', marginTop: 8 },

  footer: {
    padding: 20,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.1)',
  },
});
