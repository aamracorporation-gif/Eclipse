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

// A small schema fixture isolates the new transaction guard from legacy fulfillment.
// The real migration runs in PostgreSQL/WASM, including PL/pgSQL and role grants.
test('resale settlement database guard', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE profiles (id uuid PRIMARY KEY, full_name text, email text);
    CREATE TABLE payment_transactions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), stripe_payment_intent_id text UNIQUE,
      user_id uuid, kind text, status text, metadata jsonb
    );
    CREATE TABLE resale_listings (id uuid PRIMARY KEY, ticket_id uuid, seller_id uuid, status text, price numeric);
    CREATE TABLE tickets (
      id uuid PRIMARY KEY, user_id uuid, event_id uuid, status text, ticket_status text,
      scanned_at timestamptz, validation_status text, wallet_added boolean, payment_status text,
      qr_token uuid DEFAULT gen_random_uuid(), qr_code text, buyer_name text, buyer_email text
    );
    CREATE TABLE events (
      id uuid PRIMARY KEY, allow_resale boolean, is_cancelled boolean, status text,
      end_datetime timestamptz, event_date timestamptz
    );
    CREATE FUNCTION public.fulfill_payment_for_user(text, uuid) RETURNS jsonb
      LANGUAGE plpgsql SECURITY DEFINER AS $$
      BEGIN
        IF EXISTS (SELECT 1 FROM payment_transactions
          WHERE stripe_payment_intent_id = $1 AND metadata->>'simulate_error' = 'yes') THEN
          RAISE EXCEPTION 'Simulated database failure';
        END IF;
        UPDATE tickets SET user_id = $2, status = 'valid', ticket_status = 'active';
        UPDATE resale_listings SET status = 'sold';
        UPDATE payment_transactions SET status = 'fulfilled'
          WHERE stripe_payment_intent_id = $1;
        RETURN '{"fulfilled":true}'::jsonb;
      END $$;
    GRANT EXECUTE ON FUNCTION public.fulfill_payment_for_user(text, uuid) TO service_role;
  `);
  await db.exec(fs.readFileSync(path.join(__dirname, '../../supabase/migrations/20260920120000_atomic_resale_refund_decision.sql'), 'utf8'));
  await db.exec(fs.readFileSync(path.join(__dirname, '../../supabase/migrations/20260920121000_align_resale_refund_guard_locks.sql'), 'utf8'));

  async function seed() {
    await db.exec('TRUNCATE payment_transactions, resale_listings, tickets, events, profiles');
    await db.query(`INSERT INTO profiles VALUES ($1,'New holder','buyer@example.test')`, [buyer]);
    await db.query(`INSERT INTO events VALUES ($1, true, false, 'active', now() + interval '1 day', now())`, [event]);
    await db.query(`INSERT INTO tickets (id,user_id,event_id,status,ticket_status,validation_status,wallet_added,payment_status,buyer_name,buyer_email)
      VALUES ($1,$2,$3,'resale','reselling','valid',false,'paid','Previous holder','seller@example.test')`, [ticket, seller, event]);
    await db.query(`INSERT INTO resale_listings VALUES ($1,$2,$3,'active',10)`, [listing, ticket, seller]);
    await db.query(`INSERT INTO payment_transactions (stripe_payment_intent_id,user_id,kind,status,metadata)
      VALUES ('pi_1',$1,'resale_ticket','created',$2)`, [buyer, JSON.stringify({ listing_id: listing, ticket_id: ticket, seller_id: seller, original_total_cents: 1000 })]);
  }
  async function fulfill(intent = 'pi_1', user = buyer) {
    return (await db.query('SELECT public.fulfill_payment_for_user($1,$2) AS result', [intent, user])).rows[0].result;
  }
  async function status() {
    return (await db.query("SELECT status FROM payment_transactions WHERE stripe_payment_intent_id = 'pi_1'")).rows[0].status;
  }

  await t.test('valid purchase transfers once; retry reports the completed purchase', async () => {
    await seed();
    assert.equal((await fulfill()).fulfilled, true);
    assert.equal((await fulfill()).fulfilled, true);
    assert.equal((await db.query('SELECT user_id FROM tickets')).rows[0].user_id, buyer);
    const holder = (await db.query('SELECT buyer_name,buyer_email,qr_code = qr_token::text AS qr_matches FROM tickets')).rows[0];
    assert.deepEqual(holder, { buyer_name: 'New holder', buyer_email: 'buyer@example.test', qr_matches: true });
  });

  await t.test('second payment for a sold listing becomes a durable refund decision', async () => {
    await seed();
    await fulfill();
    await db.query(`INSERT INTO payment_transactions (stripe_payment_intent_id,user_id,kind,status,metadata)
      SELECT 'pi_2',user_id,kind,'created',metadata FROM payment_transactions WHERE stripe_payment_intent_id='pi_1'`);
    assert.equal((await fulfill('pi_2')).refund_required, true);
    assert.equal((await db.query("SELECT status FROM payment_transactions WHERE stripe_payment_intent_id='pi_2'")).rows[0].status, 'refund_pending');
  });

  for (const [label, sql] of [
    ['expired event', "UPDATE events SET end_datetime = now() - interval '1 second'"],
    ['used ticket', "UPDATE tickets SET scanned_at = now()"],
    ['revoked ticket', "UPDATE tickets SET validation_status = 'revoked'"],
    ['changed owner', `UPDATE tickets SET user_id = '${buyer}'`],
    ['changed price', 'UPDATE resale_listings SET price = 11'],
    ['cancelled event', 'UPDATE events SET is_cancelled = true'],
  ]) {
    await t.test(`${label} blocks delivery and requests refund`, async () => {
      await seed();
      await db.exec(sql);
      assert.equal((await fulfill()).refund_required, true);
      assert.equal(await status(), 'refund_pending');
    });
  }

  await t.test('retry cannot deliver a ticket after the refund decision, even if the listing recovers', async () => {
    await seed();
    await db.exec("UPDATE resale_listings SET status = 'sold'");
    assert.equal((await fulfill()).refund_required, true);
    await db.exec("UPDATE resale_listings SET status = 'active'");
    assert.equal((await fulfill()).refund_required, true);
    assert.equal((await db.query('SELECT user_id FROM tickets')).rows[0].user_id, seller);
  });

  await t.test('unexpected database failure rolls back and leaves payment retryable', async () => {
    await seed();
    await db.exec(`UPDATE payment_transactions SET metadata = metadata || '{"simulate_error":"yes"}'::jsonb`);
    await assert.rejects(fulfill(), /Simulated database failure/);
    assert.equal(await status(), 'created');
  });

  await t.test('wrong buyer is rejected and the old function cannot bypass the guard', async () => {
    await seed();
    await assert.rejects(fulfill('pi_1', seller), /Payment transaction unavailable/);
    assert.equal(await status(), 'created');
    const grants = (await db.query(`SELECT
      has_function_privilege('service_role','public.fulfill_payment_for_user(text,uuid)','EXECUTE') AS wrapper,
      has_function_privilege('service_role','public.fulfill_payment_for_user_legacy_20260920(text,uuid)','EXECUTE') AS legacy,
      has_function_privilege('authenticated','public.fulfill_payment_for_user(text,uuid)','EXECUTE') AS client`)).rows[0];
    assert.deepEqual(grants, { wrapper: true, legacy: false, client: false });
  });

  await db.exec(`
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$
      SELECT nullif(current_setting('request.jwt.claim.sub', true),'')::uuid
    $$;
    ALTER TABLE tickets ADD COLUMN total_price numeric DEFAULT 10,
      ADD COLUMN transfer_count int DEFAULT 0, ADD COLUMN last_transferred_at timestamptz;
    ALTER TABLE events ADD COLUMN title text DEFAULT 'Fixture event';
    ALTER TABLE resale_listings ADD COLUMN created_at timestamptz DEFAULT now(),
      ADD COLUMN updated_at timestamptz DEFAULT now(), ADD UNIQUE (ticket_id);
    CREATE TABLE user_credit (user_id uuid PRIMARY KEY, balance_real numeric NOT NULL DEFAULT 0,
      balance_promo numeric NOT NULL DEFAULT 0, updated_at timestamptz DEFAULT now());
    CREATE TABLE wallets (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid UNIQUE,
      balance numeric NOT NULL DEFAULT 0, updated_at timestamptz DEFAULT now());
    CREATE TABLE wallet_reserves (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL,
      amount numeric NOT NULL CHECK (amount > 0), stripe_payment_intent_id text NOT NULL,
      status text NOT NULL DEFAULT 'pending', created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
    CREATE TABLE resale_transactions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), listing_id uuid,
      ticket_id uuid NOT NULL, seller_id uuid NOT NULL, buyer_id uuid NOT NULL,
      price numeric NOT NULL, commission numeric NOT NULL, seller_amount numeric NOT NULL);
    CREATE TYPE ledger_movimiento_tipo AS ENUM ('compra_con_credito', 'generacion_credito_reventa');
    CREATE TABLE ledger_movimientos (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tipo ledger_movimiento_tipo,
      usuario_id uuid, organizador_id uuid, importe numeric, referencia_id text, descripcion text);
    CREATE FUNCTION record_ledger_movimiento(ledger_movimiento_tipo,uuid,uuid,numeric,text,text)
      RETURNS uuid LANGUAGE sql AS $$
      INSERT INTO ledger_movimientos(tipo,usuario_id,organizador_id,importe,referencia_id,descripcion)
      VALUES ($1,$2,$3,round($4,2),nullif($5,''),nullif($6,'')) RETURNING id
    $$;
  `);
  await db.exec(fs.readFileSync(path.join(__dirname, '../../supabase/migrations/20260920104448_repair_resale_credit_and_ticket_transfer.sql'), 'utf8'));
  async function seedCredit(real, promo, backing) {
    await seed();
    await db.exec('TRUNCATE user_credit, wallets, wallet_reserves, resale_transactions, ledger_movimientos');
    await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [buyer]);
    await db.query('INSERT INTO user_credit(user_id,balance_real,balance_promo) VALUES ($1,$2,$3)', [buyer, real, promo]);
    if (backing > 0) await db.query("INSERT INTO wallet_reserves(user_id,amount,stripe_payment_intent_id) VALUES ($1,$2,'pi_backing')", [buyer, backing]);
  }
  const buyCredit = async () => (await db.query('SELECT public.buy_resale_ticket_with_credito($1,$2) AS result', [listing, buyer])).rows[0].result;

  await t.test('credit purchase preserves real backing and promotional credit separately', async () => {
    await seedCredit(20, 3, 20);
    const oldQr = (await db.query('SELECT qr_token FROM tickets')).rows[0].qr_token;
    assert.equal((await buyCredit()).success, true);
    const balances = (await db.query('SELECT user_id,balance_real::float,balance_promo::float FROM user_credit ORDER BY user_id')).rows;
    assert.deepEqual(balances, [
      { user_id: buyer, balance_real: 13, balance_promo: 0 },
      { user_id: seller, balance_real: 7, balance_promo: 3 },
    ]);
    const reserves = (await db.query('SELECT user_id,amount::float,stripe_payment_intent_id FROM wallet_reserves ORDER BY user_id')).rows;
    assert.deepEqual(reserves, [
      { user_id: buyer, amount: 13, stripe_payment_intent_id: 'pi_backing' },
      { user_id: seller, amount: 7, stripe_payment_intent_id: 'pi_backing' },
    ]);
    const holder = (await db.query('SELECT user_id,qr_token,qr_code,buyer_name,buyer_email FROM tickets')).rows[0];
    assert.equal(holder.user_id, buyer);
    assert.notEqual(holder.qr_token, oldQr);
    assert.equal(holder.qr_token, holder.qr_code);
    assert.equal(holder.buyer_name, 'New holder');
    assert.equal(holder.buyer_email, 'buyer@example.test');
    await assert.rejects(buyCredit(), /Listing unavailable/);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM resale_transactions')).rows[0].n, 1);
  });

  await t.test('missing Stripe backing aborts the entire credit transfer', async () => {
    await seedCredit(20, 0, 0);
    await assert.rejects(buyCredit(), /Insufficient reserve backing/);
    assert.equal((await db.query('SELECT user_id FROM tickets')).rows[0].user_id, seller);
    assert.equal((await db.query('SELECT balance_real::float FROM user_credit WHERE user_id=$1', [buyer])).rows[0].balance_real, 20);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM resale_transactions')).rows[0].n, 0);
  });

  await t.test('promotional credit does not mint a Stripe reserve', async () => {
    await seedCredit(20, 10, 0);
    assert.equal((await buyCredit()).success, true);
    const sellerCredit = (await db.query('SELECT balance_real::float,balance_promo::float FROM user_credit WHERE user_id=$1', [seller])).rows[0];
    assert.deepEqual(sellerCredit, { balance_real: 0, balance_promo: 10 });
    assert.equal((await db.query('SELECT count(*)::int AS n FROM wallet_reserves')).rows[0].n, 0);
  });

  await t.test('nullable ticket state cannot bypass credit resale eligibility', async () => {
    await seedCredit(0, 10, 0);
    await db.exec('UPDATE tickets SET status = NULL, ticket_status = NULL');
    await assert.rejects(buyCredit(), /Ticket unavailable for resale/);
  });

  await t.test('an unconfirmed original payment cannot enter credit resale', async () => {
    await seedCredit(0, 10, 0);
    await db.exec('UPDATE tickets SET payment_status = NULL');
    await assert.rejects(buyCredit(), /Ticket unavailable for resale/);
  });
});
