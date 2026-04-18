import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { supabase } from './supabase';
import { useAuth } from './AuthContext';
import { normalizeNotificationRow, type NotificationModel } from './notificationSchema';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { scheduleLocalNotification } from '@/lib/notifications';
import { registerForPushNotifications } from '@/lib/notifications';
import { AppState } from 'react-native';

export type Notification = {
  id: string;
  user_id: string;
  role?: 'attendee' | 'organizer' | 'staff' | 'admin';
  title?: string;
  type: string;
  message?: string;
  body?: string;
  priority?: 'low' | 'normal' | 'high';
  status?: 'pending' | 'sent' | 'failed' | 'blocked' | 'read';
  data?: Record<string, unknown> | null;
  read: boolean;
  created_at: string;
};

type NotificationContextType = {
  notifications: Notification[];
  unreadCount: number;
  loading: boolean;
  fetchNotifications: () => Promise<void>;
  markAsRead: (id: string) => Promise<void>;
  markAllAsRead: () => Promise<void>;
};

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  const unreadCount = notifications.filter(n => !n.read).length;

  const normalize = (row: any): NotificationModel => normalizeNotificationRow(row);

  const fetchNotifications = useCallback(async () => {
    if (!user) return;
    try {
      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setNotifications((data || []).map(normalize) as any);
    } catch (error) {
      console.error('Error fetching notifications:', error);
    } finally {
      setLoading(false);
    }
  }, [user]);

  const markAsRead = async (id: string) => {
    try {
      const now = new Date().toISOString();
      const { error } = await supabase
        .from('notifications')
        .update({ read: true, read_at: now, status: 'read' })
        .eq('id', id);

      if (error) throw error;
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
    } catch (error) {
      console.error('Error marking notification as read:', error);
    }
  };

  const markAllAsRead = async () => {
    if (!user) return;
    try {
      const { error } = await supabase.rpc('mark_all_notifications_read', { p_user_id: user.id });

      if (error) {
        const now = new Date().toISOString();
        const fallback = await supabase
          .from('notifications')
          .update({ read: true, read_at: now, status: 'read' })
          .eq('user_id', user.id);
        if (fallback.error) throw fallback.error;
      }
      setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    } catch (error) {
      console.error('Error marking all notifications as read:', error);
    }
  };

  useEffect(() => {
    if (!user) {
      setNotifications([]);
      setLoading(false);
      return;
    }

    registerForPushNotifications(user.id).catch(() => {});
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        registerForPushNotifications(user.id).catch(() => {});
      }
    });

    fetchNotifications();

    // Subscribe to real-time notifications
    const channel = supabase
      .channel(`user-notifications-${user.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          const newNotification = normalize(payload.new as any) as any;
          setNotifications(prev => [newNotification, ...prev]);
          (async () => {
            try {
              if (AppState.currentState !== 'active') return;
              const remoteEnabled = await AsyncStorage.getItem('remote_push_enabled');
              const shouldLocal = remoteEnabled !== '1';
              const title = String((newNotification as any)?.title || 'Notificación');
              const body =
                String((newNotification as any)?.message || '').trim() ||
                String((newNotification as any)?.body || '').trim() ||
                '';
              if (!body && !title) return;
              if (!shouldLocal) return;
              await scheduleLocalNotification(
                title || 'Notificación',
                body || title || '',
                (newNotification as any)?.data || {},
                1
              );
            } catch {}
          })();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
      sub.remove();
    };
  }, [user, fetchNotifications]);

  return (
    <NotificationContext.Provider value={{
      notifications,
      unreadCount,
      loading,
      fetchNotifications,
      markAsRead,
      markAllAsRead,
    }}>
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotifications() {
  const context = useContext(NotificationContext);
  if (context === undefined) {
    throw new Error('useNotifications must be used within a NotificationProvider');
  }
  return context;
}
