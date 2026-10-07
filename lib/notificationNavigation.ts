/** Treat push data as untrusted. Fetch the owned notification before resolving any destination. */
export const NOTIFICATION_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type NotificationRole = 'attendee'|'organizer'|'staff'|'admin';
export const NOTIFICATION_ROLES: NotificationRole[]=['attendee','organizer','staff','admin'];
export const NOTIFICATION_ROLE_LABELS: Record<NotificationRole,string>={attendee:'Cliente',organizer:'Organizador',staff:'Trabajador',admin:'Administrador'};
export function notificationInboxLink(data: unknown, projectRef: string): string {
  const value=data && typeof data==='object'?data as Record<string,unknown>:{};
  if (value.notification_schema!==2 || value.project_ref!==projectRef || !NOTIFICATION_UUID.test(String(value.notification_id??''))) return '/notifications';
  return `/notifications?notification_id=${value.notification_id}`;
}
export function isSafeNotificationDestination(value: unknown): value is string {
  if (typeof value!=='string') return false;
  return ['/notifications','/(tabs)/tickets','/(creator)/','/(worker)/','/(creator)/admin-profile'].includes(value)
    || (value.startsWith('/(tabs)/event/') && NOTIFICATION_UUID.test(value.slice('/(tabs)/event/'.length)));
}
export function parseNotificationClock(value: string): number|null {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return null;
  const [h,m]=value.split(':').map(Number);return h*60+m;
}
export function notificationClock(value: number): string {
  return `${String(Math.floor(value/60)).padStart(2,'0')}:${String(value%60).padStart(2,'0')}`;
}
