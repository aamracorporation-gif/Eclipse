-- Profiles contain private identity, tax, payout and suspension data. Publish a
-- deliberately small projection and restrict the source table to its owner,
-- reviewed administrators and the service role.

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;

CREATE OR REPLACE FUNCTION private.is_current_user_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND role = 'admin'
      AND coalesce(is_suspended, false) = false
  );
$$;
REVOKE ALL ON FUNCTION private.is_current_user_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.is_current_user_admin() TO authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.public_profile_cards (
  id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  full_name text,
  avatar_url text,
  club_name text,
  verification_status text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.public_profile_cards ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS public_profile_cards_read ON public.public_profile_cards;
CREATE POLICY public_profile_cards_read
ON public.public_profile_cards FOR SELECT
TO anon, authenticated
USING (true);

REVOKE ALL ON TABLE public.public_profile_cards FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.public_profile_cards TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.public_profile_cards TO service_role;

INSERT INTO public.public_profile_cards (
  id, full_name, avatar_url, club_name,
  verification_status, updated_at
)
SELECT id, full_name, avatar_url, club_name,
       verification_status, now()
FROM public.profiles
ON CONFLICT (id) DO UPDATE SET
  full_name = excluded.full_name,
  avatar_url = excluded.avatar_url,
  club_name = excluded.club_name,
  verification_status = excluded.verification_status,
  updated_at = now();

CREATE OR REPLACE FUNCTION public.sync_public_profile_card()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  INSERT INTO public.public_profile_cards (
    id, full_name, avatar_url, club_name,
    verification_status, updated_at
  ) VALUES (
    NEW.id, NEW.full_name, NEW.avatar_url, NEW.club_name,
    NEW.verification_status, now()
  )
  ON CONFLICT (id) DO UPDATE SET
    full_name = excluded.full_name,
    avatar_url = excluded.avatar_url,
    club_name = excluded.club_name,
    verification_status = excluded.verification_status,
    updated_at = now();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.sync_public_profile_card() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_sync_public_profile_card ON public.profiles;
CREATE TRIGGER trg_sync_public_profile_card
AFTER INSERT OR UPDATE OF full_name, avatar_url, club_name, verification_status
ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.sync_public_profile_card();

CREATE OR REPLACE FUNCTION public.protect_profile_privileged_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT private.is_current_user_admin() THEN
    IF NEW.id IS DISTINCT FROM OLD.id
      OR NEW.role IS DISTINCT FROM OLD.role
      OR NEW.verification_status IS DISTINCT FROM OLD.verification_status
      OR NEW.verification_reviewed_at IS DISTINCT FROM OLD.verification_reviewed_at
      OR NEW.verification_reviewed_by IS DISTINCT FROM OLD.verification_reviewed_by
      OR NEW.verification_rejection_reason IS DISTINCT FROM OLD.verification_rejection_reason
      OR NEW.stripe_account_id IS DISTINCT FROM OLD.stripe_account_id
      OR NEW.stripe_account_type IS DISTINCT FROM OLD.stripe_account_type
      OR NEW.stripe_details_submitted IS DISTINCT FROM OLD.stripe_details_submitted
      OR NEW.stripe_charges_enabled IS DISTINCT FROM OLD.stripe_charges_enabled
      OR NEW.stripe_payouts_enabled IS DISTINCT FROM OLD.stripe_payouts_enabled
      OR NEW.stripe_onboarding_completed IS DISTINCT FROM OLD.stripe_onboarding_completed
      OR NEW.stripe_onboarding_completed_at IS DISTINCT FROM OLD.stripe_onboarding_completed_at
      OR NEW.is_suspended IS DISTINCT FROM OLD.is_suspended
      OR NEW.suspended_at IS DISTINCT FROM OLD.suspended_at
      OR NEW.suspended_by IS DISTINCT FROM OLD.suspended_by
      OR NEW.suspended_reason IS DISTINCT FROM OLD.suspended_reason
    THEN
      RAISE EXCEPTION 'Privileged profile fields cannot be changed by the user'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.protect_profile_privileged_fields() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_protect_profile_privileged_fields ON public.profiles;
CREATE TRIGGER trg_protect_profile_privileged_fields
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.protect_profile_privileged_fields();

DROP POLICY IF EXISTS "Admin can manage all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Public profiles are viewable by everyone" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can read own stripe data" ON public.profiles;

DROP POLICY IF EXISTS profiles_admin_all ON public.profiles;
CREATE POLICY profiles_admin_all
ON public.profiles FOR ALL TO authenticated
USING ((SELECT private.is_current_user_admin()))
WITH CHECK ((SELECT private.is_current_user_admin()));

DROP POLICY IF EXISTS profiles_update_own ON public.profiles;
CREATE POLICY profiles_update_own
ON public.profiles FOR UPDATE TO authenticated
USING ((SELECT auth.uid()) = id)
WITH CHECK ((SELECT auth.uid()) = id);

REVOKE ALL ON TABLE public.profiles FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.profiles TO authenticated;
GRANT ALL ON TABLE public.profiles TO service_role;
