'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { cancellationDatabase } = require('./helpers/cancellationDatabase');
const { createCancellationWorker } = require('../src/services/cancellation/cancellationWorker');

test('admin approval gates cancellation and financial work at the database boundary', async t => {
  const fixture = await cancellationDatabase(); const db = fixture.pg; t.after(() => fixture.close());
  await db.exec(`CREATE SCHEMA auth;
    CREATE OR REPLACE FUNCTION notification_private.emit(uuid,text,text,text,text,text,jsonb,text,text,text[],timestamptz)
      RETURNS void LANGUAGE sql AS 'INSERT INTO public.notifications(user_id,type,data) VALUES($1,$3,$7)';
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS 'SELECT nullif(current_setting(''test.uid'',true),'''')::uuid';
    GRANT USAGE ON SCHEMA auth,private TO authenticated;
    ALTER TABLE events ADD COLUMN title text DEFAULT 'Test event';
    ALTER TABLE tickets ADD COLUMN quantity int DEFAULT 1;
    CREATE TABLE admin_audit_logs(id uuid DEFAULT gen_random_uuid(),admin_id uuid,action text,target_user_id uuid,details jsonb);
  `);
  await db.exec(fs.readFileSync(path.join(__dirname, '../../supabase/migrations/20261016213005_admin_cancellation_approval.sql'), 'utf8'));
  const owner=randomUUID(), admin=randomUUID(), other=randomUUID();
  await db.query("INSERT INTO profiles(id,role,email) VALUES($1,'organizer','owner@test.invalid'),($2,'admin','admin@test.invalid'),($3,'organizer','other@test.invalid')",[owner,admin,other]);
  await db.query("INSERT INTO organizer_billing_accounts(organizer_id,stripe_customer_id,livemode,ready,policy_version,setup_intent_id) VALUES($1,'cus_owner',false,true,'organizer-cancellation-full-refund-v2','seti_owner')",[owner]);
  const event=async()=>{const id=randomUUID();await db.query("INSERT INTO events(id,creator_id,event_date) VALUES($1,$2,now()+interval '2 days')",[id,owner]);return id;};
  const request=async id=>(await db.query("SELECT public.request_event_cancellation($1,$2,'No podemos abrir',false) AS result",[id,owner])).rows[0].result;
  const asUser=async (id,fn)=>{await db.query("SELECT set_config('test.uid',$1,false)",[id]);await db.exec('SET ROLE authenticated');try{return await fn();}finally{await db.exec('RESET ROLE');}};
  const detail=async id=>(await db.query('SELECT public.admin_cancellation_details($1) AS result',[id])).rows[0].result;
  const review=async (id,approve,hash)=>(await db.query("SELECT public.admin_review_cancellation($1,$2,'Decisión de prueba',$3) AS result",[id,approve,hash])).rows[0].result;
  const firstEvent=await event();let pending;
  await t.test('legacy API only creates a pending request; no event, ticket or refund mutation',async()=>{
    await db.exec('SET ROLE service_role');try{pending=await request(firstEvent);assert.equal((await request(firstEvent)).id,pending.id);}finally{await db.exec('RESET ROLE');}
    assert.equal(pending.status,'pending');
    assert.equal((await db.query('SELECT is_cancelled FROM events WHERE id=$1',[firstEvent])).rows[0].is_cancelled,false);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM event_cancellations')).rows[0].n,0);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM cancellation_refunds')).rows[0].n,0);
    const worker=createCancellationWorker({db:fixture,stripe:new Proxy({}, {get(){throw Error('Stripe must not be called');}}),livemode:false});
    assert.deepEqual(await worker.run(pending.id),{busy:true});
    assert.equal((await db.query("SELECT count(*)::int AS n FROM notifications WHERE user_id=$1 AND type='admin.cancellation_requested'",[admin])).rows[0].n,1);
  });
  await t.test('organizer cannot review, see admin detail, write requests or invoke executable cancellation',async()=>{
    await asUser(owner,async()=>{
      await assert.rejects(detail(pending.id),/Solo administradores/);
      await assert.rejects(review(pending.id,true,'fake'),/Solo administradores/);
      await assert.rejects(db.query("UPDATE event_cancellation_requests SET status='approved' WHERE id=$1",[pending.id]),/permission denied/);
      await assert.rejects(db.query("SELECT private.execute_approved_cancellation($1,$2,'Bypass test',false)",[firstEvent,owner]),/permission denied/);
      assert.equal((await db.query('SELECT count(*)::int AS n FROM event_cancellation_requests')).rows[0].n,1);
    });
    await asUser(other,async()=>assert.equal((await db.query('SELECT count(*)::int AS n FROM event_cancellation_requests')).rows[0].n,0));
    await db.exec('SET ROLE anon');try{await assert.rejects(detail(pending.id),/permission denied/);}finally{await db.exec('RESET ROLE');}
  });
  await t.test('direct cancellation and queue insertion are blocked even for free events',async()=>{
    await assert.rejects(db.query("UPDATE events SET status='cancelled',is_cancelled=true WHERE id=$1",[firstEvent]),/ADMIN_APPROVAL_REQUIRED/);
    await assert.rejects(db.query("INSERT INTO event_cancellations(event_id,organizer_id,livemode,policy_version,setup_intent_id,reason) VALUES($1,$2,false,'test','seti_owner','Bypass test')",[firstEvent,owner]),/ADMIN_APPROVAL_REQUIRED/);
  });
  await t.test('rejection leaves event active and produces no financial job',async()=>{
    const rejected=await asUser(admin,()=>review(pending.id,false,null));assert.equal(rejected.status,'rejected');
    assert.equal((await db.query('SELECT is_cancelled FROM events WHERE id=$1',[firstEvent])).rows[0].is_cancelled,false);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM event_cancellations')).rows[0].n,0);
    await asUser(admin,async()=>{assert.equal((await review(pending.id,false,null)).id,pending.id);await assert.rejects(review(pending.id,true,'old'),/ya fue revisada/);});
  });
  const next=await request(firstEvent);
  await t.test('stale review cannot approve changed purchase totals',async()=>{
    const before=await asUser(admin,()=>detail(next.id));
    await db.query("INSERT INTO payment_transactions(id,user_id,kind,currency,amount_cents,platform_fee_cents,metadata,status) VALUES($1,$2,'event_ticket','eur',1250,50,$3,'fulfilled')",[randomUUID(),other,JSON.stringify({event_id:firstEvent,service_fee_cents:50})]);
    await asUser(admin,()=>assert.rejects(review(next.id,true,before.fingerprint),/compras han cambiado/));
    assert.equal((await db.query('SELECT status FROM event_cancellation_requests WHERE id=$1',[next.id])).rows[0].status,'pending');
  });
  await t.test('suspended admin cannot approve',async()=>{
    await db.query('UPDATE profiles SET is_suspended=true WHERE id=$1',[admin]);
    await asUser(admin,()=>assert.rejects(review(next.id,true,'x'),/Solo administradores/));
    await db.query('UPDATE profiles SET is_suspended=false WHERE id=$1',[admin]);
  });
  await t.test('failed execution rolls back approval, audit and notifications',async()=>{
    const notifications=(await db.query('SELECT count(*)::int AS n FROM notifications')).rows[0].n;
    await db.query('UPDATE organizer_billing_accounts SET ready=false WHERE organizer_id=$1',[owner]);
    await asUser(admin,async()=>{const current=await detail(next.id);await assert.rejects(review(next.id,true,current.fingerprint),/BILLING_AUTHORIZATION_REQUIRED/);});
    assert.equal((await db.query('SELECT status FROM event_cancellation_requests WHERE id=$1',[next.id])).rows[0].status,'pending');
    assert.equal((await db.query('SELECT count(*)::int AS n FROM notifications')).rows[0].n,notifications);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM event_cancellations')).rows[0].n,0);
    await db.query('UPDATE organizer_billing_accounts SET ready=true WHERE organizer_id=$1',[owner]);
  });
  await t.test('approval atomically cancels event, records actor/snapshot, and creates exactly one refund job',async()=>{
    await asUser(admin,async()=>{
      const current=await detail(next.id);assert.equal(current.purchases[0].amount_cents,1250);
      const approved=await review(next.id,true,current.fingerprint);assert.equal(approved.status,'approved');assert.equal(approved.reviewed_by,admin);assert.ok(approved.cancellation_id);
      const again=await review(next.id,true,current.fingerprint);assert.equal(again.cancellation_id,approved.cancellation_id);
    });
    assert.equal((await db.query('SELECT is_cancelled FROM events WHERE id=$1',[firstEvent])).rows[0].is_cancelled,true);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM event_cancellations')).rows[0].n,1);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM admin_audit_logs WHERE action='cancellation_approved'")).rows[0].n,1);
  });
});
