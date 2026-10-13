const test = require('node:test');
const assert = require('node:assert/strict');

// Isolate the controller from real credentials and network calls.
const servicePath = require.resolve('../src/services/supabaseService');
const auth = {};
const privilegedCalls = [];
require.cache[servicePath] = { id: servicePath, filename: servicePath, loaded: true, exports: {
  supabaseAnon: { auth },
  supabaseAdmin: { auth: { admin: { createUser: async () => {
    privilegedCalls.push('createUser');
    return { data: { user: { id: 'unexpected' } }, error: null };
  } } } },
} };
const { register } = require('../src/controllers/authController');

function request(body = {}) {
  return new Promise((resolve, reject) => {
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; },
      json(value) { resolve({ status: this.statusCode, body: value }); } };
    register({ body: { name: 'QA', email: 'qa@example.test', password: 'only-a-test-password',
      role: 'CLIENT', ...body } }, res, reject);
  });
}

for (const error of [
  { message: 'Email rate limit exceeded' },
  { status: 429, message: 'Too many requests' },
  { code: 'over_email_send_rate_limit', message: 'Límite alcanzado' },
  { code: 'over_request_rate_limit', message: 'Límite alcanzado' },
]) {
  test(`signup preserves rate limit: ${JSON.stringify(error)}`, async () => {
    privilegedCalls.length = 0;
    let loginCalls = 0;
    auth.signUp = async () => ({ data: null, error });
    auth.signInWithPassword = async () => { loginCalls++; return { data: {} }; };
    const result = await request();
    assert.equal(result.status, 429);
    assert.equal(result.body.code, 'SIGNUP_RATE_LIMITED');
    assert.equal(result.body.access_token, undefined);
    assert.deepEqual(privilegedCalls, []);
    assert.equal(loginCalls, 0);
  });
}

test('signup awaiting confirmation never claims an authenticated session', async () => {
  auth.signUp = async () => ({ data: { user: { id: 'qa-user', identities: [{}], email: 'qa@example.test' }, session: null }, error: null });
  const result = await request();
  assert.equal(result.status, 201);
  assert.equal(result.body.requires_email_verification, true);
  assert.equal(result.body.access_token, null);
});

test('signup keeps ordinary errors unsuccessful', async () => {
  auth.signUp = async () => ({ data: null, error: { message: 'Signup unavailable' } });
  const result = await request();
  assert.equal(result.status, 400);
  assert.equal(result.body.ok, false);
});

test('obfuscated duplicate signup never returns success or a token', async () => {
  auth.signUp = async () => ({ data: { user: { id: 'fake', identities: [] }, session: null }, error: null });
  const result = await request();
  assert.equal(result.status, 409);
  assert.equal(result.body.code, 'EMAIL_ALREADY_REGISTERED');
  assert.equal(result.body.access_token, undefined);
});

test('missing signup user fails closed', async () => {
  auth.signUp = async () => ({ data: { user: null, session: null }, error: null });
  const result = await request();
  assert.equal(result.status, 400);
  assert.equal(result.body.ok, false);
});

for (const code of ['user_already_exists', 'email_exists']) {
  test(`explicit duplicate ${code} returns conflict without authentication`, async () => {
    auth.signUp = async () => ({ data: null, error: { code, message: 'Already registered' } });
    const result = await request();
    assert.equal(result.status, 409);
    assert.equal(result.body.code, 'EMAIL_ALREADY_REGISTERED');
    assert.equal(result.body.access_token, undefined);
  });
}

test('normalizes email before calling the identity provider', async () => {
  auth.signUp = async (input) => {
    assert.equal(input.email, 'qa@example.test');
    return { data: { user: { id: 'duplicate', identities: [] } }, error: null };
  };
  const result = await request({ email: '  QA@EXAMPLE.TEST  ' });
  assert.equal(result.status, 409);
});

test('missing identities and session fail closed', async () => {
  auth.signUp = async () => ({ data: { user: { id: 'unknown' } }, error: null });
  const result = await request();
  assert.equal(result.status, 400);
  assert.equal(result.body.access_token, undefined);
});
