-- Staging first. Apply only this migration; never replay the legacy migration chain.
-- Existing codes remain admissions-only. Amounts are always integer EUR cents.
ALTER TABLE public.discount_codes
  ADD COLUMN IF NOT EXISTS applicability text NOT NULL DEFAULT 'tickets',
  ADD COLUMN IF NOT EXISTS ticket_type_ids uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS vip_reservado_ids uuid[] NOT NULL DEFAULT '{}';
ALTER TABLE public.discount_codes ADD CONSTRAINT discount_product_scope_valid CHECK (
  applicability IN ('tickets','vip_tables','all','selected')
  AND array_position(ticket_type_ids,NULL) IS NULL AND array_position(vip_reservado_ids,NULL) IS NULL
  AND CASE WHEN applicability='selected' THEN cardinality(ticket_type_ids)+cardinality(vip_reservado_ids)>0
    ELSE cardinality(ticket_type_ids)+cardinality(vip_reservado_ids)=0 END
);

CREATE OR REPLACE FUNCTION private.enforce_discount_product_scope()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE owner_id uuid; is_admin boolean;
BEGIN
  SELECT creator_id INTO owner_id FROM public.events WHERE id=NEW.event_id;
  IF owner_id IS NULL THEN RAISE EXCEPTION 'Evento no disponible.'; END IF;
  SELECT EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND role='admin') INTO is_admin;
  IF auth.uid() IS NOT NULL AND NOT is_admin AND
    (owner_id IS DISTINCT FROM auth.uid() OR NEW.creator_id IS DISTINCT FROM owner_id) THEN
    RAISE EXCEPTION 'No puedes configurar descuentos de otro organizador.' USING ERRCODE='42501';
  END IF;
  IF EXISTS(SELECT 1 FROM unnest(NEW.ticket_type_ids) AS ids(id) WHERE NOT EXISTS(
    SELECT 1 FROM public.event_ticket_types t WHERE t.id=ids.id AND t.event_id=NEW.event_id AND t.deleted_at IS NULL))
    OR EXISTS(SELECT 1 FROM unnest(NEW.vip_reservado_ids) AS ids(id) WHERE NOT EXISTS(
    SELECT 1 FROM public.reservados_vip v WHERE v.id=ids.id AND v.event_id=NEW.event_id AND v.deleted_at IS NULL)) THEN
    RAISE EXCEPTION 'Todos los productos seleccionados deben pertenecer a este evento y no estar eliminados.';
  END IF;
  IF NEW.discount_type NOT IN ('percentage','fixed') OR NEW.discount_value IS NULL OR NEW.discount_value<=0
    OR NEW.discount_value::text IN ('NaN','Infinity','-Infinity')
    OR (NEW.discount_type='percentage' AND NEW.discount_value>100)
    OR NEW.min_tickets IS NULL OR NEW.min_tickets NOT BETWEEN 1 AND 20
    OR (NEW.max_uses IS NOT NULL AND NEW.max_uses<1) THEN RAISE EXCEPTION 'Configuración de descuento no válida.'; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.enforce_discount_product_scope() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER enforce_discount_product_scope BEFORE INSERT OR UPDATE OF event_id,creator_id,applicability,
  ticket_type_ids,vip_reservado_ids,discount_type,discount_value,min_tickets,max_uses
  ON public.discount_codes FOR EACH ROW EXECUTE FUNCTION private.enforce_discount_product_scope();

CREATE OR REPLACE FUNCTION private.discount_rule_error(c public.discount_codes, p_event uuid,
  p_kind text, p_product uuid, p_quantity integer)
RETURNS text LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
BEGIN
  IF c.id IS NULL OR c.event_id IS DISTINCT FROM p_event THEN RETURN 'El código no es válido para este evento.'; END IF;
  IF c.is_active IS DISTINCT FROM true THEN RETURN 'El código está desactivado.'; END IF;
  IF p_kind NOT IN ('event_ticket','vip_table') OR p_quantity IS NULL OR p_quantity NOT BETWEEN 1 AND 20
     OR (p_kind='vip_table' AND p_quantity<>1) THEN RETURN 'Cantidad no válida.'; END IF;
  IF c.valid_from>now() THEN RETURN 'Este código todavía no está activo.'; END IF;
  IF c.valid_until<=now() THEN RETURN 'Este código ha expirado.'; END IF;
  IF c.max_uses IS NOT NULL AND c.uses_count>=c.max_uses THEN RETURN 'Este código ha alcanzado su límite de usos.'; END IF;
  IF p_quantity<c.min_tickets THEN RETURN 'Este código requiere un mínimo de '||c.min_tickets||' unidades. Una mesa o pack cuenta como una unidad.'; END IF;
  IF NOT (c.applicability='all' OR (c.applicability='tickets' AND p_kind='event_ticket')
    OR (c.applicability='vip_tables' AND p_kind='vip_table')
    OR (c.applicability='selected' AND p_product IS NOT NULL AND
      ((p_kind='event_ticket' AND p_product=ANY(c.ticket_type_ids))
        OR (p_kind='vip_table' AND p_product=ANY(c.vip_reservado_ids))))) THEN
    RETURN 'Este código no se aplica a la entrada o mesa VIP seleccionada.';
  END IF;
  IF c.discount_type NOT IN ('percentage','fixed') OR c.discount_value IS NULL OR c.discount_value<=0
    OR c.discount_value::text IN ('NaN','Infinity','-Infinity')
    OR (c.discount_type='percentage' AND c.discount_value>100) THEN RETURN 'Descuento no válido.'; END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION private.discount_rule_error(public.discount_codes,uuid,text,uuid,integer) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.validate_discount_code_for_product(p_code text,p_event_id uuid,
  p_quantity integer DEFAULT 1,p_ticket_type_id uuid DEFAULT NULL,p_vip_reservado_id uuid DEFAULT NULL)
RETURNS public.discount_codes LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.discount_codes; reason text; kind text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE='42501'; END IF;
  IF nullif(btrim(p_code),'') IS NULL OR length(p_code)>64 OR p_event_id IS NULL
    OR p_quantity IS NULL OR p_quantity NOT BETWEEN 1 AND 20
    OR (p_ticket_type_id IS NOT NULL AND p_vip_reservado_id IS NOT NULL) THEN RAISE EXCEPTION 'Solicitud de descuento no válida.'; END IF;
  kind:=CASE WHEN p_vip_reservado_id IS NOT NULL THEN 'vip_table' ELSE 'event_ticket' END;
  IF p_ticket_type_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.event_ticket_types
    WHERE id=p_ticket_type_id AND event_id=p_event_id AND is_active AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'Entrada no disponible para este evento.';
  END IF;
  IF p_vip_reservado_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.reservados_vip
    WHERE id=p_vip_reservado_id AND event_id=p_event_id AND is_active AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'Mesa VIP no disponible para este evento.';
  END IF;
  SELECT * INTO c FROM public.discount_codes WHERE event_id=p_event_id AND lower(code)=lower(btrim(p_code)) LIMIT 1;
  reason:=private.discount_rule_error(c,p_event_id,kind,coalesce(p_ticket_type_id,p_vip_reservado_id),p_quantity);
  IF reason IS NOT NULL THEN RAISE EXCEPTION '%',reason; END IF;
  RETURN c;
END $$;
REVOKE ALL ON FUNCTION public.validate_discount_code_for_product(text,uuid,integer,uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.validate_discount_code_for_product(text,uuid,integer,uuid,uuid) TO authenticated,service_role;
-- Old clients may validate unrestricted admission codes, but not a product-scoped code without identifying the product.
CREATE OR REPLACE FUNCTION public.validate_discount_code(p_code text,p_event_id uuid,p_quantity integer DEFAULT 1)
RETURNS public.discount_codes LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
  SELECT public.validate_discount_code_for_product(p_code,p_event_id,p_quantity,NULL,NULL);
$$;
REVOKE ALL ON FUNCTION public.validate_discount_code(text,uuid,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.validate_discount_code(text,uuid,integer) TO authenticated,service_role;

-- Lock the code through fulfillment and its existing usage-count trigger. Concurrent payments
-- cannot consume the final use twice. An unavailable/changed code follows the durable refund path.
CREATE OR REPLACE FUNCTION private.payment_discount_failure(tx public.payment_transactions)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.discount_codes; amount integer; original integer; expected integer; reason text;
BEGIN
  amount:=coalesce(nullif(tx.metadata->>'discount_amount_cents','')::integer,0);
  IF nullif(tx.metadata->>'discount_code_id','') IS NULL THEN
    RETURN CASE WHEN amount=0 THEN NULL ELSE 'discount_missing' END;
  END IF;
  SELECT * INTO c FROM public.discount_codes WHERE id=(tx.metadata->>'discount_code_id')::uuid FOR UPDATE;
  reason:=private.discount_rule_error(c,nullif(tx.metadata->>'event_id','')::uuid,tx.kind,
    CASE WHEN tx.kind='vip_table' THEN nullif(tx.metadata->>'vip_reservado_id','')::uuid
      ELSE nullif(tx.metadata->>'ticket_type_id','')::uuid END,
    CASE WHEN tx.kind='vip_table' THEN 1 ELSE nullif(tx.metadata->>'quantity','')::integer END);
  IF reason IS NOT NULL THEN RETURN 'discount_unavailable'; END IF;
  original:=nullif(tx.metadata->>'original_total_cents','')::integer;
  IF original IS NULL OR original<0 OR amount<0 OR amount>original THEN RETURN 'discount_changed'; END IF;
  expected:=least(original,CASE WHEN c.discount_type='percentage' THEN round(original*c.discount_value/100)::integer
    ELSE round(c.discount_value*100)::integer END);
  IF amount<>expected THEN RETURN 'discount_changed'; END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION private.payment_discount_failure(public.payment_transactions) FROM PUBLIC,anon,authenticated;

-- Preserve the already-reviewed inventory, ownership, credit and entry-deadline guards.
-- Fail loudly on an unexpected legacy function, rather than replacing unrelated behavior.
DO $migration$
DECLARE definition text; suffix text; marker text; pos integer; name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['private.fulfill_primary_card(text,uuid)','private.fulfill_vip_card(text,uuid)'] LOOP
    definition:=pg_get_functiondef(name::regprocedure);
    marker:='  IF reason IS NOT NULL THEN';
    IF (length(definition)-length(replace(definition,marker,'')))/length(marker)<>1 THEN
      RAISE EXCEPTION 'Unexpected fulfillment guard: %',name;
    END IF;
    definition:=replace(definition,marker,'  IF reason IS NULL THEN reason:=private.payment_discount_failure(tx); END IF;'||chr(10)||marker);
    IF name='private.fulfill_vip_card(text,uuid)' THEN
      marker:='vip.capacity_people,vip.base_price,';
      IF strpos(definition,marker)=0 THEN RAISE EXCEPTION 'Unexpected VIP ticket price'; END IF;
      definition:=replace(definition,marker,'vip.capacity_people,vip.base_price-coalesce(nullif(tx.metadata->>''discount_amount_cents'','''')::integer,0)::numeric/100,');
    END IF;
    EXECUTE definition;
  END LOOP;
  definition:=pg_get_functiondef('public.fulfill_payment_for_user_legacy_20260920(text,uuid)'::regprocedure);
  marker:='ELSIF v_kind IN (''vip_table'', ''premium_feature'') THEN';
  pos:=strpos(definition,marker);
  IF pos=0 THEN RAISE EXCEPTION 'Unexpected VIP settlement branch'; END IF;
  suffix:=substring(definition FROM pos);
  marker:='v_expected_amount_cents := v_original_total_cents + v_service_fee_cents - v_credit_debit_cents;';
  IF (length(suffix)-length(replace(suffix,marker,'')))/length(marker)<>1 THEN RAISE EXCEPTION 'Unexpected VIP amount guard'; END IF;
  suffix:=replace(suffix,marker,
    'v_discount_amount_cents := CASE WHEN v_kind=''vip_table'' THEN coalesce(nullif(v_tx.metadata->>''discount_amount_cents'','''')::integer,0) ELSE 0 END;'||chr(10)||
    '    IF v_discount_amount_cents<0 OR v_discount_amount_cents>v_original_total_cents THEN RAISE EXCEPTION ''Invalid VIP discount''; END IF;'||chr(10)||
    '    v_expected_amount_cents := v_original_total_cents - v_discount_amount_cents + v_service_fee_cents - v_credit_debit_cents;');
  EXECUTE substring(definition FROM 1 FOR pos-1)||suffix;
END $migration$;
NOTIFY pgrst, 'reload schema';
