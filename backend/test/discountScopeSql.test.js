const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const root = path.resolve(__dirname, '../..');
const event = '10000000-0000-4000-8000-000000000001';
const other = '10000000-0000-4000-8000-000000000002';
const organizer = '20000000-0000-4000-8000-000000000001';
const buyer = '20000000-0000-4000-8000-000000000002';
const admission = '30000000-0000-4000-8000-000000000001';
const vip = '30000000-0000-4000-8000-000000000002';
const coupon = '40000000-0000-4000-8000-000000000001';
const extract = (file, name) => {
  const text = fs.readFileSync(path.join(root, file), 'utf8');
  const start = text.indexOf('CREATE OR REPLACE FUNCTION ' + name);
  assert.ok(start >= 0, name);
  const opening = /AS (\$[a-z_]*\$)/i.exec(text.slice(start));
  assert.ok(opening, name);
  const delimiter = opening[1] + ';';
  const end = text.indexOf(delimiter, start + opening.index + opening[0].length);
  assert.ok(end > start, name);
  return text.slice(start, end + delimiter.length);
};
test('discount product scope, authorization and discounted VIP fulfillment', async t => {
  const db = new PGlite(); t.after(() => db.close());
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA private; CREATE SCHEMA auth; CREATE SCHEMA extensions;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    CREATE TABLE profiles(id uuid PRIMARY KEY,role text,full_name text,email text);
    CREATE TABLE events(id uuid PRIMARY KEY,creator_id uuid,ticket_price numeric,available_tickets int,
      event_date timestamptz,end_datetime timestamptz,status text,is_cancelled boolean DEFAULT false);
    CREATE TABLE event_ticket_types(id uuid PRIMARY KEY,event_id uuid,name text,price numeric,quantity int,sold int DEFAULT 0,
      is_active boolean DEFAULT true,deleted_at timestamptz);
    CREATE TABLE reservados_vip(id uuid PRIMARY KEY,event_id uuid,name text,base_price numeric,capacity_people int,
      quantity_available int,is_active boolean DEFAULT true,deleted_at timestamptz);
    CREATE TABLE discount_codes(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),event_id uuid,creator_id uuid,code text,
      discount_type text,discount_value numeric,max_uses int,uses_count int DEFAULT 0,min_tickets int DEFAULT 1,
      valid_from timestamptz DEFAULT now(),valid_until timestamptz,is_active boolean DEFAULT true,created_at timestamptz DEFAULT now());
    CREATE TABLE payment_transactions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),stripe_payment_intent_id text UNIQUE,user_id uuid,
      kind text,status text,metadata jsonb,amount_cents int,fulfilled_at timestamptz);
    CREATE TABLE tickets(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),event_id uuid,user_id uuid,buyer_name text,buyer_email text,
      quantity int,total_price numeric,qr_token uuid,qr_code text,status text,ticket_status text,payment_status text,
      payment_transaction_id uuid,stripe_payment_intent_id text,ticket_type_id uuid);
    CREATE TABLE user_credit(user_id uuid PRIMARY KEY,balance_real numeric,balance_promo numeric,updated_at timestamptz);
    CREATE TABLE wallet_reserves(id uuid,user_id uuid,amount numeric,status text,created_at timestamptz);
    CREATE TABLE wallets(id uuid,user_id uuid,balance numeric);
    CREATE TABLE resale_listings(id uuid);
    CREATE TABLE discount_code_uses(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),discount_code_id uuid,buyer_name text,buyer_email text,
      payment_transaction_id uuid,applied_at timestamptz DEFAULT now());
    CREATE UNIQUE INDEX uses_payment_once ON discount_code_uses(payment_transaction_id) WHERE payment_transaction_id IS NOT NULL;
    INSERT INTO profiles VALUES ('${organizer}','organizer','Organizer','org@example.invalid'),('${buyer}','attendee','Buyer','buyer@example.invalid');
    INSERT INTO events VALUES ('${event}','${organizer}',300,20,now()+interval '1 day',now()+interval '2 days','active',false),
      ('${other}','${buyer}',300,20,now()+interval '1 day',now()+interval '2 days','active',false);
    INSERT INTO event_ticket_types(id,event_id,name,price,quantity) VALUES('${admission}','${event}','General',300,20);
    INSERT INTO reservados_vip(id,event_id,name,base_price,capacity_people,quantity_available) VALUES('${vip}','${event}','Mesa',300,6,5);
    INSERT INTO discount_codes(id,event_id,creator_id,code,discount_type,discount_value)
      VALUES('${coupon}','${event}','${organizer}','VIP20','percentage',20);
  `);
  await db.exec(extract('supabase/migrations/20260922140859_align_resale_transfer_and_commission.sql', 'public.fulfill_payment_for_user_legacy_20260920'));
  for (const name of ['private.fulfill_primary_card', 'private.fulfill_vip_card']) {
    await db.exec(extract('supabase/migrations/20261006150846_snapshot_access_deadlines_for_all_offers.sql', name));
  }
  // Existing accounting trigger is part of the tested flow, not a test-only counter.
  await db.exec(extract('supabase/migrations/20260915121000_restrict_destructive_rpcs_and_record_discounts.sql', 'public.record_fulfilled_payment_discount'));
  await db.exec('CREATE TRIGGER record_discount AFTER UPDATE ON payment_transactions FOR EACH ROW EXECUTE FUNCTION public.record_fulfilled_payment_discount()');
  const migration = fs.readdirSync(path.join(root, 'supabase/migrations')).find(name => name.endsWith('_discount_product_scope.sql'));
  await db.exec(fs.readFileSync(migration ? path.join(root, 'supabase/migrations', migration) : path.join(root, 'scripts/sql/discount_product_scope.sql'), 'utf8'));
  async function asUser(id) { await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [id || '']); }
  async function validate(code = 'VIP20', ticketId = null, vipId = vip, qty = 1) {
    return db.query('SELECT id FROM public.validate_discount_code_for_product($1,$2,$3,$4,$5)', [code, event, qty, ticketId, vipId]);
  }
  async function seed(scope = 'vip_tables', maximum = null) {
    await asUser(organizer);
    await db.exec("TRUNCATE payment_transactions,tickets,discount_code_uses; UPDATE reservados_vip SET quantity_available=5;");
    await db.query(`UPDATE discount_codes SET applicability=$1,ticket_type_ids='{}',vip_reservado_ids='{}',is_active=true,
      min_tickets=1,uses_count=0,max_uses=$2,valid_until=NULL,discount_value=20 WHERE id=$3`, [scope, maximum, coupon]);
    await asUser(buyer);
  }
  async function createPayment(intent, reduction = 6000) {
    const metadata = { event_id: event, vip_reservado_id: vip, discount_code_id: coupon, original_total_cents: 30000,
      discount_amount_cents: reduction, discounted_total_cents: 30000-reduction, service_fee_cents: 391,
      credit_debit_cents: 0, capacity_people: 6, buyer_name: 'Buyer', buyer_email: 'buyer@example.invalid' };
    await db.query(`INSERT INTO payment_transactions(stripe_payment_intent_id,user_id,kind,status,metadata,amount_cents)
      VALUES($1,$2,'vip_table','created',$3,$4)`, [intent, buyer, JSON.stringify(metadata), 30000-reduction+391]);
  }
  async function fulfill(intent) { return (await db.query('SELECT private.fulfill_vip_card($1,$2) AS result', [intent, buyer])).rows[0].result; }
  await t.test('existing codes retain admission-only applicability', async () => {
    assert.equal((await db.query('SELECT applicability FROM discount_codes')).rows[0].applicability, 'tickets');
    await asUser(buyer); await assert.rejects(validate(), /no se aplica/);
    await validate(' vip20 ', admission, null);
  });
  await t.test('unauthenticated caller and unrelated organizer cannot validate/configure', async () => {
    await asUser(null); await assert.rejects(validate(), /Not authenticated/);
    await asUser(buyer); await assert.rejects(db.query("UPDATE discount_codes SET applicability='all' WHERE id=$1", [coupon]), /otro organizador/);
  });
  await t.test('selected products must belong to the event and cannot be empty', async () => {
    await asUser(organizer);
    await assert.rejects(db.exec("UPDATE discount_codes SET applicability='selected'"), /discount_product_scope_valid/);
    await assert.rejects(db.query("UPDATE discount_codes SET applicability='selected',ticket_type_ids=ARRAY[$1::uuid]", [vip]), /pertenecer/);
    await db.query("UPDATE discount_codes SET applicability='selected',ticket_type_ids=ARRAY[$1::uuid],vip_reservado_ids=ARRAY[$2::uuid]", [admission, vip]);
    await asUser(buyer); await validate(); await validate('VIP20', admission, null);
    await assert.rejects(validate('VIP20', admission, vip), /Solicitud/);
    await assert.rejects(db.query('SELECT public.validate_discount_code($1,$2,1)', ['VIP20', event]), /no se aplica/);
  });
  await t.test('VIP minimum counts tables rather than six guests', async () => {
    await seed(); await asUser(organizer); await db.exec('UPDATE discount_codes SET min_tickets=2'); await asUser(buyer);
    await assert.rejects(validate(), /mínimo/); await assert.rejects(validate('VIP20', null, vip, 6), /Cantidad/);
  });
  await t.test('successful discounted table issues six admissions, net price and one use exactly once', async () => {
    await seed(); await createPayment('pi_discount');
    assert.equal((await fulfill('pi_discount')).fulfilled, true);
    assert.equal((await fulfill('pi_discount')).fulfilled, true);
    const result = (await db.query('SELECT quantity,total_price FROM tickets')).rows;
    assert.equal(result.length, 1); assert.equal(result[0].quantity, 6); assert.equal(Number(result[0].total_price), 240);
    assert.equal((await db.query('SELECT uses_count FROM discount_codes')).rows[0].uses_count, 1);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM discount_code_uses')).rows[0].n, 1);
    assert.equal((await db.query('SELECT quantity_available FROM reservados_vip')).rows[0].quantity_available, 4);
  });
  await t.test('competing confirmed payments cannot consume a last use twice; loser requires refund', async () => {
    await seed('vip_tables', 1); await createPayment('pi_first'); await createPayment('pi_second');
    assert.equal((await fulfill('pi_first')).fulfilled, true);
    assert.equal((await fulfill('pi_second')).refund_required, true);
    assert.equal((await db.query('SELECT uses_count FROM discount_codes')).rows[0].uses_count, 1);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM tickets')).rows[0].n, 1);
    assert.equal((await fulfill('pi_second')).refund_required, true);
  });
  await t.test('tampered discount never issues a table and follows durable refund path', async () => {
    await seed(); await createPayment('pi_bad', 29000);
    assert.equal((await fulfill('pi_bad')).refund_required, true);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM tickets')).rows[0].n, 0);
  });
  await t.test('expiration and product exclusion are checked at confirmation too', async () => {
    await seed('tickets'); await createPayment('pi_wrong_scope');
    assert.equal((await fulfill('pi_wrong_scope')).refund_required, true);
    await seed(); await asUser(organizer); await db.exec("UPDATE discount_codes SET valid_until=now()-interval '1 second'");
    await asUser(buyer); await assert.rejects(validate(), /expirado/); await createPayment('pi_expired');
    assert.equal((await fulfill('pi_expired')).refund_required, true);
  });
});
