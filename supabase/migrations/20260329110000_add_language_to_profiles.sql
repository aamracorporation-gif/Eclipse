-- Add language preference to profiles table
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS language text DEFAULT 'es';
DO $$
BEGIN
  ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_language_check
    CHECK (language IN ('es', 'en', 'fr', 'ar'));
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

-- Reload schema cache
NOTIFY pgrst, 'reload schema';
