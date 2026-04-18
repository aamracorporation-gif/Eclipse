-- Fix RLS policies for resale_listings to allow deletion/cancellation
-- Users should be able to delete their own listings

-- Drop the policy if it already exists to prevent errors
DROP POLICY IF EXISTS "Users can delete their own resale listings" ON public.resale_listings;

CREATE POLICY "Users can delete their own resale listings"
ON public.resale_listings
FOR DELETE
TO authenticated
USING (auth.uid() = seller_id);

-- Ensure RLS is enabled (just in case)
ALTER TABLE public.resale_listings ENABLE ROW LEVEL SECURITY;
