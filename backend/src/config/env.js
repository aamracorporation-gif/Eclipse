const path = require('path');

require('dotenv').config({ path: path.join(process.cwd(), '.env') });

function getInt(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return n;
}

const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: getInt('PORT', 3000),
  supabaseUrl: process.env.SUPABASE_URL || 'https://placeholder.supabase.co',
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY || 'placeholder-key',
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  jwtSecret: process.env.JWT_SECRET || 'dev-secret-key-change-in-production',
  stripeSecretKey: process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder',
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET || 'whsec_placeholder',
  publicAppUrl: process.env.PUBLIC_APP_URL || 'http://localhost:3000',
  stripeCommissionRate: Number(process.env.STRIPE_COMMISSION_RATE || '0.10'),
};

if (!Number.isFinite(env.stripeCommissionRate) || env.stripeCommissionRate < 0 || env.stripeCommissionRate > 1) {
  throw new Error('Invalid STRIPE_COMMISSION_RATE, expected a number between 0 and 1');
}

// Log warnings for missing critical vars in production
if (env.nodeEnv === 'production') {
  const criticalVars = ['SUPABASE_URL', 'JWT_SECRET', 'STRIPE_SECRET_KEY'];
  criticalVars.forEach(varName => {
    if (!process.env[varName]) {
      console.warn(`⚠️  Missing env var in production: ${varName}`);
    }
  });
}

module.exports = { env };
