const { env } = require('../config/env');
const { supabaseAdmin } = require('./supabaseService');
const { createPaymentIntent } = require('./stripeService');

function computeCommission(amountCents) {
  const rate = env.stripeCommissionRate;
  return Math.round(Number(amountCents) * rate);
}

async function createIntentForEvent({ eventId, userId, quantity = 1, ticketTypeId = null }) {
  const { data: eventRow, error: eventError } = await supabaseAdmin
    .from('events')
    .select('id, ticket_price, creator_id')
    .eq('id', eventId)
    .maybeSingle();
  if (eventError) throw eventError;
  if (!eventRow) {
    const err = new Error('Event not found');
    err.status = 404;
    throw err;
  }

  const unitPriceCents = Math.round(Number(eventRow.ticket_price) * 100);
  const qty = Number(quantity) || 1;
  const amountCents = unitPriceCents * qty;
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    const err = new Error('Invalid event price');
    err.status = 400;
    throw err;
  }

  const { data: organizer, error: organizerError } = await supabaseAdmin
    .from('profiles')
    .select('stripe_account_id, stripe_onboarding_completed')
    .eq('id', String(eventRow.creator_id))
    .maybeSingle();
  if (organizerError) throw organizerError;
  if (!organizer?.stripe_account_id) {
    const err = new Error('Organizer has no Stripe account');
    err.status = 409;
    throw err;
  }
  if (env.nodeEnv === 'production' && !organizer?.stripe_onboarding_completed) {
    const err = new Error('Organizer onboarding not completed');
    err.status = 409;
    throw err;
  }

  const commissionCents = computeCommission(amountCents);
  const commissionBps = Math.round(Number(env.stripeCommissionRate) * 10000);
  const destinationAmountCents = Math.max(amountCents - commissionCents, 0);
  const idempotencyKey = `${userId}:${eventId}:${qty}:${ticketTypeId || ''}`;

  const paymentIntent = await createPaymentIntent(
    {
      amount: amountCents,
      currency: 'eur',
      transfer_data: { destination: organizer.stripe_account_id, amount: destinationAmountCents },
      automatic_payment_methods: { enabled: true },
      metadata: {
        kind: 'event_ticket',
        user_id: userId,
        event_id: eventId,
        quantity: String(qty),
        ticket_type_id: ticketTypeId ? String(ticketTypeId) : '',
      },
    },
    { idempotencyKey }
  );

  const { error: insertError } = await supabaseAdmin.from('payment_transactions').insert({
    user_id: userId,
    kind: 'event_ticket',
    amount_cents: amountCents,
    currency: 'eur',
    stripe_payment_intent_id: paymentIntent.id,
    status: 'created',
    platform_fee_cents: commissionCents,
    destination_account_id: organizer.stripe_account_id,
    destination_amount_cents: destinationAmountCents,
    commission_bps: commissionBps,
    metadata: {
      event_id: eventId,
      quantity: qty,
      ticket_type_id: ticketTypeId,
    },
  });
  if (insertError) throw insertError;

  return { clientSecret: paymentIntent.client_secret, paymentIntentId: paymentIntent.id };
}
async function getPaymentTransactionByIntentId(paymentIntentId) {
  const { data, error } = await supabaseAdmin
    .from('payment_transactions')
    .select('*')
    .eq('stripe_payment_intent_id', paymentIntentId)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function markPaymentStatusByIntentId(paymentIntentId, status) {
  const { data, error } = await supabaseAdmin
    .from('payment_transactions')
    .update({ status })
    .eq('stripe_payment_intent_id', paymentIntentId)
    .select('*')
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function fulfillPaymentForUser(paymentIntentId, userId) {
  const { data, error } = await supabaseAdmin.rpc('fulfill_payment_for_user', {
    p_payment_intent_id: paymentIntentId,
    p_user_id: userId,
  });
  if (error) throw error;
  return data;
}

module.exports = {
  createIntentForEvent,
  getPaymentTransactionByIntentId,
  markPaymentStatusByIntentId,
  fulfillPaymentForUser,
};
