-- Never expose ticket rows (QRs, security hashes and ownership) to anonymous
-- resale browsing. Publish a synchronized projection with display-only fields.

CREATE TABLE IF NOT EXISTS public.public_resale_cards (
  listing_id uuid PRIMARY KEY REFERENCES public.resale_listings(id) ON DELETE CASCADE,
  seller_id uuid NOT NULL REFERENCES public.public_profile_cards(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  price numeric NOT NULL,
  created_at timestamptz NOT NULL,
  ticket_type_id uuid,
  quantity integer,
  total_price numeric,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS public_resale_cards_event_idx
  ON public.public_resale_cards(event_id);
CREATE INDEX IF NOT EXISTS public_resale_cards_seller_idx
  ON public.public_resale_cards(seller_id);

ALTER TABLE public.public_resale_cards ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS public_resale_cards_read ON public.public_resale_cards;
CREATE POLICY public_resale_cards_read
ON public.public_resale_cards FOR SELECT TO anon, authenticated
USING (true);
REVOKE ALL ON TABLE public.public_resale_cards FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.public_resale_cards TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.public_resale_cards TO service_role;

CREATE OR REPLACE FUNCTION public.sync_public_resale_card()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.public_resale_cards WHERE listing_id = OLD.id;
    RETURN OLD;
  END IF;

  DELETE FROM public.public_resale_cards WHERE listing_id = NEW.id;
  IF NEW.status = 'active' THEN
    INSERT INTO public.public_resale_cards (
      listing_id, seller_id, event_id, price, created_at,
      ticket_type_id, quantity, total_price, updated_at
    )
    SELECT NEW.id, NEW.seller_id, t.event_id, NEW.price, NEW.created_at,
           t.ticket_type_id, t.quantity, t.total_price, now()
    FROM public.tickets t
    WHERE t.id = NEW.ticket_id
      AND t.scanned_at IS NULL
      AND t.status NOT IN ('used', 'cancelled')
      AND t.ticket_status NOT IN ('used', 'invalidated');
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.sync_public_resale_card() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_sync_public_resale_card ON public.resale_listings;
CREATE TRIGGER trg_sync_public_resale_card
AFTER INSERT OR UPDATE OF status, price, seller_id, ticket_id OR DELETE
ON public.resale_listings
FOR EACH ROW EXECUTE FUNCTION public.sync_public_resale_card();

CREATE OR REPLACE FUNCTION public.sync_public_resale_card_from_ticket()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  DELETE FROM public.public_resale_cards c
  USING public.resale_listings r
  WHERE c.listing_id = r.id AND r.ticket_id = NEW.id;

  INSERT INTO public.public_resale_cards (
    listing_id, seller_id, event_id, price, created_at,
    ticket_type_id, quantity, total_price, updated_at
  )
  SELECT r.id, r.seller_id, NEW.event_id, r.price, r.created_at,
         NEW.ticket_type_id, NEW.quantity, NEW.total_price, now()
  FROM public.resale_listings r
  WHERE r.ticket_id = NEW.id
    AND r.status = 'active'
    AND NEW.scanned_at IS NULL
    AND NEW.status NOT IN ('used', 'cancelled')
    AND NEW.ticket_status NOT IN ('used', 'invalidated')
  ON CONFLICT (listing_id) DO UPDATE SET
    seller_id = excluded.seller_id,
    event_id = excluded.event_id,
    price = excluded.price,
    created_at = excluded.created_at,
    ticket_type_id = excluded.ticket_type_id,
    quantity = excluded.quantity,
    total_price = excluded.total_price,
    updated_at = now();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.sync_public_resale_card_from_ticket() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_sync_public_resale_card_from_ticket ON public.tickets;
CREATE TRIGGER trg_sync_public_resale_card_from_ticket
AFTER UPDATE OF event_id, ticket_type_id, quantity, total_price, status,
  ticket_status, scanned_at
ON public.tickets
FOR EACH ROW EXECUTE FUNCTION public.sync_public_resale_card_from_ticket();

INSERT INTO public.public_resale_cards (
  listing_id, seller_id, event_id, price, created_at,
  ticket_type_id, quantity, total_price, updated_at
)
SELECT r.id, r.seller_id, t.event_id, r.price, r.created_at,
       t.ticket_type_id, t.quantity, t.total_price, now()
FROM public.resale_listings r
JOIN public.tickets t ON t.id = r.ticket_id
WHERE r.status = 'active'
  AND t.scanned_at IS NULL
  AND t.status NOT IN ('used', 'cancelled')
  AND t.ticket_status NOT IN ('used', 'invalidated')
ON CONFLICT (listing_id) DO UPDATE SET
  seller_id = excluded.seller_id,
  event_id = excluded.event_id,
  price = excluded.price,
  created_at = excluded.created_at,
  ticket_type_id = excluded.ticket_type_id,
  quantity = excluded.quantity,
  total_price = excluded.total_price,
  updated_at = now();

CREATE OR REPLACE FUNCTION public.mark_ticket_wallet_added(
  p_ticket_id uuid,
  p_wallet_pass_id text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  UPDATE public.tickets
  SET wallet_added = true,
      wallet_pass_id = nullif(btrim(p_wallet_pass_id), '')
  WHERE id = p_ticket_id AND user_id = auth.uid();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ticket not found or not owned by caller' USING ERRCODE = '42501';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.mark_ticket_wallet_added(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_ticket_wallet_added(uuid,text)
  TO authenticated, service_role;

DROP POLICY IF EXISTS "Admin can delete tickets" ON public.tickets;
DROP POLICY IF EXISTS "Admin can update all tickets" ON public.tickets;
DROP POLICY IF EXISTS "Admin can view all tickets" ON public.tickets;
DROP POLICY IF EXISTS "Anyone can view tickets in active resale" ON public.tickets;
DROP POLICY IF EXISTS "Public can view tickets in active resale" ON public.tickets;
DROP POLICY IF EXISTS "Sellers can view their listed tickets" ON public.tickets;
DROP POLICY IF EXISTS "Users can update own tickets" ON public.tickets;
DROP POLICY IF EXISTS "Users can update their own tickets" ON public.tickets;
DROP POLICY IF EXISTS "Users can view own tickets" ON public.tickets;
DROP POLICY IF EXISTS "Authenticated users can create tickets" ON public.tickets;
DROP POLICY IF EXISTS "Workers can insert tickets" ON public.tickets;

DROP POLICY IF EXISTS tickets_admin_all ON public.tickets;
CREATE POLICY tickets_admin_all
ON public.tickets FOR ALL TO authenticated
USING ((SELECT private.is_current_user_admin()))
WITH CHECK ((SELECT private.is_current_user_admin()));

REVOKE ALL ON TABLE public.tickets FROM PUBLIC, anon, authenticated;
GRANT SELECT, UPDATE, DELETE ON TABLE public.tickets TO authenticated;
GRANT ALL ON TABLE public.tickets TO service_role;
