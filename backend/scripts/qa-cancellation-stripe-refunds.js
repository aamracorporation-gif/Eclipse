'use strict';
const {randomUUID}=require('node:crypto');
const assert=require('node:assert/strict');
async function testRefundVariants({db,stripe,billing,worker,collections,owner,buyer,runId,connected,record}) {
  for(const scenario of ['legacy_partial','legacy_unreversed','async_success','async_failure']) {
    const legacy=scenario.startsWith('legacy_');
    const event=randomUUID(),tx=randomUUID();
    await db.pg.query('INSERT INTO events(id,creator_id,event_date) VALUES($1,$2,now()+interval \'2 days\')',[event,owner]);
    const pi=await stripe.paymentIntents.create({amount:2056,currency:'eur',payment_method:scenario==='async_success'?'pm_card_pendingRefund':scenario==='async_failure'?'pm_card_refundFail':'pm_card_visa',
      confirm:true,capture_method:'automatic',automatic_payment_methods:{enabled:true,allow_redirects:'never'},
      ...(legacy?{transfer_data:{destination:connected.id},application_fee_amount:256}:{}),
      metadata:{eclipse_qa_run:runId,event_id:event,user_id:buyer}},{idempotencyKey:`qa-refund-${scenario}:${runId}`});
    assert.equal(pi.livemode,false);assert.equal(pi.status,'succeeded');
    await db.pg.query(`INSERT INTO payment_transactions(id,user_id,kind,currency,amount_cents,platform_fee_cents,stripe_payment_intent_id,metadata,status)
      VALUES($1,$2,'vip_table','eur',2056,200,$3,$4,'fulfilled')`,[tx,buyer,pi.id,{event_id:event,service_fee_cents:56,eclipse_commission_cents:200}]);
    if(scenario==='legacy_partial') await stripe.refunds.create({payment_intent:pi.id,amount:1000,reverse_transfer:true,refund_application_fee:true},{idempotencyKey:`qa-partial:${runId}`});
    if(scenario==='legacy_unreversed') await stripe.refunds.create({payment_intent:pi.id,amount:1000},{idempotencyKey:`qa-partial-unreversed:${runId}`});
    const job=await billing.requestCancellation(owner,event,'QA: '+scenario);
    await worker.run(job.id);
    let refunds=(await stripe.refunds.list({payment_intent:pi.id})).data;
    const own=refunds.find(r=>r.metadata.eclipse_cancellation_id===job.id);assert.ok(own);
    if(legacy) {
      assert.equal(refunds.length,2);assert.equal(own.amount,1056);assert.equal(refunds.reduce((s,r)=>s+r.amount,0),2056);
      const expanded=await stripe.paymentIntents.retrieve(pi.id,{expand:['latest_charge.transfer','latest_charge.application_fee']});
      const transfer=expanded.latest_charge.transfer,fee=expanded.latest_charge.application_fee;
      if(scenario==='legacy_unreversed') {
        assert.ok(transfer.amount_reversed<transfer.amount);
        assert.equal((await db.pg.query('SELECT status FROM payment_transactions WHERE id=$1',[tx])).rows[0].status,'refunded');
        const held=(await db.pg.query('SELECT status,last_error FROM cancellation_refunds WHERE transaction_id=$1',[tx])).rows[0];
        assert.equal(held.status,'attention');assert.equal(held.last_error,'LEGACY_ALLOCATION_NOT_RECOVERED');
        await assert.rejects(collections.prepare(job.id,{reference:'must-not-close',feesFinalized:true,purchases:[]}),/NOT_RECONCILED/);
        record('Legacy partial refund without allocation reversal: buyer fully refunded, missing recovery explicitly blocks accounting',{paymentIntentId:pi.id,finalRefundId:own.id});
        continue;
      }
      assert.equal(transfer.reversed,true);assert.equal(transfer.amount_reversed,transfer.amount);assert.equal(fee.amount_refunded,fee.amount);
      record('Legacy destination/VIP purchase: partial plus final refund returns full price, reverses organizer transfer and application fee',{paymentIntentId:pi.id,finalRefundId:own.id});
      continue;
    }
    if(scenario==='async_success') {
      assert.equal(own.status,'pending');assert.equal((await db.pg.query('SELECT status FROM cancellation_refunds WHERE transaction_id=$1',[tx])).rows[0].status,'processing');
      record('Pending Stripe refund is never shown as completed',{paymentIntentId:pi.id,refundId:own.id});
    }
    const expected=scenario==='async_success'?'succeeded':'failed';let current=own;
    for(let attempt=0;current.status!==expected&&attempt<60;attempt++) {
      await new Promise(resolve=>setTimeout(resolve,2000));current=await stripe.refunds.retrieve(own.id);
    }
    assert.equal(current.status,expected);
    await worker.handleWebhook({type:expected==='failed'?'refund.failed':'refund.updated',data:{object:current}});
    await worker.run(job.id);
    const result=(await db.pg.query('SELECT status FROM cancellation_refunds WHERE transaction_id=$1',[tx])).rows[0];
    const state=(await db.pg.query('SELECT status FROM event_cancellations WHERE id=$1',[job.id])).rows[0];
    if(expected==='failed') {
      assert.equal(result.status,'attention');assert.equal(state.status,'attention');
      await assert.rejects(collections.prepare(job.id,{reference:'must-not-collect',feesFinalized:true,purchases:[]}),/NOT_RECONCILED/);
      await worker.handleWebhook({type:'refund.updated',data:{object:{...own,status:'succeeded'}}});
      assert.equal((await db.pg.query('SELECT status FROM cancellation_refunds WHERE transaction_id=$1',[tx])).rows[0].status,'attention');
      assert.equal((await stripe.refunds.list({payment_intent:pi.id})).data.length,1);
      record('Refund later fails: buyer case reopens, organizer collection is blocked, stale success cannot hide failure and no duplicate refund is issued',{paymentIntentId:pi.id,refundId:own.id});
    } else {assert.equal(result.status,'succeeded');record('Delayed Stripe refund completes after authoritative provider update',{paymentIntentId:pi.id,refundId:own.id});}
  }
}
module.exports={testRefundVariants};
