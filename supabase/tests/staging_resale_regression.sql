-- Run only against staging with psql -v ON_ERROR_STOP=1 -f this-file.sql.
-- All synthetic fixtures and side effects are rolled back. No Stripe API is called.
BEGIN;

INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
 ('10000000-0000-0000-0000-000000000001','buyer@example.test','{"full_name":"Fixture Buyer"}'),
 ('10000000-0000-0000-0000-000000000002','seller@example.test','{"full_name":"Fixture Seller"}');
INSERT INTO public.events(id,title,event_date,end_datetime,ticket_price,available_tickets,creator_id)
VALUES ('40000000-0000-0000-0000-000000000001','Fixture Event',now()+interval '1 day',now()+interval '2 days',10,100,'10000000-0000-0000-0000-000000000002');
INSERT INTO public.tickets(id,event_id,user_id,buyer_name,buyer_email,total_price,status,ticket_status)
VALUES ('30000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','Fixture Seller','seller@example.test',10,'resale','reselling');
INSERT INTO public.resale_listings(id,ticket_id,seller_id,price) VALUES
 ('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002',10);
INSERT INTO public.payment_transactions(user_id,kind,amount_cents,stripe_payment_intent_id,metadata)
VALUES ('10000000-0000-0000-0000-000000000001','resale_ticket',1000,'pi_fixture_resale',
'{"listing_id":"20000000-0000-0000-0000-000000000001","ticket_id":"30000000-0000-0000-0000-000000000001","seller_id":"10000000-0000-0000-0000-000000000002","original_total_cents":1000}');

SAVEPOINT fixture;
-- signup rejects admin metadata
INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES('10000000-0000-0000-0000-000000000003','signup-fixture@example.test','{"role":"admin"}'); DO $$ BEGIN IF (SELECT role FROM public.profiles WHERE id='10000000-0000-0000-0000-000000000003') <> 'attendee' THEN RAISE EXCEPTION 'Signup role escalation'; END IF; END $$;
ROLLBACK TO fixture;

-- card transfer and duplicate webhook
SET LOCAL ROLE service_role;
SELECT public.fulfill_payment_for_user('pi_fixture_resale','10000000-0000-0000-0000-000000000001');
SELECT public.fulfill_payment_for_user('pi_fixture_resale','10000000-0000-0000-0000-000000000001');
RESET ROLE;
DO $$ BEGIN
IF NOT EXISTS(SELECT 1 FROM public.tickets WHERE user_id='10000000-0000-0000-0000-000000000001' AND buyer_name='Fixture Buyer' AND qr_code=qr_token::text) THEN RAISE EXCEPTION 'Bad holder or QR'; END IF;
IF (SELECT count(*) FROM public.resale_transactions) <> 1 OR (SELECT sum(balance_real) FROM public.user_credit) <> 9 OR (SELECT sum(amount) FROM public.wallet_reserves) <> 9 THEN RAISE EXCEPTION 'Duplicate or unbacked credit'; END IF;
END $$;
ROLLBACK TO fixture;

-- wallet credit conservation and late card refund
INSERT INTO public.user_credit(user_id,balance_real,balance_promo) VALUES ('10000000-0000-0000-0000-000000000001',7,3) ON CONFLICT(user_id) DO UPDATE SET balance_real=7,balance_promo=3;
INSERT INTO public.wallet_reserves(user_id,amount,stripe_payment_intent_id) VALUES ('10000000-0000-0000-0000-000000000001',9,'pi_fixture_backing');
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
SET LOCAL ROLE authenticated;
SELECT public.buy_resale_ticket_with_credito('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001');
RESET ROLE;
DO $$ DECLARE result jsonb; BEGIN
IF (SELECT sum(balance_real) FROM public.user_credit) <> 7 OR (SELECT sum(balance_promo) FROM public.user_credit) <> 3 THEN RAISE EXCEPTION 'Balance conservation failed'; END IF;
IF (SELECT sum(amount) FROM public.wallet_reserves WHERE status='pending') <> 9 OR (SELECT sum(amount) FROM public.wallet_reserves WHERE user_id='10000000-0000-0000-0000-000000000002') <> 7 THEN RAISE EXCEPTION 'Reserve transfer failed'; END IF;
result := public.fulfill_payment_for_user('pi_fixture_resale','10000000-0000-0000-0000-000000000001');
IF result->>'status' <> 'refund_pending' THEN RAISE EXCEPTION 'Late card payment not refunded'; END IF;
END $$;
ROLLBACK TO fixture;

-- card rejects validation revoked
UPDATE public.tickets SET validation_status='revoked';
DO $$ DECLARE result jsonb; BEGIN
result:= public.fulfill_payment_for_user('pi_fixture_resale','10000000-0000-0000-0000-000000000001');
IF result->>'status' <> 'refund_pending' OR EXISTS(SELECT 1 FROM public.resale_transactions) THEN RAISE EXCEPTION 'Invalid ticket delivered'; END IF;
END $$;
ROLLBACK TO fixture;

-- wallet rejects validation revoked
UPDATE public.tickets SET validation_status='revoked';
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE blocked boolean:=false; BEGIN
BEGIN
PERFORM public.buy_resale_ticket_with_credito('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001');
EXCEPTION WHEN SQLSTATE 'P0001' THEN
IF SQLERRM <> 'Ticket unavailable for resale' THEN RAISE; END IF;
blocked:=true; END;
IF NOT blocked THEN RAISE EXCEPTION 'Invalid wallet purchase permitted'; END IF;
END $$;
RESET ROLE;
ROLLBACK TO fixture;

-- card rejects validation expired
UPDATE public.tickets SET validation_status='expired';
DO $$ DECLARE result jsonb; BEGIN
result:= public.fulfill_payment_for_user('pi_fixture_resale','10000000-0000-0000-0000-000000000001');
IF result->>'status' <> 'refund_pending' OR EXISTS(SELECT 1 FROM public.resale_transactions) THEN RAISE EXCEPTION 'Invalid ticket delivered'; END IF;
END $$;
ROLLBACK TO fixture;

-- wallet rejects validation expired
UPDATE public.tickets SET validation_status='expired';
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE blocked boolean:=false; BEGIN
BEGIN
PERFORM public.buy_resale_ticket_with_credito('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001');
EXCEPTION WHEN SQLSTATE 'P0001' THEN
IF SQLERRM <> 'Ticket unavailable for resale' THEN RAISE; END IF;
blocked:=true; END;
IF NOT blocked THEN RAISE EXCEPTION 'Invalid wallet purchase permitted'; END IF;
END $$;
RESET ROLE;
ROLLBACK TO fixture;

-- card rejects validation null
UPDATE public.tickets SET validation_status=NULL;
DO $$ DECLARE result jsonb; BEGIN
result:= public.fulfill_payment_for_user('pi_fixture_resale','10000000-0000-0000-0000-000000000001');
IF result->>'status' <> 'refund_pending' OR EXISTS(SELECT 1 FROM public.resale_transactions) THEN RAISE EXCEPTION 'Invalid ticket delivered'; END IF;
END $$;
ROLLBACK TO fixture;

-- wallet rejects validation null
UPDATE public.tickets SET validation_status=NULL;
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE blocked boolean:=false; BEGIN
BEGIN
PERFORM public.buy_resale_ticket_with_credito('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001');
EXCEPTION WHEN SQLSTATE 'P0001' THEN
IF SQLERRM <> 'Ticket unavailable for resale' THEN RAISE; END IF;
blocked:=true; END;
IF NOT blocked THEN RAISE EXCEPTION 'Invalid wallet purchase permitted'; END IF;
END $$;
RESET ROLE;
ROLLBACK TO fixture;

-- expired event requests refund
UPDATE public.events SET end_datetime=now()-interval '1 minute'; DO $$ BEGIN IF (public.fulfill_payment_for_user('pi_fixture_resale','10000000-0000-0000-0000-000000000001')->>'status') <> 'refund_pending' THEN RAISE EXCEPTION 'Expired event sold'; END IF; END $$;
ROLLBACK TO fixture;

-- privileged fulfillment is not client executable
DO $$ BEGIN IF has_function_privilege('authenticated','public.fulfill_payment_for_user(text,uuid)','EXECUTE') OR has_function_privilege('anon','public.fulfill_payment_for_user(text,uuid)','EXECUTE') OR has_function_privilege('service_role','public.fulfill_payment_for_user_legacy_20260920(text,uuid)','EXECUTE') THEN RAISE EXCEPTION 'Private fulfillment callable'; END IF; END $$;
ROLLBACK TO fixture;

-- primary purchase keeps a single QR identity and remains idempotent
INSERT INTO public.payment_transactions(user_id,kind,amount_cents,stripe_payment_intent_id,metadata)
VALUES ('10000000-0000-0000-0000-000000000001','event_ticket',1000,'pi_fixture_primary',
'{"event_id":"40000000-0000-0000-0000-000000000001","quantity":1,"original_total_cents":1000,"buyer_name":"Fixture Buyer","buyer_email":"buyer@example.test"}');
SELECT public.fulfill_payment_for_user('pi_fixture_primary','10000000-0000-0000-0000-000000000001');
SELECT public.fulfill_payment_for_user('pi_fixture_primary','10000000-0000-0000-0000-000000000001');
DO $$ BEGIN
IF (SELECT count(*) FROM public.tickets WHERE stripe_payment_intent_id='pi_fixture_primary') <> 1
OR NOT EXISTS(SELECT 1 FROM public.tickets WHERE stripe_payment_intent_id='pi_fixture_primary' AND qr_code=qr_token::text)
THEN RAISE EXCEPTION 'Primary purchase duplicate or QR mismatch'; END IF;
END $$;
ROLLBACK TO fixture;
SELECT '12 production-schema regression cases passed' AS result;
ROLLBACK;

