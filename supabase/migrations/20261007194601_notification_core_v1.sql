-- Notification core V1. Additive rollout; no sends, cron, backfill, or legacy queue drain.
-- public.notifications + notification_core.deliveries form a transactional outbox.
CREATE SCHEMA notification_core;
REVOKE ALL ON SCHEMA notification_core FROM PUBLIC, anon, authenticated;

CREATE TABLE notification_core.runtime (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  capture_enabled boolean NOT NULL DEFAULT false,
  delivery_enabled boolean NOT NULL DEFAULT false,
  environment text NOT NULL DEFAULT 'staging' CHECK (environment IN ('staging','production')),
  project_ref text,
  expo_project_id uuid,
  allowed_recipients uuid[] NOT NULL DEFAULT '{}'
);
INSERT INTO notification_core.runtime(singleton) VALUES (true);

CREATE TABLE notification_core.templates (
  type text PRIMARY KEY,
  title text NOT NULL,
  body text NOT NULL,
  family text NOT NULL CHECK (family IN ('purchase','important','account','activity')),
  audience_role text NOT NULL DEFAULT 'attendee' CHECK (audience_role IN ('attendee','organizer')),
  push boolean NOT NULL DEFAULT true,
  email boolean NOT NULL DEFAULT true
);
INSERT INTO notification_core.templates(type,title,body,family,audience_role,push,email) VALUES
('order.admission_confirmed','Tus entradas están confirmadas','Tu compra para {{event_title}} está confirmada. Consulta tus accesos en Mis entradas.','purchase','attendee',true,true),
('order.vip_confirmed','Tu mesa VIP está confirmada','Tu mesa {{product_name}} para {{group_size}} personas en {{event_title}} está confirmada. Consulta el acceso del grupo y lo incluido.','purchase','attendee',true,true),
('order.free_confirmed','Tu invitación está lista','Tu invitación para {{event_title}} está lista. Revisa las condiciones y la hora límite de acceso en Mis entradas.','purchase','attendee',true,true),
('order.box_office_issued','Tu entrada de taquilla está lista','Tu entrada de taquilla para {{event_title}} está disponible en Mis entradas.','purchase','attendee',false,true),
('refund.processing','Reembolso pendiente de tramitación','Hay una devolución pendiente para tu compra de {{event_title}}. Todavía no se ha confirmado su finalización.','purchase','attendee',false,true),
('refund.completed','Se ha tramitado tu reembolso','Se ha confirmado la devolución de tu compra de {{event_title}}. El momento del abono depende de tu entidad de pago.','purchase','attendee',true,true),
('ticket.invalidated','Tu entrada ya no está vigente','Una de tus entradas para {{event_title}} ya no es válida. Consulta su estado en Eclipse; esto no confirma por sí solo un reembolso.','important','attendee',true,true),
('event.cancelled','Tu evento ha sido cancelado','{{event_title}} ha sido cancelado. Consulta el estado de tu compra en Eclipse; los reembolsos se informan por separado.','important','attendee',true,true),
('event.schedule_changed','Cambio de fecha u horario','Han cambiado detalles de {{event_title}}. Revisa la fecha, el horario y el lugar actualizados antes de acudir.','important','attendee',true,true),
('event.venue_changed','Cambio de ubicación','Han cambiado detalles de ubicación de {{event_title}}. Comprueba la dirección y el resto de la información antes de salir.','important','attendee',true,true),
('event.access_changed','Cambio en las condiciones de acceso','Han cambiado condiciones de acceso de {{event_title}}. Revisa los requisitos actualizados antes de acudir.','important','attendee',true,true),
('event.lineup_changed','Cambio en el cartel del evento','El cartel de {{event_title}} ha cambiado. Consulta los detalles actualizados en Eclipse.','important','attendee',true,false),
('order.benefits_changed','Cambio en tu entrada o reserva','Han cambiado condiciones de tu compra de {{event_title}}. Consulta los accesos y ventajas asociados a tu entrada.','important','attendee',true,true),
('ticket.checked_in','Acceso registrado','Se ha registrado el acceso de tu entrada para {{event_title}}.','activity','attendee',false,false),
('organizer.verification_approved','Tu perfil de organizador ha sido aprobado','Tu verificación ha sido aprobada. Revisa los siguientes pasos en tu panel de organizador.','account','organizer',true,true),
('organizer.verification_changes','Revisa tu verificación','Hay cambios que debes revisar en la verificación de tu perfil de organizador. Consulta el detalle en tu panel.','account','organizer',true,true);

CREATE TABLE notification_core.devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id uuid NOT NULL,
  token text NOT NULL UNIQUE,
  platform text NOT NULL CHECK (platform IN ('ios','android')),
  expo_project_id uuid NOT NULL,
  revision uuid NOT NULL DEFAULT gen_random_uuid(),
  active boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notification_devices_recipient ON notification_core.devices(user_id) WHERE active;

ALTER TABLE public.notifications
  ADD COLUMN notification_version smallint NOT NULL DEFAULT 1,
  ADD COLUMN dedupe_key text,
  ADD COLUMN category text,
  ADD COLUMN archived_at timestamptz,
  ADD COLUMN source_ticket_id uuid,
  ADD COLUMN source_transaction_id uuid;
CREATE UNIQUE INDEX notifications_recipient_event_key ON public.notifications(user_id,dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX notifications_inbox_cursor ON public.notifications(user_id,created_at DESC,id DESC) WHERE archived_at IS NULL;
ALTER TABLE public.notification_settings
  ADD COLUMN important_updates boolean NOT NULL DEFAULT true,
  ADD COLUMN quiet_hours_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN quiet_start time NOT NULL DEFAULT '00:00',
  ADD COLUMN quiet_end time NOT NULL DEFAULT '11:00',
  ADD COLUMN timezone text NOT NULL DEFAULT 'Europe/Madrid';

CREATE TABLE notification_core.deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id uuid NOT NULL REFERENCES public.notifications(id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('push','email')),
  target text NOT NULL,
  device_id uuid REFERENCES notification_core.devices(id) ON DELETE SET NULL,
  device_revision uuid,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','leased','sending','accepted','provider_confirmed','failed','skipped','expired','uncertain')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 4),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now()+interval '20 hours'),
  lease_token uuid,
  lease_until timestamptz,
  provider_id text,
  accepted_at timestamptz,
  confirmed_at timestamptz,
  last_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(notification_id,channel,target)
);
CREATE INDEX notification_jobs_due ON notification_core.deliveries(next_attempt_at) WHERE state='pending';
CREATE INDEX notification_jobs_receipts ON notification_core.deliveries(accepted_at) WHERE state='accepted' AND channel='push';
CREATE TABLE notification_core.delivery_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  delivery_id uuid NOT NULL REFERENCES notification_core.deliveries(id) ON DELETE CASCADE,
  state text NOT NULL,
  code text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE notification_core.runtime ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_core.templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_core.devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_core.deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_core.delivery_events ENABLE ROW LEVEL SECURITY;
-- No client policies or grants on the private schema. Public RPCs below are narrowly granted.

CREATE FUNCTION notification_core.enabled_for(p_user uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT COALESCE((SELECT capture_enabled AND (environment='production' OR p_user=ANY(allowed_recipients))
 FROM notification_core.runtime WHERE singleton),false)
$$;

CREATE FUNCTION notification_core.log_delivery() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF TG_OP='INSERT' OR NEW.state IS DISTINCT FROM OLD.state OR NEW.last_code IS DISTINCT FROM OLD.last_code THEN
   INSERT INTO notification_core.delivery_events(delivery_id,state,code) VALUES(NEW.id,NEW.state,NEW.last_code);
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER notification_delivery_trace AFTER INSERT OR UPDATE ON notification_core.deliveries
FOR EACH ROW EXECUTE FUNCTION notification_core.log_delivery();

CREATE FUNCTION notification_core.render(p_template text,p_data jsonb) RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE k text; result text:=p_template;
BEGIN
 FOREACH k IN ARRAY ARRAY['event_title','product_name','group_size'] LOOP
   result:=replace(result,'{{'||k||'}}',left(COALESCE(p_data->>k,CASE WHEN k='event_title' THEN 'tu evento' ELSE '' END),200));
 END LOOP;
 RETURN result;
END $$;

-- Service-only entry point. No client may choose a recipient, text, role or type.
CREATE FUNCTION public.enqueue_core_notification(p_user uuid,p_type text,p_key text,p_event uuid DEFAULT NULL,p_ticket uuid DEFAULT NULL,p_transaction uuid DEFAULT NULL,p_data jsonb DEFAULT '{}')
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE template notification_core.templates%ROWTYPE; v_id uuid; config notification_core.runtime%ROWTYPE; v_state text; v_payload jsonb;
BEGIN
 IF NOT notification_core.enabled_for(p_user) THEN RETURN NULL; END IF;
 SELECT * INTO config FROM notification_core.runtime WHERE singleton;
 SELECT * INTO template FROM notification_core.templates WHERE type=p_type;
 IF NOT FOUND OR p_key IS NULL OR length(p_key) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'Invalid notification event'; END IF;
 -- Retain only documented non-secret fields. A caller cannot inject a URL, QR or recipient email.
 SELECT COALESCE(jsonb_object_agg(key,value),'{}') INTO v_payload FROM jsonb_each(p_data)
 WHERE key IN ('event_title','product_name','group_size','changed_fields','event_date','venue_id');
 INSERT INTO public.notifications(user_id,type,title,body,message,role,priority,status,channels,read,data,event_id,
     notification_version,dedupe_key,category,source_ticket_id,source_transaction_id)
 VALUES(p_user,p_type,template.title,notification_core.render(template.body,v_payload),notification_core.render(template.body,v_payload),
     template.audience_role,CASE WHEN template.family='important' THEN 'high' ELSE 'normal' END,'sent',ARRAY['in_app'],false,
     v_payload,p_event,2,p_key,template.family,p_ticket,p_transaction)
 ON CONFLICT(user_id,dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING RETURNING id INTO v_id;
 IF v_id IS NULL THEN SELECT id INTO v_id FROM public.notifications WHERE user_id=p_user AND dedupe_key=p_key; RETURN v_id; END IF;
 -- A disabled rollout never accumulates messages for a later burst on activation.
 v_state:=CASE WHEN config.delivery_enabled THEN 'pending' ELSE 'skipped' END;
 IF template.email THEN
   INSERT INTO notification_core.deliveries(notification_id,recipient_id,channel,target,state,last_code)
   VALUES(v_id,p_user,'email','email',v_state,CASE WHEN v_state='skipped' THEN 'delivery_disabled' END);
 END IF;
 IF template.push THEN
   INSERT INTO notification_core.deliveries(notification_id,recipient_id,channel,target,device_id,device_revision,state,last_code)
   SELECT v_id,p_user,'push',d.id::text,d.id,d.revision,v_state,CASE WHEN v_state='skipped' THEN 'delivery_disabled' END
   FROM notification_core.devices d WHERE d.user_id=p_user AND d.active AND d.expo_project_id=config.expo_project_id;
   IF NOT FOUND THEN
     INSERT INTO notification_core.deliveries(notification_id,recipient_id,channel,target,state,last_code)
     VALUES(v_id,p_user,'push','unregistered','skipped','no_registered_device');
   END IF;
 END IF;
 RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.enqueue_core_notification(uuid,text,text,uuid,uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_core_notification(uuid,text,text,uuid,uuid,uuid,jsonb) TO service_role;

-- Stop duplicate legacy producers only for migrated recipients and covered kinds.
CREATE FUNCTION notification_core.suppress_legacy() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.notification_version=1 AND notification_core.enabled_for(NEW.user_id) AND NEW.type IN
 ('purchase_confirmed','purchase_completed','purchase_fulfilled','PURCHASE_SUCCESS','compra_entrada','compra_vip',
 'event_cancelled','event_deleted','event_date_changed','event_time_changed','event_venue_changed','event_location_changed',
 'event_access_policy_changed','event_lineup_changed','ticket_validated','entrada_validada','organizer_verified','organizer_rejected') THEN RETURN NULL; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER notification_core_legacy_cutover BEFORE INSERT ON public.notifications
FOR EACH ROW EXECUTE FUNCTION notification_core.suppress_legacy();

-- Reading/archiving cannot edit message data, recipient or delivery state. Legacy apps may still send status=read.
CREATE FUNCTION notification_core.guard_client_update() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF current_user IN ('anon','authenticated') THEN
   IF auth.uid() IS NULL OR OLD.user_id IS DISTINCT FROM auth.uid() OR
      (to_jsonb(NEW)-ARRAY['read','read_at','archived_at','status']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['read','read_at','archived_at','status']) THEN
      RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501';
   END IF;
   NEW.status:=OLD.status;
   NEW.read_at:=CASE WHEN NEW.read THEN COALESCE(OLD.read_at,now()) ELSE NULL END;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER notification_core_read_boundary BEFORE UPDATE ON public.notifications
FOR EACH ROW EXECUTE FUNCTION notification_core.guard_client_update();
REVOKE DELETE ON public.notifications FROM anon,authenticated;

CREATE FUNCTION public.set_core_notification_state(p_id uuid DEFAULT NULL,p_read boolean DEFAULT NULL,p_archive boolean DEFAULT NULL,p_user uuid DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE affected integer;
BEGIN
 IF auth.uid() IS NULL OR (p_user IS NOT NULL AND auth.uid() IS DISTINCT FROM p_user) THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
 IF p_read IS NULL AND p_archive IS NULL THEN RETURN 0; END IF;
 UPDATE public.notifications SET
   read=COALESCE(p_read,read),
   read_at=CASE WHEN p_read IS NULL THEN read_at WHEN p_read THEN COALESCE(read_at,now()) ELSE NULL END,
   archived_at=CASE WHEN p_archive IS NULL THEN archived_at WHEN p_archive THEN COALESCE(archived_at,now()) ELSE NULL END
 WHERE user_id=auth.uid() AND (p_id IS NULL OR id=p_id);
 GET DIAGNOSTICS affected=ROW_COUNT;
 RETURN affected;
END $$;
REVOKE ALL ON FUNCTION public.set_core_notification_state(uuid,boolean,boolean,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_core_notification_state(uuid,boolean,boolean,uuid) TO authenticated;

CREATE FUNCTION public.set_core_notification_preferences(p_values jsonb,p_user uuid DEFAULT NULL) RETURNS public.notification_settings
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE k text; v jsonb; result public.notification_settings;
BEGIN
 IF auth.uid() IS NULL OR (p_user IS NOT NULL AND auth.uid() IS DISTINCT FROM p_user) OR p_values IS NULL OR jsonb_typeof(p_values)<>'object' THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
 FOR k,v IN SELECT * FROM jsonb_each(p_values) LOOP
   IF k NOT IN ('push_enabled','email_enabled','purchase_updates','important_updates','quiet_hours_enabled','event_reminders','stock_alerts','realtime_sales','daily_summary','stock_threshold_alerts') OR jsonb_typeof(v)<>'boolean' THEN
     RAISE EXCEPTION 'Invalid preference';
   END IF;
 END LOOP;
 INSERT INTO public.notification_settings(user_id) VALUES(auth.uid()) ON CONFLICT(user_id) DO NOTHING;
 UPDATE public.notification_settings SET
   push_enabled=COALESCE((p_values->>'push_enabled')::boolean,push_enabled),
   email_enabled=COALESCE((p_values->>'email_enabled')::boolean,email_enabled),
   purchase_updates=COALESCE((p_values->>'purchase_updates')::boolean,purchase_updates),
   important_updates=COALESCE((p_values->>'important_updates')::boolean,important_updates),
   quiet_hours_enabled=COALESCE((p_values->>'quiet_hours_enabled')::boolean,quiet_hours_enabled),
   event_reminders=COALESCE((p_values->>'event_reminders')::boolean,event_reminders),
   stock_alerts=COALESCE((p_values->>'stock_alerts')::boolean,stock_alerts),
   realtime_sales=COALESCE((p_values->>'realtime_sales')::boolean,realtime_sales),
   daily_summary=COALESCE((p_values->>'daily_summary')::boolean,daily_summary),
   stock_threshold_alerts=COALESCE((p_values->>'stock_threshold_alerts')::boolean,stock_threshold_alerts),updated_at=now()
 WHERE user_id=auth.uid() RETURNING * INTO result;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.set_core_notification_preferences(jsonb,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_core_notification_preferences(jsonb,uuid) TO authenticated;

CREATE FUNCTION public.register_core_push_token(p_user uuid,p_token text,p_platform text,p_project uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE sid uuid;
BEGIN
 IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_user THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
 sid:=NULLIF(auth.jwt()->>'session_id','')::uuid;
 IF NOT EXISTS(SELECT 1 FROM auth.sessions WHERE id=sid AND user_id=p_user AND (not_after IS NULL OR not_after>now())) THEN RAISE EXCEPTION 'Inactive session' USING ERRCODE='42501'; END IF;
 IF p_platform NOT IN ('ios','android') OR p_token !~ '^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]{10,200}\]$' OR p_project IS NULL THEN RAISE EXCEPTION 'Invalid push registration'; END IF;
 INSERT INTO notification_core.devices(user_id,session_id,token,platform,expo_project_id)
 VALUES(p_user,sid,p_token,p_platform,p_project)
 ON CONFLICT(token) DO UPDATE SET user_id=excluded.user_id,session_id=excluded.session_id,platform=excluded.platform,expo_project_id=excluded.expo_project_id,
 revision=CASE WHEN notification_core.devices.user_id=excluded.user_id AND notification_core.devices.session_id=excluded.session_id AND notification_core.devices.active
 AND notification_core.devices.expo_project_id=excluded.expo_project_id THEN notification_core.devices.revision ELSE gen_random_uuid() END,active=true,updated_at=now();
 -- Do not leave an old user's token active in the legacy sender after device migration.
 UPDATE public.user_push_tokens SET is_active=false WHERE token=p_token;
END $$;
REVOKE ALL ON FUNCTION public.register_core_push_token(uuid,text,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.register_core_push_token(uuid,text,text,uuid) TO authenticated;
CREATE FUNCTION public.unregister_core_push_token(p_user uuid,p_token text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_user THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
 UPDATE notification_core.devices SET active=false,revision=gen_random_uuid(),updated_at=now() WHERE token=p_token AND user_id=auth.uid();
 UPDATE public.user_push_tokens SET is_active=false WHERE token=p_token AND user_id=auth.uid();
END $$;
REVOKE ALL ON FUNCTION public.unregister_core_push_token(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.unregister_core_push_token(uuid,text) TO authenticated;

-- Successful paid fulfillment is the sole producer for paid checkout; no per-ticket duplication.
CREATE FUNCTION notification_core.capture_payment() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE kind text; t public.tickets%ROWTYPE; e public.events%ROWTYPE; payload jsonb;
BEGIN
 IF NEW.kind NOT IN ('event_ticket','vip_table') OR NEW.status IS NOT DISTINCT FROM OLD.status OR NOT notification_core.enabled_for(NEW.user_id) THEN RETURN NEW; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.payment_transactions WHERE id=NEW.id AND status=NEW.status) THEN RETURN NEW; END IF;
 SELECT * INTO e FROM public.events WHERE id=NULLIF(NEW.metadata->>'event_id','')::uuid;
 payload:=jsonb_build_object('event_title',COALESCE(e.title,'tu evento'));
 IF NEW.status='fulfilled' THEN
   SELECT * INTO t FROM public.tickets WHERE user_id=NEW.user_id AND (payment_transaction_id=NEW.id OR stripe_payment_intent_id=NEW.stripe_payment_intent_id)
     AND payment_status='paid' AND status IN ('valid','active','used') ORDER BY id LIMIT 1;
   IF NOT FOUND THEN RAISE EXCEPTION 'Fulfilled purchase has no issued ticket'; END IF;
   kind:=CASE WHEN NEW.kind='vip_table' THEN 'order.vip_confirmed' ELSE 'order.admission_confirmed' END;
   payload:=payload||jsonb_build_object('product_name',COALESCE(t.product_snapshot->>'name','VIP'),'group_size',t.quantity);
 ELSIF NEW.status='refund_pending' THEN kind:='refund.processing';
 ELSIF NEW.status='refunded' THEN kind:='refund.completed';
 ELSE RETURN NEW; END IF;
 PERFORM public.enqueue_core_notification(NEW.user_id,kind,'payment:'||NEW.id||':'||kind,e.id,t.id,NEW.id,payload);
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER notification_core_payment AFTER UPDATE ON public.payment_transactions DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION notification_core.capture_payment();

CREATE FUNCTION notification_core.capture_ticket() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t public.tickets%ROWTYPE; e public.events%ROWTYPE; kind text; k text;
BEGIN
 SELECT * INTO t FROM public.tickets WHERE id=NEW.id;
 IF NOT FOUND OR t.user_id IS NULL OR NOT notification_core.enabled_for(t.user_id) THEN RETURN NEW; END IF;
 SELECT * INTO e FROM public.events WHERE id=t.event_id;
 IF TG_OP='INSERT' THEN
   IF t.payment_transaction_id IS NOT NULL OR t.stripe_payment_intent_id IS NOT NULL OR t.payment_status IS DISTINCT FROM 'paid' OR t.status NOT IN ('valid','active') THEN RETURN NEW; END IF;
   IF t.sold_by_worker_id IS NOT NULL THEN kind:='order.box_office_issued'; k:='ticket:'||t.id;
   ELSIF t.total_price=0 THEN kind:='order.free_confirmed'; k:='free:'||COALESCE(t.free_claim_id,t.id);
   ELSE RETURN NEW; END IF;
 ELSE
   IF t.user_id IS DISTINCT FROM OLD.user_id THEN RETURN NEW; END IF;
   IF OLD.scanned_at IS NULL AND t.scanned_at IS NOT NULL THEN kind:='ticket.checked_in';
   ELSIF OLD.status IN ('valid','active') AND t.status IN ('cancelled','revoked','invalid','refunded') THEN
     IF e.is_cancelled OR e.status='cancelled' OR t.payment_status='refunded' THEN RETURN NEW; END IF;
     kind:='ticket.invalidated';
   ELSIF t.status IN ('valid','active') AND (t.product_snapshot IS DISTINCT FROM OLD.product_snapshot OR t.entry_deadline IS DISTINCT FROM OLD.entry_deadline) THEN kind:='order.benefits_changed';
   ELSE RETURN NEW; END IF;
   k:='ticket:'||t.id||':'||kind||CASE WHEN kind='order.benefits_changed' THEN ':'||txid_current() ELSE '' END;
 END IF;
 PERFORM public.enqueue_core_notification(t.user_id,kind,k,e.id,t.id,t.payment_transaction_id,jsonb_build_object('event_title',COALESCE(e.title,'tu evento')));
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER notification_core_ticket AFTER INSERT OR UPDATE ON public.tickets DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION notification_core.capture_ticket();

CREATE FUNCTION notification_core.capture_event() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE kind text; u uuid; revision text:=txid_current()::text; e public.events%ROWTYPE; fields jsonb:='[]';
BEGIN
 IF TG_OP='DELETE' THEN e:=OLD; kind:='event.cancelled';
 ELSE
   SELECT * INTO e FROM public.events WHERE id=NEW.id;
   IF NOT FOUND THEN RETURN NEW; END IF;
   IF (e.is_cancelled OR e.status='cancelled') AND NOT (COALESCE(OLD.is_cancelled,false) OR COALESCE(OLD.status,'')='cancelled') THEN kind:='event.cancelled';
   ELSE
     IF e.event_date IS DISTINCT FROM OLD.event_date OR e.end_datetime IS DISTINCT FROM OLD.end_datetime THEN kind:='event.schedule_changed'; fields:=fields||'"schedule"'::jsonb; END IF;
     IF e.venue_id IS DISTINCT FROM OLD.venue_id THEN kind:=COALESCE(kind,'event.venue_changed'); fields:=fields||'"venue"'::jsonb; END IF;
     IF (to_jsonb(e)->'dress_code') IS DISTINCT FROM (to_jsonb(OLD)->'dress_code') OR (to_jsonb(e)->'age_restriction') IS DISTINCT FROM (to_jsonb(OLD)->'age_restriction')
      OR (to_jsonb(e)->'access_policy') IS DISTINCT FROM (to_jsonb(OLD)->'access_policy') OR (to_jsonb(e)->'access_requirements') IS DISTINCT FROM (to_jsonb(OLD)->'access_requirements') THEN kind:=COALESCE(kind,'event.access_changed'); fields:=fields||'"access"'::jsonb; END IF;
     IF (to_jsonb(e)->'lineup') IS DISTINCT FROM (to_jsonb(OLD)->'lineup') THEN kind:=COALESCE(kind,'event.lineup_changed'); fields:=fields||'"lineup"'::jsonb; END IF;
   END IF;
 END IF;
 IF kind IS NULL THEN RETURN NEW; END IF;
 FOR u IN SELECT DISTINCT user_id FROM public.tickets WHERE event_id=e.id AND user_id IS NOT NULL AND payment_status='paid' AND status IN ('valid','active','used') LOOP
   PERFORM public.enqueue_core_notification(u,kind,'event:'||e.id||':'||revision,CASE WHEN TG_OP='DELETE' THEN NULL ELSE e.id END,NULL,NULL,
     jsonb_build_object('event_title',e.title,'changed_fields',fields,'event_date',e.event_date,'venue_id',e.venue_id));
 END LOOP;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER notification_core_event_update AFTER UPDATE ON public.events DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION notification_core.capture_event();
CREATE TRIGGER notification_core_event_delete BEFORE DELETE ON public.events FOR EACH ROW EXECUTE FUNCTION notification_core.capture_event();


-- Editing the existing venue (not changing venue_id) also changes the place buyers must attend.
CREATE FUNCTION notification_core.capture_venue() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e public.events%ROWTYPE; u uuid;
BEGIN
 IF (to_jsonb(NEW)->'name') IS NOT DISTINCT FROM (to_jsonb(OLD)->'name')
 AND (to_jsonb(NEW)->'address') IS NOT DISTINCT FROM (to_jsonb(OLD)->'address')
 AND (to_jsonb(NEW)->'latitude') IS NOT DISTINCT FROM (to_jsonb(OLD)->'latitude')
 AND (to_jsonb(NEW)->'longitude') IS NOT DISTINCT FROM (to_jsonb(OLD)->'longitude') THEN RETURN NEW; END IF;
 FOR e IN SELECT * FROM public.events WHERE venue_id=NEW.id AND NOT COALESCE(is_cancelled,false)
   AND COALESCE(status,'') NOT IN ('cancelled','deleted') AND COALESCE(end_datetime,event_date+interval '5 hours')>now() LOOP
   FOR u IN SELECT DISTINCT user_id FROM public.tickets WHERE event_id=e.id AND user_id IS NOT NULL AND payment_status='paid' AND status IN ('valid','active','used') LOOP
     PERFORM public.enqueue_core_notification(u,'event.venue_changed','venue:'||NEW.id||':'||e.id||':'||txid_current(),e.id,NULL,NULL,
       jsonb_build_object('event_title',e.title,'changed_fields',jsonb_build_array('venue')));
   END LOOP;
 END LOOP;
 RETURN NEW;
END $$;
CREATE TRIGGER notification_core_venue AFTER UPDATE ON public.venues FOR EACH ROW EXECUTE FUNCTION notification_core.capture_venue();

CREATE FUNCTION notification_core.capture_verification() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE kind text;
BEGIN
 IF NEW.role IS DISTINCT FROM 'organizer' OR NEW.verification_status IS NOT DISTINCT FROM OLD.verification_status THEN RETURN NEW; END IF;
 IF NEW.verification_status IN ('approved','verified') THEN kind:='organizer.verification_approved';
 ELSIF NEW.verification_status IN ('rejected','changes_requested','needs_correction') THEN kind:='organizer.verification_changes';
 ELSE RETURN NEW; END IF;
 PERFORM public.enqueue_core_notification(NEW.id,kind,'verification:'||NEW.id||':'||gen_random_uuid());
 RETURN NEW;
END $$;
CREATE TRIGGER notification_core_verification AFTER UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION notification_core.capture_verification();

-- Claim and prepare are separate, short transactions. Never hold a SQL lock during HTTP.
CREATE FUNCTION public.claim_core_notification_deliveries(p_project_ref text,p_limit integer DEFAULT 10) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM notification_core.runtime WHERE singleton AND capture_enabled AND delivery_enabled AND project_ref=p_project_ref) THEN RETURN '[]'; END IF;
 UPDATE notification_core.deliveries SET state='expired',last_code='expired',lease_token=NULL,lease_until=NULL
 WHERE state IN ('pending','leased') AND expires_at<=now();
 UPDATE notification_core.deliveries SET state=CASE WHEN state='leased' THEN 'pending' WHEN channel='email' AND attempts<4 AND expires_at>now() THEN 'pending' ELSE 'uncertain' END,
     last_code='lease_expired',lease_token=NULL,lease_until=NULL
 WHERE state IN ('leased','sending') AND lease_until<=now();
 WITH due AS (
   SELECT id FROM notification_core.deliveries WHERE state='pending' AND attempts<4 AND next_attempt_at<=now() AND expires_at>now()
   ORDER BY next_attempt_at,id LIMIT LEAST(GREATEST(p_limit,1),20) FOR UPDATE SKIP LOCKED
 ), claimed AS (
   UPDATE notification_core.deliveries d SET state='leased',lease_token=gen_random_uuid(),lease_until=now()+interval '2 minutes'
   FROM due WHERE d.id=due.id RETURNING d.id,d.lease_token,d.channel
 ) SELECT COALESCE(jsonb_agg(claimed),'[]') INTO result FROM claimed;
 RETURN result;
END $$;

CREATE FUNCTION public.prepare_core_notification_delivery(p_id uuid,p_lease uuid,p_project_ref text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d notification_core.deliveries%ROWTYPE; n public.notifications%ROWTYPE; device notification_core.devices%ROWTYPE;
 pref public.notification_settings%ROWTYPE; config notification_core.runtime%ROWTYPE; recipient text; reason text; local_time time; wake timestamptz;
BEGIN
 SELECT * INTO d FROM notification_core.deliveries WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR d.state<>'leased' OR d.lease_token IS DISTINCT FROM p_lease OR d.lease_until<=now() THEN RETURN NULL; END IF;
 SELECT * INTO config FROM notification_core.runtime WHERE singleton;
 SELECT * INTO n FROM public.notifications WHERE id=d.notification_id;
 SELECT * INTO pref FROM public.notification_settings WHERE user_id=d.recipient_id;
 IF NOT config.capture_enabled OR NOT config.delivery_enabled OR config.project_ref IS DISTINCT FROM p_project_ref OR NOT notification_core.enabled_for(d.recipient_id) THEN reason:='delivery_disabled';
 ELSIF d.expires_at<=now() THEN reason:='expired';
 ELSIF n.user_id IS DISTINCT FROM d.recipient_id OR n.notification_version<>2 THEN reason:='recipient_mismatch';
 ELSIF n.role='organizer' AND NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=d.recipient_id AND role='organizer' AND NOT is_suspended) THEN reason:='role_revoked';
 ELSIF (d.channel='push' AND pref.push_enabled=false) OR (d.channel='email' AND pref.email_enabled=false)
   OR (n.category='purchase' AND pref.purchase_updates=false) OR (n.category='important' AND pref.important_updates=false) THEN reason:='opted_out';
 END IF;
 -- Re-check device ownership AND session immediately before delivery. Never copy tokens into an outbox.
 IF reason IS NULL AND d.channel='push' THEN
   SELECT * INTO device FROM notification_core.devices WHERE id=d.device_id;
   IF NOT FOUND OR NOT device.active OR device.user_id<>d.recipient_id OR device.revision IS DISTINCT FROM d.device_revision OR device.expo_project_id IS DISTINCT FROM config.expo_project_id
      OR NOT EXISTS(SELECT 1 FROM auth.sessions WHERE id=device.session_id AND user_id=d.recipient_id AND (not_after IS NULL OR not_after>now())) THEN reason:='device_or_session_revoked';
   ELSE recipient:=device.token; END IF;
 ELSIF reason IS NULL THEN
   SELECT email INTO recipient FROM auth.users WHERE id=d.recipient_id AND email_confirmed_at IS NOT NULL;
   IF recipient IS NULL THEN reason:='no_verified_email'; END IF;
 END IF;
 IF reason IS NOT NULL THEN
   UPDATE notification_core.deliveries SET state=CASE WHEN reason='expired' THEN 'expired' ELSE 'skipped' END,last_code=reason,lease_token=NULL,lease_until=NULL WHERE id=p_id;
   RETURN NULL;
 END IF;
 -- No unapproved event-night exception. User-initiated order confirmations remain immediate.
 IF d.channel='push' AND pref.muted_until>now() THEN wake:=pref.muted_until;
 ELSIF d.channel='push' AND pref.quiet_hours_enabled AND n.type NOT LIKE 'order.%' THEN
   IF NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=pref.timezone) THEN RAISE EXCEPTION 'Invalid notification timezone'; END IF;
   local_time:=(now() AT TIME ZONE pref.timezone)::time;
   IF (pref.quiet_start<pref.quiet_end AND local_time>=pref.quiet_start AND local_time<pref.quiet_end)
     OR (pref.quiet_start>pref.quiet_end AND (local_time>=pref.quiet_start OR local_time<pref.quiet_end)) THEN
     wake:=(((now() AT TIME ZONE pref.timezone)::date + pref.quiet_end)+CASE WHEN pref.quiet_start>pref.quiet_end AND local_time>=pref.quiet_start THEN interval '1 day' ELSE interval '0' END) AT TIME ZONE pref.timezone;
   END IF;
 END IF;
 IF wake IS NOT NULL THEN
   UPDATE notification_core.deliveries SET state=CASE WHEN wake>=expires_at THEN 'expired' ELSE 'pending' END,next_attempt_at=wake,last_code='quiet_hours',lease_token=NULL,lease_until=NULL WHERE id=p_id;
   RETURN NULL;
 END IF;
 UPDATE notification_core.deliveries SET state='sending',attempts=attempts+1 WHERE id=p_id;
 RETURN jsonb_build_object('id',d.id,'lease',p_lease,'notification_id',n.id,'channel',d.channel,'recipient',recipient,'title',n.title,'body',n.body,
   'type',n.type,'family',n.category,'attempt',d.attempts+1,'expires_at',d.expires_at);
END $$;

CREATE FUNCTION public.finish_core_notification_delivery(p_id uuid,p_lease uuid,p_state text,p_code text DEFAULT NULL,p_provider_id text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d notification_core.deliveries%ROWTYPE;
BEGIN
 IF p_state NOT IN ('accepted','pending','failed','skipped','uncertain') OR length(COALESCE(p_code,''))>80 OR length(COALESCE(p_provider_id,''))>200 THEN RAISE EXCEPTION 'Invalid delivery result'; END IF;
 SELECT * INTO d FROM notification_core.deliveries WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR d.state<>'sending' OR d.lease_token IS DISTINCT FROM p_lease OR d.lease_until<=now() THEN RETURN false; END IF;
 IF p_state='accepted' AND NULLIF(p_provider_id,'') IS NULL THEN RAISE EXCEPTION 'Provider receipt required'; END IF;
 UPDATE notification_core.deliveries SET state=CASE WHEN p_state='pending' AND (attempts>=4 OR expires_at<=now()) THEN 'failed' ELSE p_state END,
   next_attempt_at=now()+make_interval(secs=>CASE d.attempts WHEN 1 THEN 60 WHEN 2 THEN 300 WHEN 3 THEN 900 ELSE 3600 END),
   provider_id=p_provider_id,accepted_at=CASE WHEN p_state='accepted' THEN now() ELSE NULL END,last_code=p_code,lease_token=NULL,lease_until=NULL WHERE id=p_id;
 IF p_code='DeviceNotRegistered' THEN UPDATE notification_core.devices SET active=false WHERE id=d.device_id AND revision=d.device_revision; END IF;
 RETURN true;
END $$;

CREATE FUNCTION public.list_core_notification_receipts(p_project_ref text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM notification_core.runtime WHERE singleton AND delivery_enabled AND project_ref=p_project_ref) THEN RETURN '[]'; END IF;
 UPDATE notification_core.deliveries SET state='uncertain',last_code='receipt_expired' WHERE state='accepted' AND channel='push' AND accepted_at<now()-interval '23 hours';
 SELECT COALESCE(jsonb_agg(x),'[]') INTO result FROM (
   SELECT id,provider_id FROM notification_core.deliveries WHERE state='accepted' AND channel='push' AND accepted_at<now()-interval '15 minutes'
   ORDER BY accepted_at LIMIT 100
 ) x;
 RETURN result;
END $$;
CREATE FUNCTION public.finish_core_notification_receipt(p_id uuid,p_provider_id text,p_ok boolean,p_code text DEFAULT NULL) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d notification_core.deliveries%ROWTYPE;
BEGIN
 IF length(COALESCE(p_code,''))>80 THEN RAISE EXCEPTION 'Invalid receipt code'; END IF;
 UPDATE notification_core.deliveries SET state=CASE WHEN p_ok THEN 'provider_confirmed' ELSE 'failed' END,
   confirmed_at=CASE WHEN p_ok THEN now() ELSE NULL END,last_code=p_code
 WHERE id=p_id AND provider_id=p_provider_id AND state='accepted' AND channel='push' RETURNING * INTO d;
 IF NOT FOUND THEN RETURN false; END IF;
 IF p_code='DeviceNotRegistered' THEN UPDATE notification_core.devices SET active=false WHERE id=d.device_id AND revision=d.device_revision; END IF;
 RETURN true;
END $$;

REVOKE ALL ON FUNCTION public.claim_core_notification_deliveries(text,integer),public.prepare_core_notification_delivery(uuid,uuid,text),public.finish_core_notification_delivery(uuid,uuid,text,text,text),public.list_core_notification_receipts(text),public.finish_core_notification_receipt(uuid,text,boolean,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_core_notification_deliveries(text,integer),public.prepare_core_notification_delivery(uuid,uuid,text),public.finish_core_notification_delivery(uuid,uuid,text,text,text),public.list_core_notification_receipts(text),public.finish_core_notification_receipt(uuid,text,boolean,text) TO service_role;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA notification_core FROM PUBLIC,anon,authenticated;
REVOKE ALL ON ALL TABLES IN SCHEMA notification_core FROM PUBLIC,anon,authenticated;

-- Exact unread total is independent from the current page and the delivery state.
CREATE FUNCTION public.core_notification_unread_count() RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT count(*) FROM public.notifications n WHERE n.user_id=auth.uid() AND n.archived_at IS NULL
   AND NOT COALESCE(n.read,false) AND n.read_at IS NULL
   AND (n.notification_version=2 OR COALESCE(n.status,'')<>'read')
$$;
REVOKE ALL ON FUNCTION public.core_notification_unread_count() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.core_notification_unread_count() TO authenticated;
