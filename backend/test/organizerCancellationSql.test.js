const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

test('cancellation ledger enforces ownership, authorization, terminal state and service-only access', async t => {
  const db = new PGlite(); t.after(() => db.close());
  const owner = '10000000-0000-4000-8000-000000000001', stranger = '10000000-0000-4000-8000-000000000002';
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA private;
    CREATE SCHEMA notification_private;
    CREATE TABLE notification_private.deliveries(notification_id uuid,status text,updated_at timestamptz);
    CREATE TABLE notifications(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,type text,data jsonb);
    CREATE TABLE notification_private.test_emits(user_id uuid,kind text,data jsonb);
    CREATE FUNCTION notification_private.emit(uuid,text,text,text,text,text,jsonb,text,text,text[],timestamptz)
      RETURNS void LANGUAGE sql AS 'INSERT INTO notification_private.test_emits VALUES($1,$3,$7)';
    CREATE TABLE events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),creator_id uuid,event_date timestamptz,
      end_datetime timestamptz,status text DEFAULT 'scheduled',is_cancelled bool DEFAULT false,cancelled_at timestamptz,cancellation_reason text);
    CREATE TABLE payment_transactions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),protected_event_id uuid,metadata jsonb DEFAULT '{}');
    GRANT SELECT,INSERT,UPDATE ON events,payment_transactions TO service_role;`);
  await db.exec(fs.readFileSync(path.join(__dirname, '../../supabase/migrations/20261014001706_organizer_deferred_cancellation_billing.sql'), 'utf8'));
  await db.query(`INSERT INTO organizer_billing_accounts(organizer_id,stripe_customer_id,livemode,ready,policy_version,setup_intent_id)
    VALUES($1,'cus_owner',false,true,'organizer-cancellation-full-refund-v2','seti_owner')`, [owner]);
  const event = async date => (await db.query("INSERT INTO events(creator_id,event_date) VALUES($1,COALESCE($2::timestamptz,now()+interval '2 days')) RETURNING id",[owner,date || null])).rows[0].id;
  const request = async (id, user = owner, live = false) => (await db.query('SELECT request_event_cancellation($1,$2,$3,$4) job',[id,user,'Motivo justificado',live])).rows[0].job;
  const id = await event();
  await db.query('INSERT INTO payment_transactions(protected_event_id) VALUES($1)',[id]);
  await t.test('direct event cancellation with purchase history cannot skip refund workflow', async () => {
    await assert.rejects(db.query("UPDATE events SET is_cancelled=true WHERE id=$1",[id]), /USE_CANCELLATION_WORKFLOW/);
  });
  await t.test('another organizer or test/live mismatch cannot cancel', async () => {
    await assert.rejects(request(id,stranger), /EVENT_NOT_OWNED/);
    await assert.rejects(request(id,owner,true), /BILLING_AUTHORIZATION_REQUIRED/);
    assert.equal((await db.query('SELECT is_cancelled FROM events WHERE id=$1',[id])).rows[0].is_cancelled,false);
  });
  let job;
  await t.test('event freeze and refund job commit together, repeated request is idempotent', async () => {
    await db.exec('SET ROLE service_role');
    try { job = await request(id); assert.equal((await request(id)).id,job.id); }
    finally { await db.exec('RESET ROLE'); }
    assert.equal((await db.query('SELECT is_cancelled FROM events WHERE id=$1',[id])).rows[0].is_cancelled,true);
    assert.equal((await db.query('SELECT count(*)::int n FROM event_cancellations')).rows[0].n,1);
  });
  await t.test('a canceled event cannot be reactivated or reassigned', async () => {
    await assert.rejects(db.query("UPDATE events SET status='scheduled',is_cancelled=false WHERE id=$1",[id]), /CANCELLED_EVENT_IS_IMMUTABLE/);
    await assert.rejects(db.query('UPDATE events SET creator_id=$2 WHERE id=$1',[id,stranger]), /CANCELLED_EVENT_IS_IMMUTABLE/);
    await assert.rejects(db.query('DELETE FROM events WHERE id=$1',[id]), e=>e.code==='23503');
  });
  await t.test('a checkout that finishes creating its payment after cancellation is rejected', async () => {
    await assert.rejects(db.query('INSERT INTO payment_transactions(metadata) VALUES($1)',[JSON.stringify({event_id:id})]),/EVENT_CANCELLED_DURING_CHECKOUT/);
  });
  await t.test('only one worker owns an unexpired lease; stale tokens cannot update its successor', async () => {
    const first=(await db.query('SELECT claim_event_cancellation($1) job',[job.id])).rows[0].job;
    assert.ok(first.lease_token);
    assert.equal((await db.query('SELECT claim_event_cancellation($1) job',[job.id])).rows[0].job,null);
    await db.query("UPDATE event_cancellations SET lease_until=now()-interval '1 second' WHERE id=$1",[job.id]);
    const second=(await db.query('SELECT claim_event_cancellation($1) job',[job.id])).rows[0].job;
    assert.notEqual(first.lease_token,second.lease_token);
    const stale=await db.query("UPDATE event_cancellations SET status='collected' WHERE id=$1 AND lease_token=$2 RETURNING id",[job.id,first.lease_token]);
    assert.equal(stale.rows.length,0);
  });
  await t.test('public clients cannot read mandates, forge charges or invoke the privileged workflow', async () => {
    for(const role of ['anon','authenticated']) {
      await db.exec(`SET ROLE ${role}`);
      try {
        for(const table of ['organizer_billing_accounts','organizer_billing_setups','event_cancellations','cancellation_refunds','cancellation_collections','organizer_settlement_transfers']) {
          await assert.rejects(db.query(`SELECT * FROM ${table}`),e=>e.code==='42501');
        }
        await assert.rejects(request(id),e=>e.code==='42501');
      } finally { await db.exec('RESET ROLE'); }
    }
  });
  await t.test('absent authorization rolls back every change', async () => {
    const fresh=await event(); await db.query('UPDATE organizer_billing_accounts SET ready=false WHERE organizer_id=$1',[owner]);
    await assert.rejects(request(fresh),/BILLING_AUTHORIZATION_REQUIRED/);
    assert.equal((await db.query('SELECT is_cancelled FROM events WHERE id=$1',[fresh])).rows[0].is_cancelled,false);
    await db.query('UPDATE organizer_billing_accounts SET ready=true WHERE organizer_id=$1',[owner]);
  });
  await t.test('started events and already initiated settlements require support', async () => {
    const past=await event('2020-01-01'); await assert.rejects(request(past),/STARTED_EVENT_REQUIRES_SUPPORT/);
    const fresh=await event(); const tx=(await db.query('INSERT INTO payment_transactions(protected_event_id) VALUES($1) RETURNING id',[fresh])).rows[0].id;
    await db.query("UPDATE events SET end_datetime=now()-interval '1 day' WHERE id=$1",[fresh]);
    await db.query(`INSERT INTO organizer_settlement_transfers(transaction_id,event_id,organizer_id,destination_account_id,amount_cents,livemode)
      VALUES($1,$2,$3,'acct_example',1800,false)`,[tx,fresh,owner]);
    await assert.rejects(request(fresh),/SETTLED_EVENT_REQUIRES_SUPPORT/);
  });
  await t.test('settlement cannot win after a cancellation has committed', async () => {
    const transaction=(await db.query('SELECT id FROM payment_transactions WHERE protected_event_id=$1',[id])).rows[0].id;
    await assert.rejects(db.query(`INSERT INTO organizer_settlement_transfers(transaction_id,event_id,organizer_id,destination_account_id,amount_cents,livemode)
      VALUES($1,$2,$3,'acct_example',1800,false)`,[transaction,id,owner]),/EVENT_NOT_ELIGIBLE_FOR_SETTLEMENT/);
  });
  await t.test('a queued or merely accepted notification cannot authorize an automatic charge', async () => {
    const collection=(await db.query(`INSERT INTO cancellation_collections(cancellation_id,amount_cents,commission_cents,stripe_costs_cents,cost_evidence,reconciliation_reference)
      VALUES($1,256,200,56,'{}','report-reviewed') RETURNING id`,[job.id])).rows[0].id;
    assert.equal((await db.query('SELECT count(*)::int n FROM notification_private.test_emits')).rows[0].n,1);
    const refreshed=async()=>(await db.query('SELECT refresh_cancellation_collection_notice($1) row',[collection])).rows[0].row;
    assert.equal((await refreshed()).notice_delivered_at,null);
    const notification=(await db.query("INSERT INTO notifications(user_id,type,data) VALUES($1,'organizer.cancellation_due',$2) RETURNING id",[owner,JSON.stringify({collection_id:collection})])).rows[0].id;
    await db.query("INSERT INTO notification_private.deliveries VALUES($1,'accepted',now())",[notification]);
    assert.equal((await refreshed()).notice_delivered_at,null);
    await db.query("UPDATE notification_private.deliveries SET status='confirmed' WHERE notification_id=$1",[notification]);
    assert.ok((await refreshed()).notice_delivered_at);
  });
});
