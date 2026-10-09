export type CreatorAccessProfile = {
  role?: string | null;
  verification_status?: string | null;
  stripe_account_id?: string | null;
  stripe_onboarding_completed?: boolean | null;
  stripe_charges_enabled?: boolean | null;
  is_suspended?: boolean | null;
};

export function canAccessOrganizerPanel(profile: CreatorAccessProfile | null): boolean {
  return !!profile && profile.role === 'organizer' && !profile.is_suspended &&
    profile.verification_status === 'verified' && !!profile.stripe_account_id &&
    profile.stripe_onboarding_completed === true && profile.stripe_charges_enabled === true;
}
