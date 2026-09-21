const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

const buyer = '10000000-0000-0000-0000-000000000001';
const seller = '10000000-0000-0000-0000-000000000002';
const listing = '20000000-0000-0000-0000-000000000001';
const ticket = '30000000-0000-0000-0000-000000000001';
const event = '40000000-0000-0000-0000-000000000001';

test('resale wallet settles credit and Stripe reserves atomically', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql
      AS 'SELECT ''10000000-0000-0000-0000-000000000001''::uuid';
    CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, raw_user_meta_data jsonb);
    CREATE TABLE public.events (
      id uuid PRIMARY KEY, title text, allow_resale boolean, is_cancelled boolean,
      status text, event_date timestamptz, end_datetime timestamptz
    );
    CREATE TABLE public.tickets (
      id uuid PRIMARY KEY, event_id uuid, user_id uuid, total_price numeric,
      status text, ticket_status text, scanned_at timestamptz, validation_status text,
      wallet_added boolean, wallet_pass_id text, payment_status text, qr_token uuid,
      qr_code text, short_code text, buyer_name text, buyer_email text,
      attendee_name text, attendee_email text, transfer_count integer,
      last_transferred_at timestamptz
    );
    CREATE TABLE public.resale_listings (
      id uuid PRIMARY KEY, ticket_id uuid UNIQUE, seller_id uuid, price numeric,
      status text, updated_at timestamptz
    );
    CREATE TABLE public.user_credit (
      user_id uuid PRIMARY KEY, balance_real numeric NOT NULL DEFAULT 0,
      balance_promo numeric NOT NULL DEFAULT 0, updated_at timestamptz
    );
    CREATE TABLE public.wallet_reserves (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid,
      amount numeric, stripe_payment_intent_id text, status text DEFAULT 'pending',
      created_at timestamptz DEFAULT now(), updated_at timestamptz
    );
    CREATE TABLE public.wallets (user_id uuid PRIMARY KEY, balance numeric, updated_at timestamptz);
    CREATE TABLE public.resale_transactions (
      listing_id uuid, ticket_id uuid, seller_id uuid, buyer_id uuid,
      price numeric, commission numeric, seller_amount numeric
    );
    CREATE TABLE public.movements (who uuid, amount numeric);
    CREATE TABLE public.notifications (who uuid, template text);
    CREATE FUNCTION public.record_ledger_movimiento(text,uuid,uuid,numeric,text,text)
      RETURNS void LANGUAGE plpgsql AS $$
      BEGIN INSERT INTO public.movements VALUES ($2,$4); END $$;
    CREATE FUNCTION public.enqueue_notification_from_template(uuid,text,text,jsonb)
      RETURNS void LANGUAGE plpgsql AS $$
      BEGIN INSERT INTO public.notifications VALUES ($1,$3); END $$;
  `);
  const migration = fs.readFileSync(path.join(__dirname,
    '../../supabase/migrations/20260920104556_harden_resale_credit_and_card.sql'), 'utf8');
  await db.exec(migration.slice(migration.indexOf('CREATE OR REPLACE FUNCTION public.buy_resale_ticket_with_credito'),
    migration.indexOf('-- Listing eligibility')));
  const scalar = async (sql, params = []) => (await db.query(sql, params)).rows[0];

  async function seed(real, promo, reserve) {
    await db.exec('TRUNCATE public.notifications, public.movements, public.resale_transactions, public.wallets, public.wallet_reserves, public.user_credit, public.resale_listings, public.tickets, public.events, auth.users');
    await db.query('INSERT INTO auth.users VALUES ($1,$2,$3)', [buyer, 'buyer@example.test', { full_name: 'Buyer' }]);
    await db.query(`INSERT INTO public.events VALUES ($1,'Night',true,false,'scheduled',now(),now() + interval '1 day')`, [event]);
    await db.query(`INSERT INTO public.tickets
      (id,event_id,user_id,total_price,status,ticket_status,validation_status,wallet_added,
       payment_status,qr_token,qr_code,short_code,buyer_name,buyer_email,attendee_name,attendee_email,transfer_count)
      VALUES ($1,$2,$3,10,'resale','reselling','valid',false,'paid',gen_random_uuid(),'old-qr',
              'OLD','Seller','seller@example.test','Seller','seller@example.test',0)`, [ticket,event,seller]);
    await db.query(`INSERT INTO public.resale_listings VALUES ($1,$2,$3,10,'active',now())`, [listing,ticket,seller]);
    await db.query('INSERT INTO public.user_credit VALUES ($1,$2,$3,now())', [buyer,real,promo]);
    if (reserve) await db.query(`INSERT INTO public.wallet_reserves (user_id,amount,stripe_payment_intent_id)
      VALUES ($1,$2,'pi_original')`, [buyer,reserve]);
  }
  const buy = () => db.query('SELECT public.buy_resale_ticket_with_credito($1,$2) AS result', [listing,buyer]);

  await t.test('promo credit transfers without creating real backing', async () => {
    await seed(20,30,0);
    assert.equal((await buy()).rows[0].result.success, true);
    assert.deepEqual(await scalar('SELECT balance_real,balance_promo FROM public.user_credit WHERE user_id=$1',[seller]),
      { balance_real: '0', balance_promo: '10' });
    assert.deepEqual(await scalar('SELECT balance_real,balance_promo FROM public.user_credit WHERE user_id=$1',[buyer]),
      { balance_real: '20', balance_promo: '20' });
    const changed = await scalar(`SELECT user_id,buyer_name,attendee_name,short_code,wallet_added,
      qr_code = qr_token::text AS matching_qr, qr_code <> 'old-qr' AS rotated
      FROM public.tickets WHERE id=$1`,[ticket]);
    assert.equal(changed.user_id,buyer);
    assert.equal(changed.buyer_name,'Buyer');
    assert.equal(changed.attendee_name,'Buyer');
    assert.equal(changed.short_code,null);
    assert.equal(changed.wallet_added,false);
    assert.equal(changed.matching_qr,true);
    assert.equal(changed.rotated,true);
    assert.equal((await scalar('SELECT count(*)::int n FROM public.movements')).n,2);
    assert.equal((await scalar('SELECT count(*)::int n FROM public.notifications')).n,2);
    await assert.rejects(buy(), /Listing unavailable/);
  });

  await t.test('real credit transfers its original payment reserve', async () => {
    await seed(10,0,10);
    await buy();
    assert.deepEqual(await scalar('SELECT balance_real,balance_promo FROM public.user_credit WHERE user_id=$1',[seller]),
      { balance_real: '10', balance_promo: '0' });
    assert.equal((await scalar('SELECT user_id FROM public.wallet_reserves')).user_id,seller);
    assert.equal((await scalar('SELECT balance FROM public.wallets WHERE user_id=$1',[seller])).balance,'10');
  });

  await t.test('missing reserve rolls back every change', async () => {
    await seed(10,0,0);
    await assert.rejects(buy(), /Insufficient reserve backing/);
    assert.equal((await scalar('SELECT status FROM public.resale_listings')).status,'active');
    assert.equal((await scalar('SELECT user_id FROM public.tickets')).user_id,seller);
    assert.equal((await scalar('SELECT balance_real FROM public.user_credit WHERE user_id=$1',[buyer])).balance_real,'10');
    assert.equal((await scalar('SELECT count(*)::int n FROM public.movements')).n,0);
  });
});
