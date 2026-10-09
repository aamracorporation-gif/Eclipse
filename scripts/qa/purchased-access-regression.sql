BEGIN;
DO $$
DECLARE original public.tickets%ROWTYPE; eventrow public.events%ROWTYPE; expired public.tickets%ROWTYPE; tx public.payment_transactions%ROWTYPE; result jsonb; fake_intent text:='pi_fixture_'||replace(gen_random_uuid()::text,'-','');
BEGIN
 SELECT t.* INTO original FROM public.tickets t JOIN auth.users u ON u.id=t.user_id WHERE u.email LIKE 'qa-catalog-%@example.invalid' AND t.ticket_type='group' AND t.quantity=4 ORDER BY u.created_at DESC LIMIT 1;
 IF original.id IS NULL THEN RAISE EXCEPTION 'No staging paid pack fixture'; END IF;
 SELECT * INTO eventrow FROM public.events WHERE id=original.event_id;
 PERFORM set_config('request.jwt.claim.sub',eventrow.creator_id::text,true);
 result:=public.validate_ticket_qr_v3(original.id::text,original.event_id);
 IF result->>'valid'<>'true' OR (result->>'quantity')::int<>4 OR result->>'ticket_type' IS DISTINCT FROM original.product_snapshot->>'name' THEN RAISE EXCEPTION 'Scanner lost purchased entitlement'; END IF;
 IF public.validate_ticket_qr_v3(original.id::text,original.event_id)->>'valid'<>'false' THEN RAISE EXCEPTION 'Ticket scanned twice'; END IF;
 UPDATE public.events SET event_date=now()-interval '3 hours',end_datetime=now()+interval '1 hour' WHERE id=original.event_id;
 INSERT INTO public.tickets(event_id,user_id,ticket_type_id,payment_transaction_id,buyer_name,buyer_email,quantity,total_price,price,qr_token,qr_code,status,ticket_status,validation_status,payment_status)
 VALUES(original.event_id,original.user_id,original.ticket_type_id,original.payment_transaction_id,'Rollback QA',original.buyer_email,1,80,80,gen_random_uuid(),gen_random_uuid()::text,'valid','active','valid','paid') RETURNING * INTO expired;
 IF expired.entry_deadline IS NULL OR expired.entry_deadline>=now() THEN RAISE EXCEPTION 'Paid cutoff not captured'; END IF;
 result:=public.validate_ticket_qr_v3(expired.id::text,expired.event_id);
 IF result->>'valid'<>'false' OR result->>'message'<>'HORA LÍMITE DE ACCESO SUPERADA' THEN RAISE EXCEPTION 'Expired paid pack admitted'; END IF;
 SELECT * INTO tx FROM public.payment_transactions WHERE id=original.payment_transaction_id;
 INSERT INTO public.payment_transactions(user_id,kind,amount_cents,currency,stripe_payment_intent_id,status,metadata,platform_fee_cents,destination_account_id,destination_amount_cents,commission_bps,idempotency_key)
 VALUES(tx.user_id,tx.kind,tx.amount_cents,tx.currency,fake_intent,'created',tx.metadata,tx.platform_fee_cents,tx.destination_account_id,tx.destination_amount_cents,tx.commission_bps,gen_random_uuid()::text);
 result:=private.fulfill_primary_card(fake_intent,tx.user_id);
 IF result->>'refund_required'<>'true' THEN RAISE EXCEPTION 'Late payment did not enter existing refund flow'; END IF;
 IF (SELECT metadata->>'refund_reason' FROM public.payment_transactions WHERE stripe_payment_intent_id=fake_intent)<>'entry_deadline_passed' THEN RAISE EXCEPTION 'Wrong refund reason'; END IF;
END $$;
SELECT 'PASS: purchased quantity/name, one scan only, paid cutoff preserved, expired QR rejected, late payment queued for refund' AS result;
ROLLBACK;
