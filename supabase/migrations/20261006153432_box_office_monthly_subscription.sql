-- Billing state is written only by the authenticated server / signed Stripe webhook.
CREATE TABLE public.organizer_box_office_subscriptions (
 organizer_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
 stripe_customer_id text UNIQUE,
 stripe_subscription_id text UNIQUE,
 checkout_session_id text UNIQUE,
 checkout_generation uuid NOT NULL DEFAULT gen_random_uuid(),
 status text NOT NULL DEFAULT 'inactive',
 paid_through timestamptz,
 cancel_at_period_end boolean NOT NULL DEFAULT false,
 amount_cents integer NOT NULL DEFAULT 5000 CHECK (amount_cents=5000),
 currency text NOT NULL DEFAULT 'eur' CHECK(currency='eur'),
 billing_interval text NOT NULL DEFAULT 'month' CHECK(billing_interval='month'),
 synced_at timestamptz NOT NULL DEFAULT '-infinity',
 updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.organizer_box_office_subscriptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.organizer_box_office_subscriptions FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.organizer_box_office_subscriptions TO authenticated;
GRANT ALL ON public.organizer_box_office_subscriptions TO service_role;
CREATE POLICY owner_read ON public.organizer_box_office_subscriptions FOR SELECT TO authenticated
 USING (organizer_id=(SELECT auth.uid()));

CREATE OR REPLACE FUNCTION private.has_box_office_subscription(p_organizer_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.organizer_box_office_subscriptions s
 JOIN public.profiles p ON p.id=s.organizer_id
 WHERE s.organizer_id=p_organizer_id AND s.status='active' AND s.paid_through>now()
 AND p.role='organizer' AND NOT coalesce(p.is_suspended,false));
$$;
REVOKE ALL ON FUNCTION private.has_box_office_subscription(uuid) FROM PUBLIC,anon,authenticated;

-- Deliberately exposes effective capabilities, never billing identifiers, to the team.
CREATE OR REPLACE FUNCTION public.get_box_office_access(p_organizer_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE uid uuid:=auth.uid(); w public.workers%ROWTYPE; s public.organizer_box_office_subscriptions%ROWTYPE; enabled boolean;
BEGIN
 IF uid IS NULL OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=uid AND NOT coalesce(is_suspended,false)) THEN
   RAISE EXCEPTION 'Not authenticated' USING ERRCODE='42501'; END IF;
 SELECT * INTO w FROM public.workers WHERE organizer_id=p_organizer_id AND user_id=uid AND status='active' LIMIT 1;
 IF uid IS DISTINCT FROM p_organizer_id AND w.id IS NULL THEN
   RAISE EXCEPTION 'Not your organizer' USING ERRCODE='42501'; END IF;
 SELECT * INTO s FROM public.organizer_box_office_subscriptions WHERE organizer_id=p_organizer_id;
 enabled:=private.has_box_office_subscription(p_organizer_id);
 RETURN jsonb_build_object('enabled',enabled,'can_sell',enabled AND
   (uid=p_organizer_id OR (jsonb_typeof(w.permissions)='array' AND w.permissions ? 'sell')
   OR (jsonb_typeof(w.permissions)='object' AND w.permissions->>'sell'='true')),
   'status',coalesce(s.status,'inactive'),'paid_through',s.paid_through,
   'cancel_at_period_end',coalesce(s.cancel_at_period_end,false),'amount_cents',5000,'currency','eur','interval','month');
END $$;
REVOKE ALL ON FUNCTION public.get_box_office_access(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_box_office_access(uuid) TO authenticated;

-- Protect every ticket-issuing path, including older clients and component RPCs.
-- An idempotent retry returning an existing receipt inserts nothing and remains safe.
CREATE OR REPLACE FUNCTION private.enforce_box_office_subscription()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE org uuid;
BEGIN
 IF NEW.sold_by_worker_id IS NOT NULL THEN
   SELECT organizer_id INTO org FROM public.workers WHERE id=NEW.sold_by_worker_id AND status='active';
   IF NOT private.has_box_office_subscription(org) THEN
     RAISE EXCEPTION 'TAQUILLA_PREMIUM_REQUIRED: El organizador necesita Taquilla Premium (50 €/mes) para vender. El escáner sigue disponible.' USING ERRCODE='42501';
   END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.enforce_box_office_subscription() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER enforce_box_office_subscription BEFORE INSERT ON public.tickets
 FOR EACH ROW EXECUTE FUNCTION private.enforce_box_office_subscription();

-- Ignore stale concurrent responses. Stripe is always re-read before this call.
CREATE OR REPLACE FUNCTION public.sync_box_office_subscription(
 p_organizer_id uuid,p_customer_id text,p_subscription_id text,p_status text,
 p_paid_through timestamptz,p_cancel_at_period_end boolean,p_requested_at timestamptz
) RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 UPDATE public.organizer_box_office_subscriptions SET stripe_subscription_id=p_subscription_id,
 status=p_status,paid_through=p_paid_through,cancel_at_period_end=p_cancel_at_period_end,
 synced_at=p_requested_at,updated_at=now()
 WHERE organizer_id=p_organizer_id AND stripe_customer_id=p_customer_id AND synced_at<=p_requested_at;
$$;
REVOKE ALL ON FUNCTION public.sync_box_office_subscription(uuid,text,text,text,timestamptz,boolean,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sync_box_office_subscription(uuid,text,text,text,timestamptz,boolean,timestamptz) TO service_role;
