import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, StatusBar, Modal, ScrollView, ActivityIndicator } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { ArrowLeft, CheckCheck, Bell, Clock, Trash2, LogIn } from '@/lib/icons';
import { useNotifications, Notification } from '@/lib/NotificationContext';
import { Colors } from '@/constants/Colors';
import { GlassView } from '@/components/ui/GlassView';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { formatDistanceToNow } from 'date-fns';
import { es, enUS, fr } from 'date-fns/locale';
import { useI18n } from '@/lib/I18nContext';
import { useAppDialog } from '@/components/ui/AppDialog';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/lib/supabase';
import { normalizeNotificationRow } from '@/lib/notificationSchema';
import { notificationAction, notificationIdIsValid } from '@/lib/notificationRouting';
import { AuthRequiredScreen } from '@/components/ui/AuthRequiredScreen';

export default function NotificationsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ notificationId?: string }>();
  const { language } = useI18n();
  const { user } = useAuth();
  const uid = user?.id ?? null;
  const identity = useRef({ uid, epoch: 0 });
  if (identity.current.uid !== uid) identity.current = { uid, epoch: identity.current.epoch + 1 };
  const { show: showDialog } = useAppDialog();
  const { notifications, unreadCount, markAsRead, markAllAsRead, deleteNotification, loading, error, fetchNotifications, hasMore, loadMore } = useNotifications();
  const markReadRef = useRef(markAsRead); markReadRef.current = markAsRead;
  const [filter, setFilter] = useState<'all' | 'unread' | 'urgent'>('all');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Notification | null>(null);
  const [detailError, setDetailError] = useState('');
  const [profileRole, setProfileRole] = useState('');
  useEffect(() => {
    setDetail(null); setDetailError('');
    setDetailId(notificationIdIsValid(params.notificationId) ? params.notificationId : null);
  }, [params.notificationId, uid]);
  useEffect(() => {
    let active = true; setDetail(null); setDetailError(''); setProfileRole('');
    if (!uid || !detailId) return;
    // Query ownership explicitly as well as through RLS, including archived/out-of-page notifications.
    void Promise.all([
      supabase.from('notifications').select('*').eq('id', detailId).eq('user_id', uid).maybeSingle(),
      supabase.from('profiles').select('role').eq('id', uid).maybeSingle(),
    ]).then(([result, profile]) => {
      if (!active) return;
      if (result.error || profile.error) throw new Error('load');
      if (!result.data || result.data.user_id !== uid) { setDetailError('Este aviso ya no está disponible para tu cuenta.'); return; }
      const loaded = normalizeNotificationRow(result.data);
      setDetail(loaded);
      if (!loaded.read) void markReadRef.current(detailId);
      setProfileRole(String(profile.data?.role ?? ''));
    }).catch(() => { if (active) setDetailError('No se pudo abrir el aviso. Cierra y vuelve a intentarlo.'); });
    return () => { active = false; };
  }, [uid, detailId]);
  const filtered = useMemo(() => notifications.filter(n => filter === 'unread' ? !n.read : filter === 'urgent' ? n.priority === 'high' : true), [filter, notifications]);
  const locale = language === 'en' ? enUS : language === 'fr' ? fr : es;
  const close = () => { setDetailId(null); setDetail(null); router.setParams({ notificationId: undefined }); };
  const action = detail && uid && detail.user_id === uid ? notificationAction(detail, uid, profileRole) : null;
  const openAction = async () => {
    if (!detail || !uid || !action) return;
    const epoch = identity.current.epoch;
    if (action.path.includes('/event/')) {
      const { data, error: failure } = await supabase.from('events').select('id').eq('id', detail.event_id!).maybeSingle();
      if (identity.current.uid !== uid || identity.current.epoch !== epoch) return;
      if (failure || !data) { setDetailError('El evento ya no está disponible. La información del aviso se conserva.'); return; }
    }
    close(); router.push(action.path as any);
  };
  if (!uid) return <AuthRequiredScreen title="Notificaciones" subtitle="Inicia sesión para ver tus avisos." ctaLabel="Iniciar sesión" Icon={LogIn} />;
  const renderNotification = ({ item }: { item: Notification }) => {
    const date = new Date(item.created_at);
    const time = Number.isFinite(date.getTime()) ? formatDistanceToNow(date, { addSuffix: true, locale }) : '';
    return <TouchableOpacity accessibilityRole="button" accessibilityLabel={`${item.read ? '' : 'No leído. '}${item.title || 'Aviso'}`}
      onPress={() => setDetailId(item.id)} style={[styles.notificationCard, !item.read && styles.unreadCard]}>
      <GlassView intensity={item.read ? 10 : 25} style={styles.glass}>
        <View style={styles.iconContainer}><Bell size={20} color={Colors.dark.primary} />{!item.read && <View style={styles.unreadDot} />}</View>
        <View style={styles.content}>
          <Text style={styles.titleText}>{item.title || 'Eclipse'}</Text>
          <Text style={styles.message}>{item.body || item.message || ''}</Text>
          <View style={styles.footer}><Clock size={12} color="rgba(255,255,255,0.4)" /><Text style={styles.timeText}>{time}</Text></View>
        </View>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Archivar aviso" style={styles.deleteBtn} onPress={event => {
          event.stopPropagation(); showDialog({ title: 'Archivar aviso', message: 'Se retirará de tu centro. No se borra el registro ni se cancelan los envíos.',
            actions: [{ label: 'Archivar', variant: 'primary', onPress: () => void deleteNotification(item.id) }, { label: 'Cancelar', variant: 'outline' }] });
        }}><Trash2 size={18} color="rgba(255,255,255,0.55)" /></TouchableOpacity>
      </GlassView>
    </TouchableOpacity>;
  };
  return <View style={styles.container}>
    <StatusBar barStyle="light-content" /><LinearGradient colors={Colors.dark.backgroundGradient} style={StyleSheet.absoluteFill} />
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.header}>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Volver" onPress={() => router.back()} style={styles.backButton}><ArrowLeft size={24} color="white" /></TouchableOpacity>
        <Text style={styles.title}>Notificaciones · {unreadCount}</Text>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Marcar todas como leídas" onPress={() => void markAllAsRead()} style={styles.headerActionBtn}><CheckCheck size={20} color={Colors.dark.primary} /></TouchableOpacity>
      </View>
      <TouchableOpacity accessibilityRole="button" onPress={() => router.push('/notification-preferences')} style={{ padding: 16 }}><Text style={styles.filterChipTextActive}>Gestionar preferencias</Text></TouchableOpacity>
      <View style={styles.filterRow}>{([['all','Todas'],['unread','No leídas'],['urgent','Importantes']] as const).map(([key,label]) =>
        <TouchableOpacity key={key} accessibilityRole="button" accessibilityState={{ selected: filter === key }} onPress={() => setFilter(key)} style={[styles.filterChip, filter === key && styles.filterChipActive]}><Text style={styles.filterChipText}>{label}</Text></TouchableOpacity>)}</View>
      {!!error && <TouchableOpacity accessibilityRole="button" onPress={() => void fetchNotifications()} style={{ padding: 16 }}><Text accessibilityRole="alert" style={styles.message}>{error} Pulsa para reintentar.</Text></TouchableOpacity>}
      <FlatList data={filtered} keyExtractor={n => n.id} renderItem={renderNotification} contentContainerStyle={styles.listContent}
        refreshing={loading} onRefresh={() => void fetchNotifications()}
        ListEmptyComponent={loading ? <ActivityIndicator accessibilityLabel="Cargando notificaciones" /> : <View style={styles.emptyContainer}><Bell size={48} color={Colors.dark.primary} /><Text style={styles.emptyTitle}>{error ? 'No se ha podido actualizar' : 'No hay avisos en este filtro'}</Text></View>}
        ListFooterComponent={hasMore ? <TouchableOpacity accessibilityRole="button" onPress={() => void loadMore()} style={{ padding: 18 }}><Text style={styles.message}>Cargar avisos anteriores</Text></TouchableOpacity> : null} />
      <Modal visible={!!detailId} animationType="slide" onRequestClose={close}>
        <SafeAreaView style={styles.container}>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Cerrar detalle" onPress={close} style={{ padding: 20 }}><Text style={styles.titleText}>Cerrar</Text></TouchableOpacity>
          <ScrollView contentContainerStyle={{ padding: 24 }}>
            {detail?.user_id === uid ? <><Text style={styles.titleText}>{detail.title}</Text><Text style={[styles.message,{ marginTop: 20 }]}>{detail.body || detail.message}</Text>
              {!!action && <TouchableOpacity accessibilityRole="button" onPress={() => void openAction()} style={{ paddingVertical: 24 }}><Text style={styles.filterChipTextActive}>{action.label}</Text></TouchableOpacity>}</> : !detailError ? <ActivityIndicator accessibilityLabel="Cargando detalle" /> : null}
            {!!detailError && <Text accessibilityRole="alert" style={styles.message}>{detailError}</Text>}
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  </View>;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.dark.background,
  },
  safeArea: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 15,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.05)',
  },
  backButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: Colors.dark.text,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerActionBtn: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'flex-end',
  },
  filterRow: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 6,
  },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  filterChipActive: {
    borderColor: Colors.dark.primary,
    backgroundColor: Colors.dark.primary + '26',
  },
  filterChipText: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 12,
    fontWeight: '800',
  },
  filterChipTextActive: {
    color: Colors.dark.text,
  },
  listContent: {
    padding: 20,
    paddingBottom: 40,
  },
  notificationCard: {
    marginBottom: 12,
    borderRadius: 16,
    overflow: 'hidden',
  },
  unreadCard: {
    shadowColor: Colors.dark.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 5,
  },
  glass: {
    flexDirection: 'row',
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  iconContainer: {
    position: 'relative',
    marginRight: 16,
  },
  iconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  unreadDot: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: Colors.dark.primary,
    borderWidth: 2,
    borderColor: '#1A1025',
  },
  content: {
    flex: 1,
  },
  titleText: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.9)',
    fontWeight: '800',
    lineHeight: 18,
    marginBottom: 6,
  },
  message: {
    fontSize: 15,
    color: 'rgba(255,255,255,0.7)',
    lineHeight: 20,
    marginBottom: 8,
  },
  unreadMessage: {
    color: Colors.dark.text,
    fontWeight: '600',
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  deleteBtn: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    backgroundColor: 'rgba(255,255,255,0.04)',
    marginLeft: 10,
  },
  timeText: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.4)',
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 100,
  },
  emptyIconCircle: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: 'rgba(255,255,255,0.03)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: Colors.dark.text,
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.4)',
    textAlign: 'center',
    paddingHorizontal: 40,
  },
});
