export type NotificationPriority = 'low' | 'normal' | 'high';
export type NotificationStatus = 'pending' | 'sent' | 'failed' | 'blocked' | 'read';

export type NotificationRow = Record<string, any>;

export type NotificationModel = {
  id: string;
  user_id: string;
  role?: 'attendee' | 'organizer' | 'staff' | 'admin';
  title?: string;
  type: string;
  message?: string;
  body?: string;
  priority?: NotificationPriority;
  status?: NotificationStatus;
  data?: Record<string, unknown> | null;
  read: boolean;
  created_at: string;
};

export function normalizeNotificationRow(row: NotificationRow): NotificationModel {
  const read =
    row?.read === true ||
    row?.status === 'read' ||
    !!row?.read_at;

  return {
    id: String(row?.id || ''),
    user_id: String(row?.user_id || ''),
    role: row?.role,
    title: row?.title ?? undefined,
    type: String(row?.type || ''),
    message: row?.message ?? undefined,
    body: row?.body ?? undefined,
    priority: row?.priority ?? undefined,
    status: row?.status ?? undefined,
    data: row?.data ?? null,
    read,
    created_at: String(row?.created_at || new Date().toISOString()),
  };
}

