-- Organizer verification system (schema + RLS + storage)

-- 1) Profiles: ensure core columns exist (role + organizer fields used by the app)
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS role text CHECK (role IN ('organizer', 'attendee', 'admin'));

ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS club_name text,
ADD COLUMN IF NOT EXISTS address text,
ADD COLUMN IF NOT EXISTS phone text,
ADD COLUMN IF NOT EXISTS opening_hours text,
ADD COLUMN IF NOT EXISTS instagram_account text,
ADD COLUMN IF NOT EXISTS business_email text;

ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS first_name text,
ADD COLUMN IF NOT EXISTS last_name text,
ADD COLUMN IF NOT EXISTS age int,
ADD COLUMN IF NOT EXISTS gender text,
ADD COLUMN IF NOT EXISTS city text,
ADD COLUMN IF NOT EXISTS country text,
ADD COLUMN IF NOT EXISTS music_preferences text[];

-- 2) Verification status and review metadata (status lives in profiles)
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS verification_status text CHECK (verification_status IN ('pending_verification', 'verified', 'rejected')),
ADD COLUMN IF NOT EXISTS verification_reviewed_at timestamptz,
ADD COLUMN IF NOT EXISTS verification_reviewed_by uuid REFERENCES auth.users(id),
ADD COLUMN IF NOT EXISTS verification_rejection_reason text;

UPDATE public.profiles
SET verification_status = 'pending_verification'
WHERE role = 'organizer'
  AND verification_status IS NULL;

-- 3) Organizer verification documents (kept separate from profiles to avoid leaking paths via public profiles)
CREATE TABLE IF NOT EXISTS public.organizer_verification_documents (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  business_license_path text,
  tax_id_path text,
  venue_photo_path text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.organizer_verification_documents ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.bump_organizer_verification_on_docs_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  NEW.updated_at := now();

  UPDATE public.profiles
  SET
    verification_status = 'pending_verification',
    verification_rejection_reason = NULL,
    verification_reviewed_at = NULL,
    verification_reviewed_by = NULL,
    updated_at = now()
  WHERE id = NEW.user_id
    AND role = 'organizer'
    AND COALESCE(verification_status, 'pending_verification') <> 'verified';

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS organizer_verification_documents_touch ON public.organizer_verification_documents;
CREATE TRIGGER organizer_verification_documents_touch
  BEFORE INSERT OR UPDATE ON public.organizer_verification_documents
  FOR EACH ROW
  EXECUTE FUNCTION public.bump_organizer_verification_on_docs_change();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'organizer_verification_documents'
      AND policyname = 'Users manage own organizer documents'
  ) THEN
    CREATE POLICY "Users manage own organizer documents"
    ON public.organizer_verification_documents
    FOR ALL
    TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'organizer_verification_documents'
      AND policyname = 'Admins manage all organizer documents'
  ) THEN
    CREATE POLICY "Admins manage all organizer documents"
    ON public.organizer_verification_documents
    FOR ALL
    TO authenticated
    USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'))
    WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));
  END IF;
END $$;

-- 4) Profiles update policy: allow users to edit their profile but not role/status
-- This prevents a user from self-upgrading to "admin" or "verified".
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
  AND verification_status IS NOT DISTINCT FROM (SELECT p.verification_status FROM public.profiles p WHERE p.id = auth.uid())
);

-- 5) Trigger: create profile using signup metadata, and set organizer status to pending by default
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_role text;
  v_verification_status text;
BEGIN
  v_role := COALESCE(NEW.raw_user_meta_data->>'role', 'attendee');
  IF v_role = 'organizer' THEN
    v_verification_status := 'pending_verification';
  ELSE
    v_verification_status := NULL;
  END IF;

  INSERT INTO public.profiles (
    id,
    email,
    full_name,
    avatar_url,
    role,
    club_name,
    address,
    phone,
    opening_hours,
    instagram_account,
    business_email,
    first_name,
    last_name,
    age,
    gender,
    city,
    country,
    music_preferences,
    verification_status
  )
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    NEW.raw_user_meta_data->>'avatar_url',
    v_role,
    NEW.raw_user_meta_data->>'club_name',
    NEW.raw_user_meta_data->>'address',
    NEW.raw_user_meta_data->>'phone',
    NEW.raw_user_meta_data->>'opening_hours',
    NEW.raw_user_meta_data->>'instagram_account',
    NEW.raw_user_meta_data->>'business_email',
    NEW.raw_user_meta_data->>'first_name',
    NEW.raw_user_meta_data->>'last_name',
    CAST(NULLIF(NEW.raw_user_meta_data->>'age', '') AS INTEGER),
    NEW.raw_user_meta_data->>'gender',
    NEW.raw_user_meta_data->>'city',
    NEW.raw_user_meta_data->>'country',
    ARRAY(SELECT jsonb_array_elements_text(COALESCE(NEW.raw_user_meta_data->'music_preferences', '[]'::jsonb))),
    v_verification_status
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    full_name = EXCLUDED.full_name,
    avatar_url = EXCLUDED.avatar_url,
    role = EXCLUDED.role,
    club_name = EXCLUDED.club_name,
    address = EXCLUDED.address,
    phone = EXCLUDED.phone,
    opening_hours = EXCLUDED.opening_hours,
    instagram_account = EXCLUDED.instagram_account,
    business_email = EXCLUDED.business_email,
    first_name = EXCLUDED.first_name,
    last_name = EXCLUDED.last_name,
    age = EXCLUDED.age,
    gender = EXCLUDED.gender,
    city = EXCLUDED.city,
    country = EXCLUDED.country,
    music_preferences = EXCLUDED.music_preferences,
    verification_status = COALESCE(public.profiles.verification_status, EXCLUDED.verification_status),
    updated_at = now();

  INSERT INTO public.wallets (user_id, balance)
  VALUES (NEW.id, 0)
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- 6) Admin RPC: approve/reject organizer verification
CREATE OR REPLACE FUNCTION public.admin_set_organizer_verification(
  p_user_id uuid,
  p_status text,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF p_status NOT IN ('pending_verification', 'verified', 'rejected') THEN
    RAISE EXCEPTION 'Invalid status';
  END IF;

  UPDATE public.profiles
  SET
    verification_status = p_status,
    verification_rejection_reason = CASE WHEN p_status = 'rejected' THEN COALESCE(p_reason, '') ELSE NULL END,
    verification_reviewed_at = now(),
    verification_reviewed_by = auth.uid(),
    updated_at = now()
  WHERE id = p_user_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_set_organizer_verification(uuid, text, text) TO authenticated;

-- 7) Restrict event publishing to verified organizers (DB-level enforcement)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'events'
      AND policyname = 'Authenticated users can create events'
  ) THEN
    EXECUTE 'DROP POLICY "Authenticated users can create events" ON public.events';
  END IF;
END $$;

CREATE POLICY "Authenticated users can create events"
ON public.events
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = creator_id
  AND EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.role = 'organizer'
      AND p.verification_status = 'verified'
  )
);

DROP POLICY IF EXISTS "Users can update their own events" ON public.events;
CREATE POLICY "Users can update their own events"
ON public.events
FOR UPDATE
TO authenticated
USING (
  auth.uid() = creator_id
  AND EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND (
        (p.role = 'organizer' AND p.verification_status = 'verified')
        OR p.role = 'admin'
      )
  )
)
WITH CHECK (
  auth.uid() = creator_id
  AND EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND (
        (p.role = 'organizer' AND p.verification_status = 'verified')
        OR p.role = 'admin'
      )
  )
);

DROP POLICY IF EXISTS "Users can delete their own events" ON public.events;
CREATE POLICY "Users can delete their own events"
ON public.events
FOR DELETE
TO authenticated
USING (
  auth.uid() = creator_id
  AND EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND (
        (p.role = 'organizer' AND p.verification_status = 'verified')
        OR p.role = 'admin'
      )
  )
);

DROP POLICY IF EXISTS "Authenticated users can insert venues" ON public.venues;
CREATE POLICY "Authenticated users can insert venues"
ON public.venues
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND (
        (p.role = 'organizer' AND p.verification_status = 'verified')
        OR p.role = 'admin'
      )
  )
);

DROP POLICY IF EXISTS "Creators can insert ticket types" ON public.event_ticket_types;
CREATE POLICY "Creators can insert ticket types"
ON public.event_ticket_types
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.id = event_ticket_types.event_id
      AND e.creator_id = auth.uid()
  )
  AND EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND (
        (p.role = 'organizer' AND p.verification_status = 'verified')
        OR p.role = 'admin'
      )
  )
);

DROP POLICY IF EXISTS "Creators can update ticket types" ON public.event_ticket_types;
CREATE POLICY "Creators can update ticket types"
ON public.event_ticket_types
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.id = event_ticket_types.event_id
      AND e.creator_id = auth.uid()
  )
  AND EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND (
        (p.role = 'organizer' AND p.verification_status = 'verified')
        OR p.role = 'admin'
      )
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.id = event_ticket_types.event_id
      AND e.creator_id = auth.uid()
  )
  AND EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND (
        (p.role = 'organizer' AND p.verification_status = 'verified')
        OR p.role = 'admin'
      )
  )
);

DROP POLICY IF EXISTS "Creators can delete ticket types" ON public.event_ticket_types;
CREATE POLICY "Creators can delete ticket types"
ON public.event_ticket_types
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.id = event_ticket_types.event_id
      AND e.creator_id = auth.uid()
  )
  AND EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND (
        (p.role = 'organizer' AND p.verification_status = 'verified')
        OR p.role = 'admin'
      )
  )
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'events_creator_id_fkey_profiles'
      AND table_name = 'events'
  ) THEN
    ALTER TABLE public.events
    ADD CONSTRAINT events_creator_id_fkey_profiles
    FOREIGN KEY (creator_id)
    REFERENCES public.profiles(id);
  END IF;
END $$;

-- 8) Storage bucket for verification docs (private)
INSERT INTO storage.buckets (id, name, public)
VALUES ('organizer_verification', 'organizer_verification', false)
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
  BEGIN
    EXECUTE 'ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY';

    EXECUTE 'DROP POLICY IF EXISTS "Organizer verification: read own or admin" ON storage.objects';
    EXECUTE $policy$
      CREATE POLICY "Organizer verification: read own or admin"
      ON storage.objects
      FOR SELECT
      TO authenticated
      USING (
        bucket_id = 'organizer_verification'
        AND (
          auth.uid() = owner
          OR auth.uid()::text = (storage.foldername(name))[1]
          OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
        )
      )
    $policy$;

    EXECUTE 'DROP POLICY IF EXISTS "Organizer verification: upload to own folder" ON storage.objects';
    EXECUTE $policy$
      CREATE POLICY "Organizer verification: upload to own folder"
      ON storage.objects
      FOR INSERT
      TO authenticated
      WITH CHECK (
        bucket_id = 'organizer_verification'
        AND auth.uid()::text = (storage.foldername(name))[1]
      )
    $policy$;

    EXECUTE 'DROP POLICY IF EXISTS "Organizer verification: update own or admin" ON storage.objects';
    EXECUTE $policy$
      CREATE POLICY "Organizer verification: update own or admin"
      ON storage.objects
      FOR UPDATE
      TO authenticated
      USING (
        bucket_id = 'organizer_verification'
        AND (
          auth.uid() = owner
          OR auth.uid()::text = (storage.foldername(name))[1]
          OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
        )
      )
      WITH CHECK (
        bucket_id = 'organizer_verification'
        AND (
          auth.uid() = owner
          OR auth.uid()::text = (storage.foldername(name))[1]
          OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
        )
      )
    $policy$;

    EXECUTE 'DROP POLICY IF EXISTS "Organizer verification: delete own or admin" ON storage.objects';
    EXECUTE $policy$
      CREATE POLICY "Organizer verification: delete own or admin"
      ON storage.objects
      FOR DELETE
      TO authenticated
      USING (
        bucket_id = 'organizer_verification'
        AND (
          auth.uid() = owner
          OR auth.uid()::text = (storage.foldername(name))[1]
          OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
        )
      )
    $policy$;
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL;
  END;
END $$;

NOTIFY pgrst, 'reload schema';
