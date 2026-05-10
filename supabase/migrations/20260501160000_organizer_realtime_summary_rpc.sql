CREATE OR REPLACE FUNCTION public.get_organizer_dashboard_summary(p_organizer_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_gross_sales_eur numeric := 0;
  v_tickets_sold bigint := 0;
  v_platform_fee_cents bigint := 0;
  v_net_to_organizer_cents bigint := 0;
  v_stripe_account_id text := '';
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF auth.uid() IS DISTINCT FROM p_organizer_id AND NOT EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  BEGIN
    SELECT COALESCE(NULLIF(p.stripe_account_id, ''), '') INTO v_stripe_account_id
    FROM public.profiles p
    WHERE p.id = p_organizer_id;
  EXCEPTION WHEN undefined_column OR undefined_table THEN
    v_stripe_account_id := '';
  END;

  SELECT
    COALESCE(SUM(t.total_price), 0),
    COALESCE(SUM(COALESCE(t.quantity, 1)), 0)
  INTO v_gross_sales_eur, v_tickets_sold
  FROM public.tickets t
  JOIN public.events e ON e.id = t.event_id
  WHERE e.creator_id = p_organizer_id
    AND t.user_id IS NOT NULL
    AND t.status = 'valid';

  IF v_stripe_account_id <> '' THEN
    BEGIN
      SELECT
        COALESCE(SUM(COALESCE(pt.platform_fee_cents, 0)), 0),
        COALESCE(SUM(COALESCE(pt.destination_amount_cents, 0)), 0)
      INTO v_platform_fee_cents, v_net_to_organizer_cents
      FROM public.payment_transactions pt
      WHERE pt.destination_account_id = v_stripe_account_id
        AND pt.status = 'fulfilled'
        AND pt.kind IN ('event_ticket','vip_table');
    EXCEPTION WHEN undefined_column OR undefined_table THEN
      v_platform_fee_cents := 0;
      v_net_to_organizer_cents := 0;
    END;
  END IF;

  RETURN jsonb_build_object(
    'organizer_id', p_organizer_id::text,
    'gross_sales_eur', COALESCE(v_gross_sales_eur, 0),
    'tickets_sold', COALESCE(v_tickets_sold, 0),
    'platform_fees_eur', ROUND((COALESCE(v_platform_fee_cents, 0)::numeric / 100)::numeric, 2),
    'net_to_organizer_eur', ROUND((COALESCE(v_net_to_organizer_cents, 0)::numeric / 100)::numeric, 2),
    'stripe_account_id', COALESCE(v_stripe_account_id, ''),
    'updated_at', now()::text
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_organizer_dashboard_summary(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_organizer_dashboard_summary(uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
