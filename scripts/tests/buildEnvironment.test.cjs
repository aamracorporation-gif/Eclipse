const test = require('node:test');
const assert = require('node:assert/strict');
const { validateBuildEnvironment } = require('../buildEnvironment.cjs');
const eas = require('../../eas.json');

const fixture = (target = 'staging') => ({
  ECLIPSE_BUILD_ENV: target,
  EAS_BUILD_PROFILE: target === 'staging' ? 'preview' : 'production',
  EXPO_PUBLIC_SUPABASE_URL: `https://${target === 'staging' ? 'uhondxttdpvywvkyqlkk' : 'zurbdrfmwjqbrscairub'}.supabase.co`,
  EXPO_PUBLIC_SUPABASE_ANON_KEY: 'sb_publishable_fixture',
  EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY: target === 'staging' ? 'pk_test_fixture' : 'pk_live_fixture',
});
const jwt = (claims) => `header.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.signature`;

test('preview and production profiles explicitly select their environments', () => {
  assert.equal(eas.build.preview.env.ECLIPSE_BUILD_ENV, 'staging');
  assert.equal(eas.build.production.env.ECLIPSE_BUILD_ENV, 'production');
  assert.doesNotThrow(() => validateBuildEnvironment(fixture()));
  assert.doesNotThrow(() => validateBuildEnvironment(fixture('production')));
});
test('local config checks do not require release credentials', () => {
  assert.doesNotThrow(() => validateBuildEnvironment({}));
});
test('release profile cannot silently skip validation', () => {
  assert.throws(() => validateBuildEnvironment({ EAS_BUILD_PROFILE: 'preview' }), /required/);
});
test('preview rejects production Supabase', () => {
  assert.throws(() => validateBuildEnvironment({ ...fixture(), EXPO_PUBLIC_SUPABASE_URL: fixture('production').EXPO_PUBLIC_SUPABASE_URL }), /staging project/);
});
test('preview rejects live Stripe and production rejects test Stripe', () => {
  assert.throws(() => validateBuildEnvironment({ ...fixture(), EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY: 'pk_live_fixture' }), /Stripe/);
  assert.throws(() => validateBuildEnvironment({ ...fixture('production'), EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY: 'pk_test_fixture' }), /Stripe/);
});
test('secret Stripe and Supabase keys cannot be bundled as client keys', () => {
  assert.throws(() => validateBuildEnvironment({ ...fixture(), EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY: 'sk_test_fixture' }), /Stripe/);
  assert.throws(() => validateBuildEnvironment({ ...fixture(), EXPO_PUBLIC_SUPABASE_ANON_KEY: 'sb_secret_fixture' }), /publishable/);
  assert.throws(() => validateBuildEnvironment({ ...fixture(), EXPO_PUBLIC_SUPABASE_ANON_KEY: jwt({ role: 'service_role', ref: 'uhondxttdpvywvkyqlkk' }) }), /anon/);
});
test('legacy anon keys must refer to the selected project', () => {
  assert.doesNotThrow(() => validateBuildEnvironment({ ...fixture(), EXPO_PUBLIC_SUPABASE_ANON_KEY: jwt({ role: 'anon', ref: 'uhondxttdpvywvkyqlkk' }) }));
  assert.throws(() => validateBuildEnvironment({ ...fixture(), EXPO_PUBLIC_SUPABASE_ANON_KEY: jwt({ role: 'anon', ref: 'zurbdrfmwjqbrscairub' }) }), /selected project/);
});
test('missing keys, unknown environments and mismatched profiles fail', () => {
  for (const field of ['EXPO_PUBLIC_SUPABASE_ANON_KEY', 'EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY']) {
    assert.throws(() => validateBuildEnvironment({ ...fixture(), [field]: '' }));
  }
  assert.throws(() => validateBuildEnvironment({ ...fixture(), ECLIPSE_BUILD_ENV: 'typo' }), /Unknown/);
  assert.throws(() => validateBuildEnvironment({ ...fixture(), EAS_BUILD_PROFILE: 'production' }), /disagree/);
});
test('preview rejects a production backend', () => {
  assert.throws(() => validateBuildEnvironment({ ...fixture(), EXPO_PUBLIC_API_URL: 'https://eclipse-production-81d9.up.railway.app' }), /staging backend/);
  assert.doesNotThrow(() => validateBuildEnvironment({ ...fixture(), EXPO_PUBLIC_API_URL: 'https://eclipse-staging-staging.up.railway.app' }));
});
test('Supabase URL cannot carry credentials or a substituted host', () => {
  for (const url of ['https://uhondxttdpvywvkyqlkk.supabase.co.evil.test', 'http://uhondxttdpvywvkyqlkk.supabase.co', 'https://user:pass@uhondxttdpvywvkyqlkk.supabase.co']) {
    assert.throws(() => validateBuildEnvironment({ ...fixture(), EXPO_PUBLIC_SUPABASE_URL: url }));
  }
});

test('TestFlight uses store signing with staging services and rejects production', () => {
  assert.equal(eas.build.testflight.extends, 'preview');
  assert.equal(eas.build.testflight.distribution, 'store');
  const env = { ...fixture(), EAS_BUILD_PROFILE: 'testflight' };
  assert.doesNotThrow(() => validateBuildEnvironment(env));
  assert.throws(() => validateBuildEnvironment({ EAS_BUILD_PROFILE: 'testflight' }), /required/);
  assert.throws(() => validateBuildEnvironment({ ...fixture('production'), EAS_BUILD_PROFILE: 'testflight' }), /disagree/);
  assert.throws(() => validateBuildEnvironment({ ...env, EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY: 'pk_live_fixture' }), /Stripe/);
});
