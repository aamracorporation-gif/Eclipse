import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, StatusBar } from 'react-native';
import { useRouter } from 'expo-router';
import { ArrowLeft, CheckCheck, Bell, Clock, Trash2 } from '@/lib/icons';
import { useNotifications, Notification } from '@/lib/NotificationContext';
import { Colors } from '@/constants/Colors';
import { GlassView } from '@/components/ui/GlassView';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { formatDistanceToNow } from 'date-fns';
import { es, enUS, fr } from 'date-fns/locale';
import { useTranslation } from 'react-i18next';
import { useI18n } from '@/lib/I18nContext';
import { useAppDialog } from '@/components/ui/AppDialog';

export default function NotificationsScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { language } = useI18n();
  const { show: showDialog } = useAppDialog();
  const { notifications, markAsRead, markAllAsRead, deleteNotification, deleteAllNotifications, loading } = useNotifications();
  const [filter, setFilter] = useState<'all' | 'unread' | 'urgent'>('all');

  const getLocale = () => {
    switch (language) {
      case 'es': return es;
      case 'en': return enUS;
      case 'fr': return fr;
      default: return es;
    }
  };

  const filtered = useMemo(() => {
    if (filter === 'unread') return notifications.filter(n => !n.read);
    if (filter === 'urgent') return notifications.filter(n => (n.priority || 'normal') === 'high');
    return notifications;
  }, [filter, notifications]);

  const renderNotification = ({ item }: { item: Notification }) => {
    const timeAgo = formatDistanceToNow(new Date(item.created_at), { 
      addSuffix: true, 
      locale: getLocale() 
    });
    const text =
      (typeof item.message === 'string' && item.message.trim() ? item.message.trim() : '') ||
      (typeof item.body === 'string' && item.body.trim() ? item.body.trim() : '') ||
      (typeof item.title === 'string' && item.title.trim() ? item.title.trim() : '') ||
      '';

    return (
      <TouchableOpacity
        activeOpacity={0.8}
        onPress={() => !item.read && markAsRead(item.id)}
        style={[styles.notificationCard, !item.read && styles.unreadCard]}
      >
        <GlassView intensity={item.read ? 10 : 25} style={styles.glass}>
          <View style={styles.iconContainer}>
            <View style={[styles.iconCircle, { backgroundColor: item.read ? 'rgba(255,255,255,0.05)' : Colors.dark.primary + '20' }]}>
              <Bell size={20} color={item.read ? 'rgba(255,255,255,0.4)' : Colors.dark.primary} />
            </View>
            {!item.read && <View style={styles.unreadDot} />}
          </View>
          
          <View style={styles.content}>
            {item.title ? (
              <Text style={[styles.titleText, !item.read && styles.unreadMessage]} numberOfLines={2}>
                {item.title}
              </Text>
            ) : null}
            <Text style={[styles.message, !item.read && styles.unreadMessage]}>
              {text}
            </Text>
            <View style={styles.footer}>
              <Clock size={12} color="rgba(255,255,255,0.4)" />
              <Text style={styles.timeText}>{timeAgo}</Text>
            </View>
          </View>

          <TouchableOpacity
            activeOpacity={0.8}
            onPress={() => {
              showDialog({
                title: t('common.confirm', { defaultValue: 'Confirmar' }),
                message: t('notifications.confirm_delete_one', { defaultValue: '¿Eliminar esta notificación?' }),
                actions: [
                  { label: t('common.delete', { defaultValue: 'Eliminar' }), variant: 'primary', onPress: () => void deleteNotification(item.id) },
                  { label: t('common.cancel', { defaultValue: 'Cancelar' }), variant: 'outline' },
                ],
              });
            }}
            style={styles.deleteBtn}
          >
            <Trash2 size={18} color="rgba(255,255,255,0.55)" />
          </TouchableOpacity>
        </GlassView>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />
      <LinearGradient
        colors={['#0F0F1A', '#1A1025', '#0F0F1A']}
        style={StyleSheet.absoluteFill}
      />

      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <ArrowLeft size={24} color="white" />
          </TouchableOpacity>
          <Text style={styles.title}>{t('common.notifications')}</Text>
          <View style={styles.headerActions}>
            <TouchableOpacity onPress={markAllAsRead} style={styles.headerActionBtn}>
              <CheckCheck size={20} color={Colors.dark.primary} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => {
                showDialog({
                  title: t('common.confirm', { defaultValue: 'Confirmar' }),
                  message: t('notifications.confirm_delete_all', { defaultValue: '¿Eliminar todas las notificaciones?' }),
                  actions: [
                    { label: t('common.delete_all', { defaultValue: 'Eliminar todas' }), variant: 'primary', onPress: () => void deleteAllNotifications() },
                    { label: t('common.cancel', { defaultValue: 'Cancelar' }), variant: 'outline' },
                  ],
                });
              }}
              style={styles.headerActionBtn}
            >
              <Trash2 size={20} color="rgba(255,255,255,0.55)" />
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.filterRow}>
          <TouchableOpacity onPress={() => setFilter('all')} style={[styles.filterChip, filter === 'all' && styles.filterChipActive]}>
            <Text style={[styles.filterChipText, filter === 'all' && styles.filterChipTextActive]}>{t('notifications.filters.all')}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setFilter('unread')} style={[styles.filterChip, filter === 'unread' && styles.filterChipActive]}>
            <Text style={[styles.filterChipText, filter === 'unread' && styles.filterChipTextActive]}>{t('notifications.filters.unread')}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setFilter('urgent')} style={[styles.filterChip, filter === 'urgent' && styles.filterChipActive]}>
            <Text style={[styles.filterChipText, filter === 'urgent' && styles.filterChipTextActive]}>{t('notifications.filters.urgent')}</Text>
          </TouchableOpacity>
        </View>

        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          renderItem={renderNotification}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            !loading ? (
              <View style={styles.emptyContainer}>
                <View style={styles.emptyIconCircle}>
                  <Bell size={48} color="rgba(255,255,255,0.1)" />
                </View>
                <Text style={styles.emptyTitle}>{t('notifications.empty')}</Text>
              </View>
            ) : null
          }
        />
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F0F1A',
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
    color: 'white',
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
    color: 'white',
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
    color: 'white',
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
    color: 'white',
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.4)',
    textAlign: 'center',
    paddingHorizontal: 40,
  },
});
