const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

function getString(name, fallback = '') {
  const raw = process.env[name];
  if (typeof raw !== 'string') return fallback;
  const v = raw.trim();
  return v || fallback;
}

function getNumber(name, fallback) {
  const raw = process.env[name];
  if (typeof raw !== 'string' || !raw.trim()) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function getInt(name, fallback) {
  const n = getNumber(name, fallback);
  return Number.isInteger(n) ? n : fallback;
}

function getStripeCommissionRate() {
  const n = getNumber('STRIPE_COMMISSION_RATE', 0.1);
  if (!Number.isFinite(n)) return 0.1;
  if (n < 0) return 0.1;
  if (n > 1) return 0.1;
  return n;
}

const env = {};
Object.defineProperties(env, {
  nodeEnv: { enumerable: true, get: () => getString('NODE_ENV', 'development') || 'development' },
  port: { enumerable: true, get: () => getInt('PORT', 8081) },

  supabaseUrl: { enumerable: true, get: () => getString('SUPABASE_URL', '') },
  supabaseAnonKey: { enumerable: true, get: () => getString('SUPABASE_ANON_KEY', '') },
  supabaseServiceRoleKey: { enumerable: true, get: () => getString('SUPABASE_SERVICE_ROLE_KEY', '') },

  jwtSecret: { enumerable: true, get: () => getString('JWT_SECRET', '') },

  stripeSecretKey: { enumerable: true, get: () => getString('STRIPE_SECRET_KEY', '') },
  stripeWebhookSecret: { enumerable: true, get: () => getString('STRIPE_WEBHOOK_SECRET', '') },

  publicAppUrl: { enumerable: true, get: () => getString('PUBLIC_APP_URL', '') },

  stripeCommissionRate: { enumerable: true, get: () => getStripeCommissionRate() },
});

module.exports = { env, getString, getInt, getNumber };
