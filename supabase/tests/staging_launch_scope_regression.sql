BEGIN;
DO $$
DECLARE f record; n integer := 0; u uuid; listing public.resale_listings%ROWTYPE;
BEGIN
  FOR f IN SELECT p.oid, p.oid::regprocedure AS signature
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
    WHERE ns.nspname='public' AND p.proname IN (
      'create_resale_listing_secure','buy_resale_ticket','buy_resale_ticket_with_credito',
      'buy_ticket_with_wallet','buy_ticket_with_credito','buy_ticket_with_credito_v2',
      'buy_vip_with_wallet','buy_vip_with_credito')
  LOOP
    IF has_function_privilege('anon',f.oid,'EXECUTE')
       OR has_function_privilege('authenticated',f.oid,'EXECUTE')
       OR has_function_privilege('service_role',f.oid,'EXECUTE') THEN
      RAISE EXCEPTION 'Launch RPC accessible: %',f.signature;
    END IF;
    n := n + 1;
  END LOOP;
  IF n < 10 THEN RAISE EXCEPTION 'Missing historical checkout RPCs: %',n; END IF;
  IF NOT has_function_privilege('authenticated','public.cancel_resale_listing_secure(uuid)','EXECUTE')
     OR NOT has_function_privilege('authenticated','public.mark_ticket_wallet_added(uuid,text)','EXECUTE')
     OR NOT has_function_privilege('service_role','public.fulfill_payment_for_user(text,uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'Withdrawal, ticket passes or settlement unexpectedly blocked';
  END IF;
  SELECT user_id INTO u FROM public.user_credit LIMIT 1;
  IF u IS NULL THEN RAISE EXCEPTION 'Requires a staging test account'; END IF;
  BEGIN
    INSERT INTO public.payment_transactions(user_id,kind,amount_cents,currency,stripe_payment_intent_id,status)
    VALUES(u,'resale_ticket',100,'eur','qa_launch_scope_resale','created');
    RAISE EXCEPTION 'Resale transaction accepted';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM <> 'WALLET_OR_RESALE_DISABLED_FOR_LAUNCH' THEN RAISE; END IF;
  END;
  BEGIN
    INSERT INTO public.payment_transactions(user_id,kind,amount_cents,currency,stripe_payment_intent_id,status,metadata)
    VALUES(u,'event_ticket',100,'eur','qa_launch_scope_hybrid','created','{"credit_debit_cents":1}');
    RAISE EXCEPTION 'Hybrid transaction accepted';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM <> 'WALLET_OR_RESALE_DISABLED_FOR_LAUNCH' THEN RAISE; END IF;
  END;
  INSERT INTO public.payment_transactions(user_id,kind,amount_cents,currency,stripe_payment_intent_id,status,metadata)
  VALUES(u,'event_ticket',100,'eur','qa_launch_scope_primary','created','{"credit_debit_cents":0}'),
        (u,'vip_table',100,'eur','qa_launch_scope_vip','created','{}');
  SELECT * INTO listing FROM public.resale_listings WHERE status='active' LIMIT 1;
  IF listing.id IS NOT NULL THEN
    BEGIN
      UPDATE public.resale_listings SET price=price+1 WHERE id=listing.id;
      RAISE EXCEPTION 'Repricing accepted';
    EXCEPTION WHEN insufficient_privilege THEN
      IF SQLERRM <> 'RESALE_DISABLED_FOR_LAUNCH' THEN RAISE; END IF;
    END;
    BEGIN
      INSERT INTO public.resale_listings(ticket_id,seller_id,price,status)
      VALUES(listing.ticket_id,listing.seller_id,listing.price,'active');
      RAISE EXCEPTION 'Listing insert accepted';
    EXCEPTION WHEN insufficient_privilege THEN
      IF SQLERRM <> 'RESALE_DISABLED_FOR_LAUNCH' THEN RAISE; END IF;
    END;
  END IF;
END $$;
SELECT 'launch scope regression passed (rolled back)' AS result;
ROLLBACK;
