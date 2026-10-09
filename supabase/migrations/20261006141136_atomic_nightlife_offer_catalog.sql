CREATE OR REPLACE FUNCTION private.guard_admission_offer()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF NEW.is_active AND NEW.deleted_at IS NULL AND (lower(coalesce(NEW.category,'')) IN ('vip','vip_table') OR NEW.name ~* '(^|[^[:alnum:]_])VIP([^[:alnum:]_]|$)') THEN
   RAISE EXCEPTION 'VIP solo está disponible como reservado de mesa';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.guard_admission_offer() FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.save_event_catalog(p_event_id uuid,p_tickets jsonb,p_tables jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE ev public.events%ROWTYPE; item jsonb; m jsonb; rid uuid; kept uuid[]:='{}'; tables_kept uuid[]:='{}';
 q integer; offer_price numeric; group_size integer; old_sold integer; old_available integer; delta integer;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.events WHERE id=p_event_id AND creator_id=auth.uid()) THEN RAISE EXCEPTION 'Event ownership required' USING ERRCODE='42501'; END IF;
 IF jsonb_typeof(p_tickets)<>'array' OR jsonb_array_length(p_tickets)>100 OR (p_tables IS NOT NULL AND (jsonb_typeof(p_tables)<>'array' OR jsonb_array_length(p_tables)>100)) THEN RAISE EXCEPTION 'Invalid catalog'; END IF;
 -- Follow VIP fulfillment lock order; admissions then take the same event lock.
 PERFORM id FROM public.reservados_vip WHERE event_id=p_event_id ORDER BY id FOR UPDATE;
 SELECT * INTO ev FROM public.events WHERE id=p_event_id AND creator_id=auth.uid() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Event unavailable' USING ERRCODE='42501'; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(p_tickets) LOOP
   rid:=CASE WHEN item->>'id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN (item->>'id')::uuid ELSE gen_random_uuid() END;
   q:=(item->>'quantity')::int;offer_price:=(item->>'price')::numeric;m:=coalesce(item->'metadata','{}'::jsonb);
   group_size:=coalesce((m->>'admissionsPerUnit')::int,1);
   IF q NOT BETWEEN 1 AND 50000 OR offer_price<0 OR offer_price>500000 OR (offer_price>0 AND offer_price<0.5) OR coalesce(length(btrim(item->>'name')),0)=0 OR length(item->>'name')>120
      OR group_size NOT BETWEEN 1 AND 20 OR coalesce(item->>'category','general') NOT IN ('general','early','backstage','fast_lane','group','free','custom') THEN RAISE EXCEPTION 'Invalid admission offer'; END IF;
   IF (item->>'category'='free' AND offer_price<>0) OR (item->>'category'='group' AND group_size<2) THEN RAISE EXCEPTION 'Invalid offer price or group'; END IF;
   IF coalesce((m->>'minPerOrder')::int,1)<1 OR coalesce((m->>'maxPerOrder')::int,10)>10 OR coalesce((m->>'minPerOrder')::int,1)>coalesce((m->>'maxPerOrder')::int,10) THEN RAISE EXCEPTION 'Invalid order limits'; END IF;
   IF m->>'salesStartAt' IS NOT NULL AND m->>'salesEndAt' IS NOT NULL AND (m->>'salesStartAt')::timestamptz >= (m->>'salesEndAt')::timestamptz THEN RAISE EXCEPTION 'Invalid sales schedule'; END IF;
   SELECT sold INTO old_sold FROM public.event_ticket_types WHERE id=rid AND event_id=p_event_id FOR UPDATE;
   IF FOUND THEN
     IF q<coalesce(old_sold,0) THEN RAISE EXCEPTION 'Stock cannot be lower than sold units'; END IF;
     UPDATE public.event_ticket_types SET name=btrim(item->>'name'),price=offer_price,quantity=q,category=item->>'category',metadata=m,is_active=true,deleted_at=NULL WHERE id=rid AND event_id=p_event_id;
   ELSE
     IF EXISTS(SELECT 1 FROM public.event_ticket_types WHERE id=rid) THEN RAISE EXCEPTION 'Offer belongs to another event'; END IF;
     INSERT INTO public.event_ticket_types(id,event_id,name,price,quantity,sold,category,metadata) VALUES(rid,p_event_id,btrim(item->>'name'),offer_price,q,0,item->>'category',m);
   END IF;
   kept:=array_append(kept,rid);
 END LOOP;
 UPDATE public.event_ticket_types SET is_active=false,deleted_at=coalesce(deleted_at,now()) WHERE event_id=p_event_id AND NOT(id=ANY(kept)) AND is_active;
 IF p_tables IS NOT NULL THEN
   FOR item IN SELECT value FROM jsonb_array_elements(p_tables) LOOP
     rid:=CASE WHEN item->>'id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN (item->>'id')::uuid ELSE gen_random_uuid() END;
     q:=(item->>'quantity_available')::int;offer_price:=(item->>'base_price')::numeric;group_size:=(item->>'capacity_people')::int;m:=coalesce(item->'metadata','{}'::jsonb);
     IF q NOT BETWEEN 0 AND 50000 OR offer_price<0.5 OR offer_price>500000 OR group_size NOT BETWEEN 1 AND 20 OR coalesce(length(btrim(item->>'name')),0)=0 THEN RAISE EXCEPTION 'Invalid table'; END IF;
     SELECT quantity_available INTO old_available FROM public.reservados_vip WHERE id=rid AND event_id=p_event_id;
     IF FOUND THEN
       delta:=q-coalesce((item->>'expected_available')::int,old_available);
       IF old_available+delta<0 THEN RAISE EXCEPTION 'Table stock changed; reload before reducing availability'; END IF;
       UPDATE public.reservados_vip SET name=btrim(item->>'name'),description=coalesce(item->>'description',''),base_price=offer_price,capacity_people=group_size,included_bottles=coalesce((item->>'included_bottles')::int,0),extra_bottle_price=(item->>'extra_bottle_price')::numeric,quantity_available=old_available+delta,metadata=m,is_active=true,deleted_at=NULL,updated_at=now() WHERE id=rid AND event_id=p_event_id;
     ELSE
       IF EXISTS(SELECT 1 FROM public.reservados_vip WHERE id=rid) THEN RAISE EXCEPTION 'Table belongs to another event'; END IF;
       INSERT INTO public.reservados_vip(id,event_id,name,description,base_price,capacity_people,included_bottles,extra_bottle_price,quantity_available,metadata)
       VALUES(rid,p_event_id,btrim(item->>'name'),coalesce(item->>'description',''),offer_price,group_size,coalesce((item->>'included_bottles')::int,0),(item->>'extra_bottle_price')::numeric,q,m);
     END IF;
     tables_kept:=array_append(tables_kept,rid);
   END LOOP;
   UPDATE public.reservados_vip SET is_active=false,deleted_at=coalesce(deleted_at,now()) WHERE event_id=p_event_id AND NOT(id=ANY(tables_kept)) AND is_active;
 END IF;
 UPDATE public.events SET
 available_tickets=coalesce((SELECT sum(greatest(quantity-coalesce(sold,0),0)) FROM public.event_ticket_types WHERE event_id=p_event_id AND is_active AND deleted_at IS NULL),0),
 ticket_price=coalesce((SELECT min(price) FROM public.event_ticket_types WHERE event_id=p_event_id AND is_active AND deleted_at IS NULL),(SELECT min(base_price) FROM public.reservados_vip WHERE event_id=p_event_id AND is_active AND deleted_at IS NULL),0),
 updated_at=now() WHERE id=p_event_id;
 RETURN jsonb_build_object('admissions',cardinality(kept),'tables',cardinality(tables_kept));
END $$;
REVOKE ALL ON FUNCTION public.save_event_catalog(uuid,jsonb,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_event_catalog(uuid,jsonb,jsonb) TO authenticated;
