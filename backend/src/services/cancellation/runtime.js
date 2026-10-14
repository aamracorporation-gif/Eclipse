'use strict';
const { supabaseAdmin } = require('../supabaseService');
const { getStripeClient } = require('../stripe/stripeClient');
const { billingRuntime, createOrganizerBilling, checked } = require('./organizerBilling');
const { createCancellationWorker } = require('./cancellationWorker');
const { createCancellationCollection } = require('./cancellationCollection');

function cancellationServices() {
  const { livemode } = billingRuntime();
  const options = { db: supabaseAdmin, stripe: getStripeClient(), livemode };
  return { billing: createOrganizerBilling(options), worker: createCancellationWorker(options),
    collections: createCancellationCollection(options) };
}
async function cancellationWebhook(event) {
  if (process.env.ORGANIZER_CANCELLATION_BILLING_ENABLED !== 'true') return false;
  const service = cancellationServices();
  if (event.type === 'setup_intent.succeeded' && event.data.object.metadata?.eclipse_billing_setup_id) {
    await service.billing.confirmSetup(event.data.object.metadata.eclipse_organizer_id, event.data.object.metadata.eclipse_billing_setup_id);
    return true;
  }
  return service.worker.handleWebhook(event);
}
function startCancellationRunner() {
  if (process.env.ORGANIZER_CANCELLATION_WORKER_ENABLED !== 'true') return { stop() {} };
  const service = cancellationServices(); // Fail startup if an explicitly enabled financial worker is misconfigured.
  let stopped = false, timer;
  async function tick() {
    try {
      const jobs = await checked(supabaseAdmin.from('event_cancellations').select('id')
        .order('checked_at', { ascending: true, nullsFirst: true }).limit(10));
      for (const job of jobs) {
        if (stopped) break;
        try { await service.worker.run(job.id); }
        catch { console.error('[CANCELLATION] refund reconciliation requires attention'); }
      }
      if (process.env.ORGANIZER_CANCELLATION_COLLECTION_ENABLED === 'true') {
        const noticeHours = Number(process.env.ORGANIZER_COLLECTION_NOTICE_DELAY_HOURS);
        if (!Number.isFinite(noticeHours) || noticeHours < 24) throw new Error('COLLECTION_NOTICE_DELAY_REQUIRED');
        const collections = await checked(supabaseAdmin.from('cancellation_collections')
          .select('id,event_cancellations!inner(organizer_id)').in('status', ['pending','processing']).order('created_at').limit(20));
        for (const collection of collections) {
          const current = await checked(supabaseAdmin.rpc('refresh_cancellation_collection_notice', { p_id: collection.id }));
          if (!current?.notice_delivered_at || Date.now() - Date.parse(current.notice_delivered_at) < noticeHours * 3600000) continue;
          try { await service.collections.collect(collection.id, collection.event_cancellations.organizer_id); }
          catch { console.error('[CANCELLATION] organizer collection requires attention'); }
        }
      }
    } catch { console.error('[CANCELLATION] worker unavailable'); }
    if (!stopped) { timer = setTimeout(tick, 60000); timer.unref?.(); }
  }
  void tick();
  return { stop() { stopped = true; clearTimeout(timer); } };
}
module.exports = { cancellationServices, cancellationWebhook, startCancellationRunner };
