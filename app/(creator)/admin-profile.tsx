import { useCallback, useState } from 'react';
import { Text, StyleSheet, ScrollView, RefreshControl, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/lib/supabase';
import { GlassView } from '@/components/ui/GlassView';
import { ThemedButton } from '@/components/ui/ThemedButton';
import { Colors } from '@/constants/Colors';
import { LAUNCH_FEATURES } from '@/lib/launchFeatures';

type AuditRow = { id: string; action: string; created_at: string; target_user_id: string | null };
const actionLabels: Record<string, string> = {
  organizer_verification_set: 'Revisión de organizador',
  organizer_suspension_set: 'Suspensión de organizador',
  user_suspension_set: 'Cambio de estado de usuario',
  ticket_invalidated: 'Entrada invalidada',
};

export default function AdminProfile() {
  const { user, signOut } = useAuth();
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await supabase.from('admin_audit_logs')
        .select('id, action, created_at, target_user_id').order('created_at', { ascending: false }).limit(25);
      if (result.error) throw result.error;
      setRows(result.data || []);
    } catch {
      setError('No se pudo cargar la actividad. Desliza hacia abajo para reintentar.');
    } finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  const logout = () => Alert.alert('Cerrar sesión', '¿Quieres salir de la cuenta de administrador?', [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Cerrar sesión', style: 'destructive', onPress: async () => {
      try { await signOut(); router.replace('/(auth)/login'); }
      catch { Alert.alert('No se pudo cerrar sesión', 'Inténtalo de nuevo.'); }
    } },
  ]);
  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={Colors.dark.primary} />}>
        <Text style={styles.eyebrow}>ECLIPSE · ADMINISTRACIÓN</Text>
        <Text style={styles.title}>Mi perfil</Text>
        <GlassView>
          <Text style={styles.heading}>Administrador</Text>
          <Text selectable style={styles.text}>{user?.email}</Text>
          <Text style={styles.muted}>Acceso privado para revisar usuarios, organizadores, eventos y entradas.</Text>
        </GlassView>
        <GlassView>
          <Text style={styles.heading}>Funciones del lanzamiento</Text>
          <Text style={styles.text}>Reventa: {LAUNCH_FEATURES.resale ? 'activada' : 'desactivada'}</Text>
          <Text style={styles.text}>Monedero: {LAUNCH_FEATURES.walletCredit ? 'activado' : 'desactivado'}</Text>
        </GlassView>
        <ThemedButton title="Estado de notificaciones" onPress={() => router.push('/notification-health')} />
        <Text style={styles.heading}>Actividad administrativa reciente</Text>
        <Text style={styles.muted}>Últimas 25 acciones registradas. Cada revisión queda vinculada a la cuenta que la realiza.</Text>
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        {!loading && !error && rows.length === 0 ? <Text style={styles.muted}>Todavía no hay acciones registradas.</Text> : null}
        {rows.map(row => (
          <GlassView key={row.id}>
            <Text style={styles.text}>{actionLabels[row.action] || row.action}</Text>
            <Text style={styles.muted}>{new Date(row.created_at).toLocaleString('es-ES')}</Text>
            {row.target_user_id ? <Text selectable style={styles.muted}>Usuario: {row.target_user_id}</Text> : null}
          </GlassView>
        ))}
        <ThemedButton title="Cerrar sesión" onPress={logout} />
      </ScrollView>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.dark.background },
  content: { padding: 20, gap: 16, maxWidth: 700, width: '100%', alignSelf: 'center', paddingBottom: 36 },
  eyebrow: { color: Colors.dark.primary, fontSize: 12, fontWeight: '700', letterSpacing: 1 },
  title: { color: '#fff', fontSize: 30, fontWeight: '800' },
  heading: { color: '#fff', fontSize: 18, fontWeight: '700', marginBottom: 8 },
  text: { color: '#fff', fontSize: 15, lineHeight: 23 },
  muted: { color: Colors.dark.textSecondary, fontSize: 13, lineHeight: 20, marginTop: 5 },
  error: { color: '#fb7185', lineHeight: 22 },
});
