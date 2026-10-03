const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { stripTypeScriptTypes } = require('node:module');

function loadFunction(name, env, createClient = () => { throw new Error('Unexpected database access'); }) {
  let handler;
  let networkCalls = 0;
  const file = path.join(__dirname, '../../supabase/functions', name, 'index.ts');
  const code = stripTypeScriptTypes(fs.readFileSync(file, 'utf8').replace(/^import .*;\r?\n/gm, ''));
  const context = vm.createContext({
    Request, Response, URL, URLSearchParams, console,
    Deno: { env: { get: key => env[key] } },
    serve: fn => { handler = fn; }, createClient,
    fetch: async () => { networkCalls++; throw new Error('Unexpected external request'); },
  });
  vm.runInContext(code, context);
  return { invoke: handler, context, networkCalls: () => networkCalls };
}
const serviceEnv = { SUPABASE_URL: 'https://staging.example', SUPABASE_SERVICE_ROLE_KEY: 'service-fixture', RESEND_API_KEY: 'resend-fixture', NOTIFICATIONS_FROM_EMAIL: 'test@example.com' };
const request = token => new Request('https://staging.example/functions/v1/test', {
  method: 'POST', headers: token ? { authorization: `Bearer ${token}` } : {}, body: '{}',
});

for (const name of ['send-email-notifications', 'dispatch-notifications']) {
  for (const token of [undefined, 'anon-fixture', 'user-fixture']) {
    test(`${name} denies ${token || 'missing'} credentials before side effects`, async () => {
      const fn = loadFunction(name, serviceEnv);
      assert.equal((await fn.invoke(request(token))).status, 403);
      assert.equal(fn.networkCalls(), 0);
    });
  }
  test(`${name} fails closed without server credentials`, async () => {
    const fn = loadFunction(name, {});
    assert.equal((await fn.invoke(request())).status, 503);
    assert.equal(fn.networkCalls(), 0);
  });
}
test('missing email configuration preserves the queue without querying or sending', async () => {
  const fn = loadFunction('send-email-notifications', { ...serviceEnv, RESEND_API_KEY: undefined });
  assert.equal((await fn.invoke(request('service-fixture'))).status, 503);
  assert.equal(fn.networkCalls(), 0);
});
test('configured email worker accepts the service credential and an empty queue', async () => {
  const query = { select() { return this; }, eq() { return this; }, limit() { return this; }, or: async () => ({ data: [], error: null }) };
  const fn = loadFunction('send-email-notifications', serviceEnv, () => ({ from: () => query }));
  const response = await fn.invoke(request('service-fixture'));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, sent: 0, failed: 0 });
  assert.equal(fn.networkCalls(), 0);
});
test('Connect callbacks keep staging and production separate and reject unknown projects', () => {
  const fn = loadFunction('stripe-connect-onboarding-link', {});
  const resolve = fn.context.callbackBaseUrl;
  assert.equal(resolve('https://uhondxttdpvywvkyqlkk.supabase.co'), 'https://eclipse-staging-staging.up.railway.app');
  assert.equal(resolve('https://zurbdrfmwjqbrscairub.supabase.co'), 'https://api.weareeclipseoficial.com');
  assert.throws(() => resolve('https://other.supabase.co'), /Unconfigured/);
});

test('Connect return destinations reject external hosts and malformed deep links', () => {
  const fn = loadFunction('stripe-connect-onboarding-link', {});
  const allow = fn.context.isAllowedReturnUrl;
  const staging = 'https://uhondxttdpvywvkyqlkk.supabase.co';
  for (const url of ['https://evil.example', 'https://eclipse-staging-staging.up.railway.app.evil.example', 'https://user:pass@eclipse-staging-staging.up.railway.app', 'https://api.weareeclipseoficial.com', 'eclipse://test\"', 'eclipse://test</script>', 'javascript:alert(1)', 'exp://untrusted']) {
    assert.equal(allow(url, staging), false, url);
  }
  assert.equal(allow('eclipse://(creator)/verification?stripe=return', staging), true);
  assert.equal(allow('partyapp://stripe/return', staging), true);
  assert.equal(allow('https://eclipse-staging-staging.up.railway.app/stripe/complete', staging), true);
});
