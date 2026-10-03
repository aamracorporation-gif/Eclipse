-- Database-only simulation in staging; no Stripe charge is created. Everything rolls back.
BEGIN;
DO $test$
DECLARE
  buyer uuid := 'a9270000-0000-4000-8000-000000000001';
  ev uuid := 'a9270000-0000-4000-8000-000000000003';
  kind text;
  scenario text;
  pi text;
  reserve_pi text;
  real_balance numeric;
  promo_balance numeric;
  backing numeric;
  before_tickets bigint;
  before_available integer;
  blocked boolean;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id=buyer AND email='qa-buyer-20260927@example.test') THEN
    RAISE EXCEPTION 'Missing staging QA fixture';
  END IF;
  IF EXISTS (SELECT 1 FROM public.wallet_reserves WHERE user_id=buyer) THEN
    RAISE EXCEPTION 'QA buyer has reserves; use a clean fixture';
  END IF;
  FOREACH kind IN ARRAY ARRAY['event_ticket','vip_table'] LOOP
  FOREACH scenario IN ARRAY ARRAY['missing_backing','partial_backing','split_reserve','mixed_credit','promo_only'] LOOP
    -- Each successful scenario raises a private sentinel so its fixtures roll back before the next.
    BEGIN
      pi := 'qa_db_only_' || gen_random_uuid()::text;
      reserve_pi := 'qa_backing_only_' || gen_random_uuid()::text;
      real_balance := CASE WHEN scenario='promo_only' THEN 0 WHEN scenario='mixed_credit' THEN 2
        WHEN scenario='split_reserve' THEN 10 ELSE 5 END;
      promo_balance := CASE WHEN scenario='promo_only' THEN 5 WHEN scenario='mixed_credit' THEN 3 ELSE 0 END;
      backing := CASE WHEN scenario='missing_backing' OR scenario='promo_only' THEN 0
        WHEN scenario='partial_backing' OR scenario='mixed_credit' THEN 2 ELSE 10 END;
      INSERT INTO public.user_credit(user_id,balance_real,balance_promo)
        VALUES(buyer,real_balance,promo_balance) ON CONFLICT(user_id) DO UPDATE
        SET balance_real=excluded.balance_real,balance_promo=excluded.balance_promo;
      IF backing>0 THEN
        INSERT INTO public.wallet_reserves(user_id,amount,stripe_payment_intent_id)
          VALUES(buyer,backing,reserve_pi);
      END IF;
      UPDATE public.events SET ticket_price=10,available_tickets=20 WHERE id=ev;
      INSERT INTO public.payment_transactions(user_id,kind,amount_cents,stripe_payment_intent_id,status,metadata)
        VALUES(buyer,kind,550,pi,'created',jsonb_build_object('event_id',ev,'quantity',1,
          'original_total_cents',1000,'service_fee_cents',50,'credit_debit_cents',500,
          'qa_only',true,'buyer_name','QA','buyer_email','qa@example.test'));
      SELECT count(*) INTO before_tickets FROM public.tickets WHERE user_id=buyer;
      SELECT available_tickets INTO before_available FROM public.events WHERE id=ev;
      blocked := false;
      BEGIN
        PERFORM public.fulfill_payment_for_user_legacy_20260920(pi,buyer);
      EXCEPTION WHEN OTHERS THEN
        IF SQLERRM <> 'Insufficient credit backing' THEN RAISE; END IF;
        blocked := true;
      END;
      IF scenario IN ('missing_backing','partial_backing') THEN
        IF NOT blocked THEN RAISE EXCEPTION 'Unbacked credit accepted: %, %',kind,scenario; END IF;
        IF (SELECT balance_real FROM public.user_credit WHERE user_id=buyer) <> real_balance
          OR (SELECT count(*) FROM public.tickets WHERE user_id=buyer) <> before_tickets
          OR (SELECT available_tickets FROM public.events WHERE id=ev) <> before_available
          OR (SELECT status FROM public.payment_transactions WHERE stripe_payment_intent_id=pi) <> 'created'
          OR (SELECT coalesce(sum(amount),0) FROM public.wallet_reserves WHERE user_id=buyer AND status='pending') <> backing THEN
          RAISE EXCEPTION 'Failed debit was not atomic: %, %',kind,scenario;
        END IF;
      ELSE
        IF blocked THEN RAISE EXCEPTION 'Valid credit rejected'; END IF;
        IF (SELECT balance_real+balance_promo FROM public.user_credit WHERE user_id=buyer) <> real_balance+promo_balance-5
          OR (SELECT coalesce(sum(amount),0) FROM public.wallet_reserves WHERE user_id=buyer AND status='consumed') <> least(real_balance,5)
          OR (SELECT coalesce(sum(amount),0) FROM public.wallet_reserves WHERE user_id=buyer AND status='pending') <> backing-least(real_balance,5) THEN
          RAISE EXCEPTION 'Balance/reserve conservation failed: %, %',kind,scenario;
        END IF;
        PERFORM public.fulfill_payment_for_user_legacy_20260920(pi,buyer);
        IF (SELECT balance_real+balance_promo FROM public.user_credit WHERE user_id=buyer) <> real_balance+promo_balance-5 THEN
          RAISE EXCEPTION 'Replay debited twice';
        END IF;
      END IF;
      RAISE EXCEPTION USING ERRCODE='ZX001', MESSAGE='rollback successful test scenario';
    EXCEPTION WHEN SQLSTATE 'ZX001' THEN NULL;
    END;
  END LOOP;
  END LOOP;
END;
$test$;
SELECT 'PASS: 10 credit-backing scenarios; rollback, reserve conservation and replay' AS result;
ROLLBACK;
