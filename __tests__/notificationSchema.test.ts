import { normalizeNotificationRow } from '@/lib/notificationSchema';

describe('normalizeNotificationRow', () => {
  it('marks read when status is read', () => {
    const n = normalizeNotificationRow({ id: '1', user_id: 'u', type: 'x', status: 'read' });
    expect(n.read).toBe(true);
  });

  it('marks read when read_at exists', () => {
    const n = normalizeNotificationRow({ id: '1', user_id: 'u', type: 'x', read_at: new Date().toISOString() });
    expect(n.read).toBe(true);
  });

  it('keeps unread when no read signals exist', () => {
    const n = normalizeNotificationRow({ id: '1', user_id: 'u', type: 'x' });
    expect(n.read).toBe(false);
  });
});

