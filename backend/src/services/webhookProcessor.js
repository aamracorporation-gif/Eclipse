const { statusAfterStripeEvent } = require('./webhookPolicy');

function createWebhookHandler({ db, verify, getTransaction, fulfill, markStatus, updateAccount, refund }) {
  return async (rawBody, signature) => {
    let event;
    try {
      event = verify(rawBody, signature);
    } catch {
      return { status: 400, json: { received: false, error: 'Invalid webhook signature' } };
    }
    if (!['payment_intent.succeeded', 'payment_intent.payment_failed', 'account.updated', 'refund.updated', 'refund.failed'].includes(event.type)) {
      return { status: 200, json: { received: true, ignored: true } };
    }

    let token;
    try {
      const { data: claim, error } = await db.rpc('claim_stripe_webhook_event', {
        p_event_id: event.id, p_event_type: event.type, p_object_id: event.data.object.id,
      });
      if (error) throw error;
      if (claim?.duplicate) return { status: 200, json: { received: true, duplicate: true } };
      if (!claim?.claimed || !claim.processing_token) return { status: 503, json: { received: false, retryable: true } };
      token = claim.processing_token;
      const object = event.data.object;

      if (event.type === 'account.updated') {
        await updateAccount(object.id, Boolean(object.charges_enabled && object.payouts_enabled));
      } else if (event.type === 'refund.updated' || event.type === 'refund.failed') {
        if (['resale_unavailable', 'vip_unavailable', 'primary_unavailable'].includes(object.metadata?.eclipse_reason) && object.payment_intent) {
          const tx = await getTransaction(object.payment_intent);
          const expectedReason = { resale_ticket: 'resale_unavailable', vip_table: 'vip_unavailable', event_ticket: 'primary_unavailable' }[tx?.kind];
          if (!tx || !expectedReason || object.metadata.eclipse_reason !== expectedReason) throw new Error('refund_transaction_not_found');
          if (['created', 'failed'].includes(tx.status)) throw new Error('refund_status_not_yet_saved');
          if (tx.status === 'refund_pending') {
            const next = object.status === 'succeeded' ? 'refunded' : ['failed', 'canceled'].includes(object.status) ? 'refund_failed' : 'refund_pending';
            if (next !== tx.status) {
              const updated = await markStatus(object.payment_intent, next);
              if (!updated) {
                const current = await getTransaction(object.payment_intent);
                if (!['refunded', 'refund_failed'].includes(current?.status)) throw new Error('refund_status_not_saved');
              }
            }
          }
        }
      } else {
        const tx = await getTransaction(object.id);
        if (!tx) throw new Error('transaction_not_found');
        if (object.metadata?.user_id && object.metadata.user_id !== tx.user_id) throw new Error('payment_owner_mismatch');
        if (event.type === 'payment_intent.succeeded') {
          if (object.status !== 'succeeded' || object.amount_received !== Number(tx.amount_cents) || object.currency !== tx.currency) {
            throw new Error('payment_amount_or_currency_mismatch');
          }
          if (!['refunded', 'refund_failed'].includes(tx.status)) {
            const result = await fulfill(object.id, tx.user_id);
            if (result?.refund_required === true && ['resale_ticket', 'vip_table', 'event_ticket'].includes(tx.kind) && refund) {
              // The database has durably blocked fulfillment before requesting a refund.
              const refundResult = await refund(object.id, tx.kind);
              const next = refundResult.status === 'succeeded' ? 'refunded'
                : ['failed', 'canceled'].includes(refundResult.status) ? 'refund_failed' : 'refund_pending';
              const updated = await markStatus(object.id, next);
              if (!updated) {
                const current = await getTransaction(object.id);
                if (!['refunded', 'refund_failed'].includes(current?.status)) throw new Error('refund_status_not_saved');
              }
            } else if (result?.fulfilled !== true && !['refunded', 'refund_failed'].includes(result?.status)) {
              throw new Error('fulfillment_not_completed');
            }
          }
        } else {
          const next = statusAfterStripeEvent(tx.status, event.type);
          if (next !== tx.status) await markStatus(object.id, next);
        }
      }

      const { data: completed, error: completeError } = await db.from('stripe_webhook_events')
        .update({ processing_status: 'processed', processed_at: new Date().toISOString(), last_error: null, lease_expires_at: null })
        .eq('event_id', event.id).eq('processing_token', token).eq('processing_status', 'processing')
        .select('event_id').maybeSingle();
      if (completeError || !completed) throw completeError || new Error('webhook_lease_lost');
      return { status: 200, json: { received: true } };
    } catch {
      // A stale worker cannot overwrite another delivery's successful result.
      if (token) {
        try {
          await db.from('stripe_webhook_events')
            .update({ processing_status: 'failed', last_error: 'processing_failed', lease_expires_at: null, updated_at: new Date().toISOString() })
            .eq('event_id', event.id).eq('processing_token', token).eq('processing_status', 'processing');
        } catch { /* Stripe retries also cover a temporary ledger outage. */ }
      }
      return { status: 500, json: { received: false, retryable: true } };
    }
  };
}

module.exports = { createWebhookHandler };
