-- Staging only. psql -v ON_ERROR_STOP=1 -f this-file.sql
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


INSERT INTO public.reservados_vip(id,event_id,name,base_price,capacity_people,quantity_available)
VALUES('50000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','Fixture VIP',100,4,1);
INSERT INTO public.payment_transactions(user_id,kind,amount_cents,stripe_payment_intent_id,metadata)
VALUES ('10000000-0000-0000-0000-000000000001','vip_table',10000,'pi_fixture_vip',
'{"event_id":"40000000-0000-0000-0000-000000000001","vip_reservado_id":"50000000-0000-0000-0000-000000000001","original_total_cents":10000,"capacity_people":4,"buyer_name":"Fixture Buyer","buyer_email":"buyer@example.test"}');

SAVEPOINT fixture;
-- card issues one VIP and retries once
SET LOCAL ROLE service_role;
SELECT public.fulfill_payment_for_user('pi_fixture_vip','10000000-0000-0000-0000-000000000001');
SELECT public.fulfill_payment_for_user('pi_fixture_vip','10000000-0000-0000-0000-000000000001');
RESET ROLE;
DO $$ BEGIN
IF (SELECT count(*) FROM public.tickets WHERE stripe_payment_intent_id='pi_fixture_vip') <> 1
OR NOT EXISTS(SELECT 1 FROM public.tickets WHERE stripe_payment_intent_id='pi_fixture_vip' AND quantity=4 AND total_price=100 AND qr_code=qr_token::text)
OR (SELECT quantity_available FROM public.reservados_vip LIMIT 1) <> 0 THEN RAISE EXCEPTION 'VIP issuance incorrect'; END IF;
END $$;
ROLLBACK TO fixture;

-- credit and card splits preserve reserves
UPDATE public.payment_transactions SET amount_cents=9000, metadata=metadata||'{"credit_debit_cents":1000}'::jsonb WHERE stripe_payment_intent_id='pi_fixture_vip';
INSERT INTO public.user_credit(user_id,balance_real,balance_promo) VALUES('10000000-0000-0000-0000-000000000001',7,3) ON CONFLICT(user_id) DO UPDATE SET balance_real=7,balance_promo=3;
INSERT INTO public.wallet_reserves(user_id,amount,stripe_payment_intent_id) VALUES('10000000-0000-0000-0000-000000000001',9,'pi_fixture_backing');
SELECT public.fulfill_payment_for_user('pi_fixture_vip','10000000-0000-0000-0000-000000000001');
DO $$ BEGIN IF (SELECT sum(balance_real+balance_promo) FROM public.user_credit) <> 0
OR (SELECT sum(amount) FROM public.wallet_reserves WHERE status='consumed' AND consumed_by_stripe_pi='pi_fixture_vip') <> 7
OR (SELECT sum(amount) FROM public.wallet_reserves WHERE status='pending') <> 2 THEN RAISE EXCEPTION 'VIP credit accounting failed'; END IF; END $$;
ROLLBACK TO fixture;

-- second charged customer is refunded
SELECT public.fulfill_payment_for_user('pi_fixture_vip','10000000-0000-0000-0000-000000000001');
INSERT INTO public.payment_transactions(user_id,kind,amount_cents,stripe_payment_intent_id,metadata)
SELECT user_id,kind,amount_cents,'pi_fixture_vip_loser',metadata FROM public.payment_transactions WHERE stripe_payment_intent_id='pi_fixture_vip';
DO $$ BEGIN IF public.fulfill_payment_for_user('pi_fixture_vip_loser','10000000-0000-0000-0000-000000000001')->>'status' <> 'refund_pending' THEN RAISE EXCEPTION 'VIP oversold'; END IF; END $$;
ROLLBACK TO fixture;

-- amount mismatch rolls back ticket and inventory
UPDATE public.payment_transactions SET amount_cents=1 WHERE stripe_payment_intent_id='pi_fixture_vip';
DO $$ DECLARE blocked boolean:=false; BEGIN
BEGIN PERFORM public.fulfill_payment_for_user('pi_fixture_vip','10000000-0000-0000-0000-000000000001'); EXCEPTION WHEN SQLSTATE 'P0001' THEN IF SQLERRM NOT LIKE 'Amount mismatch:%' THEN RAISE; END IF; blocked:=true; END;
IF NOT blocked OR EXISTS(SELECT 1 FROM public.tickets WHERE stripe_payment_intent_id='pi_fixture_vip') OR (SELECT quantity_available FROM public.reservados_vip LIMIT 1)<>1 THEN RAISE EXCEPTION 'Failed VIP purchase left side effects'; END IF; END $$;
ROLLBACK TO fixture;

-- sold out
UPDATE public.reservados_vip SET quantity_available=0;
DO $$ DECLARE result jsonb; BEGIN
result:=public.fulfill_payment_for_user('pi_fixture_vip','10000000-0000-0000-0000-000000000001');
IF result->>'status' <> 'refund_pending' OR EXISTS(SELECT 1 FROM public.tickets WHERE stripe_payment_intent_id='pi_fixture_vip') THEN RAISE EXCEPTION 'Unavailable VIP delivered'; END IF;
-- A later retry cannot reverse the refund decision.
UPDATE public.reservados_vip SET quantity_available=1,is_active=true,deleted_at=NULL,base_price=100;
result:=public.fulfill_payment_for_user('pi_fixture_vip','10000000-0000-0000-0000-000000000001');
IF result->>'status' <> 'refund_pending' THEN RAISE EXCEPTION 'Refund decision reversed'; END IF;
END $$;
ROLLBACK TO fixture;

-- inactive
UPDATE public.reservados_vip SET is_active=false;
DO $$ DECLARE result jsonb; BEGIN
result:=public.fulfill_payment_for_user('pi_fixture_vip','10000000-0000-0000-0000-000000000001');
IF result->>'status' <> 'refund_pending' OR EXISTS(SELECT 1 FROM public.tickets WHERE stripe_payment_intent_id='pi_fixture_vip') THEN RAISE EXCEPTION 'Unavailable VIP delivered'; END IF;
-- A later retry cannot reverse the refund decision.
UPDATE public.reservados_vip SET quantity_available=1,is_active=true,deleted_at=NULL,base_price=100;
result:=public.fulfill_payment_for_user('pi_fixture_vip','10000000-0000-0000-0000-000000000001');
IF result->>'status' <> 'refund_pending' THEN RAISE EXCEPTION 'Refund decision reversed'; END IF;
END $$;
ROLLBACK TO fixture;

-- deleted
UPDATE public.reservados_vip SET deleted_at=now();
DO $$ DECLARE result jsonb; BEGIN
result:=public.fulfill_payment_for_user('pi_fixture_vip','10000000-0000-0000-0000-000000000001');
IF result->>'status' <> 'refund_pending' OR EXISTS(SELECT 1 FROM public.tickets WHERE stripe_payment_intent_id='pi_fixture_vip') THEN RAISE EXCEPTION 'Unavailable VIP delivered'; END IF;
-- A later retry cannot reverse the refund decision.
UPDATE public.reservados_vip SET quantity_available=1,is_active=true,deleted_at=NULL,base_price=100;
result:=public.fulfill_payment_for_user('pi_fixture_vip','10000000-0000-0000-0000-000000000001');
IF result->>'status' <> 'refund_pending' THEN RAISE EXCEPTION 'Refund decision reversed'; END IF;
END $$;
ROLLBACK TO fixture;

-- changed price
UPDATE public.reservados_vip SET base_price=110;
DO $$ DECLARE result jsonb; BEGIN
result:=public.fulfill_payment_for_user('pi_fixture_vip','10000000-0000-0000-0000-000000000001');
IF result->>'status' <> 'refund_pending' OR EXISTS(SELECT 1 FROM public.tickets WHERE stripe_payment_intent_id='pi_fixture_vip') THEN RAISE EXCEPTION 'Unavailable VIP delivered'; END IF;
-- A later retry cannot reverse the refund decision.
UPDATE public.reservados_vip SET quantity_available=1,is_active=true,deleted_at=NULL,base_price=100;
result:=public.fulfill_payment_for_user('pi_fixture_vip','10000000-0000-0000-0000-000000000001');
IF result->>'status' <> 'refund_pending' THEN RAISE EXCEPTION 'Refund decision reversed'; END IF;
END $$;
ROLLBACK TO fixture;

-- expired event
UPDATE public.events SET end_datetime=now()-interval '1 minute';
DO $$ DECLARE result jsonb; BEGIN
result:=public.fulfill_payment_for_user('pi_fixture_vip','10000000-0000-0000-0000-000000000001');
IF result->>'status' <> 'refund_pending' OR EXISTS(SELECT 1 FROM public.tickets WHERE stripe_payment_intent_id='pi_fixture_vip') THEN RAISE EXCEPTION 'Unavailable VIP delivered'; END IF;
-- A later retry cannot reverse the refund decision.
UPDATE public.reservados_vip SET quantity_available=1,is_active=true,deleted_at=NULL,base_price=100;
result:=public.fulfill_payment_for_user('pi_fixture_vip','10000000-0000-0000-0000-000000000001');
IF result->>'status' <> 'refund_pending' THEN RAISE EXCEPTION 'Refund decision reversed'; END IF;
END $$;
ROLLBACK TO fixture;

-- missing credit
UPDATE public.payment_transactions SET amount_cents=9000,metadata=metadata||'{"credit_debit_cents":1000}'::jsonb WHERE stripe_payment_intent_id='pi_fixture_vip';
DO $$ DECLARE result jsonb; BEGIN
result:=public.fulfill_payment_for_user('pi_fixture_vip','10000000-0000-0000-0000-000000000001');
IF result->>'status' <> 'refund_pending' OR EXISTS(SELECT 1 FROM public.tickets WHERE stripe_payment_intent_id='pi_fixture_vip') THEN RAISE EXCEPTION 'Unavailable VIP delivered'; END IF;
-- A later retry cannot reverse the refund decision.
UPDATE public.reservados_vip SET quantity_available=1,is_active=true,deleted_at=NULL,base_price=100;
result:=public.fulfill_payment_for_user('pi_fixture_vip','10000000-0000-0000-0000-000000000001');
IF result->>'status' <> 'refund_pending' THEN RAISE EXCEPTION 'Refund decision reversed'; END IF;
END $$;
ROLLBACK TO fixture;

-- missing credit backing
UPDATE public.payment_transactions SET amount_cents=9000,metadata=metadata||'{"credit_debit_cents":1000}'::jsonb WHERE stripe_payment_intent_id='pi_fixture_vip'; INSERT INTO public.user_credit(user_id,balance_real,balance_promo) VALUES('10000000-0000-0000-0000-000000000001',10,0) ON CONFLICT(user_id) DO UPDATE SET balance_real=10,balance_promo=0;
DO $$ DECLARE result jsonb; BEGIN
result:=public.fulfill_payment_for_user('pi_fixture_vip','10000000-0000-0000-0000-000000000001');
IF result->>'status' <> 'refund_pending' OR EXISTS(SELECT 1 FROM public.tickets WHERE stripe_payment_intent_id='pi_fixture_vip') THEN RAISE EXCEPTION 'Unavailable VIP delivered'; END IF;
-- A later retry cannot reverse the refund decision.
UPDATE public.reservados_vip SET quantity_available=1,is_active=true,deleted_at=NULL,base_price=100;
result:=public.fulfill_payment_for_user('pi_fixture_vip','10000000-0000-0000-0000-000000000001');
IF result->>'status' <> 'refund_pending' THEN RAISE EXCEPTION 'Refund decision reversed'; END IF;
END $$;
ROLLBACK TO fixture;

SELECT '11 VIP production-schema regression cases passed' AS result;
ROLLBACK;
