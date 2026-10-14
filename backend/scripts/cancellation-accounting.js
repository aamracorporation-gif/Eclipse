'use strict';
// Private operator entry point. No HTTP endpoint accepts fee evidence from users.
// Never log card/customer details, client secrets or credentials.
const fs = require('node:fs');
const { cancellationServices } = require('../src/services/cancellation/runtime');
const { billingRuntime, checked } = require('../src/services/cancellation/organizerBilling');
const { createOrganizerSettlement } = require('../src/services/cancellation/organizerSettlement');
const { supabaseAdmin } = require('../src/services/supabaseService');
const { getStripeClient } = require('../src/services/stripe/stripeClient');
const { importFeeReport, reconcileCollectionFees } = require('../src/services/cancellation/feeReconciliation');

async function main(args) {
  const [operation, id, file, ...flags] = args;
  if (!['prepare-collection','reconcile-costs','collect','release'].includes(operation) || !/^[0-9a-f-]{36}$/i.test(id || '')) {
    throw new Error('Usage: prepare-collection <cancellation UUID> <reviewed-evidence.json> | reconcile-costs <collection UUID> <fees.csv> <reviewed-manifest.json> | collect <collection UUID> | release <payment UUID> [--execute --event-completion-verified]');
  }
  const service = cancellationServices();
  if (operation === 'prepare-collection') {
    if (!file || flags.length) throw new Error('Reviewed Stripe fee evidence file required');
    const evidence = JSON.parse(fs.readFileSync(file, 'utf8'));
    const result = await service.collections.prepare(id, evidence);
    console.log(JSON.stringify({ prepared: true, collectionId: result.id || null, amountCents: result.amount_cents || 0 }));
  } else if (operation === 'reconcile-costs') {
    if (!file || flags.length !== 1) throw new Error('Complete itemized fees CSV and reviewed manifest required');
    const evidence = importFeeReport(fs.readFileSync(file,'utf8'), JSON.parse(fs.readFileSync(flags[0],'utf8')));
    const { livemode } = billingRuntime();
    const result = await reconcileCollectionFees({ db: supabaseAdmin, stripe: getStripeClient(), livemode }, id, evidence);
    console.log(JSON.stringify(result));
  } else if (operation === 'collect') {
    // A prior customer-visible notice or explicit acknowledgement is mandatory.
    // This command cannot manufacture a notice-delivery timestamp.
    const row = await checked(supabaseAdmin.from('cancellation_collections').select('event_cancellations!inner(organizer_id)').eq('id', id).single());
    const result = await service.collections.collect(id, row.event_cancellations.organizer_id);
    console.log(JSON.stringify({ collectionId: id, status: result.status }));
  } else {
    const options = [file, ...flags].filter(Boolean);
    if (options.some(f => !['--execute','--event-completion-verified'].includes(f))) throw new Error('Unknown release option');
    const { livemode } = billingRuntime();
    const result = await createOrganizerSettlement({ db: supabaseAdmin, stripe: getStripeClient(), livemode }).release(id,
      { execute: options.includes('--execute'), eventCompletionVerified: options.includes('--event-completion-verified') });
    console.log(JSON.stringify({ paymentId: id, ...result, transferred: Boolean(result.transferId) }));
  }
}
if (require.main === module) main(process.argv.slice(2)).catch(e => { console.error(e.code || e.message); process.exitCode = 1; });
module.exports = { main };
