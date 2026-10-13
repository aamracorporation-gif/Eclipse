const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

test('database preserves ticket and payment history when deleting events', async t => {
  const db = new PGlite(); t.after(() => db.close());
  const orphan = '10000000-0000-4000-8000-000000000099';
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated;
    CREATE TABLE events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), sold_tickets int DEFAULT 0);
    CREATE TABLE tickets(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_id uuid,
      status text, CONSTRAINT tickets_event_id_fkey FOREIGN KEY(event_id) REFERENCES events(id) ON DELETE CASCADE);
    CREATE TABLE payment_transactions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), status text, metadata jsonb NOT NULL DEFAULT '{}');
    INSERT INTO payment_transactions(status,metadata) VALUES('created','{"event_id":"${orphan}"}');
  `);
  await db.exec(fs.readFileSync(path.join(__dirname,'../../supabase/migrations/20261013224156_protect_event_purchase_history.sql'),'utf8'));
  const event = async sold => (await db.query('INSERT INTO events(sold_tickets) VALUES($1) RETURNING id',[sold||0])).rows[0].id;
  const remove = id => db.query('DELETE FROM events WHERE id=$1',[id]);
  const present = async id => assert.equal((await db.query('SELECT count(*)::int n FROM events WHERE id=$1',[id])).rows[0].n,1);

  await t.test('deletes a draft with no commercial history', async () => {
    const id=await event(); await remove(id);
    assert.equal((await db.query('SELECT count(*)::int n FROM events WHERE id=$1',[id])).rows[0].n,0);
  });
  for(const status of ['valid','used','refunded','free']) await t.test(`preserves ${status} tickets`,async()=>{
    const id=await event(); await db.query('INSERT INTO tickets(event_id,status) VALUES($1,$2)',[id,status]);
    await assert.rejects(remove(id),e=>e.code==='PT409'); await present(id);
    assert.equal((await db.query('SELECT count(*)::int n FROM tickets WHERE event_id=$1',[id])).rows[0].n,1);
  });
  for(const status of ['created','fulfilled','refund_pending','refunded','failed']) await t.test(`preserves ${status} payments even before a ticket exists`,async()=>{
    const id=await event();await db.query('INSERT INTO payment_transactions(status,metadata) VALUES($1,$2)',[status,JSON.stringify({event_id:id})]);
    await assert.rejects(remove(id),e=>e.code==='PT409'); await present(id);
  });
  await t.test('preserves an event whose sales counter records historical sales',async()=>{
    const id=await event(1);await assert.rejects(remove(id),e=>e.code==='PT409');await present(id);
  });
  await t.test('late checkout cannot attach a payment to an already deleted event',async()=>{
    const id=await event();await remove(id);
    await assert.rejects(db.query('INSERT INTO payment_transactions(metadata) VALUES($1)',[JSON.stringify({event_id:id})]),e=>e.code==='23503');
  });
  await t.test('legacy orphan remains reconcilable without silently repairing or deleting it',async()=>{
    await db.query("UPDATE payment_transactions SET status='refund_pending' WHERE protected_event_id=$1",[orphan]);
    assert.equal((await db.query('SELECT status FROM payment_transactions WHERE protected_event_id=$1',[orphan])).rows[0].status,'refund_pending');
  });
  await t.test('unrelated metadata does not create a fictitious event reference',async()=>{
    for(const metadata of [{},{event_id:''},{event_id:'not-a-uuid'}]){
      const r=await db.query('INSERT INTO payment_transactions(metadata) VALUES($1) RETURNING protected_event_id',[JSON.stringify(metadata)]);
      assert.equal(r.rows[0].protected_event_id,null);
    }
  });
  await t.test('foreign keys enforce protection even independently of the friendly trigger',async()=>{
    const a=await event(),b=await event();
    await db.query('INSERT INTO tickets(event_id) VALUES($1)',[a]);
    await db.query('INSERT INTO payment_transactions(metadata) VALUES($1)',[JSON.stringify({event_id:b})]);
    await db.exec('ALTER TABLE events DISABLE TRIGGER a00_protect_event_purchase_history');
    try {for(const id of [a,b]){await assert.rejects(remove(id),e=>e.code==='23503');await present(id);}}
    finally {await db.exec('ALTER TABLE events ENABLE TRIGGER a00_protect_event_purchase_history');}
  });
  await t.test('buyer RLS cannot hide a payment from the deletion guard',async()=>{
    const id=await event();await db.query('INSERT INTO payment_transactions(metadata) VALUES($1)',[JSON.stringify({event_id:id})]);
    await db.exec('ALTER TABLE payment_transactions ENABLE ROW LEVEL SECURITY; GRANT SELECT,DELETE ON events TO authenticated; GRANT SELECT ON payment_transactions TO authenticated; SET ROLE authenticated');
    try {assert.equal((await db.query('SELECT count(*)::int n FROM payment_transactions')).rows[0].n,0);await assert.rejects(remove(id),e=>e.code==='PT409');}
    finally {await db.exec('RESET ROLE');}
    await present(id);
  });
});
