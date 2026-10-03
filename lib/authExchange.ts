/** Share one exchange across effect replays for this mounted auth screen.
 * Failed links stay failed; retrying requires a fresh link. Nothing is persisted.
 */
export function createAuthExchange() {
  let lastKey: string | undefined;
  let lastResult: Promise<void> | undefined;
  return (key: string, exchange: () => Promise<void>): Promise<void> => {
    if (key === lastKey && lastResult) return lastResult;
    lastKey = key;
    lastResult = Promise.resolve().then(exchange);
    return lastResult;
  };
}
