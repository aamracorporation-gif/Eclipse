async function refundUnavailablePurchase(stripe, paymentIntentId, kind) {
  if (!['resale_ticket', 'vip_table'].includes(kind)) throw new Error('Unsupported refund kind');
  const reason = kind === 'vip_table' ? 'vip_unavailable' : 'resale_unavailable';
  // Reuse refunds even after Stripe expires the original idempotency key.
  for await (const existing of stripe.refunds.list({ payment_intent: paymentIntentId, limit: 100 })) {
    if (existing.metadata?.eclipse_reason === reason) return existing;
  }
  const params = { payment_intent: paymentIntentId, metadata: { eclipse_reason: reason } };
  if (kind === 'vip_table') {
    const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
    if (intent.transfer_data?.destination) {
      params.reverse_transfer = true;
      if (intent.application_fee_amount > 0) params.refund_application_fee = true;
    }
  }
  return stripe.refunds.create(params, {
    idempotencyKey: `${kind === 'vip_table' ? 'vip' : 'resale'}-unavailable:${paymentIntentId}`,
  });
}

module.exports = { refundUnavailablePurchase };
