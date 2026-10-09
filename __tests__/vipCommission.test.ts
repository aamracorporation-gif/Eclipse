/** @jest-environment node */
import * as fs from 'node:fs';
import * as vm from 'node:vm';
import * as ts from 'typescript';
import { offerUnavailableReason } from '../supabase/functions/_shared/ticketProduct';

// Execute the real Edge handler; only external Auth, DB and Stripe are fixtures.
const sourcePath = process.env.VIP_EDGE_TEST_SOURCE || 'supabase/functions/create-payment-intent-v2/index.ts';
const compiled = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

async function checkout(price: number, options: { kind?: string; rate?: string; capacity?: number; previous?: boolean } = {}) {
  let handler: any;
  let stripeParams: URLSearchParams | undefined;
  let transaction: any;
  const env: Record<string, string> = {
    SUPABASE_URL: 'https://db.example.test', SUPABASE_ANON_KEY: 'anon-fixture',
    SUPABASE_SERVICE_ROLE_KEY: 'service-fixture', STRIPE_SECRET_KEY: 'sk_test_fixture',
    REQUIRE_ORGANIZER_STRIPE_CONNECT: 'true', STRIPE_PLATFORM_FEE_BPS: options.rate || '1000',
  };
  const fetch = jest.fn(async (url: string, init: any = {}) => {
    const reply = (data: unknown) => new Response(JSON.stringify(data), { status: 200 });
    if (url.includes('/auth/v1/user')) return reply({ id: 'buyer-fixture' });
    if (url.includes('/rest/v1/payment_transactions')) {
      if (init.method === 'POST') {
        transaction = JSON.parse(init.body);
        return reply([{ id: 'transaction-fixture' }]);
      }
      return reply(options.previous ? [{ id: 'old-tx', kind: 'vip_table', stripe_payment_intent_id: 'pi_old', metadata: {} }] : []);
    }
    if (url.includes('/rest/v1/reservados_vip')) return reply([{
      id: 'vip-fixture', event_id: 'event-fixture', base_price: price,
      is_active: true, quantity_available: 5, capacity_people: options.capacity || 6,
    }]);
    if (url.includes('/rest/v1/events')) return reply([{
      id: 'event-fixture', creator_id: 'organizer-fixture', title: 'Fixture event',
      event_date: '2099-01-01T00:00:00Z', ticket_price: price, available_tickets: 5,
    }]);
    if (url.includes('/rest/v1/profiles')) return reply([{ stripe_account_id: 'acct_fixture', stripe_charges_enabled: true }]);
    if (url.includes('/v1/accounts/acct_fixture')) return reply({ id: 'acct_fixture' });
    if (url.includes('/v1/payment_intents/pi_old')) return reply({ id: 'pi_old', amount: 51000, client_secret: 'fixture', currency: 'eur' });
    if (url.endsWith('/v1/payment_intents')) {
      stripeParams = new URLSearchParams(init.body);
      return reply({ id: 'pi_fixture', amount: Number(stripeParams.get('amount')), currency: 'eur', client_secret: 'fixture' });
    }
    throw new Error('Unexpected fixture request: ' + url);
  });
  vm.runInNewContext(compiled, {
    exports: {}, require: () => ({ checkoutUnavailableReason: () => null, offerUnavailableReason }),
    Deno: { env: { get: (name: string) => env[name] }, serve: (fn: any) => { handler = fn; } },
    fetch, Response, URLSearchParams, console,
  });
  const response = await handler(new Request('https://edge.example.test/checkout', {
    method: 'POST', headers: { Authorization: 'Bearer fixture', 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: options.kind || 'vip_table', reference_id: 'vip-fixture',
      event_id: 'event-fixture', quantity: 1, idempotency_key: 'vip-fixture-key-123456',
      // Untrusted client-supplied fees must have no influence on server pricing.
      commission_bps: 0, eclipse_commission_cents: 0, commission_cap_cents: 1 }),
  }));
  return { body: await response.json(), stripeParams, transaction };
}

it.each([[150, 750], [200, 1000], [201, 1005], [300, 1500], [499.99, 2500], [500, 2500], [500.01, 2500], [1000, 2500], [10000, 2500]])(
  'VIP %s EUR retains exactly %s cents, including cap/rounding boundaries', async (price, commission) => {
    const { body, stripeParams, transaction } = await checkout(price);
    expect(body.ok).toBe(true);
    expect(transaction.platform_fee_cents).toBe(commission);
    expect(transaction.commission_bps).toBe(500);
    expect(transaction.metadata.eclipse_commission_cents).toBe(commission);
    expect(transaction.metadata.commission_cap_cents).toBe(2500);
    expect(stripeParams?.get('metadata[commission_policy]')).toBe('vip_5pct_cap25_v1');
    const processing = transaction.metadata.service_fee_cents;
    expect(Number(stripeParams?.get('application_fee_amount'))).toBe(commission + processing);
    expect(transaction.destination_amount_cents).toBe(Math.round(price * 100) - commission);
    expect(body.amount_cents).toBe(Math.round(price * 100) + processing);
  },
);
it('VIP ignores normal-ticket tariff and guest count', async () => {
  const a = await checkout(300, { rate: '2000', capacity: 20 });
  expect(a.transaction.platform_fee_cents).toBe(1500);
});
it('normal tickets retain the configured uncapped tariff', async () => {
  const a = await checkout(1000, { kind: 'event_ticket', rate: '1000' });
  expect(a.body.ok).toBe(true);
  expect(a.transaction.platform_fee_cents).toBe(10000);
  expect(a.transaction.commission_bps).toBe(1000);
});
it('retries reuse the original payment without repricing or creating a new transaction', async () => {
  const a = await checkout(500, { previous: true });
  expect(a.body.idempotent_replay).toBe(true);
  expect(a.body.payment_intent_id).toBe('pi_old');
  expect(a.body.amount_cents).toBe(51000);
  expect(a.transaction).toBeUndefined();
  expect(a.stripeParams).toBeUndefined();
});
