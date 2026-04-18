-- Fix for frontend query: Add explicit Foreign Key from events.creator_id to profiles.id
-- This allows PostgREST to resolve the relation "profiles:creator_id"

DO $$
BEGIN
  -- Drop existing FK to auth.users if strictly necessary, but usually we can add a second one or replace it.
  -- To be safe and avoid conflicts, we'll try to add the one to profiles.
  -- Note: If constraint "events_creator_id_fkey" exists (to auth.users), we might want to keep it for referential integrity 
  -- OR replace it if we want the API to see the relationship to profiles.
  
  -- PostgREST prioritizes relationships to tables in the exposed schema (public).
  -- Since auth.users is hidden, we NEED the FK to public.profiles.

  -- Check if constraint already exists
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
