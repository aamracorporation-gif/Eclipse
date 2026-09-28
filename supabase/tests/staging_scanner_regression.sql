-- Staging only. Actual authenticated role, synthetic fixtures, all changes roll back.
BEGIN;
INSERT INTO auth.users(id,email) VALUES
 ('62000000-0000-4000-8000-000000000001','scan-buyer@example.test'),
 ('62000000-0000-4000-8000-000000000002','scan-organizer@example.test'),
 ('62000000-0000-4000-8000-000000000003','scan-worker@example.test');
INSERT INTO public.events(id,title,event_date,end_datetime,ticket_price,available_tickets,creator_id)
VALUES('62000000-0000-4000-8000-000000000004','Scan regression',now(),now()+interval '5 hours',10,20,'62000000-0000-4000-8000-000000000002');
INSERT INTO public.workers(id,user_id,organizer_id,email,name,status,permissions)
VALUES('62000000-0000-4000-8000-000000000005','62000000-0000-4000-8000-000000000003','62000000-0000-4000-8000-000000000002','scan-worker@example.test','QA worker','active','["scan"]');
INSERT INTO public.worker_event_assignments(worker_id,event_id,status)
VALUES('62000000-0000-4000-8000-000000000005','62000000-0000-4000-8000-000000000004','active');
INSERT INTO public.tickets(id,event_id,user_id,buyer_name,buyer_email,total_price,status,ticket_status,validation_status,qr_token,qr_code)
VALUES('62000000-0000-4000-8000-000000000006','62000000-0000-4000-8000-000000000004','62000000-0000-4000-8000-000000000001','QA','scan-buyer@example.test',10,'valid','active','valid','62000000-0000-4000-8000-000000000007','62000000-0000-4000-8000-000000000007');

DO $test$
DECLARE scanner text; scenario text; result jsonb; first_scan timestamptz; rejected boolean; permission jsonb;
BEGIN
 FOREACH scanner IN ARRAY ARRAY['organizer','worker'] LOOP
 FOREACH scenario IN ARRAY ARRAY['valid','revoked','expired','null_validation','sold','resale','cancelled'] LOOP
  BEGIN
   UPDATE public.tickets SET validation_status=CASE WHEN scenario IN ('revoked','expired') THEN scenario WHEN scenario='null_validation' THEN NULL ELSE 'valid' END,
    ticket_status=CASE WHEN scenario='sold' THEN 'sold' WHEN scenario='resale' THEN 'reselling' ELSE 'active' END,
    status=CASE WHEN scenario='resale' THEN 'resale' WHEN scenario='cancelled' THEN 'cancelled' ELSE 'valid' END
    WHERE id='62000000-0000-4000-8000-000000000006';
   PERFORM set_config('request.jwt.claim.sub',CASE WHEN scanner='organizer' THEN '62000000-0000-4000-8000-000000000002' ELSE '62000000-0000-4000-8000-000000000003' END,true);
   SET LOCAL ROLE authenticated;
   IF scanner='organizer' THEN
    result:=public.validate_ticket_qr_v3('62000000-0000-4000-8000-000000000007'::text,'62000000-0000-4000-8000-000000000004'::uuid);
   ELSE
    result:=public.validate_ticket_worker_v2('62000000-0000-4000-8000-000000000007','62000000-0000-4000-8000-000000000005','62000000-0000-4000-8000-000000000004');
   END IF;
   RESET ROLE;
   IF scenario='valid' THEN
    IF result->>'valid' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Valid ticket rejected: %',scanner; END IF;
    SELECT scanned_at INTO first_scan FROM public.tickets WHERE id='62000000-0000-4000-8000-000000000006';
    SET LOCAL ROLE authenticated;
    IF scanner='organizer' THEN result:=public.validate_ticket_qr_v3('62000000-0000-4000-8000-000000000007'::text,'62000000-0000-4000-8000-000000000004'::uuid);
    ELSE result:=public.validate_ticket_worker_v2('62000000-0000-4000-8000-000000000007','62000000-0000-4000-8000-000000000005','62000000-0000-4000-8000-000000000004'); END IF;
    RESET ROLE;
    IF result->>'valid' IS DISTINCT FROM 'false' OR first_scan IS NULL OR
      (SELECT scanned_at FROM public.tickets WHERE id='62000000-0000-4000-8000-000000000006') IS DISTINCT FROM first_scan THEN RAISE EXCEPTION 'Duplicate scan accepted: %',scanner; END IF;
   ELSE
    IF result->>'valid' IS DISTINCT FROM 'false' OR
      (SELECT scanned_at FROM public.tickets WHERE id='62000000-0000-4000-8000-000000000006') IS NOT NULL THEN RAISE EXCEPTION 'Invalid ticket accepted: %, %',scanner,scenario; END IF;
   END IF;
   RAISE EXCEPTION USING ERRCODE='ZX001',MESSAGE='rollback scenario';
  EXCEPTION WHEN SQLSTATE 'ZX001' THEN NULL;
  END;
 END LOOP;
 END LOOP;
 FOREACH permission IN ARRAY ARRAY['["scan"]'::jsonb,'{"scan":true}'::jsonb,'{"scan":false}'::jsonb,'{}'::jsonb,'[]'::jsonb,'"scan"'::jsonb] LOOP
  BEGIN
   UPDATE public.workers SET permissions=permission WHERE id='62000000-0000-4000-8000-000000000005';
   PERFORM set_config('request.jwt.claim.sub','62000000-0000-4000-8000-000000000003',true);
   rejected:=false;
   BEGIN
    SET LOCAL ROLE authenticated;
    result:=public.validate_ticket_worker_v2('62000000-0000-4000-8000-000000000007','62000000-0000-4000-8000-000000000005','62000000-0000-4000-8000-000000000004');
    RESET ROLE;
   EXCEPTION WHEN insufficient_privilege THEN RESET ROLE; rejected:=true;
   END;
   IF permission IN ('["scan"]'::jsonb,'{"scan":true}'::jsonb) THEN
    IF rejected OR result->>'valid' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Explicit scan permission rejected'; END IF;
   ELSIF NOT rejected OR (SELECT scanned_at FROM public.tickets WHERE id='62000000-0000-4000-8000-000000000006') IS NOT NULL THEN
    RAISE EXCEPTION 'Missing or disabled permission accepted: %',permission;
   END IF;
   RAISE EXCEPTION USING ERRCODE='ZX001',MESSAGE='rollback scenario';
  EXCEPTION WHEN SQLSTATE 'ZX001' THEN NULL;
  END;
 END LOOP;
END;
$test$;
SELECT 'PASS: 14 organizer/worker ticket scenarios and 6 permission representations; duplicate scans rejected' AS result;
ROLLBACK;
