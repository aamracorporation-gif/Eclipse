CREATE OR REPLACE FUNCTION public.sell_manual_order(
 p_request_key text, p_worker_id uuid, p_event_id uuid, p_items jsonb,
 p_vip_id uuid, p_vip_quantity integer, p_buyer_name text, p_buyer_email text, p_buyer_age integer
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
 v_uid uuid := auth.uid(); v_payload jsonb; v_prior private.manual_sale_requests%ROWTYPE;
 v_ids jsonb := '[]'::jsonb; v_result jsonb; v_part jsonb; v_total integer;
BEGIN
 IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE='42501'; END IF;
 IF p_request_key IS NULL OR length(p_request_key) NOT BETWEEN 8 AND 120
   OR jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR p_vip_quantity IS NULL OR p_vip_quantity < 0
   OR (p_vip_quantity > 0 AND p_vip_id IS NULL) THEN RAISE EXCEPTION 'Invalid order'; END IF;
 IF NOT EXISTS (SELECT 1 FROM public.workers w
   JOIN public.profiles actor ON actor.id=w.user_id
   JOIN public.profiles org ON org.id=w.organizer_id
   JOIN public.worker_event_assignments a ON a.worker_id=w.id AND a.event_id=p_event_id
   WHERE w.id=p_worker_id AND w.user_id=v_uid AND w.status='active' AND a.status='active'
   AND NOT coalesce(actor.is_suspended,false) AND NOT coalesce(org.is_suspended,false)
   AND org.role='organizer' AND org.verification_status='verified'
   AND nullif(org.stripe_account_id,'') IS NOT NULL
   AND org.stripe_onboarding_completed IS TRUE AND org.stripe_charges_enabled IS TRUE
   AND ((jsonb_typeof(w.permissions)='array' AND w.permissions ? 'sell')
     OR (jsonb_typeof(w.permissions)='object' AND w.permissions->>'sell'='true')))
 THEN RAISE EXCEPTION 'Sale permission denied' USING ERRCODE='42501'; END IF;
 v_payload := jsonb_build_object('worker',p_worker_id,'event',p_event_id,'items',p_items,
   'vip',p_vip_id,'vip_quantity',p_vip_quantity,'name',p_buyer_name,'email',p_buyer_email,'age',p_buyer_age);
 PERFORM pg_advisory_xact_lock(hashtextextended(v_uid::text || ':' || p_request_key,0));
 SELECT * INTO v_prior FROM private.manual_sale_requests WHERE user_id=v_uid AND request_key=p_request_key;
 IF FOUND THEN
   IF v_prior.payload IS DISTINCT FROM v_payload THEN RAISE EXCEPTION 'Idempotency key reused with different order'; END IF;
   RETURN v_prior.result;
 END IF;
 SELECT coalesce(sum((item->>'quantity')::integer),0) + p_vip_quantity INTO v_total
   FROM jsonb_array_elements(p_items) item;
 IF v_total NOT BETWEEN 1 AND 20 OR nullif(btrim(p_buyer_name),'') IS NULL
   OR p_buyer_email IS NULL OR p_buyer_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
   OR p_buyer_age IS NULL OR p_buyer_age NOT BETWEEN 0 AND 120
 THEN RAISE EXCEPTION 'Invalid sale details'; END IF;
 -- All component calls and the receipt are committed or rolled back together.
 PERFORM 1 FROM public.events WHERE id=p_event_id FOR UPDATE;
 IF p_vip_quantity > 0 AND NOT EXISTS(SELECT 1 FROM public.reservados_vip
   WHERE id=p_vip_id AND event_id=p_event_id AND coalesce(is_active,true))
 THEN RAISE EXCEPTION 'VIP not available for this event'; END IF;
 IF jsonb_array_length(p_items)>0 THEN
   v_part := public.sell_tickets_manual_v2(p_worker_id,p_event_id,p_items,p_buyer_name,p_buyer_email,p_buyer_age);
   v_ids := v_ids || (v_part->'ticket_ids');
 END IF;
 IF p_vip_quantity>0 THEN
   v_part := public.sell_vip_manual(p_worker_id,p_vip_id,p_vip_quantity,p_buyer_name,p_buyer_email,p_buyer_age);
   v_ids := v_ids || (v_part->'ticket_ids');
 END IF;
 SELECT jsonb_build_object('success',true,'ticket_ids',v_ids,'tickets',coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb))
 INTO v_result FROM public.tickets t WHERE t.id IN (SELECT value::uuid FROM jsonb_array_elements_text(v_ids));
 INSERT INTO private.manual_sale_requests(user_id,request_key,payload,result) VALUES(v_uid,p_request_key,v_payload,v_result);
 RETURN v_result;
END $$;
