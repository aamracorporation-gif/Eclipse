-- Staging only. All fixture changes roll back, including issued free invitations.
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','6f076642-d53c-47e5-b881-b1a4ca245ce0',true);
SELECT set_config('request.jwt.claims','{"sub":"6f076642-d53c-47e5-b881-b1a4ca245ce0","role":"authenticated"}',true);
DO $$
DECLARE eid uuid; fid uuid:=gen_random_uuid(); gid uuid:=gen_random_uuid(); vid uuid:=gen_random_uuid(); requestid uuid:=gen_random_uuid(); offers jsonb; tables jsonb; result jsonb; tid uuid; rejected boolean;
BEGIN
 SELECT id INTO eid FROM public.events WHERE creator_id=auth.uid() AND title LIKE '[PRUEBA]%' AND event_date>now()+interval '1 day' AND NOT EXISTS(SELECT 1 FROM public.tickets WHERE event_id=events.id) ORDER BY id LIMIT 1;
 IF eid IS NULL THEN RAISE EXCEPTION 'No safe staging fixture'; END IF;
 offers:=jsonb_build_array(
  jsonb_build_object('id',fid,'name','Invitación QA','category','free','price',0,'quantity',20,'metadata',jsonb_build_object('minPerOrder',2,'maxPerOrder',3,'salesStartAt',now()-interval '1 hour','salesEndAt',now()+interval '1 hour')),
  jsonb_build_object('id',gid,'name','Pack QA','category','group','price',0,'quantity',20,'metadata',jsonb_build_object('admissionsPerUnit',4,'entryDeadlineMinutes',120)));
 tables:=jsonb_build_array(jsonb_build_object('id',vid,'name','Mesa QA','base_price',300,'capacity_people',6,'included_bottles',1,'quantity_available',3,'expected_available',3,'metadata',jsonb_build_object('vipGroupSize',6)));
 result:=public.save_event_catalog(eid,offers,tables);
 IF (result->>'admissions')::int<>2 OR (result->>'tables')::int<>1 THEN RAISE EXCEPTION 'Catalogue not saved'; END IF;
 IF (SELECT available_tickets FROM public.events WHERE id=eid)<>40 THEN RAISE EXCEPTION 'Incorrect stock aggregation'; END IF;
 rejected:=false;
 BEGIN PERFORM public.claim_free_tickets(eid,fid,1,'Catalogue QA',gen_random_uuid()); EXCEPTION WHEN OTHERS THEN rejected:=SQLERRM LIKE '%límites%'; END;
 IF NOT rejected THEN RAISE EXCEPTION 'Minimum order was not enforced'; END IF;
 result:=public.claim_free_tickets(eid,fid,2,'Catalogue QA',requestid);
 IF jsonb_array_length(result->'ticket_ids')<>2 THEN RAISE EXCEPTION 'Invitation not issued'; END IF;
 IF public.claim_free_tickets(eid,fid,2,'Catalogue QA',requestid) IS DISTINCT FROM result THEN RAISE EXCEPTION 'Retry changed invitations'; END IF;
 result:=public.claim_free_tickets(eid,gid,1,'Group QA',gen_random_uuid());
 tid:=(result#>>'{ticket_ids,0}')::uuid;
 IF NOT EXISTS(SELECT 1 FROM public.tickets WHERE id=tid AND quantity=4 AND product_snapshot->>'category'='group' AND entry_deadline IS NOT NULL) THEN RAISE EXCEPTION 'Group access snapshot not captured'; END IF;
 UPDATE public.reservados_vip SET quantity_available=2 WHERE id=vid;
 PERFORM public.save_event_catalog(eid,offers,tables);
 IF (SELECT quantity_available FROM public.reservados_vip WHERE id=vid)<>2 THEN RAISE EXCEPTION 'Editing restored a sold table'; END IF;
 IF (SELECT available_tickets FROM public.events WHERE id=eid)<>37 THEN RAISE EXCEPTION 'Editing restored sold invitations'; END IF;
 offers:=jsonb_set(offers,'{0,metadata,salesEndAt}',to_jsonb((now()-interval '5 minutes')::text));
 PERFORM public.save_event_catalog(eid,offers,tables);
 rejected:=false;
 BEGIN PERFORM public.claim_free_tickets(eid,fid,2,'Closed QA',gen_random_uuid()); EXCEPTION WHEN OTHERS THEN rejected:=SQLERRM LIKE '%terminado%'; END;
 IF NOT rejected THEN RAISE EXCEPTION 'Closed offer accepted claim'; END IF;
 rejected:=false;
 BEGIN PERFORM public.save_event_catalog(eid,'[{"name":"VIP","category":"vip","price":50,"quantity":20}]',NULL); EXCEPTION WHEN OTHERS THEN rejected:=true; END;
 IF NOT rejected THEN RAISE EXCEPTION 'Individual VIP was allowed'; END IF;
 PERFORM set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
 rejected:=false;
 BEGIN PERFORM public.save_event_catalog(eid,offers,tables); EXCEPTION WHEN insufficient_privilege THEN rejected:=true; END;
 IF NOT rejected THEN RAISE EXCEPTION 'Non-owner changed catalog'; END IF;
 RAISE NOTICE 'PASS: catalogue, table stock, admission stock, invitations, group snapshots, deadlines, sale windows, idempotency and ownership';
END $$;
ROLLBACK;
