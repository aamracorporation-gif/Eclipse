ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS stripe_account_id text,
ADD COLUMN IF NOT EXISTS stripe_account_type text CHECK (stripe_account_type IN ('express', 'standard', 'custom')),
ADD COLUMN IF NOT EXISTS stripe_details_submitted boolean NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS stripe_charges_enabled boolean NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS stripe_payouts_enabled boolean NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS stripe_onboarding_completed boolean NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS stripe_onboarding_completed_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_profiles_stripe_account_id ON public.profiles(stripe_account_id);

ALTER TABLE public.payment_transactions
ADD COLUMN IF NOT EXISTS platform_fee_cents integer NOT NULL DEFAULT 0 CHECK (platform_fee_cents >= 0),
ADD COLUMN IF NOT EXISTS destination_account_id text,
ADD COLUMN IF NOT EXISTS destination_amount_cents integer NOT NULL DEFAULT 0 CHECK (destination_amount_cents >= 0),
ADD COLUMN IF NOT EXISTS commission_bps integer NOT NULL DEFAULT 0 CHECK (commission_bps >= 0 AND commission_bps <= 10000);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'profiles'
      AND policyname = 'Users can update their own profile'
  ) THEN
    EXECUTE 'DROP POLICY "Users can update their own profile" ON public.profiles';
  END IF;
END $$;

CREATE POLICY "Users can update their own profile"
ON public.profiles
FOR UPDATE
TO authenticated
USING (auth.uid() = id)
WITH CHECK (
  auth.uid() = id
  AND role IS NOT DISTINCT FROM (SELECT p.role FROM public.profiles p WHERE p.id = auth.uid())
  AND stripe_account_id IS NOT DISTINCT FROM (SELECT p.stripe_account_id FROM public.profiles p WHERE p.id = auth.uid())
  AND stripe_account_type IS NOT DISTINCT FROM (SELECT p.stripe_account_type FROM public.profiles p WHERE p.id = auth.uid())
  AND stripe_details_submitted IS NOT DISTINCT FROM (SELECT p.stripe_details_submitted FROM public.profiles p WHERE p.id = auth.uid())
  AND stripe_charges_enabled IS NOT DISTINCT FROM (SELECT p.stripe_charges_enabled FROM public.profiles p WHERE p.id = auth.uid())
  AND stripe_payouts_enabled IS NOT DISTINCT FROM (SELECT p.stripe_payouts_enabled FROM public.profiles p WHERE p.id = auth.uid())
  AND stripe_onboarding_completed IS NOT DISTINCT FROM (SELECT p.stripe_onboarding_completed FROM public.profiles p WHERE p.id = auth.uid())
  AND stripe_onboarding_completed_at IS NOT DISTINCT FROM (SELECT p.stripe_onboarding_completed_at FROM public.profiles p WHERE p.id = auth.uid())
);

NOTIFY pgrst, 'reload schema';
