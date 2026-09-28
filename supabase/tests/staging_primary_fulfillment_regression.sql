-- Synthetic staging fixtures, no external charges. Every change is rolled back.
BEGIN;
INSERT INTO auth.users(id,email) VALUES
 ('62000000-0000-4000-8000-000000000001','primary-guard-buyer@example.test'),
 ('62000000-0000-4000-8000-000000000002','primary-guard-owner@example.test');
INSERT INTO public.events(id,title,event_date,end_datetime,ticket_price,available_tickets,creator_id)
VALUES('62000000-0000-4000-8000-000000000003','Primary guard QA',now()+interval '1 day',now()+interval '2 days',10,20,'62000000-0000-4000-8000-000000000002');
INSERT INTO public.event_ticket_types(id,event_id,name,price,quantity,sold,is_active)
VALUES('62000000-0000-4000-8000-000000000004','62000000-0000-4000-8000-000000000003','QA',10,20,0,true);
INSERT INTO public.user_credit(user_id,balance_real,balance_promo)
VALUES('62000000-0000-4000-8000-000000000001',20,0)
ON CONFLICT(user_id) DO UPDATE SET balance_real=20,balance_promo=0;
DO $test$
DECLARE
  scenario text; pi text; result jsonb; expected_reason text;
  buyer uuid := '62000000-0000-4000-8000-000000000001';
  ev uuid := '62000000-0000-4000-8000-000000000003';
  tt uuid := '62000000-0000-4000-8000-000000000004';
  txid uuid; before_stock int; before_balance numeric; credit_cents int;
BEGIN
  FOREACH scenario IN ARRAY ARRAY['cancelled_flag','cancelled_status','expired','expired_fallback',
    'sold_out','type_inactive','type_deleted','type_sold_out','price_changed','credit_missing','backing_missing','canceled_payment'] LOOP
    pi := 'qa_primary_guard_'||scenario;
    UPDATE public.events SET is_cancelled=false,status='scheduled',event_date=now()+interval '1 day',
      end_datetime=now()+interval '2 days',ticket_price=10,available_tickets=20 WHERE id=ev;
    UPDATE public.event_ticket_types SET is_active=true,deleted_at=NULL,quantity=20,sold=0,price=10 WHERE id=tt;
    UPDATE public.user_credit SET balance_real=20,balance_promo=0 WHERE user_id=buyer;
    credit_cents := CASE WHEN scenario IN ('credit_missing','backing_missing') THEN 500 ELSE 0 END;
    expected_reason := 'event_unavailable';
    IF scenario='cancelled_flag' THEN UPDATE public.events SET is_cancelled=true WHERE id=ev; END IF;
    IF scenario='cancelled_status' THEN UPDATE public.events SET status='cancelled' WHERE id=ev; END IF;
    IF scenario='expired' THEN UPDATE public.events SET end_datetime=now()-interval '1 hour' WHERE id=ev; END IF;
    IF scenario='expired_fallback' THEN UPDATE public.events SET end_datetime=NULL,event_date=now()-interval '1 day' WHERE id=ev; END IF;
    IF scenario='sold_out' THEN UPDATE public.events SET available_tickets=0 WHERE id=ev; expected_reason:='event_sold_out'; END IF;
    IF scenario='type_inactive' THEN UPDATE public.event_ticket_types SET is_active=false WHERE id=tt; expected_reason:='ticket_type_unavailable'; END IF;
    IF scenario='type_deleted' THEN UPDATE public.event_ticket_types SET deleted_at=now() WHERE id=tt; expected_reason:='ticket_type_unavailable'; END IF;
    IF scenario='type_sold_out' THEN UPDATE public.event_ticket_types SET sold=quantity WHERE id=tt; expected_reason:='ticket_type_unavailable'; END IF;
    IF scenario='price_changed' THEN UPDATE public.event_ticket_types SET price=12 WHERE id=tt; expected_reason:='price_changed'; END IF;
    IF scenario='credit_missing' THEN UPDATE public.user_credit SET balance_real=0 WHERE user_id=buyer; expected_reason:='credit_unavailable'; END IF;
    IF scenario='backing_missing' THEN expected_reason:='credit_backing_unavailable'; END IF;
    IF scenario='canceled_payment' THEN expected_reason:='payment_canceled'; END IF;
    INSERT INTO public.payment_transactions(user_id,kind,amount_cents,stripe_payment_intent_id,status,metadata)
    VALUES(buyer,'event_ticket',1000-credit_cents,pi,CASE WHEN scenario='canceled_payment' THEN 'canceled' ELSE 'created' END,
      jsonb_build_object('event_id',ev,'ticket_type_id',tt,'quantity',1,'original_total_cents',1000,'credit_debit_cents',credit_cents))
    RETURNING id INTO txid;
    SELECT available_tickets INTO before_stock FROM public.events WHERE id=ev;
    SELECT balance_real INTO before_balance FROM public.user_credit WHERE user_id=buyer;
    result:=public.fulfill_payment_for_user(pi,buyer);
    IF result->>'status' IS DISTINCT FROM 'refund_pending' OR result->>'refund_required' IS DISTINCT FROM 'true'
      OR (SELECT metadata->>'refund_reason' FROM public.payment_transactions WHERE id=txid) IS DISTINCT FROM expected_reason THEN
      RAISE EXCEPTION 'Wrong durable rejection: % -> %',scenario,result;
    END IF;
    IF EXISTS(SELECT 1 FROM public.tickets WHERE payment_transaction_id=txid)
      OR EXISTS(SELECT 1 FROM public.organizer_revenue_ledger WHERE tx_id=txid)
      OR (SELECT available_tickets FROM public.events WHERE id=ev) <> before_stock
      OR (SELECT balance_real FROM public.user_credit WHERE user_id=buyer) <> before_balance THEN
      RAISE EXCEPTION 'Rejected purchase changed inventory, balance or organizer revenue: %',scenario;
    END IF;
    -- Restoring availability must never reverse a persisted refund decision.
    UPDATE public.events SET is_cancelled=false,status='scheduled',event_date=now()+interval '1 day',end_datetime=now()+interval '2 days',available_tickets=20 WHERE id=ev;
    UPDATE public.event_ticket_types SET is_active=true,deleted_at=NULL,sold=0,price=10 WHERE id=tt;
    IF public.fulfill_payment_for_user(pi,buyer)->>'status' IS DISTINCT FROM 'refund_pending' THEN
      RAISE EXCEPTION 'Retry reversed refund decision: %',scenario;
    END IF;
  END LOOP;
  IF has_function_privilege('authenticated','private.fulfill_primary_card(text,uuid)','EXECUTE')
    OR has_function_privilege('anon','public.fulfill_payment_for_user(text,uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'Client gained privileged fulfillment access';
  END IF;
END;
$test$;
SELECT 'PASS: 12 primary rejection scenarios, durable replay, unchanged balance/inventory/revenue and client ACLs' AS result;
ROLLBACK;
