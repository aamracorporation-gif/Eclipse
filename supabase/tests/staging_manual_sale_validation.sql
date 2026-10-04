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
SET LOCAL ROLE authenticated;
DO $$ DECLARE v jsonb; accepted boolean; before_stock integer;
BEGIN
 FOR v IN SELECT value FROM jsonb_array_elements('[{"name":"","email":"qa@example.test","q":1},{"name":"QA","email":"bad","q":1},{"name":"QA","email":"","q":1},{"name":"QA","email":"qa@example.test","q":0},{"name":"QA","email":"qa@example.test","q":-1},{"name":"QA","email":"qa@example.test","q":21}]') LOOP
  accepted := false;
  BEGIN
   PERFORM public.sell_manual_order('qa-invalid-'||md5(v::text),'40000000-0000-4000-8000-000000000020','40000000-0000-4000-8000-000000000010',jsonb_build_array(jsonb_build_object('ticket_type_id','40000000-0000-4000-8000-000000000030','quantity',v->'q')),NULL,0,v->>'name',v->>'email',22);
   accepted := true;
  EXCEPTION WHEN raise_exception THEN
   IF SQLERRM NOT IN ('Invalid sale details','Invalid order','Quantity must be positive') THEN RAISE; END IF;
  END;
  IF accepted THEN RAISE EXCEPTION 'Invalid input accepted: %',v; END IF;
 END LOOP;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.tickets WHERE event_id='40000000-0000-4000-8000-000000000010') OR (SELECT available_tickets FROM public.events WHERE id='40000000-0000-4000-8000-000000000010')<>5 THEN RAISE EXCEPTION 'Validation mutated inventory'; END IF;
END $$;
SELECT 'PASS QA-144: empty name/email, malformed email, zero/negative/over-limit quantities rejected as authenticated worker; zero tickets and unchanged inventory; fixtures rolled back.' AS result;
ROLLBACK;
