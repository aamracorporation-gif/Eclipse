-- The mobile app uses the authenticated, atomic replacements introduced by
-- 20260913000000_harden_atomic_ticket_scanning.sql. Retire overloads that trust
-- caller-supplied scanner identities.

DO $migration$
BEGIN
  IF to_regprocedure('public.validate_ticket_qr_v3(text,uuid)') IS NULL THEN
    RAISE EXCEPTION 'Secure organizer scanner validate_ticket_qr_v3(text,uuid) is missing';
  END IF;
  IF to_regprocedure('public.validate_ticket_worker_v2(text,uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'Secure worker scanner validate_ticket_worker_v2(text,uuid,uuid) is missing';
  END IF;
END
$migration$;

REVOKE ALL ON FUNCTION public.validate_ticket_qr_v3(text,uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.validate_ticket_worker_v2(text,uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.validate_ticket_qr_v3(text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.validate_ticket_worker_v2(text,uuid,uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.validate_ticket_qr_v2(text,text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.validate_ticket_qr_v2(uuid,text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.validate_ticket_qr_v3(text,text,uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.validate_ticket_worker(text,uuid)
  FROM PUBLIC, anon, authenticated;
