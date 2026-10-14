-- Run only on the staging project. Everything, including notification outbox
-- records, is rolled back. No Stripe API or notification transport is called.
BEGIN;
SET LOCAL statement_timeout='30s';
DO $$
DECLARE owner_id uuid; event_id uuid:=gen_random_uuid(); next_event uuid:=gen_random_uuid();
  tx uuid:=gen_random_uuid(); job jsonb; collection uuid; entry uuid; result jsonb; transfer jsonb;
BEGIN
  SELECT p.id INTO owner_id FROM public.profiles p WHERE p.role='organizer'
    AND NOT EXISTS(SELECT 1 FROM public.organizer_billing_accounts b WHERE b.organizer_id=p.id) ORDER BY p.created_at LIMIT 1;
  IF owner_id IS NULL THEN RAISE EXCEPTION 'QA_ORGANIZER_FIXTURE_REQUIRED'; END IF;
  INSERT INTO public.organizer_billing_accounts(organizer_id,stripe_customer_id,livemode,setup_intent_id,ready,policy_version)
    VALUES(owner_id,'cus_qa_rollback_'||event_id,false,'seti_qa_rollback_'||event_id,true,'organizer-cancellation-full-refund-v2');
  INSERT INTO public.events(id,creator_id,title,event_date) VALUES(event_id,owner_id,'QA cancellation ROLLBACK',now()+interval '1 day');
  SET LOCAL ROLE service_role;
  job:=public.request_event_cancellation(event_id,owner_id,'QA database compatibility only',false);
  ASSERT job->>'status'='refunding';
  ASSERT (public.request_event_cancellation(event_id,owner_id,'QA replay',false)->>'id')=job->>'id';
  UPDATE public.event_cancellations SET status='reconciliation' WHERE id=(job->>'id')::uuid;
  INSERT INTO public.cancellation_collections(cancellation_id,amount_cents,commission_cents,stripe_costs_cents,cost_evidence,reconciliation_reference,status)
    VALUES((job->>'id')::uuid,290,200,90,'{"feesFinalized":true}','qa-rollback-initial','succeeded') RETURNING id INTO collection;
  result:=public.refresh_cancellation_collection_notice(collection);
  ASSERT result->>'notice_delivered_at' IS NULL, 'Queued notification must not be treated as delivered';
  UPDATE public.event_cancellations SET status='collected' WHERE id=(job->>'id')::uuid;
  result:=public.reconcile_cancellation_costs(collection,false,124,34,'qa-rollback-report',repeat('a',64),'{"feesFinalized":true}');
  ASSERT (result->>'adjustmentCents')::int=34;
  ASSERT public.reconcile_cancellation_costs(collection,false,124,34,'qa-rollback-report',repeat('a',64),'{"feesFinalized":true}')->>'replayed'='true';
  SELECT id INTO entry FROM public.organizer_cost_entries WHERE organizer_id=owner_id;
  ASSERT entry IS NOT NULL;
  result:=public.refresh_organizer_cost_notice(entry);
  ASSERT result->>'notice_delivered_at' IS NULL;
  UPDATE public.organizer_cost_entries SET notice_delivered_at=now() WHERE id=entry;
  RESET ROLE;
  -- emit queues an outbox item; the separate notification worker materializes
  -- the inbox later. This transaction does not dispatch messages to a user.
  ASSERT EXISTS(SELECT 1 FROM notification_private.outbox o WHERE user_id=owner_id
    AND kind='organizer.cancellation_due' AND data->>'collection_id'=collection::text
    AND notification_private.is_current(o));
  ASSERT EXISTS(SELECT 1 FROM notification_private.outbox o WHERE user_id=owner_id
    AND kind='organizer.cancellation_cost_adjusted' AND data->>'cost_entry_id'=entry::text
    AND notification_private.is_current(o));
  INSERT INTO public.events(id,creator_id,title,event_date,end_datetime)
    VALUES(next_event,owner_id,'QA settlement ROLLBACK',now()-interval '2 days',now()-interval '1 day');
  INSERT INTO public.payment_transactions(id,user_id,kind,amount_cents,currency,stripe_payment_intent_id,status,metadata,destination_amount_cents,destination_account_id)
    VALUES(tx,owner_id,'event_ticket',2056,'eur','pi_qa_rollback_'||tx,'fulfilled',
      jsonb_build_object('event_id',next_event,'settlement_model','after_event_v1'),1800,'acct_qa_rollback');
  SET LOCAL ROLE service_role;
  result:=public.reserve_organizer_settlement(tx,false,true,false);
  ASSERT (result->>'amount_cents')::int=1766;
  transfer:=public.reserve_organizer_settlement(tx,false,true,true);
  ASSERT (transfer->>'amount_cents')::int=1766 AND (transfer->>'cost_adjustment_cents')::int=34;
  ASSERT public.reserve_organizer_settlement(tx,false,true,true)->>'transaction_id'=transfer->>'transaction_id';
  RESET ROLE;
  ASSERT NOT has_table_privilege('authenticated','public.organizer_cost_entries','SELECT');
  ASSERT NOT has_table_privilege('anon','public.organizer_cost_entries','SELECT');
  ASSERT NOT has_function_privilege('authenticated','public.reserve_organizer_settlement(uuid,boolean,boolean,boolean)','EXECUTE');
END $$;
ROLLBACK;
