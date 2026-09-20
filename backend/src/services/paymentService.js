const { env } = require('../config/env');
const { supabaseAdmin } = require('./supabaseService');
const {
  createPaymentIntent,
  createExpressAccount,
  createAccountLink,
  retrieveAccount,
  autoCompleteConnectOnboardingInTestMode,
  constructWebhookEvent,
  refundPaymentIntent,
  deleteStripeAccount,
} = require('./stripeService');
const {
  getProfileById,
  setStripeAccountForUser,
  setOnboardingCompletedByUserId,
  setOnboardingCompletedByStripeAccountId,
} = require('./userService');
const { createWebhookHandler } = require('./webhookProcessor');

function computeCommission(amountCents) {
  const rate = env.stripeCommissionRate;
  return Math.round(Number(amountCents) * rate);
}

async function createStripeAccountForUser(userId) {
  const user = await getProfileById(userId);
  if (!user) {
    const err = new Error('User not found');
    err.status = 404;
    throw err;
  }

  if (user.stripe_account_id) return { stripe_account_id: user.stripe_account_id };

  const account = await createExpressAccount({ email: user.email, metadata: { user_id: user.id } });
  await setStripeAccountForUser(user.id, account.id);
  return { stripe_account_id: account.id };
}

async function createStripeOnboardingLinkForUser({ userId, stripeAccountId }) {
  const user = await getProfileById(userId);
  if (!user) {
    const err = new Error('User not found');
    err.status = 404;
    throw err;
  }

  if (stripeAccountId && stripeAccountId !== user.stripe_account_id) {
    const err = new Error('Stripe account does not belong to this organizer');
    err.status = 403;
    throw err;
  }
  const accountId = String(stripeAccountId || user.stripe_account_id || '').trim();
  if (!accountId) {
    const err = new Error('Stripe account not found');
    err.status = 409;
    throw err;
  }

  const link = await createAccountLink(accountId);
  return { url: link.url };
}

async function getStripeAccountStatusForUser(userId) {
  const user = await getProfileById(userId);
  if (!user) {
    const err = new Error('User not found');
    err.status = 404;
    throw err;
  }
  if (!user.stripe_account_id) {
    const err = new Error('Stripe account not found');
    err.status = 409;
    throw err;
  }

  let account = await retrieveAccount(user.stripe_account_id);
  if (!(account.charges_enabled && account.payouts_enabled)) {
    try {
      account = await autoCompleteConnectOnboardingInTestMode(user.stripe_account_id);
    } catch {}
  }

  const completed = Boolean(account.charges_enabled && account.payouts_enabled);
  await setOnboardingCompletedByUserId(user.id, completed);
  return {
    stripe_account_id: user.stripe_account_id,
    charges_enabled: Boolean(account.charges_enabled),
    payouts_enabled: Boolean(account.payouts_enabled),
    onboarding_completed: completed,
  };
}

async function syncStripeOnboardingCompletionFromStripeAccountId(stripeAccountId) {
  const id = String(stripeAccountId || '').trim();
  if (!id) return { ok: false };
  const account = await retrieveAccount(id);
  const completed = Boolean(account.charges_enabled && account.payouts_enabled);
  await setOnboardingCompletedByStripeAccountId(id, completed);
  return { ok: true, onboarding_completed: completed };
}

const handleStripeWebhook = createWebhookHandler({
  db: supabaseAdmin,
  verify: constructWebhookEvent,
  getTransaction: getPaymentTransactionByIntentId,
  fulfill: fulfillPaymentForUser,
  markStatus: markPaymentStatusByIntentId,
  updateAccount: setOnboardingCompletedByStripeAccountId,
  refund: refundPaymentIntent,
});

async function deleteStripeAccountForUser(userId) {
  const profile = await getProfileById(userId);
  if (!profile) {
    const err = new Error('User not found');
    err.status = 404;
    throw err;
  }

  const stripeAccountId = String(profile.stripe_account_id || '');
  if (stripeAccountId) {
    await deleteStripeAccount(stripeAccountId);
  }
  return { ok: true };
}

async function createIntentForEvent({ eventId, userId, quantity = 1, ticketTypeId = null, idempotencyKey }) {
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
  if (!/^[A-Za-z0-9_.:-]{16,200}$/.test(String(idempotencyKey || ''))) {
    const err = new Error('Missing or invalid idempotency_key');
    err.status = 400;
    throw err;
  }

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
        idempotency_key: idempotencyKey,
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
    idempotency_key: idempotencyKey,
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
    .not('status', 'in', '(fulfilled,refunded,canceled,cancelled)')
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
  createStripeAccountForUser,
  createStripeOnboardingLinkForUser,
  getStripeAccountStatusForUser,
  syncStripeOnboardingCompletionFromStripeAccountId,
  handleStripeWebhook,
  deleteStripeAccountForUser,
};
