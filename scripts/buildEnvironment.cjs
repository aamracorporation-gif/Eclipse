const PROJECTS = {
  staging: 'uhondxttdpvywvkyqlkk',
  production: 'zurbdrfmwjqbrscairub',
};

function validateBuildEnvironment(env = process.env) {
  const target = env.ECLIPSE_BUILD_ENV;
  if (!target) {
    if (['preview', 'production'].includes(env.EAS_BUILD_PROFILE)) {
      throw new Error('ECLIPSE_BUILD_ENV is required for release builds.');
    }
    return; // Local development and CI bundle checks do not require release credentials.
  }
  if (!Object.hasOwn(PROJECTS, target)) throw new Error('Unknown ECLIPSE_BUILD_ENV.');
  const expectedProfile = target === 'staging' ? 'preview' : 'production';
  if (env.EAS_BUILD_PROFILE && env.EAS_BUILD_PROFILE !== expectedProfile) {
    throw new Error('Build profile and ECLIPSE_BUILD_ENV disagree.');
  }
  const project = PROJECTS[target];
  let url;
  try { url = new URL(env.EXPO_PUBLIC_SUPABASE_URL); } catch {
    throw new Error('A valid EXPO_PUBLIC_SUPABASE_URL is required.');
  }
  if (url.origin !== `https://${project}.supabase.co` || url.pathname !== '/' ||
      url.search || url.hash || url.username || url.password) {
    throw new Error(`EXPO_PUBLIC_SUPABASE_URL must use the ${target} project.`);
  }

  const key = String(env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '').trim();
  if (!key.startsWith('sb_publishable_')) {
    let claims;
    try {
      const parts = key.split('.');
      if (parts.length !== 3 || parts.some(part => !part)) throw new Error();
      claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    } catch { throw new Error('Use a Supabase publishable key or legacy anon key in the app.'); }
    // Configuration checks only; Supabase still authenticates all requests.
    if (claims.role !== 'anon' || claims.ref !== project) {
      throw new Error('Supabase client key must be anon and belong to the selected project.');
    }
  } else if (key.length <= 'sb_publishable_'.length) {
    throw new Error('Supabase publishable key is empty.');
  }

  const stripeKey = String(env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY || '').trim();
  const stripePrefix = target === 'staging' ? 'pk_test_' : 'pk_live_';
  if (!stripeKey.startsWith(stripePrefix) || stripeKey.length <= stripePrefix.length) {
    throw new Error(`Stripe publishable key must match the ${target} environment.`);
  }

  if (target === 'staging' && env.EXPO_PUBLIC_API_URL) {
    let api;
    try { api = new URL(env.EXPO_PUBLIC_API_URL); } catch {
      throw new Error('Invalid staging EXPO_PUBLIC_API_URL.');
    }
    if (api.origin !== 'https://eclipse-staging-staging.up.railway.app' || api.username || api.password) {
      throw new Error('Preview builds must use the staging backend.');
    }
  }
}

module.exports = { validateBuildEnvironment };
