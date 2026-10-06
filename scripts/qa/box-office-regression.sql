BEGIN;
DO $$
DECLARE org uuid; uid uuid; wid uuid:=gen_random_uuid(); eid uuid; tid uuid; vip uuid;
 result jsonb; receipt jsonb; allowed boolean; request_key text:=gen_random_uuid()::text;
BEGIN
 SELECT id INTO org FROM public.profiles WHERE email LIKE 'qa-boxoffice-%@example.invalid' ORDER BY created_at DESC LIMIT 1;
 SELECT id INTO uid FROM public.profiles WHERE id<>org AND email LIKE 'qa-catalog-%@example.invalid' LIMIT 1;
 IF org IS NULL OR uid IS NULL THEN RAISE EXCEPTION 'Staging QA fixtures missing'; END IF;
 SELECT event_id,id INTO eid,tid FROM public.event_ticket_types WHERE is_active AND deleted_at IS NULL AND price>0 AND category='general' ORDER BY id LIMIT 1;
 UPDATE public.events SET creator_id=org,event_date=now()+interval '1 hour',end_datetime=now()+interval '8 hours' WHERE id=eid;
 SELECT id INTO vip FROM public.reservados_vip WHERE event_id=eid AND is_active LIMIT 1;
 INSERT INTO public.workers(id,user_id,organizer_id,email,name,status,permissions) VALUES(wid,uid,org,'rollback-worker@example.invalid','Rollback QA','active','["scan","sell"]');
 INSERT INTO public.worker_event_assignments(worker_id,event_id,status) VALUES(wid,eid,'active');
 INSERT INTO public.organizer_box_office_subscriptions(organizer_id,status) VALUES(org,'inactive') ON CONFLICT(organizer_id) DO UPDATE SET status='inactive',paid_through=null;
 PERFORM set_config('request.jwt.claim.sub',uid::text,true);
 IF (public.get_box_office_access(org)->>'can_sell')::boolean THEN RAISE EXCEPTION 'Unpaid worker can sell'; END IF;
 BEGIN
  PERFORM public.sell_manual_order(request_key,wid,eid,jsonb_build_array(jsonb_build_object('ticket_type_id',tid,'quantity',1)),null,0,'QA Buyer','buyer@example.invalid',25);
  RAISE EXCEPTION 'Unpaid sale succeeded';
 EXCEPTION WHEN insufficient_privilege THEN IF SQLERRM NOT LIKE 'TAQUILLA_PREMIUM_REQUIRED%' THEN RAISE; END IF; END;
 BEGIN
  PERFORM public.sell_manual_order(gen_random_uuid()::text,wid,eid,'[]',vip,1,'QA Buyer','buyer@example.invalid',25);
  RAISE EXCEPTION 'Unpaid VIP sale succeeded';
 EXCEPTION WHEN insufficient_privilege THEN IF SQLERRM NOT LIKE 'TAQUILLA_PREMIUM_REQUIRED%' THEN RAISE; END IF; END;
 UPDATE public.organizer_box_office_subscriptions SET status='active',paid_through=now()+interval '1 month' WHERE organizer_id=org;
 IF NOT (public.get_box_office_access(org)->>'can_sell')::boolean THEN RAISE EXCEPTION 'Paid worker denied'; END IF;
 receipt:=public.sell_manual_order(request_key,wid,eid,jsonb_build_array(jsonb_build_object('ticket_type_id',tid,'quantity',1)),null,0,'QA Buyer','buyer@example.invalid',25);
 IF receipt->>'success'<>'true' THEN RAISE EXCEPTION 'Paid sale failed'; END IF;
 UPDATE public.organizer_box_office_subscriptions SET cancel_at_period_end=true WHERE organizer_id=org;
 IF NOT (public.get_box_office_access(org)->>'can_sell')::boolean THEN RAISE EXCEPTION 'Cancellation removed paid period'; END IF;
 UPDATE public.organizer_box_office_subscriptions SET paid_through=now()-interval '1 second' WHERE organizer_id=org;
 IF (public.get_box_office_access(org)->>'can_sell')::boolean THEN RAISE EXCEPTION 'Expired subscription allowed'; END IF;
 result:=public.sell_manual_order(request_key,wid,eid,jsonb_build_array(jsonb_build_object('ticket_type_id',tid,'quantity',1)),null,0,'QA Buyer','buyer@example.invalid',25);
 IF result IS DISTINCT FROM receipt THEN RAISE EXCEPTION 'Idempotent receipt was lost'; END IF;
 BEGIN
  PERFORM public.sell_manual_order(gen_random_uuid()::text,wid,eid,jsonb_build_array(jsonb_build_object('ticket_type_id',tid,'quantity',1)),null,0,'QA Buyer','buyer@example.invalid',25);
  RAISE EXCEPTION 'Expired sale allowed';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 result:=public.validate_ticket_worker_v2((receipt->'ticket_ids'->>0),wid,eid);
 IF result->>'valid' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Scanner stopped with expired subscription: %',result; END IF;
 UPDATE public.organizer_box_office_subscriptions SET status='active',paid_through=now()+interval '1 month' WHERE organizer_id=org;
 UPDATE public.workers SET permissions='{"scan":true,"sell":false}' WHERE id=wid;
 IF (public.get_box_office_access(org)->>'can_sell')::boolean THEN RAISE EXCEPTION 'False sell permission allowed'; END IF;
 BEGIN
  PERFORM public.sell_manual_order(gen_random_uuid()::text,wid,eid,jsonb_build_array(jsonb_build_object('ticket_type_id',tid,'quantity',1)),null,0,'QA Buyer','buyer@example.invalid',25);
  RAISE EXCEPTION 'Worker without permission sold';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 IF has_table_privilege('authenticated','public.organizer_box_office_subscriptions','INSERT,UPDATE,DELETE') THEN RAISE EXCEPTION 'Client can alter billing'; END IF;
 IF has_function_privilege('authenticated','public.sync_box_office_subscription(uuid,text,text,text,timestamptz,boolean,timestamptz)','EXECUTE') THEN RAISE EXCEPTION 'Client can sync billing'; END IF;
END $$;
SELECT 'PASS: unpaid and expired ticket/table sales denied, paid authorized sales allowed, paid cancellation period retained, retries preserve receipt, scanner still works, false permission denied, billing writes server-only' AS result;
ROLLBACK;
