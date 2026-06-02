const Stripe = require('stripe');
const { env } = require('../../config/env');

class StripeConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'StripeConfigError';
    this.status = 500;
    this.code = 'STRIPE_NOT_CONFIGURED';
  }
}

let stripeInstance = null;

function getStripeSecretKey() {
  const key = String(env.stripeSecretKey || '').trim();
  if (!key) throw new StripeConfigError('Stripe not configured: missing STRIPE_SECRET_KEY');
  if (!key.startsWith('sk_')) throw new StripeConfigError('Stripe not configured: invalid STRIPE_SECRET_KEY');
  return key;
}

function getStripeWebhookSecret() {
  const secret = String(env.stripeWebhookSecret || '').trim();
  if (!secret) throw new StripeConfigError('Stripe not configured: missing STRIPE_WEBHOOK_SECRET');
  return secret;
}

function getStripeClient() {
  if (stripeInstance) return stripeInstance;
  const key = getStripeSecretKey();
  stripeInstance = new Stripe(key, {
    apiVersion: '2024-06-20',
    typescript: false,
  });
  return stripeInstance;
}

function resetStripeClientForTests() {
  stripeInstance = null;
}

module.exports = {
  StripeConfigError,
  getStripeClient,
  getStripeSecretKey,
  getStripeWebhookSecret,
  resetStripeClientForTests,
};
