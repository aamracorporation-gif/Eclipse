import { createAuthExchange } from '@/lib/authExchange';

describe('one-use auth exchange', () => {
  it('shares in-flight and completed exchanges across effect replays', async () => {
    const run = createAuthExchange();
    const exchange = jest.fn(async () => {});
    const first = run('code-a', exchange);
    expect(run('code-a', exchange)).toBe(first);
    await first;
    await run('code-a', exchange);
    expect(exchange).toHaveBeenCalledTimes(1);
    await run('code-b', exchange);
    expect(exchange).toHaveBeenCalledTimes(2);
  });

  it('does not hide or retry an expired link and accepts a fresh link', async () => {
    const run = createAuthExchange();
    const expired = jest.fn(async () => { throw new Error('expired'); });
    await expect(run('old', expired)).rejects.toThrow('expired');
    await expect(run('old', expired)).rejects.toThrow('expired');
    expect(expired).toHaveBeenCalledTimes(1);
    await expect(run('new', async () => {})).resolves.toBeUndefined();
  });
});
