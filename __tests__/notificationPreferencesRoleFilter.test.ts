jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

jest.mock('@/lib/supabase', () => ({
  supabase: {},
}));

jest.mock('expo-notifications', () => ({}));

const { __test_getVisiblePreferenceKeys } = require('@/app/notification-preferences');

describe('notification preferences role filtering', () => {
  it('oculta por completo las opciones de organizador para clientes', () => {
    const keys = __test_getVisiblePreferenceKeys('attendee');
    expect(keys).toEqual(['purchase_updates', 'event_reminders']);
    expect(keys).not.toContain('stock_alerts');
    expect(keys).not.toContain('realtime_sales');
    expect(keys).not.toContain('daily_summary');
    expect(keys).not.toContain('stock_threshold_alerts');
  });

  it('mantiene disponibles las opciones de organizador para organizadores', () => {
    const keys = __test_getVisiblePreferenceKeys('organizer');
    expect(keys).toContain('purchase_updates');
    expect(keys).toContain('event_reminders');
    expect(keys).not.toContain('resale_updates');
    expect(keys).toContain('stock_alerts');
    expect(keys).toContain('realtime_sales');
    expect(keys).toContain('daily_summary');
    expect(keys).toContain('stock_threshold_alerts');
  });
});
