-- Add birthdate column to profiles for all user types
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS birthdate date;
