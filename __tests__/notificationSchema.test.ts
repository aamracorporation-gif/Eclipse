import { normalizeNotificationRow } from '@/lib/notificationSchema';

describe('normalizeNotificationRow', () => {
  it('normaliza campos básicos y read=false por defecto', () => {
    const n = normalizeNotificationRow({
      id: '1',
      user_id: 'u',
      type: 'purchase_completed',
      created_at: '2026-01-01T00:00:00.000Z',
    });
    expect(n.id).toBe('1');
    expect(n.user_id).toBe('u');
    expect(n.type).toBe('purchase_completed');
    expect(n.read).toBe(false);
    expect(n.created_at).toBe('2026-01-01T00:00:00.000Z');
  });

  it('marca read=true si status=read', () => {
    const n = normalizeNotificationRow({
      id: '1',
      user_id: 'u',
      type: 'x',
      status: 'read',
      created_at: '2026-01-01T00:00:00.000Z',
    });
    expect(n.read).toBe(true);
  });

  it('marca read=true si read_at existe', () => {
    const n = normalizeNotificationRow({
      id: '1',
      user_id: 'u',
      type: 'x',
      read_at: '2026-01-01T00:00:00.000Z',
    });
    expect(n.read).toBe(true);
  });

  it('usa fallback para created_at si falta', () => {
    const before = Date.now();
    const n = normalizeNotificationRow({
      id: '1',
      user_id: 'u',
      type: 'x',
    });
    const created = new Date(n.created_at).getTime();
    const after = Date.now();
    expect(created).toBeGreaterThanOrEqual(before - 1000);
    expect(created).toBeLessThanOrEqual(after + 1000);
  });

  it('hace fallback a strings vacíos si faltan id/user_id/type', () => {
    const n = normalizeNotificationRow({});
    expect(n.id).toBe('');
    expect(n.user_id).toBe('');
    expect(n.type).toBe('');
  });
});
