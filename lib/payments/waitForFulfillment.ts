import type { ConfirmPaymentResponse } from './types';

/** A delayed webhook or a lost status response is not evidence of a failed charge. */
export async function waitForFulfillment(
  readStatus: () => Promise<ConfirmPaymentResponse>,
  options: { attempts?: number; intervalMs?: number; sleep?: (ms: number) => Promise<void> } = {}
): Promise<ConfirmPaymentResponse | null> {
  const { attempts = 8, intervalMs = 1500, sleep = (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)) } = options;
  let last: ConfirmPaymentResponse | null = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      last = await readStatus();
      if (last.fulfilled || ['canceled', 'cancelled', 'refunded'].includes(last.status || '')) return last;
    } catch {
      // A timeout cannot establish whether Stripe charged the customer.
    }
    if (attempt + 1 < attempts) await sleep(intervalMs);
  }
  return last;
}
