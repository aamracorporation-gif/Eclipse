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
  amount_cents integer NOT NULL CHECK(amount_cents>=0),
  gross_amount_cents integer CHECK(gross_amount_cents>0),
  cost_adjustment_cents integer NOT NULL DEFAULT 0,
  livemode boolean NOT NULL,
  transfer_id text UNIQUE,
  first_attempt_at timestamptz,
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','transferred','offset','attention')),
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
    CHECK (status IN ('pending','processing','requires_action','requires_payment_method','succeeded','deferred','attention')),
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
  -- All cancellation/accounting/settlement operations take the organizer lock first.
  PERFORM 1 FROM public.organizer_billing_accounts WHERE organizer_id=p_organizer FOR UPDATE;
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
    OR billing.policy_version IS DISTINCT FROM 'organizer-cancellation-full-refund-v2' THEN
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
    ' EUR. '||CASE WHEN NEW.amount_cents<50 THEN 'Se compensará con tu próxima liquidación sin cargo a la tarjeta.'
      ELSE 'Se cobrará en tu tarjeta autorizada después de este aviso. Los costes del propio cobro se compensarán con liquidaciones posteriores.' END||
    ' Puedes consultar el desglose en Cancelaciones y cobros.',
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

-- Complete provider-cost snapshots and signed adjustments. Positive entries are
-- owed by the organizer; negative entries are credits, never Eclipse revenue.
ALTER TABLE public.cancellation_collections ADD COLUMN reconciled_total_costs_cents integer;
ALTER TABLE public.cancellation_collections ADD COLUMN collection_costs_cents integer;
CREATE TABLE public.cancellation_cost_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id uuid NOT NULL REFERENCES public.cancellation_collections(id),
  reference text NOT NULL,
  sha256 text NOT NULL CHECK(length(sha256)=64),
  total_costs_cents integer NOT NULL CHECK(total_costs_cents>=0),
  collection_costs_cents integer NOT NULL CHECK(collection_costs_cents>=0 AND collection_costs_cents<=total_costs_cents),
  evidence jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(collection_id,reference)
);
CREATE TABLE public.organizer_cost_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL UNIQUE REFERENCES public.cancellation_cost_reports(id),
  organizer_id uuid NOT NULL REFERENCES public.organizer_billing_accounts(organizer_id),
  livemode boolean NOT NULL,
  amount_cents integer NOT NULL CHECK(amount_cents<>0),
  notice_delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX organizer_cost_entries_owner_idx ON public.organizer_cost_entries(organizer_id,livemode);
CREATE TABLE public.organizer_cost_allocations (
  entry_id uuid NOT NULL REFERENCES public.organizer_cost_entries(id),
  transaction_id uuid NOT NULL REFERENCES public.organizer_settlement_transfers(transaction_id),
  amount_cents integer NOT NULL CHECK(amount_cents<>0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(entry_id,transaction_id)
);
CREATE INDEX organizer_cost_allocations_settlement_idx ON public.organizer_cost_allocations(transaction_id);
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['cancellation_cost_reports','organizer_cost_entries','organizer_cost_allocations'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',t);
    EXECUTE format('GRANT SELECT,INSERT ON public.%I TO service_role',t);
  END LOOP;
END $$;
GRANT UPDATE(notice_delivered_at) ON public.organizer_cost_entries TO service_role;

CREATE FUNCTION public.reconcile_cancellation_costs(p_collection uuid,p_livemode boolean,p_total_costs integer,
  p_collection_costs integer,p_reference text,p_sha256 text,p_evidence jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE c public.cancellation_collections%ROWTYPE; j public.event_cancellations%ROWTYPE;
  report public.cancellation_cost_reports%ROWTYPE; delta integer;
BEGIN
  SELECT * INTO c FROM public.cancellation_collections WHERE id=p_collection;
  SELECT * INTO j FROM public.event_cancellations WHERE id=c.cancellation_id;
  PERFORM 1 FROM public.organizer_billing_accounts WHERE organizer_id=j.organizer_id FOR UPDATE;
  SELECT * INTO c FROM public.cancellation_collections WHERE id=p_collection FOR UPDATE;
  IF c.id IS NULL OR c.status NOT IN ('succeeded','deferred') OR j.livemode IS DISTINCT FROM p_livemode
    OR p_total_costs IS NULL OR p_total_costs<0 OR p_collection_costs IS NULL OR p_collection_costs<0 OR p_collection_costs>p_total_costs
    OR coalesce(length(p_reference),0)=0 OR coalesce(length(p_sha256),0)<>64
    OR p_evidence->>'feesFinalized' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'INVALID_COST_RECONCILIATION'; END IF;
  SELECT * INTO report FROM public.cancellation_cost_reports WHERE collection_id=p_collection AND reference=p_reference;
  IF FOUND THEN
    IF report.sha256<>p_sha256 OR report.total_costs_cents<>p_total_costs OR report.collection_costs_cents<>p_collection_costs
      OR report.evidence<>p_evidence THEN RAISE EXCEPTION 'REPORT_REFERENCE_REUSED'; END IF;
    RETURN jsonb_build_object('reportId',report.id,'replayed',true);
  END IF;
  delta:=p_total_costs-coalesce(c.reconciled_total_costs_cents,c.stripe_costs_cents);
  INSERT INTO public.cancellation_cost_reports(collection_id,reference,sha256,total_costs_cents,collection_costs_cents,evidence)
    VALUES(p_collection,p_reference,p_sha256,p_total_costs,p_collection_costs,p_evidence) RETURNING * INTO report;
  IF delta<>0 THEN
    INSERT INTO public.organizer_cost_entries(report_id,organizer_id,livemode,amount_cents)
      VALUES(report.id,j.organizer_id,p_livemode,delta);
  END IF;
  UPDATE public.cancellation_collections SET reconciled_total_costs_cents=p_total_costs,collection_costs_cents=p_collection_costs,
    residual_costs_status='reviewed' WHERE id=p_collection;
  RETURN jsonb_build_object('reportId',report.id,'adjustmentCents',delta,'totalCostsCents',p_total_costs);
END $$;
REVOKE ALL ON FUNCTION public.reconcile_cancellation_costs(uuid,boolean,integer,integer,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_cancellation_costs(uuid,boolean,integer,integer,text,text,jsonb) TO service_role;

CREATE FUNCTION private.notify_organizer_cost_entry() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  PERFORM notification_private.emit(NEW.organizer_id,'organizer','organizer.cancellation_cost_adjusted','cancellation-cost:'||NEW.id,
    'Gastos de cancelación conciliados',
    CASE WHEN NEW.amount_cents>0 THEN 'Coste real pendiente: ' ELSE 'Saldo a tu favor: ' END ||
    (abs(NEW.amount_cents::bigint)::numeric/100)::text||
    ' EUR. Se compensará con tu próxima liquidación, con su desglose. No se genera otro cargo automático a tu tarjeta.',
    jsonb_build_object('cost_entry_id',NEW.id),'operation','high',array['push','email'],now()+interval '30 days');
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.notify_organizer_cost_entry() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER notify_organizer_cost_entry AFTER INSERT ON public.organizer_cost_entries
  FOR EACH ROW EXECUTE FUNCTION private.notify_organizer_cost_entry();

CREATE FUNCTION private.refresh_cost_notice(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE row public.organizer_cost_entries%ROWTYPE; delivered timestamptz;
BEGIN
  SELECT min(d.updated_at) INTO delivered FROM notification_private.deliveries d
    JOIN public.notifications n ON n.id=d.notification_id
    JOIN public.organizer_cost_entries e ON e.id=p_id
    WHERE n.user_id=e.organizer_id AND n.type='organizer.cancellation_cost_adjusted'
      AND n.data->>'cost_entry_id'=p_id::text AND d.status='confirmed';
  UPDATE public.organizer_cost_entries SET notice_delivered_at=coalesce(notice_delivered_at,delivered)
    WHERE id=p_id RETURNING * INTO row;
  RETURN to_jsonb(row);
END $$;
REVOKE ALL ON FUNCTION private.refresh_cost_notice(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.refresh_cost_notice(uuid) TO service_role;
CREATE FUNCTION public.refresh_organizer_cost_notice(p_id uuid) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog AS $$ SELECT private.refresh_cost_notice(p_id) $$;
REVOKE ALL ON FUNCTION public.refresh_organizer_cost_notice(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_organizer_cost_notice(uuid) TO service_role;

-- Reserve proceeds and cost adjustments together, before calling Stripe. A
-- response timeout never releases these reservations or creates a second payout.
CREATE FUNCTION public.reserve_organizer_settlement(p_transaction uuid,p_livemode boolean,p_verified boolean,p_execute boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE tx public.payment_transactions%ROWTYPE; ev public.events%ROWTYPE;
  settlement public.organizer_settlement_transfers%ROWTYPE; e record;
  total_positive bigint:=0; total_negative bigint:=0; net bigint; adjustment bigint;
  take_negative bigint; take_positive bigint; part bigint; pending bigint;
BEGIN
  SELECT * INTO tx FROM public.payment_transactions WHERE id=p_transaction;
  SELECT * INTO ev FROM public.events WHERE id=tx.protected_event_id;
  IF ev.id IS NULL THEN RAISE EXCEPTION 'SETTLEMENT_NOT_ELIGIBLE'; END IF;
  PERFORM 1 FROM public.organizer_billing_accounts WHERE organizer_id=ev.creator_id AND livemode=p_livemode FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'BILLING_ACCOUNT_MODE_MISMATCH'; END IF;
  SELECT * INTO tx FROM public.payment_transactions WHERE id=p_transaction FOR SHARE;
  SELECT * INTO ev FROM public.events WHERE id=tx.protected_event_id FOR UPDATE;
  SELECT * INTO settlement FROM public.organizer_settlement_transfers WHERE transaction_id=p_transaction;
  IF FOUND THEN
    IF settlement.livemode IS DISTINCT FROM p_livemode THEN RAISE EXCEPTION 'SETTLEMENT_MODE_MISMATCH'; END IF;
    RETURN to_jsonb(settlement);
  END IF;
  IF ev.creator_id IS DISTINCT FROM (SELECT organizer_id FROM public.organizer_billing_accounts WHERE organizer_id=ev.creator_id)
    OR ev.is_cancelled OR ev.status='cancelled' OR ev.end_datetime IS NULL OR ev.end_datetime>now()
    OR tx.status<>'fulfilled' OR tx.currency<>'eur' OR tx.metadata->>'settlement_model' IS DISTINCT FROM 'after_event_v1'
    OR tx.destination_amount_cents IS NULL OR tx.destination_amount_cents<=0 OR tx.destination_amount_cents>tx.amount_cents
    OR coalesce(tx.destination_account_id,'') NOT LIKE 'acct_%' THEN RAISE EXCEPTION 'SETTLEMENT_NOT_ELIGIBLE'; END IF;
  IF EXISTS(SELECT 1 FROM public.event_cancellations j LEFT JOIN public.cancellation_collections c ON c.cancellation_id=j.id
    WHERE j.organizer_id=ev.creator_id AND (j.livemode IS DISTINCT FROM p_livemode OR j.status<>'collected'
      OR (c.id IS NOT NULL AND (c.status NOT IN ('succeeded','deferred') OR c.residual_costs_status<>'reviewed'))))
    THEN RAISE EXCEPTION 'ORGANIZER_RECONCILIATION_PENDING'; END IF;
  IF EXISTS(SELECT 1 FROM public.cancellation_refunds r JOIN public.event_cancellations j ON j.id=r.cancellation_id
    WHERE j.organizer_id=ev.creator_id AND r.status NOT IN ('succeeded','not_paid')) THEN RAISE EXCEPTION 'BUYER_REFUNDS_NOT_COMPLETE'; END IF;
  FOR e IN SELECT c.*, c.amount_cents-coalesce((SELECT sum(a.amount_cents) FROM public.organizer_cost_allocations a WHERE a.entry_id=c.id),0) remaining
    FROM public.organizer_cost_entries c WHERE c.organizer_id=ev.creator_id AND c.livemode=p_livemode ORDER BY c.created_at,c.id LOOP
    IF e.remaining<>0 AND e.notice_delivered_at IS NULL THEN RAISE EXCEPTION 'COST_NOTICE_REQUIRED'; END IF;
    total_positive:=total_positive+greatest(e.remaining,0); total_negative:=total_negative+least(e.remaining,0);
  END LOOP;
  net:=total_positive+total_negative;
  -- Credits can increase this transfer up to its original source charge. Any
  -- remaining credit stays owed, visible and available to later settlements.
  adjustment:=greatest(-(tx.amount_cents-tx.destination_amount_cents),least(tx.destination_amount_cents,net));
  IF NOT p_execute THEN RETURN jsonb_build_object('amount_cents',tx.destination_amount_cents-adjustment,
    'gross_amount_cents',tx.destination_amount_cents,'cost_adjustment_cents',adjustment,'destination_account_id',tx.destination_account_id); END IF;
  IF NOT p_verified THEN RAISE EXCEPTION 'EVENT_COMPLETION_VERIFICATION_REQUIRED'; END IF;
  INSERT INTO public.organizer_settlement_transfers(transaction_id,event_id,organizer_id,destination_account_id,
    gross_amount_cents,cost_adjustment_cents,amount_cents,livemode)
    VALUES(tx.id,ev.id,ev.creator_id,tx.destination_account_id,tx.destination_amount_cents,adjustment,tx.destination_amount_cents-adjustment,p_livemode)
    RETURNING * INTO settlement;
  take_negative:=least(-total_negative,total_positive+greatest(-adjustment,0));
  take_positive:=adjustment+take_negative;
  FOR e IN SELECT c.*, c.amount_cents-coalesce((SELECT sum(a.amount_cents) FROM public.organizer_cost_allocations a WHERE a.entry_id=c.id),0) remaining
    FROM public.organizer_cost_entries c WHERE c.organizer_id=ev.creator_id AND c.livemode=p_livemode ORDER BY c.created_at,c.id LOOP
    IF e.remaining<0 THEN part:=-least(-e.remaining,take_negative); take_negative:=take_negative+part;
    ELSE part:=least(e.remaining,take_positive); take_positive:=take_positive-part; END IF;
    IF part<>0 THEN INSERT INTO public.organizer_cost_allocations(entry_id,transaction_id,amount_cents) VALUES(e.id,tx.id,part); END IF;
  END LOOP;
  IF take_negative<>0 OR take_positive<>0 THEN RAISE EXCEPTION 'COST_ALLOCATION_MISMATCH'; END IF;
  RETURN to_jsonb(settlement);
END $$;
REVOKE ALL ON FUNCTION public.reserve_organizer_settlement(uuid,boolean,boolean,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_organizer_settlement(uuid,boolean,boolean,boolean) TO service_role;

CREATE FUNCTION public.defer_small_cancellation_collection(p_collection uuid,p_livemode boolean,p_sha256 text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE c public.cancellation_collections%ROWTYPE; j public.event_cancellations%ROWTYPE; report_id uuid;
BEGIN
  SELECT * INTO c FROM public.cancellation_collections WHERE id=p_collection;
  SELECT * INTO j FROM public.event_cancellations WHERE id=c.cancellation_id;
  PERFORM 1 FROM public.organizer_billing_accounts WHERE organizer_id=j.organizer_id FOR UPDATE;
  SELECT * INTO c FROM public.cancellation_collections WHERE id=p_collection FOR UPDATE;
  IF c.id IS NULL OR j.livemode IS DISTINCT FROM p_livemode OR c.amount_cents>=50 OR c.payment_intent_id IS NOT NULL OR c.first_attempt_at IS NOT NULL
    OR c.status NOT IN ('pending','deferred') THEN RAISE EXCEPTION 'SMALL_COLLECTION_NOT_ELIGIBLE'; END IF;
  IF c.status='deferred' THEN RETURN to_jsonb(c); END IF;
  IF j.status NOT IN ('reconciliation','collection_pending') OR EXISTS(SELECT 1 FROM public.cancellation_refunds WHERE cancellation_id=j.id AND status NOT IN ('succeeded','not_paid'))
    THEN RAISE EXCEPTION 'BUYER_REFUNDS_NOT_COMPLETE'; END IF;
  INSERT INTO public.cancellation_cost_reports(collection_id,reference,sha256,total_costs_cents,collection_costs_cents,evidence)
    VALUES(c.id,'below-minimum:'||c.id,p_sha256,c.stripe_costs_cents,0,c.cost_evidence) RETURNING id INTO report_id;
  INSERT INTO public.organizer_cost_entries(report_id,organizer_id,livemode,amount_cents) VALUES(report_id,j.organizer_id,p_livemode,c.amount_cents);
  UPDATE public.cancellation_collections SET status='deferred',residual_costs_status='reviewed',reconciled_total_costs_cents=stripe_costs_cents,
    collection_costs_cents=0 WHERE id=c.id RETURNING * INTO c;
  UPDATE public.event_cancellations SET status='collected' WHERE id=j.id;
  RETURN to_jsonb(c);
END $$;
REVOKE ALL ON FUNCTION public.defer_small_cancellation_collection(uuid,boolean,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.defer_small_cancellation_collection(uuid,boolean,text) TO service_role;
