-- SECURITY DEFINER functions are privileged API surface. Remove inherited
-- client execution, preserve service workers, and grant authenticated access
-- only to the reviewed RPCs used by the current mobile application.

DO $migration$
DECLARE
  v_function record;
BEGIN
  FOR v_function IN
    SELECT n.nspname AS schema_name,
           p.proname AS function_name,
           pg_get_function_identity_arguments(p.oid) AS identity_arguments
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef
      AND p.prorettype <> 'trigger'::regtype
  LOOP
    EXECUTE format(
      'REVOKE ALL ON FUNCTION %I.%I(%s) FROM PUBLIC, anon, authenticated',
      v_function.schema_name,
      v_function.function_name,
      v_function.identity_arguments
    );
    EXECUTE format(
      'GRANT EXECUTE ON FUNCTION %I.%I(%s) TO service_role',
      v_function.schema_name,
      v_function.function_name,
      v_function.identity_arguments
    );
  END LOOP;
END
$migration$;

GRANT EXECUTE ON FUNCTION public.adjust_event_live_viewers(uuid,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_resend_event_update_notifications(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_organizer_suspension(uuid,boolean,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_organizer_verification(uuid,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_user_suspension(uuid,boolean,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.buy_resale_ticket_with_credito(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.buy_ticket_with_credito_v2(uuid,text,text,integer,uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.buy_vip_with_credito(uuid,uuid,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_waitlist_offer(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_resale_listing_secure(uuid,numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_organizer_financials_cached(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_worker_monthly_stats(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_worker_stats(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.join_event_as_worker(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.join_event_waitlist(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.notify_event_marketing_to_buyers(uuid,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.regenerate_worker_invite_token(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sell_vip_manual(uuid,uuid,integer,text,text,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_user_push_token(text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.validate_discount_code(text,uuid,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.validate_ticket_qr_v3(text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.validate_ticket_worker_v2(text,uuid,uuid) TO authenticated;
