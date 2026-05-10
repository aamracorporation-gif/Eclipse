CREATE TABLE IF NOT EXISTS public.organizer_revenue_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organizer_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  event_id uuid REFERENCES public.events(id) ON DELETE SET NULL,
  kind text NOT NULL,
  tx_id uuid REFERENCES public.payment_transactions(id) ON DELETE SET NULL,
  source_ref uuid,
  gross_cents integer NOT NULL CHECK (gross_cents >= 0),
  platform_fee_cents integer NOT NULL CHECK (platform_fee_cents >= 0),
  net_cents integer NOT NULL CHECK (net_cents >= 0),
  ticket_units integer NOT NULL DEFAULT 0 CHECK (ticket_units >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS organizer_revenue_ledger_tx_id_uniq
ON public.organizer_revenue_ledger(tx_id)
WHERE tx_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS organizer_revenue_ledger_source_ref_uniq
ON public.organizer_revenue_ledger(source_ref)
WHERE source_ref IS NOT NULL;

CREATE INDEX IF NOT EXISTS organizer_revenue_ledger_organizer_created_at
ON public.organizer_revenue_ledger(organizer_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.organizer_balances (
  organizer_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  balance_cents bigint NOT NULL DEFAULT 0 CHECK (balance_cents >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.organizer_stats_cache (
  organizer_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  gross_cents bigint NOT NULL DEFAULT 0 CHECK (gross_cents >= 0),
  platform_fee_cents bigint NOT NULL DEFAULT 0 CHECK (platform_fee_cents >= 0),
  net_cents bigint NOT NULL DEFAULT 0 CHECK (net_cents >= 0),
  tickets_sold bigint NOT NULL DEFAULT 0 CHECK (tickets_sold >= 0),
  computed_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.apply_organizer_revenue_delta(
  p_organizer_id uuid,
  p_event_id uuid,
  p_kind text,
  p_tx_id uuid,
  p_source_ref uuid,
  p_gross_cents integer,
  p_platform_fee_cents integer,
  p_net_cents integer,
  p_ticket_units integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_inserted boolean := false;
BEGIN
  IF p_organizer_id IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.organizer_revenue_ledger(
    organizer_id,
    event_id,
    kind,
    tx_id,
    source_ref,
    gross_cents,
    platform_fee_cents,
    net_cents,
    ticket_units
  )
  VALUES (
    p_organizer_id,
    p_event_id,
    COALESCE(NULLIF(p_kind, ''), 'unknown'),
    p_tx_id,
    p_source_ref,
    GREATEST(COALESCE(p_gross_cents, 0), 0),
    GREATEST(COALESCE(p_platform_fee_cents, 0), 0),
    GREATEST(COALESCE(p_net_cents, 0), 0),
    GREATEST(COALESCE(p_ticket_units, 0), 0)
  )
  ON CONFLICT DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  IF v_inserted THEN
    INSERT INTO public.organizer_balances(organizer_id, balance_cents, updated_at)
    VALUES (p_organizer_id, GREATEST(COALESCE(p_net_cents, 0), 0), now())
    ON CONFLICT (organizer_id) DO UPDATE
    SET balance_cents = public.organizer_balances.balance_cents + GREATEST(COALESCE(p_net_cents, 0), 0),
        updated_at = now();

    INSERT INTO public.organizer_stats_cache(organizer_id, gross_cents, platform_fee_cents, net_cents, tickets_sold, computed_at)
    VALUES (
      p_organizer_id,
      GREATEST(COALESCE(p_gross_cents, 0), 0),
      GREATEST(COALESCE(p_platform_fee_cents, 0), 0),
      GREATEST(COALESCE(p_net_cents, 0), 0),
      GREATEST(COALESCE(p_ticket_units, 0), 0),
      now()
    )
    ON CONFLICT (organizer_id) DO UPDATE
    SET gross_cents = public.organizer_stats_cache.gross_cents + GREATEST(COALESCE(p_gross_cents, 0), 0),
        platform_fee_cents = public.organizer_stats_cache.platform_fee_cents + GREATEST(COALESCE(p_platform_fee_cents, 0), 0),
        net_cents = public.organizer_stats_cache.net_cents + GREATEST(COALESCE(p_net_cents, 0), 0),
        tickets_sold = public.organizer_stats_cache.tickets_sold + GREATEST(COALESCE(p_ticket_units, 0), 0),
        computed_at = now();
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_organizer_credit_on_payment_fulfilled()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_event_id uuid;
  v_organizer_id uuid;
  v_gross int;
  v_fee int;
  v_net int;
  v_qty int;
  v_vip_id uuid;
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM 'fulfilled' OR OLD.status = 'fulfilled' THEN
    RETURN NEW;
  END IF;

  v_gross := GREATEST(COALESCE(NEW.amount_cents, 0), 0);
  v_fee := GREATEST(COALESCE(NEW.platform_fee_cents, 0), 0);
  v_net := GREATEST(COALESCE(NEW.destination_amount_cents, 0), 0);
  IF v_net = 0 AND v_gross > 0 THEN
    v_net := GREATEST(v_gross - v_fee, 0);
  END IF;

  v_qty := 0;
  BEGIN
    v_qty := GREATEST(COALESCE((NEW.metadata->>'quantity')::int, 0), 0);
  EXCEPTION WHEN others THEN
    v_qty := 0;
  END;

  IF NEW.kind = 'event_ticket' THEN
    BEGIN
      v_event_id := NULLIF(NEW.metadata->>'event_id', '')::uuid;
    EXCEPTION WHEN others THEN
      v_event_id := NULL;
    END;
  ELSIF NEW.kind = 'vip_table' THEN
    BEGIN
      v_vip_id := NULLIF(NEW.metadata->>'vip_reservado_id', '')::uuid;
      IF v_vip_id IS NULL THEN
        v_vip_id := NULLIF(NEW.metadata->>'reference_id', '')::uuid;
      END IF;
      IF v_vip_id IS NULL THEN
        v_vip_id := NULLIF(NEW.metadata->>'vip_id', '')::uuid;
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
        v_event_id := NULLIF(NEW.metadata->>'event_id', '')::uuid;
      EXCEPTION WHEN others THEN
        v_event_id := NULL;
      END;
    END IF;
  ELSE
    RETURN NEW;
  END IF;

  IF v_event_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT e.creator_id INTO v_organizer_id
  FROM public.events e
  WHERE e.id = v_event_id;

  IF v_organizer_id IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM public.apply_organizer_revenue_delta(
    v_organizer_id,
    v_event_id,
    NEW.kind,
    NEW.id,
    NULL,
    v_gross,
    v_fee,
    v_net,
    v_qty
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_organizer_credit_on_payment_fulfilled ON public.payment_transactions;
CREATE TRIGGER trg_organizer_credit_on_payment_fulfilled
AFTER UPDATE OF status ON public.payment_transactions
FOR EACH ROW
EXECUTE FUNCTION public.handle_organizer_credit_on_payment_fulfilled();

CREATE OR REPLACE FUNCTION public.get_organizer_financials_cached(p_organizer_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_cache public.organizer_stats_cache%ROWTYPE;
  v_gross bigint := 0;
  v_fee bigint := 0;
  v_net bigint := 0;
  v_tickets bigint := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF auth.uid() IS DISTINCT FROM p_organizer_id AND NOT EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT * INTO v_cache
  FROM public.organizer_stats_cache
  WHERE organizer_id = p_organizer_id;

  IF v_cache.organizer_id IS NOT NULL AND v_cache.computed_at > now() - interval '5 minutes' THEN
    RETURN jsonb_build_object(
      'organizer_id', p_organizer_id::text,
      'gross_sales_eur', ROUND((v_cache.gross_cents::numeric / 100)::numeric, 2),
      'tickets_sold', v_cache.tickets_sold,
      'platform_fees_eur', ROUND((v_cache.platform_fee_cents::numeric / 100)::numeric, 2),
      'net_to_organizer_eur', ROUND((v_cache.net_cents::numeric / 100)::numeric, 2),
      'updated_at', v_cache.computed_at::text,
      'cached', true
    );
  END IF;

  SELECT
    COALESCE(SUM(l.gross_cents), 0),
    COALESCE(SUM(l.platform_fee_cents), 0),
    COALESCE(SUM(l.net_cents), 0),
    COALESCE(SUM(l.ticket_units), 0)
  INTO v_gross, v_fee, v_net, v_tickets
  FROM public.organizer_revenue_ledger l
  WHERE l.organizer_id = p_organizer_id;

  INSERT INTO public.organizer_stats_cache(organizer_id, gross_cents, platform_fee_cents, net_cents, tickets_sold, computed_at)
  VALUES (p_organizer_id, v_gross, v_fee, v_net, v_tickets, now())
  ON CONFLICT (organizer_id) DO UPDATE
  SET gross_cents = EXCLUDED.gross_cents,
      platform_fee_cents = EXCLUDED.platform_fee_cents,
      net_cents = EXCLUDED.net_cents,
      tickets_sold = EXCLUDED.tickets_sold,
      computed_at = now();

  RETURN jsonb_build_object(
    'organizer_id', p_organizer_id::text,
    'gross_sales_eur', ROUND((v_gross::numeric / 100)::numeric, 2),
    'tickets_sold', v_tickets,
    'platform_fees_eur', ROUND((v_fee::numeric / 100)::numeric, 2),
    'net_to_organizer_eur', ROUND((v_net::numeric / 100)::numeric, 2),
    'updated_at', now()::text,
    'cached', false
  );
END;
$$;

NOTIFY pgrst, 'reload schema';
