-- Launch scope: keep implementations/data, deny new resale and wallet checkout.
-- Cancellation and settlement of existing payments remain available.
BEGIN;
DO $$
DECLARE f record;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS signature
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN (
      'create_resale_listing_secure', 'buy_resale_ticket', 'buy_resale_ticket_with_credito',
      'buy_ticket_with_wallet', 'buy_ticket_with_credito', 'buy_ticket_with_credito_v2',
      'buy_vip_with_wallet', 'buy_vip_with_credito')
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role', f.signature);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION private.reject_launch_resale_listing()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='RESALE_DISABLED_FOR_LAUNCH';
  END IF;
  -- Permit withdrawal and historical settlement, but not creation/reactivation or repricing.
  IF NEW.status = 'active' AND
    (OLD.status IS DISTINCT FROM NEW.status OR OLD.price IS DISTINCT FROM NEW.price
     OR OLD.ticket_id IS DISTINCT FROM NEW.ticket_id OR OLD.seller_id IS DISTINCT FROM NEW.seller_id)
  THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='RESALE_DISABLED_FOR_LAUNCH';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.reject_launch_resale_listing() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER launch_resale_listing_guard BEFORE INSERT OR UPDATE ON public.resale_listings
FOR EACH ROW EXECUTE FUNCTION private.reject_launch_resale_listing();

CREATE OR REPLACE FUNCTION private.reject_launch_wallet_checkout()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF NEW.kind IN ('resale_ticket','wallet_topup')
     OR COALESCE((NEW.metadata->>'credit_debit_cents')::numeric,0) <> 0
     OR COALESCE((NEW.metadata->>'wallet_debit_cents')::numeric,0) <> 0
     OR COALESCE((NEW.metadata->>'credit_debit_eur')::numeric,0) <> 0
     OR COALESCE((NEW.metadata->>'wallet_debit_eur')::numeric,0) <> 0
  THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='WALLET_OR_RESALE_DISABLED_FOR_LAUNCH';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.reject_launch_wallet_checkout() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER launch_wallet_checkout_guard BEFORE INSERT ON public.payment_transactions
FOR EACH ROW EXECUTE FUNCTION private.reject_launch_wallet_checkout();
COMMIT;
