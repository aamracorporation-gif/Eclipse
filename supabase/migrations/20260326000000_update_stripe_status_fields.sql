
-- Update profiles to track Stripe Connect onboarding status
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS stripe_onboarding_completed boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS stripe_charges_enabled boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS stripe_payouts_enabled boolean DEFAULT false;

-- Re-run schema reload notification
NOTIFY pgrst, 'reload schema';
