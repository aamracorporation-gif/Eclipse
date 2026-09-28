-- Staging database simulation. No external charge; all fixtures roll back.
BEGIN;
INSERT INTO auth.users(id,email) VALUES
 ('61000000-0000-4000-8000-000000000001','qr-buyer@example.test'),
 ('61000000-0000-4000-8000-000000000002','qr-organizer@example.test');
INSERT INTO public.events(id,title,event_date,end_datetime,ticket_price,available_tickets,creator_id)
VALUES('61000000-0000-4000-8000-000000000003','QR regression',now()+interval '1 day',now()+interval '2 days',10,20,'61000000-0000-4000-8000-000000000002');
DO $test$
DECLARE qty int; pi text; before_available int; before_sold int; before_qr jsonb; result jsonb;
BEGIN
 FOREACH qty IN ARRAY ARRAY[1,3] LOOP
  pi:='qa_primary_qr_'||qty;
  SELECT available_tickets,coalesce(sold_tickets,0) INTO before_available,before_sold FROM public.events WHERE id='61000000-0000-4000-8000-000000000003';
  INSERT INTO public.payment_transactions(user_id,kind,amount_cents,stripe_payment_intent_id,metadata)
  VALUES('61000000-0000-4000-8000-000000000001','event_ticket',1000*qty,pi,
   jsonb_build_object('event_id','61000000-0000-4000-8000-000000000003','quantity',qty,'original_total_cents',1000*qty));
  result:=public.fulfill_payment_for_user(pi,'61000000-0000-4000-8000-000000000001');
  IF result->>'fulfilled' IS DISTINCT FROM 'true'
    OR (SELECT count(*) FROM public.tickets WHERE stripe_payment_intent_id=pi) <> qty
    OR (SELECT count(DISTINCT qr_token) FROM public.tickets WHERE stripe_payment_intent_id=pi) <> qty
    OR EXISTS(SELECT 1 FROM public.tickets WHERE stripe_payment_intent_id=pi AND
       (qr_code IS DISTINCT FROM qr_token::text OR qr_token IS NULL OR payment_status IS DISTINCT FROM 'paid'))
    OR (SELECT available_tickets FROM public.events WHERE id='61000000-0000-4000-8000-000000000003') <> before_available-qty
    OR (SELECT sold_tickets FROM public.events WHERE id='61000000-0000-4000-8000-000000000003') <> before_sold+qty
   THEN RAISE EXCEPTION 'Primary issuance inconsistent for quantity %',qty; END IF;
  SELECT jsonb_agg(jsonb_build_array(id,qr_token,qr_code) ORDER BY id) INTO before_qr FROM public.tickets WHERE stripe_payment_intent_id=pi;
  PERFORM public.fulfill_payment_for_user(pi,'61000000-0000-4000-8000-000000000001');
  IF (SELECT jsonb_agg(jsonb_build_array(id,qr_token,qr_code) ORDER BY id) FROM public.tickets WHERE stripe_payment_intent_id=pi) IS DISTINCT FROM before_qr
    OR (SELECT available_tickets FROM public.events WHERE id='61000000-0000-4000-8000-000000000003') <> before_available-qty
   THEN RAISE EXCEPTION 'Retry reissued QR or consumed inventory'; END IF;
 END LOOP;
END;
$test$;
SELECT 'PASS: single and multi-ticket issuance; unique consistent QR; stable replay and inventory' AS result;
ROLLBACK;
