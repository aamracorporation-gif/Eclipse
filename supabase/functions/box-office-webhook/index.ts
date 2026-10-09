import Stripe from 'npm:stripe@22.6.0';
import { billingClients, billingJson, syncSubscription } from '../_shared/boxOfficeBilling.ts';
import { subscriptionIdFromEvent } from '../_shared/boxOfficeEntitlement.ts';

Deno.serve(async req => {
  if (req.method !== 'POST') return billingJson({ error: 'Method not allowed' }, 405);
  const secret = Deno.env.get('BOX_OFFICE_WEBHOOK_SECRET');
  if (!secret) return billingJson({ error: 'Webhook unavailable' }, 503);
  const { stripe, db, livemode } = billingClients();
  let event;
  try {
    event = await stripe.webhooks.constructEventAsync(await req.text(), req.headers.get('stripe-signature') || '',
      secret, undefined, Stripe.createSubtleCryptoProvider());
  } catch { return billingJson({ error: 'Invalid signature' }, 400); }
  if (event.livemode !== livemode) return billingJson({ error: 'Wrong environment' }, 400);
  const id = subscriptionIdFromEvent(event);
  if (!id) return billingJson({ received: true });
  try {
    await syncSubscription(stripe, db, id);
    return billingJson({ received: true });
  } catch (error) {
    console.error('box-office-webhook', error instanceof Error ? error.message : 'Sync error');
    return billingJson({ error: 'Retry required' }, 500);
  }
});
