/** Push contents never authorize navigation. Open the authenticated inbox first. */
export const notificationIdIsValid = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

export function notificationInboxRoute(data: Record<string, unknown> | null | undefined) {
  const id = data?.notification_id;
  return notificationIdIsValid(id)
    ? { pathname: '/notifications' as const, params: { notificationId: id } }
    : { pathname: '/notifications' as const };
}

/** Call with a notification reloaded under RLS, never with a raw push payload. */
export function notificationAction(row: { user_id: string; role?: string; type: string; event_id?: string | null }, userId: string, profileRole?: string | null) {
  if (row.user_id !== userId) return null;
  if (row.role === 'organizer') return profileRole === 'organizer'
    ? { label: 'Abrir mi panel', path: '/(creator)/' } : null;
  if (row.role === 'admin' || row.role === 'staff') return null; // Operational routes require their own permission review.
  if (row.type.startsWith('event.') && row.type !== 'event.cancelled' && notificationIdIsValid(row.event_id)) {
    return { label: 'Ver evento', path: `/(tabs)/event/${row.event_id}` };
  }
  if (/^(order\.|ticket\.|refund\.|purchase_|compra_|ticket_)/.test(row.type)) {
    return { label: 'Ver mis entradas', path: '/(tabs)/tickets' };
  }
  return null;
}

/** Preserve PostgreSQL microseconds: converting to Date.toISOString() can skip rows at a page boundary. */
export function notificationCursorIsValid(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
}
