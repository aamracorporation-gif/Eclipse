/** @jest-environment node */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vm from 'node:vm';
import * as ts from 'typescript';
import * as policy from '../supabase/functions/_shared/launchPolicy';

const source = fs.readFileSync(path.join(__dirname, '../supabase/functions/create-payment-intent-v2/index.ts'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;

async function checkout(body: Record<string, unknown>, previous: unknown[] = []) {
  let handler: (request: Request) => Promise<Response> = null as any;
  const calls: string[] = [];
  vm.runInNewContext(compiled, {
    exports: {}, require: () => policy, Request, Response, URLSearchParams, console,
    Deno: { env: { get: () => 'test-placeholder' }, serve: (fn: typeof handler) => { handler = fn; } },
    fetch: async (url: string) => {
      calls.push(url);
      if (url.includes('/auth/v1/user')) return Response.json({ id: 'qa-user' });
      if (url.includes('/rest/v1/payment_transactions?')) return Response.json(previous);
      if (url.includes('/rest/v1/events?')) return Response.json([]);
      throw new Error(`Unexpected request: ${url}`);
    },
  });
  const response = await handler(new Request('https://example.test/checkout', {
    method: 'POST', headers: { Authorization: 'Bearer qa', 'Content-Type': 'application/json' },
    body: JSON.stringify({ idempotency_key: 'qa_launch_checkout_123', ...body }),
  }));
  return { result: await response.json(), calls };
}

describe('Edge launch guard', () => {
  it.each([
    { kind: 'resale_ticket' },
    { kind: 'event_ticket', credit_debit_eur: 1 },
    { kind: 'vip_table', wallet_debit_eur: 1 },
    { kind: 'event_ticket', credit_debit_eur: 0, wallet_debit_eur: 2 },
    { kind: 'wallet_topup' },
  ])('rejects before Stripe or transaction lookup: %j', async body => {
    const { result, calls } = await checkout(body);
    expect(result.code).toBe('FEATURE_DISABLED');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('/auth/v1/user');
  });
  it.each([
    { kind: 'resale_ticket', metadata: {} },
    { kind: 'event_ticket', metadata: { credit_debit_cents: 100 } },
  ])('does not return old disabled checkout secrets through idempotency replay', async transaction => {
    const { result, calls } = await checkout({ kind: 'event_ticket' }, [transaction]);
    expect(result.code).toBe('FEATURE_DISABLED');
    expect(calls).toHaveLength(2);
    expect(result.client_secret).toBeUndefined();
  });
});
