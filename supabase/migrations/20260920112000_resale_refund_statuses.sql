-- Track a failed resale fulfillment and its Stripe refund without pretending a ticket was delivered.
ALTER TABLE public.payment_transactions
  DROP CONSTRAINT IF EXISTS payment_transactions_status_check;
ALTER TABLE public.payment_transactions
  ADD CONSTRAINT payment_transactions_status_check
  CHECK (status IN ('created', 'fulfilled', 'failed', 'canceled',
                   'refund_pending', 'refunded', 'refund_failed'));
