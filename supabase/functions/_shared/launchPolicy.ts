// Release scope approved 2026-09-30. React Native and Edge share this policy.
// Re-enabling requires the database migration and QA gates in docs/DEFERRED_RESALE_WALLET.md.
export const LAUNCH_FEATURES: Readonly<{ resale: boolean; walletCredit: boolean }> = Object.freeze({
  resale: false,
  walletCredit: false,
});

export function checkoutUnavailableReason(body: Record<string, unknown>): string | null {
  if (!LAUNCH_FEATURES.resale && body.kind === 'resale_ticket') {
    return 'La reventa no está disponible en esta versión.';
  }
  if (!LAUNCH_FEATURES.walletCredit) {
    if (body.kind === 'wallet_topup') return 'El monedero de saldo no está disponible en esta versión.';
    for (const key of ['credit_debit_eur', 'wallet_debit_eur', 'credit_debit_cents', 'wallet_debit_cents']) {
      const value = body[key];
      if (value != null && value !== '' && Number(value) !== 0) {
        return 'El pago con saldo no está disponible en esta versión.';
      }
    }
  }
  return null;
}
