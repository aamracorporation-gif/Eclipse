BEGIN;
INSERT INTO auth.users(id,email) VALUES
 ('40000000-0000-4000-8000-000000000001','qa-ready-org@example.test'),
 ('40000000-0000-4000-8000-000000000002','qa-ready-worker@example.test'),
 ('40000000-0000-4000-8000-000000000003','qa-ready-client@example.test'),
 ('40000000-0000-4000-8000-000000000004','qa-ready-admin@example.test');
UPDATE public.profiles SET role='organizer',verification_status='verified',stripe_account_id='acct_fixture',
 stripe_onboarding_completed=true,stripe_charges_enabled=true WHERE id='40000000-0000-4000-8000-000000000001';
UPDATE public.profiles SET role='admin' WHERE id='40000000-0000-4000-8000-000000000004';
INSERT INTO public.events(id,title,event_date,end_datetime,ticket_price,available_tickets,creator_id)
 VALUES('40000000-0000-4000-8000-000000000010','QA atomic rollback',now()+interval '1 day',now()+interval '2 days',10,5,'40000000-0000-4000-8000-000000000001');
INSERT INTO public.workers(id,user_id,organizer_id,email,name,status,permissions)
 VALUES('40000000-0000-4000-8000-000000000020','40000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000001','qa-ready-worker@example.test','QA','active','["sell","scan"]');
INSERT INTO public.worker_event_assignments(worker_id,event_id) VALUES('40000000-0000-4000-8000-000000000020','40000000-0000-4000-8000-000000000010');
INSERT INTO public.event_ticket_types(id,event_id,name,price,quantity) VALUES('40000000-0000-4000-8000-000000000030','40000000-0000-4000-8000-000000000010','General',10,5);
INSERT INTO public.reservados_vip(id,event_id,name,base_price,capacity_people,quantity_available) VALUES('40000000-0000-4000-8000-000000000040','40000000-0000-4000-8000-000000000010','QA VIP',50,4,0);
SELECT set_config('request.jwt.claim.sub','40000000-0000-4000-8000-000000000002',true);
DO $$ DECLARE a jsonb; b jsonb; before_count integer;
BEGIN
 BEGIN
  PERFORM public.sell_manual_order('qa-failure-001','40000000-0000-4000-8000-000000000020','40000000-0000-4000-8000-000000000010','[{"ticket_type_id":"40000000-0000-4000-8000-000000000030","quantity":1}]','40000000-0000-4000-8000-000000000040',1,'QA buyer','qa-buyer@example.test',22);
  RAISE EXCEPTION 'Expected sold-out VIP rejection';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'VIP sold out' THEN RAISE; END IF;
 END;
 IF EXISTS(SELECT 1 FROM public.tickets WHERE event_id='40000000-0000-4000-8000-000000000010')
 OR (SELECT available_tickets FROM public.events WHERE id='40000000-0000-4000-8000-000000000010')<>5
 THEN RAISE EXCEPTION 'Partial sale escaped rollback'; END IF;
 UPDATE public.reservados_vip SET quantity_available=1 WHERE id='40000000-0000-4000-8000-000000000040';
 a := public.sell_manual_order('qa-success-001','40000000-0000-4000-8000-000000000020','40000000-0000-4000-8000-000000000010','[{"ticket_type_id":"40000000-0000-4000-8000-000000000030","quantity":1}]','40000000-0000-4000-8000-000000000040',1,'QA buyer','qa-buyer@example.test',22);
 b := public.sell_manual_order('qa-success-001','40000000-0000-4000-8000-000000000020','40000000-0000-4000-8000-000000000010','[{"ticket_type_id":"40000000-0000-4000-8000-000000000030","quantity":1}]','40000000-0000-4000-8000-000000000040',1,'QA buyer','qa-buyer@example.test',22);
 IF a IS DISTINCT FROM b OR jsonb_array_length(a->'tickets')<>2
 OR (SELECT count(*) FROM public.tickets WHERE event_id='40000000-0000-4000-8000-000000000010')<>2
 OR (SELECT available_tickets FROM public.events WHERE id='40000000-0000-4000-8000-000000000010')<>3
 THEN RAISE EXCEPTION 'Idempotency or mixed-sale failure'; END IF;
 BEGIN
  PERFORM public.sell_manual_order('qa-success-001','40000000-0000-4000-8000-000000000020','40000000-0000-4000-8000-000000000010','[]','40000000-0000-4000-8000-000000000040',1,'QA buyer','qa-buyer@example.test',22);
  RAISE EXCEPTION 'Key mismatch accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'Idempotency key reused with different order' THEN RAISE; END IF; END;
 UPDATE public.workers SET permissions='{"sell":false}' WHERE id='40000000-0000-4000-8000-000000000020';
 BEGIN
  PERFORM public.sell_manual_order('qa-denied-001','40000000-0000-4000-8000-000000000020','40000000-0000-4000-8000-000000000010','[]','40000000-0000-4000-8000-000000000040',1,'QA buyer','qa-buyer@example.test',22);
  RAISE EXCEPTION 'False sell permission accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 IF has_function_privilege('authenticated','public.sell_vip_manual(uuid,uuid,integer,text,text,integer)','EXECUTE')
 OR has_function_privilege('authenticated','public.sell_tickets_manual_v2(uuid,uuid,jsonb,text,text,integer)','EXECUTE')
 THEN RAISE EXCEPTION 'Legacy sale bypass open'; END IF;
END $$;
-- Client cannot create events, even by bypassing the app.
SELECT set_config('request.jwt.claim.sub','40000000-0000-4000-8000-000000000003',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN
  INSERT INTO public.events(title,event_date,ticket_price,available_tickets,creator_id) VALUES('QA forbidden',now()+interval '1 day',10,1,auth.uid());
  RAISE EXCEPTION 'Client created event';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
-- Same check for an approved organizer with incomplete Stripe.
SELECT set_config('request.jwt.claim.sub','40000000-0000-4000-8000-000000000004',true);
UPDATE public.profiles SET stripe_onboarding_completed=false WHERE id='40000000-0000-4000-8000-000000000001';
SELECT set_config('request.jwt.claim.sub','40000000-0000-4000-8000-000000000001',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 IF public.can_manage_organizer_resources() THEN RAISE EXCEPTION 'Incomplete Stripe authorized'; END IF;
 BEGIN
  INSERT INTO public.events(title,event_date,ticket_price,available_tickets,creator_id) VALUES('QA forbidden',now()+interval '1 day',10,1,auth.uid());
  RAISE EXCEPTION 'Incomplete Stripe created event';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','40000000-0000-4000-8000-000000000004',true);
UPDATE public.profiles SET stripe_onboarding_completed=true WHERE id='40000000-0000-4000-8000-000000000001';
SELECT set_config('request.jwt.claim.sub','40000000-0000-4000-8000-000000000001',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 IF NOT public.can_manage_organizer_resources() THEN RAISE EXCEPTION 'Ready organizer denied'; END IF;
 INSERT INTO public.events(title,event_date,ticket_price,available_tickets,creator_id) VALUES('QA allowed',now()+interval '1 day',10,1,auth.uid());
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','40000000-0000-4000-8000-000000000004',true);
SELECT public.admin_set_user_suspension('40000000-0000-4000-8000-000000000001',true,'QA atomic suspension');
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id='40000000-0000-4000-8000-000000000001' AND is_suspended AND verification_status='rejected')
 THEN RAISE EXCEPTION 'Suspension incomplete'; END IF;
END $$;
SELECT 'PASS: mixed sale rollback; replay exactly once; payload mismatch denied; sell=false denied; old RPCs revoked; client and incomplete Stripe RLS denied; ready organizer allowed; suspension atomic. All fixtures rolled back.' AS result;
ROLLBACK;
