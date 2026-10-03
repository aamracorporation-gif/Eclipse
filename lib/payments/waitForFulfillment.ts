import type { ConfirmPaymentResponse } from './types';

export function getRefundMessage(status?: string): string | null {
  if (status === 'refund_pending') return 'La entrada ya no estaba disponible. La compra no se ha completado y la devolución está en trámite.';
  if (status === 'refunded') return 'La entrada ya no estaba disponible y se ha tramitado la devolución. Tu banco puede tardar unos días en reflejarla.';
  if (status === 'refund_failed') return 'La compra no se ha completado y no se pudo tramitar la devolución automáticamente. Contacta con soporte para revisar el pago.';
  return null;
}

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
      if (last.fulfilled || ['canceled', 'cancelled'].includes(last.status || '') || getRefundMessage(last.status)) return last;
    } catch {
      // A timeout cannot establish whether Stripe charged the customer.
    }
    if (attempt + 1 < attempts) await sleep(intervalMs);
  }
  return last;
}
