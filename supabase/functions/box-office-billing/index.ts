import { billingClients, billingCors, billingJson, billingReturnUrl, syncSubscription } from '../_shared/boxOfficeBilling.ts';
import { BOX_OFFICE_FEATURE, BOX_OFFICE_PRICE_CENTS } from '../_shared/boxOfficeEntitlement.ts';

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: billingCors });
  if (req.method !== 'POST') return billingJson({ error: 'Method not allowed' }, 405);
  try {
    const { stripe, db, url } = billingClients();
    const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') || '';
    const { data: { user }, error: authError } = await db.auth.getUser(token);
    if (authError || !user) return billingJson({ error: 'Inicia sesión para continuar.' }, 401);
    const { data: profile, error: profileError } = await db.from('profiles')
      .select('role,is_suspended,verification_status,stripe_onboarding_completed,stripe_charges_enabled').eq('id', user.id).single();
    if (profileError || profile?.role !== 'organizer' || profile.is_suspended || profile.verification_status !== 'verified' ||
      !profile.stripe_onboarding_completed || !profile.stripe_charges_enabled) return billingJson({ error: 'Solo el organizador verificado puede gestionar la suscripción.' }, 403);
    const { action } = await req.json();
    if (!['checkout', 'refresh', 'portal'].includes(action)) return billingJson({ error: 'Acción no válida' }, 400);
    const { error: initError } = await db.from('organizer_box_office_subscriptions')
      .upsert({ organizer_id: user.id }, { onConflict: 'organizer_id', ignoreDuplicates: true });
    if (initError) throw initError;
    const read = async () => {
      const { data, error } = await db.from('organizer_box_office_subscriptions').select('*').eq('organizer_id', user.id).single();
      if (error) throw error;
      return data;
    };
    let row = await read();
    if (row.stripe_subscription_id) await syncSubscription(stripe, db, row.stripe_subscription_id, user.id);
    let session = row.checkout_session_id ? await stripe.checkout.sessions.retrieve(row.checkout_session_id) : null;
    if (session?.subscription) await syncSubscription(stripe, db,
      typeof session.subscription === 'string' ? session.subscription : session.subscription.id, user.id);
    row = await read();
    if (action === 'refresh') return billingJson({ ok: true });

    const returnUrl = billingReturnUrl(url);
    if (action === 'portal' || (row.stripe_subscription_id && !['canceled', 'incomplete_expired'].includes(row.status))) {
      if (!row.stripe_customer_id) return billingJson({ error: 'Todavía no tienes una suscripción que gestionar.' }, 409);
      const configurations = await stripe.billingPortal.configurations.list({ limit: 100, active: true });
      let config = configurations.data.find(c => c.metadata?.feature === BOX_OFFICE_FEATURE);
      if (!config) config = await stripe.billingPortal.configurations.create({
        business_profile: { headline: 'Eclipse · Taquilla Premium' },
        features: { customer_update: { enabled: false }, invoice_history: { enabled: true },
          payment_method_update: { enabled: true }, subscription_cancel: { enabled: true, mode: 'at_period_end' }, subscription_update: { enabled: false } },
        metadata: { feature: BOX_OFFICE_FEATURE },
      }, { idempotencyKey: 'eclipse-box-office-portal-v2' });
      const portal = await stripe.billingPortal.sessions.create({ customer: row.stripe_customer_id, configuration: config.id, return_url: returnUrl });
      return billingJson({ url: portal.url, kind: 'portal' });
    }
    if (session?.status === 'open') return billingJson({ url: session.url, kind: 'checkout' });
    if (session) {
      const { error } = await db.from('organizer_box_office_subscriptions')
        .update({ checkout_session_id: null, checkout_generation: crypto.randomUUID() })
        .eq('organizer_id', user.id).eq('checkout_generation', row.checkout_generation);
      if (error) throw error;
      row = await read();
      session = null;
    }
    if (!row.stripe_customer_id) {
      const customer = await stripe.customers.create({ metadata: { organizer_id: user.id, feature: BOX_OFFICE_FEATURE } },
        { idempotencyKey: `box-office-customer-${user.id}` });
      const { error } = await db.from('organizer_box_office_subscriptions').update({ stripe_customer_id: customer.id }).eq('organizer_id', user.id);
      if (error) throw error;
      row.stripe_customer_id = customer.id;
    }
    const suffix = row.checkout_generation.replace(/[^a-f]/g, '').padEnd(8, 'a').slice(0, 8);
    session = await stripe.checkout.sessions.create({
      mode: 'subscription', customer: row.stripe_customer_id, client_reference_id: user.id,
      success_url: returnUrl, cancel_url: returnUrl, locale: 'es',
      integration_identifier: `eclipse_box_office_${suffix}`,
      line_items: [{ quantity: 1, price_data: { currency: 'eur', unit_amount: BOX_OFFICE_PRICE_CENTS,
        recurring: { interval: 'month' }, product_data: { name: 'Eclipse · Taquilla Premium',
          description: 'Venta en taquilla desde la app para los trabajadores autorizados de tu organización.' } } }],
      subscription_data: { metadata: { feature: BOX_OFFICE_FEATURE, organizer_id: user.id } },
      metadata: { feature: BOX_OFFICE_FEATURE, organizer_id: user.id },
      custom_text: { submit: { message: '50 € al mes por organizador. Renovación mensual automática. Puedes cancelar al final del periodo pagado; el escáner continúa disponible.' } },
    }, { idempotencyKey: `box-office-checkout-${row.checkout_generation}` });
    const { error: saveError } = await db.from('organizer_box_office_subscriptions').update({ checkout_session_id: session.id })
      .eq('organizer_id', user.id).eq('checkout_generation', row.checkout_generation);
    if (saveError) throw saveError;
    return billingJson({ url: session.url, kind: 'checkout' });
  } catch (error) {
    console.error('box-office-billing', error instanceof Error ? error.message : 'Billing error');
    return billingJson({ error: 'No se pudo conectar con la facturación. Inténtalo de nuevo.' }, 503);
  }
});
