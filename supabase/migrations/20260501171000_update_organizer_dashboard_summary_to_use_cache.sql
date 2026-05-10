CREATE OR REPLACE FUNCTION public.get_organizer_dashboard_summary(p_organizer_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_fin jsonb;
  v_balance_cents bigint := 0;
BEGIN
  v_fin := public.get_organizer_financials_cached(p_organizer_id);

  SELECT COALESCE(b.balance_cents, 0) INTO v_balance_cents
  FROM public.organizer_balances b
  WHERE b.organizer_id = p_organizer_id;

  RETURN v_fin || jsonb_build_object(
    'balance_eur', ROUND((v_balance_cents::numeric / 100)::numeric, 2)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_organizer_dashboard_summary(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_organizer_dashboard_summary(uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
