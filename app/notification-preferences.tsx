import { LAUNCH_FEATURES } from '@/lib/launchFeatures';
import { View, Text, StyleSheet, Switch, TouchableOpacity, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { ArrowLeft, LogIn } from '@/lib/icons';
import { useEffect, useMemo, useState } from 'react';
import { Colors } from '@/constants/Colors';
import { GlassView } from '@/components/ui/GlassView';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/AuthContext';
import { DiscoLoader } from '@/components/ui/DiscoLoader';
import { useTranslation } from 'react-i18next';
import { AuthRequiredScreen } from '@/components/ui/AuthRequiredScreen';

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

const ORGANIZER_ONLY_KEYS = ['stock_alerts', 'realtime_sales', 'daily_summary', 'stock_threshold_alerts'] as const;
const COMMON_KEYS = (['purchase_updates', 'event_reminders', 'resale_updates'] as const).filter(key => key !== 'resale_updates' || LAUNCH_FEATURES.resale);
type PreferenceKey = (typeof ORGANIZER_ONLY_KEYS)[number] | (typeof COMMON_KEYS)[number];

export function __test_getVisiblePreferenceKeys(role: string | null | undefined): PreferenceKey[] {
  const r = String(role || '').toLowerCase();
  if (r === 'organizer') return [...COMMON_KEYS, ...ORGANIZER_ONLY_KEYS];
  return [...COMMON_KEYS];
}

export default function NotificationPreferencesScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [profileRole, setProfileRole] = useState<string | null>(null);

  const userId = user?.id || null;
  const isOrganizer = profileRole === 'organizer';

  useEffect(() => {
    let mounted = true;
    (async () => {
      if (!userId) {
        setLoading(false);
        return;
      }
      try {
        const [settingsRes, profileRes] = await Promise.all([
          supabase.from('notification_settings').select('*').eq('user_id', userId).maybeSingle(),
          supabase.from('profiles').select('role').eq('id', userId).maybeSingle(),
        ]);

        if (settingsRes.error) throw settingsRes.error;
        const inferredRole =
          (profileRes.data as any)?.role ??
          (settingsRes.data as any)?.role ??
          (user as any)?.user_metadata?.role ??
          null;
        const nextRole = String(inferredRole || '').toLowerCase() || null;
        if (mounted) setProfileRole(nextRole);

        if (!mounted) return;
        if (settingsRes.data) {
          setSettings(settingsRes.data as any);
        } else {
          const defaults: Settings = nextRole === 'organizer'
            ? {
                user_id: userId,
                role: 'organizer',
                event_reminders: true,
                purchase_updates: true,
                resale_updates: true,
                stock_alerts: true,
                realtime_sales: true,
                daily_summary: true,
                stock_threshold_alerts: true,
              }
            : {
                user_id: userId,
                role: nextRole,
                event_reminders: true,
                purchase_updates: true,
                resale_updates: true,
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
  }, [user, userId]);

  const items = useMemo(() => {
    const visible = __test_getVisiblePreferenceKeys(profileRole);
    const all = {
      purchase_updates: { label: t('notification_preferences.items.purchase.label'), desc: t('notification_preferences.items.purchase.desc') },
      event_reminders: { label: t('notification_preferences.items.reminders.label'), desc: t('notification_preferences.items.reminders.desc') },
      resale_updates: { label: t('notification_preferences.items.resale.label'), desc: t('notification_preferences.items.resale.desc') },
      stock_alerts: { label: t('notification_preferences.items.stock.label'), desc: t('notification_preferences.items.stock.desc') },
      realtime_sales: { label: t('notification_preferences.items.realtime_sales.label'), desc: t('notification_preferences.items.realtime_sales.desc') },
      daily_summary: { label: t('notification_preferences.items.daily_summary.label'), desc: t('notification_preferences.items.daily_summary.desc') },
      stock_threshold_alerts: { label: t('notification_preferences.items.thresholds.label'), desc: t('notification_preferences.items.thresholds.desc') },
    } as const;
    return visible.map((key) => ({ key, ...all[key] })) as { key: PreferenceKey; label: string; desc: string }[];
  }, [profileRole, t]);

  const updateSetting = async (key: SettingsKey, value: boolean) => {
    if (!userId) return;
    if (!isOrganizer && (ORGANIZER_ONLY_KEYS as readonly string[]).includes(key)) return;
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

  if (!user) {
    return (
      <AuthRequiredScreen
        title={t('notification_preferences.title')}
        subtitle={t('profile.sign_in_prompt')}
        ctaLabel={t('auth.login')}
        Icon={LogIn}
      />
    );
  }

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

