import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { AppState } from 'react-native';
import { supabase } from './supabase';
import { useAuth } from './AuthContext';
import { normalizeNotificationRow, type NotificationModel } from './notificationSchema';
import { notificationIdIsValid, notificationCursorIsValid } from './notificationRouting';
import { registerForPushNotifications, setNotificationUser, observePushTokenChanges } from './notifications';
export type Notification = NotificationModel;
const PAGE = 50;
type State = { owner: string | null; notifications: Notification[]; unreadCount: number; loading: boolean; error: string | null; hasMore: boolean };
const empty = (owner: string | null): State => ({ owner, notifications: [], unreadCount: 0, loading: !!owner, error: null, hasMore: false });
type Context = Omit<State, 'owner'> & {
  fetchNotifications: () => Promise<void>; loadMore: () => Promise<void>;
  markAsRead: (id: string) => Promise<void>; markAllAsRead: () => Promise<void>;
  deleteNotification: (id: string) => Promise<void>; deleteAllNotifications: () => Promise<void>;
};
const NotificationContext = createContext<Context | undefined>(undefined);
export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const uid = user?.id ?? null;
  const identity = useRef({ uid, epoch: 0 });
  if (identity.current.uid !== uid) identity.current = { uid, epoch: identity.current.epoch + 1 };
  const [state, setState] = useState<State>(() => empty(uid));
  const request = useRef(0);
  const fetchingMore = useRef(false);
  const currentState = useRef(state); currentState.current = state;
  const fetchNotifications = useCallback(async () => {
    if (!uid) return;
    const epoch = identity.current.epoch, seq = ++request.current;
    try {
      const [rows, count] = await Promise.all([
        supabase.from('notifications').select('*').eq('user_id', uid).is('archived_at', null)
          .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(PAGE),
        supabase.rpc('core_notification_unread_count'),
      ]);
      if (rows.error || count.error) throw new Error('load');
      if (identity.current.uid !== uid || identity.current.epoch !== epoch || seq !== request.current) return;
      setState({ owner: uid, notifications: (rows.data ?? []).map(normalizeNotificationRow),
        unreadCount: Number(count.data ?? 0), loading: false, error: null, hasMore: rows.data?.length === PAGE });
    } catch {
      if (identity.current.uid === uid && identity.current.epoch === epoch && seq === request.current) {
        setState(old => ({ ...(old.owner === uid ? old : empty(uid)), loading: false, error: 'No se pudieron cargar las notificaciones. Reintenta.' }));
      }
    }
  }, [uid]);
  const loadMore = useCallback(async () => {
    const before = currentState.current;
    if (!uid || before.owner !== uid || !before.hasMore || fetchingMore.current) return;
    const last = before.notifications[before.notifications.length - 1];
    if (!last || !notificationIdIsValid(last.id) || !notificationCursorIsValid(last.created_at)) return;
    const cursor = last.created_at;
    const epoch = identity.current.epoch, seq = request.current;
    fetchingMore.current = true;
    try {
      const { data, error } = await supabase.from('notifications').select('*').eq('user_id', uid).is('archived_at', null)
        .or(`created_at.lt.${cursor},and(created_at.eq.${cursor},id.lt.${last.id})`)
        .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(PAGE);
      if (error) throw error;
      if (identity.current.uid !== uid || identity.current.epoch !== epoch || seq !== request.current) return;
      setState(old => ({ ...old, notifications: [...new Map([...old.notifications, ...(data ?? []).map(normalizeNotificationRow)].map(n => [n.id, n])).values()], hasMore: data?.length === PAGE, error: null }));
    } catch {
      if (identity.current.uid === uid && identity.current.epoch === epoch) setState(old => ({ ...old, error: 'No se pudieron cargar más avisos.' }));
    } finally { fetchingMore.current = false; }
  }, [uid]);
  const change = useCallback(async (id: string | null, read: boolean | null, archive: boolean | null) => {
    if (!uid || (id !== null && !notificationIdIsValid(id))) return;
    const epoch = identity.current.epoch;
    try {
      const { error } = await supabase.rpc('set_core_notification_state', { p_id: id, p_read: read, p_archive: archive, p_user: uid });
      if (identity.current.uid !== uid || identity.current.epoch !== epoch) return;
      if (error) throw error;
      await fetchNotifications();
    } catch {
      if (identity.current.uid === uid && identity.current.epoch === epoch) setState(old => ({ ...old, error: 'No se pudo guardar el cambio. Reintenta.' }));
    }
  }, [uid, fetchNotifications]);
  useEffect(() => {
    setState(empty(uid)); ++request.current;
    setNotificationUser(uid);
    if (!uid) return;
    void registerForPushNotifications(uid);
    const tokenSub = observePushTokenChanges(uid);
    void fetchNotifications();
    const sub = AppState.addEventListener('change', value => {
      if (value === 'active') { void fetchNotifications(); void registerForPushNotifications(uid); }
    });
    const channel = supabase.channel(`core-inbox-${uid}`).on('postgres_changes',
      { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${uid}` },
      () => { void fetchNotifications(); }).subscribe();
    return () => { sub.remove(); tokenSub.remove(); void supabase.removeChannel(channel); };
  }, [uid, fetchNotifications]);
  const visible = state.owner === uid ? state : empty(uid);
  return <NotificationContext.Provider value={{ ...visible, fetchNotifications, loadMore,
    markAsRead: id => change(id, true, null), markAllAsRead: () => change(null, true, null),
    deleteNotification: id => change(id, null, true), deleteAllNotifications: () => change(null, null, true),
  }}>{children}</NotificationContext.Provider>;
}
export function useNotifications() {
  const context = useContext(NotificationContext);
  if (!context) throw new Error('useNotifications must be used within a NotificationProvider');
  return context;
}
