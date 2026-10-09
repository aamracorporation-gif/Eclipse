import { LAUNCH_FEATURES, checkoutUnavailableReason } from '../supabase/functions/_shared/launchPolicy';

describe('launch checkout scope', () => {
  it('keeps deferred features off', () => {
    expect(LAUNCH_FEATURES).toEqual({ resale: false, walletCredit: false });
    expect(Object.isFrozen(LAUNCH_FEATURES)).toBe(true);
  });
  it.each(['event_ticket', 'vip_table'])('allows %s with no wallet debit', kind => {
    expect(checkoutUnavailableReason({ kind })).toBeNull();
    expect(checkoutUnavailableReason({ kind, credit_debit_eur: 0 })).toBeNull();
  });
  it.each(['resale_ticket', 'wallet_topup'])('rejects %s', kind => {
    expect(checkoutUnavailableReason({ kind })).not.toBeNull();
  });
  it.each(['credit_debit_eur', 'wallet_debit_eur', 'credit_debit_cents', 'wallet_debit_cents'])('rejects %s including hidden aliases', key => {
    for (const value of [1, '1', -1, 'invalid', {}, true]) {
      expect(checkoutUnavailableReason({ kind: 'event_ticket', [key]: value })).not.toBeNull();
    }
  });
  it('does not let a zero primary field mask a nonzero legacy alias', () => {
    expect(checkoutUnavailableReason({ kind: 'vip_table', credit_debit_eur: 0, wallet_debit_eur: 5 })).not.toBeNull();
  });
});
