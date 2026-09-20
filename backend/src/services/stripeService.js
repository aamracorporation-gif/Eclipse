const { env } = require('../config/env');
const { getStripeClient, getStripeWebhookSecret } = require('./stripe/stripeClient');

async function createExpressAccount(params) {
  const stripe = getStripeClient();
  if (env.nodeEnv === 'production') {
    const account = await stripe.accounts.create({
      type: 'express',
      capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
      ...params,
    });
    return account;
  }

  const account = await stripe.accounts.create({
    controller: {
      fees: { payer: 'application' },
      losses: { payments: 'application' },
      stripe_dashboard: { type: 'none' },
      requirement_collection: 'application',
    },
    capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
    country: 'US',
    ...params,
  });
  return account;
}

async function createAccountLink(accountId) {
  const base = String(env.publicAppUrl || '').trim().replace(/\/$/, '');
  const completeUrl = base ? `${base}/stripe/complete` : 'https://api.weareeclipseoficial.com/stripe/complete';
  const stripe = getStripeClient();
  const link = await stripe.accountLinks.create({
    account: accountId,
    type: 'account_onboarding',
    refresh_url: completeUrl,
    return_url: completeUrl,
  });
  return link;
}

async function retrieveAccount(accountId) {
  const stripe = getStripeClient();
  return stripe.accounts.retrieve(accountId);
}

function getTestIbanByCountry(country) {
  const c = String(country || '').toUpperCase();
  const map = {
    ES: 'ES9121000418450200051332',
    FR: 'FR1420041010050500013M02606',
    DE: 'DE89370400440532013000',
    IT: 'IT60X0542811101000000123456',
    NL: 'NL91ABNA0417164300',
    BE: 'BE68539007547034',
    PT: 'PT50000201231234567890154',
    IE: 'IE29AIBK93115212345678',
  };
  return map[c] || map.DE;
}

function getTestBankAccountParams({ country, currency }) {
  const c = String(country || '').toUpperCase() || 'US';
  const cur = String(currency || '').toLowerCase() || 'usd';

  if (cur === 'eur') {
    return {
      country: c,
      currency: 'eur',
      account_holder_name: 'Jenny Rosen',
      account_holder_type: 'individual',
      account_number: getTestIbanByCountry(c),
    };
  }

  if (cur === 'gbp') {
    return {
      country: 'GB',
      currency: 'gbp',
      account_holder_name: 'Jenny Rosen',
      account_holder_type: 'individual',
      routing_number: '108800',
      account_number: '00012345',
    };
  }

  return {
    country: 'US',
    currency: 'usd',
    account_holder_name: 'Jenny Rosen',
    account_holder_type: 'individual',
    routing_number: '110000000',
    account_number: '000123456789',
  };
}

async function autoCompleteConnectOnboardingInTestMode(accountId) {
  if (env.nodeEnv === 'production') {
    const err = new Error('Not allowed in production');
    err.status = 403;
    throw err;
  }

  const stripe = getStripeClient();
  const acct = await stripe.accounts.retrieve(accountId);
  const country = String(acct.country || 'US').toUpperCase();
  const currency = String(acct.default_currency || 'usd').toLowerCase();

  const bankToken = await stripe.tokens.create({
    bank_account: getTestBankAccountParams({ country, currency }),
  });

  const pdfFront = Buffer.from('%PDF-1.4\nfront\n%%EOF\n');
  const pdfBack = Buffer.from('%PDF-1.4\nback\n%%EOF\n');
  const frontFile = await stripe.files.create({
    purpose: 'identity_document',
    file: { data: pdfFront, name: 'front.pdf', type: 'application/pdf' },
  });
  const backFile = await stripe.files.create({
    purpose: 'identity_document',
    file: { data: pdfBack, name: 'back.pdf', type: 'application/pdf' },
  });

  await stripe.accounts.update(accountId, {
    business_type: 'individual',
    business_profile: {
      mcc: '5734',
      product_description: 'Ticket sales',
    },
    individual: {
      first_name: 'Jenny',
      last_name: 'Rosen',
      email: 'jenny.rosen@example.com',
      phone: country === 'US' ? '+14155552671' : '+34600000000',
      dob: { day: 1, month: 1, year: 1901 },
      id_number: '000000000',
      address: {
        line1: 'address_full_match',
        city: country === 'US' ? 'San Francisco' : 'Madrid',
        postal_code: country === 'US' ? '94107' : '28001',
        state: country === 'US' ? 'CA' : 'M',
        country,
      },
      verification: {
        document: { front: frontFile.id, back: backFile.id },
      },
    },
    ...(acct.controller?.requirement_collection === 'application'
      ? {
          tos_acceptance: {
            date: Math.floor(Date.now() / 1000),
            ip: '127.0.0.1',
          },
        }
      : {}),
    external_account: bankToken.id,
  });

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 30; i++) {
    const [account, transfersCap, cardCap] = await Promise.all([
      stripe.accounts.retrieve(accountId),
      stripe.accounts.retrieveCapability(accountId, 'transfers'),
      stripe.accounts.retrieveCapability(accountId, 'card_payments'),
    ]);
    if (
      Boolean(account.charges_enabled) &&
      Boolean(account.payouts_enabled) &&
      transfersCap.status === 'active' &&
      cardCap.status === 'active'
    ) {
      return account;
    }
    await sleep(2000);
  }

  return stripe.accounts.retrieve(accountId);
}

async function createPaymentIntent(params, options) {
  const stripe = getStripeClient();
  return stripe.paymentIntents.create(params, options);
}

function constructWebhookEvent(rawBody, signature) {
  const stripe = getStripeClient();
  return stripe.webhooks.constructEvent(rawBody, signature, getStripeWebhookSecret());
}

async function refundPaymentIntent(paymentIntentId) {
  const stripe = getStripeClient();
  // Stripe may prune idempotency keys after 24h. Reuse the recorded refund on later retries.
  for await (const existing of stripe.refunds.list({ payment_intent: paymentIntentId, limit: 100 })) {
    if (existing.metadata?.eclipse_reason === 'resale_unavailable') return existing;
  }
  return stripe.refunds.create(
    { payment_intent: paymentIntentId, metadata: { eclipse_reason: 'resale_unavailable' } },
    { idempotencyKey: `resale-unavailable:${paymentIntentId}` }
  );
}

async function deleteStripeAccount(accountId) {
  const stripe = getStripeClient();
  return stripe.accounts.del(accountId);
}

module.exports = {
  createExpressAccount,
  createAccountLink,
  retrieveAccount,
  autoCompleteConnectOnboardingInTestMode,
  createPaymentIntent,
  constructWebhookEvent,
  refundPaymentIntent,
  deleteStripeAccount,
};
