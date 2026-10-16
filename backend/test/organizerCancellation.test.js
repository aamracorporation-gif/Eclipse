const test = require('node:test');
const assert = require('node:assert/strict');
const { billingRuntime, createOrganizerBilling, policy } = require('../src/services/cancellation/organizerBilling');
const { createCancellationWorker, saleSnapshot } = require('../src/services/cancellation/cancellationWorker');
const { calculateCollection, createCancellationCollection } = require('../src/services/cancellation/cancellationCollection');
const { validateSettlement } = require('../src/services/cancellation/organizerSettlement');

function memoryDb(tables) {
  return { from(table) {
    const filters=[]; let op='select',payload;
    const query={ select(){return query;}, eq(k,v){filters.push(row=>row[k]===v);return query;},
      neq(k,v){filters.push(row=>row[k]!==v);return query;},
      in(k,v){filters.push(row=>v.includes(row[k]));return query;},
      is(k,v){filters.push(row=>(row[k]??null)===v);return query;},
      maybeSingle(){return run(true);},single(){return run(true);},update(v){op='update';payload=v;return query;},
      insert(v){op='insert';payload=v;return query;},upsert(v){op='insert';payload=v;return query;},
      then(resolve,reject){return run(false).then(resolve,reject);} };
    async function run(single){
      tables[table] ||= [];
      if(op==='insert') tables[table].push(payload);
      const found=tables[table].filter(row=>filters.every(f=>f(row)));
      if(op==='update') found.forEach(row=>Object.assign(row,payload));
      return {data:single?found[0]??null:found,error:null};
    }
    return query;
  } };
}
const job={id:'job_1',event_id:'event_1'};
const tx={id:'tx_1',user_id:'buyer',kind:'event_ticket',currency:'eur',amount_cents:2056,platform_fee_cents:200,
  stripe_payment_intent_id:'pi_sale',metadata:{event_id:'event_1',service_fee_cents:56,eclipse_commission_cents:200}};
const payment=()=>({id:'pi_sale',status:'succeeded',amount:2056,amount_received:2056,currency:'eur',livemode:false,
  metadata:{event_id:'event_1',user_id:'buyer'},latest_charge:{id:'ch_sale',payment_intent:'pi_sale',paid:true,captured:true,
    livemode:false,currency:'eur',amount:2056,balance_transaction:{id:'txn_fee',source:'ch_sale',currency:'eur',amount:2056,type:'charge',fee:56}}});

test('runtime requires explicit activation and matching project, secret and mode',()=>{
  assert.throws(()=>billingRuntime({}),/todavía no está disponible/);
  const env={ORGANIZER_CANCELLATION_BILLING_ENABLED:'true',ORGANIZER_BILLING_STRIPE_MODE:'test',STRIPE_SECRET_KEY:'sk_test_dummy',
    SUPABASE_SERVICE_ROLE_KEY:'private',ORGANIZER_BILLING_PROJECT_REF:'a'.repeat(20),SUPABASE_URL:`https://${'a'.repeat(20)}.supabase.co`};
  assert.equal(billingRuntime(env).livemode,false);
  assert.throws(()=>billingRuntime({...env,STRIPE_SECRET_KEY:'sk_live_dummy'}),/MODE_MISMATCH/);
  assert.throws(()=>billingRuntime({...env,SUPABASE_URL:'https://wrong.supabase.co'}),/PROJECT_MISMATCH/);
});
test('saving an organizer card requires exact explicit consent and never creates a charge',async()=>{
  const tables={profiles:[{id:'organizer',role:'organizer'}],organizer_billing_accounts:[{organizer_id:'organizer',stripe_customer_id:'cus_org',livemode:false}]};
  const calls=[];
  const service=createOrganizerBilling({db:memoryDb(tables),livemode:false,stripe:{setupIntents:{create:async p=>{calls.push(p);return{id:'seti_org',client_secret:'secret',livemode:false};}}}});
  await assert.rejects(service.beginSetup('organizer',{accepted:false,version:policy.version,sha256:policy.sha256}),/aceptar/);
  const result=await service.beginSetup('organizer',{accepted:true,version:policy.version,sha256:policy.sha256});
  assert.ok(result.setupId); assert.equal(calls.length,1);assert.equal(calls[0].usage,'off_session');assert.equal(calls[0].amount,undefined);
  assert.equal(tables.organizer_billing_setups[0].consent_text,policy.text);
});
test('setup confirmation rejects another customer even when client claims success',async()=>{
  const tables={profiles:[{id:'organizer',role:'organizer'}],organizer_billing_accounts:[{organizer_id:'organizer',stripe_customer_id:'cus_org',livemode:false}],
    organizer_billing_setups:[{id:'setup',organizer_id:'organizer',setup_intent_id:'seti_other'}]};
  const service=createOrganizerBilling({db:memoryDb(tables),livemode:false,stripe:{setupIntents:{retrieve:async()=>({status:'succeeded',livemode:false,customer:'cus_other'})}}});
  await assert.rejects(service.confirmSetup('organizer','setup'),/OWNERSHIP_MISMATCH/);
  assert.equal(tables.organizer_billing_accounts[0].ready,undefined);
});
test('wallet combinations and inconsistent historical commissions require reconciliation',()=>{
  assert.deepEqual(saleSnapshot(tx),{service:56,commission:200});
  assert.throws(()=>saleSnapshot({...tx,metadata:{...tx.metadata,credit_debit_cents:100}}),/MANUAL_RECONCILIATION/);
  assert.throws(()=>saleSnapshot({...tx,metadata:{...tx.metadata,eclipse_commission_cents:300}}),/SNAPSHOT_MISMATCH/);
});
test('full refund reuses provider result after timeout instead of creating a second refund',async()=>{
  const tables={cancellation_refunds:[{transaction_id:'tx_1'}],payment_transactions:[{id:'tx_1'}]};
  const refunds=[];let calls=0;
  const stripe={paymentIntents:{retrieve:async()=>payment()},refunds:{list:()=>({autoPagingToArray:async()=>refunds}),create:async p=>{
    calls++;const r={id:'re_1',amount:p.amount,status:'succeeded',metadata:p.metadata};refunds.push(r);throw new Error('response lost');
  }}};
  const worker=createCancellationWorker({db:memoryDb(tables),stripe,livemode:false});
  await assert.rejects(worker.refundPurchase(job,tx,{}),/response lost/);
  await worker.refundPurchase(job,tx,{});
  assert.equal(calls,1);assert.equal(refunds[0].amount,2056);
  assert.equal(tables.cancellation_refunds[0].status,'succeeded');assert.equal(tables.payment_transactions[0].status,'refunded');
});
test('prior partial refund reduces remainder; destination charge reverses allocation and application fee',async()=>{
  const tables={cancellation_refunds:[{transaction_id:'tx_1'}],payment_transactions:[{id:'tx_1'}]};let requested;
  const pi={...payment(),transfer_data:{destination:'acct_org'},application_fee_amount:256};
  pi.latest_charge.transfer={amount:2056,amount_reversed:2056};
  pi.latest_charge.application_fee={amount:256,amount_refunded:256};
  const worker=createCancellationWorker({db:memoryDb(tables),livemode:false,stripe:{paymentIntents:{retrieve:async()=>pi},refunds:{
    list:()=>({autoPagingToArray:async()=>[{id:'re_old',amount:1000,status:'succeeded'}]}),
    create:async p=>{requested=p;return{id:'re_new',amount:p.amount,status:'succeeded'};},
  }}});
  await worker.refundPurchase(job,tx,{});
  assert.equal(requested.amount,1056);assert.equal(requested.reverse_transfer,true);assert.equal(requested.refund_application_fee,true);
});
test('a wrong-mode payment cannot be refunded; a pending refund is not reported as completed',async()=>{
  const tables={cancellation_refunds:[{transaction_id:'tx_1'}],payment_transactions:[{id:'tx_1',status:'fulfilled'}]};
  const pi=payment();pi.livemode=true;
  const stripe={paymentIntents:{retrieve:async()=>pi},refunds:{list:()=>({autoPagingToArray:async()=>[{id:'re_wait',amount:2056,status:'pending'}]})}};
  const worker=createCancellationWorker({db:memoryDb(tables),stripe,livemode:false});
  await assert.rejects(worker.refundPurchase(job,tx,{}),/PAYMENT_MISMATCH/);
  pi.livemode=false;await worker.refundPurchase(job,tx,{});
  assert.equal(tables.cancellation_refunds[0].status,'processing');assert.equal(tables.payment_transactions[0].status,'refund_pending');
});

test('a historical refund without transfer reversal returns the buyer money but cannot close accounting',async()=>{
  const tables={cancellation_refunds:[{transaction_id:'tx_1'}],payment_transactions:[{id:'tx_1'}]};
  const pi={...payment(),transfer_data:{destination:'acct_org'},application_fee_amount:256};
  pi.latest_charge.transfer={amount:2056,amount_reversed:1056};
  pi.latest_charge.application_fee={amount:256,amount_refunded:131};
  const worker=createCancellationWorker({db:memoryDb(tables),livemode:false,stripe:{paymentIntents:{retrieve:async()=>pi},refunds:{
    list:()=>({autoPagingToArray:async()=>[{id:'re_old',amount:2056,status:'succeeded'}]}),
  }}});
  await assert.rejects(worker.refundPurchase(job,tx,{}),/LEGACY_ALLOCATION_NOT_RECOVERED/);
  assert.equal(tables.payment_transactions[0].status,'refunded');
  assert.equal(tables.cancellation_refunds[0].status,'attention');
});

test('a disputed organizer charge reopens the case using provider state, even after a stale success',async()=>{
  const pi={id:'pi_debt',amount:290,amount_received:290,currency:'eur',livemode:false,status:'succeeded',customer:'cus_org',
    metadata:{eclipse_purpose:'organizer_cancellation_collection',eclipse_collection_id:'debt'},latest_charge:{disputed:true}};
  const row={id:'debt',cancellation_id:'job_1',amount_cents:290,status:'succeeded',payment_intent_id:'pi_debt',event_cancellations:{organizer_id:'organizer',livemode:false}};
  const tables={cancellation_collections:[row],event_cancellations:[{id:'job_1',status:'collected'}],organizer_billing_accounts:[{organizer_id:'organizer',stripe_customer_id:'cus_org'}]};
  const worker=createCancellationWorker({db:memoryDb(tables),livemode:false,stripe:{paymentIntents:{retrieve:async()=>pi},charges:{retrieve:async()=>({payment_intent:'pi_debt'})}}});
  await worker.handleWebhook({type:'charge.dispute.created',data:{object:{charge:'ch_debt'}}});
  await worker.handleWebhook({type:'payment_intent.succeeded',data:{object:pi}});
  assert.equal(row.status,'attention');assert.equal(tables.event_cancellations[0].status,'attention');
});
test('billing refuses unknown costs and duplicate evidence; commission plus real cost is 2.56 EUR',()=>{
  const refunds=[{transaction_id:'tx_1',status:'succeeded',amount_cents:2056,service_charge_cents:56,commission_cents:200}];
  const evidence={reference:'stripe-report-reviewed',feesFinalized:true,purchases:[{transactionId:'tx_1',costs:[{reference:'txn_fee',amountCents:56,category:'processing',direction:'debit',currency:'eur'}]}]};
  assert.deepEqual(calculateCollection(refunds,evidence),{commission:200,costs:56,total:256});
  assert.throws(()=>calculateCollection(refunds,{...evidence,feesFinalized:false}),/FINAL_FEE_RECONCILIATION/);
  assert.throws(()=>calculateCollection([{...refunds[0],status:'processing'}],evidence),/REFUNDS_NOT_COMPLETE/);
  assert.throws(()=>calculateCollection(refunds,{...evidence,purchases:[...evidence.purchases,...evidence.purchases]}),/COUNT_MISMATCH/);
});
test('organizer collection recovers lost response, does not charge again and keeps collection costs pending',async()=>{
  const row={id:'debt',cancellation_id:'job_1',amount_cents:256,notice_delivered_at:'2026-01-01',
    event_cancellations:{organizer_id:'organizer',livemode:false,status:'collection_pending'},'event_cancellations.organizer_id':'organizer',residual_costs_status:'pending'};
  const tables={cancellation_collections:[row],event_cancellations:[{id:'job_1'}],organizer_billing_accounts:[{organizer_id:'organizer',stripe_customer_id:'cus_org',livemode:false,ready:true,policy_version:policy.version,payment_method_id:'pm_org'}]};
  const intents=[];let calls=0;
  const stripe={paymentIntents:{list:()=>({autoPagingToArray:async()=>intents}),retrieve:async()=>intents[0],create:async p=>{
    calls++;intents.push({id:'pi_debt',...p,livemode:false,status:'succeeded',amount_received:p.amount});throw new Error('lost');
  }}};
  const collection=createCancellationCollection({db:memoryDb(tables),stripe,livemode:false});
  await assert.rejects(collection.collect('debt','organizer'),/lost/);
  const result=await collection.collect('debt','organizer');assert.equal(result.status,'succeeded');assert.equal(calls,1);
  assert.equal(row.residual_costs_status,'pending');
});
test('post-event settlement rejects early, refunded, disputed or immediately transferred charges',()=>{
  const event={id:'event_1',end_datetime:'2026-01-01T00:00:00Z',is_cancelled:false,status:'scheduled'};
  const sale={...tx,status:'fulfilled',destination_amount_cents:1800,destination_account_id:'acct_org',metadata:{...tx.metadata,settlement_model:'after_event_v1'}};
  const pi=payment();pi.metadata.settlement_model='after_event_v1';
  assert.doesNotThrow(()=>validateSettlement(event,sale,pi,false,Date.parse('2026-02-01')));
  assert.throws(()=>validateSettlement({...event,end_datetime:null},sale,pi,false),/NOT_COMPLETED/);
  assert.throws(()=>validateSettlement(event,sale,{...pi,transfer_data:{destination:'acct_org'}},false),/MISMATCH/);
  assert.throws(()=>validateSettlement(event,sale,{...pi,latest_charge:{...pi.latest_charge,amount_refunded:1}},false),/MISMATCH/);
  assert.throws(()=>validateSettlement(event,sale,{...pi,latest_charge:{...pi.latest_charge,disputed:true}},false),/MISMATCH/);
});
