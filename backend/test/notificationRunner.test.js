'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { notificationRuntime, startNotificationRunner } = require('../src/services/notificationRunner');
const ref = 'abcdefghijklmnopqrst';
const env = () => ({
  NOTIFICATIONS_V2_SEND_ENABLED: 'true', RAILWAY_ENVIRONMENT_NAME: 'staging',
  SUPABASE_URL: 'https://' + ref + '.supabase.co', NOTIFICATIONS_EXPECTED_PROJECT_REF: ref,
  NOTIFICATIONS_EXPO_PROJECT_ID: '10000000-0000-4000-8000-000000000001',
  SUPABASE_SERVICE_ROLE_KEY: 'fixture.' + Buffer.from(JSON.stringify({ role: 'service_role', ref })).toString('base64url') + '.fixture',
});
test('runner is disabled by default and does not instantiate an admin client', () => {
  assert.equal(startNotificationRunner({ env: {}, create() { throw Error('must not connect'); } }).enabled, false);
});
test('runtime rejects production, URL mismatch and anonymous credentials', () => {
  for (const extra of [{ RAILWAY_ENVIRONMENT_NAME: 'production' }, { SUPABASE_URL: 'https://other.supabase.co' }, { SUPABASE_SERVICE_ROLE_KEY: 'anon' }, { NOTIFICATIONS_EXPECTED_PROJECT_REF: '' }]) {
    assert.throws(() => notificationRuntime({ ...env(), ...extra }));
  }
});
test('push-only runtime ignores existing email credentials', () => {
  const runtime = notificationRuntime({ ...env(), RESEND_API_KEY: 'private-fixture', NOTIFICATIONS_FROM_EMAIL: 'private@example.invalid' });
  assert.equal(runtime.read('RESEND_API_KEY'), undefined);
  assert.equal(runtime.read('NOTIFICATIONS_FROM_EMAIL'), undefined);
  assert.equal(runtime.read('NOTIFICATIONS_V2_SEND_ENABLED'), 'true');
});
test('scheduler waits for completion and shutdown prevents another tick', async () => {
  let resolve, scheduled = 0, called = 0;
  const done = new Promise(r => { resolve = r; });
  const runner = startNotificationRunner({
    env: env(), create: () => ({ rpc() {} }), log() {},
    dispatch: async () => { called++; await done; return { dispatch: 'processed', processed: 0, receipts: 0 }; },
    schedule: () => { scheduled++; return { unref() {} }; },
  });
  assert.equal(called, 1); assert.equal(scheduled, 0);
  runner.stop(); resolve(); await new Promise(setImmediate);
  assert.equal(scheduled, 0);
});
test('failures reveal neither provider details nor service credentials and schedule recovery', async () => {
  const logs = []; let scheduled = 0;
  const runner = startNotificationRunner({
    env: env(), create: () => ({ rpc() {} }),
    dispatch: async () => { throw Error('PRIVATE_TOKEN_AND_RECIPIENT'); },
    log: x => logs.push(x), schedule: () => { scheduled++; return { unref() {} }; }, cancel() {},
  });
  await new Promise(setImmediate);
  assert.deepEqual(logs, [{ status: 'failed' }]); assert.equal(scheduled, 1); runner.stop();
});
