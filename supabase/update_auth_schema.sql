-- Add new fields to profiles table for enhanced authentication flow
-- We add columns for both Organizers and Partygoers

-- 1. Add Role Column (if not exists, though we rely on metadata usually, having it in DB is good for RLS)
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS role text CHECK (role IN ('organizer', 'attendee', 'admin'));

-- 2. Add Organizer Fields
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS club_name text,
ADD COLUMN IF NOT EXISTS address text,
ADD COLUMN IF NOT EXISTS phone text,
ADD COLUMN IF NOT EXISTS opening_hours text;

-- Add unique constraint to club_name (only if not null)
-- We use a unique index instead of constraint to handle NULLs easily (though standard UNIQUE allows multiple NULLs in Postgres)
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_club_name ON public.profiles(club_name) WHERE club_name IS NOT NULL;

-- 3. Add Partygoer Fields
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS first_name text,
ADD COLUMN IF NOT EXISTS last_name text,
ADD COLUMN IF NOT EXISTS age int,
ADD COLUMN IF NOT EXISTS gender text,
ADD COLUMN IF NOT EXISTS city text,
ADD COLUMN IF NOT EXISTS country text;

-- 4. Update RLS policies to allow users to update their own profile with these new fields
-- (The existing policy "Users can update their own profile" should cover this if it's just USING(auth.uid() = id))
-- We verify it exists:
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'profiles' AND policyname = 'Users can update their own profile') THEN
    CREATE POLICY "Users can update their own profile" ON public.profiles FOR UPDATE USING (auth.uid() = id);
  END IF;
END $$;

-- 5. Function to check if club name exists (for real-time validation)
CREATE OR REPLACE FUNCTION public.check_club_name_exists(p_club_name text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN EXISTS (SELECT 1 FROM public.profiles WHERE lower(club_name) = lower(p_club_name));
END;
$$;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION public.check_club_name_exists TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_club_name_exists TO anon; -- For registration check
