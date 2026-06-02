const { z } = require('zod');
const { asyncHandler } = require('../utils/asyncHandler');
const { env } = require('../config/env');
const {
  createExpressAccount,
  createAccountLink,
  retrieveAccount,
  autoCompleteConnectOnboardingInTestMode,
  constructWebhookEvent,
} = require('../services/stripeService');

function requireStripe(res) {
  if (!env.stripeSecretKey) {
    res.status(503).json({ ok: false, error: 'Stripe is not configured on this server' });
    return false;
  }
  return true;
}
const {
  getProfileById,
  setStripeAccountForUser,
  setOnboardingCompletedByUserId,
  setOnboardingCompletedByStripeAccountId,
} = require('../services/userService');
const {
  getPaymentTransactionByIntentId,
  markPaymentStatusByIntentId,
  fulfillPaymentForUser,
} = require('../services/paymentService');

const createAccount = asyncHandler(async (req, res) => {
  if (!requireStripe(res)) return;
  const user = await getProfileById(req.auth.userId);
  if (!user) return res.status(404).json({ ok: false, error: 'User not found' });

  if (user.stripe_account_id) {
    return res.json({ ok: true, stripe_account_id: user.stripe_account_id });
  }

  const account = await createExpressAccount({ email: user.email, metadata: { user_id: user.id } });
  await setStripeAccountForUser(user.id, account.id);
  return res.json({ ok: true, stripe_account_id: account.id });
});

const onboardingLinkSchema = z.object({
  stripe_account_id: z.string().min(1).optional(),
});

const onboardingLink = asyncHandler(async (req, res) => {
  if (!requireStripe(res)) return;
  const input = onboardingLinkSchema.parse(req.body || {});
  const user = await getProfileById(req.auth.userId);
  if (!user) return res.status(404).json({ ok: false, error: 'User not found' });

  const accountId = input.stripe_account_id || user.stripe_account_id;
  if (!accountId) return res.status(409).json({ ok: false, error: 'Stripe account not found' });

  const link = await createAccountLink(accountId);
  return res.json({ ok: true, url: link.url });
});

const accountStatus = asyncHandler(async (req, res) => {
  if (!requireStripe(res)) return;
  const user = await getProfileById(req.auth.userId);
  if (!user) return res.status(404).json({ ok: false, error: 'User not found' });
  if (!user.stripe_account_id) return res.status(409).json({ ok: false, error: 'Stripe account not found' });

  let account = await retrieveAccount(user.stripe_account_id);
  if (!(account.charges_enabled && account.payouts_enabled)) {
    try {
      account = await autoCompleteConnectOnboardingInTestMode(user.stripe_account_id);
    } catch {}
  }
  const completed = Boolean(account.charges_enabled && account.payouts_enabled);
  await setOnboardingCompletedByUserId(user.id, completed);

  return res.json({
    ok: true,
    stripe_account_id: user.stripe_account_id,
    charges_enabled: Boolean(account.charges_enabled),
    payouts_enabled: Boolean(account.payouts_enabled),
    onboarding_completed: completed,
  });
});

function webhookHandler(req, res) {
  if (!env.stripeWebhookSecret) {
    return res.status(503).json({ ok: false, error: 'Stripe webhooks are not configured on this server' });
  }
  const signature = String(req.headers['stripe-signature'] || '');
  let event;
  try {
    event = constructWebhookEvent(req.body, signature);
  } catch (e) {
    return res.status(400).send(`Webhook Error: ${(e && e.message) || 'Invalid signature'}`);
  }

  function errorText(e) {
    return [e?.message, e?.details, e?.hint, e?.error_description].filter(Boolean).join(' ');
  }

  function isNonFatalWebhookError(e) {
    const msg = errorText(e).toLowerCase();
    return (
      msg.includes('payment transaction not found') ||
      msg.includes('does not exist') ||
      msg.includes('row level security') ||
      msg.includes('permission denied') ||
      msg.includes('rls') ||
      msg.includes('jwt')
    );
  }

  Promise.resolve()
    .then(async () => {
      if (event.type === 'payment_intent.succeeded') {
        const pi = event.data.object;
        const paymentIntentId = String(pi.id || '');
        const metadata = pi.metadata || {};
        let userId = String(metadata.user_id || metadata.supabase_user_id || metadata.userId || '');

        if (!userId && paymentIntentId) {
          try {
            const tx = await getPaymentTransactionByIntentId(paymentIntentId);
            userId = String(tx?.user_id || '');
          } catch {}
        }

        if (paymentIntentId && userId) {
          try {
            await fulfillPaymentForUser(paymentIntentId, userId);
          } catch (e) {
            if (!isNonFatalWebhookError(e)) throw e;
          }
        }
      } else if (event.type === 'payment_intent.payment_failed') {
        const pi = event.data.object;
        const paymentIntentId = String(pi.id || '');
        if (paymentIntentId) {
          try {
            await markPaymentStatusByIntentId(paymentIntentId, 'failed');
          } catch {}
        }
      } else if (event.type === 'account.updated') {
        const account = event.data.object;
        const completed = Boolean(account.charges_enabled && account.payouts_enabled);
        try {
          await setOnboardingCompletedByStripeAccountId(account.id, completed);
        } catch (e) {
          if (!isNonFatalWebhookError(e)) throw e;
        }
      }
    })
    .then(() => res.json({ received: true }))
    .catch(() => res.status(500).json({ received: true }));
}

module.exports = { createAccount, onboardingLink, accountStatus, webhookHandler };
