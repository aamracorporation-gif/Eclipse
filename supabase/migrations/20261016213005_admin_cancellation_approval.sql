-- Requests never enter the financial worker's queue. Only an authenticated,
-- active admin may atomically approve a request and create the existing job.
CREATE TABLE public.event_cancellation_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE RESTRICT,
  organizer_id uuid NOT NULL REFERENCES public.profiles(id),
  livemode boolean NOT NULL,
  reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 3 AND 500),
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES public.profiles(id),
  review_reason text,
  review_snapshot jsonb,
  cancellation_id uuid REFERENCES public.event_cancellations(id),
  CHECK ((status='pending' AND reviewed_at IS NULL AND reviewed_by IS NULL)
    OR (status<>'pending' AND reviewed_at IS NOT NULL AND reviewed_by IS NOT NULL))
);
CREATE UNIQUE INDEX cancellation_request_active_event ON public.event_cancellation_requests(event_id) WHERE status IN ('pending','approved');
CREATE INDEX cancellation_request_owner ON public.event_cancellation_requests(organizer_id,created_at DESC);
CREATE INDEX cancellation_request_reviewed_by ON public.event_cancellation_requests(reviewed_by);
CREATE INDEX cancellation_request_job ON public.event_cancellation_requests(cancellation_id);
ALTER TABLE public.event_cancellation_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.event_cancellation_requests FROM anon,authenticated;
GRANT SELECT ON public.event_cancellation_requests TO authenticated;
GRANT ALL ON public.event_cancellation_requests TO service_role;
CREATE POLICY cancellation_request_owner_read ON public.event_cancellation_requests FOR SELECT TO authenticated
  USING (organizer_id=(SELECT auth.uid()));

-- Move the old executable cancellation out of the public API and remove all
-- API-role access. It is called only by the guarded admin function below.
ALTER FUNCTION public.request_event_cancellation(uuid,uuid,text,boolean) SET SCHEMA private;
ALTER FUNCTION private.request_event_cancellation(uuid,uuid,text,boolean) RENAME TO execute_approved_cancellation;
REVOKE ALL ON FUNCTION private.execute_approved_cancellation(uuid,uuid,text,boolean) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.request_event_cancellation(p_event uuid,p_organizer uuid,p_reason text,p_livemode boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE ev public.events%ROWTYPE; request public.event_cancellation_requests%ROWTYPE;
BEGIN
  PERFORM 1 FROM public.organizer_billing_accounts WHERE organizer_id=p_organizer FOR UPDATE;
  SELECT * INTO ev FROM public.events WHERE id=p_event FOR UPDATE;
  IF NOT FOUND OR ev.creator_id IS DISTINCT FROM p_organizer THEN RAISE EXCEPTION 'EVENT_NOT_OWNED' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p_organizer AND role='organizer' AND NOT is_suspended)
    THEN RAISE EXCEPTION 'ORGANIZER_REQUIRED' USING ERRCODE='42501'; END IF;
  SELECT * INTO request FROM public.event_cancellation_requests WHERE event_id=p_event AND status IN ('pending','approved');
  IF FOUND THEN RETURN to_jsonb(request); END IF;
  IF ev.event_date IS NULL OR ev.event_date<=now() THEN RAISE EXCEPTION 'STARTED_EVENT_REQUIRES_SUPPORT'; END IF;
  IF ev.is_cancelled OR ev.status='cancelled' OR EXISTS(SELECT 1 FROM public.event_cancellations WHERE event_id=p_event)
    THEN RAISE EXCEPTION 'EXISTING_CANCELLATION_REQUIRES_SUPPORT'; END IF;
  IF EXISTS(SELECT 1 FROM public.organizer_settlement_transfers WHERE event_id=p_event)
    THEN RAISE EXCEPTION 'SETTLED_EVENT_REQUIRES_SUPPORT'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.organizer_billing_accounts WHERE organizer_id=p_organizer AND ready
    AND livemode=p_livemode AND policy_version='organizer-cancellation-full-refund-v2')
    THEN RAISE EXCEPTION 'BILLING_AUTHORIZATION_REQUIRED'; END IF;
  INSERT INTO public.event_cancellation_requests(event_id,organizer_id,livemode,reason)
    VALUES(p_event,p_organizer,p_livemode,trim(p_reason)) RETURNING * INTO request;
  RETURN to_jsonb(request);
END $$;
REVOKE ALL ON FUNCTION public.request_event_cancellation(uuid,uuid,text,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.request_event_cancellation(uuid,uuid,text,boolean) TO service_role;

CREATE FUNCTION private.notify_cancellation_request() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE recipient uuid;
BEGIN
  IF TG_OP='INSERT' THEN
    FOR recipient IN SELECT id FROM public.profiles WHERE role='admin' AND NOT is_suspended LOOP
      PERFORM notification_private.emit(recipient,'admin','admin.cancellation_requested','cancellation-request:'||NEW.id,
        'Cancelación pendiente de aprobación','Un organizador solicita cancelar un evento. Revisa el motivo y las devoluciones en Cancelaciones.',
        jsonb_build_object('request_id',NEW.id,'event_id',NEW.event_id,'destination','admin-cancellations'),
        'operation','high',array['push','email'],now()+interval '30 days');
    END LOOP;
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    PERFORM notification_private.emit(NEW.organizer_id,'organizer','organizer.cancellation_reviewed','cancellation-review:'||NEW.id,
      CASE WHEN NEW.status='approved' THEN 'Cancelación aprobada' ELSE 'Cancelación rechazada' END,
      CASE WHEN NEW.status='approved' THEN 'El administrador ha aprobado la cancelación. Las devoluciones se tramitarán por separado.'
        ELSE 'El evento no se ha cancelado. Motivo: '||coalesce(NEW.review_reason,'Consulta el historial.') END,
      jsonb_build_object('request_id',NEW.id,'event_id',NEW.event_id,'destination','cancellation-billing'),
      'operation','high',array['push','email'],now()+interval '30 days');
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.notify_cancellation_request() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER notify_cancellation_request AFTER INSERT OR UPDATE ON public.event_cancellation_requests
  FOR EACH ROW EXECUTE FUNCTION private.notify_cancellation_request();

-- Defense in depth: even an old API or direct event edit cannot enqueue a
-- new cancellation or cancel a free event without an approved request.
CREATE FUNCTION private.require_cancellation_approval() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.event_cancellation_requests WHERE event_id=NEW.event_id AND status='approved')
    THEN RAISE EXCEPTION 'ADMIN_APPROVAL_REQUIRED' USING ERRCODE='42501'; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.require_cancellation_approval() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER require_cancellation_approval BEFORE INSERT ON public.event_cancellations
  FOR EACH ROW EXECUTE FUNCTION private.require_cancellation_approval();
CREATE FUNCTION private.require_event_cancel_approval() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF (NEW.is_cancelled OR NEW.status='cancelled') AND NOT(coalesce(OLD.is_cancelled,false) OR coalesce(OLD.status,'')='cancelled')
    AND NOT EXISTS(SELECT 1 FROM public.event_cancellation_requests WHERE event_id=NEW.id AND status='approved')
    THEN RAISE EXCEPTION 'ADMIN_APPROVAL_REQUIRED' USING ERRCODE='42501'; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.require_event_cancel_approval() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER require_event_cancel_approval BEFORE UPDATE ON public.events
  FOR EACH ROW EXECUTE FUNCTION private.require_event_cancel_approval();

CREATE FUNCTION private.admin_cancellation_details(p_request uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE request public.event_cancellation_requests%ROWTYPE; purchases jsonb; result jsonb;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND role='admin' AND NOT is_suspended)
    THEN RAISE EXCEPTION 'Solo administradores activos' USING ERRCODE='42501'; END IF;
  SELECT * INTO request FROM public.event_cancellation_requests WHERE id=p_request;
  IF NOT FOUND THEN RAISE EXCEPTION 'Solicitud no encontrada'; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',t.id,'user_id',t.user_id,'email',p.email,
    'amount_cents',t.amount_cents,'currency',t.currency,'status',t.status,'kind',t.kind,
    'commission_cents',t.platform_fee_cents,'service_cents',coalesce(t.metadata->>'service_fee_cents','0'),
    'refund_status',r.status,'refund_amount_cents',r.amount_cents) ORDER BY t.id),'[]'::jsonb)
    INTO purchases FROM public.payment_transactions t LEFT JOIN public.profiles p ON p.id=t.user_id
    LEFT JOIN public.cancellation_refunds r ON r.transaction_id=t.id WHERE t.protected_event_id=request.event_id;
  result:=jsonb_build_object('request',to_jsonb(request),'purchases',purchases,
    'event',(SELECT jsonb_build_object('id',e.id,'title',e.title,'event_date',e.event_date,'status',e.status) FROM public.events e WHERE e.id=request.event_id),
    'organizer',(SELECT jsonb_build_object('id',p.id,'email',p.email) FROM public.profiles p WHERE p.id=request.organizer_id),
    'ticket_count',(SELECT coalesce(sum(quantity),0) FROM public.tickets WHERE event_id=request.event_id),
    'collections',(SELECT coalesce(jsonb_agg(to_jsonb(c)),'[]'::jsonb) FROM public.cancellation_collections c WHERE c.cancellation_id=request.cancellation_id));
  -- Changes to purchases/refunds or event data invalidate the administrator's review.
  RETURN result||jsonb_build_object('fingerprint',md5((purchases||jsonb_build_array(result->'event'))::text));
END $$;
CREATE FUNCTION public.admin_cancellation_details(p_request uuid) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT private.admin_cancellation_details(p_request); $$;

CREATE FUNCTION private.admin_cancellation_list() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND role='admin' AND NOT is_suspended)
    THEN RAISE EXCEPTION 'Solo administradores activos' USING ERRCODE='42501'; END IF;
  RETURN (SELECT coalesce(jsonb_agg(to_jsonb(r)||jsonb_build_object('event_title',e.title,'organizer_email',p.email)
    ORDER BY (r.status='pending') DESC,r.created_at DESC),'[]'::jsonb)
    FROM public.event_cancellation_requests r JOIN public.events e ON e.id=r.event_id JOIN public.profiles p ON p.id=r.organizer_id);
END $$;
CREATE FUNCTION public.admin_cancellation_list() RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT private.admin_cancellation_list(); $$;

CREATE FUNCTION private.admin_review_cancellation(p_request uuid,p_approve boolean,p_reason text,p_fingerprint text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE request public.event_cancellation_requests%ROWTYPE; job jsonb; snapshot jsonb;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND role='admin' AND NOT is_suspended)
    THEN RAISE EXCEPTION 'Solo administradores activos' USING ERRCODE='42501'; END IF;
  IF p_approve IS NULL OR length(trim(coalesce(p_reason,''))) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'Indica un motivo de entre 3 y 500 caracteres'; END IF;
  SELECT * INTO request FROM public.event_cancellation_requests WHERE id=p_request;
  IF NOT FOUND THEN RAISE EXCEPTION 'Solicitud no encontrada'; END IF;
  -- Same organizer -> event lock order as checkout/cancellation/settlement.
  PERFORM 1 FROM public.organizer_billing_accounts WHERE organizer_id=request.organizer_id FOR UPDATE;
  PERFORM 1 FROM public.events WHERE id=request.event_id FOR UPDATE;
  SELECT * INTO request FROM public.event_cancellation_requests WHERE id=p_request FOR UPDATE;
  IF request.status<>'pending' THEN
    IF request.status=(CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END) THEN RETURN to_jsonb(request); END IF;
    RAISE EXCEPTION 'La solicitud ya fue revisada';
  END IF;
  snapshot:=private.admin_cancellation_details(p_request);
  IF p_approve AND (p_fingerprint IS NULL OR p_fingerprint IS DISTINCT FROM snapshot->>'fingerprint')
    THEN RAISE EXCEPTION 'Las compras han cambiado. Actualiza y revisa el desglose de nuevo.'; END IF;
  UPDATE public.event_cancellation_requests SET status=CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
    reviewed_by=auth.uid(),reviewed_at=now(),review_reason=trim(p_reason),review_snapshot=snapshot WHERE id=p_request;
  IF p_approve THEN
    job:=private.execute_approved_cancellation(request.event_id,request.organizer_id,request.reason,request.livemode);
    UPDATE public.event_cancellation_requests SET cancellation_id=(job->>'id')::uuid WHERE id=p_request;
  END IF;
  INSERT INTO public.admin_audit_logs(admin_id,action,target_user_id,details)
    VALUES(auth.uid(),CASE WHEN p_approve THEN 'cancellation_approved' ELSE 'cancellation_rejected' END,request.organizer_id,
      jsonb_build_object('request_id',p_request,'event_id',request.event_id,'reason',trim(p_reason),'review',snapshot,'cancellation_id',job->>'id'));
  RETURN (SELECT to_jsonb(r) FROM public.event_cancellation_requests r WHERE id=p_request);
END $$;
CREATE FUNCTION public.admin_review_cancellation(p_request uuid,p_approve boolean,p_reason text,p_fingerprint text) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT private.admin_review_cancellation(p_request,p_approve,p_reason,p_fingerprint); $$;

REVOKE ALL ON FUNCTION private.admin_cancellation_details(uuid),public.admin_cancellation_details(uuid),
  private.admin_cancellation_list(),public.admin_cancellation_list(),
  private.admin_review_cancellation(uuid,boolean,text,text),public.admin_review_cancellation(uuid,boolean,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.admin_cancellation_details(uuid),public.admin_cancellation_details(uuid),
  private.admin_cancellation_list(),public.admin_cancellation_list(),
  private.admin_review_cancellation(uuid,boolean,text,text),public.admin_review_cancellation(uuid,boolean,text,text) TO authenticated;
