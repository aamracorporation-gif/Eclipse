import { canAccessOrganizerPanel, CreatorAccessProfile } from '../lib/creatorAccess';
const ready: CreatorAccessProfile = { role: 'organizer', verification_status: 'verified', stripe_account_id: 'acct_test', stripe_onboarding_completed: true, stripe_charges_enabled: true, is_suspended: false };
describe('organizer panel eligibility', () => {
  it('admits an approved organizer with completed Stripe onboarding', () => expect(canAccessOrganizerPanel(ready)).toBe(true));
  it.each([
    { role: 'attendee' }, { role: 'admin' }, { verification_status: 'pending_verification' },
    { verification_status: 'rejected' }, { verification_status: 'needs_correction' },
    { stripe_account_id: null }, { stripe_onboarding_completed: false },
    { stripe_onboarding_completed: null }, { stripe_charges_enabled: false }, { is_suspended: true },
  ])('blocks incomplete or unauthorized profiles: %j', patch => {
    expect(canAccessOrganizerPanel({ ...ready, ...patch })).toBe(false);
  });
  it('fails closed for absent profile data', () => {
    expect(canAccessOrganizerPanel(null)).toBe(false);
    expect(canAccessOrganizerPanel({})).toBe(false);
  });
});
