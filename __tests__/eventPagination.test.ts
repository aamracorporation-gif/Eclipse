jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

jest.mock('@/lib/supabaseClient', () => ({
  supabase: {
    auth: { getSession: jest.fn(async () => ({ data: { session: null }, error: null })) },
  },
}));

process.env.EXPO_PUBLIC_SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://test.local';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || 'test_anon_key';

const { __test_collectPaginatedRows } = require('@/lib/EventContext');

describe('event pagination', () => {
  it('collects every full page and the final partial page without overlap', async () => {
    const source = Array.from({ length: 425 }, (_, id) => ({ id }));
    const fetchPage = jest.fn(async (from: number, to: number) => ({
      data: source.slice(from, to + 1),
      error: null,
    }));

    await expect(__test_collectPaginatedRows(fetchPage, 200)).resolves.toEqual(source);
    expect(fetchPage.mock.calls).toEqual([
      [0, 199],
      [200, 399],
      [400, 599],
    ]);
  });

  it('stops immediately when the first page is empty', async () => {
    const fetchPage = jest.fn(async () => ({ data: [], error: null }));

    await expect(__test_collectPaginatedRows(fetchPage, 200)).resolves.toEqual([]);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it('propagates a page failure and never returns a partial catalogue', async () => {
    const failure = new Error('page unavailable');
    const fetchPage = jest
      .fn()
      .mockResolvedValueOnce({ data: Array.from({ length: 2 }, (_, id) => ({ id })), error: null })
      .mockResolvedValueOnce({ data: null, error: failure });

    await expect(__test_collectPaginatedRows(fetchPage, 2)).rejects.toBe(failure);
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });
});
