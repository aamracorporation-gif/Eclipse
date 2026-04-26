import { View, Text, StyleSheet, FlatList, TouchableOpacity, Alert } from 'react-native';
import { useState, useEffect } from 'react';
import { useRouter } from 'expo-router';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/lib/supabase';
import { Users, Plus, Mail, Shield, ChevronLeft, Trash2 } from 'lucide-react-native';
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
  const [loading, setLoading] = useState(true);

  const safeBack = () => {
    const canGoBack = (router as any)?.canGoBack?.();
    if (canGoBack) router.back();
    else router.replace('/(creator)');
  };

  useEffect(() => {
    fetchWorkers();
  }, [user]);

  const fetchWorkers = async () => {
    if (!user) return;
    try {
      setLoading(true);
      
      // Check if table exists implicitly via try-catch
      const { data, error } = await supabase
        .from('workers')
        .select('*')
        .eq('organizer_id', user.id)
        .order('created_at', { ascending: false });

      if (error) {
        // Handle missing table error specifically
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
      setWorkers(data || []);
    } catch (error) {
      console.error('Error fetching workers:', error);
      Alert.alert(t('common.error'), t('creator.workers.load_failed'));
    } finally {
      setLoading(false);
    }
  };

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
            } catch (error) {
              Alert.alert(t('common.error'), t('creator.workers.delete_failed'));
            }
          }
        }
      ]
    );
  };

  const renderWorker = ({ item }: { item: any }) => (
    <GlassView intensity={15} style={styles.workerCard}>
      <View style={styles.workerInfo}>
        <Text style={styles.workerName}>{item.name}</Text>
        <Text style={styles.workerEmail}>{item.email}</Text>
        <View style={styles.statusRow}>
          <View style={[styles.statusBadge, 
            item.status === 'active' ? styles.statusActive : styles.statusPending
          ]}>
            <Text style={styles.statusText}>
              {item.status === 'active' ? t('creator.workers.status_active') : t('creator.workers.status_pending')}
            </Text>
          </View>
          <Text style={styles.dateText}>
            {new Date(item.created_at).toLocaleDateString()}
          </Text>
        </View>
      </View>
      <TouchableOpacity 
        onPress={() => handleDeleteWorker(item.id, item.name)}
        style={styles.deleteButton}
      >
        <Trash2 size={20} color="#ef4444" />
      </TouchableOpacity>
    </GlassView>
  );

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
  container: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
  },
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
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: 'white',
  },
  listContent: {
    padding: 20,
  },
  workerCard: {
    flexDirection: 'row',
    padding: 16,
    borderRadius: 16,
    marginBottom: 12,
    alignItems: 'center',
  },
  workerInfo: {
    flex: 1,
  },
  workerName: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  workerEmail: {
    color: Colors.dark.textSecondary,
    fontSize: 14,
    marginBottom: 8,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  statusActive: {
    backgroundColor: 'rgba(74, 222, 128, 0.2)',
  },
  statusPending: {
    backgroundColor: 'rgba(251, 191, 36, 0.2)',
  },
  statusText: {
    fontSize: 10,
    fontWeight: 'bold',
    color: 'white',
  },
  dateText: {
    color: Colors.dark.textSecondary,
    fontSize: 12,
  },
  deleteButton: {
    padding: 10,
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
