type BillingOwner = { stripe_subscription_id?: string | null; stripe_customer_id?: string | null };

/** Cancel future billing before its owner and billing reference are removed. */
export async function cancelBoxOfficeForDeletion(
  owner: BillingOwner | null, organizerId: string, key: string, projectUrl: string,
  send: typeof fetch = fetch,
) {
  if (!owner?.stripe_subscription_id) return;
  if (!owner.stripe_customer_id || !/^sub_[A-Za-z0-9]+$/.test(owner.stripe_subscription_id)) throw new Error('Invalid billing reference');
  const expected = projectUrl === 'https://uhondxttdpvywvkyqlkk.supabase.co' ? 'test' : projectUrl === 'https://zurbdrfmwjqbrscairub.supabase.co' ? 'live' : null;
  if (!expected || !['sk', 'rk'].some(prefix => key.startsWith(`${prefix}_${expected}_`))) throw new Error('Billing environment mismatch');
  const endpoint = `https://api.stripe.com/v1/subscriptions/${encodeURIComponent(owner.stripe_subscription_id)}`;
  const headers = { Authorization: `Bearer ${key}` };
  const currentResponse = await send(endpoint, { headers, signal: AbortSignal.timeout(15000) });
  if (!currentResponse.ok) throw new Error('Cannot verify subscription');
  const current = await currentResponse.json();
  const customer = typeof current.customer === 'string' ? current.customer : current.customer?.id;
  if (current.id !== owner.stripe_subscription_id || customer !== owner.stripe_customer_id ||
    current.metadata?.organizer_id !== organizerId || current.metadata?.feature !== 'box_office_monthly' ||
    current.livemode !== (expected === 'live')) throw new Error('Subscription ownership mismatch');
  if (['canceled', 'incomplete_expired'].includes(current.status)) return;
  const response = await send(endpoint, {
    method: 'DELETE', headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ invoice_now: 'false', prorate: 'false' }), signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error('Subscription cancellation failed');
  const canceled = await response.json();
  if (canceled.id !== owner.stripe_subscription_id || canceled.status !== 'canceled') throw new Error('Cancellation not confirmed');
}
