-- Public discovery uses public_resale_cards. The transactional listing row,
-- including its ticket_id, is visible only to its seller, administrators and
-- trusted server code; all mutations go through reviewed RPCs.

DROP POLICY IF EXISTS "Admin can manage all resale listings" ON public.resale_listings;
DROP POLICY IF EXISTS "Anyone can view active resale listings" ON public.resale_listings;
DROP POLICY IF EXISTS "Sellers can view own listings" ON public.resale_listings;
DROP POLICY IF EXISTS "Users can create resale listings" ON public.resale_listings;
DROP POLICY IF EXISTS "Users can create resale listings for their tickets" ON public.resale_listings;
DROP POLICY IF EXISTS "Users can delete own resale listings" ON public.resale_listings;
DROP POLICY IF EXISTS "Users can delete their own listings" ON public.resale_listings;
DROP POLICY IF EXISTS "Users can delete their own resale listings" ON public.resale_listings;
DROP POLICY IF EXISTS "Users can update their own listings" ON public.resale_listings;
DROP POLICY IF EXISTS "Users can view active resale listings" ON public.resale_listings;
DROP POLICY IF EXISTS "Users can view their own listings" ON public.resale_listings;

CREATE POLICY resale_listings_seller_read
ON public.resale_listings FOR SELECT TO authenticated
USING ((SELECT auth.uid()) = seller_id);

CREATE POLICY resale_listings_admin_read
ON public.resale_listings FOR SELECT TO authenticated
USING ((SELECT private.is_current_user_admin()));

REVOKE ALL ON TABLE public.resale_listings FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.resale_listings TO authenticated;
GRANT ALL ON TABLE public.resale_listings TO service_role;
