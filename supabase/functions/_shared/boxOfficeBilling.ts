import Stripe from 'npm:stripe@22.6.0';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.89.0';
import { BOX_OFFICE_FEATURE, subscriptionEntitlement } from './boxOfficeEntitlement.ts';

export function billingClients() {
  const key = Deno.env.get('STRIPE_SECRET_KEY') || '';
  const url = Deno.env.get('SUPABASE_URL') || '';
  if (!/^(sk|rk)_(test|live)_/.test(key)) throw new Error('Facturación no configurada');
  if (url.includes('uhondxttdpvywvkyqlkk') && !/^(sk|rk)_test_/.test(key)) throw new Error('Test environment requires test Stripe key');
  const stripe = new Stripe(key, { apiVersion: '2026-09-30.endive', httpClient: Stripe.createFetchHttpClient() });
  const db = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '', { auth: { persistSession: false } });
  return { stripe, db, url, livemode: /^(sk|rk)_live_/.test(key) };
}

export function billingReturnUrl(url: string) {
  const base = url.includes('uhondxttdpvywvkyqlkk') ? 'https://eclipse-staging-staging.up.railway.app' :
    url.includes('zurbdrfmwjqbrscairub') ? 'https://api.weareeclipseoficial.com' : '';
  if (!base) throw new Error('Unconfigured billing environment');
  return `${base}/stripe/complete?next=${encodeURIComponent('eclipse://(creator)/box-office')}`;
}

export async function syncSubscription(stripe: Stripe, db: any, id: string, expectedOrganizer?: string) {
  // Timestamp is captured before the network call; a late response cannot replace a newer one.
  const requestedAt = new Date().toISOString();
  const subscription = await stripe.subscriptions.retrieve(id, { expand: ['latest_invoice'] });
  if (subscription.metadata.feature !== BOX_OFFICE_FEATURE) return null;
  const organizerId = subscription.metadata.organizer_id;
  if (expectedOrganizer && organizerId !== expectedOrganizer) throw new Error('Subscription owner mismatch');
  const customerId = typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id;
  const { data: owner, error: ownerError } = await db.from('organizer_box_office_subscriptions')
    .select('organizer_id,stripe_subscription_id').eq('organizer_id', organizerId).eq('stripe_customer_id', customerId).maybeSingle();
  if (ownerError) throw ownerError;
  if (!owner) return null;
  // A delayed webhook for a previous cancelled subscription must not revoke a replacement.
  if (owner.stripe_subscription_id && owner.stripe_subscription_id !== id) {
    const current = await stripe.subscriptions.retrieve(owner.stripe_subscription_id);
    if (!['canceled', 'incomplete_expired'].includes(current.status) || current.created > subscription.created) return null;
  }
  const entitlement = subscriptionEntitlement(subscription);
  const { error } = await db.rpc('sync_box_office_subscription', {
    p_organizer_id: organizerId, p_customer_id: customerId, p_subscription_id: id,
    p_status: entitlement.status, p_paid_through: entitlement.paidThrough,
    p_cancel_at_period_end: entitlement.cancelAtPeriodEnd, p_requested_at: requestedAt,
  });
  if (error) throw error;
  return subscription;
}

export const billingCors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
export function billingJson(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...billingCors, 'Content-Type': 'application/json' } });
}
