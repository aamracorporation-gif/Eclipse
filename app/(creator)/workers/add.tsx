import { profileAppearance } from '@/theme/profileAppearance';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, Switch, Share } from 'react-native';
import { useState } from 'react';
import { useRouter } from 'expo-router';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/lib/supabase';
import { ChevronLeft, Mail, User } from '@/lib/icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Colors } from '@/constants/Colors';
import { GlassView } from '@/components/ui/GlassView';
import { ThemedButton } from '@/components/ui/ThemedButton';
import { ThemedInput } from '@/components/ui/ThemedInput';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useBoxOfficeAccess } from '@/hooks/useBoxOfficeAccess';

export default function AddWorker() {
  const { user } = useAuth();
  const boxOffice = useBoxOfficeAccess(user?.id);
  const router = useRouter();
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    email: '',
  });
  const [permissions, setPermissions] = useState({
    scan: true,
    sell: false,
    stats: false,
  });

  const safeBack = () => {
    const canGoBack = (router as any)?.canGoBack?.();
    if (canGoBack) router.back();
    else router.replace('/(creator)/workers');
  };

  const handleSubmit = async () => {
    if (!formData.name || !formData.email) {
      Alert.alert(t('common.error'), t('creator.workers.form_required'));
      return;
    }

    if (!user) return;

    try {
      setLoading(true);
      
      const activePermissions = Object.entries(permissions)
        .filter(([key, active]) => active && (key !== 'sell' || boxOffice.enabled))
        .map(([key]) => key);

      const { data, error } = await supabase.from('workers').insert({
        organizer_id: user.id,
        name: formData.name,
        email: formData.email.toLowerCase().trim(),
        permissions: activePermissions,
        status: 'pending'
      }).select().single();

      if (error) {
        if (error.code === 'PGRST205' || error.message?.includes('does not exist')) {
          Alert.alert(t('common.error'), t('creator.workers.system_not_initialized_body'));
          return;
        }
        throw error;
      }

      if (data.status === 'active') {
        Alert.alert(
          t('creator.workers.linked_title'),
          t('creator.workers.linked_body', { name: formData.name }),
          [{ text: t('common.ok'), onPress: safeBack }]
        );
        return;
      }

      Alert.alert(
        t('creator.workers.added_title'),
        t('creator.workers.added_body', { name: formData.name }),
        [
          {
            text: t('creator.workers.share_invite'),
            onPress: async () => {
              try {
                const message = t('creator.workers.invite_message', { name: formData.name, email: formData.email });
                await Share.share({
                  message,
                  title: t('creator.workers.invite_share_title')
                });
                safeBack();
              } catch (error) {
                console.error('Error sharing:', error);
              }
            }
          },
          { text: t('common.ok'), onPress: safeBack }
        ]
      );
    } catch (error: any) {
      console.error('Error adding worker:', error);
      Alert.alert(t('common.error'), error.message || t('creator.workers.add_failed'));
    } finally {
      setLoading(false);
    }
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
          <Text style={[styles.title, { flex: 1, textAlign: 'center', marginHorizontal: 8 }]}>{t('creator.workers.add_button')}</Text>
          <View style={{ width: 24 }} />
        </View>

        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.content, profileAppearance.content]}>
          <GlassView intensity={10} style={[styles.card, profileAppearance.card]} contentContainerStyle={{ padding: 0 }}>
            <Text style={styles.sectionTitle}>{t('creator.workers.personal_info_title')}</Text>
            
            <ThemedInput
              label={t('creator.workers.full_name_label')}
              placeholder={t('creator.workers.full_name_placeholder')}
              value={formData.name}
              onChangeText={(text) => setFormData({ ...formData, name: text })}
              icon={<User size={20} color={Colors.dark.textSecondary} />}
            />

            <ThemedInput
              label={t('auth.email')}
              placeholder={t('creator.workers.email_placeholder')}
              value={formData.email}
              onChangeText={(text) => setFormData({ ...formData, email: text })}
              keyboardType="email-address"
              autoCapitalize="none"
              icon={<Mail size={20} color={Colors.dark.textSecondary} />}
            />
          </GlassView>

          <GlassView intensity={10} style={[styles.card, profileAppearance.card]} contentContainerStyle={{ padding: 0 }}>
            <Text style={styles.sectionTitle}>{t('creator.workers.permissions_title')}</Text>
            <Text style={styles.sectionSubtitle}>{t('creator.workers.permissions_subtitle')}</Text>

            <View style={styles.permissionRow}>
              <View style={{ flex: 1, minWidth: 0, marginRight: 12 }}>
                <Text style={styles.permTitle}>{t('creator.workers.perm_scan_title')}</Text>
                <Text style={styles.permDesc}>{t('creator.workers.perm_scan_desc')}</Text>
              </View>
              <Switch
                value={permissions.scan}
                onValueChange={(v) => setPermissions({ ...permissions, scan: v })}
                trackColor={{ false: '#333', true: Colors.dark.primary }}
              />
            </View>

            <View style={styles.divider} />

            <View style={styles.permissionRow}>
              <View style={{ flex: 1, minWidth: 0, marginRight: 12 }}>
                <Text style={styles.permTitle}>{t('creator.workers.perm_sell_title')}</Text>
                <Text style={styles.permDesc}>{boxOffice.enabled ? t('creator.workers.perm_sell_desc') : 'Requiere Taquilla Premium · 50 €/mes'}</Text>
              </View>
              <Switch
                value={permissions.sell && boxOffice.enabled}
                disabled={!boxOffice.enabled || boxOffice.checking}
                onValueChange={(v) => setPermissions({ ...permissions, sell: v && boxOffice.enabled })}
                trackColor={{ false: '#333', true: Colors.dark.primary }}
              />
            </View>

            <View style={styles.divider} />

            <View style={styles.permissionRow}>
              <View style={{ flex: 1, minWidth: 0, marginRight: 12 }}>
                <Text style={styles.permTitle}>{t('creator.workers.perm_stats_title')}</Text>
                <Text style={styles.permDesc}>{t('creator.workers.perm_stats_desc')}</Text>
              </View>
              <Switch
                value={permissions.stats}
                onValueChange={(v) => setPermissions({ ...permissions, stats: v })}
                trackColor={{ false: '#333', true: Colors.dark.primary }}
              />
            </View>
          </GlassView>
        </ScrollView>

        <View style={[styles.footer, profileAppearance.content]}>
          <ThemedButton
            title={loading ? t('creator.workers.sending') : t('creator.workers.send_invite')}
            onPress={handleSubmit}
            disabled={loading}
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
  content: {
    padding: 20,
  },
  card: {
    padding: 20,
    borderRadius: 16,
    marginBottom: 20,
  },
  sectionTitle: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 15,
  },
  sectionSubtitle: {
    color: Colors.dark.textSecondary,
    fontSize: 14,
    marginBottom: 20,
    marginTop: -10,
  },
  permissionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
  },
  permTitle: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  permDesc: {
    color: Colors.dark.textSecondary,
    fontSize: 12,
    marginTop: 2,
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.1)',
    marginVertical: 10,
  },
  footer: {
    padding: 20,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.1)',
  },
});
