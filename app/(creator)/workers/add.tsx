import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, Switch, Share } from 'react-native';
import { useState } from 'react';
import { useRouter } from 'expo-router';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/lib/supabase';
import { ChevronLeft, Mail, User, Shield } from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Colors } from '@/constants/Colors';
import { GlassView } from '@/components/ui/GlassView';
import { ThemedButton } from '@/components/ui/ThemedButton';
import { ThemedInput } from '@/components/ui/ThemedInput';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

export default function AddWorker() {
  const { user } = useAuth();
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
        .filter(([_, active]) => active)
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
          Alert.alert('Error de Sistema', 'Falta la tabla de trabajadores. Ejecuta el SQL de migración.');
          return;
        }
        throw error;
      }

      if (data.status === 'active') {
        Alert.alert(
          'Trabajador Vinculado',
          `El usuario ${formData.name} ya tiene cuenta y ha sido vinculado automáticamente.`,
          [{ text: 'OK', onPress: safeBack }]
        );
        return;
      }

      Alert.alert(
        'Trabajador Añadido',
        `Se ha creado el perfil para ${formData.name}.`,
        [
          {
            text: 'Compartir Invitación',
            onPress: async () => {
              try {
                const message = `Hola ${formData.name}, te invito a unirte a mi equipo en la app. Descárgala y regístrate con este correo: ${formData.email}`;
                await Share.share({
                  message,
                  title: 'Invitación al Staff'
                });
                safeBack();
              } catch (error) {
                console.error('Error sharing:', error);
              }
            }
          },
          { text: 'OK', onPress: safeBack }
        ]
      );
    } catch (error: any) {
      console.error('Error adding worker:', error);
      Alert.alert('Error', error.message || 'No se pudo añadir al trabajador');
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
          <Text style={styles.title}>Añadir Trabajador</Text>
          <View style={{ width: 24 }} />
        </View>

        <ScrollView contentContainerStyle={styles.content}>
          <GlassView intensity={10} style={styles.card}>
            <Text style={styles.sectionTitle}>Información Personal</Text>
            
            <ThemedInput
              label="Nombre Completo"
              placeholder="Ej: Juan Pérez"
              value={formData.name}
              onChangeText={(text) => setFormData({ ...formData, name: text })}
              icon={<User size={20} color={Colors.dark.textSecondary} />}
            />

            <ThemedInput
              label="Correo Electrónico"
              placeholder="juan@ejemplo.com"
              value={formData.email}
              onChangeText={(text) => setFormData({ ...formData, email: text })}
              keyboardType="email-address"
              autoCapitalize="none"
              icon={<Mail size={20} color={Colors.dark.textSecondary} />}
            />
          </GlassView>

          <GlassView intensity={10} style={styles.card}>
            <Text style={styles.sectionTitle}>{t('creator.workers.permissions_title')}</Text>
            <Text style={styles.sectionSubtitle}>{t('creator.workers.permissions_subtitle')}</Text>

            <View style={styles.permissionRow}>
              <View>
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
              <View>
                <Text style={styles.permTitle}>{t('creator.workers.perm_sell_title')}</Text>
                <Text style={styles.permDesc}>{t('creator.workers.perm_sell_desc')}</Text>
              </View>
              <Switch
                value={permissions.sell}
                onValueChange={(v) => setPermissions({ ...permissions, sell: v })}
                trackColor={{ false: '#333', true: Colors.dark.primary }}
              />
            </View>

            <View style={styles.divider} />

            <View style={styles.permissionRow}>
              <View>
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

        <View style={styles.footer}>
          <ThemedButton
            title={loading ? "Enviando..." : "Enviar Invitación"}
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
