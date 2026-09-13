-- Fix: sellers couldn't see their own sold listings because the only SELECT
-- policy required status = 'active'. Add a policy so sellers always see their own rows.
CREATE POLICY "Sellers can view own listings"
  ON public.resale_listings
  FOR SELECT
  USING (auth.uid() = seller_id);

NOTIFY pgrst, 'reload schema';
