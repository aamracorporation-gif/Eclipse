const { z } = require('zod');
const { asyncHandler } = require('../utils/asyncHandler');
const {
  createStripeAccountForUser,
  createStripeOnboardingLinkForUser,
  getStripeAccountStatusForUser,
} = require('../services/paymentService');

const createAccount = asyncHandler(async (req, res) => {
  const out = await createStripeAccountForUser(req.auth.userId);
  return res.json({ ok: true, stripe_account_id: out.stripe_account_id });
});

const onboardingLinkSchema = z.object({
  stripe_account_id: z.string().min(1).optional(),
});

const onboardingLink = asyncHandler(async (req, res) => {
  const input = onboardingLinkSchema.parse(req.body || {});
  const out = await createStripeOnboardingLinkForUser({ userId: req.auth.userId, stripeAccountId: input.stripe_account_id });
  return res.json({ ok: true, url: out.url });
});

const accountStatus = asyncHandler(async (req, res) => {
  const out = await getStripeAccountStatusForUser(req.auth.userId);
  return res.json({ ok: true, ...out });
});
module.exports = { createAccount, onboardingLink, accountStatus };
