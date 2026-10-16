'use strict';
const { createHash, randomUUID } = require('node:crypto');
const { POLICY_VERSION } = require('./cancellationAmounts');

const CONSENT_TEXT = 'Autorizo a Eclipse a guardar mi tarjeta mediante Stripe, sin fianza ni cobro inicial. '
  + 'Si solicito cancelar un evento, los compradores recibirán el importe íntegro pagado. '
  + 'Eclipse podrá cobrar en esta tarjeta, sin que esté presente, la comisión de Eclipse registrada en las ventas afectadas '
  + 'más los costes reales no recuperados de Stripe por esas ventas, sus devoluciones y la gestión del cobro. '
  + 'Recibiré el desglose antes del cargo. El importe depende de las ventas y de los costes confirmados por Stripe; '
  + 'no es una tarifa fija ni el cargo de servicio del comprador. Los costes confirmados después se comunicarán por separado '
  + 'y se compensarán con mis siguientes liquidaciones, sin generar nuevos cargos automáticos a la tarjeta. '
  + 'Cualquier ajuste a mi favor también se reflejará en mi saldo. Si no hay liquidaciones suficientes, el saldo seguirá pendiente; '
  + 'podré solicitar a soporte el pago o la devolución de ese saldo. Si el banco rechaza el pago o pide confirmación, deberé completarlo en Eclipse. '
  + 'Los importes inferiores al mínimo de cobro de Stripe también se compensarán con mis liquidaciones, sin redondearlos al alza. '
  + 'Puedo revocar esta autorización para nuevos cargos contactando con soporte; la revocación no extingue las deudas existentes. '
  + 'Las ganancias de las nuevas ventas acogidas a esta política se liquidarán después del evento.';
const CONSENT_SHA256 = createHash('sha256').update(CONSENT_TEXT).digest('hex');
const policy = { version: POLICY_VERSION, text: CONSENT_TEXT, sha256: CONSENT_SHA256 };

function failure(code, status = 409) { return Object.assign(new Error(code), { code, status }); }
async function checked(query) { const { data, error } = await query; if (error) throw error; return data; }
const idOf = value => typeof value === 'string' ? value : value?.id;
const asList = value => value == null ? [] : Array.isArray(value) ? value : [value];

function billingRuntime(env = process.env) {
  if (env.ORGANIZER_CANCELLATION_BILLING_ENABLED !== 'true') throw failure('El cobro por cancelación todavía no está disponible.', 503);
  if (!['test', 'live'].includes(env.ORGANIZER_BILLING_STRIPE_MODE)) throw failure('BILLING_MODE_REQUIRED', 503);
  const live = env.ORGANIZER_BILLING_STRIPE_MODE === 'live';
  if (!new RegExp(`^(sk|rk)_${live ? 'live' : 'test'}_`).test(env.STRIPE_SECRET_KEY || '')) throw failure('BILLING_STRIPE_MODE_MISMATCH', 503);
  if (!env.SUPABASE_SERVICE_ROLE_KEY || !/^[a-z]{20}$/.test(env.ORGANIZER_BILLING_PROJECT_REF || '') ||
    env.SUPABASE_URL !== `https://${env.ORGANIZER_BILLING_PROJECT_REF}.supabase.co`) throw failure('BILLING_PROJECT_MISMATCH', 503);
  return { livemode: live };
}

function createOrganizerBilling({ db, stripe, livemode }) {
  async function organizer(userId) {
    const row = await checked(db.from('profiles').select('id,role,email,is_suspended').eq('id', userId).maybeSingle());
    if (!row || row.is_suspended || String(row.role).toLowerCase() !== 'organizer') throw failure('ORGANIZER_REQUIRED', 403);
    return row;
  }
  async function account(userId) {
    const row = await checked(db.from('organizer_billing_accounts').select('*').eq('organizer_id', userId).maybeSingle());
    if (row && row.livemode !== livemode) throw failure('BILLING_ACCOUNT_MODE_MISMATCH');
    return row;
  }
  async function beginSetup(userId, accepted) {
    if (accepted?.version !== policy.version || accepted?.sha256 !== policy.sha256 || accepted?.accepted !== true) {
      throw failure('Debes aceptar la autorización de cobro vigente.', 400);
    }
    const owner = await organizer(userId);
    let billing = await account(userId);
    if (!billing) {
      const customer = await stripe.customers.create({ ...(owner.email ? { email: owner.email } : {}),
        metadata: { eclipse_organizer_id: userId, eclipse_purpose: 'cancellation_billing' } },
      { idempotencyKey: `organizer-billing-customer:${livemode}:${userId}` });
      if (customer.livemode !== livemode) throw failure('STRIPE_CUSTOMER_MODE_MISMATCH');
      await checked(db.from('organizer_billing_accounts').upsert({ organizer_id: userId, stripe_customer_id: customer.id, livemode },
        { onConflict: 'organizer_id', ignoreDuplicates: true }));
      billing = await account(userId);
    }
    const setup = await checked(db.from('organizer_billing_setups').insert({ id: randomUUID(), organizer_id: userId,
      policy_version: policy.version, consent_text: policy.text, consent_sha256: policy.sha256 }).select('*').single());
    // SetupIntents authorize saving a method; they never collect a deposit.
    const intent = await stripe.setupIntents.create({ customer: billing.stripe_customer_id, usage: 'off_session',
      allowed_payment_method_types: ['card'],
      metadata: { eclipse_organizer_id: userId, eclipse_billing_setup_id: setup.id, eclipse_policy: policy.version } },
    { idempotencyKey: `organizer-billing-setup:${setup.id}` });
    if (intent.livemode !== livemode) throw failure('STRIPE_SETUP_MODE_MISMATCH');
    await checked(db.from('organizer_billing_setups').update({ setup_intent_id: intent.id }).eq('id', setup.id));
    return { setupId: setup.id, clientSecret: intent.client_secret };
  }
  async function confirmSetup(userId, setupId) {
    await organizer(userId);
    const billing = await account(userId);
    const setup = await checked(db.from('organizer_billing_setups').select('*').eq('id', setupId).eq('organizer_id', userId).maybeSingle());
    if (!billing || !setup?.setup_intent_id) throw failure('SETUP_NOT_FOUND', 404);
    const intent = await stripe.setupIntents.retrieve(setup.setup_intent_id, { expand: ['payment_method'] });
    if (intent.livemode !== livemode || idOf(intent.customer) !== billing.stripe_customer_id ||
      intent.metadata?.eclipse_organizer_id !== userId || intent.metadata?.eclipse_billing_setup_id !== setup.id ||
      intent.metadata?.eclipse_policy !== setup.policy_version || intent.usage !== 'off_session') throw failure('SETUP_OWNERSHIP_MISMATCH');
    if (intent.status !== 'succeeded') return { ready: false, status: intent.status };
    const method = typeof intent.payment_method === 'object' ? intent.payment_method : await stripe.paymentMethods.retrieve(intent.payment_method);
    if (method?.type !== 'card' || idOf(method.customer) !== billing.stripe_customer_id || method.livemode !== livemode) {
      throw failure('Debes guardar una tarjeta válida para esta autorización.');
    }
    await checked(db.from('organizer_billing_accounts').update({ setup_intent_id: intent.id, payment_method_id: method.id,
      policy_version: setup.policy_version, consent_text: setup.consent_text, consent_sha256: setup.consent_sha256,
      consent_at: setup.consent_at, ready: true }).eq('organizer_id', userId).eq('livemode', livemode));
    await checked(db.from('organizer_billing_setups').update({ status: 'succeeded' }).eq('id', setup.id));
    return { ready: true, card: { brand: method.card?.brand, last4: method.card?.last4 } };
  }
  async function overview(userId) {
    await organizer(userId);
    const billing = await account(userId);
    const cancellations = await checked(db.from('event_cancellations')
      .select('id,event_id,status,created_at,reason,cancellation_refunds(status,amount_cents,commission_cents),cancellation_collections(id,amount_cents,commission_cents,stripe_costs_cents,status,residual_costs_status,collection_costs_cents,reconciled_total_costs_cents)')
      .eq('organizer_id', userId).order('created_at', { ascending: false }).limit(100));
    const costEntries = await checked(db.from('organizer_cost_entries')
      .select('id,amount_cents,notice_delivered_at,created_at,organizer_cost_allocations(amount_cents,organizer_settlement_transfers(status))')
      .eq('organizer_id', userId).eq('livemode', livemode).order('created_at').limit(1000));
    const costs = costEntries.map(entry => {
      let settled = 0, reserved = 0;
      for (const a of asList(entry.organizer_cost_allocations)) {
        const status = asList(a.organizer_settlement_transfers)[0]?.status;
        if (['transferred','offset'].includes(status)) settled += a.amount_cents; else reserved += a.amount_cents;
      }
      return { id: entry.id, amountCents: entry.amount_cents, settledCents: settled, reservedCents: reserved,
        outstandingCents: entry.amount_cents - settled, noticeAcknowledged: Boolean(entry.notice_delivered_at) };
    });
    return { policy, ready: billing?.ready === true && billing.policy_version === policy.version && billing.consent_sha256 === policy.sha256, costs,
      cancellations: cancellations.map(row => ({ ...row, cancellation_collections: asList(row.cancellation_collections) })) };
  }
  async function acknowledgeCost(userId, id) {
    await organizer(userId);
    const row = await checked(db.from('organizer_cost_entries').select('id').eq('id', id).eq('organizer_id', userId).eq('livemode', livemode).maybeSingle());
    if (!row) throw failure('COST_NOT_FOUND', 404);
    await checked(db.from('organizer_cost_entries').update({ notice_delivered_at: new Date().toISOString() })
      .eq('id', id).eq('organizer_id', userId).is('notice_delivered_at', null));
    return { acknowledged: true };
  }
  async function requestCancellation(userId, eventId, reason) {
    await organizer(userId);
    return checked(db.rpc('request_event_cancellation', { p_event: eventId, p_organizer: userId, p_reason: reason, p_livemode: livemode }));
  }
  return { beginSetup, confirmSetup, overview, requestCancellation, account, acknowledgeCost };
}
module.exports = { policy, failure, checked, idOf, asList, billingRuntime, createOrganizerBilling };
