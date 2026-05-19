jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

jest.mock('@/lib/supabaseClient', () => ({
  supabase: {
    auth: { getSession: jest.fn(async () => ({ data: { session: null }, error: null })) },
    from: jest.fn(() => ({
      select: jest.fn(() => ({
        order: jest.fn(async () => ({ data: [], error: null })),
      })),
    })),
    channel: jest.fn(() => ({
      on: jest.fn().mockReturnThis(),
      subscribe: jest.fn(() => ({})),
    })),
    removeChannel: jest.fn(),
  },
}));

process.env.EXPO_PUBLIC_SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://test.local';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || 'test_anon_key';
const { __test_shouldApplyRemoteEvents } = require('@/lib/EventContext');

describe('events retention policy', () => {
  it('keeps previous events if remote temporarily returns empty within 72h', () => {
    const now = 1000 * 60 * 60 * 24 * 10;
    const lastGood = now - 1000 * 60 * 60 * 2;
    expect(__test_shouldApplyRemoteEvents(120, 0, lastGood, now)).toBe(false);
  });

  it('accepts empty remote after 72h', () => {
    const now = 1000 * 60 * 60 * 24 * 10;
    const lastGood = now - 1000 * 60 * 60 * 80;
    expect(__test_shouldApplyRemoteEvents(120, 0, lastGood, now)).toBe(true);
  });

  it('accepts remote non-empty always', () => {
    const now = 1000 * 60 * 60 * 24 * 10;
    const lastGood = now - 1000 * 60 * 60 * 1;
    expect(__test_shouldApplyRemoteEvents(120, 5, lastGood, now)).toBe(true);
  });
});
