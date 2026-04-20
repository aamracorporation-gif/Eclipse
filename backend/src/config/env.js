const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

function mustGet(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing env var: ${name}`);
  }
  return value;
}

function getInt(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return n;
}

const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: getInt('PORT', 8081),
  supabaseUrl: mustGet('SUPABASE_URL'),
  supabaseAnonKey: mustGet('SUPABASE_ANON_KEY'),
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  jwtSecret: mustGet('JWT_SECRET'),
  stripeSecretKey: mustGet('STRIPE_SECRET_KEY'),
  stripeWebhookSecret: mustGet('STRIPE_WEBHOOK_SECRET'),
  publicAppUrl: mustGet('PUBLIC_APP_URL'),
  stripeCommissionRate: Number(process.env.STRIPE_COMMISSION_RATE || '0.10'),
};

if (!Number.isFinite(env.stripeCommissionRate) || env.stripeCommissionRate < 0 || env.stripeCommissionRate > 1) {
  throw new Error('Invalid STRIPE_COMMISSION_RATE, expected a number between 0 and 1');
}

module.exports = { env };
