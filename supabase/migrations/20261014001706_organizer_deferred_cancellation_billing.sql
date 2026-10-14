-- No deposit. Server-only mandate, refund and collection ledgers.
-- This migration does not enable charging, cancel events, or move money.
CREATE TABLE public.organizer_billing_accounts (
  organizer_id uuid PRIMARY KEY,
  stripe_customer_id text NOT NULL UNIQUE,
  livemode boolean NOT NULL,
  setup_intent_id text UNIQUE,
  payment_method_id text,
  policy_version text,
  consent_text text,
  consent_sha256 text,
  consent_at timestamptz,
  ready boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.organizer_billing_setups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organizer_id uuid NOT NULL REFERENCES public.organizer_billing_accounts(organizer_id),
  setup_intent_id text UNIQUE,
  policy_version text NOT NULL,
  consent_text text NOT NULL,
  consent_sha256 text NOT NULL,
  consent_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','succeeded','canceled'))
);
CREATE INDEX organizer_billing_setups_owner_idx ON public.organizer_billing_setups(organizer_id);
CREATE TABLE public.event_cancellations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL UNIQUE REFERENCES public.events(id) ON DELETE RESTRICT,
  organizer_id uuid NOT NULL REFERENCES public.organizer_billing_accounts(organizer_id),
  livemode boolean NOT NULL,
  policy_version text NOT NULL,
  setup_intent_id text NOT NULL,
  reason text NOT NULL CHECK (length(reason) BETWEEN 3 AND 500),
  status text NOT NULL DEFAULT 'refunding'
    CHECK (status IN ('refunding','reconciliation','collection_pending','requires_action','collected','attention')),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  checked_at timestamptz,
  lease_token uuid,
  lease_until timestamptz
);
CREATE INDEX event_cancellations_owner_idx ON public.event_cancellations(organizer_id);
CREATE TABLE public.organizer_settlement_transfers (
  transaction_id uuid PRIMARY KEY REFERENCES public.payment_transactions(id) ON DELETE RESTRICT,
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE RESTRICT,
  organizer_id uuid NOT NULL,
  destination_account_id text NOT NULL,
  amount_cents integer NOT NULL CHECK(amount_cents>0),
  livemode boolean NOT NULL,
  transfer_id text UNIQUE,
  first_attempt_at timestamptz,
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','transferred','attention')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX organizer_settlement_event_idx ON public.organizer_settlement_transfers(event_id);
CREATE INDEX organizer_settlement_owner_idx ON public.organizer_settlement_transfers(organizer_id);
CREATE TABLE public.cancellation_refunds (
  transaction_id uuid PRIMARY KEY REFERENCES public.payment_transactions(id) ON DELETE RESTRICT,
  cancellation_id uuid NOT NULL REFERENCES public.event_cancellations(id),
  payment_intent_id text NOT NULL UNIQUE,
  refund_id text UNIQUE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','succeeded','not_paid','attention')),
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  commission_cents integer NOT NULL CHECK (commission_cents >= 0),
  service_charge_cents integer NOT NULL CHECK (service_charge_cents >= 0),
  fee_evidence jsonb,
  last_error text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX cancellation_refunds_job_idx ON public.cancellation_refunds(cancellation_id);
CREATE TABLE public.cancellation_collections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cancellation_id uuid NOT NULL UNIQUE REFERENCES public.event_cancellations(id),
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  commission_cents integer NOT NULL CHECK (commission_cents >= 0),
  stripe_costs_cents integer NOT NULL CHECK (stripe_costs_cents >= 0),
  cost_evidence jsonb NOT NULL,
  reconciliation_reference text NOT NULL,
  notice_delivered_at timestamptz,
  payment_intent_id text UNIQUE,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','processing','requires_action','requires_payment_method','succeeded','attention')),
  first_attempt_at timestamptz,
  collection_fee_evidence jsonb,
  residual_costs_status text NOT NULL DEFAULT 'pending' CHECK (residual_costs_status IN ('pending','reviewed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (amount_cents = commission_cents + stripe_costs_cents)
);

-- No browser or app can forge consent, fees, a refund, or a paid debt.
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['organizer_billing_accounts','organizer_billing_setups',
    'event_cancellations','cancellation_refunds','cancellation_collections','organizer_settlement_transfers'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',t);
    EXECUTE format('GRANT SELECT,INSERT,UPDATE ON public.%I TO service_role',t);
  END LOOP;
END $$;

CREATE FUNCTION public.request_event_cancellation(p_event uuid,p_organizer uuid,p_reason text,p_livemode boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE ev public.events%ROWTYPE; billing public.organizer_billing_accounts%ROWTYPE;
  job public.event_cancellations%ROWTYPE;
BEGIN
  -- Only the trusted API has EXECUTE. Ownership is checked again under lock.
  SELECT * INTO ev FROM public.events WHERE id=p_event FOR UPDATE;
  IF NOT FOUND OR ev.creator_id IS DISTINCT FROM p_organizer THEN
    RAISE EXCEPTION 'EVENT_NOT_OWNED' USING ERRCODE='42501';
  END IF;
  SELECT * INTO job FROM public.event_cancellations WHERE event_id=p_event;
  IF FOUND THEN RETURN to_jsonb(job); END IF;
  IF ev.event_date IS NULL OR ev.event_date <= now() THEN
    RAISE EXCEPTION 'STARTED_EVENT_REQUIRES_SUPPORT' USING ERRCODE='PT409';
  END IF;
  IF ev.is_cancelled OR ev.status='cancelled' THEN
    RAISE EXCEPTION 'EXISTING_CANCELLATION_REQUIRES_SUPPORT' USING ERRCODE='PT409';
  END IF;
  IF EXISTS(SELECT 1 FROM public.organizer_settlement_transfers WHERE event_id=p_event) THEN
    RAISE EXCEPTION 'SETTLED_EVENT_REQUIRES_SUPPORT' USING ERRCODE='PT409';
  END IF;
  SELECT * INTO billing FROM public.organizer_billing_accounts WHERE organizer_id=p_organizer FOR SHARE;
  IF NOT FOUND OR NOT billing.ready OR billing.livemode IS DISTINCT FROM p_livemode
    OR billing.policy_version IS DISTINCT FROM 'organizer-cancellation-full-refund-v1' THEN
    RAISE EXCEPTION 'BILLING_AUTHORIZATION_REQUIRED' USING ERRCODE='PT409';
  END IF;
  INSERT INTO public.event_cancellations(event_id,organizer_id,livemode,policy_version,setup_intent_id,reason)
    VALUES(p_event,p_organizer,p_livemode,billing.policy_version,billing.setup_intent_id,p_reason)
    RETURNING * INTO job;
  UPDATE public.events SET status='cancelled',is_cancelled=true,cancelled_at=now(),cancellation_reason=p_reason
    WHERE id=p_event;
  -- Do not lock payments here: fulfillment already takes payment -> event locks.
  -- The worker invalidates tickets in a separate transaction after this commit.
  RETURN to_jsonb(job);
END $$;
REVOKE ALL ON FUNCTION public.request_event_cancellation(uuid,uuid,text,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.request_event_cancellation(uuid,uuid,text,boolean) TO service_role;

CREATE FUNCTION public.claim_event_cancellation(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE job public.event_cancellations%ROWTYPE;
BEGIN
  UPDATE public.event_cancellations SET lease_token=gen_random_uuid(),lease_until=now()+interval '5 minutes'
    WHERE id=p_id AND (lease_until IS NULL OR lease_until < now()) RETURNING * INTO job;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN to_jsonb(job);
END $$;
REVOKE ALL ON FUNCTION public.claim_event_cancellation(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_event_cancellation(uuid) TO service_role;

-- A canceled event is terminal in self-service. Administrative correction must
-- use a new event, preserving the cancellation and purchase audit trail.
CREATE FUNCTION private.guard_cancellation_reactivation() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  IF (NEW.status='cancelled' OR NEW.is_cancelled) AND NOT (OLD.status='cancelled' OR OLD.is_cancelled)
    AND EXISTS(SELECT 1 FROM public.payment_transactions WHERE protected_event_id=OLD.id)
    AND NOT EXISTS(SELECT 1 FROM public.event_cancellations WHERE event_id=OLD.id) THEN
    RAISE EXCEPTION 'USE_CANCELLATION_WORKFLOW' USING ERRCODE='PT409';
  END IF;
  IF EXISTS (SELECT 1 FROM public.event_cancellations WHERE event_id=OLD.id)
    AND (NEW.status IS DISTINCT FROM 'cancelled' OR NEW.is_cancelled IS DISTINCT FROM true
      OR NEW.creator_id IS DISTINCT FROM OLD.creator_id) THEN
    RAISE EXCEPTION 'CANCELLED_EVENT_IS_IMMUTABLE' USING ERRCODE='PT409';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.guard_cancellation_reactivation() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER guard_cancellation_reactivation BEFORE UPDATE ON public.events
  FOR EACH ROW EXECUTE FUNCTION private.guard_cancellation_reactivation();

-- Serialize a checkout insert with cancellation. The generated protected_event_id
-- is unavailable in a BEFORE trigger, so read the validated metadata UUID.
CREATE FUNCTION private.guard_payment_after_cancellation() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE event_uuid uuid; ev public.events%ROWTYPE;
BEGIN
  IF coalesce(NEW.metadata->>'event_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RETURN NEW; END IF;
  event_uuid:=(NEW.metadata->>'event_id')::uuid;
  SELECT * INTO ev FROM public.events WHERE id=event_uuid FOR SHARE;
  IF ev.is_cancelled OR ev.status='cancelled' THEN
    RAISE EXCEPTION 'EVENT_CANCELLED_DURING_CHECKOUT' USING ERRCODE='PT409';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.guard_payment_after_cancellation() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER guard_payment_after_cancellation BEFORE INSERT ON public.payment_transactions
  FOR EACH ROW EXECUTE FUNCTION private.guard_payment_after_cancellation();

CREATE FUNCTION private.guard_settlement_after_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE ev public.events%ROWTYPE;
BEGIN
  SELECT * INTO ev FROM public.events WHERE id=NEW.event_id FOR UPDATE;
  IF NOT FOUND OR ev.creator_id IS DISTINCT FROM NEW.organizer_id OR ev.is_cancelled OR ev.status='cancelled'
    OR ev.end_datetime IS NULL OR ev.end_datetime>now()
    OR EXISTS(SELECT 1 FROM public.event_cancellations WHERE event_id=ev.id) THEN
    RAISE EXCEPTION 'EVENT_NOT_ELIGIBLE_FOR_SETTLEMENT' USING ERRCODE='PT409';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.guard_settlement_after_event() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER guard_settlement_after_event BEFORE INSERT ON public.organizer_settlement_transfers
  FOR EACH ROW EXECUTE FUNCTION private.guard_settlement_after_event();

CREATE FUNCTION private.notify_cancellation_collection() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE owner_id uuid;
BEGIN
  SELECT organizer_id INTO owner_id FROM public.event_cancellations WHERE id=NEW.cancellation_id;
  PERFORM notification_private.emit(owner_id,'organizer','organizer.cancellation_due','cancellation-due:'||NEW.id,
    'Desglose de cancelación disponible',
    'Comisión Eclipse: '||(NEW.commission_cents::numeric/100)::text||' EUR. Costes Stripe conciliados: '||
    (NEW.stripe_costs_cents::numeric/100)::text||' EUR. Total: '||(NEW.amount_cents::numeric/100)::text||
    ' EUR. Se cobrará en tu tarjeta autorizada después de este aviso. Puedes consultar el desglose y completar el pago en Cancelaciones y cobros. Los costes del propio cobro se concilian aparte.',
    jsonb_build_object('collection_id',NEW.id,'cancellation_id',NEW.cancellation_id),'operation','high',array['push','email'],now()+interval '30 days');
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.notify_cancellation_collection() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER notify_cancellation_collection AFTER INSERT ON public.cancellation_collections
  FOR EACH ROW EXECUTE FUNCTION private.notify_cancellation_collection();

-- Enqueueing is not delivery. Only a confirmed transport receipt, or the
-- authenticated organizer's explicit pay action, unlocks automatic collection.
CREATE FUNCTION private.refresh_collection_notice(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE row public.cancellation_collections%ROWTYPE; delivered timestamptz;
BEGIN
  SELECT min(d.updated_at) INTO delivered FROM notification_private.deliveries d
    JOIN public.notifications n ON n.id=d.notification_id
    JOIN public.cancellation_collections c ON c.id=p_id
    JOIN public.event_cancellations j ON j.id=c.cancellation_id
    WHERE n.user_id=j.organizer_id AND n.type='organizer.cancellation_due'
      AND n.data->>'collection_id'=p_id::text AND d.status='confirmed';
  UPDATE public.cancellation_collections SET notice_delivered_at=coalesce(notice_delivered_at,delivered)
    WHERE id=p_id RETURNING * INTO row;
  RETURN to_jsonb(row);
END $$;
REVOKE ALL ON FUNCTION private.refresh_collection_notice(uuid) FROM PUBLIC,anon,authenticated;
GRANT USAGE ON SCHEMA private TO service_role;
GRANT EXECUTE ON FUNCTION private.refresh_collection_notice(uuid) TO service_role;
CREATE FUNCTION public.refresh_cancellation_collection_notice(p_id uuid) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog AS $$ SELECT private.refresh_collection_notice(p_id) $$;
REVOKE ALL ON FUNCTION public.refresh_cancellation_collection_notice(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_cancellation_collection_notice(uuid) TO service_role;
