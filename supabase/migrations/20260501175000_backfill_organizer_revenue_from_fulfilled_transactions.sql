DO $$
DECLARE
  r record;
  v_event_id uuid;
  v_organizer_id uuid;
  v_qty int;
  v_vip_id uuid;
  v_gross int;
  v_fee int;
  v_net int;
BEGIN
  FOR r IN
    SELECT id, kind, amount_cents, platform_fee_cents, destination_amount_cents, metadata
    FROM public.payment_transactions
    WHERE status = 'fulfilled'
      AND kind IN ('event_ticket','vip_table')
  LOOP
    v_event_id := NULL;
    v_organizer_id := NULL;
    v_qty := 0;

    v_gross := GREATEST(COALESCE(r.amount_cents, 0), 0);
    v_fee := GREATEST(COALESCE(r.platform_fee_cents, 0), 0);
    v_net := GREATEST(COALESCE(r.destination_amount_cents, 0), 0);
    IF v_net = 0 AND v_gross > 0 THEN
      v_net := GREATEST(v_gross - v_fee, 0);
    END IF;

    BEGIN
      v_qty := GREATEST(COALESCE((r.metadata->>'quantity')::int, 0), 0);
    EXCEPTION WHEN others THEN
      v_qty := 0;
    END;

    IF r.kind = 'event_ticket' THEN
      BEGIN
        v_event_id := NULLIF(r.metadata->>'event_id', '')::uuid;
      EXCEPTION WHEN others THEN
        v_event_id := NULL;
      END;
    ELSIF r.kind = 'vip_table' THEN
      BEGIN
        v_vip_id := NULLIF(r.metadata->>'vip_reservado_id', '')::uuid;
        IF v_vip_id IS NULL THEN
          v_vip_id := NULLIF(r.metadata->>'reference_id', '')::uuid;
        END IF;
        IF v_vip_id IS NULL THEN
          v_vip_id := NULLIF(r.metadata->>'vip_id', '')::uuid;
        END IF;
      EXCEPTION WHEN others THEN
        v_vip_id := NULL;
      END;

      IF v_vip_id IS NOT NULL THEN
        SELECT rv.event_id INTO v_event_id
        FROM public.reservados_vip rv
        WHERE rv.id = v_vip_id;
      END IF;

      IF v_event_id IS NULL THEN
        BEGIN
          v_event_id := NULLIF(r.metadata->>'event_id', '')::uuid;
        EXCEPTION WHEN others THEN
          v_event_id := NULL;
        END;
      END IF;
    END IF;

    IF v_event_id IS NULL THEN
      CONTINUE;
    END IF;

    SELECT e.creator_id INTO v_organizer_id
    FROM public.events e
    WHERE e.id = v_event_id;

    IF v_organizer_id IS NULL THEN
      CONTINUE;
    END IF;

    PERFORM public.apply_organizer_revenue_delta(
      v_organizer_id,
      v_event_id,
      r.kind,
      r.id,
      NULL,
      v_gross,
      v_fee,
      v_net,
      v_qty
    );
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
