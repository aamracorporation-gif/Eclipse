import { View, Text, StyleSheet, Switch, TouchableOpacity, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { ArrowLeft } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { Colors } from '@/constants/Colors';
import { GlassView } from '@/components/ui/GlassView';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/AuthContext';
import { DiscoLoader } from '@/components/ui/DiscoLoader';
import { useTranslation } from 'react-i18next';

type Settings = {
  user_id: string;
  role?: string | null;
  event_reminders?: boolean | null;
  purchase_updates?: boolean | null;
  resale_updates?: boolean | null;
  stock_alerts?: boolean | null;
  realtime_sales?: boolean | null;
  daily_summary?: boolean | null;
  stock_threshold_alerts?: boolean | null;
};

export default function NotificationPreferencesScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);

  const userId = user?.id || null;

  useEffect(() => {
    let mounted = true;
    (async () => {
      if (!userId) {
        setLoading(false);
        return;
      }
      try {
        const { data, error } = await supabase
          .from('notification_settings')
          .select('*')
          .eq('user_id', userId)
          .maybeSingle();
        if (error) throw error;
        if (!mounted) return;
        if (data) {
          setSettings(data as any);
        } else {
          const defaults: Settings = {
            user_id: userId,
            event_reminders: true,
            purchase_updates: true,
            resale_updates: true,
            stock_alerts: true,
            realtime_sales: true,
            daily_summary: true,
            stock_threshold_alerts: true,
          };
          const up = await supabase.from('notification_settings').upsert(defaults, { onConflict: 'user_id' }).select('*').single();
          if (up.error) throw up.error;
          setSettings(up.data as any);
        }
      } catch {
        if (mounted) setSettings(null);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [userId]);

  const items = useMemo(() => {
    return [
      { key: 'purchase_updates', label: t('notification_preferences.items.purchase.label'), desc: t('notification_preferences.items.purchase.desc') },
      { key: 'event_reminders', label: t('notification_preferences.items.reminders.label'), desc: t('notification_preferences.items.reminders.desc') },
      { key: 'resale_updates', label: t('notification_preferences.items.resale.label'), desc: t('notification_preferences.items.resale.desc') },
      { key: 'stock_alerts', label: t('notification_preferences.items.stock.label'), desc: t('notification_preferences.items.stock.desc') },
      { key: 'realtime_sales', label: t('notification_preferences.items.realtime_sales.label'), desc: t('notification_preferences.items.realtime_sales.desc') },
      { key: 'daily_summary', label: t('notification_preferences.items.daily_summary.label'), desc: t('notification_preferences.items.daily_summary.desc') },
      { key: 'stock_threshold_alerts', label: t('notification_preferences.items.thresholds.label'), desc: t('notification_preferences.items.thresholds.desc') },
    ] as const;
  }, [t]);

  const updateSetting = async (key: SettingsKey, value: boolean) => {
    if (!userId) return;
    setSavingKey(key);
    try {
      const next = { ...(settings || { user_id: userId }), [key]: value } as any;
      setSettings(next);
      const { error } = await supabase
        .from('notification_settings')
        .upsert({ user_id: userId, [key]: value }, { onConflict: 'user_id' });
      if (error) throw error;
    } catch {
      setSettings(prev => prev ? ({ ...prev, [key]: !value } as any) : prev);
    } finally {
      setSavingKey(null);
    }
  };

  type SettingsKey = keyof Settings & string;

  return (
    <View style={styles.container}>
      <LinearGradient colors={['#0F0F1A', '#1A1025', '#0F0F1A']} style={StyleSheet.absoluteFill} />
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.back}>
            <ArrowLeft size={24} color="white" />
          </TouchableOpacity>
          <Text style={styles.title}>{t('notification_preferences.title')}</Text>
          <View style={styles.back} />
        </View>

        {loading ? (
          <View style={styles.loading}>
            <DiscoLoader label={t('common.loading')} size={120} />
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.content}>
            <GlassView intensity={14} style={styles.card}>
              <Text style={styles.cardTitle}>{t('notification_preferences.card_title')}</Text>
              <Text style={styles.cardSub}>{t('notification_preferences.card_subtitle')}</Text>

              {items.map((it, idx) => {
                const enabled = Boolean((settings as any)?.[it.key] ?? true);
                const disabled = savingKey === it.key;
                return (
                  <View key={it.key}>
                    {idx > 0 ? <View style={styles.divider} /> : null}
                    <View style={styles.row}>
                      <View style={styles.rowText}>
                        <Text style={styles.rowLabel}>{it.label}</Text>
                        <Text style={styles.rowDesc}>{it.desc}</Text>
                      </View>
                      <Switch
                        value={enabled}
                        onValueChange={(v) => void updateSetting(it.key, v)}
                        disabled={disabled}
                        trackColor={{ false: 'rgba(255,255,255,0.12)', true: Colors.dark.primary }}
                        thumbColor={'#fff'}
                      />
                    </View>
                  </View>
                );
              })}
            </GlassView>
          </ScrollView>
        )}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F0F1A' },
  safeArea: { flex: 1 },
  header: {
    paddingHorizontal: 20,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  back: { width: 44, height: 44, justifyContent: 'center' },
  title: { color: 'white', fontSize: 18, fontWeight: '800' },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  content: { padding: 20, paddingBottom: 40 },
  card: { borderRadius: 18, padding: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  cardTitle: { color: 'white', fontSize: 16, fontWeight: '800' },
  cardSub: { color: Colors.dark.textSecondary, marginTop: 6, fontSize: 13, lineHeight: 18 },
  divider: { height: 1, backgroundColor: 'rgba(255,255,255,0.06)', marginVertical: 12 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 14 },
  rowText: { flex: 1 },
  rowLabel: { color: 'white', fontSize: 14, fontWeight: '800' },
  rowDesc: { color: 'rgba(255,255,255,0.60)', marginTop: 4, fontSize: 12, lineHeight: 16 },
});
