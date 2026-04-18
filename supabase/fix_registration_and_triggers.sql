-- FIX REGISTRATION FLOW AND TRIGGERS
-- This script ensures the database handles the new registration flow correctly

-- 1. Ensure WALLETS table has currency
CREATE TABLE IF NOT EXISTS public.wallets (
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  balance numeric DEFAULT 0,
  currency text DEFAULT 'EUR',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Add currency column if it was missing (safe update)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'wallets' AND column_name = 'currency') THEN
    ALTER TABLE public.wallets ADD COLUMN currency text DEFAULT 'EUR';
  END IF;
END $$;

-- 2. Ensure PROFILES table has all necessary columns
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS role text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS club_name text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS address text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS opening_hours text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS first_name text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS last_name text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS age int;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS gender text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS city text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS country text;

-- 3. Ensure Club Name Uniqueness
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_club_name ON public.profiles(club_name) WHERE club_name IS NOT NULL;

-- 4. Create/Update the Trigger Function to handle Metadata
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_role text;
BEGIN
  v_role := NEW.raw_user_meta_data->>'role';

  -- Insert Profile with ALL metadata passed during SignUp
  INSERT INTO public.profiles (
    id, 
    email,
    full_name,
    role, 
    club_name, 
    address, 
    phone, 
    opening_hours,
    first_name, 
    last_name, 
    age, 
    gender, 
    city, 
    country,
    avatar_url
  )
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    v_role,
    NEW.raw_user_meta_data->>'club_name',
    NEW.raw_user_meta_data->>'address',
    NEW.raw_user_meta_data->>'phone',
    NEW.raw_user_meta_data->>'opening_hours',
    NEW.raw_user_meta_data->>'first_name',
    NEW.raw_user_meta_data->>'last_name',
    CAST(NULLIF(NEW.raw_user_meta_data->>'age', '') AS INTEGER),
    NEW.raw_user_meta_data->>'gender',
    NEW.raw_user_meta_data->>'city',
    NEW.raw_user_meta_data->>'country',
    NEW.raw_user_meta_data->>'avatar_url'
  )
  ON CONFLICT (id) DO UPDATE SET
    role = EXCLUDED.role,
    full_name = EXCLUDED.full_name,
    club_name = EXCLUDED.club_name,
    updated_at = now();

  -- Create Wallet automatically
  INSERT INTO public.wallets (user_id, balance, currency)
  VALUES (NEW.id, 0, 'EUR')
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

-- 5. Re-apply Trigger
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- 6. Helper function for validation
CREATE OR REPLACE FUNCTION public.check_club_name_exists(p_club_name text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN EXISTS (SELECT 1 FROM public.profiles WHERE lower(club_name) = lower(p_club_name));
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_club_name_exists TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_club_name_exists TO anon;
