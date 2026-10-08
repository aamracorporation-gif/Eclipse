'use strict';
const { createClient } = require('@supabase/supabase-js');
const { runNotificationDispatchWithHealth } = require('./notifications/notificationWorkerHealth');

function notificationRuntime(env) {
  if (env.NOTIFICATIONS_V2_SEND_ENABLED !== 'true') return null;
  const ref = env.NOTIFICATIONS_EXPECTED_PROJECT_REF;
  if (env.RAILWAY_ENVIRONMENT_NAME !== 'staging' || !/^[a-z]{20}$/.test(ref || '') ||
      env.SUPABASE_URL !== 'https://' + ref + '.supabase.co') {
    throw new Error('NOTIFICATION_ENVIRONMENT_MISMATCH');
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(env.NOTIFICATIONS_EXPO_PROJECT_ID || '')) {
    throw new Error('NOTIFICATION_EXPO_PROJECT_REQUIRED');
  }
  const key = env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!key) throw new Error('NOTIFICATION_SERVICE_CREDENTIAL_REQUIRED');
  if (!key.startsWith('sb_secret_')) {
    let claims;
    try { claims = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()); } catch {}
    if (claims?.role !== 'service_role' || claims?.ref !== ref) throw new Error('NOTIFICATION_SERVICE_CREDENTIAL_MISMATCH');
  }
  // This deployment enables push only. Email settings never enter the transport.
  const values = {
    NOTIFICATIONS_V2_SEND_ENABLED: 'true',
    NOTIFICATIONS_EXPO_PROJECT_ID: env.NOTIFICATIONS_EXPO_PROJECT_ID,
    SUPABASE_URL: env.SUPABASE_URL,
    EXPO_ACCESS_TOKEN: env.EXPO_ACCESS_TOKEN,
  };
  return { url: env.SUPABASE_URL, key, read: name => values[name] };
}

function startNotificationRunner({
  env = process.env, create = createClient, dispatch = runNotificationDispatchWithHealth,
  log = value => console.info('[NOTIFICATIONS_V2]', value),
  schedule = setTimeout, cancel = clearTimeout,
} = {}) {
  let runtime;
  try { runtime = notificationRuntime(env); }
  catch { log({ status: 'configuration_error' }); return { stop() {}, enabled: false }; }
  if (!runtime) return { stop() {}, enabled: false };
  const client = create(runtime.url, runtime.key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (url, options = {}) => fetch(url, { ...options, signal: AbortSignal.timeout(10000) }) },
  });
  let stopped = false, timer;
  async function tick() {
    if (stopped) return;
    try {
      const result = await dispatch((name, args) => client.rpc(name, args), runtime.read);
      log({ status: result.dispatch, processed: result.processed, receipts: result.receipts });
    } catch {
      log({ status: 'failed' });
    }
    // Schedule after completion: slow requests never overlap in this process.
    if (!stopped) { timer = schedule(tick, 30000); timer.unref?.(); }
  }
  void tick();
  return { enabled: true, stop() { stopped = true; if (timer) cancel(timer); } };
}
module.exports = { notificationRuntime, startNotificationRunner };
