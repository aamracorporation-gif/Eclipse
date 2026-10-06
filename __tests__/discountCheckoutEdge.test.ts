/** @jest-environment node */
import * as fs from 'node:fs';
import * as vm from 'node:vm';
import * as ts from 'typescript';
import * as discounts from '../supabase/functions/_shared/discountPolicy';
import * as launch from '../supabase/functions/_shared/launchPolicy';
import * as products from '../supabase/functions/_shared/ticketProduct';
const compiled = ts.transpileModule(fs.readFileSync('supabase/functions/create-payment-intent-v2/index.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const base = { id: 'coupon', event_id: 'event', discount_type: 'percentage', discount_value: 20,
  applicability: 'all', min_tickets: 1, is_active: true, uses_count: 0, max_uses: null };
async function checkout(kind: 'event_ticket' | 'vip_table', rule: any = base, quantity = 1, failure = false, expected?: number) {
  let handler: any; let stripe: URLSearchParams | null = null; let transaction: any;
  const env: Record<string, string> = { SUPABASE_URL: 'https://fixture.invalid', SUPABASE_ANON_KEY: 'fixture',
    SUPABASE_SERVICE_ROLE_KEY: 'service-fixture', STRIPE_SECRET_KEY: 'sk_test_fixture', REQUIRE_ORGANIZER_STRIPE_CONNECT: 'true' };
  vm.runInNewContext(compiled, {
    exports: {}, require: (name: string) => name.includes('discountPolicy') ? discounts : name.includes('launchPolicy') ? launch : products,
    Deno: { env: { get: (name: string) => env[name] }, serve: (fn: any) => { handler = fn; } },
    Response, URLSearchParams, console,
    fetch: async (url: string, init: any = {}) => {
      const reply = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
      if (url.includes('/auth/v1/user')) return reply({ id: 'buyer' });
      if (url.includes('/rest/v1/payment_transactions')) {
        if (init.method !== 'POST') return reply([]);
        transaction = JSON.parse(init.body); return reply([{ id: 'tx' }]);
      }
      if (url.includes('/rest/v1/events')) return reply([{ id: 'event', title: 'Event', creator_id: 'organizer',
        event_date: '2099-01-01T00:00:00Z', available_tickets: 20, ticket_price: 300,
        event_ticket_types: [{ id: 'admission', event_id: 'event', price: 300, quantity: 20, sold: 0, is_active: true, category: 'general', metadata: {} }] }]);
      if (url.includes('/rest/v1/reservados_vip')) return reply([{ id: 'table', event_id: 'event', base_price: 300,
        name: 'Mesa VIP', is_active: true, quantity_available: 4, capacity_people: 6, metadata: {} }]);
      if (url.includes('/rest/v1/discount_codes')) return reply(rule ? [rule] : [], failure ? 503 : 200);
      if (url.includes('/rest/v1/profiles')) return reply([{ stripe_account_id: 'acct_fixture', stripe_charges_enabled: true }]);
      if (url.includes('/v1/accounts/') || url.endsWith('/v1/account')) return reply({ id: 'acct_fixture' });
      if (url.endsWith('/v1/payment_intents')) {
        stripe = new URLSearchParams(init.body);
        return reply({ id: 'pi_fixture', amount: Number(stripe.get('amount')), currency: 'eur', client_secret: 'fixture' });
      }
      throw Error('Unexpected external request: ' + url);
    },
  });
  const response = await handler(new Request('https://fixture.invalid/checkout', { method: 'POST',
    headers: { Authorization: 'Bearer fixture', 'Content-Type': 'application/json' }, body: JSON.stringify({
      kind, event_id: 'event', reference_id: 'table', ticket_type_id: 'admission', quantity,
      discount_code_id: 'coupon', idempotency_key: 'test-test-test-test',
      // The client must never be able to choose the monetary reduction or commission.
      discount_expected_cents: expected, discount_amount_cents: 29999, discounted_total_cents: 1, commission_bps: 0,
    }),
  }));
  return { body: await response.json(), stripe: stripe as URLSearchParams | null, transaction };
}
it.each(['event_ticket', 'vip_table'] as const)('%s charges the server-computed discounted amount', async kind => {
  const { body, stripe, transaction } = await checkout(kind);
  expect(body.ok).toBe(true);
  expect(body.amount_cents).toBe(24391);
  expect(transaction.metadata.original_total_cents).toBe(30000);
  expect(transaction.metadata.discount_amount_cents).toBe(6000);
  expect(transaction.metadata.discounted_total_cents).toBe(24000);
  expect(stripe?.get('metadata[discount_code_id]')).toBe('coupon');
  expect(Number(stripe?.get('amount'))).toBe(24391);
});
it('VIP commission is 5% of the discounted table, not per guest', async () => {
  const { transaction } = await checkout('vip_table');
  expect(transaction.platform_fee_cents).toBe(1200);
  expect(transaction.destination_amount_cents).toBe(22800);
  expect(transaction.metadata.quantity).toBe(1);
  expect(transaction.metadata.capacity_people).toBe(6);
});
it('fixed discount applies once to a multi-ticket order', async () => {
  const { transaction } = await checkout('event_ticket', { ...base, discount_type: 'fixed', discount_value: 50 }, 2);
  expect(transaction.metadata.original_total_cents).toBe(60000);
  expect(transaction.metadata.discount_amount_cents).toBe(5000);
  expect(transaction.metadata.discounted_total_cents).toBe(55000);
});
it.each([100, 150])('VIP fixed %s EUR reduces exactly the whole-table subtotal', async discount_value => {
  const { transaction } = await checkout('vip_table', { ...base, discount_type: 'fixed', discount_value });
  expect(transaction.metadata.discount_amount_cents).toBe(discount_value * 100);
});
it('a full-price coupon keeps the existing separately disclosed minimum service fee', async () => {
  const { body, transaction } = await checkout('vip_table', { ...base, discount_value: 100 });
  expect(body.amount_cents).toBe(50);
  expect(transaction.platform_fee_cents).toBe(0);
  expect(transaction.destination_amount_cents).toBe(0);
});
it.each([
  null, { ...base, is_active: false }, { ...base, valid_until: '2000-01-01T00:00:00Z' },
  { ...base, max_uses: 1, uses_count: 1 }, { ...base, applicability: 'tickets' },
  { ...base, applicability: 'selected', ticket_type_ids: ['table'], vip_reservado_ids: [] },
  { ...base, applicability: 'selected', vip_reservado_ids: ['other'] }, { ...base, event_id: 'other-event' },
  { ...base, min_tickets: 2 }, { ...base, discount_value: 150 },
])('VIP rejects invalid coupon before Stripe: %j', async rule => {
  const { body, stripe, transaction } = await checkout('vip_table', rule);
  expect(body.ok).toBe(false); expect(stripe).toBeNull(); expect(transaction).toBeUndefined();
});
it('admission minimum quantity is enforced on the server, not only in the form', async () => {
  const { body, stripe } = await checkout('event_ticket', { ...base, min_tickets: 2 });
  expect(body.error).toContain('mínimo'); expect(stripe).toBeNull();
});
it.each(['event_ticket', 'vip_table'] as const)('%s accepts only its selected catalog ID', async kind => {
  const { body } = await checkout(kind, { ...base, applicability: 'selected', ticket_type_ids: ['admission'], vip_reservado_ids: ['table'] });
  expect(body.ok).toBe(true);
});
it('database errors do not degrade into undiscounted checkout', async () => {
  const { body, stripe } = await checkout('vip_table', base, 1, true);
  expect(body.ok).toBe(false); expect(stripe).toBeNull();
});

it('stale displayed discount is rejected rather than silently changing the price', async () => {
  const { body, stripe } = await checkout('vip_table', base, 1, false, 5000);
  expect(body.ok).toBe(false); expect(body.error).toContain('ha cambiado'); expect(stripe).toBeNull();
});
