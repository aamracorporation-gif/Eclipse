-- Provider confirmation is required before an email can unlock billing notices.
CREATE FUNCTION public.notification_email_receipts_v2(p_limit integer DEFAULT 10)
RETURNS TABLE(id uuid,provider_id text,accepted_at timestamptz)
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT d.id,d.provider_id,d.accepted_at FROM notification_private.deliveries d
 WHERE d.channel='email' AND d.status='accepted'
  AND coalesce(d.receipt_check_at,d.accepted_at+interval '1 minute')<=now()
 ORDER BY coalesce(d.receipt_check_at,d.accepted_at) LIMIT greatest(1,least(coalesce(p_limit,10),10))
$$;
CREATE FUNCTION public.complete_notification_email_receipt_v2(p_id uuid,p_provider_id text,p_outcome text,p_code text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d notification_private.deliveries%ROWTYPE; next_status text;
BEGIN
 IF p_outcome IS NULL OR p_outcome NOT IN ('confirmed','failed','missing')
  OR coalesce(p_code,'')!~ '^[A-Za-z0-9_:-]{0,80}$' THEN RAISE EXCEPTION 'Invalid email receipt'; END IF;
 SELECT * INTO d FROM notification_private.deliveries WHERE id=p_id AND provider_id=p_provider_id
  AND channel='email' AND status='accepted' FOR UPDATE;
 IF NOT FOUND THEN RETURN false; END IF;
 next_status:=CASE WHEN p_outcome='missing' AND d.accepted_at>now()-interval '23 hours' THEN 'accepted'
  WHEN p_outcome='missing' THEN 'unknown' ELSE p_outcome END;
 UPDATE notification_private.deliveries SET status=next_status,last_code=p_code,
  receipt_check_at=now()+interval '5 minutes',updated_at=now() WHERE id=d.id;
 IF next_status<>'accepted' THEN
  INSERT INTO notification_private.delivery_audit(delivery_id,status,code) VALUES(d.id,next_status,p_code);
 END IF;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.notification_email_receipts_v2(integer),
 public.complete_notification_email_receipt_v2(uuid,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.notification_email_receipts_v2(integer),
 public.complete_notification_email_receipt_v2(uuid,text,text,text) TO service_role;

