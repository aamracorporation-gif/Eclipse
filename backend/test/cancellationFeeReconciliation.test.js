const test=require('node:test'),assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {decimalCents,importFeeReport}=require('../src/services/cancellation/feeReconciliation');
const {cancellationDatabase}=require('./helpers/cancellationDatabase');

test('fee CSV uses exact cents, includes fee tax, credits and quoted commas without adding inline fees again',()=>{
  const manifest={reference:'stripe-report-1',stripeAccount:'acct_test',livemode:false,currency:'eur',feesFinalized:true,
    reviewedBy:'finance',reviewedAt:'2026-10-14T00:00:00Z',targets:[{providerId:'ch_original',category:'processing'}]};
  const csv='incurred_by,amount,tax,currency,fee_description,fee_transaction_id\r\nch_original,0.56,0.12,eur,"Card, fee",fee_1\r\nch_original,-0.10,0.00,eur,Credit,fee_2\r\n';
  const result=importFeeReport(csv,manifest);
  assert.deepEqual(result.targets[0].costs.map(c=>[c.amountCents,c.direction]),[[68,'debit'],[10,'credit']]);
  assert.equal(result.sha256.length,64);assert.equal(decimalCents('1.01'),101);
  assert.throws(()=>decimalCents('0.001'),/INVALID_REPORT_AMOUNT/);
  assert.throws(()=>importFeeReport(csv.replace('fee_2','fee_1'),manifest),/DUPLICATE_REPORT_FEE/);
  assert.throws(()=>importFeeReport(csv.replaceAll('eur','usd'),manifest),/CURRENCY/);
  assert.throws(()=>importFeeReport('incurred_by,amount,tax,currency\n',{...manifest}),/FEES_MISSING/);
  assert.throws(()=>importFeeReport(csv,{...manifest,feesFinalized:false}),/MANIFEST/);
});

test('cost debt and credit settlement is atomic, bounded, idempotent and service-only',async t=>{
  const db=await cancellationDatabase();t.after(()=>db.close());const pg=db.pg,owner=randomUUID(),event=randomUUID();
  await pg.query(`INSERT INTO organizer_billing_accounts(organizer_id,stripe_customer_id,livemode,setup_intent_id,ready,policy_version)
    VALUES($1,'cus_test',false,'seti_test',true,'organizer-cancellation-full-refund-v2')`,[owner]);
  await pg.query(`INSERT INTO events(id,creator_id,event_date) VALUES($1,$2,now()+interval '1 day')`,[event,owner]);
  const job=(await pg.query('SELECT request_event_cancellation($1,$2,\'Cancel for test\',false) result',[event,owner])).rows[0].result;
  const collection=(await pg.query(`INSERT INTO cancellation_collections(cancellation_id,amount_cents,commission_cents,stripe_costs_cents,cost_evidence,reconciliation_reference,status)
    VALUES($1,256,200,56,'{}','original-report','succeeded') RETURNING id`,[job.id])).rows[0].id;
  await pg.query('UPDATE event_cancellations SET status=\'collected\' WHERE id=$1',[job.id]);
  const report=async(reference,total,collectionFee)=> (await pg.query(`SELECT reconcile_cancellation_costs($1,false,$2,$3,$4,$5,'{"feesFinalized":true}') result`,[collection,total,collectionFee,reference,'a'.repeat(64)])).rows[0].result;
  const tx=async(gross=1800,charged=2056)=>{
    const id=randomUUID(),ev=randomUUID();
    await pg.query(`INSERT INTO events(id,creator_id,event_date,end_datetime) VALUES($1,$2,now()-interval '2 days',now()-interval '1 day')`,[ev,owner]);
    await pg.query(`INSERT INTO payment_transactions(id,kind,currency,amount_cents,metadata,status,destination_amount_cents,destination_account_id)
      VALUES($1,'event_ticket','eur',$2,$3,'fulfilled',$4,'acct_test')`,[id,charged,{event_id:ev,settlement_model:'after_event_v1'},gross]);return id;
  };
  const reserve=async(id,execute=true)=> (await pg.query('SELECT reserve_organizer_settlement($1,false,true,$2) result',[id,execute])).rows[0].result;
  await t.test('unknown costs block a payout; exact collection fee becomes debt and replay cannot double it',async()=>{
    const id=await tx();await assert.rejects(reserve(id),/RECONCILIATION_PENDING/);
    assert.equal((await report('report1',85,29)).adjustmentCents,29);
    assert.equal((await report('report1',85,29)).replayed,true);
    await assert.rejects(report('report1',86,30),/REFERENCE_REUSED/);
    assert.equal((await pg.query('SELECT sum(amount_cents)::int n FROM organizer_cost_entries')).rows[0].n,29);
  });
  let first;
  await t.test('a real notice is required before a cost is reserved against proceeds',async()=>{
    const id=await tx();await assert.rejects(reserve(id),/COST_NOTICE_REQUIRED/);
    await pg.query('UPDATE organizer_cost_entries SET notice_delivered_at=now()');
    const quote=await reserve(id,false);assert.equal(quote.amount_cents,1771);
    assert.equal((await pg.query('SELECT count(*)::int n FROM organizer_cost_allocations')).rows[0].n,0);
    first=await reserve(id);assert.equal(first.amount_cents,1771);assert.equal(first.cost_adjustment_cents,29);
    assert.equal((await reserve(id)).transaction_id,first.transaction_id);
  });
  await t.test('an in-flight payout reserves the adjustment; a second payout cannot deduct it again',async()=>{
    const other=await reserve(await tx());assert.equal(other.amount_cents,1800);assert.equal(other.cost_adjustment_cents,0);
    assert.equal((await pg.query('SELECT sum(amount_cents)::int n FROM organizer_cost_allocations')).rows[0].n,29);
  });
  await t.test('later provider credits remain owed to the organizer and increase a subsequent payout',async()=>{
    assert.equal((await report('report2-credit',75,19)).adjustmentCents,-10);
    await pg.query('UPDATE organizer_cost_entries SET notice_delivered_at=now()');
    const result=await reserve(await tx());assert.equal(result.amount_cents,1810);assert.equal(result.cost_adjustment_cents,-10);
  });
  await t.test('insufficient proceeds leave an exact debt and allow a zero transfer without a new card fee',async()=>{
    assert.equal((await report('report3-extra',2075,2019)).adjustmentCents,2000);
    await pg.query('UPDATE organizer_cost_entries SET notice_delivered_at=now()');
    const result=await reserve(await tx());assert.equal(result.amount_cents,0);assert.equal(result.cost_adjustment_cents,1800);
    const next=await reserve(await tx());assert.equal(next.cost_adjustment_cents,200);assert.equal(next.amount_cents,1600);
  });
  await t.test('credits never exceed source charge and unused credit remains visible',async()=>{
    await report('report4-credit',75,19);await pg.query('UPDATE organizer_cost_entries SET notice_delivered_at=now()');
    const result=await reserve(await tx());assert.equal(result.amount_cents,2056);assert.equal(result.cost_adjustment_cents,-256);
    const next=await reserve(await tx());assert.equal(next.amount_cents,2056);
  });
  await t.test('clients cannot read debt or allocate it, and report/allocations are immutable even to service role',async()=>{
    for(const role of ['anon','authenticated']) {
      await pg.exec(`SET ROLE ${role}`);
      try { for(const table of ['cancellation_cost_reports','organizer_cost_entries','organizer_cost_allocations']) await assert.rejects(pg.query(`SELECT * FROM ${table}`),e=>e.code==='42501');
        await assert.rejects(reserve(first.transaction_id),e=>e.code==='42501');
      } finally { await pg.exec('RESET ROLE'); }
    }
    await pg.exec('SET ROLE service_role');
    try {await assert.rejects(pg.query('UPDATE organizer_cost_entries SET amount_cents=0'),e=>e.code==='42501');
      await assert.rejects(pg.query('DELETE FROM organizer_cost_allocations'),e=>e.code==='42501');
    } finally {await pg.exec('RESET ROLE');}
  });
  await t.test('sub-minimum debt is carried exactly, without rounding up or creating a charge',async()=>{
    const ev=randomUUID();await pg.query(`INSERT INTO events(id,creator_id,event_date) VALUES($1,$2,now()+interval '1 day')`,[ev,owner]);
    const j=(await pg.query('SELECT request_event_cancellation($1,$2,\'Small amount test\',false) result',[ev,owner])).rows[0].result;
    await pg.query('UPDATE event_cancellations SET status=\'reconciliation\' WHERE id=$1',[j.id]);
    const c=(await pg.query(`INSERT INTO cancellation_collections(cancellation_id,amount_cents,commission_cents,stripe_costs_cents,cost_evidence,reconciliation_reference)
      VALUES($1,29,10,19,'{}','small-reviewed') RETURNING id`,[j.id])).rows[0].id;
    const first=(await pg.query('SELECT defer_small_cancellation_collection($1,false,$2) result',[c,'b'.repeat(64)])).rows[0].result;
    assert.equal(first.status,'deferred');assert.equal(first.payment_intent_id,null);assert.equal(first.amount_cents,29);
    const repeat=(await pg.query('SELECT defer_small_cancellation_collection($1,false,$2) result',[c,'b'.repeat(64)])).rows[0].result;
    assert.equal(repeat.id,first.id);
    assert.equal((await pg.query('SELECT e.amount_cents FROM organizer_cost_entries e JOIN cancellation_cost_reports r ON r.id=e.report_id WHERE r.collection_id=$1',[c])).rows[0].amount_cents,29);
    await assert.rejects(pg.query('SELECT defer_small_cancellation_collection($1,true,$2)',[c,'b'.repeat(64)]),/NOT_ELIGIBLE/);
  });
});
