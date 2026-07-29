import { View, Text, StyleSheet, FlatList, TouchableOpacity, Alert } from 'react-native';
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'expo-router';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/lib/supabase';
import { Users, Plus, ChevronLeft, Trash2, ScanLine, ShoppingBag, BarChart2 } from '@/lib/icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Colors } from '@/constants/Colors';
import { GlassView } from '@/components/ui/GlassView';
import { ThemedButton } from '@/components/ui/ThemedButton';
import { DiscoLoader } from '@/components/ui/DiscoLoader';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

interface WorkerStats {
  scanCount: number;
  saleCount: number;
  salesRevenue: number;
}

export default function ManageWorkers() {
  const { user } = useAuth();
  const router = useRouter();
  const { t } = useTranslation();
  const [workers, setWorkers] = useState<any[]>([]);
  const [stats, setStats] = useState<Record<string, WorkerStats>>({});
  const [loading, setLoading] = useState(true);

  const safeBack = () => {
    const canGoBack = (router as any)?.canGoBack?.();
    if (canGoBack) router.back();
    else router.replace('/(creator)');
  };

  const fetchWorkers = useCallback(async () => {
    if (!user) return;
    try {
      setLoading(true);

      const { data, error } = await supabase
        .from('workers')
        .select('*')
        .eq('organizer_id', user.id)
        .order('created_at', { ascending: false });

      if (error) {
        if (error.code === 'PGRST205' || error.message?.includes('does not exist')) {
          Alert.alert(
            t('creator.workers.system_not_initialized_title'),
            t('creator.workers.system_not_initialized_body'),
            [{ text: t('common.ok') }]
          );
          return;
        }
        throw error;
      }

      const workerList = data || [];
      setWorkers(workerList);

      // ── Fetch stats for all workers (isolated — never crashes the worker list) ──
      if (workerList.length > 0) {
        try {
          const ids = workerList.map((w: any) => w.id);

          const [scanRes, saleRes] = await Promise.all([
            supabase
              .from('tickets')
              .select('scanned_by_worker_id')
              .in('scanned_by_worker_id', ids),
            supabase
              .from('tickets')
              .select('sold_by_worker_id, total_price')
              .in('sold_by_worker_id', ids)
              .eq('payment_status', 'paid'),
          ]);

          const statsMap: Record<string, WorkerStats> = {};
          ids.forEach((id: string) => {
            statsMap[id] = { scanCount: 0, saleCount: 0, salesRevenue: 0 };
          });

          (scanRes.data || []).forEach((row: any) => {
            if (row.scanned_by_worker_id && statsMap[row.scanned_by_worker_id]) {
              statsMap[row.scanned_by_worker_id].scanCount++;
            }
          });

          (saleRes.data || []).forEach((row: any) => {
            if (row.sold_by_worker_id && statsMap[row.sold_by_worker_id]) {
              statsMap[row.sold_by_worker_id].saleCount++;
              statsMap[row.sold_by_worker_id].salesRevenue += Number(row.total_price || 0);
            }
          });

          setStats(statsMap);
        } catch (statsErr) {
          console.warn('Worker stats fetch failed (non-critical):', statsErr);
        }
      }
    } catch (error) {
      console.error('Error fetching workers:', error);
      Alert.alert(t('common.error'), t('creator.workers.load_failed'));
    } finally {
      setLoading(false);
    }
  }, [t, user]);

  useEffect(() => {
    fetchWorkers();
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
    if (permissions.scan)  tags.push({ label: 'Scan',  icon: '🔍', color: 'rgba(59,130,246,0.25)' });
    if (permissions.sell)  tags.push({ label: 'Venta', icon: '💰', color: 'rgba(245,158,11,0.25)' });
    if (permissions.stats) tags.push({ label: 'Stats', icon: '📊', color: 'rgba(139,92,246,0.25)' });
    return tags;
  };

  const renderWorker = ({ item }: { item: any }) => {
    const workerStats = stats[item.id];
    const tags = permissionTags(item.permissions);

    return (
      <GlassView intensity={15} style={styles.workerCard}>
        {/* Top row: name + delete */}
        <View style={styles.cardHeader}>
          <View style={{ flex: 1 }}>
            <Text style={styles.workerName}>{item.name}</Text>
            <Text style={styles.workerEmail}>{item.email}</Text>
          </View>
          <TouchableOpacity
            onPress={() => handleDeleteWorker(item.id, item.name)}
            style={styles.deleteButton}
          >
            <Trash2 size={20} color="#ef4444" />
          </TouchableOpacity>
        </View>

        {/* Permission tags + status */}
        <View style={styles.tagsRow}>
          {tags.map(tag => (
            <View key={tag.label} style={[styles.permTag, { backgroundColor: tag.color }]}>
              <Text style={styles.permTagText}>{tag.icon} {tag.label}</Text>
            </View>
          ))}
          <View style={[styles.statusBadge,
            item.status === 'active' ? styles.statusActive : styles.statusPending
          ]}>
            <Text style={styles.statusText}>
              {item.status === 'active'
                ? t('creator.workers.status_active')
                : t('creator.workers.status_pending')}
            </Text>
          </View>
        </View>

        {/* Stats row */}
        {workerStats && (
          <View style={styles.statsRow}>
            <View style={styles.statChip}>
              <ScanLine size={13} color="#60a5fa" />
              <Text style={[styles.statValue, { color: '#60a5fa' }]}>{workerStats.scanCount}</Text>
              <Text style={styles.statLabel}>escaneos</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statChip}>
              <ShoppingBag size={13} color="#fbbf24" />
              <Text style={[styles.statValue, { color: '#fbbf24' }]}>{workerStats.saleCount}</Text>
              <Text style={styles.statLabel}>ventas</Text>
            </View>
            {workerStats.salesRevenue > 0 && (
              <>
                <View style={styles.statDivider} />
                <View style={styles.statChip}>
                  <BarChart2 size={13} color="#a78bfa" />
                  <Text style={[styles.statValue, { color: '#a78bfa' }]}>
                    {workerStats.salesRevenue.toFixed(0)}€
                  </Text>
                  <Text style={styles.statLabel}>recaudado</Text>
                </View>
              </>
            )}
          </View>
        )}

        <Text style={styles.dateText}>
          Añadido: {new Date(item.created_at).toLocaleDateString()}
        </Text>
      </GlassView>
    );
  };

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={[Colors.dark.background, '#1e1b4b']}
        style={StyleSheet.absoluteFill}
      />
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <TouchableOpacity onPress={safeBack} style={styles.backButton}>
            <ChevronLeft size={24} color="white" />
          </TouchableOpacity>
          <Text style={styles.title}>{t('creator.workers.manage_title')}</Text>
          <View style={{ width: 24 }} />
        </View>

        {loading ? (
          <View style={{ marginTop: 20, alignItems: 'center' }}>
            <DiscoLoader size={90} />
          </View>
        ) : (
          <FlatList
            data={workers}
            renderItem={renderWorker}
            keyExtractor={item => item.id}
            contentContainerStyle={styles.listContent}
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
  safeArea:  { flex: 1 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
  },
  backButton: {
    padding: 8,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  title: { fontSize: 20, fontWeight: 'bold', color: 'white' },
  listContent: { padding: 20 },

  workerCard: {
    padding: 16,
    borderRadius: 16,
    marginBottom: 12,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 10,
  },
  workerName: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 2,
  },
  workerEmail: {
    color: Colors.dark.textSecondary,
    fontSize: 13,
  },
  deleteButton: { padding: 6 },

  tagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 12,
  },
  permTag: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  permTagText: { color: 'white', fontSize: 11, fontWeight: '600' },

  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  statusActive:  { backgroundColor: 'rgba(74,222,128,0.2)' },
  statusPending: { backgroundColor: 'rgba(251,191,36,0.2)' },
  statusText: { fontSize: 11, fontWeight: 'bold', color: 'white' },

  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginBottom: 8,
    gap: 0,
  },
  statChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  statDivider: {
    width: 1,
    height: 20,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  statValue: { fontSize: 15, fontWeight: 'bold' },
  statLabel: { color: Colors.dark.textSecondary, fontSize: 11 },

  dateText: {
    color: Colors.dark.textSecondary,
    fontSize: 11,
  },

  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
  },
  emptyText: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
    marginTop: 16,
  },
  emptySubtext: {
    color: Colors.dark.textSecondary,
    textAlign: 'center',
    marginTop: 8,
  },
  footer: {
    padding: 20,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.1)',
  },
});
