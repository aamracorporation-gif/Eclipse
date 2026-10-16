'use strict';
// Explicit opt-in integration test. Only Stripe TEST resources, never real money.
// Uses the candidate's actual services and a real local Postgres engine. It does
// not certify deployed webhooks, Supabase Auth or device PaymentSheet UI.
const fs=require('node:fs'), path=require('node:path'), assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const Stripe=require(process.env.ECLIPSE_QA_STRIPE_SDK_PATH || 'stripe');
const {cancellationDatabase}=require('../test/helpers/cancellationDatabase');
const {createOrganizerBilling,policy}=require('../src/services/cancellation/organizerBilling');
const {createCancellationWorker}=require('../src/services/cancellation/cancellationWorker');
const {createCancellationCollection}=require('../src/services/cancellation/cancellationCollection');
const {inlineStripeFeeEvidence}=require('../src/services/cancellation/cancellationAmounts');
const {createOrganizerSettlement}=require('../src/services/cancellation/organizerSettlement');
const {importFeeReport,reconcileCollectionFees}=require('../src/services/cancellation/feeReconciliation');

async function main() {
  if(process.env.ECLIPSE_STRIPE_QA!=='test-only') throw Error('EXPLICIT_TEST_OPT_IN_REQUIRED');
  const key=process.env.STRIPE_SECRET_KEY;
  if(!/^(sk|rk)_test_/.test(key||'') || !process.env.ECLIPSE_QA_STRIPE_ACCOUNT) throw Error('TEST_KEY_AND_ACCOUNT_REQUIRED');
  const stripe=new Stripe(key,{apiVersion:'2026-08-26.dahlia',maxNetworkRetries:2,timeout:20000});
  async function paymentWithFee(id) {
    for(let attempt=0;attempt<24;attempt++) {
      const pi=await stripe.paymentIntents.retrieve(id,{expand:['latest_charge.balance_transaction']});
      if(pi.latest_charge?.balance_transaction && typeof pi.latest_charge.balance_transaction==='object') return pi;
      if(attempt===0) console.log(JSON.stringify({waitingFor:'Stripe balance transaction',paymentIntentId:id}));
      await new Promise(resolve=>setTimeout(resolve,5000));
    }
    throw Error('STRIPE_FEE_STILL_PENDING');
  }
  const account=await stripe.accounts.retrieve();assert.equal(account.id,process.env.ECLIPSE_QA_STRIPE_ACCOUNT);
  const runId=process.env.ECLIPSE_QA_RUN_ID || randomUUID(), evidence={runId,account:account.id,livemode:false,startedAt:new Date().toISOString(),cases:[]};
  const output=process.env.ECLIPSE_QA_OUTPUT || path.resolve('qa-cancellation-stripe-result.json');
  function record(name,details={}) { const item={name,passed:true,...details};evidence.cases.push(item);fs.writeFileSync(output,JSON.stringify(evidence,null,2));console.log(JSON.stringify(item)); }
  const db=await cancellationDatabase();
  try {
    const owner=randomUUID(), buyer=randomUUID(),eventId=randomUUID(),txId=randomUUID();
    await db.pg.query('INSERT INTO profiles(id,role) VALUES($1,\'organizer\')',[owner]);
    const options={db,stripe,livemode:false},billing=createOrganizerBilling(options),worker=createCancellationWorker(options),collections=createCancellationCollection(options);
    const setup=await billing.beginSetup(owner,{accepted:true,...policy});
    const setupRow=(await db.pg.query('SELECT * FROM organizer_billing_setups WHERE id=$1',[setup.setupId])).rows[0];
    const si=await stripe.setupIntents.confirm(setupRow.setup_intent_id,{payment_method:'pm_card_visa'});
    assert.equal(si.livemode,false);assert.equal(si.status,'succeeded');
    assert.equal((await billing.confirmSetup(owner,setup.setupId)).ready,true);
    const org=(await db.pg.query('SELECT * FROM organizer_billing_accounts WHERE organizer_id=$1',[owner])).rows[0];
    assert.equal((await stripe.paymentIntents.list({customer:org.stripe_customer_id})).data.length,0);
    record('SetupIntent saves card without an initial charge',{setupIntentId:si.id,customerId:org.stripe_customer_id});
    await db.pg.query('INSERT INTO events(id,creator_id,event_date) VALUES($1,$2,now()+interval \'2 days\')',[eventId,owner]);
    const params={amount:2056,currency:'eur',payment_method:'pm_card_visa',confirm:true,capture_method:'automatic',
      automatic_payment_methods:{enabled:true,allow_redirects:'never'},transfer_group:`event_${eventId}`,
      metadata:{eclipse_qa_run:runId,event_id:eventId,user_id:buyer,settlement_model:'after_event_v1'}};
    const sale=await stripe.paymentIntents.create(params,{idempotencyKey:`qa-cancel-sale:${runId}`});
    assert.equal(sale.livemode,false);assert.equal(sale.status,'succeeded');assert.equal(sale.transfer_data,null);
    await db.pg.query(`INSERT INTO payment_transactions(id,user_id,kind,currency,amount_cents,platform_fee_cents,stripe_payment_intent_id,metadata,status)
      VALUES($1,$2,'event_ticket','eur',2056,200,$3,$4,'fulfilled')`,[txId,buyer,sale.id,{event_id:eventId,service_fee_cents:56,eclipse_commission_cents:200,settlement_model:'after_event_v1'}]);
    await db.pg.query('INSERT INTO tickets(event_id,status,ticket_status) VALUES($1,\'active\',\'valid\')',[eventId]);
    record('Buyer payment holds organizer proceeds until after event',{paymentIntentId:sale.id,amountCents:2056});
    const job=await billing.requestCancellation(owner,eventId,'QA Stripe: organizer cancellation');
    const originalRefund=stripe.refunds.create.bind(stripe.refunds);let refundCalls=0;
    stripe.refunds.create=async(...args)=>{const result=await originalRefund(...args);refundCalls++;throw Error('QA_RESPONSE_LOST_AFTER_STRIPE_SUCCESS');};
    await worker.run(job.id);stripe.refunds.create=originalRefund;
    await worker.run(job.id);await worker.run(job.id);
    const refunds=await stripe.refunds.list({payment_intent:sale.id});
    assert.equal(refunds.data.length,1);assert.equal(refunds.data[0].amount,2056);assert.equal(refunds.data[0].status,'succeeded');assert.equal(refundCalls,1);
    assert.equal((await db.pg.query('SELECT status FROM payment_transactions WHERE id=$1',[txId])).rows[0].status,'refunded');
    assert.equal((await db.pg.query('SELECT ticket_status FROM tickets WHERE event_id=$1',[eventId])).rows[0].ticket_status,'invalidated');
    record('Full buyer refund, invalidated admission and lost-response retry without duplicate',{refundId:refunds.data[0].id,amountCents:2056});
    const fullSale=await paymentWithFee(sale.id);
    const saleFee=inlineStripeFeeEvidence(fullSale,{paymentIntentId:sale.id,chargedCents:2056,currency:'eur',livemode:false});
    // This is a TEST-only inline-fee fixture, not a claim that Stripe's final
    // live itemized report has arrived or that all standalone charges are zero.
    const collection=await collections.prepare(job.id,{reference:`qa-inline-fixture:${runId}`,feesFinalized:true,purchases:[{transactionId:txId,costs:[saleFee]}]});
    const originalCollect=stripe.paymentIntents.create.bind(stripe.paymentIntents);let collectionCalls=0;
    stripe.paymentIntents.create=async(...args)=>{const result=await originalCollect(...args);collectionCalls++;throw Error('QA_RESPONSE_LOST_AFTER_STRIPE_SUCCESS');};
    await assert.rejects(collections.acknowledgeAndCollect(collection.id,owner),/QA_RESPONSE_LOST/);
    stripe.paymentIntents.create=originalCollect;
    assert.equal((await collections.collect(collection.id,owner)).status,'succeeded');
    assert.equal((await collections.collect(collection.id,owner)).status,'succeeded');assert.equal(collectionCalls,1);
    const charged=(await stripe.paymentIntents.list({customer:org.stripe_customer_id})).data;assert.equal(charged.length,1);
    const collectionPi=await paymentWithFee(charged[0].id);
    const collectionFee=inlineStripeFeeEvidence(collectionPi,{paymentIntentId:collectionPi.id,chargedCents:collection.amount_cents,currency:'eur',livemode:false});
    record('Off-session collection recovers lost response and charges only once',{paymentIntentId:collectionPi.id,commissionCents:200,originalFeeCents:saleFee.amountCents,amountCents:collection.amount_cents,collectionFeeCents:collectionFee.amountCents});
    await worker.handleWebhook({type:'payment_intent.payment_failed',data:{object:{...collectionPi,status:'requires_payment_method'}}});
    assert.equal((await db.pg.query('SELECT status FROM cancellation_collections WHERE id=$1',[collection.id])).rows[0].status,'succeeded');
    record('Out-of-order failure event cannot undo a successful collection');
    const csv=`incurred_by,amount,tax,currency\n${saleFee.chargeId},${(saleFee.amountCents/100).toFixed(2)},0.00,eur\n${collectionFee.chargeId},${(collectionFee.amountCents/100).toFixed(2)},0.00,eur\n`;
    const manifest={reference:`qa-fixture-report:${runId}`,stripeAccount:account.id,livemode:false,currency:'eur',feesFinalized:true,
      reviewedBy:'automated-test-inline-fixture-not-live-fee-finality',reviewedAt:new Date().toISOString(),targets:[
        {providerId:saleFee.chargeId,category:'processing'}, {providerId:refunds.data[0].id,category:'refund',confirmedZero:true},
        {providerId:collectionFee.chargeId,category:'collection'}]};
    const report=importFeeReport(csv,manifest);
    const adjustment=await reconcileCollectionFees(options,collection.id,report);
    assert.equal(adjustment.adjustmentCents,collectionFee.amountCents);
    assert.equal((await reconcileCollectionFees(options,collection.id,report)).replayed,true);
    record('Collection fee becomes an exact recoverable balance; same report cannot duplicate debt',{adjustmentCents:adjustment.adjustmentCents,feeEvidence:'actual test balance transactions; report-finality fixture'});
    const connected=(await stripe.accounts.list({limit:100})).data.find(a=>a.capabilities?.transfers==='active');
    if(!connected) throw Error('CONNECTED_TEST_ACCOUNT_REQUIRED');
    const futureEvent=randomUUID(),futureTx=randomUUID();
    await db.pg.query('INSERT INTO events(id,creator_id,event_date,end_datetime) VALUES($1,$2,now()-interval \'2 days\',now()-interval \'1 day\')',[futureEvent,owner]);
    const next=await originalCollect({...params,transfer_group:`event_${futureEvent}`,metadata:{...params.metadata,event_id:futureEvent}},{idempotencyKey:`qa-cancel-next:${runId}`});
    await db.pg.query(`INSERT INTO payment_transactions(id,user_id,kind,currency,amount_cents,platform_fee_cents,stripe_payment_intent_id,metadata,status,destination_amount_cents,destination_account_id)
      VALUES($1,$2,'event_ticket','eur',2056,200,$3,$4,'fulfilled',1800,$5)`,[futureTx,buyer,next.id,{event_id:futureEvent,settlement_model:'after_event_v1'},connected.id]);
    const entry=(await db.pg.query('SELECT id FROM organizer_cost_entries WHERE organizer_id=$1',[owner])).rows[0];
    const settlement=createOrganizerSettlement(options);
    await assert.rejects(settlement.release(futureTx),/COST_NOTICE_REQUIRED/);
    await billing.acknowledgeCost(owner,entry.id);
    const payout=await settlement.release(futureTx,{execute:true,eventCompletionVerified:true});
    assert.equal(payout.amountCents,1800-collectionFee.amountCents);
    const replay=await settlement.release(futureTx,{execute:true,eventCompletionVerified:true});assert.equal(payout.transferId,replay.transferId);
    record('Real Stripe transfer deducts collection expense once, after notice and event completion',{transferId:payout.transferId,grossCents:1800,netCents:payout.amountCents,offsetCents:payout.costAdjustmentCents});
    // Decline after successful setup. No deposit is needed to discover this
    // failure later; buyer refunds above have already completed independently.
    const declinedSetup=await billing.beginSetup(owner,{accepted:true,...policy});
    const ds=(await db.pg.query('SELECT setup_intent_id FROM organizer_billing_setups WHERE id=$1',[declinedSetup.setupId])).rows[0];
    const savedDecline=await stripe.setupIntents.confirm(ds.setup_intent_id,{payment_method:'pm_card_chargeCustomerFail'});
    assert.equal(savedDecline.status,'succeeded');await billing.confirmSetup(owner,declinedSetup.setupId);
    const declineEvent=randomUUID();await db.pg.query('INSERT INTO events(id,creator_id,event_date) VALUES($1,$2,now()+interval \'2 days\')',[declineEvent,owner]);
    const declineJob=await billing.requestCancellation(owner,declineEvent,'QA: collection failure fixture');
    const debt=(await db.pg.query(`INSERT INTO cancellation_collections(cancellation_id,amount_cents,commission_cents,stripe_costs_cents,cost_evidence,reconciliation_reference)
      VALUES($1,290,200,90,'{}','qa-decline-fixture') RETURNING id`,[declineJob.id])).rows[0];
    await db.pg.query('UPDATE event_cancellations SET status=\'collection_pending\' WHERE id=$1',[declineJob.id]);
    const failed=await collections.acknowledgeAndCollect(debt.id,owner);assert.equal(failed.status,'requires_payment_method');assert.ok(failed.clientSecret);
    const failedRow=(await db.pg.query('SELECT * FROM cancellation_collections WHERE id=$1',[debt.id])).rows[0];
    await collections.collect(debt.id,owner);
    assert.equal((await db.pg.query('SELECT payment_intent_id FROM cancellation_collections WHERE id=$1',[debt.id])).rows[0].payment_intent_id,failedRow.payment_intent_id);
    record('Saved card can fail later; collection remains unpaid and repeated request reuses the same payment',{paymentIntentId:failedRow.payment_intent_id,status:failed.status});
    const recovered=await stripe.paymentIntents.confirm(failedRow.payment_intent_id,{payment_method:'pm_card_visa',off_session:false});
    assert.equal(recovered.status,'succeeded');await worker.handleWebhook({type:'payment_intent.succeeded',data:{object:recovered}});
    assert.equal((await db.pg.query('SELECT status FROM cancellation_collections WHERE id=$1',[debt.id])).rows[0].status,'succeeded');
    record('Organizer recovers a declined charge on the same PaymentIntent',{paymentIntentId:recovered.id});
    const authSetup=await billing.beginSetup(owner,{accepted:true,...policy});
    const authRow=(await db.pg.query('SELECT setup_intent_id FROM organizer_billing_setups WHERE id=$1',[authSetup.setupId])).rows[0];
    const needsAuth=await stripe.setupIntents.confirm(authRow.setup_intent_id,{payment_method:'pm_card_threeDSecure2Required',return_url:'https://example.invalid/qa-return'});
    assert.equal(needsAuth.status,'requires_action');assert.equal((await billing.confirmSetup(owner,authSetup.setupId)).ready,false);
    record('Card setup requiring bank authentication is not falsely marked completed',{setupIntentId:needsAuth.id,status:needsAuth.status});
    await require('./qa-cancellation-stripe-refunds').testRefundVariants({db,stripe,billing,worker,collections,owner,buyer,runId,connected,record});
    const reversedCollection=await stripe.refunds.create({payment_intent:collectionPi.id},{idempotencyKey:`qa-collection-reversed:${runId}`});
    const reversedCharge=await stripe.charges.retrieve(collectionPi.latest_charge.id);
    await worker.handleWebhook({type:'charge.refunded',data:{object:reversedCharge}});
    await worker.handleWebhook({type:'payment_intent.succeeded',data:{object:collectionPi}});
    assert.equal((await db.pg.query('SELECT status FROM cancellation_collections WHERE id=$1',[collection.id])).rows[0].status,'attention');
    assert.equal((await db.pg.query('SELECT status FROM event_cancellations WHERE id=$1',[job.id])).rows[0].status,'attention');
    await assert.rejects(collections.collect(collection.id,owner),/BUYER_REFUNDS_NOT_COMPLETE/);
    record('Organizer charge refunded later: case reopens, stale success cannot mark it paid and no replacement charge is issued',{paymentIntentId:collectionPi.id,refundId:reversedCollection.id});
    evidence.finishedAt=new Date().toISOString();evidence.passed=true;
    fs.writeFileSync(output,JSON.stringify(evidence,null,2));
  } catch(error) {
    evidence.passed=false;evidence.failure={code:error.code || error.name,message:error.message};fs.writeFileSync(output,JSON.stringify(evidence,null,2));throw error;
  } finally { await db.close(); }
}
if(require.main===module) main().catch(e=>{console.error(JSON.stringify({code:e.code||e.name,message:e.message}));process.exitCode=1;});
module.exports={main};
